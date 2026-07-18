// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI RunBooks.Systems — CRM platform shell (skeleton)
// Description: contextBridge preload — exposes the typed window.api IPC surface to the renderer.
//              Trimmed to the shared spine: Data Viewer (db + dataviewer) + the dev-gated diag channel.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/preload.ts
//------------------------------------------------------------
import { contextBridge, ipcRenderer } from "electron";
import type { Api, CanonTemplatePayload, PushChannel, RunbookFilter, ScoutBounds } from "../../src/shared/types";

// Engine → module subscriptions strip the IpcRendererEvent and return an unsubscribe, so the React
// module can re-mount without stacking listeners (the standalone prototype never unmounted).
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: Electron.IpcRendererEvent, payload: T): void => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

// Distributor push events (api.on/off). A whitelist keeps arbitrary ipcRenderer access out of the
// page (contextIsolation); the wrapper map lets off() unhook the exact listener on() registered.
const PUSH_CHANNELS: readonly string[] = ["dist:synced", "updater:available", "updater:progress", "updater:downloaded"];
const wrapped = new Map<(payload: never) => void, (e: Electron.IpcRendererEvent, payload: unknown) => void>();
function safeChannel(channel: string): string {
  if (!PUSH_CHANNELS.includes(channel)) throw new Error(`Unknown push channel: ${channel}`);
  return channel;
}

const api: Api = {
  db: {
    tables: () => ipcRenderer.invoke("db:tables"),
    columns: (table: string) => ipcRenderer.invoke("db:columns", table),
    rows: (table: string, limit: number, offset: number) => ipcRenderer.invoke("db:rows", table, limit, offset),
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
  runbooks: {
    list: () => ipcRenderer.invoke("runbooks:list"),
    create: (title: string, description?: string) => ipcRenderer.invoke("runbooks:create", title, description),
  },
  shredder: {
    list: (filter?: RunbookFilter) => ipcRenderer.invoke("shredder:list", filter),
    get: (id: string) => ipcRenderer.invoke("shredder:get", id),
    search: (q: string) => ipcRenderer.invoke("shredder:search", q),
    listQuarantined: () => ipcRenderer.invoke("shredder:listQuarantined"),
    pickWatchFolder: () => ipcRenderer.invoke("shredder:pickWatchFolder"),
    rescan: () => ipcRenderer.invoke("shredder:rescan"),
  },
  dist: {
    getSource: () => ipcRenderer.invoke("dist:getSource"),
    setSource: (path: string) => ipcRenderer.invoke("dist:setSource", path),
    listTargets: () => ipcRenderer.invoke("dist:listTargets"),
    addTarget: (label: string, path: string) => ipcRenderer.invoke("dist:addTarget", label, path),
    setTargetEnabled: (uuid: string, on: boolean) => ipcRenderer.invoke("dist:setTargetEnabled", uuid, on),
    removeTarget: (uuid: string) => ipcRenderer.invoke("dist:removeTarget", uuid),
    setManifest: (uuid: string, templateId: number | null, agentIds: number[]) =>
      ipcRenderer.invoke("dist:setManifest", uuid, templateId, agentIds),
    syncNow: () => ipcRenderer.invoke("dist:syncNow"),
    getWatcher: () => ipcRenderer.invoke("dist:getWatcher"),
    setWatcher: (on: boolean) => ipcRenderer.invoke("dist:setWatcher", on),
    listLog: (limit?: number, before?: number) => ipcRenderer.invoke("dist:listLog", limit, before),
    countLog: () => ipcRenderer.invoke("dist:countLog"),
    nukeLog: () => ipcRenderer.invoke("dist:nukeLog"),
    history: () => ipcRenderer.invoke("dist:history"),
    nukeHistory: (project: string) => ipcRenderer.invoke("dist:nukeHistory", project),
    pickFolder: () => ipcRenderer.invoke("dist:pickFolder"),
  },
  templates: {
    list: () => ipcRenderer.invoke("templates:list"),
    get: (id: number) => ipcRenderer.invoke("templates:get", id),
    create: (payload: CanonTemplatePayload) => ipcRenderer.invoke("templates:create", payload),
    update: (id: number, payload: CanonTemplatePayload) => ipcRenderer.invoke("templates:update", id, payload),
    remove: (id: number) => ipcRenderer.invoke("templates:delete", id),
    writeToDisk: (id: number, overwrite?: boolean) => ipcRenderer.invoke("templates:writeToDisk", id, overwrite === true),
  },
  agents: {
    list: () => ipcRenderer.invoke("agents:list"),
    get: (id: number) => ipcRenderer.invoke("agents:get", id),
    remove: (id: number) => ipcRenderer.invoke("agents:delete", id),
    update: (id: number, body: string) => ipcRenderer.invoke("agents:update", id, body),
    setFavorite: (id: number, on: boolean) => ipcRenderer.invoke("agents:setFavorite", id, on),
    importFromFolders: (paths: string[]) => ipcRenderer.invoke("agents:importFromFolders", paths),
  },
  updater: {
    download: () => ipcRenderer.invoke("updater:download"),
    install: () => ipcRenderer.invoke("updater:install"),
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
