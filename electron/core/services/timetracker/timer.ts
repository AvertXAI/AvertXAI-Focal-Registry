// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: TimeTracker concurrent multi-timer engine — N timetracker_active_sessions rows,
//              focus, ~5s heartbeats, per-session crash recovery. Ported 1:1 from the proven
//              standalone engine. Pause is a FLAG on the open row, never a split entry.
//              time_entries is written by exactly one path — closeSession() — and only on an
//              explicit Stop / recovery-Keep. Everything else touches active_sessions rows only.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/timetracker/timer.ts
//------------------------------------------------------------
import { generateUUIDv7 } from "../utils/uuidv7";
import { nowIso, type Db } from "./db";
import { logEvent } from "./eventLog";
import { enforceCap } from "./license";
import type {
  ActiveSessionInfo,
  EventType,
  InterruptedSession,
  MultiTimerStatus,
  SessionState,
  TickPayload,
  TimeEntry,
} from "./types";

/** HH:MM:SS for the stopped-event detail. */
function hms(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const parts = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60];
  return parts.map((n) => String(n).padStart(2, "0")).join(":");
}

// Event-log writes ride ALONGSIDE the timer action, never inside its transaction: a logging
// failure must never roll back or block start/pause/resume/stop. Hence the swallow.
function safeLog(db: Db, orgId: string, type: EventType, projectId: number, projectName: string, detail?: string | null): void {
  try {
    logEvent(db, orgId, { type, projectId, projectName, detail });
  } catch {
    /* logging is best-effort — the timer action already succeeded */
  }
}

interface SessionRow {
  id: number;
  project_id: number;
  note: string | null;
  started_at: string;
  wall_started_at: string;
  accumulated_seconds: number;
  state: SessionState;
  last_paused_at: string | null;
  last_resumed_at: string | null;
  last_heartbeat: string;
  is_focused: number;
}

const SELECT_INFO = `
  SELECT s.*, p.name AS project_name, p.hourly_rate, p.rate_type, c.name AS client_name, c.contact_phone
  FROM timetracker_active_sessions s
  JOIN timetracker_projects p ON p.id = s.project_id
  JOIN timetracker_clients c ON c.id = p.client_id
`;

interface SessionInfoRow extends SessionRow {
  project_name: string;
  client_name: string;
  contact_phone: string | null;
  hourly_rate: number | null;
  rate_type: "hourly" | "contract";
}

function rows(db: Db): SessionInfoRow[] {
  return db.prepare(`${SELECT_INFO} ORDER BY s.wall_started_at ASC, s.id ASC`).all() as SessionInfoRow[];
}

function rowById(db: Db, id: number): SessionInfoRow {
  const row = db.prepare(`${SELECT_INFO} WHERE s.id = ?`).get(id) as SessionInfoRow | undefined;
  if (!row) throw new Error(`Session ${id} not found`);
  return row;
}

/** True worked seconds right now — derived from persisted timestamps, never a counter. */
function elapsedSeconds(row: SessionRow, at = Date.now()): number {
  if (row.state === "paused") return Math.max(0, row.accumulated_seconds);
  return Math.max(0, Math.floor((at - Date.parse(row.started_at)) / 1000));
}

function toInfo(row: SessionInfoRow): ActiveSessionInfo {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    clientName: row.client_name,
    contactPhone: row.contact_phone,
    hourlyRate: row.hourly_rate,
    rateType: row.rate_type,
    state: row.state,
    startedAt: row.started_at,
    wallStartedAt: row.wall_started_at,
    accumulatedSeconds: row.state === "paused" ? row.accumulated_seconds : elapsedSeconds(row),
    lastPausedAt: row.last_paused_at,
    lastResumedAt: row.last_resumed_at,
    note: row.note,
  };
}

export function status(db: Db): MultiTimerStatus {
  const all = rows(db);
  const focused = all.find((r) => r.is_focused === 1);
  return { sessions: all.map(toInfo), focusedId: focused?.id ?? null };
}

/** The ticker's batched payload — one read, every surface renders from this. */
export function tickPayload(db: Db, at = Date.now()): TickPayload {
  const all = rows(db);
  const focused = all.find((r) => r.is_focused === 1);
  return {
    sessions: all.map((r) => {
      const sec = elapsedSeconds(r, at);
      return {
        id: r.id,
        projectId: r.project_id,
        name: r.project_name,
        elapsedMs: sec * 1000,
        earned: r.rate_type === "hourly" && r.hourly_rate ? (sec / 3600) * r.hourly_rate : null,
        state: r.state,
      };
    }),
    focusedId: focused?.id ?? null,
  };
}

export function focus(db: Db, sessionId: number): MultiTimerStatus {
  rowById(db, sessionId); // throws if missing
  const tx = db.transaction(() => {
    db.prepare(`UPDATE timetracker_active_sessions SET is_focused = 0 WHERE is_focused = 1`).run();
    db.prepare(`UPDATE timetracker_active_sessions SET is_focused = 1 WHERE id = ?`).run(sessionId);
  });
  tx();
  return status(db);
}

/**
 * Start a session for the project. ONE active session per project (UNIQUE-enforced):
 * starting an already-running project focuses it instead — never duplicates.
 * Tier caps (Phase 6) will gate THIS entry point; adjustments are never capped.
 */
export function start(db: Db, orgId: string, projectId: number, note: string | null = null): MultiTimerStatus {
  const existing = db.prepare(`SELECT id FROM timetracker_active_sessions WHERE project_id = ?`).get(projectId) as
    | { id: number }
    | undefined;
  if (existing) return focus(db, existing.id);
  enforceCap(db, "timers"); // MAIN-SIDE tier cap on NEW concurrent sessions (the focus path above is exempt)
  const now = nowIso();
  const tx = db.transaction(() => {
    db.prepare(`UPDATE timetracker_active_sessions SET is_focused = 0 WHERE is_focused = 1`).run();
    // Row written at second zero so a crash is recoverable immediately.
    db.prepare(
      `INSERT INTO timetracker_active_sessions
         (uuid, org_id, project_id, note, started_at, wall_started_at, accumulated_seconds, state, last_heartbeat, is_focused, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 'running', ?, 1, ?)`
    ).run(generateUUIDv7(), orgId, projectId, note?.trim() || null, now, now, now, now);
  });
  tx();
  const st = status(db);
  // Log only a genuinely new session (the already-running branch above just focuses — no 'started').
  const s = st.sessions.find((x) => x.projectId === projectId);
  if (s) safeLog(db, orgId, "started", projectId, s.projectName, note?.trim() || null);
  return st;
}

export function pause(db: Db, orgId: string, sessionId: number): MultiTimerStatus {
  const row = rowById(db, sessionId);
  if (row.state === "running") {
    db.prepare(
      `UPDATE timetracker_active_sessions SET state = 'paused', accumulated_seconds = ?, last_paused_at = ? WHERE id = ?`
    ).run(elapsedSeconds(row), nowIso(), sessionId);
    safeLog(db, orgId, "paused", row.project_id, row.project_name);
  }
  return status(db);
}

export function resume(db: Db, orgId: string, sessionId: number): MultiTimerStatus {
  const row = rowById(db, sessionId);
  if (row.state === "paused") {
    // Shift the elapsed base forward so (now - started_at) equals the true worked time.
    const newStart = new Date(Date.now() - row.accumulated_seconds * 1000).toISOString();
    db.prepare(
      `UPDATE timetracker_active_sessions
       SET state = 'running', started_at = ?, accumulated_seconds = 0, last_resumed_at = ?, last_heartbeat = ?
       WHERE id = ?`
    ).run(newStart, nowIso(), nowIso(), sessionId);
    safeLog(db, orgId, "resumed", row.project_id, row.project_name);
  }
  return status(db);
}

/**
 * Overwrite the running session's note column. This is where quick notes live while the clock runs
 * (Jason ruling 2 — newline-packed into the EXISTING column, no new table, no migration). The
 * FORMAT is owned by src/shared/ttNotes.ts; this function stores whatever it is handed and knows
 * nothing about markers or stamps.
 */
export function setSessionNote(db: Db, sessionId: number, note: string | null): void {
  const res = db
    .prepare(`UPDATE timetracker_active_sessions SET note = ?, updated_at = ? WHERE id = ?`)
    .run(note, nowIso(), sessionId);
  if (res.changes === 0) throw new Error(`Session ${sessionId} not found`);
}

/**
 * The three fields the stop path needs BEFORE stop() deletes the row: which project to file the
 * notes under, the wall-clock start (the filed block's header time, ruling 5), and the packed notes.
 */
export function sessionFilingInfo(
  db: Db,
  sessionId: number
): { projectId: number; wallStartedAt: string; note: string | null } {
  const row = rowById(db, sessionId);
  return { projectId: row.project_id, wallStartedAt: row.wall_started_at, note: row.note };
}

/** THE single time_entries write path — one clean row per stopped/kept session. */
function closeSession(db: Db, orgId: string, row: SessionInfoRow, durationSeconds: number, note: string | null, endedAt?: string): TimeEntry {
  const ended = endedAt ?? nowIso();
  const finalNote = note?.trim() || row.note || null;
  const res = db
    .prepare(
      `INSERT INTO timetracker_time_entries (uuid, org_id, project_id, started_at, ended_at, duration_seconds, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(generateUUIDv7(), orgId, row.project_id, row.wall_started_at, ended, durationSeconds, finalNote, ended);
  db.prepare(`DELETE FROM timetracker_active_sessions WHERE id = ?`).run(row.id);
  return db.prepare(`SELECT * FROM timetracker_time_entries WHERE id = ?`).get(Number(res.lastInsertRowid)) as TimeEntry;
}

export function stop(db: Db, orgId: string, sessionId: number, note: string | null): TimeEntry {
  const row = rowById(db, sessionId);
  const wasFocused = row.is_focused === 1;
  const duration = elapsedSeconds(row);
  const entry = closeSession(db, orgId, row, duration, note);
  safeLog(db, orgId, "stopped", row.project_id, row.project_name, `total ${hms(duration)}`);
  // Keep something focused so the bar/mini always have a current session.
  if (wasFocused) {
    const next = rows(db)[0];
    if (next) focus(db, next.id);
  }
  return entry;
}

/** Stop everything (mini-timer Stop All / quit guard) — one clean row per session. */
export function stopAll(db: Db, orgId: string): number {
  const all = rows(db);
  for (const row of all) {
    const duration = elapsedSeconds(row);
    closeSession(db, orgId, row, duration, null);
    safeLog(db, orgId, "stopped", row.project_id, row.project_name, `total ${hms(duration)}`);
  }
  return all.length;
}

/**
 * Idle adjustment for ONE live session: shifts its elapsed base (or shrinks the frozen
 * accumulator while paused) so the idle gap is not billed. Saved entries never touched.
 */
export function discardIdle(db: Db, sessionId: number, seconds: number): MultiTimerStatus {
  const row = rowById(db, sessionId);
  const cut = Math.max(0, Math.floor(seconds));
  if (cut === 0) return status(db);
  if (row.state === "paused") {
    db.prepare(`UPDATE timetracker_active_sessions SET accumulated_seconds = ? WHERE id = ?`).run(
      Math.max(0, row.accumulated_seconds - cut),
      sessionId
    );
  } else {
    const newElapsed = Math.max(0, elapsedSeconds(row) - cut);
    const newStart = new Date(Date.now() - newElapsed * 1000).toISOString();
    db.prepare(`UPDATE timetracker_active_sessions SET started_at = ? WHERE id = ?`).run(newStart, sessionId);
  }
  return status(db);
}

/** Single batched UPDATE — the ticker calls this every ~5s; it's the crash-recovery source. */
export function heartbeatAll(db: Db): void {
  db.prepare(`UPDATE timetracker_active_sessions SET last_heartbeat = ? WHERE state = 'running'`).run(nowIso());
}

// ---------- crash recovery (per-session) ----------

// Sessions whose ids were present with a stale heartbeat when the process launched.
// Captured once at startup; recovery actions tick ids off this list.
let interruptedIds: Set<number> = new Set();

/**
 * ⚠ ORDER-CRITICAL: call once at service start, BEFORE the first heartbeatAll() write. Any existing
 * row is from a previous process; its last_heartbeat is where the old process died (≈5s granularity).
 * A heartbeat written first would overwrite the stale stamp and silently empty the recovery list —
 * and because sessions outlive navigation, this capture cannot wait for the module to be opened.
 */
export function captureInterrupted(db: Db): InterruptedSession[] {
  interruptedIds = new Set(rows(db).map((r) => r.id));
  return listInterrupted(db);
}

export function listInterrupted(db: Db): InterruptedSession[] {
  return rows(db)
    .filter((r) => interruptedIds.has(r.id))
    .map((r) => ({
      id: r.id,
      projectId: r.project_id,
      projectName: r.project_name,
      clientName: r.client_name,
      startedAt: r.wall_started_at,
      elapsedSeconds:
        r.state === "paused"
          ? r.accumulated_seconds
          : Math.max(0, Math.floor((Date.parse(r.last_heartbeat) - Date.parse(r.started_at)) / 1000)),
      lastHeartbeat: r.last_heartbeat,
      state: r.state,
    }));
}

/** Continue the session live — elapsed keeps counting from its original base (today's Resume). */
export function recoverResume(db: Db, sessionId: number): MultiTimerStatus {
  const row = rowById(db, sessionId);
  interruptedIds.delete(sessionId);
  db.prepare(`UPDATE timetracker_active_sessions SET last_heartbeat = ? WHERE id = ?`).run(nowIso(), row.id);
  if (rows(db).every((r) => r.is_focused === 0)) focus(db, sessionId);
  return status(db);
}

/** Keep & commit — ONE clean time_entries row ending at the last heartbeat. */
export function recoverKeep(db: Db, orgId: string, sessionId: number): void {
  const row = rowById(db, sessionId);
  const duration =
    row.state === "paused"
      ? row.accumulated_seconds
      : Math.max(0, Math.floor((Date.parse(row.last_heartbeat) - Date.parse(row.started_at)) / 1000));
  interruptedIds.delete(sessionId);
  closeSession(db, orgId, row, duration, "Recovered session", row.last_heartbeat);
}

/** Discard — deletes the active_sessions row only. */
export function recoverDiscard(db: Db, sessionId: number): void {
  interruptedIds.delete(sessionId);
  db.prepare(`DELETE FROM timetracker_active_sessions WHERE id = ?`).run(sessionId);
}
