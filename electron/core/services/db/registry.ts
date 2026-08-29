// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Platform registry — the boot-routing DB (platform_registry.db under userData).
//              Maps this install to org-scoped database files; main.ts consults it before
//              booting any org DB, and the First-Run wizard writes it on completion.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/db/registry.ts
//------------------------------------------------------------
import { app } from "electron";
import path from "node:path";
import { openDb } from "./index";

// Routing metadata, NOT business data — bypasses the standard-columns wrapper by design:
// org_id is the natural primary key and rows carry their own lifecycle (is_active).
const SCHEMA = `CREATE TABLE IF NOT EXISTS orgs (org_id TEXT PRIMARY KEY, app_slug TEXT NOT NULL, org_name TEXT NOT NULL, is_active INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);`;

export interface OrgRow {
  org_id: string;
  app_slug: string;
  org_name: string;
  is_active: number;
  created_at: string;
}

let schemaReady = false;

// openDb is idempotent per name, so every accessor funnels through here safely.
function regDb() {
  const db = openDb(path.join(app.getPath("userData"), "platform_registry.db"), "platform_registry");
  if (!schemaReady) {
    db.exec(SCHEMA);
    schemaReady = true;
  }
  return db;
}

// Called first thing in app.whenReady() — opens the connection and ensures the schema.
export function initRegistry(): void {
  regDb();
}

// DURABILITY (08-26-2026): org routing must survive a torn WAL. The app is rarely quit cleanly
// (✕ hides to tray), so a registry write can live ONLY in the WAL for days — one kill with a torn
// frame and SQLite silently discards the log on the next open, rolling the active org back to an
// older one. It happened tonight ("reset" → AvertXAI: theme, geometry and recent work all looked
// "lost" because the whole org reverted), and the 08-24 self-heal note below records an earlier
// WAL casualty. Registry mutations are tiny and rare; folding each one into the main file ends
// the class.
function checkpoint(): void {
  try {
    regDb().pragma("wal_checkpoint(TRUNCATE)");
  } catch {
    /* checkpoint blocked by a reader — the write is still committed, just WAL-resident */
  }
}

export function getActiveOrg(): OrgRow | undefined {
  const active = regDb().prepare("SELECT * FROM orgs WHERE is_active = 1").get() as OrgRow | undefined;
  if (active) return active;
  // SELF-HEAL (08-24-2026). An org row with no active flag is a registry that lost sight of real
  // data — seen once when a copied WAL sidecar made the flag unreadable for one boot, and the app's
  // answer was the first-run wizard, which minted a fresh EMPTY org over a disk full of databases.
  // A registry that knows of exactly one org re-activates it rather than pretending to be new;
  // first-run stays reserved for a truly empty registry. Ambiguity (two or more orgs, none active)
  // is not guessed at — the newest org was not necessarily the wanted one.
  const rows = regDb().prepare("SELECT * FROM orgs ORDER BY created_at DESC").all() as OrgRow[];
  if (rows.length === 1) {
    console.warn(`[registry] no active org but one org exists — re-activating ${rows[0].org_id}`);
    regDb().prepare("UPDATE orgs SET is_active = 1 WHERE org_id = ?").run(rows[0].org_id);
    checkpoint();
    return { ...rows[0], is_active: 1 };
  }
  return undefined;
}

// Insert a new org and make it the single active one.
export function addOrg(orgId: string, appSlug: string, orgName: string): void {
  const db = regDb();
  db.transaction(() => {
    db.prepare("UPDATE orgs SET is_active = 0 WHERE is_active = 1").run();
    db.prepare("INSERT INTO orgs (org_id, app_slug, org_name, is_active) VALUES (?, ?, ?, 1)").run(
      orgId,
      appSlug,
      orgName
    );
  })();
  checkpoint();
}
