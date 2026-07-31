// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: TimeTracker group logic — one level only (group -> projects), find-or-create by
//              name, sidebar reorder + one-time alphabetical sort. The remembered sort direction
//              is a main-side app_settings key (timetracker.sidebar_sort) written through this
//              service only — never a renderer-direct write.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/timetracker/groups.ts
//------------------------------------------------------------
import { generateUUIDv7 } from "../utils/uuidv7";
import { nowIso, type Db } from "./db";
import type { Group, SidebarSortDir } from "./types";

export function listGroups(db: Db, orgId: string): Group[] {
  return db
    .prepare(`SELECT * FROM timetracker_groups WHERE org_id = ? ORDER BY sort_order ASC, name ASC`)
    .all(orgId) as Group[];
}

/** Find-or-create by name (case-insensitive) — used by the modal's inline create. */
export function createGroup(db: Db, orgId: string, name: string, color: string): Group {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Group name is required");
  const existing = db
    .prepare(`SELECT * FROM timetracker_groups WHERE name = ? COLLATE NOCASE`)
    .get(trimmed) as Group | undefined;
  if (existing) return existing;
  const maxOrder = db.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM timetracker_groups`).get() as { m: number };
  const res = db
    .prepare(
      `INSERT INTO timetracker_groups (uuid, org_id, name, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(generateUUIDv7(), orgId, trimmed, color, maxOrder.m + 1, nowIso());
  return db.prepare(`SELECT * FROM timetracker_groups WHERE id = ?`).get(Number(res.lastInsertRowid)) as Group;
}

export function getGroup(db: Db, id: number): Group | undefined {
  return db.prepare(`SELECT * FROM timetracker_groups WHERE id = ?`).get(id) as Group | undefined;
}

export function renameGroup(db: Db, id: number, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Group name is required");
  const res = db
    .prepare(`UPDATE timetracker_groups SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(trimmed, id);
  if (res.changes === 0) throw new Error(`Group ${id} not found`);
}

/**
 * Reorder a group among its siblings: move it before beforeGroupId (or to the end
 * when null), rewriting sort_order only. Any manual drag flips the persisted
 * sidebar sort back to "none" (custom order wins until a sort icon is clicked).
 */
export function reorderGroup(db: Db, id: number, beforeGroupId: number | null): void {
  if (!db.prepare(`SELECT id FROM timetracker_groups WHERE id = ?`).get(id)) throw new Error(`Group ${id} not found`);
  const ids = (
    db.prepare(`SELECT id FROM timetracker_groups ORDER BY sort_order ASC, name ASC`).all() as { id: number }[]
  ).map((r) => r.id);
  const without = ids.filter((gid) => gid !== id);
  let insertAt = without.length;
  if (beforeGroupId != null) {
    const idx = without.indexOf(beforeGroupId);
    if (idx === -1) throw new Error(`Group ${beforeGroupId} not found`);
    insertAt = idx;
  }
  without.splice(insertAt, 0, id);
  const write = db.prepare(`UPDATE timetracker_groups SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);
  const tx = db.transaction(() => {
    without.forEach((gid, i) => write.run(i + 1, gid));
    setSidebarSort(db, "none");
  });
  tx();
}

/** The remembered sidebar sort direction — a main-side app_settings key, no migration. */
export function getSidebarSort(db: Db): SidebarSortDir {
  const row = db.prepare(`SELECT value FROM app_settings WHERE key = 'timetracker.sidebar_sort'`).get() as
    | { value: string }
    | undefined;
  return row?.value === "asc" || row?.value === "desc" ? row.value : "none";
}

export function setSidebarSort(db: Db, dir: SidebarSortDir): void {
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES ('timetracker.sidebar_sort', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(dir);
}

/**
 * One-time alphabetical sort of the whole sidebar: groups by name, and each group's
 * (and Ungrouped's) projects by name. Bulk-writes the SAME order fields manual drag
 * uses (sort_order / priority_order) — so the result persists and stays freely
 * draggable afterward. Touches ordering columns only; never time data.
 */
export function sortSidebarAlpha(db: Db, dir: "asc" | "desc"): void {
  const cmp = (a: string, b: string) =>
    dir === "asc"
      ? a.localeCompare(b, undefined, { sensitivity: "base" })
      : b.localeCompare(a, undefined, { sensitivity: "base" });
  const groupRows = db.prepare(`SELECT id, name FROM timetracker_groups`).all() as { id: number; name: string }[];
  const projRows = db.prepare(`SELECT id, name, group_id FROM timetracker_projects`).all() as {
    id: number;
    name: string;
    group_id: number | null;
  }[];
  const writeGroup = db.prepare(`UPDATE timetracker_groups SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);
  const writeProj = db.prepare(`UPDATE timetracker_projects SET priority_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);
  const tx = db.transaction(() => {
    [...groupRows].sort((a, b) => cmp(a.name, b.name)).forEach((g, i) => writeGroup.run(i + 1, g.id));
    const byFolder = new Map<number | null, typeof projRows>();
    for (const p of projRows) {
      const k = p.group_id ?? null;
      if (!byFolder.has(k)) byFolder.set(k, []);
      byFolder.get(k)!.push(p);
    }
    for (const items of byFolder.values()) {
      items.sort((a, b) => cmp(a.name, b.name)).forEach((p, i) => writeProj.run(i + 1, p.id));
    }
    setSidebarSort(db, dir);
  });
  tx();
}

/** Deletes the folder only — its projects move to Ungrouped (group_id = NULL). */
export function deleteGroup(db: Db, id: number): void {
  const tx = db.transaction(() => {
    db.prepare(`UPDATE timetracker_projects SET group_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE group_id = ?`).run(id);
    db.prepare(`DELETE FROM timetracker_groups WHERE id = ?`).run(id);
  });
  tx();
}
