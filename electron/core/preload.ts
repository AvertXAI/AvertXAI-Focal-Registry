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
import type { Api, PushChannel, RunbookFilter, ScoutBounds } from "../../src/shared/types";

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
const PUSH_CHANNELS: readonly string[] = ["updater:available", "updater:progress", "updater:downloaded", "scan:progress", "scan:drives", "shredder:progress", "rename:progress"];
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
  shredder: {
    ensure: () => ipcRenderer.invoke("shredder:ensure"),
    list: (filter?: RunbookFilter) => ipcRenderer.invoke("shredder:list", filter),
    get: (id: string) => ipcRenderer.invoke("shredder:get", id),
    search: (q: string) => ipcRenderer.invoke("shredder:search", q),
    listQuarantined: () => ipcRenderer.invoke("shredder:listQuarantined"),
    pickWatchFolder: () => ipcRenderer.invoke("shredder:pickWatchFolder"),
    rescan: () => ipcRenderer.invoke("shredder:rescan"),
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
  updater: {
    download: () => ipcRenderer.invoke("updater:download"),
    install: () => ipcRenderer.invoke("updater:install"),
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
