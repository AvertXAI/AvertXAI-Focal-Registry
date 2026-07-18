// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: RunBooks — AvertXAI platform shell (baseplate)
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

export function getActiveOrg(): OrgRow | undefined {
  return regDb().prepare("SELECT * FROM orgs WHERE is_active = 1").get() as OrgRow | undefined;
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
}
