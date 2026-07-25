// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: SQLite data-layer boundary. Holds the SHARED connection (one key/value app_settings
//              table, used by the Data Viewer's View/Developer toggle) AND a registry of independent
//              connections so Locked modules can each open their OWN (encrypted-later) .locked.db file.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
//------------------------------------------------------------
import Database from "better-sqlite3-multiple-ciphers";
import { generateUUIDv7 } from "../utils/uuidv7";

// Clean baseplate schema for the shared DB: a single key/value settings table. Real tables are
// added with createTable() (below) so every table is born with the standard columns.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

// name -> handle. The shared DB lives under the key "shared"; each Locked module's file lives under
// its own key. openDb() is idempotent per key, so re-opening returns the same handle.
const registry = new Map<string, Database.Database>();

function applyPragmas(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
}

// Open (or reuse) an independent connection keyed by `name`. Locked modules call this with their
// own file path + a unique name so they get a handle that is separate from the shared DB.
// cipherKey (hex): encryption key — cipher scheme + key MUST be the connection's first statements,
// applied before any other pragma (WAL etc.), or an encrypted file is unreadable.
export function openDb(dbPath: string, name = dbPath, cipherKey?: string): Database.Database {
  const existing = registry.get(name);
  if (existing) return existing;
  const db = new Database(dbPath);
  if (cipherKey) {
    db.pragma("cipher = 'sqlcipher'"); // fork defaults to ChaCha20 — pin SQLCipher scheme
    db.pragma(`key = "x'${cipherKey}'"`);
  }
  applyPragmas(db);
  registry.set(name, db);
  return db;
}

// Boot the shared DB. Called once from main.ts with the app's <kebab>.db path.
export function initDb(dbPath: string): void {
  const db = openDb(dbPath, "shared");
  db.exec(SCHEMA);
  // Additive migration: platform module registry, seeded by the First-Run wizard.
  createTable(db, "modules", [
    "tenant_id TEXT NOT NULL",
    "name TEXT NOT NULL",
    "slug TEXT UNIQUE NOT NULL",
    "type TEXT NOT NULL",
    "display_order INTEGER DEFAULT 0",
    "is_locked INTEGER DEFAULT 0",
    "is_enabled INTEGER DEFAULT 1",
  ]);
  // Additive migration: nav_group drives the sidebar's grouped collapsible sections (Config-as-Data).
  // Guarded ADD COLUMN — safe to re-run on an already-migrated dev DB. The unconditional backfill runs
  // every boot so any row seeded without a group (firstrun/seedModule don't set it) is NULL-free by the
  // NEXT boot; the renderer also defaults a missing group, covering the same-boot fresh-org window.
  if (!(db.pragma("table_info(modules)") as { name: string }[]).some((c) => c.name === "nav_group")) {
    db.exec("ALTER TABLE modules ADD COLUMN nav_group TEXT;");
  }
  db.exec("UPDATE modules SET nav_group = 'Applications' WHERE nav_group IS NULL;");
  // Additive migration: Scout Viewer browse targets (user-editable CRUD; replaces the module's
  // hardcoded client list). client_id keys the persist:client_<id> session partition — minted at
  // create, immutable after; two targets MAY share one client_id (= one login session).
  createTable(db, "scout_targets", [
    "name TEXT NOT NULL",
    "url TEXT NOT NULL",
    "client_id TEXT NOT NULL",
    "display_order INTEGER DEFAULT 0",
  ]);
  // One-time seed of the previously hardcoded Scout client list — marker-gated (NOT emptiness-gated,
  // so a user deleting every target doesn't resurrect these on the next boot). HaloPSA/Pylon pairs
  // share a client_id each, preserving the prototype's shared-session behavior.
  if (!db.prepare("SELECT 1 FROM app_settings WHERE key = 'scout_targets_seeded'").get()) {
    const ins = db.prepare(
      "INSERT INTO scout_targets (uuid, name, url, client_id, display_order) VALUES (?, ?, ?, ?, ?)"
    );
    const halo = generateUUIDv7();
    const pylon = generateUUIDv7();
    ins.run(generateUUIDv7(), "HaloPSA · Tickets", "https://app.halopsa.com/tickets", halo, 0);
    ins.run(generateUUIDv7(), "HaloPSA · Dashboard", "https://app.halopsa.com/dashboard", halo, 1);
    ins.run(generateUUIDv7(), "Pylon · Inbox", "https://app.usepylon.com/inbox", pylon, 2);
    ins.run(generateUUIDv7(), "Pylon · Issue view", "https://app.usepylon.com/issues", pylon, 3);
    ins.run(generateUUIDv7(), "incident.io · Timeline", "https://app.incident.io/timeline", generateUUIDv7(), 4);
    db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('scout_targets_seeded', '1')").run();
  }
  // Additive migrations: orgs minted before a module existed get its registry row here (this is
  // what makes the module appear in the sidebar + boot loader — both render from these rows).
  // Fresh DBs skip (no tenant known yet at initDb time) — the First-Run wizard seeds all rows.
  // Tenant resolution falls back to an existing module row so DBs whose app_settings predate the
  // org_id key still migrate instead of silently skipping.
  const tenantId = (): string | undefined =>
    (db.prepare("SELECT value AS v FROM app_settings WHERE key = 'org_id'").get() as { v: string } | undefined)?.v ??
    (db.prepare("SELECT tenant_id AS v FROM modules LIMIT 1").get() as { v: string } | undefined)?.v;
  const seedModule = (name: string, slug: string, type: string, order: number): void => {
    const tenant = tenantId();
    if (!tenant || db.prepare("SELECT 1 FROM modules WHERE slug = ?").get(slug)) return;
    db.prepare(
      `INSERT INTO modules (uuid, tenant_id, name, slug, type, display_order, is_locked, is_enabled)
       VALUES (?, ?, ?, ?, ?, ?, 0, 1)`
    ).run(generateUUIDv7(), tenant, name, slug, type, order);
  };
  seedModule("Scan", "scan", "tool", 1);
  seedModule("Rename", "rename", "tool", 2);
  seedModule("MindMerge", "mindmerge", "notes", 3);
  seedModule("Scout Viewer", "scout-viewer", "browser", 4);
  // Row cleanup for gutted modules — idempotent, data-only (no schema change). Existing dev DBs
  // seeded these rows; without this they'd keep rendering in the nav after the module code is gone.
  db.exec("DELETE FROM modules WHERE slug IN ('getscriptclips', 'canon-distributor');");
  // Display-order normalization for pre-gut DBs (vault was seeded at 2; final order puts it at 5,
  // after Scan 1 / Rename 2 / MindMerge 3 / Scout 4). Idempotent, data-only.
  db.exec("UPDATE modules SET display_order = 5 WHERE slug = 'vault' AND display_order <> 5;");
}

export function getDb(): Database.Database {
  const db = registry.get("shared");
  if (!db) throw new Error("Database not initialized — call initDb() first");
  return db;
}

// Standard-columns helper — use this for EVERY table so they are all born the same:
//   id          INTEGER PRIMARY KEY
//   uuid        TEXT UNIQUE NOT NULL   (app-generated — `generateUUIDv7()` from ../utils/uuidv7)
//   <your cols> passed via `columns` as raw SQL fragments, e.g. ["title TEXT NOT NULL"]
//   created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
//   updated_at  DATETIME
// Insert the uuid yourself at write time (uuidv7()); SQLite has no UUID generator. Bump updated_at
// to CURRENT_TIMESTAMP on every UPDATE.
export function createTable(db: Database.Database, name: string, columns: string[] = []): void {
  const cols = [
    "id INTEGER PRIMARY KEY",
    "uuid TEXT UNIQUE NOT NULL",
    ...columns,
    "created_at DATETIME DEFAULT CURRENT_TIMESTAMP",
    "updated_at DATETIME",
  ].join(",\n  ");
  db.exec(`CREATE TABLE IF NOT EXISTS ${name} (\n  ${cols}\n);`);
}
