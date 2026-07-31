// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: TimeTracker per-project hard-cost line items (domains/server/cloud) — CRUD +
//              face-value sums. Ported 1:1 from the standalone engine. Tier caps (Phase 6)
//              will gate add(); adjustments are never capped.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/timetracker/costs.ts
//------------------------------------------------------------
import { generateUUIDv7 } from "../utils/uuidv7";
import { nowIso, type Db } from "./db";
import type { Cost, CostInput } from "./types";

export function list(db: Db, projectId: number): Cost[] {
  return db.prepare(`SELECT * FROM timetracker_costs WHERE project_id = ? ORDER BY id ASC`).all(projectId) as Cost[];
}

export function add(db: Db, orgId: string, projectId: number, input: CostInput): Cost {
  const res = db
    .prepare(
      `INSERT INTO timetracker_costs (uuid, org_id, project_id, label, category, amount, recurrence, url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      generateUUIDv7(),
      orgId,
      projectId,
      input.label.trim(),
      input.category.trim(),
      input.amount,
      input.recurrence,
      input.url.trim() || null,
      nowIso()
    );
  return db.prepare(`SELECT * FROM timetracker_costs WHERE id = ?`).get(Number(res.lastInsertRowid)) as Cost;
}

export function update(db: Db, id: number, input: CostInput): Cost {
  const res = db
    .prepare(
      `UPDATE timetracker_costs SET label = ?, category = ?, amount = ?, recurrence = ?, url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    )
    .run(input.label.trim(), input.category.trim(), input.amount, input.recurrence, input.url.trim() || null, id);
  if (res.changes === 0) throw new Error(`Cost ${id} not found`);
  return db.prepare(`SELECT * FROM timetracker_costs WHERE id = ?`).get(id) as Cost;
}

export function remove(db: Db, id: number): void {
  db.prepare(`DELETE FROM timetracker_costs WHERE id = ?`).run(id);
}

export function getUrl(db: Db, id: number): string | null {
  const row = db.prepare(`SELECT url FROM timetracker_costs WHERE id = ?`).get(id) as { url: string | null } | undefined;
  return row?.url ?? null;
}
