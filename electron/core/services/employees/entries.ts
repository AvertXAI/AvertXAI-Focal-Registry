// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Employee work entries — the payroll atom. INSERT-and-READ ONLY, by design: there is
//              no update and no delete path anywhere in this file, which is what makes "a raise
//              must never rewrite a closed period" structural rather than a promise. Corrections
//              go through employee_adjustments, exactly as TimeTracker corrects time_entries
//              without ever touching them. Pay type lives HERE, on the entry, never on the person.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/employees/entries.ts
//------------------------------------------------------------
import { generateUUIDv7 } from "../utils/uuidv7";
import { nowIso, type Db } from "./db";
import { logEvent } from "./eventLog";
import { getPerson } from "./people";
// Cross-module completion lock — the reverse of projectFinancials → employees/reports, the standing
// arrangement (one database, one connection). completion.ts imports only the Db type: no cycle.
import { assertNotCompleted } from "../timetracker/completion";
import type { Entry, EntryInput } from "./types";
import {
  FLAT_PAY_TYPES,
  PAY_TYPES,
  vDate,
  vEnum,
  vHours,
  vId,
  vNullableAmount,
  vNullableId,
  vNullableString,
  vString,
  vAmount,
} from "./validate";

/** Mirrors the table's CHECK constraints so a caller gets a sentence, not a SQLite error. */
function clean(raw: EntryInput): EntryInput {
  const payType = vEnum(raw.payType, PAY_TYPES, "pay type");
  const isFlat = FLAT_PAY_TYPES.includes(payType);
  const flatAmount = vNullableAmount(raw.flatAmount, "amount");
  if (isFlat && flatAmount === null) {
    throw new Error("A per-job or per-task entry needs the agreed amount");
  }
  if (!isFlat && flatAmount !== null) {
    throw new Error("An hourly or donated entry carries no flat amount — its value comes from hours × rate");
  }
  return {
    employeeId: vId(raw.employeeId, "person id"),
    projectId: vNullableId(raw.projectId, "project id"),
    projectName: vString(raw.projectName, "project name", 200, true).trim(),
    taskId: vNullableId(raw.taskId, "task id"),
    payType,
    // Hours are recorded for EVERY pay type, donated included (canon) — zero is legal.
    hoursWorked: vHours(raw.hoursWorked, "hours"),
    // MANDATORY on every entry, flat types included: it is the rate in force at the moment of work,
    // kept so the row can be audited later even when the value came from a flat amount.
    rateAtEntry: vAmount(raw.rateAtEntry, "rate"),
    flatAmount,
    workedOn: vDate(raw.workedOn, "work date"),
    note: vNullableString(raw.note, "note", 2000),
  };
}

function getEntry(db: Db, id: number): Entry {
  const row = db.prepare(`SELECT * FROM employee_entries WHERE id = ?`).get(id) as Entry | undefined;
  if (!row) throw new Error(`Entry ${id} not found`);
  return row;
}

/** Logs a unit of work. The ONLY write path to employee_entries. */
export function createEntry(db: Db, orgId: string, input: EntryInput): Entry {
  const e = clean(input);
  // Completion lock (TimeTracker ruling 2, cross-module): a completed project takes no new work.
  // This ONE check covers Add Time AND the employee timer's stop — stopSession files through here
  // inside its transaction, so a refusal leaves the session OPEN and no time is lost (the 3B.2-B
  // order guarantee). Null projectId passes: work not tied to a project is not locked by one.
  assertNotCompleted(db, e.projectId);
  const person = getPerson(db, e.employeeId); // also proves the person exists before the insert
  const at = nowIso();
  const res = db
    .prepare(
      `INSERT INTO employee_entries
         (uuid, org_id, employee_id, project_id, project_name, task_id, pay_type, hours_worked,
          rate_at_entry, flat_amount, worked_on, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      generateUUIDv7(),
      orgId,
      e.employeeId,
      e.projectId,
      e.projectName,
      e.taskId,
      e.payType,
      e.hoursWorked,
      e.rateAtEntry,
      e.flatAmount,
      e.workedOn,
      e.note,
      at
    );
  const entry = getEntry(db, Number(res.lastInsertRowid));
  logEvent(db, orgId, {
    type: "entry_logged",
    employeeId: person.id,
    employeeName: person.name,
    detail: `${entry.hours_worked}h on ${entry.project_name} (${entry.pay_type})`,
  });
  return entry;
}

/** One person's entries, newest work first. */
export function listEntriesForPerson(db: Db, employeeId: number): Entry[] {
  return db
    .prepare(`SELECT * FROM employee_entries WHERE employee_id = ? ORDER BY worked_on DESC, id DESC`)
    .all(vId(employeeId, "person id")) as Entry[];
}

/** Every entry logged against one TimeTracker project (the analytics seam's detail view). */
export function listEntriesForProject(db: Db, projectId: number): Entry[] {
  return db
    .prepare(`SELECT * FROM employee_entries WHERE project_id = ? ORDER BY worked_on DESC, id DESC`)
    .all(vId(projectId, "project id")) as Entry[];
}

/** Inclusive work-date window across the whole org — payroll periods read this. */
export function listEntriesInRange(db: Db, orgId: string, fromDate: string, toDate: string): Entry[] {
  return db
    .prepare(
      `SELECT * FROM employee_entries
       WHERE org_id = ? AND worked_on >= ? AND worked_on <= ?
       ORDER BY worked_on DESC, id DESC`
    )
    .all(orgId, vDate(fromDate, "from date"), vDate(toDate, "to date")) as Entry[];
}
