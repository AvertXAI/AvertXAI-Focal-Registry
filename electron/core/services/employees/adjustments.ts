// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Employee corrections — create/edit/soft-delete with an append-only audit log, the
//              shape lifted from timetracker/adjustments.ts. HOURS and AMOUNT are different
//              operations: an hours correction names a project and carries its own mandatory rate
//              (so corrected hours are valued at the rate the correction was made at, never at a
//              rate that has since changed); an amount correction needs neither. Adjustments NEVER
//              touch employee_entries, and they are never tier-capped — they exist to fix history.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/employees/adjustments.ts
//------------------------------------------------------------
import { generateUUIDv7 } from "../utils/uuidv7";
import { nowIso, type Db } from "./db";
import { logEvent } from "./eventLog";
import { getPerson } from "./people";
import { assertNotCompleted } from "../timetracker/completion";
import { netTotals } from "./netHours";
import type { Adjustment, AdjustmentKind, EmployeeAuditEntry, Entry } from "./types";
import { vAmount, vDeltaAmount, vDeltaMinutes, vId, vNullableId, vNullableString, vString, vUuid } from "./validate";

interface AdjustmentRow extends Omit<Adjustment, "audit_log"> {
  audit_log: string;
}

function parse(row: AdjustmentRow): Adjustment {
  return { ...row, audit_log: JSON.parse(row.audit_log) as EmployeeAuditEntry[] };
}

function getOne(db: Db, uuid: string): Adjustment {
  const row = db.prepare(`SELECT * FROM employee_adjustments WHERE uuid = ?`).get(uuid) as AdjustmentRow | undefined;
  if (!row) throw new Error(`Adjustment ${uuid} not found`);
  return parse(row);
}

/** Every adjustment for one person (soft-deleted included, for the struck-through audit view). */
export function listAdjustments(db: Db, employeeId: number): Adjustment[] {
  return (
    db
      .prepare(`SELECT * FROM employee_adjustments WHERE employee_id = ? ORDER BY created_at DESC, id DESC`)
      .all(vId(employeeId, "person id")) as AdjustmentRow[]
  ).map(parse);
}

export function listAllAdjustments(db: Db, orgId: string): Adjustment[] {
  return (
    db
      .prepare(`SELECT * FROM employee_adjustments WHERE org_id = ? ORDER BY created_at DESC, id DESC`)
      .all(orgId) as AdjustmentRow[]
  ).map(parse);
}

export interface HoursAdjustmentInput {
  employeeId: number;
  /** REQUIRED on an hours adjustment — the hours belong to a project or they cannot be costed. */
  // The stored row always has both, but a caller may leave them null: with an entry named they are
  // read off the entry, and with neither stated the person's one hourly rate and project are used
  // (refused when there are several).
  projectId: number | null;
  projectName: string | null;
  deltaMinutes: number;
  /** Mandatory: what the corrected hours are worth. Never re-derived later. */
  // Null means "read it off the entry, or use the person's one rate". The stored row always has one.
  rateAtEntry: number | null;
  note: string;
  /** 08-06: the ENTRY this corrects, when it corrects one — soft reference, nullable. */
  entryId?: number | null;
}

export interface AmountAdjustmentInput {
  employeeId: number;
  /** Optional on an amount adjustment — a flat correction need not belong to a project. */
  projectId: number | null;
  projectName: string | null;
  deltaAmount: number;
  note: string;
  /** 08-06: the ENTRY this corrects, when it corrects one — soft reference, nullable. */
  entryId?: number | null;
}

function requireNote(note: string): string {
  const trimmed = vString(note, "note", 2000).trim();
  if (!trimmed) throw new Error("A note explaining the adjustment is required");
  return trimmed;
}

function insert(
  db: Db,
  orgId: string,
  kind: AdjustmentKind,
  values: {
    employeeId: number;
    projectId: number | null;
    projectName: string | null;
    deltaMinutes: number | null;
    rateAtEntry: number | null;
    deltaAmount: number | null;
    note: string;
    entryId: number | null;
  }
): Adjustment {
  // Completion lock (ruling 3): no corrections on a completed project — either kind. Adjustments
  // stay exempt from CAPS, not from the lock. A null project (amount kind) passes.
  assertNotCompleted(db, values.projectId);
  const person = getPerson(db, values.employeeId);
  const uuid = generateUUIDv7();
  const at = nowIso();
  const audit: EmployeeAuditEntry[] = [
    {
      action: "created",
      at,
      kind,
      ...(values.deltaMinutes !== null ? { delta_minutes: values.deltaMinutes } : {}),
      ...(values.deltaAmount !== null ? { delta_amount: values.deltaAmount } : {}),
      note: values.note,
    },
  ];
  db.prepare(
    `INSERT INTO employee_adjustments
       (uuid, org_id, employee_id, kind, project_id, project_name, delta_minutes, rate_at_entry,
        delta_amount, note, entry_id, deleted_at, audit_log, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
  ).run(
    uuid,
    orgId,
    person.id,
    kind,
    values.projectId,
    values.projectName,
    values.deltaMinutes,
    values.rateAtEntry,
    values.deltaAmount,
    values.note,
    values.entryId,
    JSON.stringify(audit),
    at,
    at
  );
  logEvent(db, orgId, {
    type: "adjusted",
    employeeId: person.id,
    employeeName: person.name,
    detail: kind === "hours" ? `${values.deltaMinutes} min` : `${values.deltaAmount}`,
  });
  return getOne(db, uuid);
}

/**
 * Where an hours correction lands and what its hours are worth.
 *   An entry is named: both come from the entry, never from the caller, so the dollars are always
 *   the hours at the rate that entry was agreed at. Canon: hours only move money for hourly work,
 *   so a per-job, per-task or donated entry keeps its pay and the correction carries a zero rate.
 *   Project and rate are stated: used as given. That is the Adjustments tab, where both are typed.
 *   Neither: only safe when the person has exactly one hourly rate on one project. With more than
 *   one in play a guess could value the hours at the wrong rate, so it is refused.
 */
function hoursTerms(
  db: Db,
  employeeId: number,
  entryId: number | null,
  input: HoursAdjustmentInput
): { projectId: number; projectName: string; rate: number } {
  if (entryId !== null) {
    const entry = db.prepare(`SELECT * FROM employee_entries WHERE id = ?`).get(entryId) as Entry | undefined;
    if (!entry || entry.employee_id !== employeeId) throw new Error("That entry does not belong to this person.");
    // The table refuses an hours correction with no project, and that rule cannot be relaxed
    // without rebuilding the table, so say it in words before SQLite says it in code.
    if (entry.project_id === null) {
      throw new Error("That entry is not tied to a project, so its hours cannot be corrected. Use an Amount adjustment for it instead.");
    }
    return {
      projectId: entry.project_id,
      projectName: entry.project_name,
      rate: entry.pay_type === "hourly" ? entry.rate_at_entry : 0,
    };
  }
  if (input.projectId != null && input.rateAtEntry != null) {
    return {
      projectId: vId(input.projectId, "project id"),
      projectName: vString(input.projectName, "project name", 200, true).trim(),
      rate: vAmount(input.rateAtEntry, "rate"),
    };
  }
  const inPlay = db
    .prepare(
      `SELECT project_id, MAX(project_name) AS project_name, rate_at_entry
       FROM employee_entries
       WHERE employee_id = ? AND pay_type = 'hourly' AND project_id IS NOT NULL
       GROUP BY project_id, rate_at_entry`
    )
    .all(employeeId) as { project_id: number; project_name: string; rate_at_entry: number }[];
  if (inPlay.length !== 1) {
    throw new Error(
      "Pick the entry these hours belong to. With no entry named, hours can only be valued when this person has one hourly rate on one project."
    );
  }
  return { projectId: inPlay[0].project_id, projectName: inPlay[0].project_name, rate: inPlay[0].rate_at_entry };
}

/**
 * An entry cannot end up with less than no hours. Checked against the same net figure every total
 * reads, so the refusal and the totals can never disagree about what is left.
 */
function assertEntryHoursLeft(db: Db, entryId: number, deltaMinutes: number): void {
  const left = netTotals(db, { entryId })[0].hours;
  // A millionth of an hour of slack: stored hours are decimals, and taking an entry to exactly
  // zero must not be refused over float dust.
  if (left + deltaMinutes / 60 < -1e-6) {
    throw new Error(`That would take the entry below zero hours. It has ${left.toFixed(2)} hours left.`);
  }
}

/** Correct hours. The rate travels with the correction, so later rate changes never reprice it. */
export function createHoursAdjustment(db: Db, orgId: string, input: HoursAdjustmentInput): Adjustment {
  const employeeId = vId(input.employeeId, "person id");
  const deltaMinutes = vDeltaMinutes(input.deltaMinutes);
  const entryId = vNullableId(input.entryId, "entry id");
  const terms = hoursTerms(db, employeeId, entryId, input);
  if (entryId !== null) assertEntryHoursLeft(db, entryId, deltaMinutes);
  return insert(db, orgId, "hours", {
    employeeId,
    projectId: terms.projectId,
    projectName: terms.projectName,
    deltaMinutes,
    rateAtEntry: terms.rate,
    deltaAmount: null,
    note: requireNote(input.note),
    entryId,
  });
}

/** Correct an amount. Project is optional and no rate applies — the money is stated outright. */
export function createAmountAdjustment(db: Db, orgId: string, input: AmountAdjustmentInput): Adjustment {
  return insert(db, orgId, "amount", {
    employeeId: vId(input.employeeId, "person id"),
    projectId: vNullableId(input.projectId, "project id"),
    projectName: vNullableString(input.projectName, "project name", 200),
    deltaMinutes: null,
    rateAtEntry: null,
    deltaAmount: vDeltaAmount(input.deltaAmount),
    note: requireNote(input.note),
    entryId: vNullableId(input.entryId, "entry id"),
  });
}

/**
 * Edits the live values AND appends a before/after entry — history is never rewritten. The kind is
 * immutable: an hours correction cannot become an amount one, because that is a different
 * operation with different rules (delete it and make the other).
 */
export function updateAdjustment(db: Db, uuid: string, deltaValue: number, note: string): Adjustment {
  const existing = db.prepare(`SELECT * FROM employee_adjustments WHERE uuid = ?`).get(vUuid(uuid, "adjustment id")) as
    | AdjustmentRow
    | undefined;
  if (!existing) throw new Error(`Adjustment ${uuid} not found`);
  if (existing.deleted_at) throw new Error("Cannot edit a deleted adjustment");
  assertNotCompleted(db, existing.project_id); // by-uuid path — parent resolved first
  const cleanNote = requireNote(note);
  const isHours = existing.kind === "hours";
  const nextMinutes = isHours ? vDeltaMinutes(deltaValue) : null;
  const nextAmount = isHours ? null : vDeltaAmount(deltaValue);
  // An edit can dig as deep as a new correction, so it gets the same floor. Only the change counts:
  // what is left already includes this correction's current value.
  if (nextMinutes !== null && existing.entry_id !== null) {
    assertEntryHoursLeft(db, existing.entry_id, nextMinutes - (existing.delta_minutes ?? 0));
  }
  const at = nowIso();
  const audit = JSON.parse(existing.audit_log) as EmployeeAuditEntry[];
  audit.push({
    action: "edited",
    at,
    from: { delta_minutes: existing.delta_minutes, delta_amount: existing.delta_amount, note: existing.note },
    to: { delta_minutes: nextMinutes, delta_amount: nextAmount, note: cleanNote },
  });
  db.prepare(
    `UPDATE employee_adjustments
     SET delta_minutes = ?, delta_amount = ?, note = ?, updated_at = ?, audit_log = ?
     WHERE uuid = ?`
  ).run(nextMinutes, nextAmount, cleanNote, at, JSON.stringify(audit), existing.uuid);
  return getOne(db, existing.uuid);
}

/**
 * Undoes a soft delete: clears deleted_at and APPENDS a "restored" entry. The "deleted" entry it
 * follows is never removed — the trail has to say that this row was deleted and then brought back,
 * or it is not an audit trail. Idempotent: restoring a live adjustment is a no-op, not an error
 * (the archivePerson precedent). Added 2026-08-04 with the Employees Adjustments tab, which is the
 * first surface that can show a struck-through row and therefore the first that can offer a way back.
 */
export function restoreAdjustment(db: Db, orgId: string, uuid: string): Adjustment {
  const existing = db.prepare(`SELECT * FROM employee_adjustments WHERE uuid = ?`).get(vUuid(uuid, "adjustment id")) as
    | AdjustmentRow
    | undefined;
  if (!existing) throw new Error(`Adjustment ${uuid} not found`);
  if (!existing.deleted_at) return parse(existing);
  assertNotCompleted(db, existing.project_id); // restoring a correction is a correction too
  // Bringing back a deleted "less" correction takes its hours off again, so it is held to the
  // same floor as making it was.
  if (existing.kind === "hours" && existing.entry_id !== null) {
    assertEntryHoursLeft(db, existing.entry_id, existing.delta_minutes ?? 0);
  }
  const at = nowIso();
  const audit = JSON.parse(existing.audit_log) as EmployeeAuditEntry[];
  audit.push({ action: "restored", at });
  db.prepare(`UPDATE employee_adjustments SET deleted_at = NULL, updated_at = ?, audit_log = ? WHERE uuid = ?`).run(
    at,
    JSON.stringify(audit),
    existing.uuid
  );
  const person = getPerson(db, existing.employee_id);
  logEvent(db, orgId, {
    type: "adjusted",
    employeeId: person.id,
    employeeName: person.name,
    detail: "correction restored",
  });
  return getOne(db, existing.uuid);
}

/** Soft delete: sets deleted_at and appends a delete entry; the row is never hard-removed. */
export function softDeleteAdjustment(db: Db, orgId: string, uuid: string): void {
  const existing = db.prepare(`SELECT * FROM employee_adjustments WHERE uuid = ?`).get(vUuid(uuid, "adjustment id")) as
    | AdjustmentRow
    | undefined;
  if (!existing) throw new Error(`Adjustment ${uuid} not found`);
  if (existing.deleted_at) return;
  assertNotCompleted(db, existing.project_id); // by-uuid path — parent resolved first
  // Deleting a "more" correction takes its hours off the entry again, so it is held to the same
  // floor as making a "less" one: a later "less" correction may be standing on those hours.
  if (existing.kind === "hours" && existing.entry_id !== null && (existing.delta_minutes ?? 0) > 0) {
    assertEntryHoursLeft(db, existing.entry_id, -(existing.delta_minutes ?? 0));
  }
  const at = nowIso();
  const audit = JSON.parse(existing.audit_log) as EmployeeAuditEntry[];
  audit.push({ action: "deleted", at });
  db.prepare(`UPDATE employee_adjustments SET deleted_at = ?, updated_at = ?, audit_log = ? WHERE uuid = ?`).run(
    at,
    at,
    JSON.stringify(audit),
    existing.uuid
  );
  const person = getPerson(db, existing.employee_id);
  logEvent(db, orgId, { type: "adjustment_removed", employeeId: person.id, employeeName: person.name });
}
