/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Focal Registry — the ONE Electron main process. Hosts the platform shell window and the
// shared spine: the local SQLite org DB (focalregistry_{org_id}.db) and the Data Viewer IPC channels.
import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, shell, Tray } from "electron";
import path from "node:path";
import { closeAllDbs, getDb, initDb, openDb } from "./core/services/db";
import { ensureAllModuleSchemas } from "./core/services/db/allSchemas";
import { getActiveOrg, initRegistry } from "./core/services/db/registry";
import { getSetting, setSetting } from "./core/services/settings";
import { deriveVaultKey, getOrCreateVaultSecret } from "./core/services/vault/crypto";
import { ensureVaultSchema } from "./core/services/vault/db";
import { registerIpcHandlers } from "./core/ipc";
import { registerMediaScheme } from "./core/services/scan/mediaBrowse";
import { installBrandProtocol, loadLocalPack, registerBrandScheme, seedBundledPack, syncBrandPack } from "./core/services/brandpack";
import { applyThemeOverlay, baseFor, getMainWindow, MIN_HEIGHT, MIN_WIDTH, overlayFor, setBooting, setMainWindow, showMain } from "./core/windows";
import { initUpdater, notifyUpdaterBootDone } from "./core/updater";
import { attachDevToolsShortcut } from "./core/devtools";
import { initDiag } from "./diag";
import * as feedback from "./core/services/feedback";

/**
 * DEV SANDBOX (Jason 08-24-2026). An unpackaged run must NEVER share data with the installed app.
 * Until this line, `npm run dev` and the real install both opened %APPDATA%\Focal Registry — which
 * meant dev:reset could wipe the production vault, and dev scans landed in the customer database.
 * One path swap, before anything touches disk, separates the worlds completely:
 *   packaged  → %APPDATA%\Focal Registry        (the user's real data — untouchable from dev)
 *   dev       → %APPDATA%\Focal Registry (dev)  (the sandbox; dev:reset targets ONLY this)
 * This must run before ANY getPath("userData") consumer — registry, org DBs, feedback outbox — so it
 * sits directly under the imports, ahead of everything.
 */
if (!app.isPackaged) {
  app.setPath("userData", path.join(app.getPath("appData"), "Focal Registry (dev)"));
}

// ── REVERTIBLE GPU-BACKEND EXPERIMENT (resize-band probe) — REMOVE WHEN DONE ──
// Override the graphics backend by setting MC_GPU before launch:
//   warp   → software ANGLE (Windows Advanced Rasterization Platform)
//   gl     → OpenGL ANGLE backend
//   vulkan → Vulkan ANGLE backend
//   off    → disable hardware acceleration entirely
//   (unset)→ default Direct3D 11 behavior (NO change)
// Scan Notes' media scheme MUST be registered before app ready — Chromium builds its scheme registry
// once at startup and silently ignores a privileged registration that arrives later. Registering the
// scheme only declares it; the handler (and every one of its guards) is installed after ready, from
// registerIpcHandlers.
registerMediaScheme();
// Brand pack artwork rides the same pre-ready rule as the media scheme above: declare now,
// install the handler after ready. Nothing is fetched here.
registerBrandScheme();

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
// LIGHT, not "system" — and this initial is load-bearing, not decoration. `readBootTheme()` below
// is only reached `if (org)` (see whenReady), so on a FIRST-RUN install — no org yet — this value is
// what the window is actually built with. Left at "system" a brand-new install booted Hybrid navy
// no matter what the default was supposed to be. Jason ruled light the default 08-19-2026.
let bootThemeMode = "light";
// Skip-Fast-Boot, read at boot and handed to the renderer via ?skipBoot= so it can decide BEFORE the
// first paint not to render the JARVIS terminal — otherwise the dark terminal flashes for a frame
// before the async setting read bypasses it.
let bootSkip = false;
// Persisted window geometry (Jason 08-26-2026: "it didnt save the window size i had already set,
// and it didnt open in the monitor i had chosen"). Read from app_settings in the same org gate as
// the theme; null = never saved (or no org) → Electron's default placement.
let bootBounds: { x: number; y: number; width: number; height: number; max?: boolean } | null = null;
function readBootTheme(): string {
  try {
    const row = getDb().prepare("SELECT value FROM app_settings WHERE key = 'theme_mode'").get() as
      | { value: string }
      | undefined;
    // A STORED choice always wins — including an explicit "system" (Hybrid), which the toggle can
    // set. Only the ABSENCE of a row falls to the default, and that default is LIGHT (Jason
    // 08-01-2026): a new organization opens in light mode. Nothing is seeded into app_settings —
    // the default lives here alone, the structural lesson from the break_enabled bug.
    return row?.value === "light" || row?.value === "dark" || row?.value === "system" ? row.value : "light";
  } catch {
    return "light"; // no org DB yet (first run) — light default, never hang
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
// Checkpoint and close every open connection BEFORE the process goes, so each WAL sidecar is folded
// into its database file and what is on disk after quit is the complete story. Mirrors the vault
// lane's dev host (Jason's 08-12-2026 ruling); mounted root-lane with the vault, 08-14-2026.
app.on("will-quit", () => closeAllDbs());
// The Software Update window's Quit (required mode) must beat hide-to-tray exactly like the tray's
// own Exit does — set the real-quit flag in THIS scope first; update-window.ts's handler on the same
// channel then destroys its window and calls app.quit(). (Second listener, no import cycle.)
ipcMain.on("updwin:quit", () => {
  isQuitting = true;
});
// Escape out of a setup wizard. It must be a REAL quit and not hide-to-tray: an install that is
// only half configured has no shell to go back to, so a hidden window would leave the user with a
// tray icon and no way in. Sets the real-quit flag in THIS scope first, exactly as the tray's own
// Exit does, so the ✕ handler cannot intercept it.
ipcMain.on("setup:quit", () => {
  isQuitting = true;
  app.quit();
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

  /**
   * THE RIGHT-CLICK MENU (Jason 08-16-2026: "if i highlight to select some text, and right click
   * on the mouse, nothing happens"). Electron ships NO default context menu — every app builds its
   * own, and this one never had, so cut/copy/paste were keyboard-only in every module. Roles do
   * the actual work (the OS-standard behaviours); editFlags say what is honest to enable at THIS
   * click. In the Milkdown editor, Paste lands in ProseMirror's paste path, so the vault's
   * markdown-aware paste handler still runs — a right-click paste and a Ctrl+V are the same event.
   */
  win.webContents.on("context-menu", (_event, params) => {
    const template: Electron.MenuItemConstructorOptions[] = [];
    if (params.isEditable) {
      template.push(
        { label: "Cut", role: "cut", enabled: params.editFlags.canCut },
        { label: "Copy", role: "copy", enabled: params.editFlags.canCopy },
        { label: "Paste", role: "paste", enabled: params.editFlags.canPaste },
        { label: "Paste without formatting", role: "pasteAndMatchStyle", enabled: params.editFlags.canPaste },
        { type: "separator" },
        { label: "Select all", role: "selectAll", enabled: params.editFlags.canSelectAll }
      );
    } else if (params.selectionText.trim() !== "") {
      // Read-only surfaces (the preview, tables, the log): copying a selection is the one thing
      // a right-click must always offer.
      template.push({ label: "Copy", role: "copy" });
    }
    if (template.length > 0) Menu.buildFromTemplate(template).popup({ window: win });
  });
}

function createWindow(): BrowserWindow {
  // Restore saved geometry ONLY when its centre still lands on a live display's work area —
  // monitors get unplugged, and a window restored off-screen is a window that "won't open".
  let geom: { x?: number; y?: number; width: number; height: number } = { width: 1280, height: 800 };
  if (bootBounds) {
    const cx = bootBounds.x + bootBounds.width / 2;
    const cy = bootBounds.y + bootBounds.height / 2;
    const onScreen = screen.getAllDisplays().some(
      (d) =>
        cx >= d.workArea.x && cx < d.workArea.x + d.workArea.width &&
        cy >= d.workArea.y && cy < d.workArea.y + d.workArea.height
    );
    if (onScreen) geom = { x: bootBounds.x, y: bootBounds.y, width: bootBounds.width, height: bootBounds.height };
  }
  const win = new BrowserWindow({
    x: geom.x,
    y: geom.y,
    width: geom.width,
    height: geom.height,
    minWidth: MIN_WIDTH, // shared floor (windows.ts, Jason-approved 740), re-asserted after boot unlock
    minHeight: MIN_HEIGHT,
    resizable: false, // boot-window lock — boot:done (setBooting(false)) re-enables
    // INVARIANT — DO NOT REVERT (regressed 2x). Boot/first-run frame MUST be terminal-dark
    // (baseFor/overlayFor "boot" = #0b0e16) in ALL themes, never baseFor(theme). The BootTerminal
    // is dark in every theme; theming the frame to the user's mode here causes a light-frame-on-
    // dark-terminal bleed. Real theme applies only on boot:done. See Config-As-Data-SOP-electron.md §2.
    // SKIP EXCEPTION: when Skip-Fast-Boot is on there is NO terminal to bleed against, so the frame is
    // the real theme from birth — otherwise the boot-dark window flashes before boot:done.
    backgroundColor: baseFor(bootSkip ? bootThemeMode : "boot"),
    title: "Focal Registry",
    icon: APP_ICON,
    show: false,
    titleBarStyle: "hidden",
    titleBarOverlay: overlayFor(bootSkip ? bootThemeMode : "boot"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => {
    // Restore maximized BEFORE show so there is no normal-size flash on a screen he keeps full.
    if (bootBounds?.max) win.maximize();
    win.show();
    win.focus();
  });

  // Persist geometry on every settle — debounced, the normal (un-maximized) rect plus the
  // maximized flag, into app_settings like every other persisted setting. getNormalBounds keeps
  // the remembered rect honest while maximized. First-run (no org DB yet) writes throw and are
  // deliberately dropped — geometry starts persisting from the first org'd session.
  let boundsTimer: NodeJS.Timeout | null = null;
  const saveBounds = (): void => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      try {
        setSetting("window_bounds", JSON.stringify({ ...win.getNormalBounds(), max: win.isMaximized() }));
      } catch {
        /* no org yet, or the window is gone — nothing to persist */
      }
    }, 500);
  };
  win.on("resized", saveBounds);
  win.on("moved", saveBounds);
  win.on("maximize", saveBounds);
  win.on("unmaximize", saveBounds);

  hardenWebContents(win);

  // Ctrl+Shift+I / F12. Owned by the window rather than borrowed from Electron's default
  // menu — see devtools.ts for why that menu was never ours to rely on.
  attachDevToolsShortcut(win);

  /**
   * ZOOM, DELIBERATE AND COMPLETE (Jason 08-25-2026). He found Ctrl+Shift+= zooming by accident —
   * a Chromium built-in — with no way back down. Ruled: keep it, because zoom is an accessibility
   * feature, but own the full standard set instead of half an accident:
   *   Ctrl + =/+  → larger    Ctrl + -  → smaller    Ctrl + 0  → back to normal
   * Clamped to sane bounds (±3 levels ≈ 50%–200%) so a cat on the keyboard cannot make the app
   * unusable. Ctrl+R stays dead on purpose — a mid-session renderer reload wrenches module state,
   * and its absence is why the accident could not be undone with a refresh.
   */
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || !input.control || input.alt || input.meta) return;
    const wc = win.webContents;
    if (input.key === "=" || input.key === "+") {
      wc.setZoomLevel(Math.min(3, wc.getZoomLevel() + 0.5));
      event.preventDefault();
    } else if (input.key === "-") {
      wc.setZoomLevel(Math.max(-3, wc.getZoomLevel() - 0.5));
      event.preventDefault();
    } else if (input.key === "0") {
      wc.setZoomLevel(0);
      event.preventDefault();
    }
  });

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
  tray.setToolTip("Focal Registry\nPhotography Archive Tools");
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

// ---------------------------------------------------------------------------
// THE MAIN-PROCESS CRASH NET (08-23-2026)
//
// None of this existed before. There was no uncaughtException handler, no unhandledRejection
// handler, and no .catch() on the whenReady block below — a throw during start-up simply killed the
// app with no window, no message and no record. Every crash any user has ever had is gone.
//
// Two rules govern what happens next, both ruled by Jason:
//
//  1. IF NOBODY IS AT THE KEYBOARD, THE APP CLOSES SILENTLY. No dialog, no screenshot, no report.
//     "Nobody at the keyboard" means there is no visible window — the machine is locked, the app is
//     minimised to tray, or the window never opened. Prompting a screen nobody is looking at, and
//     photographing it, is the behaviour this feature must not have.
//
//  2. START-UP FAILURES SEND QUIETLY. There is no window to ask in yet, so the choice is between a
//     silent record and no record at all. This is the ONLY channel in the application that transmits
//     without being asked, and it must stay named in the privacy policy.
// ---------------------------------------------------------------------------
feedback.captureConsole();

/** A visible window is the proxy for "somebody is here to be asked". */
function somebodyIsHere(): boolean {
  const win = getMainWindow();
  return !!win && win.isVisible() && !win.isMinimized();
}

/**
 * ONE silent report per process, ever. A crash inside an interval fires this once per tick; without
 * the latch the silent branch became a network send per second and a fresh app.quit() per send —
 * each quit re-firing every before-quit/will-quit listener while the first delivery was still in
 * flight. First crash reports and quits; the rest are one console line each.
 */
let silentCrashHandled = false;

process.on("uncaughtException", (err) => {
  console.error("[shell] uncaught exception:", err);
  if (!somebodyIsHere()) {
    // Silent close, per rule 1. The failure is still recorded on the way out.
    if (silentCrashHandled) return; // a repeating crash (interval tick) must not report per tick
    silentCrashHandled = true;
    void feedback.reportStartupFailure(err).finally(() => app.quit());
    return;
  }
  // The renderer's own listener raises the prompt; main only makes sure the line is in the log the
  // report will carry. Raising a native dialog here as well would put two prompts on one crash.
  feedback.note(`main  uncaught: ${err.message}`);
});

process.on("unhandledRejection", (reason) => {
  console.error("[shell] unhandled rejection:", reason);
  feedback.note(`main  unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
});

app.whenReady().then(async () => {
  // Own app identity so Windows uses our icon/identity AND so we don't collide
  // (single-instance lock + userData) with other AvertXAI builds.
  if (process.platform === "win32") app.setAppUserModelId("com.avertxai.focalregistry");

  // Brand artwork. Serve whatever pack is already on disk immediately — an offline boot, or a
  // first run before any download, simply falls back to the colour-and-initials tile. The sync is
  // deliberately NOT awaited: it is cosmetic, and boot must not wait on the network for it.
  installBrandProtocol();
  // Disk first (a previous sync may be ahead of what shipped), then the bundled copy on a
  // fresh install so tiles are right from the very first frame rather than after a download.
  if (!loadLocalPack()) seedBundledPack();
  void syncBrandPack().then((r) => {
    if (r.updated) console.info(`[brandpack] updated to v${r.version}`);
    else console.info(`[brandpack] v${r.version ?? "none"} — ${r.reason ?? "no change"}`);
  });

  // --- Config-as-Data gatekeeper: the platform registry routes boot to the active org's DBs.
  // No active org yet → skip the org DBs entirely; the renderer boots into the First-Run
  // wizard, whose firstRun:complete mints the org, activates it, and opens its DBs.
  initRegistry();
  const org = getActiveOrg();
  if (org) {
    const userData = app.getPath("userData");
    initDb(path.join(userData, `${org.app_slug}_${org.org_id}.db`));
    // EVERY module schema at boot, in one loop (ruled 08-05-2026; replaced the two individual
    // ensures 08-06). A module's tables exist because an org exists, never because someone opened
    // a module — the previous per-module arrangement shipped a real bug: an org minted by the
    // first-run wizard got no ensures at all, and opening TimeTracker before Employees threw
    // "no such table: employee_entries" on the project list (LIST_SQL joins Employees' tables).
    // Databases created BEFORE this rule converge here on their next boot; org creation itself now
    // ensures everything too (firstrun/createOrgDatabase), so both paths are covered. Idempotent.
    ensureAllModuleSchemas(getDb());
    // Vault lockdown: safeStorage-wrapped secret → Argon2id → SQLCipher key. The file is
    // <org_id>.atd — deliberately dull (ruled 08-02-2026), obscurity only; SQLCipher is the control.
    const vaultKey = await deriveVaultKey(getOrCreateVaultSecret(org.org_id));
    const vaultDb = openDb(path.join(userData, `${org.org_id}.atd`), "vault", vaultKey);
    // Vault schema rides the same boot call site as TimeTracker/Employees — guard-only, idempotent,
    // and against the VAULT connection, never the shared DB. An org minted by the first-run wizard
    // mid-session never reaches this line; the vault ipc ctx re-ensures defensively for that path.
    ensureVaultSchema(vaultDb);
    // MindMerge engine is LAZY — it starts on the first MindMerge IPC (module open), not
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
    try {
      const raw = getSetting("window_bounds");
      const b = raw ? (JSON.parse(raw) as typeof bootBounds) : null;
      if (b && Number.isFinite(b.x) && Number.isFinite(b.y) && b.width >= MIN_WIDTH && b.height >= MIN_HEIGHT) {
        bootBounds = b;
      }
    } catch {
      /* unreadable/corrupt geometry — default placement, never a blocked boot */
    }
  }
  // Boot edges from the renderer (window.shell bridge — deliberately NOT in core/ipc.ts, which
  // carries un-gated work). Re-entrant: Safe-Mode Retry re-enters boot via boot:start.
  ipcMain.on("boot:done", () => {
    setBooting(false);
    notifyUpdaterBootDone(); // arms the automatic check cycle — first boot:done only, never during boot
  });
  ipcMain.on("boot:start", () => setBooting(true));
  registerIpcHandlers();
  const win = createWindow();
  setMainWindow(win);
  // Crash visibility (added at the 08-14 mount gate): a dead or hung renderer paints a silent
  // black window and writes NOTHING to the console — these two lines are the difference between
  // "it went black" and a reason. Log-only; recovery stays a human decision.
  win.webContents.on("render-process-gone", (_e, details) =>
    console.error(`[shell] renderer gone: reason=${details.reason} exitCode=${details.exitCode}`)
  );
  win.webContents.on("unresponsive", () => console.error("[shell] renderer unresponsive"));
  applyThemeOverlay(bootThemeMode); // seed the funnel's theme; boot flag keeps the frame boot-dark
  if (bootSkip) setBooting(false); // Skip Fast Boot: no terminal → clear the boot flag so the frame paints theme now (no boot-dark flash). The renderer's boot:done re-asserts idempotently.
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
  initUpdater(); // §3.12 — auto cycle is packaged-only; the updwin IPC + dev preview register everywhere
  initDiag(); // DIAG-1: dev-gated runtime collector — no-op unless env DIAG=1

  app.on("activate", () => {
    if (getMainWindow() === null) setMainWindow(createWindow());
    else showMain();
  });
}).catch((err: unknown) => {
  // START-UP FAILED. There is no window, so there is nothing to ask in and nobody to ask — the
  // record goes out on its own and the app stops. Before this existed, a throw here killed the
  // application in complete silence and left nothing behind to diagnose it with.
  console.error("[shell] start-up failed:", err);
  void feedback.reportStartupFailure(err).finally(() => app.quit());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
