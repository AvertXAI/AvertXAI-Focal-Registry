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
import { ensureAllModuleSchemas } from "../db/allSchemas";
import { addOrg, getActiveOrg } from "../db/registry";
import { generateUUIDv7 } from "../utils/uuidv7";
import { deriveVaultKey, getOrCreateVaultSecret } from "../vault/crypto";
import { ensureVaultSchema } from "../vault/db";
import { readDeviceIdentity, type DeviceIdentity } from "../identity";

export function getFirstRunStatus(): boolean {
  return getActiveOrg() !== undefined;
}

/**
 * Creates and seeds the SHARED org database — the whole of it, in one Electron-free function.
 *
 * EXTRACTED 2026-08-06 so the application-boot proof (devseed/boot-proof.ts) can create a database
 * through the app's OWN path instead of hand-assembling one. That distinction is the lesson of the
 * schema-ensure bug: every harness built its schema by hand and stayed green while first-run
 * omitted the ensures entirely, so a fresh org had only initDb's four shell tables and TimeTracker's
 * project list threw "no such table: employee_entries" (proven by execution, 08-06).
 *
 * ensureAllModuleSchemas is the fix and it lives HERE, at org creation, unconditionally — a
 * module's tables exist because an org exists, never because someone opened a module (ruled
 * 08-05-2026). Boot repeats the call for databases that predate this rule.
 */
export function createOrgDatabase(dbPath: string, orgId: string, orgName: string, identity: DeviceIdentity): void {
  initDb(dbPath);
  const db = getDb();
  ensureAllModuleSchemas(db);

  db.transaction(() => {
    const put = db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)");
    put.run("org_name", orgName);
    put.run("org_id", orgId);

    // LOCAL ONLY — this provenance row NEVER leaves the machine: it is not transmitted, not sent
    // to any server, and never included in any report, export, or error payload. It records which
    // machine the account was born on, atomically with the account itself.
    db.prepare(
      "INSERT INTO device_provenance (uuid, org_id, machine_guid, hardware_uuid, machine_name) VALUES (?, ?, ?, ?, ?)"
    ).run(generateUUIDv7(), orgId, identity.machine_guid, identity.hardware_uuid, identity.machine_name);

    // Nav shape (must stay in lockstep with db/index.ts's seedModule + normalization), display_order
    // contiguous 1-10: Archive Media 1-3 · Applications 4-5 (6 reserved for Calendar, which has NO
    // row yet — the gap is deliberate) · Tools 7-8 · Secured Vault 9 (standalone) · Marketplace 10
    // (standalone). nav_group/nav_standalone are set HERE so a fresh org's first boot renders the
    // right sections immediately — no transient-NULL "Applications" window.
    const mod = db.prepare(
      "INSERT INTO modules (uuid, tenant_id, name, slug, type, display_order, is_locked, nav_group, nav_standalone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    mod.run(generateUUIDv7(), orgId, "Scan", "scan", "tool", 1, 0, "Archive Media", 0);
    mod.run(generateUUIDv7(), orgId, "Rename", "rename", "tool", 2, 0, "Archive Media", 0);
    mod.run(generateUUIDv7(), orgId, "Migrate", "migrate", "tool", 3, 0, "Archive Media", 0);
    // Employees leads Applications (ruled 2026-08-04) — people come before their timers.
    mod.run(generateUUIDv7(), orgId, "Employees", "employees", "tool", 4, 0, "Applications", 0);
    mod.run(generateUUIDv7(), orgId, "TimeTracker", "timetracker", "tool", 5, 0, "Applications", 0);
    mod.run(generateUUIDv7(), orgId, "MindMerge", "mindmerge", "notes", 7, 0, "Tools", 0);
    mod.run(generateUUIDv7(), orgId, "Scout Viewer", "scout-viewer", "browser", 8, 0, "Tools", 0);
    mod.run(generateUUIDv7(), orgId, "Secured Vault", "vault", "secrets", 9, 1, "Secured Vault", 1);
    mod.run(generateUUIDv7(), orgId, "Marketplace", "marketplace", "market", 10, 0, "Marketplace", 1);
  })();
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

  // Device identity is read BEFORE any transaction (it spawns built-in probes — never inside a tx)
  // and is NEVER fatal: a failed probe records NULL columns, the account is created regardless.
  let identity: DeviceIdentity = { machine_guid: null, hardware_uuid: null, machine_name: null };
  try {
    identity = readDeviceIdentity();
  } catch {
    /* belt over the service's own braces — identity must never block first-run */
  }

  // Create + seed the org DBs FIRST; registry activation is the LAST step (the commit point),
  // so a failure anywhere before it leaves the registry empty and the wizard simply runs again.
  // ponytail: a crash between seed and addOrg orphans the new .db files — harmless, never routed to.
  createOrgDatabase(path.join(userData, `focalregistry_${orgId}.db`), orgId, name, identity);

  // Vault is born encrypted: safeStorage-wrapped secret → Argon2id → SQLCipher key. The file is
  // <org_id>.atd — deliberately dull (ruled 08-02-2026), obscurity only; SQLCipher is the control.
  // Its schema is ensured HERE at birth too (same 08-05 ruling) — against the vault connection,
  // never the shared one. It cannot ride ensureAllModuleSchemas because it lives behind its own key.
  const vaultKey = await deriveVaultKey(getOrCreateVaultSecret(orgId));
  const vaultDb = openDb(path.join(userData, `${orgId}.atd`), "vault", vaultKey);
  ensureVaultSchema(vaultDb);

  addOrg(orgId, "focalregistry", name);
}
