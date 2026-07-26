// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
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
import { readDeviceIdentity, type DeviceIdentity } from "../identity";

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
  initDb(path.join(userData, `focalregistry_${orgId}.db`));
  // Vault is born encrypted: safeStorage-wrapped secret → Argon2id → SQLCipher key.
  const vaultKey = await deriveVaultKey(getOrCreateVaultSecret(orgId));
  openDb(path.join(userData, `vault_${orgId}.locked.db`), "vault", vaultKey);

  // Device identity is read BEFORE the transaction (it spawns built-in probes — never inside a tx)
  // and is NEVER fatal: a failed probe records NULL columns, the account is created regardless.
  let identity: DeviceIdentity = { machine_guid: null, hardware_uuid: null, machine_name: null };
  try {
    identity = readDeviceIdentity();
  } catch {
    /* belt over the service's own braces — identity must never block first-run */
  }

  const db = getDb();
  db.transaction(() => {
    const put = db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)");
    put.run("org_name", name);
    put.run("org_id", orgId);

    // LOCAL ONLY — this provenance row NEVER leaves the machine: it is not transmitted, not sent
    // to any server, and never included in any report, export, or error payload. It records which
    // machine the account was born on, atomically with the account itself.
    db.prepare(
      "INSERT INTO device_provenance (uuid, org_id, machine_guid, hardware_uuid, machine_name) VALUES (?, ?, ?, ?, ?)"
    ).run(generateUUIDv7(), orgId, identity.machine_guid, identity.hardware_uuid, identity.machine_name);

    const mod = db.prepare(
      "INSERT INTO modules (uuid, tenant_id, name, slug, type, display_order, is_locked) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    mod.run(generateUUIDv7(), orgId, "Scan", "scan", "tool", 1, 0);
    mod.run(generateUUIDv7(), orgId, "Rename", "rename", "tool", 2, 0);
    mod.run(generateUUIDv7(), orgId, "Migrate", "migrate", "tool", 3, 0);
    mod.run(generateUUIDv7(), orgId, "MindMerge", "mindmerge", "notes", 4, 0);
    mod.run(generateUUIDv7(), orgId, "Scout Viewer", "scout-viewer", "browser", 5, 0);
    mod.run(generateUUIDv7(), orgId, "Secure Vault", "vault", "secrets", 6, 1);
  })();

  addOrg(orgId, "focalregistry", name);
}
