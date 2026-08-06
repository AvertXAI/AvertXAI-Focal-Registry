// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Project COMPLETION — the lock (Jason ruled 08-06-2026). Completing a job sets
//              status='done' AND stamps completed_at (ruling 1: both), after which EVERY write
//              path in BOTH modules refuses through the ONE guard below (ruling 2: sixteen paths,
//              service-side). There are no corrections on a completed project — reactivate,
//              correct, complete again (ruling 3). Complete and archive are SEPARATE flags with
//              separate meanings (ruling 4): archiving still hides and still counts as wasted;
//              completing hides nothing and keeps counting in Analytics (ruling 7).
//
//              THE GUARD IS THE LOCK. assertNotCompleted() is called at the top of every mutating
//              service path that touches a project or its children — one function, one sentence,
//              one place to audit. Paths that mutate by child id (cost id, item id, adjustment
//              uuid, task id, session id) resolve the parent project FIRST and refuse here.
//              Electron-free, imports nothing beyond the Db type, so the Employees services can
//              import it without a cycle (the reverse of projectFinancials → employees/reports,
//              the standing cross-module arrangement — one database, one connection).
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/timetracker/completion.ts
//------------------------------------------------------------
import { nowIso, type Db } from "./db";

/**
 * The one lock check. Refuses with a plain sentence when the project is completed; silently
 * returns when the project does not exist so the caller's own "not found" error keeps its name.
 * null/undefined projectId (an employees row not tied to a project) passes — no project, no lock.
 */
export function assertNotCompleted(db: Db, projectId: number | null | undefined): void {
  if (projectId == null) return;
  const row = db.prepare(`SELECT name, completed_at FROM timetracker_projects WHERE id = ?`).get(projectId) as
    | { name: string; completed_at: string | null }
    | undefined;
  if (!row) return;
  if (row.completed_at) {
    throw new Error(
      `"${row.name}" is completed and locked — nothing on it can change. Reactivate it from the Completed tab first.`
    );
  }
}

/**
 * Complete the job: status='done' + completed_at stamped, one deliberate action. Refuses while a
 * live timer runs on the project (the archiveProject precedent — a session that later stops would
 * have to write a time entry into a locked project). An open EMPLOYEE session is allowed to exist:
 * its stop path refuses and leaves the clock running (sessions.ts order guarantee), so no time is
 * ever lost — reactivate, stop, complete again.
 */
export function completeProject(db: Db, id: number): void {
  const row = db.prepare(`SELECT name, completed_at FROM timetracker_projects WHERE id = ?`).get(id) as
    | { name: string; completed_at: string | null }
    | undefined;
  if (!row) throw new Error(`Project ${id} not found`);
  if (row.completed_at) throw new Error(`"${row.name}" is already completed.`);
  const live = db.prepare(`SELECT id FROM timetracker_active_sessions WHERE project_id = ?`).get(id);
  if (live) throw new Error("Stop the running timer on this project first");
  db.prepare(
    `UPDATE timetracker_projects SET status = 'done', completed_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(nowIso(), id);
}

/** Activate (the Completed tab's word): back to editable. Clears completed_at, status back to
    'active'. The invoice number, if one was ever allocated, stays — re-export reproduces it. */
export function reactivateProject(db: Db, id: number): void {
  const row = db.prepare(`SELECT completed_at FROM timetracker_projects WHERE id = ?`).get(id) as
    | { completed_at: string | null }
    | undefined;
  if (!row) throw new Error(`Project ${id} not found`);
  if (!row.completed_at) return; // already active — idempotent, like restoreProject
  db.prepare(
    `UPDATE timetracker_projects SET status = 'active', completed_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(id);
}
