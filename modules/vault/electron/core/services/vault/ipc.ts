// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Vault IPC registration — thin vault:* handlers that resolve the active org and the
//              "vault" SQLCipher connection, then call the services with (db, orgId, …). Mirrors
//              employees/ipc.ts: a module-local safeHandle (a cross-import of core/ipc.ts's would be
//              circular) and a one-shot lazy context — async here, because obtaining the vault
//              connection derives the SQLCipher key. `caller` is STAMPED here as "renderer", never
//              accepted from the page: a self-reported caller would let any renderer code sign the
//              access log as someone else. Main-side consumers (Employees' taxpayer identifiers)
//              call the services directly with their own caller tag and never pass through IPC.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/vault/ipc.ts
//------------------------------------------------------------
import { app, ipcMain } from "electron";
import path from "node:path";
import { openDb } from "../db";
import { getActiveOrg } from "../db/registry";
import { deriveVaultKey, getOrCreateVaultSecret } from "./crypto";
import { ensureVaultSchema, type Db } from "./db";
import * as secrets from "./store";
import * as lock from "./lock";
import * as vaultSettings from "./settings";
import * as seed from "./seed";
import { analyseHealth } from "./health";
import { estimateStrength, generatePassword } from "./generator";
import type { VaultGeneratorOptions, VaultSecretInput } from "./types";

// Module-local copy of core/ipc.ts's resilient registrar (it is module-local there; a cross-import
// would make core/ipc.ts and this file circular). Same semantics: one failed registration never
// silently kills the rest, and the failure is logged LOUDLY with its channel name.
function safeHandle(channel: string, listener: Parameters<typeof ipcMain.handle>[1]): void {
  try {
    ipcMain.handle(channel, listener);
  } catch (e) {
    console.error(`[ipc] FAILED to register handler '${channel}':`, e);
  }
}

// Every access-log row born on this bridge says so. The page cannot claim to be anyone else.
const RENDERER_CALLER = "renderer";

/**
 * Lazy one-shot context (the scan/timetracker/employees pattern, async because the vault key is
 * derived). The PROMISE is cached, not the result, so two concurrent first calls cannot double-run
 * Argon2id; a failed init clears the cache so a transient failure isn't pinned for the session.
 * openDb is idempotent per registry key: when boot (main.ts) or the first-run wizard already opened
 * "vault", the same handle comes back and the path/key arguments are ignored — the derivation here
 * only ever matters on a path where nothing opened it, which is exactly the defensive case.
 * The schema call is DEFENSIVE and idempotent for the same reason ensureEmployeesSchema's is: boot
 * ensures the schema for an org that already existed, but an org minted by the first-run wizard IN
 * THIS SESSION never passes that point — without this, the first Vault ask after the wizard would
 * hit a missing table until the app restarted (the ttCtx lesson, applied from the start).
 */
let ctxPromise: Promise<{ db: Db; orgId: string }> | null = null;
function vaultCtx(): Promise<{ db: Db; orgId: string }> {
  if (ctxPromise) return ctxPromise;
  const org = getActiveOrg();
  if (!org) throw new Error("Vault: no active org");
  ctxPromise = (async () => {
    const key = await deriveVaultKey(getOrCreateVaultSecret(org.org_id));
    // <org_id>.atd — the dull name (ruled 08-02-2026); MUST stay byte-identical to the boot and
    // first-run call sites or this defensive open creates a SECOND database beside the real one.
    const db = openDb(path.join(app.getPath("userData"), `${org.org_id}.atd`), "vault", key);
    ensureVaultSchema(db);
    // [master-password-placeholder] — guarantees a verifier exists so the gate below can refuse.
    // Idempotent: an existing verifier is never overwritten, so a chosen password survives.
    lock.ensureMasterPassword(db, org.org_id);
    return { db, orgId: org.org_id };
  })().catch((e: unknown) => {
    ctxPromise = null;
    throw e;
  });
  return ctxPromise;
}

/**
 * [master-password-placeholder] — THE gate. Every channel that touches vault data calls this
 * first, so "locked" is one decision in one place rather than a check each handler could forget.
 * When the real gate lands, this is the function that starts refusing; nothing else moves.
 * The lock/unlock/state channels deliberately do NOT call it, or the vault could never be opened.
 */
async function gated(): Promise<{ db: Db; orgId: string }> {
  const ctx = await vaultCtx();
  if (!lock.isUnlocked(ctx.db, ctx.orgId)) throw new Error("The vault is locked.");
  lock.touch(); // idle clock measures USE, not wall time
  return ctx;
}

export function registerVaultIpc(): void {
  // ---- the lock (ungated, by necessity) ----
  safeHandle("vault:lockState", async () => {
    const { db, orgId } = await vaultCtx();
    return lock.lockState(db, orgId);
  });
  // Both outcomes are recorded INSIDE lock.unlock — see its comment; the handler must not add a
  // second row, and must not be the only thing standing between a failed attempt and the log.
  safeHandle("vault:unlock", async (_e, password: unknown) => {
    const { db, orgId } = await vaultCtx();
    return lock.unlock(db, orgId, password, RENDERER_CALLER).state;
  });
  safeHandle("vault:lock", async () => {
    const { db, orgId } = await vaultCtx();
    return lock.lock(db, orgId, RENDERER_CALLER);
  });
  safeHandle("vault:changeMasterPassword", async (_e, current: unknown, next: unknown) => {
    const { db, orgId } = await gated();
    lock.changeMasterPassword(db, orgId, current, next);
    secrets.logAccess(db, orgId, "password_change", null, null, RENDERER_CALLER, true);
    return lock.lockState(db, orgId);
  });

  // ---- secrets ----
  safeHandle("vault:createSecret", async (_e, input: unknown) => {
    const { db, orgId } = await gated();
    return secrets.createSecret(db, orgId, RENDERER_CALLER, input as VaultSecretInput);
  });
  // METADATA ONLY — the one list channel; no credential can cross it (listSecrets never selects one).
  safeHandle("vault:listSecrets", async (_e, includeArchived: unknown) => {
    const { db, orgId } = await gated();
    return secrets.listSecrets(db, orgId, includeArchived === true);
  });
  // THE single value-bearing channel. The service logs the ask — hit or miss — before returning.
  safeHandle("vault:readSecret", async (_e, uuid: unknown) => {
    const { db, orgId } = await gated();
    return secrets.readSecret(db, orgId, RENDERER_CALLER, uuid);
  });
  safeHandle("vault:supersedeSecret", async (_e, uuid: unknown, value: unknown, extras: unknown) => {
    const { db, orgId } = await gated();
    return secrets.supersedeSecret(db, orgId, RENDERER_CALLER, uuid, value, extras);
  });
  safeHandle("vault:updateSecretMeta", async (_e, uuid: unknown, patch: unknown) => {
    const { db, orgId } = await gated();
    return secrets.updateSecretMeta(db, orgId, RENDERER_CALLER, uuid, patch);
  });
  safeHandle("vault:setFavourite", async (_e, uuid: unknown, on: unknown) => {
    const { db, orgId } = await gated();
    return secrets.setFavourite(db, orgId, uuid, on);
  });
  safeHandle("vault:archiveSecret", async (_e, uuid: unknown, reason: unknown) => {
    const { db, orgId } = await gated();
    return secrets.archiveSecret(db, orgId, RENDERER_CALLER, uuid, reason);
  });
  safeHandle("vault:restoreSecret", async (_e, uuid: unknown) => {
    const { db, orgId } = await gated();
    return secrets.restoreSecret(db, orgId, RENDERER_CALLER, uuid);
  });
  // Version NUMBERS and timestamps only — never a past value (see store.listVersions).
  safeHandle("vault:listVersions", async (_e, uuid: unknown) => {
    const { db, orgId } = await gated();
    return secrets.listVersions(db, orgId, uuid);
  });
  safeHandle("vault:listAccessLog", async (_e, opts: unknown) => {
    const { db, orgId } = await gated();
    return secrets.listAccessLog(db, orgId, (opts ?? {}) as { limit?: number; secretUuid?: string });
  });

  // ---- health: verdicts cross the bridge, never the values they came from ----
  safeHandle("vault:health", async () => {
    const { db, orgId } = await gated();
    const report = analyseHealth(db, orgId);
    secrets.logAccess(db, orgId, "health_scan", null, null, RENDERER_CALLER, true, `${report.total} entries analysed`);
    return report;
  });

  // ---- generator: pure local computation, nothing stored, nothing logged per keystroke ----
  safeHandle("vault:generate", (_e, opts: unknown) => generatePassword((opts ?? {}) as Partial<VaultGeneratorOptions>));
  safeHandle("vault:strength", (_e, value: unknown) => estimateStrength(typeof value === "string" ? value : ""));

  // ---- the vault's OWN settings (canon: never the application's Settings page) ----
  safeHandle("vault:getSettings", async () => {
    const { db, orgId } = await gated();
    return vaultSettings.getAllSettings(db, orgId);
  });
  safeHandle("vault:setSetting", async (_e, key: unknown, value: unknown) => {
    const { db, orgId } = await gated();
    vaultSettings.setSetting(db, orgId, key, value);
    secrets.logAccess(db, orgId, "settings_change", null, null, RENDERER_CALLER, true, String(key));
    return vaultSettings.getAllSettings(db, orgId);
  });

  // ---- seed data (the Database card in vault settings) ----
  safeHandle("vault:seedStatus", async () => {
    const { db, orgId } = await gated();
    return seed.seedStatus(db, orgId);
  });
  safeHandle("vault:loadSeed", async () => {
    const { db, orgId } = await gated();
    return seed.loadSeed(db, orgId);
  });
  safeHandle("vault:purgeSeed", async () => {
    const { db, orgId } = await gated();
    return seed.purgeSeed(db, orgId);
  });
}
