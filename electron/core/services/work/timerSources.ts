// Focal Registry — the timers, as the quit guard and the next launch see them.
// Description: lists the TimeTracker and Employees timers that are counting right now, pauses or
//              stops one when a quit asks, stamps Employees sessions as seen once a minute, and
//              reports the timers an earlier launch left running, so he can say what to do with
//              the time the app was closed.
//
//              A timer an earlier launch left running is deliberately NOT offered to the quit
//              guard until he has answered for it. Windows ending the session stops every listed
//              timer without asking, and stopping this one would file all the time the app was
//              closed, which is the defect this file exists to end. Left alone, its last-seen
//              time stays frozen and the same question is asked at the next launch.
import { app, BrowserWindow } from "electron";
import { workedMs } from "../../../../src/shared/employeeTimer";
import { getDb } from "../db";
import { getActiveOrg } from "../db/registry";
import type { Db } from "../employees/db";
import { getPerson } from "../employees/people";
import * as sessions from "../employees/sessions";
import type { Session } from "../employees/types";
import { hasFeature } from "../licensing";
import { stopAndFile } from "../timetracker/ipc";
import * as timer from "../timetracker/timer";
import { registerWorkSource, type WorkLine, type WorkSource } from "./registry";

export interface LeftoverTimer {
  id: string;
  source: "employee" | "project";
  project: string;
  person: string | null;
  startedAt: string;
  lastSeenAt: string;
}

interface Ctx {
  db: Db;
  orgId: string;
}

// When this launch began. An Employees session last seen before it was left running by an earlier
// launch (a crash, a forced shutdown, a power cut). TimeTracker keeps its own list of those,
// captured when its service starts.
// ponytail: this compares wall-clock stamps, so a system clock set back between two launches
// makes a left-running session look watched, and it is not asked about. A launch counter stored
// on the row would close that; add it if a clock change is ever seen to hide a timer.
const launchedAt = new Date().toISOString();

function ctx(): Ctx | null {
  try {
    const org = getActiveOrg();
    return org ? { db: getDb(), orgId: org.org_id } : null;
  } catch {
    return null; // first run: no organisation yet, so no database and no timers
  }
}

// Every Employees channel refuses without the paid feature. The guard and the launch question
// follow the same gate rather than open a second door onto the payroll ledger.
const employeesOn = (db: Db): boolean => hasFeature(db, "employeesModule");

// A session an older build started was never stamped: its start is the only time on record.
const lastSeen = (s: Session): string => s.last_seen_at ?? s.started_at;

/** Employees sessions that are counting: the ones this launch is watching, or the ones waiting. */
function employeeSessions(c: Ctx, waiting: boolean): Session[] {
  if (!employeesOn(c.db)) return [];
  return sessions
    .getActiveSessions(c.db, c.orgId)
    .filter((s) => !s.paused_at && (lastSeen(s) < launchedAt) === waiting);
}

const sessionId = (id: string): number => Number(id.split(":")[1]);

function line(id: string, project: string, person: string | null, seconds: number): WorkLine {
  const minutes = Math.floor(seconds / 60);
  const elapsed = `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
  return {
    id,
    kind: "timer",
    text: [`Timer: ${project}`, person, elapsed].filter(Boolean).join(" · "),
    actions: ["pause", "stop"],
  };
}

// One channel means "re-read" for every surface that shows a timer, the mini window included.
function announce(): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send("timetracker:changed");
  }
}

// A stop can be refused: a completed project takes no new time, and a per-job timer has no amount
// to file. Pausing instead keeps every minute and ends the counting, so a timer that cannot be
// stopped neither holds the quit for ever nor runs on while the app is closed.
function stopOrPause(id: string, stop: () => void, pause: () => void): void {
  try {
    stop();
  } catch (err) {
    console.error(`[timers] could not stop ${id}, so it is paused instead:`, err);
    pause();
  }
}

const projectSource: WorkSource = {
  list() {
    const c = ctx();
    if (!c) return [];
    const waiting = new Set(timer.listInterrupted(c.db).map((s) => s.id));
    return timer
      .status(c.db)
      .sessions.filter((s) => s.state === "running" && !waiting.has(s.id))
      .map((s) => line(`project:${s.id}`, s.projectName, null, s.accumulatedSeconds));
  },
  act(id, action) {
    const c = ctx();
    if (!c) return;
    const pause = (): void => {
      timer.pause(c.db, c.orgId, sessionId(id));
      announce();
    };
    if (action === "pause") pause();
    // The Stop button's own path, so the quick notes and the notes pad are filed, not dropped.
    // It announces the change itself.
    if (action === "stop") stopOrPause(id, () => stopAndFile(c.db, c.orgId, sessionId(id), null), pause);
  },
};

const employeeSource: WorkSource = {
  list() {
    const c = ctx();
    if (!c) return [];
    const now = Date.now();
    return employeeSessions(c, false).map((s) =>
      line(`employee:${s.id}`, s.project_name, getPerson(c.db, s.employee_id).name, workedMs(s, now) / 1000)
    );
  },
  act(id, action) {
    const c = ctx();
    if (!c || !employeesOn(c.db)) return;
    const pause = (): void => void sessions.pauseSession(c.db, sessionId(id));
    if (action === "pause") pause();
    if (action === "stop") stopOrPause(id, () => void sessions.stopSession(c.db, c.orgId, sessionId(id)), pause);
    announce();
  },
};

let touching: ReturnType<typeof setInterval> | null = null;

function touch(): void {
  // Thrown from an interval, an error would reach the crash net once a minute: log it and go on.
  try {
    const c = ctx();
    if (c && employeesOn(c.db)) sessions.touchSessions(c.db, c.orgId, new Date().toISOString(), launchedAt);
  } catch (err) {
    console.error("[timers] could not record when the timers were last seen:", err);
  }
}

export function registerTimerSources(): void {
  if (touching) return;
  registerWorkSource(projectSource);
  registerWorkSource(employeeSource);
  // TimeTracker sessions already carry a heartbeat every five seconds. Employees sessions had
  // nothing, so a minute is the most a crash can now cost one of them.
  touching = setInterval(touch, 60_000);
  // will-quit, never before-quit: before-quit also fires for a quit the guard then holds or he
  // cancels, and the stamping would stay dead for the rest of the session (the reason is spelled
  // out at the ticker in timetracker/ipc.ts). will-quit is also where the databases close.
  app.on("will-quit", () => {
    if (touching) clearInterval(touching);
    touching = null;
  });
}

/** Timers an earlier launch left running, still waiting for his answer. */
export function leftoverTimers(): LeftoverTimer[] {
  const c = ctx();
  if (!c) return [];
  try {
    const projects: LeftoverTimer[] = timer.listInterrupted(c.db).map((s) => ({
      id: `project:${s.id}`,
      source: "project",
      project: s.projectName,
      person: null,
      startedAt: s.startedAt,
      lastSeenAt: s.lastHeartbeat,
    }));
    const people: LeftoverTimer[] = employeeSessions(c, true).map((s) => ({
      id: `employee:${s.id}`,
      source: "employee",
      project: s.project_name,
      person: getPerson(c.db, s.employee_id).name,
      startedAt: s.started_at,
      lastSeenAt: lastSeen(s),
    }));
    return [...projects, ...people];
  } catch (err) {
    console.error("[timers] could not read the timers left running:", err);
    return [];
  }
}

export function resolveLeftoverTimer(
  id: string,
  choice: "keep" | "stopAtLastSeen" | "stopAt",
  endIso?: string
): { ok: boolean; error?: string } {
  const c = ctx();
  const left = leftoverTimers().find((t) => t.id === id);
  if (!c || !left) return { ok: false, error: "That timer is no longer waiting for an answer." };
  try {
    if (choice === "keep") {
      if (left.source === "project") timer.recoverResume(c.db, sessionId(id));
      else sessions.markSeen(c.db, sessionId(id));
      announce();
      return { ok: true };
    }
    const end = choice === "stopAt" ? endIso : left.lastSeenAt;
    if (!end) return { ok: false, error: "Enter the time the work ended." };
    // An entry cannot be deleted once it is filed, so a stop that would file no time is refused.
    if (choice === "stopAtLastSeen" && end <= left.startedAt) {
      return {
        ok: false,
        error: "The app has no record of this timer after it started. Keep all of it, or enter the end time.",
      };
    }
    // Both are the Stop button's own paths, with the end time handed in. recoverKeep is not used:
    // it files "Recovered session" over the quick notes and leaves the notes pad to be wiped.
    if (left.source === "project") {
      stopAndFile(c.db, c.orgId, sessionId(id), null, end);
    } else {
      sessions.stopSession(c.db, c.orgId, sessionId(id), null, end);
      announce();
    }
    return { ok: true };
  } catch (err) {
    console.error(`[timers] could not settle ${id}:`, err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
