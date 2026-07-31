// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Append-only timetracker_event_log writer/reader — the action history behind the
//              Activity tab. INSERT-only: never updated, never deleted; project_name is captured
//              at write time so the log survives a rename/archive/purge (soft project_id, no FK).
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/timetracker/eventLog.ts
//------------------------------------------------------------
import { generateUUIDv7 } from "../utils/uuidv7";
import { nowIso, type Db } from "./db";
import type { ActivityQuery, EventLogRow, EventType } from "./types";

export interface LogEventInput {
  type: EventType;
  projectId: number | null;
  projectName: string;
  detail?: string | null;
}

export function logEvent(db: Db, orgId: string, input: LogEventInput): void {
  db.prepare(
    `INSERT INTO timetracker_event_log (uuid, org_id, ts, event_type, project_id, project_name, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(generateUUIDv7(), orgId, nowIso(), input.type, input.projectId, input.projectName, input.detail ?? null, nowIso());
}

/** Newest first. id DESC (monotonic rowid) avoids same-millisecond ts ties. */
export function listEvents(db: Db, orgId: string, opts: ActivityQuery = {}): EventLogRow[] {
  const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? 500)), 5000);
  if (opts.projectId != null) {
    return db
      .prepare(`SELECT * FROM timetracker_event_log WHERE org_id = ? AND project_id = ? ORDER BY id DESC LIMIT ?`)
      .all(orgId, opts.projectId, limit) as EventLogRow[];
  }
  return db
    .prepare(`SELECT * FROM timetracker_event_log WHERE org_id = ? ORDER BY id DESC LIMIT ?`)
    .all(orgId, limit) as EventLogRow[];
}
