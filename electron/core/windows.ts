// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Window registry — main ref, renderer broadcast, taskbar flash helpers
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/windows.ts
//------------------------------------------------------------
import type { BrowserWindow } from "electron";

let mainWindow: BrowserWindow | null = null;

// Shell window floor — ONE source: the constructor mins (main.ts) and the post-unlock re-assert
// in setBooting both use these. 740 is JASON-APPROVED (docks beside Claude Desktop at half-screen
// with slack; Distributor holds at the narrow floor) — do not restore 960.
export const MIN_WIDTH = 740;
export const MIN_HEIGHT = 640;

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win;
  if (!win) return;
  // Resize re-assert (recon §4 / compositor flicker): Windows repaints the native strip + frame
  // with stale colors during size-state changes. Re-assert reads the CURRENT theme at call time
  // (currentOverlayMode — the same source applyThemeOverlay writes), never a captured color.
  // setTitleBarOverlay/setBackgroundColor do not resize the window, so no feedback loop; the
  // rapid-fire 'resize' stream is debounced, the settle events re-assert immediately.
  let debounce: NodeJS.Timeout | null = null;
  const reassert = (): void => applyOverlayNow();
  win.on("resize", () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(reassert, 80);
  });
  win.on("resized", reassert);
  win.on("maximize", reassert);
  win.on("unmaximize", reassert);
  // REVEAL re-asserts (SOP §10, 08-25-2026): a strip painted while hidden/minimized can surface
  // stale. Repaint the CURRENT state at every reveal — cheap, idempotent, no feedback loop
  // (none of these fire from setTitleBarOverlay/setBackgroundColor).
  win.on("restore", reassert);
  win.on("show", reassert);
  win.on("focus", reassert);
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

/** Send an event to the renderer. */
export function broadcast(channel: string, ...args: unknown[]): void {
  getMainWindow()?.webContents.send(channel, ...args);
}

/** Attention event: flash the taskbar until the window regains focus. */
export function flashMain(): void {
  const win = getMainWindow();
  if (win && !win.isFocused()) win.flashFrame(true);
}

export function showMain(): void {
  const win = getMainWindow();
  if (!win) return;
  if (!win.isVisible()) win.show();
  if (win.isMinimized()) win.restore();
  win.focus();
}

// Native min/max/close overlay tint per theme — keep in sync with --mc-topbar / --mc-text
// per theme block in src/globals.css ("system" = Hybrid navy, the :root default).
// "boot" = the JARVIS terminal navy (.bootterm in globals.css) — the window is created in this
// tint so the close button blends with the load screen; App flips it to the theme on shell mount.
const OVERLAYS: Record<string, { color: string; symbolColor: string }> = {
  boot: { color: "#0b0e16", symbolColor: "#e8edf7" },
  // THE MEDIA VIEWER'S OWN CHROME, and it is a MODE rather than a second writer (§3.3: "New color
  // states become a mode the funnel resolves"). The viewer header is deliberately the same near-black
  // in all three themes — a lightbox that repaints pale in Light mode changes the apparent colour of
  // the photograph inside it. Dimming the ACTIVE THEME under it therefore gets the answer wrong in
  // two of the three: in Light the blend lands on mid-grey, which is a dark block sitting on a white
  // topbar, and expanded it is a mismatched strip across the viewer's own header. Matching the
  // header exactly is what actually makes the buttons recede. The symbol is the header foreground
  // pulled most of the way down to the background — visible enough to hit, quiet enough to ignore.
  viewer: { color: "#1c1917", symbolColor: "#4a4642" },
  system: { color: "#0d1320", symbolColor: "#e8edf7" },
  dark: { color: "#262626", symbolColor: "#E5E5E5" },
  light: { color: "#FFFFFF", symbolColor: "#1A1A1A" },
};
const OVERLAY_HEIGHT = 36; // matches the drag strip in main.ts

export function overlayFor(mode: string | null): { color: string; symbolColor: string; height: number } {
  return { ...(OVERLAYS[mode ?? "light"] ?? OVERLAYS.light), height: OVERLAY_HEIGHT };
}

// Modal dim: the native overlay is OS-drawn ABOVE all web content, so a DOM modal's backdrop can
// never cover it. Instead we blend the active theme's overlay colors with the .overlay backdrop
// (rgba(4,8,16,.66) in globals.css) while a modal is open, so the buttons visually recede with
// the rest of the chrome.
// LIGHT is the product default (Jason 08-19-2026). This is the value the funnel resolves against
// before any theme has been pushed, so a "system" here reintroduces a hybrid frame on first run.
let currentOverlayMode: string | null = "light";
/** false = normal · true = an ordinary modal is open · "viewer" = the media viewer is open. */
let overlayDimmed: boolean | "viewer" = false;
// Boot flag — while true, the funnel paints the boot-dark frame/strip regardless of theme, so
// renderer-side theme pushes during boot are harmless without gating them. boot:done flips it.
let booting = true;
function blendWithBackdrop(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number, b: number) => Math.round(c * 0.34 + b * 0.66);
  const [r, g, b] = [mix((n >> 16) & 255, 4), mix((n >> 8) & 255, 8), mix(n & 255, 16)];
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

// Per-mode --mc-base values — keep in sync with the theme blocks in src/globals.css. This is the
// color Windows paints on freshly-exposed pixels DURING a resize, before the renderer catches up;
// a stale value = dark bleed in light mode (constructor default is the hybrid base).
const BASE_BG: Record<string, string> = {
  boot: "#0b0e16",
  system: "#0d1320",
  dark: "#1f1f1f",
  light: "#FAFAFA",
};

/** The --mc-base value for a theme mode (main.ts uses this for the constructor backgroundColor). */
export function baseFor(mode: string | null): string {
  return BASE_BG[mode ?? "light"] ?? BASE_BG.light;
}

// SINGLE WRITER for the native strip + frame color — theme switches, modal dim, and the resize
// re-assert all funnel through here so the states can never fight (last-caller-wins bugs).
function applyOverlayNow(): void {
  const win = getMainWindow();
  if (!win) return;
  // INVARIANT — boot-aware funnel: while booting, resolve the "boot" color rows so the App
  // overlay effect can't repaint the frame to theme during boot. Do not gate/remove. SOP §1-2.
  const mode = booting ? "boot" : currentOverlayMode;
  const o = overlayFor(mode);
  try {
    win.setTitleBarOverlay(
      overlayDimmed === "viewer"
        ? { ...OVERLAYS.viewer, height: o.height }
        : overlayDimmed
          ? { ...o, color: blendWithBackdrop(o.color), symbolColor: blendWithBackdrop(o.symbolColor) }
          : o
    );
    // Pre-paint frame color follows the theme so resize never flashes the wrong mode.
    win.setBackgroundColor(baseFor(mode));
  } catch {
    // overlay API unsupported on this platform — desktop target is Windows, nothing to do
  }
}

/** Boot edge (re-entrant/idempotent — Safe-Mode Retry re-enters boot): locks/unlocks window
    resize and repaints the frame boot-dark or back to the active theme. */
export function setBooting(b: boolean): void {
  booting = b;
  const win = getMainWindow();
  if (win) {
    win.setResizable(!b);
    // INVARIANT — DO NOT REMOVE. Windows clears minimumSize across setResizable(false->true);
    // re-assert the floor here or the window shrinks to ~zero after boot. SOP §5.
    if (!b) win.setMinimumSize(MIN_WIDTH, MIN_HEIGHT);
  }
  applyOverlayNow();
}

/** Re-tint the native window-control overlay to the active theme (Windows titleBarOverlay). */
export function applyThemeOverlay(mode: string | null): void {
  currentOverlayMode = mode;
  applyOverlayNow();
}

/** Dim (or restore) the native overlay while a renderer modal is open. Dimming is a pure RECOLOR of
    the caption glyphs toward the backdrop (§3.4) — we deliberately do NOT disable the buttons.
    Disabling made Windows paint them in its own system-disabled grey, a different shade than the
    blended symbolColor, so the three buttons read unevenly; recolor-only dims all three uniformly. */
export function setOverlayDim(dim: boolean | "viewer"): void {
  overlayDimmed = dim === "viewer" ? "viewer" : dim === true;
  applyOverlayNow();
}
