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
import type { VaultSecretInput } from "./types";

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
    return { db, orgId: org.org_id };
  })().catch((e: unknown) => {
    ctxPromise = null;
    throw e;
  });
  return ctxPromise;
}

export function registerVaultIpc(): void {
  safeHandle("vault:createSecret", async (_e, input: unknown) => {
    const { db, orgId } = await vaultCtx();
    return secrets.createSecret(db, orgId, RENDERER_CALLER, input as VaultSecretInput);
  });
  // METADATA ONLY — the one list channel; no value can cross it (secrets.listSecrets never selects one).
  safeHandle("vault:listSecrets", async (_e, includeArchived: unknown) => {
    const { db, orgId } = await vaultCtx();
    return secrets.listSecrets(db, orgId, includeArchived === true);
  });
  // THE single value-bearing channel. The service logs the ask — hit or miss — before returning.
  safeHandle("vault:readSecret", async (_e, uuid: unknown) => {
    const { db, orgId } = await vaultCtx();
    return secrets.readSecret(db, orgId, RENDERER_CALLER, uuid);
  });
  safeHandle("vault:supersedeSecret", async (_e, uuid: unknown, value: unknown) => {
    const { db, orgId } = await vaultCtx();
    return secrets.supersedeSecret(db, orgId, RENDERER_CALLER, uuid, value);
  });
  safeHandle("vault:archiveSecret", async (_e, uuid: unknown, reason: unknown) => {
    const { db, orgId } = await vaultCtx();
    return secrets.archiveSecret(db, orgId, RENDERER_CALLER, uuid, reason);
  });
}
