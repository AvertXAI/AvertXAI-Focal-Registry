// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: TimeTracker break/idle attention engine (Phase 6B). One 15-second beat (never
//              tighter — the spec's floor): break time accrues only while a session is RUNNING and
//              fires at the configured interval; idle watches powerMonitor.getSystemIdleTime()
//              (built-in, no dependency) and prompts — it NEVER modifies a session itself. Every
//              beat reads the settings LIVE from the DB (the standalone's shipped bug was a cached
//              sound flag; nothing here is cached at engine start, and the sound decision itself
//              stays main-side in readSelectedSound, which re-checks the toggle per call).
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/timetracker/attention.ts
//------------------------------------------------------------
import { powerMonitor } from "electron";
import type { Db } from "./db";
import * as timer from "./timer";
import { getSettings } from "./settings";

const BEAT_MS = 15_000;

export interface AttentionNotify {
  (channel: "timetracker:break", payload: { workedMin: number; autopaused: boolean }): void;
  (channel: "timetracker:idle", payload: { thresholdMin: number }): void;
}

let handle: ReturnType<typeof setInterval> | null = null;
let workedMs = 0;
let lastBeatAt = 0;
// One idle EPISODE at a time: latched when idle crosses the threshold with a timer running,
// closed when input resumes, cleared only when the user answers the prompt (or timers are gone).
let idleEpisode: { startedAt: number; endedAt: number | null; sessionIds: number[] } | null = null;

export function startAttentionEngine(db: Db, orgId: string, notify: AttentionNotify): void {
  if (handle) return;
  lastBeatAt = Date.now();
  handle = setInterval(() => beat(db, orgId, notify), BEAT_MS);
}

function beat(db: Db, orgId: string, notify: AttentionNotify): void {
  const now = Date.now();
  const elapsed = now - lastBeatAt;
  lastBeatAt = now;

  // LIVE settings read, every beat — never cached at engine start (the shipped-bug guard).
  const s = getSettings(db);
  const sessions = timer.status(db).sessions;
  const running = sessions.filter((x) => x.state === "running");

  // ---- break reminder: accrue tracked-work time only while something RUNS; a stretch with no
  // running timer resets the clock (a stopped stretch IS a break). Disabled → fully reset.
  if (!s.breakEnabled || running.length === 0) {
    workedMs = 0;
  } else {
    workedMs += elapsed;
    if (workedMs >= s.breakIntervalMin * 60_000) {
      workedMs = 0;
      let autopaused = false;
      if (s.breakAutopause) {
        // Pause EVERY running session — pause is the existing flag mechanism, nothing new built.
        for (const r of running) {
          try { timer.pause(db, orgId, r.id); autopaused = true; } catch { /* raced a stop — fine */ }
        }
      }
      notify("timetracker:break", { workedMin: s.breakIntervalMin, autopaused });
    }
  }

  // ---- idle: prompt-only. The engine NEVER discards time on its own — resolveIdle() applies the
  // user's explicit choice, and even then only to LIVE sessions (discardIdle shifts the running
  // base; committed time_entries are structurally out of reach).
  const idleSec = powerMonitor.getSystemIdleTime();
  if (!idleEpisode && running.length > 0 && idleSec >= s.idleThresholdMin * 60) {
    idleEpisode = { startedAt: now - idleSec * 1_000, endedAt: null, sessionIds: running.map((r) => r.id) };
    notify("timetracker:idle", { thresholdMin: s.idleThresholdMin });
  }
  if (idleEpisode && idleEpisode.endedAt === null && idleSec < 30) {
    idleEpisode.endedAt = now - idleSec * 1_000; // input resumed — freeze the episode's true length
  }
  if (idleEpisode && sessions.length === 0) idleEpisode = null; // everything stopped — moot
}

/** Snooze: the next fire lands after `minutes` more RUNNING work (interval read live). */
export function snoozeBreak(db: Db, minutes = 5): void {
  const s = getSettings(db);
  workedMs = Math.max(0, s.breakIntervalMin * 60_000 - minutes * 60_000);
}

/** The user's answer to the idle prompt. discard=true subtracts the episode's length from each
    session that was running when it began (existing discardIdle path — live sessions only);
    discard=false keeps everything. Either way the episode is closed. */
export function resolveIdle(db: Db, discard: boolean): void {
  if (!idleEpisode) return;
  const episode = idleEpisode;
  idleEpisode = null;
  if (!discard) return;
  const end = episode.endedAt ?? Date.now();
  const seconds = Math.max(0, Math.floor((end - episode.startedAt) / 1_000));
  if (seconds === 0) return;
  const live = new Set(timer.status(db).sessions.map((x) => x.id));
  for (const id of episode.sessionIds) {
    if (!live.has(id)) continue; // stopped in the meantime — its entry is committed, untouchable
    try { timer.discardIdle(db, id, seconds); } catch { /* raced a stop — skip */ }
  }
}
