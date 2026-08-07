// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry — Vault standalone lane
// Description: DEV HOST preload — exposes `window.api.vault` with exactly the shape the real
//              preload will carry after copy-back, so the module code needs no dev-only branch.
//              This block is what gets pasted into electron/core/preload.ts at integration time.
//              Never ships; stays behind on copy-back.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: modules/vault/dev/preload.ts
//------------------------------------------------------------
import { contextBridge, ipcRenderer } from "electron";

/** Same error-cleaning wrapper the real bridge uses — internal channel names never reach a user. */
function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  return ipcRenderer.invoke(channel, ...args).catch((e: unknown) => {
    const raw = e instanceof Error ? e.message : String(e);
    throw new Error(raw.replace(/^Error invoking remote method '[^']+':\s*/, "").replace(/^(Error:\s*)+/, ""));
  });
}

contextBridge.exposeInMainWorld("api", {
  vault: {
    lockState: () => invoke("vault:lockState"),
    unlock: (password: string) => invoke("vault:unlock", password),
    lock: () => invoke("vault:lock"),
    changeMasterPassword: (current: string, next: string) => invoke("vault:changeMasterPassword", current, next),
    create: (input: unknown) => invoke("vault:createSecret", input),
    list: (includeArchived?: boolean) => invoke("vault:listSecrets", includeArchived === true),
    read: (uuid: string) => invoke("vault:readSecret", uuid),
    supersede: (uuid: string, value: string, extras?: unknown) => invoke("vault:supersedeSecret", uuid, value, extras ?? null),
    updateMeta: (uuid: string, patch: unknown) => invoke("vault:updateSecretMeta", uuid, patch),
    setFavourite: (uuid: string, on: boolean) => invoke("vault:setFavourite", uuid, on),
    archive: (uuid: string, reason?: string | null) => invoke("vault:archiveSecret", uuid, reason ?? null),
    restore: (uuid: string) => invoke("vault:restoreSecret", uuid),
    listVersions: (uuid: string) => invoke("vault:listVersions", uuid),
    listAccessLog: (opts?: unknown) => invoke("vault:listAccessLog", opts ?? {}),
    breachSweep: () => invoke("vault:breachSweep"),
    breachProgress: () => invoke("vault:breachProgress"),
    breachEmail: (email: string) => invoke("vault:breachEmail", email),
    listFolders: () => invoke("vault:listFolders"),
    createFolder: (name: string, parentId?: number | null) => invoke("vault:createFolder", name, parentId ?? null),
    renameFolder: (id: number, name: string) => invoke("vault:renameFolder", id, name),
    moveFolder: (id: number, parentId: number | null) => invoke("vault:moveFolder", id, parentId),
    deleteFolder: (id: number) => invoke("vault:deleteFolder", id),
    health: () => invoke("vault:health"),
    generate: (opts?: unknown) => invoke("vault:generate", opts ?? {}),
    strength: (value: string) => invoke("vault:strength", value),
    getSettings: () => invoke("vault:getSettings"),
    setSetting: (key: string, value: string) => invoke("vault:setSetting", key, value),
    seedStatus: () => invoke("vault:seedStatus"),
    loadSeed: () => invoke("vault:loadSeed"),
    purgeSeed: () => invoke("vault:purgeSeed"),
  },
});
