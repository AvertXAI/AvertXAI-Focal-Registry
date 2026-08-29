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

/**
 * ISO-8601 UTC WITH MILLISECONDS. Byte-identical to the vault's `nowIso()`, and that is not a
 * stylistic choice — it is a correctness one.
 *
 * The first version of this function stripped the milliseconds. That silently broke ordering: these
 * timestamps live in TEXT columns and every list sorts them LEXICOGRAPHICALLY, while `isoOrNow()`
 * in notes.ts still emits full precision for an imported file's mtime. One table would then hold two
 * formats, and "." (0x2E) sorts before "Z" (0x5A) — so `2026-08-21T21:40:06.900Z` would rank BELOW
 * `2026-08-21T21:40:06Z` despite being 900 milliseconds LATER. An imported document would sink under
 * a note written in the same second, in a list whose whole job is "most recent first".
 *
 * Caught by adversarial review before it ever ran. Do not "tidy" the milliseconds away.
 */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * AUTHORED DOCUMENTS — the Secured Notes shape, landing BESIDE the ingest tables, never instead of
 * them (RULED by Jason 08-21-2026).
 *
 * WHY TWO SHAPES AND NOT ONE. `mindmerge_notes` below is the INGEST shape: a markdown file found on
 * disk, parsed, and indexed, keyed by `file_path UNIQUE NOT NULL`. That column alone makes it unable
 * to hold a document a user is writing, because an authored note has no file until it is exported.
 * One answers "what did I find", the other "what am I writing". They are not variants.
 *
 * The ingest side stays because it is the surface JARVIS will use — creating and organising files on
 * disk while the engine indexes them — and because it is how Jason reads and edits his own `_source`
 * markdown. Neither purpose survives a merge.
 *
 * `org_id` IS PRESENT even though this database file is already per-org (`mindmerge_<org>.db`) and
 * the ingest tables omit it. It is not decoration: every query in the note services being copied
 * filters `WHERE org_id = ?`, so dropping the column would mean rewriting all of them. Canon asks for
 * it on every module table regardless.
 *
 * PLAIN, NOT ENCRYPTED. The vault's copy of this shape lives in a SQLCipher file; this one does not,
 * because MindMerge is Tier-1 agent-READABLE by design. The encryption was never in the note code —
 * it was in the connection — so the same services work unchanged against this handle. Attachments are
 * the exception and are ruled into their own encrypted file, not this one.
 */
function createDocsSchema(db: Db): void {
  createTable(db, "mindmerge_doc_folders", [
    "org_id TEXT NOT NULL",
    "name TEXT NOT NULL",
    "parent_id INTEGER", // NULL = top level
    "sort_order INTEGER NOT NULL DEFAULT 0",
  ]);

  createTable(db, "mindmerge_docs", [
    "org_id TEXT NOT NULL",
    "kind TEXT NOT NULL", // note | runbook | snippet — open set, matching the vault's doctrine
    "title TEXT NOT NULL",
    "body TEXT NOT NULL DEFAULT ''",
    "folder TEXT", // free-text group name; NULL = All notes. Legacy sibling of folder_id, kept.
    "folder_id INTEGER",
    "pinned INTEGER NOT NULL DEFAULT 0",
    "archived_at TEXT",
    "source_path TEXT", // where an imported document came from; NULL for anything authored here
  ]);

  db.exec("CREATE INDEX IF NOT EXISTS idx_mindmerge_docs_kind ON mindmerge_docs (kind);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_mindmerge_docs_folder ON mindmerge_docs (folder_id);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_mindmerge_doc_folders_parent ON mindmerge_doc_folders (parent_id);");

  /**
   * THE GUARD THAT STOPS AN IMPORT ARRIVING TWICE. Jason imported ~2,000 files into the vault and the
   * folder read 4,178 — the same documents pulled in four or five times over repeated runs, because
   * nothing recorded what had already been taken (08-12-2026).
   *
   * PARTIAL index: `WHERE source_path IS NOT NULL` exempts every authored note, so they share the
   * absence freely, while two imports of one file cannot both exist. A guarantee from the database
   * rather than a check the importer has to remember — and importers are exactly the code that forgets.
   */
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS mindmerge_docs_source_uniq ON mindmerge_docs (org_id, source_path) WHERE source_path IS NOT NULL;"
  );
}

export function createSchema(db: Db): void {
  createDocsSchema(db);

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
    // VAULT FIELDS (Jason 08-28-2026): MindMerge is the vault — the memory an agent reads and
    // writes across every AvertXAI product — so notes organise by what they SERVE, not by how
    // badly something is on fire. severity/service/trigger above are RETIRED runbook fields:
    // no longer read or written, columns kept — existing rows may hold values and a dropped
    // column destroys them silently.
    "domain TEXT", // the product/operation area a note serves (focal-registry, business, meta, …)
    "project TEXT", // the specific effort inside a domain — free text, lowercase-hyphenated
    "area TEXT", // what it is ABOUT, not its document type (schema, pricing, legal, ops, …)
    "source TEXT", // where the knowledge came from — lets an agent tell a ruling from a guess
    "confidence TEXT", // verified | inferred | unknown — the labels every claim already carries
  ]);
  // ADDITIVE, GUARDED (SOP §6): mtime_ms is the ingest change-guard (Jason 08-26-2026, the vault
  // direction — "the DB is the truth"). A file whose stored mtime matches is never re-read, so
  // re-opening the module stats the tree instead of re-parsing 2,000+ files behind a spinner.
  {
    const have = new Set((db.pragma("table_info(mindmerge_notes)") as { name: string }[]).map((c) => c.name));
    if (!have.has("mtime_ms")) db.exec("ALTER TABLE mindmerge_notes ADD COLUMN mtime_ms INTEGER");
    // Vault fields on an EXISTING database — same guarded-additive shape; existing rows get NULL.
    for (const col of ["domain", "project", "area", "source", "confidence"]) {
      if (!have.has(col)) db.exec(`ALTER TABLE mindmerge_notes ADD COLUMN ${col} TEXT`);
    }
  }
  // The two filters that will run constantly (Jason 08-28-2026).
  db.exec("CREATE INDEX IF NOT EXISTS idx_mindmerge_notes_domain ON mindmerge_notes (domain);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_mindmerge_notes_domain_project ON mindmerge_notes (domain, project);");

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
