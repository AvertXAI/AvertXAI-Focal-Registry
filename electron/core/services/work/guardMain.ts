// Focal Registry — the quit guard, wired to the app.
// Description: every path that ends the app asks here first. While work is running the quit is
//              held, the main window comes forward, and the toast collects one answer per line.
import { ipcMain } from "electron";
import type Database from "better-sqlite3-multiple-ciphers";
import { broadcast, getMainWindow, showMain } from "../../windows";
import { getMainSetting, setMainSetting } from "../settings";
import { createQuitGuard, cutShortRows, jobsToReport, type CutShortJob } from "./quitGuard";
import { actOnWork, runningWork, type WorkAction, type WorkLine } from "./registry";
import { jobsLeftRunning, registerJobSources } from "./jobSources";
import { leftoverTimers, registerTimerSources, resolveLeftoverTimer } from "./timerSources";

const CUT_SHORT_KEY = "quitguard.cut_short";
const ACTIONS: readonly WorkAction[] = ["pause", "stop", "finish", "stopSafely"];

// Jobs the database still called "running" when this launch began: a crash or a power cut.
let foundAtBoot: CutShortJob[] = [];

function savedCutShort(): CutShortJob[] {
  try {
    const parsed: unknown = JSON.parse(getMainSetting(CUT_SHORT_KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as CutShortJob[]) : [];
  } catch {
    return []; // no organisation yet, or an unreadable row: nothing to show
  }
}

function recordCutShort(lines: WorkLine[], forced: boolean, note = ""): void {
  if (lines.length === 0) return;
  try {
    setMainSetting(CUT_SHORT_KEY, JSON.stringify([...savedCutShort(), ...cutShortRows(lines, new Date().toISOString(), forced, note)]));
  } catch (err) {
    console.error("[quit guard] could not record what was cut short:", err);
  }
}

const guard = createQuitGuard({
  running: runningWork,
  act: (id, action) => {
    if (action === "stopSafely") recordCutShort(runningWork().filter((line) => line.id === id), false);
    actOnWork(id, action);
  },
  publish: (state) => broadcast("quitguard:state", state),
  every: (fn, ms) => {
    const timer = setInterval(fn, ms);
    return () => clearInterval(timer);
  },
});

/**
 * Asked by every path that ends the app. True: the quit is held and `proceed` runs once every
 * line is answered and every job has ended. By then nothing is running, so the quit that
 * `proceed` starts passes straight through here.
 */
export function holdQuit(reason: "quit" | "update" | "shutdown", proceed: () => void): boolean {
  // The toast lives in the main window. With no window, or a dead page, nobody could answer and a
  // held quit could never end: the app would be stuck open. The quit goes ahead instead, and the
  // next launch asks: a timer keeps its last-seen time and a job stays marked as running.
  const win = getMainWindow();
  if (!win || win.webContents.isCrashed()) return false;
  const held = guard.request(reason, proceed);
  if (held) showMain(); // the window may be hidden in the tray, and the toast lives in it
  return held;
}

/**
 * Windows is ending the session and will not wait. Timers stop now, so no time is counted while
 * the PC is off; jobs are asked to stop at their next safe point; what was cut is written down
 * for the next launch.
 */
export function sessionEnding(): void {
  const lines = runningWork();
  recordCutShort(lines.filter((line) => line.kind === "timer"), true, " (stopped when Windows shut down)");
  recordCutShort(lines.filter((line) => line.kind === "job"), true);
  for (const line of lines) {
    const action: WorkAction | undefined =
      line.kind === "timer" ? (line.actions.includes("stop") ? "stop" : "pause") : line.actions.includes("stopSafely") ? "stopSafely" : undefined;
    try {
      if (action) actOnWork(line.id, action);
    } catch (err) {
      console.error("[quit guard] could not stop", line.id, err);
    }
  }
}

/** Run at boot, before the engines relabel their interrupted runs as crashed. */
export function captureJobsLeftRunning(db: Database.Database): void {
  try {
    foundAtBoot = jobsLeftRunning(db);
  } catch (err) {
    console.error("[quit guard] could not read interrupted jobs:", err);
  }
}

export function registerQuitGuard(): void {
  registerJobSources();
  registerTimerSources();
  ipcMain.handle("quitguard:state", () => guard.state());
  ipcMain.handle("quitguard:answer", (_e, id: unknown, action: unknown) => {
    if (typeof id === "string" && ACTIONS.includes(action as WorkAction)) guard.answer(id, action as WorkAction);
  });
  ipcMain.handle("quitguard:cancel", () => guard.cancel());
  ipcMain.handle("quitguard:leftovers", () => {
    return { timers: leftoverTimers(), jobs: jobsToReport(savedCutShort(), foundAtBoot) };
  });
  ipcMain.handle("quitguard:resolveTimer", (_e, id: unknown, choice: unknown, endIso: unknown) => {
    if (typeof id !== "string" || (choice !== "keep" && choice !== "stopAtLastSeen" && choice !== "stopAt")) {
      return { ok: false, error: "That choice was not understood." };
    }
    return resolveLeftoverTimer(id, choice, typeof endIso === "string" ? endIso : undefined);
  });
  ipcMain.handle("quitguard:dismissJobs", () => {
    foundAtBoot = [];
    try {
      setMainSetting(CUT_SHORT_KEY, "[]");
    } catch {
      /* no organisation yet: there was nothing saved to clear */
    }
  });
}
