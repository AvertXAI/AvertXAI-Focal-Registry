// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: SQLite data-layer boundary. Holds the SHARED connection (one key/value app_settings
//              table, used by the Data Viewer's View/Developer toggle) AND a registry of independent
//              connections so Locked modules can each open their OWN encrypted database file.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
//------------------------------------------------------------
import Database from "better-sqlite3-multiple-ciphers";
import fs from "node:fs";
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
  /**
   * INCREMENTAL auto-vacuum, set BEFORE any table exists — which is the only time SQLite will accept
   * it on a fresh file. Measured 08-12-2026 at Jason's real scale (76 MB, 2,050 notes):
   *   · full VACUUM after ONE delete .... 2158 ms, and reclaimed nothing
   *   · incremental after ONE delete ....    0 ms
   *   · both reclaim the same 76.1 -> 7.4 MB once there is real garbage
   * So "VACUUM on every delete" is 2000x the cost for no gain; freed pages are released a few at a
   * time instead. On an EXISTING file this pragma is inert until one full VACUUM rebuilds it — which
   * is exactly what the Compact button does, so compacting once also upgrades the file.
   */
  db.pragma("auto_vacuum = INCREMENTAL");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
}

// Open (or reuse) an independent connection keyed by `name`. Locked modules call this with their
// own file path + a unique name so they get a handle that is separate from the shared DB.
// cipherKey (hex): encryption key — cipher scheme + key MUST be the connection's first statements,
// applied before any other pragma (WAL etc.), or an encrypted file is unreadable.
/**
 * Checkpoint and close every open connection. Called on quit.
 *
 * WHY IT MATTERS: every database here runs in WAL mode, so a committed write lands in the `-wal`
 * sidecar and is folded into the main file at a checkpoint. SQLite recovers an un-checkpointed WAL
 * on the next open, so a clean exit was never actually lossy — but nothing was closing these
 * connections at all, which leaves the sidecar behind and makes "did my note save?" impossible to
 * answer by looking at the file. Closing runs a TRUNCATE checkpoint, so what is on disk after quit
 * is the whole story. (Jason reported suspected loss on restart 08-12-2026; the real cause was an
 * un-saved editor draft, fixed in NotesView — this is the other half, done properly.)
 */
/**
 * Compact a database and say how much came back. Runs the FULL rebuild, so it is the on-demand
 * button rather than something on a hot path — see the measurements on the auto_vacuum pragma above.
 * It also converts a legacy file to incremental auto-vacuum, after which deletes maintain themselves.
 */
export function compactDb(db: Database.Database, dbPath: string): { before: number; after: number; freed: number } {
  const size = (): number => {
    try { return fs.statSync(dbPath).size; } catch { return 0; }
  };
  db.pragma("wal_checkpoint(TRUNCATE)");
  const before = size();
  db.exec("VACUUM");
  db.pragma("wal_checkpoint(TRUNCATE)");
  const after = size();
  return { before, after, freed: Math.max(0, before - after) };
}

export function closeAllDbs(): void {
  for (const [name, db] of registry) {
    try {
      if (db.open) {
        db.pragma("wal_checkpoint(TRUNCATE)");
        db.close();
      }
    } catch (e) {
      console.error(`[db] could not close '${name}' cleanly:`, e);
    }
  }
  registry.clear();
}

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
  // Additive migration: nav_standalone marks a row as a TOP-LEVEL clickable nav entry with no
  // children (Secured Vault, Marketplace — nav restructure). Guarded ADD COLUMN after createTable,
  // never before; safe to re-run. 0/absent = ordinary sectioned module row.
  if (!(db.pragma("table_info(modules)") as { name: string }[]).some((c) => c.name === "nav_standalone")) {
    db.exec("ALTER TABLE modules ADD COLUMN nav_standalone INTEGER DEFAULT 0;");
  }
  // Additive migration: LOCAL-ONLY device provenance — which machine this org was created on.
  // The row is written by first-run (atomically with the account); NULL identifier columns are
  // legal (a failed probe never blocks account creation). LOCAL ONLY: never transmitted, never
  // sent to a server, never included in any report, export, or error payload.
  createTable(db, "device_provenance", [
    "org_id TEXT NOT NULL",
    "machine_guid TEXT", // per-Windows-install GUID — regenerated by an OS reinstall
    "hardware_uuid TEXT", // SMBIOS UUID — survives an OS reinstall
    "machine_name TEXT",
  ]);
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
    // URLs are PLACEHOLDERS (Jason 08-05-2026): the shipped seeds no longer point at anyone's real
    // tooling. The rows still exist so the rail has its shape; the user edits each target's URL.
    ins.run(generateUUIDv7(), "Target 1", "[PLACEHOLDER_URL]", halo, 0);
    ins.run(generateUUIDv7(), "Target 2", "[PLACEHOLDER_URL]", halo, 1);
    ins.run(generateUUIDv7(), "Target 3", "[PLACEHOLDER_URL]", pylon, 2);
    ins.run(generateUUIDv7(), "Target 4", "[PLACEHOLDER_URL]", pylon, 3);
    ins.run(generateUUIDv7(), "Target 5", "[PLACEHOLDER_URL]", generateUUIDv7(), 4);
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
  const seedModule = (
    name: string,
    slug: string,
    type: string,
    order: number,
    group: string,
    standalone = 0
  ): void => {
    const tenant = tenantId();
    if (!tenant || db.prepare("SELECT 1 FROM modules WHERE slug = ?").get(slug)) return;
    db.prepare(
      `INSERT INTO modules (uuid, tenant_id, name, slug, type, display_order, is_locked, is_enabled, nav_group, nav_standalone)
       VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`
    ).run(generateUUIDv7(), tenant, name, slug, type, order, group, standalone);
  };
  // Contiguous 1-10 (Jason 08-01-2026). 6 is Calendar's reserved slot — that module has no row yet
  // and none is created here; the gap is deliberate, not an omission.
  seedModule("Scan", "scan", "tool", 1, "Archive Media");
  seedModule("Rename", "rename", "tool", 2, "Archive Media");
  seedModule("Migrate", "migrate", "tool", 3, "Archive Media");
  // Employees leads Applications (ruled 2026-08-04) — people come before their timers.
  seedModule("Employees", "employees", "tool", 4, "Applications");
  seedModule("TimeTracker", "timetracker", "tool", 5, "Applications");
  seedModule("MindMerge", "mindmerge", "notes", 7, "Tools");
  seedModule("Scout Viewer", "scout-viewer", "browser", 8, "Tools");
  seedModule("Marketplace", "marketplace", "market", 10, "Marketplace", 1);
  // Row cleanup for gutted modules — idempotent, data-only (no schema change). Existing dev DBs
  // seeded these rows; without this they'd keep rendering in the nav after the module code is gone.
  db.exec("DELETE FROM modules WHERE slug IN ('getscriptclips', 'canon-distributor');");
  // Nav normalization (shell-lane; restructure ruled 2026-07-31, renumbered 08-01-2026 for
  // Employees) — five top-level entries, display_order contiguous 1-10:
  //   Archive Media (Scan 1 · Rename 2 · Migrate 3) · Applications (Employees 4 · TimeTracker 5 ·
  //   [6 = Calendar, reserved, no row yet]) · Tools (MindMerge 7 · Scout Viewer 8) ·
  //   Secured Vault 9 (standalone) · Marketplace 10 (standalone).
  //   Employees leads TimeTracker as of 2026-08-04 — the UPDATEs below carry existing installs
  //   across the swap on their next boot, which is the whole reason they run unconditionally.
  // Idempotent per-slug UPDATEs run every boot so existing DBs (Paul's) converge in place with no
  // rebuild; fresh installs seed straight into this shape (firstrun + seedModule both carry the
  // columns). "Secured Vault" is a DISPLAY NAME change only — the slug stays 'vault'.
  db.exec(`
    UPDATE modules SET nav_group = 'Archive Media' WHERE slug IN ('scan', 'rename', 'migrate');
    UPDATE modules SET display_order = 4, nav_group = 'Applications' WHERE slug = 'employees';
    UPDATE modules SET display_order = 5, nav_group = 'Applications' WHERE slug = 'timetracker';
    UPDATE modules SET display_order = 7, nav_group = 'Tools' WHERE slug = 'mindmerge';
    UPDATE modules SET display_order = 8, nav_group = 'Tools' WHERE slug = 'scout-viewer';
    UPDATE modules SET display_order = 9, nav_group = 'Secured Vault', nav_standalone = 1, name = 'Secured Vault' WHERE slug = 'vault';
    UPDATE modules SET display_order = 10, nav_group = 'Marketplace', nav_standalone = 1 WHERE slug = 'marketplace';
  `);
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
