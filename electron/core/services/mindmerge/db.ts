// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: MindMerge data layer — the module's OWN plain SQLite file
//              (mindmerge_<org_id>.db). Note content is not secret, so this opens in
//              PLAIN mode (no cipher key), unlike the vault. Mirrors the core services'
//              createTable() std-columns + generateUUIDv7() pattern so the module is self-contained
//              for standalone dev — it never reaches into root's shared DB.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/mindmerge/db.ts
//------------------------------------------------------------
import Database from "better-sqlite3-multiple-ciphers";
import crypto from "node:crypto";
import path from "node:path";

export type Db = Database.Database;

// name -> handle, idempotent per org (matches the core services' connection registry).
const registry = new Map<string, Db>();

// Open (or reuse) this module's own DB file. PLAIN mode — no cipherKey — because note content
// is not secret. baseDir is injected (app.getPath("userData") at merge; a temp dir in tests) so the
// service stays electron-free and headless-testable.
export function openMindMergeDb(orgId: string, baseDir: string): Db {
  const name = `mindmerge:${orgId}`;
  const existing = registry.get(name);
  if (existing) return existing;
  const db = new Database(path.join(baseDir, `mindmerge_${orgId}.db`));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON"); // ON DELETE CASCADE on the junction/ref tables depends on this
  createSchema(db);
  registry.set(name, db);
  return db;
}

// Standard-columns helper — every table is born with id/uuid/created_at/updated_at, exactly like
// the core services' createTable(). Insert uuid yourself (generateUUIDv7); bump updated_at on UPDATE.
export function createTable(db: Db, name: string, columns: string[] = []): void {
  const cols = [
    "id INTEGER PRIMARY KEY",
    "uuid TEXT UNIQUE NOT NULL",
    ...columns,
    "created_at DATETIME DEFAULT CURRENT_TIMESTAMP",
    "updated_at DATETIME",
  ].join(",\n  ");
  db.exec(`CREATE TABLE IF NOT EXISTS ${name} (\n  ${cols}\n);`);
}

// UUIDv7 (RFC 9562) — copied from the core services utils (stdlib crypto only) to keep the module
// self-contained. 48-bit ms timestamp + version/variant bits + random.
export function generateUUIDv7(): string {
  const bytes = new Uint8Array(16);
  crypto.randomFillSync(bytes);
  const timestamp = Date.now();
  bytes[0] = (timestamp / 2 ** 40) & 0xff;
  bytes[1] = (timestamp / 2 ** 32) & 0xff;
  bytes[2] = (timestamp / 2 ** 24) & 0xff;
  bytes[3] = (timestamp / 2 ** 16) & 0xff;
  bytes[4] = (timestamp / 2 ** 8) & 0xff;
  bytes[5] = timestamp & 0xff;
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return [...bytes].map((b, i) => b.toString(16).padStart(2, "0") + ([3, 5, 7, 9].includes(i) ? "-" : "")).join("");
}

export function createSchema(db: Db): void {
  createTable(db, "mindmerge_notes", [
    "note_id TEXT UNIQUE", // from frontmatter `id`; NULL allowed (quarantined rows have none)
    "title TEXT",
    "type TEXT",
    "status TEXT",
    "severity TEXT",
    "owner TEXT",
    "client TEXT",
    "description TEXT",
    "service TEXT",
    '"trigger" TEXT', // quoted — SQL keyword
    "version TEXT",
    "updated TEXT",
    "body_md TEXT", // full markdown body after frontmatter
    "tags_flat TEXT", // denormalized tag string — FTS5 external-content needs the column present here
    "file_path TEXT UNIQUE NOT NULL", // the upsert key
    "parse_status TEXT NOT NULL DEFAULT 'ok'", // 'ok' | 'error'
    "parse_error TEXT",
  ]);

  createTable(db, "tags", ["name TEXT UNIQUE NOT NULL"]);
  createTable(db, "mindmerge_note_tags", [
    "note_id INTEGER NOT NULL REFERENCES mindmerge_notes(id) ON DELETE CASCADE",
    "tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE",
  ]);
  // Dedupe the link (a table constraint can't live mid-column-list under createTable's std wrapper).
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS mindmerge_note_tags_uniq ON mindmerge_note_tags(note_id, tag_id);");

  // POINTERS ONLY — vault_pointer is a locator like "hetzner/avert-core-01/ssh", never a secret value.
  createTable(db, "mindmerge_secret_refs", [
    "note_id INTEGER NOT NULL REFERENCES mindmerge_notes(id) ON DELETE CASCADE",
    "ref_key TEXT NOT NULL",
    "vault_pointer TEXT NOT NULL",
  ]);

  // FTS5 external-content over mindmerge_notes(title, body_md, tags_flat) keyed to notes.id.
  // Virtual table — exempt from the std-columns wrapper by design.
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS mindmerge_fts USING fts5(
    title, body_md, tags_flat,
    content='mindmerge_notes', content_rowid='id'
  );`);

  // Triggers keep the FTS index in sync DB-side, so no write path can forget (ponytail: constraint
  // over app code). The 'delete' command feeds old column values back so the index entry is removed.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS mindmerge_ai AFTER INSERT ON mindmerge_notes BEGIN
      INSERT INTO mindmerge_fts(rowid, title, body_md, tags_flat)
        VALUES (new.id, new.title, new.body_md, new.tags_flat);
    END;
    CREATE TRIGGER IF NOT EXISTS mindmerge_ad AFTER DELETE ON mindmerge_notes BEGIN
      INSERT INTO mindmerge_fts(mindmerge_fts, rowid, title, body_md, tags_flat)
        VALUES ('delete', old.id, old.title, old.body_md, old.tags_flat);
    END;
    CREATE TRIGGER IF NOT EXISTS mindmerge_au AFTER UPDATE ON mindmerge_notes BEGIN
      INSERT INTO mindmerge_fts(mindmerge_fts, rowid, title, body_md, tags_flat)
        VALUES ('delete', old.id, old.title, old.body_md, old.tags_flat);
      INSERT INTO mindmerge_fts(rowid, title, body_md, tags_flat)
        VALUES (new.id, new.title, new.body_md, new.tags_flat);
    END;
  `);
}
