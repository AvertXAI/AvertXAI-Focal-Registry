// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: TimeTracker persisted settings (break reminder, idle threshold) over the shared
//              app_settings table, namespaced timetracker.*. THE DEFAULTS CONST BELOW IS THE ONE
//              SOURCE OF TRUTH — nothing is ever seeded into the database, so the standalone
//              app's seeded-"false"-vs-default-true break_enabled contradiction cannot exist
//              here (FR-DECISIONS §TimeTracker: "fix it, do not port it"). An absent key means
//              DEFAULTS; a present key wins; saveSettings validates and clamps every write.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/timetracker/settings.ts
//------------------------------------------------------------
import type { Db } from "./db";

export interface TimeTrackerSettings {
  breakEnabled: boolean;
  breakIntervalMin: number;
  breakLengthMin: number;
  breakAutopause: boolean;
  /** Sub-toggle: play the selected alert sound when a break reminder fires (only relevant when breakEnabled). */
  breakSoundEnabled: boolean;
  idleThresholdMin: number;
}

// THE single source of truth for every default. breakEnabled is FALSE by deliberate decision:
// the standalone app's SEED (false) is what actually shipped and what its owner lived with —
// its code-default true was dead code behind the seed. Break reminders are an interruption;
// they stay opt-in. (The sound sub-toggle defaults ON so enabling breaks rings out of the box.)
export const DEFAULTS: TimeTrackerSettings = {
  breakEnabled: false,
  breakIntervalMin: 50,
  breakLengthMin: 5,
  breakAutopause: false,
  breakSoundEnabled: true,
  idleThresholdMin: 5,
};

// app_settings keys, namespaced per the <slug>.* convention. Written ONLY through saveSettings
// below (main-side) — deliberately NOT in RENDERER_KEYS, so the generic renderer k/v channel
// cannot bypass the clamps on a numeric setting.
const KEYS = {
  breakEnabled: "timetracker.break_enabled",
  breakIntervalMin: "timetracker.break_interval_min",
  breakLengthMin: "timetracker.break_length_min",
  breakAutopause: "timetracker.break_autopause",
  breakSoundEnabled: "timetracker.break_sound_enabled",
  idleThresholdMin: "timetracker.idle_threshold_min",
} as const;

function readRaw(db: Db): Record<string, string> {
  const rows = db
    .prepare(`SELECT key, value FROM app_settings WHERE key LIKE 'timetracker.%'`)
    .all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

function num(raw: string | number | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/** Absent key → DEFAULTS. No seeding, ever — the default lives in code, in exactly one place. */
export function getSettings(db: Db): TimeTrackerSettings {
  const raw = readRaw(db);
  const bool = (key: string, fallback: boolean): boolean => (key in raw ? raw[key] === "true" : fallback);
  return {
    breakEnabled: bool(KEYS.breakEnabled, DEFAULTS.breakEnabled),
    breakSoundEnabled: bool(KEYS.breakSoundEnabled, DEFAULTS.breakSoundEnabled),
    breakAutopause: bool(KEYS.breakAutopause, DEFAULTS.breakAutopause),
    breakIntervalMin: num(raw[KEYS.breakIntervalMin], DEFAULTS.breakIntervalMin, 1, 600),
    breakLengthMin: num(raw[KEYS.breakLengthMin], DEFAULTS.breakLengthMin, 0, 120),
    idleThresholdMin: num(raw[KEYS.idleThresholdMin], DEFAULTS.idleThresholdMin, 1, 240),
  };
}

/** Shape + clamp renderer input (the ported vSettings), then persist every key in one transaction. */
export function saveSettings(db: Db, input: unknown): TimeTrackerSettings {
  if (typeof input !== "object" || input === null) throw new Error("Invalid settings");
  const o = input as Record<string, unknown>;
  const clean: TimeTrackerSettings = {
    breakEnabled: o.breakEnabled === true,
    breakSoundEnabled: o.breakSoundEnabled === true,
    breakAutopause: o.breakAutopause === true,
    breakIntervalMin: num(o.breakIntervalMin as number, DEFAULTS.breakIntervalMin, 1, 600),
    breakLengthMin: num(o.breakLengthMin as number, DEFAULTS.breakLengthMin, 0, 120),
    idleThresholdMin: num(o.idleThresholdMin as number, DEFAULTS.idleThresholdMin, 1, 240),
  };
  const upsert = db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  );
  const tx = db.transaction(() => {
    upsert.run(KEYS.breakEnabled, String(clean.breakEnabled));
    upsert.run(KEYS.breakSoundEnabled, String(clean.breakSoundEnabled));
    upsert.run(KEYS.breakAutopause, String(clean.breakAutopause));
    upsert.run(KEYS.breakIntervalMin, String(clean.breakIntervalMin));
    upsert.run(KEYS.breakLengthMin, String(clean.breakLengthMin));
    upsert.run(KEYS.idleThresholdMin, String(clean.idleThresholdMin));
  });
  tx();
  return clean;
}
