// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: contextBridge preload — exposes the typed window.api IPC surface to the renderer.
//              Trimmed to the shared spine: Data Viewer (db + dataviewer) + the dev-gated diag channel.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/preload.ts
//------------------------------------------------------------
import { contextBridge, ipcRenderer } from "electron";
import type { Api, PushChannel, NoteFilter, ScoutBounds } from "../../src/shared/types";

// Engine → module subscriptions strip the IpcRendererEvent and return an unsubscribe, so the React
// module can re-mount without stacking listeners (the standalone prototype never unmounted).
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: Electron.IpcRendererEvent, payload: T): void => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

// Main → renderer push events (api.on/off). A whitelist keeps arbitrary ipcRenderer access out of
// the page (contextIsolation); the wrapper map lets off() unhook the exact listener on() registered.
const PUSH_CHANNELS: readonly string[] = ["scan:progress", "scan:drives", "scan:notes:changed", "scan:notes:synced", "mindmerge:progress", "rename:progress", "migrate:progress", "timetracker:tick", "timetracker:changed", "timetracker:break", "timetracker:idle"];
const wrapped = new Map<(payload: never) => void, (e: Electron.IpcRendererEvent, payload: unknown) => void>();
function safeChannel(channel: string): string {
  if (!PUSH_CHANNELS.includes(channel)) throw new Error(`Unknown push channel: ${channel}`);
  return channel;
}

// FIX 6 (post-6A): Electron wraps a main-side throw as "Error invoking remote method '<channel>':
// Error: <message>" — internal channel names must never reach a user. This is THE shared strip
// point: every invoke in this bridge routes through it, so every module benefits and no call site
// needs its own cleanup. The service's own message survives untouched.
function cleanIpcError(e: unknown): Error {
  const raw = e instanceof Error ? e.message : String(e);
  return new Error(
    raw.replace(/^Error invoking remote method '[^']+':\s*/, "").replace(/^(Error:\s*)+/, "")
  );
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function invoke(channel: string, ...args: unknown[]): Promise<any> {
  return ipcRenderer.invoke(channel, ...args).catch((e: unknown) => {
    throw cleanIpcError(e);
  });
}

const api: Api = {
  db: {
    tables: () => invoke("db:tables"),
    columns: (table: string) => invoke("db:columns", table),
    rows: (table: string, limit: number, offset: number, sortColumn?: string, sortDir?: "ASC" | "DESC") =>
      invoke("db:rows", table, limit, offset, sortColumn, sortDir),
    fks: (table: string) => invoke("db:fks", table),
  },
  // Artwork only. One call at mount hands over the label→domain map so a tile resolves locally;
  // there is deliberately no per-tile channel, which would put vault labels on an IPC hot path.
  brandpack: {
    map: () => invoke("brandpack:map"),
  },
  dataviewer: {
    getDevMode: () => invoke("dataviewer:getDevMode"),
    updateRow: (table: string, pkValue: unknown, changes: Record<string, unknown>) => invoke("dataviewer:updateRow", table, pkValue, changes),
    deleteRow: (table: string, pkValue: unknown) => invoke("dataviewer:deleteRow", table, pkValue),
    setDevMode: (on: boolean) => invoke("dataviewer:setDevMode", on),
  },
  getFirstRunStatus: () => invoke("firstRun:get"),
  /** Escape from a setup wizard — quits outright, never hides to tray (see electron/main.ts). */
  setupQuit: () => ipcRenderer.send("setup:quit"),
  /** The master password crosses ONCE, here, and is never sent back. */
  completeFirstRun: (orgName: string, masterPassword: string) => invoke("firstRun:complete", orgName, masterPassword),
  getModules: () => invoke("modules:get"),
  settings: {
    get: (key: string) => invoke("settings:get", key),
    set: (key: string, value: string) => invoke("settings:set", key, value),
  },
  theme: {
    applyOverlay: (mode: string) => invoke("theme:overlay", mode),
    setModalDim: (on: boolean | "viewer") => invoke("theme:modalDim", on),
  },
  storage: {
    locations: () => invoke("storage:locations"),
    pickRoot: () => invoke("storage:pickRoot"),
    changeRoot: (newRoot: string) => invoke("storage:changeRoot", newRoot),
    openFolder: (target: string) => invoke("storage:openFolder", target),
  },
  scout: {
    setVisible: (visible: boolean) => ipcRenderer.send("scout:visible", visible),
    updateBounds: (bounds: ScoutBounds) => ipcRenderer.send("scout:bounds", bounds),
    navigate: (url: string) => ipcRenderer.send("scout:navigate", url),
    switchClientTab: (clientId: string, url: string) => ipcRenderer.send("scout:switch-tab", clientId, url),
    goBack: () => ipcRenderer.send("scout:back"),
    goForward: () => ipcRenderer.send("scout:forward"),
    reload: () => ipcRenderer.send("scout:reload"),
    stop: () => ipcRenderer.send("scout:stop"),
    setModalState: (open: boolean) => ipcRenderer.send("scout:modal", open),
    setShellOverlay: (open: boolean) => ipcRenderer.send("scout:shell-overlay", open),
    domRead: () => invoke("scout:dom-read"),
    onSnapshot: (cb: (dataUrl: string) => void) => subscribe("scout:snapshot", cb),
    onTabReady: (cb: () => void) => subscribe("scout:tab-ready", cb),
    onUrlChanged: (cb: (info: { url: string; title: string }) => void) => subscribe("scout:url-changed", cb),
    onLoadingState: (cb: (loading: boolean) => void) => subscribe("scout:loading", cb),
    targets: {
      list: () => invoke("scout:targets:list"),
      create: (name: string, url: string) => invoke("scout:targets:create", name, url),
      update: (id: number, name: string, url: string) => invoke("scout:targets:update", id, name, url),
      remove: (id: number) => invoke("scout:targets:delete", id),
    },
  },
  mindmerge: {
    ensure: () => invoke("mindmerge:ensure"),
    list: (filter?: NoteFilter) => invoke("mindmerge:list", filter),
    get: (id: string) => invoke("mindmerge:get", id),
    search: (q: string) => invoke("mindmerge:search", q),
    listQuarantined: () => invoke("mindmerge:listQuarantined"),
    pickWatchFolder: () => invoke("mindmerge:pickWatchFolder"),
    rescan: () => invoke("mindmerge:rescan"),
  },
  scan: {
    listDrives: () => invoke("scan:listDrives"),
    listScannedDrives: () => invoke("scan:listScannedDrives"),
    selectSource: (rootPath: string, scanUnit: "drive" | "folder") =>
      invoke("scan:selectSource", rootPath, scanUnit),
    probe: (rootPath: string, scanUnit: "drive" | "folder") => invoke("scan:probe", rootPath, scanUnit),
    start: (runId: number) => invoke("scan:start", runId),
    pause: (runId: number) => invoke("scan:pause", runId),
    resume: (runId: number) => invoke("scan:resume", runId),
    abort: (runId: number) => invoke("scan:abort", runId),
    status: (runId: number) => invoke("scan:status", runId),
    listRuns: () => invoke("scan:listRuns"),
    lastRunForVolume: (serial: string) => invoke("scan:lastRunForVolume", serial),
    folders: (runId: number) => invoke("scan:folders", runId),
    writeReport: (runId: number) => invoke("scan:writeReport", runId),
    openReport: (runId: number) => invoke("scan:openReport", runId),
    openReportsFolder: (runId: number) => invoke("scan:openReportsFolder", runId),
    readReport: (runId: number) => invoke("scan:readReport", runId),
    listErrors: (runId: number) => invoke("scan:listErrors", runId),
    openPath: (target: string) => invoke("scan:openPath", target),
    folderCameras: (folderId: number) => invoke("scan:folderCameras", folderId),
    exportReportPdf: (runId: number, html: string, css: string) => invoke("scan:exportReportPdf", runId, html, css),
    exportReportCsv: (runId: number) => invoke("scan:exportReportCsv", runId),
      exportReportXlsx: (runId: number) => invoke("scan:exportReportXlsx", runId),
      revealExport: (p: string) => invoke("scan:revealExport", p),
    clearHistory: () => invoke("scan:clearHistory"),
    restoreHistory: () => invoke("scan:restoreHistory"),
    deleteHistoryForever: () => invoke("scan:deleteHistoryForever"),
    clearedHistoryCount: () => invoke("scan:clearedHistoryCount"),
    notes: {
      tree: () => invoke("scan:notesTree"),
      folders: (driveId: number, offset?: number, limit?: number) => invoke("scan:notesFolders", driveId, offset, limit),
      list: (driveId: number | null, folderPath?: string) => invoke("scan:notesList", driveId, folderPath),
      get: (uuid: string) => invoke("scan:notesGet", uuid),
      create: (driveId: number | null, folderPath: string, title?: string, body?: string) =>
        invoke("scan:notesCreate", driveId, folderPath, title, body),
      save: (uuid: string, title?: string, body?: string) => invoke("scan:notesSave", uuid, title, body),
      archive: (uuid: string) => invoke("scan:notesArchive", uuid),
      search: (q: string) => invoke("scan:notesSearch", q),
      searchFolders: (q: string) => invoke("scan:notesSearchFolders", q),
      card: (folderPath: string) => invoke("scan:notesCard", folderPath),
      history: (folderPath: string) => invoke("scan:notesHistory", folderPath),
      rename: (folderPath: string, newName: string) => invoke("scan:notesRename", folderPath, newName),
      pendingRenames: () => invoke("scan:notesPendingRenames"),
      updates: (limit?: number) => invoke("scan:notesUpdates", limit),
      recent: (limit?: number) => invoke("scan:notesRecent", limit),
      unseen: () => invoke("scan:notesUnseen"),
      markSeen: () => invoke("scan:notesMarkSeen"),
      sync: () => invoke("scan:notesSync"),
      shortcut: () => invoke("scan:notesShortcut"),
      localRoot: () => invoke("scan:notesLocalRoot"),
      media: (folderPath: string) => invoke("scan:notesMedia", folderPath),
      image: (target: string) => invoke("scan:notesImage", target),
      stillThumb: (target: string, token?: number) => invoke("scan:notesStillThumb", target, token),
      jobToken: () => invoke("scan:notesJobToken"),
      jobStats: (reset?: boolean) => invoke("scan:notesJobStats", reset === true),
      thumbsGet: (targets: string[]) => invoke("scan:thumbsGet", targets),
      thumbsPut: (target: string, dataUrl: string) => invoke("scan:thumbsPut", target, dataUrl),
      revealMedia: (target: string) => invoke("scan:revealMedia", target),
      thumbFailuresGet: (targets: string[]) => invoke("scan:thumbFailuresGet", targets),
      thumbFailurePut: (target: string, reason: string, detail: string) =>
        invoke("scan:thumbFailurePut", target, reason, detail),
      thumbFailuresClear: (targets: string[]) => invoke("scan:thumbFailuresClear", targets),
    },
  },
  identity: {
    get: () => invoke("identity:get"),
  },
  migrate: {
    registry: () => invoke("migrate:registry"),
    drives: () => invoke("migrate:drives"),
    pickFolders: () => invoke("migrate:pickFolders"),
    createJob: (opts: unknown) => invoke("migrate:createJob", opts),
    listJobs: () => invoke("migrate:listJobs"),
    jobSummary: (jobId: number) => invoke("migrate:jobSummary", jobId),
    jobItems: (jobId: number, extension: string | null) => invoke("migrate:jobItems", jobId, extension),
    setSelected: (payload: unknown) => invoke("migrate:setSelected", payload),
    abortJob: (jobId: number) => invoke("migrate:abortJob", jobId),
    bundlePreflight: (jobId: number, destRoot: string) => invoke("migrate:bundlePreflight", jobId, destRoot),
    startBundle: (jobId: number, destRoot: string) => invoke("migrate:startBundle", jobId, destRoot),
    listBundles: (jobId: number) => invoke("migrate:listBundles", jobId),
    openFolder: (p: string) => invoke("migrate:openFolder", p),
  },
  rename: {
    gather: (sources: string[]) => invoke("rename:gather", sources),
    isDriveRoot: (p: string) => invoke("rename:isDriveRoot", p),
    listBatches: () => invoke("rename:listBatches"),
    getBatch: (id: number) => invoke("rename:getBatch", id),
    batchSample: (id: number) => invoke("rename:batchSample", id),
    revertMapping: (id: number) => invoke("rename:revertMapping", id),
    start: (payload: unknown) => invoke("rename:start", payload),
    abort: (id: number) => invoke("rename:abort", id),
    startRevert: (payload: unknown) => invoke("rename:startRevert", payload),
    listPresets: () => invoke("rename:listPresets"),
    savePreset: (name: string, settings: unknown) => invoke("rename:savePreset", name, settings),
    deletePreset: (id: number) => invoke("rename:deletePreset", id),
    pickFolder: (title?: string) => invoke("rename:pickFolder", title),
    openFolder: (p: string) => invoke("rename:openFolder", p),
  },
  timetracker: {
    projects: {
      list: () => invoke("timetracker:listProjects"),
      create: (input: unknown) => invoke("timetracker:createProject", input),
      update: (input: unknown) => invoke("timetracker:updateProject", input),
      setColor: (id: number, color: string) => invoke("timetracker:setProjectColor", id, color),
      setGroup: (id: number, groupId: number | null) => invoke("timetracker:setProjectGroup", id, groupId),
      setTimeMode: (id: number, mode: string) => invoke("timetracker:setProjectTimeMode", id, mode),
      rename: (id: number, name: string) => invoke("timetracker:renameProject", id, name),
      reorder: (id: number, beforeProjectId: number | null) => invoke("timetracker:reorderProject", id, beforeProjectId),
      remove: (id: number) => invoke("timetracker:deleteProject", id),
      archive: (id: number, reason: string) => invoke("timetracker:archiveProject", id, reason),
      restore: (id: number) => invoke("timetracker:restoreProject", id),
      listArchived: () => invoke("timetracker:listArchivedProjects"),
      purge: (id: number, reason: string) => invoke("timetracker:purgeProject", id, reason),
      detail: (id: number) => invoke("timetracker:projectDetail", id),
      grandTotals: () => invoke("timetracker:grandTotals"),
      groupTotals: () => invoke("timetracker:groupTotals"),
      // completion (08-06) — the lock's two doors
      complete: (id: number) => invoke("timetracker:completeProject", id),
      reactivate: (id: number) => invoke("timetracker:reactivateProject", id),
      // contract details (08-06 profit build) — the modal's targeted save
      setContractDetails: (id: number, input: unknown) => invoke("timetracker:setContractDetails", id, input),
    },
    payments: {
      list: (projectId: number) => invoke("timetracker:listPayments", projectId),
      total: (projectId: number) => invoke("timetracker:paymentsTotal", projectId),
      add: (input: unknown) => invoke("timetracker:addPayment", input),
      void: (id: number) => invoke("timetracker:voidPayment", id),
    },
    invoice: {
      // Allocates INV-YYYY-NNNN on first call and returns every field the document composes.
      data: (projectId: number) => invoke("timetracker:invoiceData", projectId),
      // Renderer-composed HTML + stylesheet → hidden-window printToPDF (the Scan machinery).
      exportPdf: (projectId: number, html: string, css: string) =>
        invoke("timetracker:exportInvoicePdf", projectId, html, css),
    },
    groups: {
      list: () => invoke("timetracker:listGroups"),
      create: (name: string, color: string) => invoke("timetracker:createGroup", name, color),
      rename: (id: number, name: string) => invoke("timetracker:renameGroup", id, name),
      remove: (id: number) => invoke("timetracker:deleteGroup", id),
      reorder: (id: number, beforeGroupId: number | null) => invoke("timetracker:reorderGroup", id, beforeGroupId),
    },
    sidebar: {
      getSort: () => invoke("timetracker:getSidebarSort"),
      sort: (dir: "asc" | "desc") => invoke("timetracker:sortSidebar", dir),
    },
    costs: {
      list: (projectId: number) => invoke("timetracker:listCosts", projectId),
      add: (projectId: number, input: unknown) => invoke("timetracker:addCost", projectId, input),
      update: (id: number, input: unknown) => invoke("timetracker:updateCost", id, input),
      remove: (id: number) => invoke("timetracker:removeCost", id),
      openUrl: (id: number) => invoke("timetracker:openCostUrl", id),
    },
    settings: {
      get: () => invoke("timetracker:getSettings"),
      save: (settings: unknown) => invoke("timetracker:saveSettings", settings),
    },
    license: {
      get: () => invoke("timetracker:getLicense"),
      setKey: (raw: string) => invoke("timetracker:setLicenseKey", raw),
      setMarketplaceId: (raw: string) => invoke("timetracker:setMarketplaceId", raw),
    },
    financials: {
      items: (projectId: number) => invoke("timetracker:listProjectItems", projectId),
      addItem: (input: unknown) => invoke("timetracker:addProjectItem", input),
      updateItem: (id: number, input: unknown) => invoke("timetracker:updateProjectItem", id, input),
      removeItem: (id: number) => invoke("timetracker:removeProjectItem", id),
      members: (projectId: number) => invoke("timetracker:listProjectEmployees", projectId),
      addMember: (projectId: number, personId: number) => invoke("timetracker:addProjectEmployee", projectId, personId),
      removeMember: (projectId: number, personId: number) => invoke("timetracker:removeProjectEmployee", projectId, personId),
      spend: (projectId: number) => invoke("timetracker:projectSpend", projectId),
    },
    adjustments: {
      list: (projectId: number) => invoke("timetracker:listAdjustments", projectId),
      listAll: () => invoke("timetracker:listAllAdjustments"),
      create: (projectId: number, deltaMinutes: number, note: string) =>
        invoke("timetracker:createAdjustment", projectId, deltaMinutes, note),
      update: (uuid: string, deltaMinutes: number, note: string) =>
        invoke("timetracker:updateAdjustment", uuid, deltaMinutes, note),
      softDelete: (uuid: string) => invoke("timetracker:softDeleteAdjustment", uuid),
    },
    activity: {
      list: (opts?: { limit?: number; projectId?: number }) => invoke("timetracker:listActivity", opts ?? {}),
    },
    reports: {
      get: (range: string, granularity: string, projectId?: number | null) => invoke("timetracker:getReport", range, granularity, projectId ?? null),
      exportPdf: () => invoke("timetracker:exportAnalyticsPdf"),
      revealExportedPdf: (p: string) => invoke("timetracker:revealExportedPdf", p),
    },
    notes: {
      get: (projectId: number) => invoke("timetracker:getNote", projectId),
      save: (projectId: number, body: string) => invoke("timetracker:saveNote", projectId, body),
    },
    timer: {
      start: (projectId: number, note?: string | null) => invoke("timetracker:startTimer", projectId, note ?? null),
      pause: (sessionId: number) => invoke("timetracker:pauseTimer", sessionId),
      resume: (sessionId: number) => invoke("timetracker:resumeTimer", sessionId),
      stop: (sessionId: number, note: string | null) => invoke("timetracker:stopTimer", sessionId, note),
      stopAll: () => invoke("timetracker:stopAllTimers"),
      /** Overwrite the running session's packed quick notes (capture box + Session notes editor). */
      setSessionNote: (sessionId: number, note: string | null) =>
        invoke("timetracker:setSessionNote", sessionId, note),
      focus: (sessionId: number) => invoke("timetracker:focusTimer", sessionId),
      status: () => invoke("timetracker:timerStatus"),
      discardIdle: (sessionId: number, seconds: number) => invoke("timetracker:discardIdle", sessionId, seconds),
    },
    recovery: {
      list: () => invoke("timetracker:listInterrupted"),
      resume: (sessionId: number) => invoke("timetracker:recoverResume", sessionId),
      keep: (sessionId: number) => invoke("timetracker:recoverKeep", sessionId),
      discard: (sessionId: number) => invoke("timetracker:recoverDiscard", sessionId),
    },
    ledger: {
      // Append-only: the nuke channels are deregistered (Jason 07-31-2026) — list + add only.
      list: (projectId: number) => invoke("timetracker:listLedger", projectId),
      add: (projectId: number, amount: number, note: string | null) =>
        invoke("timetracker:addLedger", projectId, amount, note),
    },
    sounds: {
      list: () => invoke("timetracker:listSounds"),
      read: (id: string) => invoke("timetracker:readSound", id),
      readSelected: () => invoke("timetracker:readSelectedSound"),
      upload: () => invoke("timetracker:uploadSound"),
      rename: (id: string, displayName: string) => invoke("timetracker:renameSound", id, displayName),
      remove: (id: string) => invoke("timetracker:deleteSound", id),
      getSelected: () => invoke("timetracker:getSelectedSound"),
      select: (id: string) => invoke("timetracker:selectSound", id),
    },
    files: {
      pickContract: () => invoke("timetracker:pickContract"),
      openContract: (projectId: number) => invoke("timetracker:openContract", projectId),
    },
    mini: {
      toggle: () => invoke("timetracker:toggleMiniTimer"),
      state: () => invoke("timetracker:miniTimerState"),
    },
    attention: {
      snoozeBreak: () => invoke("timetracker:snoozeBreak"),
      resolveIdle: (discard: boolean) => invoke("timetracker:resolveIdle", discard),
    },
  },
  employees: {
    people: {
      list: () => invoke("employees:listPeople"),
      listArchived: () => invoke("employees:listArchivedPeople"),
      get: (id: number) => invoke("employees:getPerson", id),
      create: (input: unknown) => invoke("employees:createPerson", input),
      update: (id: number, input: unknown) => invoke("employees:updatePerson", id, input),
      archive: (id: number, reason: string) => invoke("employees:archivePerson", id, reason),
      restore: (id: number) => invoke("employees:restorePerson", id),
    },
    entries: {
      // No update and no delete: an entry is never rewritten — corrections are adjustments.
      create: (input: unknown) => invoke("employees:createEntry", input),
      listForPerson: (employeeId: number) => invoke("employees:listEntriesForPerson", employeeId),
      listForProject: (projectId: number) => invoke("employees:listEntriesForProject", projectId),
      listInRange: (fromDate: string, toDate: string) => invoke("employees:listEntriesInRange", fromDate, toDate),
    },
    sessions: {
      active: () => invoke("employees:activeSessions"),
      start: (input: unknown) => invoke("employees:startSession", input),
      stop: (sessionId: number, note?: string | null) => invoke("employees:stopSession", sessionId, note ?? null),
      cancel: (sessionId: number) => invoke("employees:cancelSession", sessionId),
    },
    tasks: {
      list: () => invoke("employees:listTasks"),
      listForPerson: (employeeId: number) => invoke("employees:listTasksForPerson", employeeId),
      create: (input: unknown) => invoke("employees:createTask", input),
      update: (id: number, input: unknown) => invoke("employees:updateTask", id, input),
      assign: (id: number, employeeId: number | null) => invoke("employees:assignTask", id, employeeId),
      setDone: (id: number, done: boolean) => invoke("employees:setTaskDone", id, done),
      remove: (id: number) => invoke("employees:removeTask", id), // SOFT delete
    },
    payments: {
      // Append-only: a mistake is a reversing row, so no update/delete channel exists to expose.
      list: (employeeId: number) => invoke("employees:listPayments", employeeId),
      listInRange: (fromDate: string, toDate: string) => invoke("employees:listPaymentsInRange", fromDate, toDate),
      record: (input: unknown) => invoke("employees:recordPayment", input),
      reverse: (uuid: string, note: string | null) => invoke("employees:reversePayment", uuid, note),
    },
    adjustments: {
      list: (employeeId: number) => invoke("employees:listAdjustments", employeeId),
      listAll: () => invoke("employees:listAllAdjustments"),
      createHours: (input: unknown) => invoke("employees:createHoursAdjustment", input),
      createAmount: (input: unknown) => invoke("employees:createAmountAdjustment", input),
      update: (uuid: string, deltaValue: number, note: string) =>
        invoke("employees:updateAdjustment", uuid, deltaValue, note),
      softDelete: (uuid: string) => invoke("employees:softDeleteAdjustment", uuid),
      restore: (uuid: string) => invoke("employees:restoreAdjustment", uuid),
    },
    reports: {
      costByProject: () => invoke("employees:costByProject"),
      costForProject: (projectId: number) => invoke("employees:costForProject", projectId),
      balance: (employeeId: number) => invoke("employees:balance", employeeId),
    },
    activity: {
      list: (opts?: { limit?: number; employeeId?: number }) => invoke("employees:listActivity", opts ?? {}),
    },
  },
  devseed: {
    status: () => invoke("devseed:status"),
    generate: (key: string) => invoke("devseed:generate", key),
    purge: () => invoke("devseed:purge"),
    previewPurge: () => invoke("devseed:previewPurge"),
    resetOrg: () => invoke("devseed:resetOrg"),
  },
  vault: {
    // The FULL module bridge (mounted 08-14-2026 from the standalone lane; the five-method thin
    // bridge is history). A credential still crosses on exactly ONE method — read(), access-logged
    // main-side with misses included — and every data channel refuses while the vault is locked.
    lockState: () => invoke("vault:lockState"),
    unlock: (password: string) => invoke("vault:unlock", password),
    lock: () => invoke("vault:lock"),
    changeMasterPassword: (current: string, next: string) => invoke("vault:changeMasterPassword", current, next),
    /** The boot wizard's trigger. Boolean only — no credential material crosses either way. */
    setupRequired: () => invoke("vault:setupRequired"),
    /** The wizard's one write: the one-time change presented as setup. The CURRENT password is
     *  re-derived main-side and never crosses this bridge — see vault/ipc.ts. */
    completeSetup: (next: string) => invoke("vault:completeSetup", next),
    devRevealInitial: () => invoke("vault:devRevealInitial"),
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
    // The clipboard funnel — copy with the vault's timed clear armed main-side.
    copyText: (text: string) => invoke("vault:copyText", text),
    // Pasted-image attachments — bytes in the vault, a vault:// reference in the note body.
    saveAttachment: (input: unknown) => invoke("vault:saveAttachment", input),
    getAttachment: (uuid: string) => invoke("vault:getAttachment", uuid),
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
  updater: {
    check: () => invoke("updater:check"),
    version: () => invoke("updater:version"),
  },
  tray: {
    // Persist the tray-on-close setting AND rewire the ✕ behaviour live (handled in main.ts).
    setEnabled: (enabled: boolean) => invoke("tray:setEnabled", enabled),
  },
  startup: {
    // Persist the open-at-login choice AND write/clear the OS login item (handled in main.ts).
    setEnabled: (enabled: boolean) => invoke("startup:setEnabled", enabled),
  },
  on: (channel: PushChannel, cb: (payload: never) => void) => {
    const w = (_e: Electron.IpcRendererEvent, payload: unknown) => (cb as (p: unknown) => void)(payload);
    wrapped.set(cb, w);
    ipcRenderer.on(safeChannel(channel), w);
  },
  off: (channel: PushChannel, cb: (payload: never) => void) => {
    const w = wrapped.get(cb);
    if (w) {
      ipcRenderer.removeListener(safeChannel(channel), w);
      wrapped.delete(cb);
    }
  },
  diag: {
    enabled: () => invoke("diag:enabled"),
    perModule: (m: Record<string, { renders: number; stateSets: number; subs: number }>) =>
      ipcRenderer.send("diag:perModule", m),
  },
};

contextBridge.exposeInMainWorld("api", api);
