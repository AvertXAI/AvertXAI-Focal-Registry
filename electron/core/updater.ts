// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry — photography archive tooling
// Description: Auto-updater — electron-updater, generic provider, prerelease channel (§3.12).
//              Packaged builds only. autoDownload OFF: the user consents before any download
//              (they may be on a slow or metered connection); install happens on quit. A failed
//              check logs and stays silent — the customer never sees an updater error dialog.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/updater.ts
//------------------------------------------------------------
import { app, BrowserWindow, ipcMain } from "electron";
import { autoUpdater } from "electron-updater";

const FIRST_CHECK_DELAY_MS = 30_000; // ~30 seconds after launch
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // then every 6 hours

export function initUpdater(win: BrowserWindow): void {
  // electron-updater throws without a packaged app-update.yml; dev runs skip the whole feature.
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  const send = (channel: string, payload: unknown): void => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  };

  autoUpdater.on("update-available", (info) =>
    send("updater:available", {
      version: info.version,
      notes: typeof info.releaseNotes === "string" ? info.releaseNotes : "",
    })
  );
  autoUpdater.on("download-progress", (p) => send("updater:progress", { percent: Math.round(p.percent) }));
  autoUpdater.on("update-downloaded", () => send("updater:downloaded", {}));
  // Log only, send nothing — a failed check must never surface a dialog to the customer.
  autoUpdater.on("error", (e) => console.error("[updater]", e));

  ipcMain.handle("updater:download", async () => {
    await autoUpdater.downloadUpdate();
  });
  ipcMain.handle("updater:install", () => autoUpdater.quitAndInstall());

  const check = (): void => {
    void autoUpdater.checkForUpdates().catch((e) => console.error("[updater] check failed:", e));
  };
  setTimeout(check, FIRST_CHECK_DELAY_MS);
  setInterval(check, RECHECK_INTERVAL_MS);
}
