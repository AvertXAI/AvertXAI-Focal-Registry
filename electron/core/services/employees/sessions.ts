// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: The EMPLOYEE TIMER — start a clock against a person, stop it, and file the result.
//              Deliberately minimal and honest (Jason's R1 option (b), 2026-08-04): this is a
//              start/stop record, NOT a second time-tracking engine.
//
//              THE ONE RULE THAT MATTERS: stopping a session does NOT invent a money row. It
//              composes a normal entry through the EXISTING createEntry, which means every CHECK
//              constraint, every validator and the single ENTRY_COST_SQL money rule apply to timed
//              work exactly as they do to manually added work. There is no second write path to
//              employee_entries and no cost arithmetic anywhere in this file.
//
//              Pay type and rate are captured AT START and carried to the entry unchanged — a raise
//              mid-session must never retroactively reprice work already under way, the same
//              doctrine that makes rate_at_entry mandatory.
//
//              NO MAIN-PROCESS CLOCK. Nothing here ticks. The renderer computes elapsed time from
//              started_at on its own interval, so a running session costs zero main-process work
//              and survives a renderer reload without drifting.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/employees/sessions.ts
//------------------------------------------------------------
import { generateUUIDv7 } from "../utils/uuidv7";
import { nowIso, type Db } from "./db";
import { createEntry } from "./entries";
import { getPerson } from "./people";
import type { Entry, PayType, Session, SessionInput } from "./types";
import { PAY_TYPES, vAmount, vEnum, vId, vNullableId, vNullableString, vString, vUuid } from "./validate";

/** Local YYYY-MM-DD from an ISO stamp — the work date an entry is filed under. Deliberately LOCAL:
    a session started at 9pm belongs to that evening's date, not to tomorrow in UTC. */
function localDateOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Elapsed hours as a decimal, rounded to 1/100th of an hour (36 seconds) — the precision the
    ledger displays and the money maths uses. Never negative, even if a clock moved backwards. */
export function elapsedHours(startedAt: string, endedAt: string): number {
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  return Math.max(0, Math.round((ms / 3_600_000) * 100) / 100);
}

export function getActiveSessions(db: Db, orgId: string): Session[] {
  return db
    .prepare(`SELECT * FROM employee_sessions WHERE org_id = ? AND ended_at IS NULL ORDER BY started_at ASC`)
    .all(orgId) as Session[];
}

function getSession(db: Db, id: number): Session {
  const row = db.prepare(`SELECT * FROM employee_sessions WHERE id = ?`).get(id) as Session | undefined;
  if (!row) throw new Error(`Session ${id} not found`);
  return row;
}

/**
 * Starts the clock. Refuses when that person already has one running — a person cannot be in two
 * places at once, and two open sessions would file two overlapping entries for the same hours.
 * The partial unique index in db.ts backstops this, but the check here is what produces a sentence
 * a user can act on instead of a constraint error.
 */
export function startSession(db: Db, orgId: string, input: SessionInput): Session {
  const employeeId = vId(input?.employeeId, "person id");
  const person = getPerson(db, employeeId); // proves the person exists before anything is written
  if (person.archived_at) throw new Error(`${person.name} is archived — restore them before starting a timer.`);

  const open = db
    .prepare(`SELECT started_at FROM employee_sessions WHERE employee_id = ? AND ended_at IS NULL`)
    .get(employeeId) as { started_at: string } | undefined;
  if (open) {
    throw new Error(`${person.name} already has a timer running. Stop it before starting another.`);
  }

  const payType = vEnum(input?.payType, PAY_TYPES, "pay type") as PayType;
  const at = nowIso();
  const res = db
    .prepare(
      `INSERT INTO employee_sessions
         (uuid, org_id, employee_id, project_id, project_name, task_id, pay_type, rate_at_start,
          note, started_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      generateUUIDv7(),
      orgId,
      employeeId,
      vId(input?.projectId, "project id"),
      vString(input?.projectName, "project name", 200, true).trim(),
      vNullableId(input?.taskId, "task id"),
      payType,
      vAmount(input?.rateAtStart, "rate"),
      vNullableString(input?.note, "note", 2000),
      at,
      at
    );
  return getSession(db, Number(res.lastInsertRowid));
}

/**
 * Stops the clock and FILES THE WORK.
 *
 * Order matters and is deliberate: the entry is created FIRST, and only once it exists is the
 * session stamped as ended. If createEntry throws — a validator, a CHECK, a full disk — the session
 * stays OPEN and no time is lost; the caller sees the error and can try again. The reverse order
 * would close the session and drop the hours on the floor.
 *
 * Both writes run in ONE transaction, so a failure anywhere leaves neither.
 */
export function stopSession(db: Db, orgId: string, sessionId: number, note?: unknown): { session: Session; entry: Entry } {
  const session = getSession(db, vId(sessionId, "session id"));
  if (session.ended_at) throw new Error("That timer has already been stopped.");
  const endedAt = nowIso();
  const hours = elapsedHours(session.started_at, endedAt);
  // A note typed at stop wins over one typed at start — it is the later, better-informed one.
  const finalNote = note == null ? session.note : vNullableString(note, "note", 2000);

  // BEFORE the transaction, deliberately. A timed per-job/per-task session has no agreed amount to
  // carry, and entries.ts REQUIRES one for those types. Refusing here leaves the session OPEN and
  // nothing written; refusing after the transaction would file the entry and then throw, which is
  // the worst of both. Unreachable through the shipped user interface — the card refuses to start
  // a flat-rate timer — and kept as a named failure rather than a silent wrong number.
  if (session.pay_type === "job" || session.pay_type === "task") {
    throw new Error("A per-job or per-task timer needs its agreed amount — log that work with Add Time instead.");
  }

  const entry = db.transaction(() => {
    const created = createEntry(db, orgId, {
      employeeId: session.employee_id,
      projectId: session.project_id,
      projectName: session.project_name,
      taskId: session.task_id,
      payType: session.pay_type,
      hoursWorked: hours,
      rateAtEntry: session.rate_at_start, // captured at start — a mid-session raise cannot reach it
      flatAmount: null, // hourly/donated only by the guard above; entries.ts requires null for both
      workedOn: localDateOf(session.started_at), // the date the work STARTED, not the date it ended
      note: finalNote,
    });
    db.prepare(`UPDATE employee_sessions SET ended_at = ?, note = ?, updated_at = ? WHERE id = ?`).run(
      endedAt,
      finalNote,
      endedAt,
      session.id
    );
    return created;
  })();

  return { session: getSession(db, session.id), entry };
}

/** Cancels a running session WITHOUT filing an entry — started by mistake, no work done. The row is
    kept with ended_at set and a marker note, so a cancelled clock is still auditable. */
export function cancelSession(db: Db, sessionId: number): Session {
  const session = getSession(db, vId(sessionId, "session id"));
  if (session.ended_at) throw new Error("That timer has already been stopped.");
  const at = nowIso();
  db.prepare(`UPDATE employee_sessions SET ended_at = ?, note = ?, updated_at = ? WHERE id = ?`).run(
    at,
    session.note ? `${session.note} (cancelled — no time filed)` : "cancelled — no time filed",
    at,
    session.id
  );
  return getSession(db, session.id);
}

/** By uuid, for a caller that holds the public locator rather than the row id. */
export function getSessionByUuid(db: Db, uuid: unknown): Session {
  const row = db.prepare(`SELECT * FROM employee_sessions WHERE uuid = ?`).get(vUuid(uuid, "session id")) as
    | Session
    | undefined;
  if (!row) throw new Error("Session not found");
  return row;
}
