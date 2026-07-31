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
const PUSH_CHANNELS: readonly string[] = ["scan:progress", "scan:drives", "mindmerge:progress", "rename:progress", "migrate:progress", "timetracker:tick", "timetracker:changed"];
const wrapped = new Map<(payload: never) => void, (e: Electron.IpcRendererEvent, payload: unknown) => void>();
function safeChannel(channel: string): string {
  if (!PUSH_CHANNELS.includes(channel)) throw new Error(`Unknown push channel: ${channel}`);
  return channel;
}

const api: Api = {
  db: {
    tables: () => ipcRenderer.invoke("db:tables"),
    columns: (table: string) => ipcRenderer.invoke("db:columns", table),
    rows: (table: string, limit: number, offset: number, sortColumn?: string, sortDir?: "ASC" | "DESC") =>
      ipcRenderer.invoke("db:rows", table, limit, offset, sortColumn, sortDir),
    fks: (table: string) => ipcRenderer.invoke("db:fks", table),
  },
  dataviewer: {
    getDevMode: () => ipcRenderer.invoke("dataviewer:getDevMode"),
    setDevMode: (on: boolean) => ipcRenderer.invoke("dataviewer:setDevMode", on),
  },
  getFirstRunStatus: () => ipcRenderer.invoke("firstRun:get"),
  completeFirstRun: (orgName: string) => ipcRenderer.invoke("firstRun:complete", orgName),
  getModules: () => ipcRenderer.invoke("modules:get"),
  settings: {
    get: (key: string) => ipcRenderer.invoke("settings:get", key),
    set: (key: string, value: string) => ipcRenderer.invoke("settings:set", key, value),
  },
  theme: {
    applyOverlay: (mode: string) => ipcRenderer.invoke("theme:overlay", mode),
    setModalDim: (on: boolean) => ipcRenderer.invoke("theme:modalDim", on),
  },
  storage: {
    locations: () => ipcRenderer.invoke("storage:locations"),
    pickRoot: () => ipcRenderer.invoke("storage:pickRoot"),
    changeRoot: (newRoot: string) => ipcRenderer.invoke("storage:changeRoot", newRoot),
    openFolder: (target: string) => ipcRenderer.invoke("storage:openFolder", target),
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
    domRead: () => ipcRenderer.invoke("scout:dom-read"),
    onSnapshot: (cb: (dataUrl: string) => void) => subscribe("scout:snapshot", cb),
    onTabReady: (cb: () => void) => subscribe("scout:tab-ready", cb),
    onUrlChanged: (cb: (info: { url: string; title: string }) => void) => subscribe("scout:url-changed", cb),
    onLoadingState: (cb: (loading: boolean) => void) => subscribe("scout:loading", cb),
    targets: {
      list: () => ipcRenderer.invoke("scout:targets:list"),
      create: (name: string, url: string) => ipcRenderer.invoke("scout:targets:create", name, url),
      update: (id: number, name: string, url: string) => ipcRenderer.invoke("scout:targets:update", id, name, url),
      remove: (id: number) => ipcRenderer.invoke("scout:targets:delete", id),
    },
  },
  mindmerge: {
    ensure: () => ipcRenderer.invoke("mindmerge:ensure"),
    list: (filter?: NoteFilter) => ipcRenderer.invoke("mindmerge:list", filter),
    get: (id: string) => ipcRenderer.invoke("mindmerge:get", id),
    search: (q: string) => ipcRenderer.invoke("mindmerge:search", q),
    listQuarantined: () => ipcRenderer.invoke("mindmerge:listQuarantined"),
    pickWatchFolder: () => ipcRenderer.invoke("mindmerge:pickWatchFolder"),
    rescan: () => ipcRenderer.invoke("mindmerge:rescan"),
  },
  scan: {
    listDrives: () => ipcRenderer.invoke("scan:listDrives"),
    listScannedDrives: () => ipcRenderer.invoke("scan:listScannedDrives"),
    selectSource: (rootPath: string, scanUnit: "drive" | "folder") =>
      ipcRenderer.invoke("scan:selectSource", rootPath, scanUnit),
    probe: (rootPath: string, scanUnit: "drive" | "folder") => ipcRenderer.invoke("scan:probe", rootPath, scanUnit),
    start: (runId: number) => ipcRenderer.invoke("scan:start", runId),
    pause: (runId: number) => ipcRenderer.invoke("scan:pause", runId),
    resume: (runId: number) => ipcRenderer.invoke("scan:resume", runId),
    abort: (runId: number) => ipcRenderer.invoke("scan:abort", runId),
    status: (runId: number) => ipcRenderer.invoke("scan:status", runId),
    listRuns: () => ipcRenderer.invoke("scan:listRuns"),
    lastRunForVolume: (serial: string) => ipcRenderer.invoke("scan:lastRunForVolume", serial),
    folders: (runId: number) => ipcRenderer.invoke("scan:folders", runId),
    writeReport: (runId: number) => ipcRenderer.invoke("scan:writeReport", runId),
    openReport: (runId: number) => ipcRenderer.invoke("scan:openReport", runId),
    openReportsFolder: (runId: number) => ipcRenderer.invoke("scan:openReportsFolder", runId),
    readReport: (runId: number) => ipcRenderer.invoke("scan:readReport", runId),
    listErrors: (runId: number) => ipcRenderer.invoke("scan:listErrors", runId),
    openPath: (target: string) => ipcRenderer.invoke("scan:openPath", target),
    folderCameras: (folderId: number) => ipcRenderer.invoke("scan:folderCameras", folderId),
    exportReportPdf: (runId: number, html: string, css: string) => ipcRenderer.invoke("scan:exportReportPdf", runId, html, css),
    exportReportCsv: (runId: number) => ipcRenderer.invoke("scan:exportReportCsv", runId),
    clearHistory: () => ipcRenderer.invoke("scan:clearHistory"),
    restoreHistory: () => ipcRenderer.invoke("scan:restoreHistory"),
    deleteHistoryForever: () => ipcRenderer.invoke("scan:deleteHistoryForever"),
    clearedHistoryCount: () => ipcRenderer.invoke("scan:clearedHistoryCount"),
  },
  identity: {
    get: () => ipcRenderer.invoke("identity:get"),
  },
  migrate: {
    registry: () => ipcRenderer.invoke("migrate:registry"),
    drives: () => ipcRenderer.invoke("migrate:drives"),
    pickFolders: () => ipcRenderer.invoke("migrate:pickFolders"),
    createJob: (opts: unknown) => ipcRenderer.invoke("migrate:createJob", opts),
    listJobs: () => ipcRenderer.invoke("migrate:listJobs"),
    jobSummary: (jobId: number) => ipcRenderer.invoke("migrate:jobSummary", jobId),
    jobItems: (jobId: number, extension: string | null) => ipcRenderer.invoke("migrate:jobItems", jobId, extension),
    setSelected: (payload: unknown) => ipcRenderer.invoke("migrate:setSelected", payload),
    abortJob: (jobId: number) => ipcRenderer.invoke("migrate:abortJob", jobId),
    bundlePreflight: (jobId: number, destRoot: string) => ipcRenderer.invoke("migrate:bundlePreflight", jobId, destRoot),
    startBundle: (jobId: number, destRoot: string) => ipcRenderer.invoke("migrate:startBundle", jobId, destRoot),
    listBundles: (jobId: number) => ipcRenderer.invoke("migrate:listBundles", jobId),
    openFolder: (p: string) => ipcRenderer.invoke("migrate:openFolder", p),
  },
  rename: {
    gather: (sources: string[]) => ipcRenderer.invoke("rename:gather", sources),
    isDriveRoot: (p: string) => ipcRenderer.invoke("rename:isDriveRoot", p),
    listBatches: () => ipcRenderer.invoke("rename:listBatches"),
    getBatch: (id: number) => ipcRenderer.invoke("rename:getBatch", id),
    batchSample: (id: number) => ipcRenderer.invoke("rename:batchSample", id),
    revertMapping: (id: number) => ipcRenderer.invoke("rename:revertMapping", id),
    start: (payload: unknown) => ipcRenderer.invoke("rename:start", payload),
    abort: (id: number) => ipcRenderer.invoke("rename:abort", id),
    startRevert: (payload: unknown) => ipcRenderer.invoke("rename:startRevert", payload),
    listPresets: () => ipcRenderer.invoke("rename:listPresets"),
    savePreset: (name: string, settings: unknown) => ipcRenderer.invoke("rename:savePreset", name, settings),
    deletePreset: (id: number) => ipcRenderer.invoke("rename:deletePreset", id),
    pickFolder: (title?: string) => ipcRenderer.invoke("rename:pickFolder", title),
    openFolder: (p: string) => ipcRenderer.invoke("rename:openFolder", p),
  },
  timetracker: {
    projects: {
      list: () => ipcRenderer.invoke("timetracker:listProjects"),
      create: (input: unknown) => ipcRenderer.invoke("timetracker:createProject", input),
      update: (input: unknown) => ipcRenderer.invoke("timetracker:updateProject", input),
      setColor: (id: number, color: string) => ipcRenderer.invoke("timetracker:setProjectColor", id, color),
      setGroup: (id: number, groupId: number | null) => ipcRenderer.invoke("timetracker:setProjectGroup", id, groupId),
      setTimeMode: (id: number, mode: string) => ipcRenderer.invoke("timetracker:setProjectTimeMode", id, mode),
      rename: (id: number, name: string) => ipcRenderer.invoke("timetracker:renameProject", id, name),
      reorder: (id: number, beforeProjectId: number | null) => ipcRenderer.invoke("timetracker:reorderProject", id, beforeProjectId),
      remove: (id: number) => ipcRenderer.invoke("timetracker:deleteProject", id),
      archive: (id: number, reason: string) => ipcRenderer.invoke("timetracker:archiveProject", id, reason),
      restore: (id: number) => ipcRenderer.invoke("timetracker:restoreProject", id),
      listArchived: () => ipcRenderer.invoke("timetracker:listArchivedProjects"),
      purge: (id: number, reason: string) => ipcRenderer.invoke("timetracker:purgeProject", id, reason),
      detail: (id: number) => ipcRenderer.invoke("timetracker:projectDetail", id),
      grandTotals: () => ipcRenderer.invoke("timetracker:grandTotals"),
      groupTotals: () => ipcRenderer.invoke("timetracker:groupTotals"),
    },
    groups: {
      list: () => ipcRenderer.invoke("timetracker:listGroups"),
      create: (name: string, color: string) => ipcRenderer.invoke("timetracker:createGroup", name, color),
      rename: (id: number, name: string) => ipcRenderer.invoke("timetracker:renameGroup", id, name),
      remove: (id: number) => ipcRenderer.invoke("timetracker:deleteGroup", id),
      reorder: (id: number, beforeGroupId: number | null) => ipcRenderer.invoke("timetracker:reorderGroup", id, beforeGroupId),
    },
    sidebar: {
      getSort: () => ipcRenderer.invoke("timetracker:getSidebarSort"),
      sort: (dir: "asc" | "desc") => ipcRenderer.invoke("timetracker:sortSidebar", dir),
    },
    costs: {
      list: (projectId: number) => ipcRenderer.invoke("timetracker:listCosts", projectId),
      add: (projectId: number, input: unknown) => ipcRenderer.invoke("timetracker:addCost", projectId, input),
      update: (id: number, input: unknown) => ipcRenderer.invoke("timetracker:updateCost", id, input),
      remove: (id: number) => ipcRenderer.invoke("timetracker:removeCost", id),
      openUrl: (id: number) => ipcRenderer.invoke("timetracker:openCostUrl", id),
    },
    settings: {
      get: () => ipcRenderer.invoke("timetracker:getSettings"),
      save: (settings: unknown) => ipcRenderer.invoke("timetracker:saveSettings", settings),
    },
    adjustments: {
      list: (projectId: number) => ipcRenderer.invoke("timetracker:listAdjustments", projectId),
      listAll: () => ipcRenderer.invoke("timetracker:listAllAdjustments"),
      create: (projectId: number, deltaMinutes: number, note: string) =>
        ipcRenderer.invoke("timetracker:createAdjustment", projectId, deltaMinutes, note),
      update: (uuid: string, deltaMinutes: number, note: string) =>
        ipcRenderer.invoke("timetracker:updateAdjustment", uuid, deltaMinutes, note),
      softDelete: (uuid: string) => ipcRenderer.invoke("timetracker:softDeleteAdjustment", uuid),
    },
    activity: {
      list: (opts?: { limit?: number; projectId?: number }) => ipcRenderer.invoke("timetracker:listActivity", opts ?? {}),
    },
    reports: {
      get: (range: string, granularity: string) => ipcRenderer.invoke("timetracker:getReport", range, granularity),
    },
    notes: {
      get: (projectId: number) => ipcRenderer.invoke("timetracker:getNote", projectId),
      save: (projectId: number, body: string) => ipcRenderer.invoke("timetracker:saveNote", projectId, body),
    },
    timer: {
      start: (projectId: number, note?: string | null) => ipcRenderer.invoke("timetracker:startTimer", projectId, note ?? null),
      pause: (sessionId: number) => ipcRenderer.invoke("timetracker:pauseTimer", sessionId),
      resume: (sessionId: number) => ipcRenderer.invoke("timetracker:resumeTimer", sessionId),
      stop: (sessionId: number, note: string | null) => ipcRenderer.invoke("timetracker:stopTimer", sessionId, note),
      stopAll: () => ipcRenderer.invoke("timetracker:stopAllTimers"),
      focus: (sessionId: number) => ipcRenderer.invoke("timetracker:focusTimer", sessionId),
      status: () => ipcRenderer.invoke("timetracker:timerStatus"),
      discardIdle: (sessionId: number, seconds: number) => ipcRenderer.invoke("timetracker:discardIdle", sessionId, seconds),
    },
    recovery: {
      list: () => ipcRenderer.invoke("timetracker:listInterrupted"),
      resume: (sessionId: number) => ipcRenderer.invoke("timetracker:recoverResume", sessionId),
      keep: (sessionId: number) => ipcRenderer.invoke("timetracker:recoverKeep", sessionId),
      discard: (sessionId: number) => ipcRenderer.invoke("timetracker:recoverDiscard", sessionId),
    },
    ledger: {
      // Append-only: the nuke channels are deregistered (Jason 07-31-2026) — list + add only.
      list: (projectId: number) => ipcRenderer.invoke("timetracker:listLedger", projectId),
      add: (projectId: number, amount: number, note: string | null) =>
        ipcRenderer.invoke("timetracker:addLedger", projectId, amount, note),
    },
    sounds: {
      list: () => ipcRenderer.invoke("timetracker:listSounds"),
      read: (id: string) => ipcRenderer.invoke("timetracker:readSound", id),
      readSelected: () => ipcRenderer.invoke("timetracker:readSelectedSound"),
      upload: () => ipcRenderer.invoke("timetracker:uploadSound"),
      rename: (id: string, displayName: string) => ipcRenderer.invoke("timetracker:renameSound", id, displayName),
      remove: (id: string) => ipcRenderer.invoke("timetracker:deleteSound", id),
      getSelected: () => ipcRenderer.invoke("timetracker:getSelectedSound"),
      select: (id: string) => ipcRenderer.invoke("timetracker:selectSound", id),
    },
    files: {
      pickContract: () => ipcRenderer.invoke("timetracker:pickContract"),
      openContract: (projectId: number) => ipcRenderer.invoke("timetracker:openContract", projectId),
    },
  },
  updater: {
    check: () => ipcRenderer.invoke("updater:check"),
    version: () => ipcRenderer.invoke("updater:version"),
  },
  tray: {
    // Persist the tray-on-close setting AND rewire the ✕ behaviour live (handled in main.ts).
    setEnabled: (enabled: boolean) => ipcRenderer.invoke("tray:setEnabled", enabled),
  },
  startup: {
    // Persist the open-at-login choice AND write/clear the OS login item (handled in main.ts).
    setEnabled: (enabled: boolean) => ipcRenderer.invoke("startup:setEnabled", enabled),
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
    enabled: () => ipcRenderer.invoke("diag:enabled"),
    perModule: (m: Record<string, { renders: number; stateSets: number; subs: number }>) =>
      ipcRenderer.send("diag:perModule", m),
  },
};

contextBridge.exposeInMainWorld("api", api);
