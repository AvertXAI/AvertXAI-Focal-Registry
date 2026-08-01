/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Preload for the TimeTracker mini timer ONLY — a deliberately tiny bridge (window.miniApi), the
// update-preload precedent. This window never gets window.api: exactly the timer surface it needs.
// pause/resume/stopAll ride the EXISTING validated timetracker:* channels — no new mechanism.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

const on = <T,>(channel: string) => (cb: (payload: T) => void): (() => void) => {
  const handler = (_e: IpcRendererEvent, payload: T): void => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.off(channel, handler);
};

contextBridge.exposeInMainWorld("miniApi", {
  status: () => ipcRenderer.invoke("timetracker:timerStatus"),
  projects: () => ipcRenderer.invoke("timetracker:listProjects"), // colour dots come from here
  pause: (sessionId: number) => ipcRenderer.invoke("timetracker:pauseTimer", sessionId),
  resume: (sessionId: number) => ipcRenderer.invoke("timetracker:resumeTimer", sessionId),
  stop: (sessionId: number) => ipcRenderer.invoke("timetracker:stopTimer", sessionId, null),
  close: () => ipcRenderer.invoke("timetracker:closeMiniTimer"),
  onTick: on("timetracker:tick"),
  onChanged: on("timetracker:changed"),
});
