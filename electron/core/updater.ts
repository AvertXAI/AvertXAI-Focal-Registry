// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry — photography archive tooling
// Description: Auto-updater — electron-updater, generic provider, prerelease channel (§3.12).
//              Automatic checks are fire-and-forget, armed only by boot:done, hard-capped at
//              10 seconds, and silent on failure — offline is a normal condition, not an error.
//              Manual checks (Settings button) always answer, including the failure case.
//              autoDownload OFF (consent-first): an available update opens the dedicated Software
//              Update window (update-window.ts) — the user consents there before any download.
//              Unsigned alpha builds mean the feed supplies its own SHA512, so consent is
//              the last human gate against a hostile feed. Install happens on quit.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/updater.ts
//------------------------------------------------------------
import { app, ipcMain, net } from "electron";
import { autoUpdater, type UpdateInfo } from "electron-updater";
import {
  forwardToUpdateWindow,
  maybeOpenDevUpdateWindow,
  openUpdateWindow,
  registerUpdateWindowIpc,
  resolveUpdateMode,
  skippedVersion,
} from "./update-window";

const POST_BOOT_DELAY_MS = 30_000; // grace period after boot:done before the first automatic check
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // then every 6 hours
const CHECK_TIMEOUT_MS = 10_000; // hard cap on any check — on timeout: log, give up, next interval

let scheduled = false;
// True while a Settings-button check is in flight — the persistent update-available handler uses it
// to override "Skip this version" (a manual check is an explicit ask; automatic checks honor skips).
let manualInFlight = false;

type CheckOutcome = { status: "available" | "none" | "error"; version?: string };

// Manual check — the user asked, so every outcome gets an answer. Resolved from the updater's own
// update-available / update-not-available / error events (no version math here), bounded by the
// hard timeout. Never rejects; the renderer always gets a status it can toast.
function manualCheck(): Promise<CheckOutcome> {
  if (!app.isPackaged) return Promise.resolve({ status: "none", version: app.getVersion() }); // dev build IS current
  if (!net.isOnline()) return Promise.resolve({ status: "error" }); // reachability guard — fail fast, no socket
  manualInFlight = true;
  return new Promise((resolve) => {
    const done = (r: CheckOutcome): void => {
      manualInFlight = false;
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

export function initUpdater(): void {
  // The IPC surfaces register in every build so the Settings button always answers; dev gets
  // canned results (manualCheck short-circuits) instead of "no handler" rejections. Download/install
  // live on the Software Update window's own updwin:* surface (update-window.ts), not here.
  ipcMain.handle("updater:version", () => app.getVersion());
  ipcMain.handle("updater:check", () => manualCheck());
  registerUpdateWindowIpc();
  maybeOpenDevUpdateWindow(); // no-op unless dev AND UPDATE_WINDOW_DEV is set

  if (!app.isPackaged) return; // no app-update.yml in dev — event wiring and the auto cycle are packaged-only

  // autoDownload FALSE — consent-first (Jason ruled 2026-07-20, reversing the earlier same-day
  // TRUE; see CANON-UPDATES). THE REASON, so it is never reopened: builds are UNSIGNED by design for
  // the alpha, so electron-updater validates only a SHA512 the FEED ITSELF supplies — an attacker
  // controlling the feed controls both the installer and its hash, so auto-download would be code
  // execution with no click. The consent button is the last human gate, and it costs one click.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // An available update opens the dedicated Software Update window (a SEPARATE BrowserWindow — the
  // app hides to tray, where an in-app toast/modal would never be seen). Mode policy + skip logic:
  // - required (feed major > running major) and unmaintained (2+ minors behind) ALWAYS show;
  // - a version the user chose "Skip this version" on stays silent for AUTOMATIC checks only —
  //   a manual Settings check is an explicit ask and re-offers it.
  autoUpdater.on("update-available", (info) => {
    const current = app.getVersion();
    const mode = resolveUpdateMode(current, info.version);
    if (mode === "normal" && !manualInFlight && skippedVersion() === info.version) return;
    openUpdateWindow({
      current,
      incoming: info.version,
      notes: typeof info.releaseNotes === "string" ? info.releaseNotes : "",
      mode,
    });
  });
  autoUpdater.on("download-progress", (p) =>
    forwardToUpdateWindow("updwin:progress", {
      percent: Math.round(p.percent),
      transferred: p.transferred,
      total: p.total,
    })
  );
  autoUpdater.on("update-downloaded", () => forwardToUpdateWindow("updwin:downloaded"));
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
