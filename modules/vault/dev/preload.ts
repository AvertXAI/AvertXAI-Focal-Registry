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
    generatePassphrase: (opts?: unknown) => invoke("vault:generatePassphrase", opts ?? {}),
    generateMemorable: (length?: number) => invoke("vault:generateMemorable", length ?? 14),
    generatePin: (digits?: number) => invoke("vault:generatePin", digits ?? 6),
    generateBulk: (count?: number, opts?: unknown) => invoke("vault:generateBulk", count ?? 10, opts ?? {}),
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
    // Import / export. The page passes a path it was GIVEN by the main-side dialog and receives a
    // count — no value crosses in either direction. See transfer.ts.
    findExports: (kind?: string) => invoke("vault:findExports", kind ?? "csv"),
    revealExportFolder: (kind?: string, filePath?: string) => invoke("vault:revealExportFolder", kind ?? "csv", filePath ?? ""),
    chooseImportFile: (kind?: string) => invoke("vault:chooseImportFile", kind ?? "csv"),
    importPreview: (filePath: string) => invoke("vault:importPreview", filePath),
    importCsv: (filePath: string, mapping: unknown) => invoke("vault:importCsv", filePath, mapping),
    importArchive: (filePath: string, passphrase: string) => invoke("vault:importArchive", filePath, passphrase),
    exportVault: (kind: string, passphrase?: string) => invoke("vault:exportVault", kind, passphrase ?? ""),
    // Folder import — one importer per tab
    chooseFolders: () => invoke("vault:chooseFolders"),
    chooseFiles: (target?: string) => invoke("vault:chooseFiles", target ?? "notes"),
    statFiles: (paths: string[]) => invoke("vault:statFiles", paths),
    readImportText: (filePath: string) => invoke("vault:readImportText", filePath),
    parseServers: (text: string) => invoke("vault:parseServers", text),
    importServers: (servers: unknown) => invoke("vault:importServers", servers),
    walkFolders: (roots: string[]) => invoke("vault:walkFolders", roots),
    importDocs: (files: unknown, opts: unknown) => invoke("vault:importDocs", files, opts),
    // The event log — reading it, and the renderer's own way of writing to it.
    listEvents: (opts?: unknown) => invoke("vault:listEvents", opts ?? {}),
    compact: () => invoke("vault:compact"),
    compactIfDue: (dry?: boolean) => invoke("vault:compactIfDue", dry === true),
    clearLog: () => invoke("vault:clearLog"),
    clearAllLog: () => invoke("vault:clearAllLog"),
    findCodeThemes: () => invoke("vault:findCodeThemes"),
    readCodeTheme: (file: string) => invoke("vault:readCodeTheme", file),
    logClient: (level: string, message: string, detail?: string) => invoke("vault:logClient", level, message, detail ?? ""),
    // Secured Notes folder tree
    listNoteFolders: () => invoke("vault:listNoteFolders"),
    createNoteFolder: (name: string, parentId?: number | null) => invoke("vault:createNoteFolder", name, parentId ?? null),
    renameNoteFolder: (id: number, name: string) => invoke("vault:renameNoteFolder", id, name),
    moveNoteFolder: (id: number, parentId: number | null) => invoke("vault:moveNoteFolder", id, parentId),
    noteFolderSubtree: (id: number) => invoke("vault:noteFolderSubtree", id),
    emptyNoteFolder: (id: number) => invoke("vault:emptyNoteFolder", id),
    deleteNoteFolder: (id: number) => invoke("vault:deleteNoteFolder", id),
    archiveNoteFolder: (id: number) => invoke("vault:archiveNoteFolder", id),
    purgeNotes: () => invoke("vault:purgeNotes"),
    setNoteFolder: (uuid: string, folderId: number | null) => invoke("vault:setNoteFolder", uuid, folderId),
    previewFolderPaths: (rels: string[]) => invoke("vault:previewFolderPaths", rels),
    // Secured Notes
    listNotes: (kind?: string, archived?: boolean, folderId?: number | null, limit?: number, offset?: number) =>
      invoke("vault:listNotes", kind ?? "", archived === true, folderId === undefined ? undefined : folderId, limit ?? 60, offset ?? 0),
    searchNotes: (q: string, limit?: number) => invoke("vault:searchNotes", q, limit ?? 40),
    restoreNote: (uuid: string) => invoke("vault:restoreNote", uuid),
    destroyNote: (uuid: string) => invoke("vault:destroyNote", uuid),
    getNote: (uuid: string) => invoke("vault:getNote", uuid),
    createNote: (input: unknown) => invoke("vault:createNote", input),
    updateNote: (uuid: string, patch: unknown) => invoke("vault:updateNote", uuid, patch),
    archiveNote: (uuid: string) => invoke("vault:archiveNote", uuid),
    // Infrastructure
    listServers: () => invoke("vault:listServers"),
    saveServer: (input: unknown) => invoke("vault:saveServer", input),
    deleteServer: (uuid: string) => invoke("vault:deleteServer", uuid),
    listDns: (domain?: string) => invoke("vault:listDns", domain ?? ""),
    saveDnsRecord: (input: unknown) => invoke("vault:saveDnsRecord", input),
    deleteDnsRecord: (uuid: string) => invoke("vault:deleteDnsRecord", uuid),
    parseZone: (text: string) => invoke("vault:parseZone", text),
    importZone: (domain: string, records: unknown) => invoke("vault:importZone", domain, records),
    sshArt: (uuid: string) => invoke("vault:sshArt", uuid),
    // Repos + packages
    listRepos: () => invoke("vault:listRepos"),
    saveRepo: (input: unknown) => invoke("vault:saveRepo", input),
    deleteRepo: (uuid: string) => invoke("vault:deleteRepo", uuid),
    scanPackages: () => invoke("vault:scanPackages"),
    chooseScanRoot: () => invoke("vault:chooseScanRoot"),
    scanLocalRepos: (root: string) => invoke("vault:scanLocalRepos", root),
    importLocalRepos: (found: unknown) => invoke("vault:importLocalRepos", found),
  },
});
