// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: RunBooks — AvertXAI platform shell (baseplate)
// Description: First-Run Setup Wizard service — gatekeeper edition. Completion mints the org id,
//              creates + seeds the org-scoped DB files, then registers the org as active in the
//              platform registry (the commit point the boot gatekeeper routes on).
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/firstrun/index.ts
//------------------------------------------------------------
import { app } from "electron";
import path from "node:path";
import { getDb, initDb, openDb } from "../db";
import { addOrg, getActiveOrg } from "../db/registry";
import { generateUUIDv7 } from "../utils/uuidv7";
import { deriveVaultKey, getOrCreateVaultSecret } from "../vault/crypto";

export function getFirstRunStatus(): boolean {
  return getActiveOrg() !== undefined;
}

// IPC boundary: orgName arrives as unknown from the renderer — validate before touching the DB.
export async function completeFirstRun(orgName: unknown): Promise<void> {
  if (typeof orgName !== "string" || orgName.trim() === "") {
    throw new Error("completeFirstRun: orgName must be a non-empty string");
  }
  if (getActiveOrg()) return; // idempotent — an active org means setup already happened

  const name = orgName.trim();
  const orgId = generateUUIDv7();
  const userData = app.getPath("userData");

  // Create + seed the org DBs FIRST; registry activation is the LAST step (the commit point),
  // so a failure anywhere before it leaves the registry empty and the wizard simply runs again.
  // ponytail: a crash between seed and addOrg orphans the new .db files — harmless, never routed to.
  initDb(path.join(userData, `runbooks_${orgId}.db`));
  // Vault is born encrypted: safeStorage-wrapped secret → Argon2id → SQLCipher key.
  const vaultKey = await deriveVaultKey(getOrCreateVaultSecret(orgId));
  openDb(path.join(userData, `vault_${orgId}.locked.db`), "vault", vaultKey);

  const db = getDb();
  db.transaction(() => {
    const put = db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)");
    put.run("org_name", name);
    put.run("org_id", orgId);

    const mod = db.prepare(
      "INSERT INTO modules (uuid, tenant_id, name, slug, type, display_order, is_locked) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    mod.run(generateUUIDv7(), orgId, "GetScriptClips", "getscriptclips", "runbook", 1, 0);
    mod.run(generateUUIDv7(), orgId, "Secure Vault", "vault", "secrets", 2, 1);
    mod.run(generateUUIDv7(), orgId, "Runbook Shredder", "runbook-shredder", "runbook", 3, 0);
    mod.run(generateUUIDv7(), orgId, "Scout Viewer", "scout-viewer", "browser", 4, 0);
    // Canon Distributor — nav_group set explicitly ("System"); the shared insert above omits the
    // column, so the other rows default to "Applications" via the initDb backfill.
    db.prepare(
      "INSERT INTO modules (uuid, tenant_id, name, slug, type, display_order, is_locked, is_enabled, nav_group) VALUES (?, ?, 'Distributor', 'canon-distributor', 'engine', 5, 0, 1, 'System')"
    ).run(generateUUIDv7(), orgId);
  })();

  addOrg(orgId, "runbooks", name);
}
