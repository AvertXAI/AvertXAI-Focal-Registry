// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Append-only employee_event_log writer/reader — the action history behind the
//              Employees activity surface. INSERT-only: never updated, never deleted;
//              employee_name is captured at write time so the log survives a rename or archive
//              (soft employee_id, no FK). Mirrors timetracker/eventLog.ts exactly.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/employees/eventLog.ts
//------------------------------------------------------------
import { generateUUIDv7 } from "../utils/uuidv7";
import { nowIso, type Db } from "./db";
import type { ActivityQuery, EmployeeEventType, EventLogRow } from "./types";

export interface LogEventInput {
  type: EmployeeEventType;
  employeeId: number | null;
  employeeName: string;
  detail?: string | null;
}

export function logEvent(db: Db, orgId: string, input: LogEventInput): void {
  const at = nowIso();
  db.prepare(
    `INSERT INTO employee_event_log (uuid, org_id, ts, event_type, employee_id, employee_name, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(generateUUIDv7(), orgId, at, input.type, input.employeeId, input.employeeName, input.detail ?? null, at);
}

/** Newest first. id DESC (monotonic rowid) avoids same-millisecond ts ties. */
export function listEvents(db: Db, orgId: string, opts: ActivityQuery = {}): EventLogRow[] {
  const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? 500)), 5000);
  if (opts.employeeId != null) {
    return db
      .prepare(`SELECT * FROM employee_event_log WHERE org_id = ? AND employee_id = ? ORDER BY id DESC LIMIT ?`)
      .all(orgId, opts.employeeId, limit) as EventLogRow[];
  }
  return db
    .prepare(`SELECT * FROM employee_event_log WHERE org_id = ? ORDER BY id DESC LIMIT ?`)
    .all(orgId, limit) as EventLogRow[];
}
