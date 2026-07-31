// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: TimeTracker manual time adjustments — create/edit/soft-delete with an append-only
//              audit log; NEVER touches time_entries. The std uuid column is the public id.
//              Adjustments are never tier-capped — they exist to correct history.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/timetracker/adjustments.ts
//------------------------------------------------------------
import { generateUUIDv7 } from "../utils/uuidv7";
import { nowIso, type Db } from "./db";
import type { Adjustment, AdjustmentListItem, AuditEntry } from "./types";

interface AdjustmentRow extends Omit<Adjustment, "audit_log"> {
  audit_log: string;
}
interface ListRow extends AdjustmentRow {
  project_name: string;
  project_color: string;
}

function parse(row: AdjustmentRow): Adjustment {
  return { ...row, audit_log: JSON.parse(row.audit_log) as AuditEntry[] };
}
function parseList(row: ListRow): AdjustmentListItem {
  return { ...row, audit_log: JSON.parse(row.audit_log) as AuditEntry[] };
}

const LIST_SQL = `
  SELECT a.*, p.name AS project_name, p.color AS project_color
  FROM timetracker_adjustments a JOIN timetracker_projects p ON p.id = a.project_id
`;

/** A project's adjustments (incl. soft-deleted, for the struck-through audit view), newest first. */
export function list(db: Db, projectId: number): AdjustmentListItem[] {
  return (
    db.prepare(`${LIST_SQL} WHERE a.project_id = ? ORDER BY a.created_at DESC, a.id DESC`).all(projectId) as ListRow[]
  ).map(parseList);
}

export function listAll(db: Db, orgId: string): AdjustmentListItem[] {
  return (
    db.prepare(`${LIST_SQL} WHERE a.org_id = ? ORDER BY a.created_at DESC, a.id DESC`).all(orgId) as ListRow[]
  ).map(parseList);
}

/** Non-deleted adjustments for a project (drives the totals rollup + detail summary). */
export function listActive(db: Db, projectId: number): Adjustment[] {
  return (
    db
      .prepare(
        `SELECT * FROM timetracker_adjustments WHERE project_id = ? AND deleted_at IS NULL ORDER BY created_at DESC, id DESC`
      )
      .all(projectId) as AdjustmentRow[]
  ).map(parse);
}

function getOne(db: Db, uuid: string): AdjustmentListItem {
  const row = db.prepare(`${LIST_SQL} WHERE a.uuid = ?`).get(uuid) as ListRow | undefined;
  if (!row) throw new Error(`Adjustment ${uuid} not found`);
  return parseList(row);
}

function validate(deltaMinutes: number, note: string): { delta: number; note: string } {
  if (!Number.isInteger(deltaMinutes) || deltaMinutes === 0)
    throw new Error("Adjustment amount must be a non-zero number of minutes");
  const trimmed = note.trim();
  if (!trimmed) throw new Error("A note explaining the adjustment is required");
  return { delta: deltaMinutes, note: trimmed };
}

export function create(db: Db, orgId: string, projectId: number, deltaMinutes: number, note: string): AdjustmentListItem {
  if (!db.prepare(`SELECT id FROM timetracker_projects WHERE id = ?`).get(projectId))
    throw new Error(`Project ${projectId} not found`);
  const { delta, note: cleanNote } = validate(deltaMinutes, note);
  const uuid = generateUUIDv7();
  const at = nowIso();
  const audit: AuditEntry[] = [{ action: "created", at, delta_minutes: delta, note: cleanNote }];
  db.prepare(
    `INSERT INTO timetracker_adjustments (uuid, org_id, project_id, delta_minutes, note, deleted_at, audit_log, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`
  ).run(uuid, orgId, projectId, delta, cleanNote, JSON.stringify(audit), at, at);
  return getOne(db, uuid);
}

/** Edits live values AND appends a before/after entry to the audit log (never rewrites history). */
export function update(db: Db, uuid: string, deltaMinutes: number, note: string): AdjustmentListItem {
  const existing = db.prepare(`SELECT * FROM timetracker_adjustments WHERE uuid = ?`).get(uuid) as
    | AdjustmentRow
    | undefined;
  if (!existing) throw new Error(`Adjustment ${uuid} not found`);
  if (existing.deleted_at) throw new Error("Cannot edit a deleted adjustment");
  const { delta, note: cleanNote } = validate(deltaMinutes, note);
  const at = nowIso();
  const audit = JSON.parse(existing.audit_log) as AuditEntry[];
  audit.push({
    action: "edited",
    at,
    from: { delta_minutes: existing.delta_minutes, note: existing.note },
    to: { delta_minutes: delta, note: cleanNote },
  });
  db.prepare(`UPDATE timetracker_adjustments SET delta_minutes = ?, note = ?, updated_at = ?, audit_log = ? WHERE uuid = ?`).run(
    delta,
    cleanNote,
    at,
    JSON.stringify(audit),
    uuid
  );
  return getOne(db, uuid);
}

/** Soft delete: sets deleted_at, appends a delete entry; the row is never hard-removed. */
export function softDelete(db: Db, uuid: string): void {
  const existing = db.prepare(`SELECT * FROM timetracker_adjustments WHERE uuid = ?`).get(uuid) as
    | AdjustmentRow
    | undefined;
  if (!existing) throw new Error(`Adjustment ${uuid} not found`);
  if (existing.deleted_at) return;
  const at = nowIso();
  const audit = JSON.parse(existing.audit_log) as AuditEntry[];
  audit.push({ action: "deleted", at });
  db.prepare(`UPDATE timetracker_adjustments SET deleted_at = ?, updated_at = ?, audit_log = ? WHERE uuid = ?`).run(
    at,
    at,
    JSON.stringify(audit),
    uuid
  );
}
