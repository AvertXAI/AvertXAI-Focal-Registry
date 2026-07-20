// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry — photography archive tooling
// Description: Auto-updater — electron-updater, generic provider, prerelease channel (§3.12).
//              Automatic checks are fire-and-forget, armed only by boot:done, hard-capped at
//              10 seconds, and silent on failure — offline is a normal condition, not an error.
//              Manual checks (Settings button) always answer, including the failure case.
//              autoDownload OFF (consent-first): an automatic check that finds an update raises a
//              "Version X available" toast with a Download button — the user consents before any
//              download. Unsigned alpha builds mean the feed supplies its own SHA512, so consent is
//              the last human gate against a hostile feed. Install happens on quit.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/updater.ts
//------------------------------------------------------------
import { app, BrowserWindow, ipcMain, net } from "electron";
import { autoUpdater, type UpdateInfo } from "electron-updater";

const POST_BOOT_DELAY_MS = 30_000; // grace period after boot:done before the first automatic check
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // then every 6 hours
const CHECK_TIMEOUT_MS = 10_000; // hard cap on any check — on timeout: log, give up, next interval

let scheduled = false;

type CheckOutcome = { status: "available" | "none" | "error"; version?: string };

// Manual check — the user asked, so every outcome gets an answer. Resolved from the updater's own
// update-available / update-not-available / error events (no version math here), bounded by the
// hard timeout. Never rejects; the renderer always gets a status it can toast.
function manualCheck(): Promise<CheckOutcome> {
  if (!app.isPackaged) return Promise.resolve({ status: "none", version: app.getVersion() }); // dev build IS current
  if (!net.isOnline()) return Promise.resolve({ status: "error" }); // reachability guard — fail fast, no socket
  return new Promise((resolve) => {
    const done = (r: CheckOutcome): void => {
      clearTimeout(timer);
      autoUpdater.off("update-available", onAvailable);
      autoUpdater.off("update-not-available", onNone);
      autoUpdater.off("error", onError);
      resolve(r);
    };
    const onAvailable = (info: UpdateInfo): void => done({ status: "available", version: info.version });
    const onNone = (): void => done({ status: "none", version: app.getVersion() });
    const onError = (): void => done({ status: "error" });
    const timer = setTimeout(() => done({ status: "error" }), CHECK_TIMEOUT_MS);
    autoUpdater.on("update-available", onAvailable);
    autoUpdater.on("update-not-available", onNone);
    autoUpdater.on("error", onError);
    void autoUpdater.checkForUpdates().catch(() => {}); // failures arrive via the error event above
  });
}

// Automatic check — fire-and-forget; nothing awaits it and no UI ever results from a failure.
function autoCheck(): void {
  if (!net.isOnline()) {
    console.log("[updater] offline — skipping automatic check");
    return;
  }
  void Promise.race([
    autoUpdater.checkForUpdates(),
    new Promise((_, reject) => setTimeout(() => reject(new Error("updater-timeout")), CHECK_TIMEOUT_MS)),
  ]).catch((e: unknown) => {
    // Network errors already produce the single "error" handler log line; the race owns only the timeout.
    if (e instanceof Error && e.message === "updater-timeout") console.log("[updater] automatic check timed out");
  });
}

export function initUpdater(win: BrowserWindow): void {
  // The IPC surface registers in every build so the Settings button always answers; dev gets
  // canned results (manualCheck short-circuits) instead of "no handler" rejections.
  ipcMain.handle("updater:version", () => app.getVersion());
  ipcMain.handle("updater:check", () => manualCheck());
  ipcMain.handle("updater:download", async () => {
    await autoUpdater.downloadUpdate();
  });
  ipcMain.handle("updater:install", () => autoUpdater.quitAndInstall());

  if (!app.isPackaged) return; // no app-update.yml in dev — event wiring and the auto cycle are packaged-only

  // autoDownload FALSE — consent-first (Jason ruled 2026-07-20, reversing the earlier same-day
  // TRUE; see CANON-UPDATES). THE REASON, so it is never reopened: builds are UNSIGNED by design for
  // the alpha, so electron-updater validates only a SHA512 the FEED ITSELF supplies — an attacker
  // controlling the feed controls both the installer and its hash, so auto-download would be code
  // execution with no click. The consent button is the last human gate, and it costs one click.
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
  // Single log line, no stack, nothing sent — the user must never learn the network was down from us.
  autoUpdater.on("error", (e) => console.log("[updater]", e instanceof Error ? e.message : String(e)));
}

// Armed by the boot:done IPC in main.ts, so the automatic cycle can never race the boot sequence.
// boot:done can re-fire (Safe-Mode retry re-enters boot) — only the first arrival arms the timers.
export function notifyUpdaterBootDone(): void {
  if (scheduled || !app.isPackaged) return;
  scheduled = true;
  setTimeout(autoCheck, POST_BOOT_DELAY_MS);
  setInterval(autoCheck, RECHECK_INTERVAL_MS);
}
