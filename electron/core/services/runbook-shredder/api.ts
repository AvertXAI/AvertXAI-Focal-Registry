// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Runbook Shredder read API — the query surface the UI wires to later. Read-only by
//              construction (SELECT only). Filter keys are whitelisted and the FTS query is escaped
//              so renderer-supplied input can't break out into SQL / FTS operators.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/runbook-shredder/api.ts
//------------------------------------------------------------
import type { Db } from "./db";

export interface RunbookRow {
  id: number;
  uuid: string;
  runbook_id: string | null;
  title: string | null;
  type: string | null;
  status: string | null;
  severity: string | null;
  owner: string | null;
  client: string | null;
  description: string | null;
  service: string | null;
  trigger: string | null;
  version: string | null;
  updated: string | null;
  body_md: string | null;
  tags_flat: string | null;
  file_path: string;
  parse_status: "ok" | "error";
  parse_error: string | null;
  created_at: string;
  updated_at: string | null;
}

// Equality filters the UI can pass; anything outside this set is ignored (no arbitrary columns).
const FILTERABLE = ["status", "type", "severity", "parse_status", "client", "owner", "service"] as const;
export type RunbookFilter = Partial<Record<(typeof FILTERABLE)[number], string>>;

export function listRunbooks(db: Db, filter: RunbookFilter = {}): RunbookRow[] {
  const clauses: string[] = [];
  const params: string[] = [];
  for (const key of FILTERABLE) {
    const val = filter[key];
    if (val != null) {
      clauses.push(`"${key}" = ?`);
      params.push(val);
    }
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db
    .prepare(`SELECT * FROM runbooks ${where} ORDER BY updated_at DESC, id DESC`)
    .all(...params) as RunbookRow[];
}

export function getRunbook(db: Db, runbookId: string): RunbookRow | undefined {
  return db.prepare("SELECT * FROM runbooks WHERE runbook_id = ?").get(runbookId) as RunbookRow | undefined;
}

// Turn a free-text query into a safe FTS5 PREFIX match: quote/operator chars (" * ( ) : ^ -) act
// as whitespace — mirroring how the tokenizer splits them, so "runbook-shredder" still finds both
// tokens — then each remaining term becomes a quoted prefix ("term"*), AND-combined by space.
// "happy" therefore matches "happysmiles"; a lone quote/operator sanitizes to no terms (no MATCH ran).
function ftsQuery(query: string): string {
  return query
    .replace(/["*():^-]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term}"*`)
    .join(" ");
}

export function search(db: Db, query: string): RunbookRow[] {
  const match = ftsQuery(query);
  if (!match) return [];
  return db
    .prepare(
      `SELECT r.* FROM runbooks_fts f
       JOIN runbooks r ON r.id = f.rowid
       WHERE runbooks_fts MATCH ?
       ORDER BY rank`
    )
    .all(match) as RunbookRow[];
}

export function listQuarantined(db: Db): RunbookRow[] {
  return db
    .prepare("SELECT * FROM runbooks WHERE parse_status = 'error' ORDER BY updated_at DESC, id DESC")
    .all() as RunbookRow[];
}
