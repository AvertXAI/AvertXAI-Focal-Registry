// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: The Software Update window — a SEPARATE BrowserWindow (the app hides to tray, so an
//              in-app modal would be invisible then). Owns the updwin:* IPC surface, the update-mode
//              resolution (normal / required / unmaintained), and the skip-this-version persistence.
//              Consent-first: downloads start only from this window's buttons (§3.12 unchanged).
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/update-window.ts
//------------------------------------------------------------
import { app, BrowserWindow, ipcMain, net, shell } from "electron";
import path from "node:path";
import { autoUpdater } from "electron-updater";
import { baseFor, overlayFor } from "./windows";
import { getSetting, setSetting } from "./services/settings";

export type UpdateMode = "normal" | "required" | "unmaintained";
export interface UpdateWindowState {
  current: string;
  incoming: string;
  notes: string;
  mode: UpdateMode;
}

const parseVersion = (v: string): number[] => v.split(".").map((n) => parseInt(n, 10) || 0);

/** Mode policy: a higher MAJOR on the feed = required (Install now / Quit only). Same major but
 *  two-plus MINORS behind = unmaintained nag (Update now / Later). Anything else = normal offer. */
export function resolveUpdateMode(current: string, incoming: string): UpdateMode {
  const [curMajor, curMinor] = parseVersion(current);
  const [inMajor, inMinor] = parseVersion(incoming);
  if (inMajor > curMajor) return "required";
  if (inMajor === curMajor && inMinor - curMinor >= 2) return "unmaintained";
  return "normal";
}

/** The persisted skip — an automatic normal-mode check for this exact version stays silent.
 *  Read defensively: no org DB yet (first run) simply means nothing was skipped. */
export function skippedVersion(): string | null {
  try {
    return getSetting("update.skipped_version");
  } catch {
    return null;
  }
}

let updWin: BrowserWindow | null = null;
let state: UpdateWindowState | null = null;

// ---- Full-details fetch (MAIN process — Node/Chromium networking has no CORS restriction, so the
// feed needs no Access-Control header). Parses the incoming version's "### Details" section of
// REVISIONS.md at the feed root into structured groups; null on any failure (renderer shows its
// graceful "Details unavailable" line).
const REVISIONS_URL = "https://updates.focalregistry.com/REVISIONS.md";
const DETAILS_TIMEOUT_MS = 6_000;

export interface DetailGroup {
  head: string;
  items: string[];
}

function parseDetails(md: string, version: string): DetailGroup[] | null {
  const section = md.split(/^## /m).find((s) => s.startsWith(`${version} `) || s.startsWith(`${version}\n`));
  if (!section) return null;
  const details = section.split(/^### Details\s*$/m)[1];
  if (!details) return null;
  const groups: DetailGroup[] = [];
  let current: DetailGroup | null = null;
  for (const line of details.split("\n")) {
    const head = line.match(/^#### (.+)/);
    if (head) {
      current = { head: head[1].trim(), items: [] };
      groups.push(current);
      continue;
    }
    const bullet = line.match(/^- (.+)/);
    if (bullet && current) current.items.push(bullet[1].trim());
  }
  const filled = groups.filter((g) => g.items.length > 0);
  return filled.length ? filled : null;
}

async function fetchDetails(): Promise<DetailGroup[] | null> {
  if (!state) return null;
  try {
    const res = await net.fetch(REVISIONS_URL, { signal: AbortSignal.timeout(DETAILS_TIMEOUT_MS) });
    if (!res.ok) return null;
    return parseDetails(await res.text(), state.incoming);
  } catch {
    return null; // offline / timeout / bad body — the window falls back, never errors
  }
}

function themeMode(): string {
  try {
    const t = getSetting("theme_mode");
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

export function openUpdateWindow(next: UpdateWindowState): void {
  state = next;
  if (updWin && !updWin.isDestroyed()) {
    updWin.webContents.send("updwin:state", state);
    updWin.focus();
    return;
  }
  const theme = themeMode();
  updWin = new BrowserWindow({
    width: 560,
    height: 540,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: "Software Update",
    // Required mode: no close control — the only ways out are Install now or Quit.
    closable: next.mode !== "required",
    // Same frame treatment as the main window (main.ts): frameless + theme-colored overlay, so the
    // title strip matches the active theme from frame one — the NATIVE title bar follows the OS
    // dark/light mode, not ours, and painted dark over Light theme. Constructor-only, no runtime
    // writer; the in-page .upd-titlebar drag strip carries the "Software Update" text.
    backgroundColor: baseFor(theme),
    titleBarStyle: "hidden",
    titleBarOverlay: overlayFor(theme),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "update-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  updWin.setMenuBarVisibility(false);
  updWin.once("ready-to-show", () => updWin?.show());
  updWin.on("closed", () => {
    updWin = null;
  });
  void updWin.loadFile(path.join(__dirname, "../dist/update.html"), { query: { theme } });
}

/** Push a live event (progress / downloaded) into the window if it is open. */
export function forwardToUpdateWindow(channel: string, payload?: unknown): void {
  if (updWin && !updWin.isDestroyed()) updWin.webContents.send(channel, payload);
}

// Close from OUR buttons must work even in required mode (Install/Quit paths), so re-enable first.
function closeUpdateWindow(): void {
  if (updWin && !updWin.isDestroyed()) {
    updWin.setClosable(true);
    updWin.close();
  }
}

let registered = false;
export function registerUpdateWindowIpc(): void {
  if (registered) return;
  registered = true;
  ipcMain.handle("updwin:init", () => state);
  ipcMain.handle("updwin:details", () => fetchDetails());
  ipcMain.handle("updwin:download", async () => {
    // Dev preview has no feed — simulate a short download so the full flow is gateable on-device.
    if (!app.isPackaged) {
      for (let pct = 0; pct <= 100; pct += 20) {
        forwardToUpdateWindow("updwin:progress", { percent: pct, transferred: pct * 1_048_576, total: 104_857_600 });
        await new Promise((r) => setTimeout(r, 350));
      }
      forwardToUpdateWindow("updwin:downloaded");
      return;
    }
    await autoUpdater.downloadUpdate();
  });
  ipcMain.on("updwin:install", () => {
    if (!app.isPackaged) return; // dev preview: nothing to install
    autoUpdater.quitAndInstall();
  });
  ipcMain.on("updwin:skip", () => {
    if (state) {
      try {
        setSetting("update.skipped_version", state.incoming);
      } catch {
        /* no org DB — the skip simply doesn't persist */
      }
    }
    closeUpdateWindow();
  });
  ipcMain.on("updwin:later", () => closeUpdateWindow()); // next scheduled check re-offers
  ipcMain.on("updwin:quit", () => {
    // DESTROY, never close(): required mode is closable:false, and a swallowed close would abort the
    // quit sweep leaving the app alive. main.ts's listener on this channel already set isQuitting.
    if (updWin && !updWin.isDestroyed()) updWin.destroy();
    app.quit();
  });
  ipcMain.on("updwin:openReleases", () => void shell.openExternal("https://focalregistry.com/releases"));
}

/** DEV-ONLY preview (packaged builds ignore it): UPDATE_WINDOW_DEV=1|required|unmaintained opens
 *  the window with fake state so the three themes can be device-gated without a live feed. */
export function maybeOpenDevUpdateWindow(): void {
  const flag = process.env.UPDATE_WINDOW_DEV;
  if (app.isPackaged || !flag) return;
  const mode: UpdateMode = flag === "required" || flag === "unmaintained" ? flag : "normal";
  const incoming = mode === "required" ? "1.0.0" : mode === "unmaintained" ? "0.4.0" : "0.2.4";
  setTimeout(() => {
    openUpdateWindow({
      current: app.getVersion(),
      incoming,
      notes:
        "Dev preview of the Software Update window. At real runtime this summary comes from the update feed's releaseNotes field, which release.mjs fills from REVISIONS.md.",
      mode,
    });
  }, 1500);
}
