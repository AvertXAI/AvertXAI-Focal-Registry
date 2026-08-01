// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: TimeTracker mini timer — an always-on-top frameless BrowserWindow (Phase 6B),
//              built on the Software Update window's exact pattern: its own window, its own tiny
//              preload (mini-preload.cjs → window.miniApi), its own vite entry (mini.html), theme
//              handed over as ?theme= so frame one is the right mode. Closing it NEVER stops a
//              timer. Open state + position persist as timetracker.* app_settings rows written
//              MAIN-SIDE here (never localStorage, never renderer state — the remount bug class),
//              so both survive an app restart. Frame colors are CONSTRUCTOR-ONLY via baseFor()
//              (the update-window precedent) — applyOverlayNow() remains the only runtime writer.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/timetracker/mini-window.ts
//------------------------------------------------------------
import { BrowserWindow, screen } from "electron";
import path from "node:path";
import { baseFor } from "../../windows";
import { getDb } from "../db";
import type { Db } from "./db";

const OPEN_KEY = "timetracker.mini_open";
const BOUNDS_KEY = "timetracker.mini_bounds";

export const MINI_WIDTH = 380; // widened per Jason (07-31): the 320 strip crushed name + clock
// No top bar (Jason 07-31): the shell IS the drag region. Keep these in sync with mini.css:
const MINI_ROW = 44; // .mini-row min-height
const MINI_PAD = 24; // .mini-shell padding 10px top + 10px bottom + 2px borders + slack

/** Height follows the session count (min one row so the empty state has a line). */
export function miniHeightFor(count: number): number {
  return Math.max(1, Math.min(count, 8)) * MINI_ROW + MINI_PAD; // scrolls past 8 rows
}

let miniWin: BrowserWindow | null = null;
let lastCount = 1;

function put(db: Db, key: string, value: string): void {
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}
function get(db: Db, key: string): string | null {
  const row = db.prepare(`SELECT value FROM app_settings WHERE key = ?`).get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

/** Persisted {x,y} if it still lands on a connected display's work area; null otherwise
    (monitor unplugged / resolution change → fall back to the default corner, never off-screen). */
function savedPosition(db: Db): { x: number; y: number } | null {
  try {
    const raw = get(db, BOUNDS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { x: number; y: number };
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return p.x >= a.x - 40 && p.x < a.x + a.width - 40 && p.y >= a.y - 10 && p.y < a.y + a.height - 40;
    });
    return visible ? p : null;
  } catch {
    return null;
  }
}

/** Default: top-right of the primary work area (first open / lost monitor). */
function defaultPosition(): { x: number; y: number } {
  const a = screen.getPrimaryDisplay().workArea;
  return { x: a.x + a.width - MINI_WIDTH - 16, y: a.y + 16 };
}

function themeMode(db: Db): string {
  const t = get(db, "theme_mode");
  return t === "light" || t === "dark" ? t : "system";
}

export function isMiniOpen(): boolean {
  return miniWin !== null && !miniWin.isDestroyed();
}

export function openMiniTimer(sessionCount: number): void {
  const db = getDb();
  if (isMiniOpen()) {
    miniWin!.show();
    miniWin!.focus();
    return;
  }
  const theme = themeMode(db);
  const pos = savedPosition(db) ?? defaultPosition();
  lastCount = Math.max(1, sessionCount);
  miniWin = new BrowserWindow({
    width: MINI_WIDTH,
    height: miniHeightFor(lastCount),
    x: pos.x,
    y: pos.y,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    title: "Mini Timer",
    backgroundColor: baseFor(theme), // constructor-only, the update-window precedent
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "mini-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  miniWin.setMenuBarVisibility(false);
  // Jason (07-31): plain alwaysOnTop drops behind the focused app on Windows — assert the higher
  // "screen-saver" z-level and RE-ASSERT on blur (some apps steal topmost on focus). Persistent
  // on-top across app switches; the window itself never takes focus it wasn't given.
  miniWin.setAlwaysOnTop(true, "screen-saver");
  miniWin.on("blur", () => {
    if (isMiniOpen()) miniWin!.setAlwaysOnTop(true, "screen-saver");
  });
  miniWin.once("ready-to-show", () => miniWin?.show());
  // Position persists on every drag-end — survives restart via app_settings, main-side write.
  miniWin.on("moved", () => {
    if (!isMiniOpen()) return;
    const [x, y] = miniWin!.getPosition();
    try { put(getDb(), BOUNDS_KEY, JSON.stringify({ x, y })); } catch { /* no org DB — position just won't stick */ }
  });
  miniWin.on("closed", () => {
    miniWin = null;
    // Any close path (our ✕, OS) records closed — reboot must not resurrect an unwanted window.
    try { put(getDb(), OPEN_KEY, "0"); } catch { /* ditto */ }
  });
  void miniWin.loadFile(path.join(__dirname, "../dist/mini.html"), { query: { theme } });
  put(db, OPEN_KEY, "1");
}

export function closeMiniTimer(): void {
  if (isMiniOpen()) miniWin!.close(); // 'closed' handler persists OPEN_KEY=0; timers are untouched
}

/** Was the window open when the app last quit? ttCtx() reopens it at service start if so. */
export function wasMiniOpen(db: Db): boolean {
  return get(db, OPEN_KEY) === "1";
}

/** Push an event into the mini renderer (tick / changed) if it is open. */
export function forwardToMini(channel: string, payload?: unknown): void {
  if (isMiniOpen()) miniWin!.webContents.send(channel, payload);
}

/** The ticker calls this each beat — height follows the session count without touching x/y. */
export function resizeMiniFor(count: number): void {
  const c = Math.max(1, count);
  if (!isMiniOpen() || c === lastCount) return;
  lastCount = c;
  const [w] = miniWin!.getSize();
  miniWin!.setSize(w, miniHeightFor(c));
}
