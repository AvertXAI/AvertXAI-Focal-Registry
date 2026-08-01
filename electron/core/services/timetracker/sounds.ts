// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: TimeTracker break-alert sound logic — bundled (shipped assets, listed live, never
//              DB rows) + user-uploaded sounds (rows + copies under the storage root), selection,
//              playback bytes. All 17 bundled sounds are available at every tier; the tier cap
//              (Phase 6) applies to CUSTOM UPLOADS only. Selection persists main-side in
//              app_settings under timetracker.break_sound_id.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/timetracker/sounds.ts
//------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";
import { generateUUIDv7 } from "../utils/uuidv7";
import { nowIso, type Db } from "./db";
import { customSoundsDir, getBundledSoundsDir } from "./paths";
import { enforceCap } from "./license";
import type { AlertSound, SoundData } from "./types";

const BUNDLED_PREFIX = "bundled:";
const ALLOWED_EXT = new Set([".mp3", ".wav"]);
const MIME: Record<string, string> = { ".mp3": "audio/mpeg", ".wav": "audio/wav" };
const SELECTED_KEY = "timetracker.break_sound_id";

interface SoundRow {
  uuid: string;
  display_name: string;
  file_path: string;
  is_bundled: number;
  created_at: string;
}

function listBundled(): AlertSound[] {
  const bundledDir = getBundledSoundsDir();
  if (!bundledDir || !fs.existsSync(bundledDir)) return [];
  return fs
    .readdirSync(bundledDir)
    .filter((f) => ALLOWED_EXT.has(path.extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b))
    .map((f) => ({
      id: BUNDLED_PREFIX + path.basename(f, path.extname(f)),
      displayName: path.basename(f, path.extname(f)),
      isBundled: true,
    }));
}

function listCustomRows(db: Db): SoundRow[] {
  return db
    .prepare(`SELECT * FROM timetracker_alert_sounds WHERE is_bundled = 0 ORDER BY created_at ASC`)
    .all() as SoundRow[];
}

/** Bundled first (alphabetical), then custom uploads (oldest first). */
export function listSounds(db: Db): AlertSound[] {
  return [
    ...listBundled(),
    ...listCustomRows(db).map((r) => ({ id: r.uuid, displayName: r.display_name, isBundled: false })),
  ];
}

function resolveFile(db: Db, id: string): string {
  if (id.startsWith(BUNDLED_PREFIX)) {
    const base = id.slice(BUNDLED_PREFIX.length);
    const bundledDir = getBundledSoundsDir();
    if (!bundledDir) throw new Error("Bundled sounds folder not set");
    for (const ext of ALLOWED_EXT) {
      const p = path.join(bundledDir, base + ext);
      if (fs.existsSync(p)) return p;
    }
    throw new Error(`Bundled sound "${base}" not found`);
  }
  const row = db.prepare(`SELECT * FROM timetracker_alert_sounds WHERE uuid = ?`).get(id) as SoundRow | undefined;
  if (!row) throw new Error(`Sound ${id} not found`);
  return row.file_path;
}

/** Raw audio for the renderer's <audio> (played from a Blob — keeps CSP tight). */
export function readSound(db: Db, id: string): SoundData {
  const file = resolveFile(db, id);
  const ext = path.extname(file).toLowerCase();
  return { mime: MIME[ext] ?? "audio/mpeg", base64: fs.readFileSync(file).toString("base64") };
}

/** Copy an .mp3/.wav into the storage root's sounds/ and register it. CUSTOM uploads are the
    tier-capped thing — the 17 bundled sounds are available at every tier, including Free. */
export function uploadSound(db: Db, orgId: string, sourcePath: string, displayName: string): AlertSound {
  enforceCap(db, "soundUploads"); // MAIN-SIDE tier cap
  const ext = path.extname(sourcePath).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) throw new Error("Only .mp3 and .wav alert sounds are supported");
  if (!fs.existsSync(sourcePath)) throw new Error("Sound file not found");
  const name = displayName.trim() || path.basename(sourcePath, ext);
  const uuid = generateUUIDv7();
  const dest = path.join(customSoundsDir(), uuid + ext);
  fs.copyFileSync(sourcePath, dest);
  db.prepare(
    `INSERT INTO timetracker_alert_sounds (uuid, org_id, display_name, file_path, is_bundled, created_at) VALUES (?, ?, ?, ?, 0, ?)`
  ).run(uuid, orgId, name, dest, nowIso());
  return { id: uuid, displayName: name, isBundled: false };
}

export function renameSound(db: Db, id: string, displayName: string): void {
  const name = displayName.trim();
  if (!name) throw new Error("Sound name is required");
  if (id.startsWith(BUNDLED_PREFIX)) throw new Error("Bundled sounds can't be renamed");
  const res = db
    .prepare(`UPDATE timetracker_alert_sounds SET display_name = ?, updated_at = CURRENT_TIMESTAMP WHERE uuid = ?`)
    .run(name, id);
  if (res.changes === 0) throw new Error(`Sound ${id} not found`);
}

/** Removes the row AND the copied file; falls back the selection if it pointed here. */
export function deleteSound(db: Db, id: string): void {
  if (id.startsWith(BUNDLED_PREFIX)) throw new Error("Bundled sounds can't be deleted");
  const row = db.prepare(`SELECT * FROM timetracker_alert_sounds WHERE uuid = ?`).get(id) as SoundRow | undefined;
  if (!row) throw new Error(`Sound ${id} not found`);
  db.prepare(`DELETE FROM timetracker_alert_sounds WHERE uuid = ?`).run(id);
  try {
    if (fs.existsSync(row.file_path)) fs.unlinkSync(row.file_path);
  } catch {
    /* file already gone — row removal is what matters */
  }
  if (getSelectedSoundId(db) === id) setSelectedSoundId(db, defaultSoundId());
}

function defaultSoundId(): string {
  return listBundled()[0]?.id ?? "bundled:DragonBell";
}

export function getSelectedSoundId(db: Db): string {
  const row = db.prepare(`SELECT value FROM app_settings WHERE key = ?`).get(SELECTED_KEY) as
    | { value: string }
    | undefined;
  const id = row?.value ?? defaultSoundId();
  // Heal a stale selection (deleted custom sound / missing bundled file).
  try {
    resolveFile(db, id);
    return id;
  } catch {
    return defaultSoundId();
  }
}

export function setSelectedSoundId(db: Db, id: string): void {
  resolveFile(db, id); // validate it exists before persisting
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(SELECTED_KEY, id);
}
