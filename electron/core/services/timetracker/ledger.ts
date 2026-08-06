// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: TimeTracker append-only value-ledger — set/update preserving previous_amount, plus
//              the typed-confirmation nuke paths. An update inserts a NEW row; history is never
//              overwritten. Ported 1:1 from the standalone engine.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/timetracker/ledger.ts
//------------------------------------------------------------
import { generateUUIDv7 } from "../utils/uuidv7";
import { nowIso, type Db } from "./db";
import { assertNotCompleted } from "./completion";
import type { LedgerEntry } from "./types";

export function list(db: Db, projectId: number): LedgerEntry[] {
  return db
    .prepare(`SELECT * FROM timetracker_value_ledger WHERE project_id = ? ORDER BY id ASC`)
    .all(projectId) as LedgerEntry[];
}

/** Append-only: an update inserts a NEW row carrying previous_amount — history is never overwritten. */
export function add(db: Db, orgId: string, projectId: number, amount: number, note: string | null): LedgerEntry {
  assertNotCompleted(db, projectId);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Amount must be a non-negative number");
  const latest = db
    .prepare(`SELECT amount FROM timetracker_value_ledger WHERE project_id = ? ORDER BY id DESC LIMIT 1`)
    .get(projectId) as { amount: number } | undefined;
  const res = db
    .prepare(
      `INSERT INTO timetracker_value_ledger (uuid, org_id, project_id, amount, previous_amount, action, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      generateUUIDv7(),
      orgId,
      projectId,
      amount,
      latest ? latest.amount : null,
      latest ? "update" : "set",
      note?.trim() || null,
      nowIso()
    );
  return db.prepare(`SELECT * FROM timetracker_value_ledger WHERE id = ?`).get(Number(res.lastInsertRowid)) as LedgerEntry;
}

export function nukeEntry(db: Db, id: number): void {
  db.prepare(`DELETE FROM timetracker_value_ledger WHERE id = ?`).run(id);
}

export function nukeAll(db: Db, projectId: number): void {
  db.prepare(`DELETE FROM timetracker_value_ledger WHERE project_id = ?`).run(projectId);
}
