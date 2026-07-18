// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: RunBooks — AvertXAI platform shell (baseplate)
// Description: Scout Viewer target CRUD — the user-editable browse-target list (scout_targets in
//              the shared org DB; replaces the module's hardcoded client array). IPC boundary:
//              every arg arrives as unknown and is validated here before touching SQL. URLs pass
//              the engine's http(s)-only normalizeHttpUrl gate; client_id is AUTO-MINTED (UUIDv7)
//              at create and immutable forever after — it keys the persist:client_<id> session
//              partition, so changing it would silently log the user out of that target.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/scout-viewer/targets.ts
//------------------------------------------------------------
import { getDb } from "../db";
import { generateUUIDv7 } from "../utils/uuidv7";
import { normalizeHttpUrl } from "./index";

export interface ScoutTargetRow {
  id: number;
  uuid: string;
  name: string;
  url: string;
  client_id: string;
  display_order: number;
  created_at: string;
  updated_at: string | null;
}

function cleanName(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim() === "") throw new Error("Target name must be a non-empty string");
  return raw.trim();
}

function cleanUrl(raw: unknown): string {
  const url = normalizeHttpUrl(raw); // bare host → https://; anything non-http(s) → null
  if (!url) throw new Error("Target URL must be http(s)");
  return url;
}

function cleanId(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isInteger(raw)) throw new Error("Target id must be an integer");
  return raw;
}

export function listTargets(): ScoutTargetRow[] {
  return getDb()
    .prepare("SELECT * FROM scout_targets ORDER BY display_order, id")
    .all() as ScoutTargetRow[];
}

export function createTarget(name: unknown, url: unknown): ScoutTargetRow {
  const db = getDb();
  const n = cleanName(name);
  const u = cleanUrl(url);
  const order = (db.prepare("SELECT COALESCE(MAX(display_order) + 1, 0) AS o FROM scout_targets").get() as {
    o: number;
  }).o;
  const uuid = generateUUIDv7();
  // client_id minted here, never editable — the user only ever supplies name + URL.
  db.prepare("INSERT INTO scout_targets (uuid, name, url, client_id, display_order) VALUES (?, ?, ?, ?, ?)").run(
    uuid,
    n,
    u,
    generateUUIDv7(),
    order
  );
  return db.prepare("SELECT * FROM scout_targets WHERE uuid = ?").get(uuid) as ScoutTargetRow;
}

export function updateTarget(id: unknown, name: unknown, url: unknown): ScoutTargetRow {
  const db = getDb();
  const rowId = cleanId(id);
  const n = cleanName(name);
  const u = cleanUrl(url);
  // client_id deliberately absent from the SET list — immutable (see header).
  db.prepare("UPDATE scout_targets SET name = ?, url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
    n,
    u,
    rowId
  );
  const row = db.prepare("SELECT * FROM scout_targets WHERE id = ?").get(rowId) as ScoutTargetRow | undefined;
  if (!row) throw new Error("Target not found");
  return row;
}

export function deleteTarget(id: unknown): void {
  getDb().prepare("DELETE FROM scout_targets WHERE id = ?").run(cleanId(id));
}
