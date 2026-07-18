// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Read-only SQLite introspection for the Data Viewer. Read-only BY CONSTRUCTION — this
//              module issues ONLY SELECT/PRAGMA statements, with every table identifier whitelisted
//              against sqlite_master before it touches SQL; there is no write/exec path here at all.
//              It reuses the shared getDb() (NOT a separate readonly handle) so the viewer always
//              sees live committed data — a WAL readonly snapshot can lag behind other connections'
//              writes, which would show the user stale rows.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/dataviewer/index.ts
//------------------------------------------------------------
import { getDb } from "../db";
import type { DbColumn, DbForeignKey, DbRowsPage, DbTable } from "../../../../src/shared/types";

// ponytail: read-only is enforced by what this file does (only SELECT/PRAGMA + whitelisted names),
// not by a connection flag — and reusing the live connection avoids the stale-snapshot bug.
function db() {
  return getDb();
}

function rowCount(table: string): number {
  // table is already whitelisted (safeTable) before this is called.
  return (db().prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get() as { c: number }).c;
}

/** All user tables (sqlite internals excluded), each with a live row count. */
export function listTables(): DbTable[] {
  const names = db()
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all() as { name: string }[];
  return names.map((n) => ({ name: n.name, rows: rowCount(n.name) }));
}

// A renderer-supplied table name must EXACTLY match a real table before it ever touches SQL.
// SQLite can't bind identifiers, so the safe pattern is: whitelist, then quote the verified name.
function safeTable(table: unknown): string {
  const names = new Set(listTables().map((t) => t.name));
  if (typeof table !== "string" || !names.has(table)) throw new Error("Unknown table");
  return table;
}

export function getColumns(table: unknown): DbColumn[] {
  const t = safeTable(table);
  const cols = db().prepare(`PRAGMA table_info("${t}")`).all() as {
    name: string;
    type: string;
    pk: number;
    notnull: number;
  }[];
  return cols.map((c) => ({ name: c.name, type: c.type || "", pk: c.pk > 0, notnull: c.notnull > 0 }));
}

export function getRows(table: unknown, limit: unknown, offset: unknown): DbRowsPage {
  const t = safeTable(table);
  const lim = Math.min(Math.max(Math.floor(Number(limit)) || 50, 1), 500); // clamp 1..500
  const off = Math.max(Math.floor(Number(offset)) || 0, 0);
  const rows = db().prepare(`SELECT * FROM "${t}" LIMIT ? OFFSET ?`).all(lim, off) as Record<string, unknown>[];
  const columns = getColumns(t).map((c) => c.name);
  return { columns, rows, total: rowCount(t) };
}

/** Outgoing FK references — used this build only for the destruction-guard message text. */
export function getForeignKeys(table: unknown): DbForeignKey[] {
  const t = safeTable(table);
  const fks = db().prepare(`PRAGMA foreign_key_list("${t}")`).all() as { table: string; from: string; to: string }[];
  return fks.map((f) => ({ table: f.table, from: f.from, to: f.to }));
}

// ---- dev-mode toggle (persisted in app_settings; writes -> shared read-write getDb()) ----
export function getDevMode(): boolean {
  const row = getDb().prepare(`SELECT value FROM app_settings WHERE key = 'dataviewer_dev_mode'`).get() as
    | { value: string }
    | undefined;
  return row?.value === "true";
}

export function setDevMode(on: boolean): void {
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value) VALUES ('dataviewer_dev_mode', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(on ? "true" : "false");
}
