/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Secure preload — contextIsolation bridges. Exposes window.shell (shell stamp) AND, via
// the shared-spine preload imported below, window.api (the Data Viewer IPC channels). The two
// bridge keys are disjoint, so both coexist on the same renderer.
import { contextBridge, ipcRenderer } from "electron";
// Side-effect import: core/preload.ts calls exposeInMainWorld("api", …) on load.
import "./core/preload";

contextBridge.exposeInMainWorld("shell", {
  version: "0.1.0",
  phase: 0,
  // Boot edges — main flips the boot-dark frame + resize lock on these (re-entrant: Safe-Mode
  // Retry re-enters boot). Lives on the shell stamp bridge, NOT core/preload (un-gated work there).
  bootDone: () => ipcRenderer.send("boot:done"),
  bootStart: () => ipcRenderer.send("boot:start"),
});
