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
import { resolveTier } from "../licensing";
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

export function getRows(table: unknown, limit: unknown, offset: unknown, sortColumn?: unknown, sortDir?: unknown): DbRowsPage {
  const t = safeTable(table);
  const lim = Math.min(Math.max(Math.floor(Number(limit)) || 50, 1), 500); // clamp 1..500
  const off = Math.max(Math.floor(Number(offset)) || 0, 0);
  const cols = getColumns(t);
  // ORDER BY only on a WHITELISTED real column (SQLite can't bind identifiers) + a fixed direction —
  // same safe pattern as the table name. An unknown column just drops the sort (no throw).
  let order = "";
  if (typeof sortColumn === "string" && cols.some((c) => c.name === sortColumn)) {
    const dir = String(sortDir).toUpperCase() === "DESC" ? "DESC" : "ASC";
    order = ` ORDER BY "${sortColumn}" ${dir}`;
  }
  const rows = db().prepare(`SELECT * FROM "${t}"${order} LIMIT ? OFFSET ?`).all(lim, off) as Record<string, unknown>[];
  return { columns: cols.map((c) => c.name), rows, total: rowCount(t) };
}

/** Outgoing FK references — used this build only for the destruction-guard message text. */
export function getForeignKeys(table: unknown): DbForeignKey[] {
  const t = safeTable(table);
  const fks = db().prepare(`PRAGMA foreign_key_list("${t}")`).all() as { table: string; from: string; to: string }[];
  return fks.map((f) => ({ table: f.table, from: f.from, to: f.to }));
}

// ---- dev-mode flag (persisted in app_settings; writes -> shared read-write getDb()) ----
// EASTER-EGG UNLOCK (Jason ruled 08-06-2026, B6): the plain Settings toggle is GONE. Ten clicks on
// the leaf glyph in Settings unlock developer mode; once unlocked it STAYS unlocked — the ONLY
// thing that re-locks it is an app update. That rule is structural here: the stored value is the
// APP VERSION at unlock time, and getDevMode() compares it to the running version. A version
// mismatch = an update happened = locked again, with no timer, no counter, no second flag.
// Legacy "true" values (the pre-egg toggle) never match a version string, so they read as locked.
let runningVersion = "dev"; // injected at IPC registration; "dev" only in harnesses

export function setRunningVersion(v: string): void {
  runningVersion = v;
}

/**
 * ROOT IS ALWAYS IN DEVELOPER MODE (Jason 08-22-2026: "i entered the root password, and im not seeing
 * the package tab in the secured vault… for root, i should have access to everything in the app").
 *
 * He was right that it was broken, and the reason is that these were two unrelated switches: the
 * Package ledger, the raw row writes and the process monitor all gate on THIS function, which knew
 * nothing about tiers, so a Root licence could not reach any of them. Entitlements SOP §8 already
 * rules that "a feature Root cannot reach is a defect", so the fix belongs here rather than in each
 * of the eight call sites — one chokepoint, every dev surface, no per-surface exceptions to forget.
 *
 * The easter-egg path below is untouched and still governs every other tier: ten clicks on the leaf
 * glyph in Settings, re-locked by an app update. Root skips it because Root is never sold — it is the
 * founder's own install, and it grants raw database row edits along with everything else.
 */
export function getDevMode(): boolean {
  if (resolveTier(getDb()) === "root") return true;
  const row = getDb().prepare(`SELECT value FROM app_settings WHERE key = 'dataviewer_dev_mode'`).get() as
    | { value: string }
    | undefined;
  return row?.value === runningVersion;
}

export function setDevMode(on: boolean): void {
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value) VALUES ('dataviewer_dev_mode', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(on ? runningVersion : "off");
}

// ---- DEVELOPER-MODE WRITES (A3, 08-06) — the modal's Edit/Delete stubs become real. ------------
// The safety pattern is the READ path's own, mirrored exactly: a renderer-supplied table name is
// whitelisted via safeTable, COLUMN names are whitelisted against PRAGMA table_info, identifiers
// are quoted only after verification, and every VALUE travels as a bound parameter — no
// string-concatenated SQL anywhere. Both writes are gated on Developer mode IN THE SERVICE, so a
// forged IPC call cannot write with the toggle off.
//
// THERE IS NO DATA VIEWER ACTION LOG — verified before building (grep for any dv/audit log:
// NOT FOUND), and per the instruction none was invented. Edits and deletes here are deliberately
// raw: they bypass every validator and money rule, which is exactly what the confirm says.

function assertDevMode(): void {
  if (!getDevMode()) throw new Error("Developer mode is off — switch it on in the Data Viewer to edit rows.");
}

/** The row's PK column + verified columns, shared by both writes. */
function writeTarget(table: unknown): { t: string; cols: DbColumn[]; pk: DbColumn } {
  const t = safeTable(table);
  const cols = getColumns(t);
  const pk = cols.find((c) => c.pk);
  if (!pk) throw new Error(`"${t}" has no primary key — rows here cannot be addressed safely.`);
  return { t, cols, pk };
}

/** Coerce a typed-in string by the column's DECLARED type, so a REAL column gets a number bound to
    it rather than the string "42" silently changing the column's affinity story. A non-numeric
    string aimed at a numeric column refuses rather than guessing. null passes through as null. */
function coerce(col: DbColumn, value: unknown): unknown {
  if (value === null) return null;
  const declared = col.type.toUpperCase();
  if (/INT|REAL|NUMERIC|DOUBLE|FLOAT/.test(declared)) {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error(`"${col.name}" is ${col.type || "numeric"} — "${String(value)}" is not a number.`);
    return n;
  }
  return String(value);
}

/** Updates ONE row by primary key. Only columns that exist may be set; the PK itself may not. */
export function updateRow(table: unknown, pkValue: unknown, changes: Record<string, unknown>): { changed: number } {
  assertDevMode();
  const { t, cols, pk } = writeTarget(table);
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [name, raw] of Object.entries(changes ?? {})) {
    const col = cols.find((c) => c.name === name);
    if (!col) throw new Error(`Unknown column "${name}" on "${t}".`);
    if (col.pk) throw new Error("The primary key is the row's identity — it cannot be edited.");
    sets.push(`"${col.name}" = ?`);
    values.push(coerce(col, raw));
  }
  if (sets.length === 0) return { changed: 0 };
  const res = db().prepare(`UPDATE "${t}" SET ${sets.join(", ")} WHERE "${pk.name}" = ?`).run(...values, pkValue);
  return { changed: res.changes };
}

/** Deletes ONE row by primary key. The renderer's confirm names the table and key; this end just
    refuses to touch more than one row's worth of identity. */
export function deleteRow(table: unknown, pkValue: unknown): { changed: number } {
  assertDevMode();
  const { t, pk } = writeTarget(table);
  const res = db().prepare(`DELETE FROM "${t}" WHERE "${pk.name}" = ?`).run(pkValue);
  return { changed: res.changes };
}
