// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: MindMerge read API — the query surface the UI wires to later. Read-only by
//              construction (SELECT only). Filter keys are whitelisted and the FTS query is escaped
//              so renderer-supplied input can't break out into SQL / FTS operators.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/mindmerge/api.ts
//------------------------------------------------------------
import type { Db } from "./db";

export interface NoteRow {
  id: number;
  uuid: string;
  note_id: string | null;
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
export type NoteFilter = Partial<Record<(typeof FILTERABLE)[number], string>>;

export function listNotes(db: Db, filter: NoteFilter = {}): NoteRow[] {
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
    .prepare(`SELECT * FROM mindmerge_notes ${where} ORDER BY updated_at DESC, id DESC`)
    .all(...params) as NoteRow[];
}

export function getNote(db: Db, noteId: string): NoteRow | undefined {
  return db.prepare("SELECT * FROM mindmerge_notes WHERE note_id = ?").get(noteId) as NoteRow | undefined;
}

// Turn a free-text query into a safe FTS5 PREFIX match. ALL punctuation acts as whitespace —
// the unicode61 tokenizer splits on every non-letter/non-digit, so mirroring it exactly keeps
// renderer input from ever reaching FTS operators. Each term becomes a quoted prefix ("term"*),
// AND-combined by space. "happy" therefore matches "happysmiles"; a punctuation-only query
// sanitizes to no terms (no MATCH ran).
//
// THE JOINED FORM RIDES ALONG (Jason 08-26-2026: "builders-audit" must find BUILDERSAUDIT).
// A concatenated name is ONE token to the tokenizer, so the AND of its parts ("builders"* AND
// "audit"*) can never reach it — the parts' concatenation is OR'd in as its own prefix. FTS5
// binds AND tighter than OR, so the query reads (every part) OR (the joined name).
function ftsQuery(query: string): string {
  const terms = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (terms.length === 0) return "";
  const anded = terms.map((term) => `"${term}"*`).join(" ");
  return terms.length > 1 ? `${anded} OR "${terms.join("")}"*` : anded;
}

export function search(db: Db, query: string): NoteRow[] {
  const match = ftsQuery(query);
  if (!match) return [];
  return db
    .prepare(
      `SELECT r.* FROM mindmerge_fts f
       JOIN mindmerge_notes r ON r.id = f.rowid
       WHERE mindmerge_fts MATCH ?
       ORDER BY rank`
    )
    .all(match) as NoteRow[];
}

export function listQuarantined(db: Db): NoteRow[] {
  return db
    .prepare("SELECT * FROM mindmerge_notes WHERE parse_status = 'error' ORDER BY updated_at DESC, id DESC")
    .all() as NoteRow[];
}
