/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Preload for the Software Update window ONLY — a deliberately tiny bridge (window.updateApi).
// This window never gets window.api: it needs exactly the update surface, nothing else.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

const on = <T,>(channel: string) => (cb: (payload: T) => void): (() => void) => {
  const handler = (_e: IpcRendererEvent, payload: T): void => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.off(channel, handler);
};

contextBridge.exposeInMainWorld("updateApi", {
  init: () => ipcRenderer.invoke("updwin:init"),
  details: () => ipcRenderer.invoke("updwin:details"),
  download: () => ipcRenderer.invoke("updwin:download"),
  install: () => ipcRenderer.send("updwin:install"),
  skip: () => ipcRenderer.send("updwin:skip"),
  later: () => ipcRenderer.send("updwin:later"),
  quit: () => ipcRenderer.send("updwin:quit"),
  openReleases: () => ipcRenderer.send("updwin:openReleases"),
  onState: on("updwin:state"),
  onProgress: on("updwin:progress"),
  onDownloaded: on("updwin:downloaded"),
});
