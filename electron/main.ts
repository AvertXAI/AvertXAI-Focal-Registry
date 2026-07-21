/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// RunBooks — the ONE Electron main process. Hosts the platform shell window and the
// shared spine: the local SQLite org DB (focalregistry_{org_id}.db) and the Data Viewer IPC channels.
import { app, BrowserWindow, ipcMain, Menu, nativeImage, shell, Tray } from "electron";
import path from "node:path";
import { getDb, initDb, openDb } from "./core/services/db";
import { migrateOrgDbSlugs } from "./core/services/db/migrate";
import { getActiveOrg, initRegistry } from "./core/services/db/registry";
import { getSetting, setSetting } from "./core/services/settings";
import { deriveVaultKey, getOrCreateVaultSecret } from "./core/services/vault/crypto";
import { registerIpcHandlers } from "./core/ipc";
import { applyThemeOverlay, baseFor, getMainWindow, MIN_HEIGHT, MIN_WIDTH, overlayFor, setBooting, setMainWindow, showMain } from "./core/windows";
import { initUpdater, notifyUpdaterBootDone } from "./core/updater";
import { initDiag } from "./diag";

// ── REVERTIBLE GPU-BACKEND EXPERIMENT (resize-band probe) — REMOVE WHEN DONE ──
// Override the graphics backend by setting MC_GPU before launch:
//   warp   → software ANGLE (Windows Advanced Rasterization Platform)
//   gl     → OpenGL ANGLE backend
//   vulkan → Vulkan ANGLE backend
//   off    → disable hardware acceleration entirely
//   (unset)→ default Direct3D 11 behavior (NO change)
const mcGpu = process.env.MC_GPU;
console.log("[MC_GPU] backend =", mcGpu ?? "default(d3d11)");
if (mcGpu === "off") {
  app.disableHardwareAcceleration();
} else if (mcGpu === "warp" || mcGpu === "gl" || mcGpu === "vulkan") {
  app.commandLine.appendSwitch("use-angle", mcGpu);
}
// ─────────────────────────────────────────────────────────────────────────────

// Boot theme — resolved from the org DB BEFORE the window is created, so the very first frame
// (constructor backgroundColor + native overlay) is already the persisted theme. No org / read
// failure -> "system" (Hybrid). The renderer receives it via the loadFile query param.
let bootThemeMode = "system";
// Skip-Fast-Boot, read at boot and handed to the renderer via ?skipBoot= so it can decide BEFORE the
// first paint not to render the JARVIS terminal — otherwise the dark terminal flashes for a frame
// before the async setting read bypasses it.
let bootSkip = false;
function readBootTheme(): string {
  try {
    const row = getDb().prepare("SELECT value FROM app_settings WHERE key = 'theme_mode'").get() as
      | { value: string }
      | undefined;
    return row?.value === "light" || row?.value === "dark" ? row.value : "system";
  } catch {
    return "system"; // no org DB yet (first run) — hybrid default, never hang
  }
}
// AvertXAI mark (multi-res .ico) — window + taskbar icon.
const APP_ICON = path.join(__dirname, "../build/icon.ico");

// Tray icon — embedded 32x32 PNG (no asset file needed; survives packaging).
const TRAY_ICON = nativeImage.createFromDataURL(
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAB40lEQVR4nO1XW0rDQBQ9SfOgRbCaqv++in99iU1chO5BcBNCQQRxDYJLEEH81AU0dQGmv0qL0hYFwUdj4ofaaSfJZFLTKuj9yszcnHvuuTM3E+Cvm8Ba3Np+cOMIcnQ4GRjHdyGuwDxExHEFD8IWwxxGTcKjwLitV5Mo2c/Oitjfm/DMV3Yf0Wg4XBhf+2EoBQxd9p8vK5GxIhMQBEBf8ydQXpMhRkSMTCC7LEHTyGu2TdbSaQErK9JoCdDyH588D4zXA8oTCwFVFVAskAw7HQfnF6+4uyMbL5eTkUwyG+zwBIp5CapKwM2aDdcFzMtub06RgVKRvwyRCNDyV82PwKbZpfz4TwM3gekpEdksyazZdHB98wYAaDQd3Hw+A8DSYgIzM3zQ3AR0XYbQV9oqlXW1Zg+MjTLfZuQuFg24uaFic0MN9Nd1GadnL3BD+iuXAgvzCczNRTuxGU3E8lIi1I9LAXrz7VQecXvr7fkZTcTBPvlGGLoCq/7ExA5NS5KA1RIhcH/v+gYHgFbbQatN1kpFCYrC7gmhBPI5GakUAbmybIY3YFnkNKiqgEKeLXIoAVp+q84mQBNcN9inYaj7QBz2rftAnNYjwLo6x239sX6PAsB4VKBjeBQYJQk/7B//Nfu3d89aiCAAVaB3AAAAAElFTkSuQmCC"
);

// Hide-to-tray lifecycle: the native ✕ hides the window (the app keeps running in the tray for the
// Distributor watcher / Jarvis); only the tray "Quit" flips this so a real quit fires before-quit.
let isQuitting = false;
// Any real app.quit() — tray Exit or the updater's quitAndInstall — must win over hide-to-tray.
// before-quit fires ahead of window close; ✕ never calls app.quit(), so hide-to-tray is unaffected.
app.on("before-quit", () => {
  isQuitting = true;
});
// Held so the OS doesn't garbage-collect the tray; process exit clears it (no destroy needed).
let tray: Tray | null = null;
// Tray-on-close is a USER SETTING (§3.11), DEFAULT ON. ON → ✕ hides to tray, process stays alive.
// OFF → ✕ genuinely quits, no background process, no tray icon. The close handler reads this LIVE, so
// flipping the toggle rewires behaviour with no restart.
let trayEnabled = true;

// Single-instance lock — a second launch focuses the existing window instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showMain());
}

function openExternally(url: string): void {
  if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
}

// Footer/external links open in the system browser; all in-app navigation is denied.
function hardenWebContents(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    event.preventDefault();
    openExternally(url);
  });
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: MIN_WIDTH, // shared floor (windows.ts, Jason-approved 740), re-asserted after boot unlock
    minHeight: MIN_HEIGHT,
    resizable: false, // boot-window lock — boot:done (setBooting(false)) re-enables
    // INVARIANT — DO NOT REVERT (regressed 2x). Boot/first-run frame MUST be terminal-dark
    // (baseFor/overlayFor "boot" = #0b0e16) in ALL themes, never baseFor(theme). The BootTerminal
    // is dark in every theme; theming the frame to the user's mode here causes a light-frame-on-
    // dark-terminal bleed. Real theme applies only on boot:done. See Config-As-Data-SOP-electron.md §2.
    backgroundColor: baseFor("boot"),
    title: "AvertXAI Focal Registry",
    icon: APP_ICON,
    show: false,
    titleBarStyle: "hidden",
    titleBarOverlay: overlayFor("boot"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => {
    win.show();
    win.focus();
  });

  hardenWebContents(win);

  // Attention flashes clear when the user comes back to the window.
  win.on("focus", () => win.flashFrame(false));

  // Hide-to-tray: the ✕ hides the window instead of destroying it, unless a real Quit is underway.
  // The window is never destroyed by ✕, so window-all-closed never fires from it (tray keeps us alive).
  win.on("close", (e) => {
    // Read trayEnabled LIVE so the Settings toggle rewires this with no restart. Tray ON → hide to
    // tray (unless a real quit is underway). Tray OFF → fall through: the window closes, then
    // window-all-closed quits the app — no background process.
    if (trayEnabled && !isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  // Query param hands the boot theme to the renderer so src/main.tsx can set data-theme BEFORE
  // the first React paint (recon 3b) — no preload/IPC roundtrip on the critical path.
  void win.loadFile(path.join(__dirname, "../dist/index.html"), { query: { theme: bootThemeMode, skipBoot: bootSkip ? "1" : "0" } });
  return win;
}

// System tray — reuses showMain() for every restore path. "Quit" is the ONLY thing that sets
// isQuitting, so before-quit (Scout's scroll checkpoint) still fires on a real quit.
function createTray(): void {
  tray = new Tray(TRAY_ICON);
  tray.setToolTip("AvertXAI Focal Registry");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open", click: () => showMain() },
      {
        label: "Exit",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on("click", () => showMain());
  tray.on("double-click", () => showMain());
}

// Apply the tray setting live: create the tray icon when enabling, destroy it when disabling, and
// flip the flag the close handler reads. Called at boot and from the Settings toggle (no restart).
function setTrayEnabled(enabled: boolean): void {
  trayEnabled = enabled;
  if (enabled && !tray) createTray();
  else if (!enabled && tray) {
    tray.destroy();
    tray = null;
  }
}

// Open-at-Windows-login (§ user request). setLoginItemSettings writes/clears the OS login item (HKCU
// Run key on Windows), so Windows itself launches the app on restart — no polling. Guarded to packaged
// builds so `electron .` in dev never registers electron.exe in the user's startup. The choice is the
// DB source of truth; this re-asserts the OS state from it.
function applyLaunchAtStartup(enabled: boolean): void {
  if (!app.isPackaged) return; // dev: don't pollute the developer's startup with electron.exe
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath });
  } catch (e) {
    console.error("[startup] setLoginItemSettings failed:", e);
  }
}

app.whenReady().then(async () => {
  // Own app identity so Windows uses our icon/identity AND so we don't collide
  // (single-instance lock + userData) with other AvertXAI builds.
  if (process.platform === "win32") app.setAppUserModelId("com.avertxai.focalregistry");

  // Org-DB slug migration (runbooks_ → focalregistry_) — MUST run before initRegistry()/getDb()
  // hands any module a connection. Idempotent every boot; a failure rolls back and the app boots
  // on the old file as if nothing happened (the migration logs, the user never sees it).
  try {
    migrateOrgDbSlugs(app.getPath("userData"));
  } catch (e) {
    console.error("[db-migrate] unexpected failure — booting unmigrated:", e);
  }

  // --- Config-as-Data gatekeeper: the platform registry routes boot to the active org's DBs.
  // No active org yet → skip the org DBs entirely; the renderer boots into the First-Run
  // wizard, whose firstRun:complete mints the org, activates it, and opens its DBs.
  initRegistry();
  const org = getActiveOrg();
  if (org) {
    const userData = app.getPath("userData");
    initDb(path.join(userData, `${org.app_slug}_${org.org_id}.db`));
    // Vault lockdown: safeStorage-wrapped secret → Argon2id → SQLCipher key.
    const vaultKey = await deriveVaultKey(getOrCreateVaultSecret(org.org_id));
    openDb(path.join(userData, `vault_${org.org_id}.locked.db`), "vault", vaultKey);
    // Runbook Shredder engine is now LAZY — it starts on the first Secure Note IPC (module open), not
    // at boot. Its initial ingest walks + parses the whole watch folder + writes a DB row per file; on
    // a dev-sized folder that is seconds of work and made the app unresponsive for ~4-5s at startup.
    // Deferring it keeps boot instant; the module shows a loading overlay while that first ingest runs.
  }
  // Resolve the persisted theme AFTER the org DB opened, BEFORE the window exists (recon 3a).
  if (org) {
    bootThemeMode = readBootTheme();
    try {
      bootSkip = getSetting("skip_fast_boot") === "1";
    } catch {
      /* setting unreadable — default to showing the terminal */
    }
  }
  // Boot edges from the renderer (window.runbooks bridge — deliberately NOT in core/ipc.ts, which
  // carries un-gated work). Re-entrant: Safe-Mode Retry re-enters boot via boot:start.
  ipcMain.on("boot:done", () => {
    setBooting(false);
    notifyUpdaterBootDone(); // arms the automatic check cycle — first boot:done only, never during boot
  });
  ipcMain.on("boot:start", () => setBooting(true));
  registerIpcHandlers();
  const win = createWindow();
  setMainWindow(win);
  applyThemeOverlay(bootThemeMode); // seed the funnel's theme; boot flag keeps the frame boot-dark
  // Tray defaults ON (§3.11). Read the persisted setting once the org DB is open; "0" = user turned
  // it off, so ✕ quits and no tray icon is created. First-run (no org) stays on the default.
  let trayPref = true;
  if (org) {
    try {
      trayPref = getSetting("tray_enabled") !== "0";
    } catch {
      /* setting unreadable — keep the default ON */
    }
  }
  setTrayEnabled(trayPref); // creates the tray only when enabled; the ✕ handler reads trayEnabled live
  // Live rewire from the Settings toggle: persist through the sanctioned settings service AND flip the
  // tray with no restart. Kept in main.ts (owns the Tray + window) to avoid an ipc.ts→main.ts cycle.
  ipcMain.handle("tray:setEnabled", (_e, enabled: unknown) => {
    const on = enabled !== false && enabled !== "0" && enabled !== 0;
    setSetting("tray_enabled", on ? "1" : "0");
    setTrayEnabled(on);
    return { ok: true };
  });
  // Open-at-login — DEFAULT OFF. Re-assert the OS login item from the DB choice at boot (keeps the
  // registry path correct across reinstalls/moves), and flip it live from the Settings toggle.
  if (org) {
    try {
      applyLaunchAtStartup(getSetting("launch_at_startup") === "1");
    } catch {
      /* setting unreadable — leave the OS state as-is */
    }
  }
  ipcMain.handle("startup:setEnabled", (_e, enabled: unknown) => {
    const on = enabled === true || enabled === "1" || enabled === 1;
    setSetting("launch_at_startup", on ? "1" : "0");
    applyLaunchAtStartup(on);
    return { ok: true };
  });
  initUpdater(win); // §3.12 — no-op in dev (packaged builds only)
  initDiag(); // DIAG-1: dev-gated runtime collector — no-op unless env DIAG=1

  app.on("activate", () => {
    if (getMainWindow() === null) setMainWindow(createWindow());
    else showMain();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
