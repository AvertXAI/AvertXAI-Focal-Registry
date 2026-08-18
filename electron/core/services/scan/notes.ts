// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Scan Notes service — notes, the folder-rename engine, the dumb-and-total sync, and
//              the Updated Notes feed. Plain shared-org-database access: no key, no lock, no promise
//              cache (the Vault's three encryption seams are deliberately absent — this data is a
//              photographer's own folder notes, not credentials).
//
//              THE ONE DESTRUCTIVE ACT IN THIS FILE is a folder rename, and it is fenced accordingly:
//              validated before it is attempted, applied with fs.renameSync on the FOLDER only,
//              recorded append-only, and cascaded to every row that referenced the old path inside a
//              SINGLE transaction. User media is never read, written, moved, or deleted — the folder's
//              own directory entry is the only thing that changes. Everything else this file writes is
//              app-owned markdown under the two app-owned trees.
//
//              LETTERS REASSIGN, SERIALS DO NOT. A queued rename records the path as the database
//              knows it; at apply time the drive's CURRENT letter is resolved from its volume serial
//              and the disk path is remapped before anything touches the filesystem. The database
//              update still keys off the stored prefix. Getting this backwards renames a folder on
//              whatever drive happens to hold that letter today.
//
//              THE SYNC IS DUMB AND TOTAL BY RULING: every app-owned file for the drive is rewritten
//              on every sync. There is no diffing, no timestamp comparison, no merge. A OneDrive
//              conflict copy is junk to overwrite. Two scanned folders that share a basename collide
//              in the tree, and the second one SKIPS and logs rather than overwriting the first.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/scan/notes.ts
//------------------------------------------------------------
import { app, shell } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { generateUUIDv7 } from "../utils/uuidv7";
import { REPORTS_FOLDER_NAME } from "./report";
import { listVolumes, type ScanVolume } from "./drives";
import type { Db, ScanNotesKind, ScanNotesLevel, ScanRenameStatus } from "./notesDb";

// ============================================================================================
// SHAPES
// ============================================================================================

export interface ScanNoteMeta {
  id: number;
  uuid: string;
  drive_id: number | null;
  folder_path: string;
  title: string;
  excerpt: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface ScanNote extends ScanNoteMeta {
  body: string;
}

export interface ScanHistoryRow {
  uuid: string;
  volume_serial: string;
  folder_path_old: string;
  folder_path_new: string;
  name_old: string;
  name_new: string;
  changed_at: string | null;
  applied_at: string | null;
  status: ScanRenameStatus;
  stale_reason: string | null;
}

export interface ScanUpdateRow {
  uuid: string;
  ts: string | null;
  level: ScanNotesLevel;
  kind: ScanNotesKind;
  request_id: string | null;
  message: string;
  detail: string | null;
  drive_label: string | null;
  seen_at: string | null;
}

/** One Recent Work row. Jason ruled 08-18-2026 that these carry the folder NAME and its kind icon
 *  and nothing else — no drive path, no timestamp, no pin, superseding the v1 mockup's richer row.
 *  `at` and `drive_id` are still returned: `at` is the sort the renderer must not recompute, and
 *  `drive_id` is what the click needs to select the folder. Neither is displayed. */
export interface ScanRecentFolder {
  path: string;
  name: string;
  kind: ScanNotesKind;
  at: string | null;
  drive_id: number | null;
}

/** A folder's rendered report card — drawn LIVE from scan_folders, never materialized (ruled). */
export interface ScanFolderCard {
  path: string;
  name: string;
  media_files: number;
  total_files: number;
  image_count: number;
  video_count: number;
  audio_count: number;
  unreadable_count: number;
  total_bytes: number;
  date_min: string | null;
  date_max: string | null;
  top_camera: string | null;
  committed_at: string | null;
}

export interface ScanNotesDriveNode {
  drive_id: number;
  volume_serial: string;
  volume_label: string | null;
  letter: string | null; // null when the drive is not attached right now
  connected: boolean;
  /** Every scanned folder on the drive; `folders` is only the first page of them. */
  folder_total: number;
  folders: Array<{ path: string; name: string; renamedFrom: string | null }>;
}

const nowIso = (): string => new Date().toISOString();

// ============================================================================================
// THE FEED — also this module's four-level event log (the standing rule)
// ============================================================================================

/**
 * The reference a user reads off the screen and quotes into a message. Same shape as the Vault's
 * VLT- ids for the same reason: short enough to say out loud, random enough not to collide inside a
 * session. It names a feed row; it is not a security token.
 */
export function newRequestId(): string {
  return `SCN-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

/**
 * A FAILING LOGGER MUST NEVER BE THE THING THAT BREAKS THE APP. Every write is wrapped and nothing
 * here rethrows — if the feed cannot be written the console keeps the line and the caller carries on.
 * This is the same contract the Vault's log.ts states, and it exists because the feed is written from
 * inside the rename and sync paths, where a throw would abandon work already half-done.
 */
export function logUpdate(
  db: Db | null,
  orgId: string | null,
  e: {
    level: ScanNotesLevel;
    kind: ScanNotesKind;
    message: string;
    detail?: string | null;
    driveLabel?: string | null;
    requestId?: string | null;
    /** THE FOLDER THIS HAPPENED TO — what Recent Work jumps to, added 08-18-2026.
     *
     *  Optional on purpose. Most of this log is drive-level or run-level (a scan finished, a sync
     *  ran) and has no single folder to point at; only the events that DO are offered as
     *  destinations. An event without one is still a feed row, it simply is not somewhere to go. */
    folderPath?: string | null;
    /** THE ROW THAT CAUSED IT — scan_notes.uuid for a note event, scan_folder_name_history.uuid for
     *  a rename. Recording only the path is what allowed the folder to go unrecorded in the first
     *  place; recording the row that caused the event is what closes it permanently, because a path
     *  can be renamed out from under a log entry and a uuid cannot. */
    sourceUuid?: string | null;
  }
): void {
  const line = `[scan-notes] ${e.level} ${e.kind} ${e.message}`;
  if (e.level === "error") console.error(line);
  else if (e.level === "warn") console.warn(line);
  else console.info(line);
  if (!db || !orgId) return;
  try {
    db.prepare(
      `INSERT INTO scan_notes_updates (uuid, org_id, ts, level, kind, request_id, message, detail, drive_label, folder_path, source_uuid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      generateUUIDv7(),
      orgId,
      nowIso(),
      e.level,
      e.kind,
      e.requestId ?? null,
      e.message.slice(0, 2000),
      e.detail ? e.detail.slice(0, 8000) : null,
      e.driveLabel ?? null,
      e.folderPath ?? null,
      e.sourceUuid ?? null
    );
  } catch (err) {
    console.error("[scan-notes] feed write failed (ignored):", err);
  }
}

export function listUpdates(db: Db, orgId: string, limit = 200): ScanUpdateRow[] {
  const cap = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  return db
    .prepare(
      `SELECT uuid, ts, level, kind, request_id, message, detail, drive_label, seen_at
       FROM scan_notes_updates WHERE org_id = ? ORDER BY ts DESC, id DESC LIMIT ?`
    )
    .all(orgId, cap) as ScanUpdateRow[];
}

/**
 * RECENT WORK — the folders you have touched, newest first.
 *
 * FED FROM THE UPDATES FEED, deliberately, and this is the whole design decision: the panel and the
 * Updated Notes tab must never be able to disagree about what happened. A second query over
 * scan_notes and the rename history would have been populated from existing data immediately, and
 * it would have been a second source of truth drifting from the first. Jason ruled the feed on
 * 08-18-2026.
 *
 * THE CONSEQUENCE, stated rather than discovered: `folder_path` was added to the feed on the same
 * day, so rows written before it carry NULL and are not offered as destinations. On an archive with
 * existing history this panel starts EMPTY and fills from the next note or rename — which is exactly
 * what its empty-state sentence promises. It is not broken.
 *
 * DISTINCT BY FOLDER, not by event: a folder edited nine times is one row at its most recent touch,
 * because this is "where was I", not "what happened". GROUP BY with MAX(ts) rather than DISTINCT so
 * the row carries the newest event's kind — the icon has to describe the latest thing that happened.
 */
export function recentFolders(db: Db, orgId: string, limit = 12): ScanRecentFolder[] {
  const cap = Math.min(Math.max(Number(limit) || 12, 1), 50);
  const rows = db
    .prepare(
      `SELECT folder_path, MAX(ts) AS ts, kind
       FROM scan_notes_updates
       WHERE org_id = ? AND folder_path IS NOT NULL AND folder_path <> ''
       GROUP BY folder_path
       ORDER BY ts DESC
       LIMIT ?`
    )
    .all(orgId, cap) as Array<{ folder_path: string; ts: string | null; kind: ScanNotesKind }>;
  // The drive is resolved from scan_folders rather than stored on the event: a folder that has since
  // been renamed still resolves, and an event row never has to be kept in step with a cascade.
  const driveOf = db.prepare(
    "SELECT drive_id FROM scan_folders WHERE org_id = ? AND path = ? ORDER BY id DESC LIMIT 1"
  );
  return rows.map((r) => ({
    path: r.folder_path,
    name: path.basename(r.folder_path) || r.folder_path,
    kind: r.kind,
    at: r.ts,
    drive_id: (driveOf.get(orgId, r.folder_path) as { drive_id: number | null } | undefined)?.drive_id ?? null,
  }));
}

/** The tab badge. Hides at zero by ruling, so the renderer only needs the number. */
export function unseenUpdateCount(db: Db, orgId: string): number {
  return (
    db.prepare("SELECT COUNT(*) AS n FROM scan_notes_updates WHERE org_id = ? AND seen_at IS NULL").get(orgId) as {
      n: number;
    }
  ).n;
}

/** Opening the tab marks everything seen — the badge clears and the feed itself stays forever. */
export function markUpdatesSeen(db: Db, orgId: string): { marked: number } {
  const r = db
    .prepare("UPDATE scan_notes_updates SET seen_at = ? WHERE org_id = ? AND seen_at IS NULL")
    .run(nowIso(), orgId);
  return { marked: r.changes };
}

// ============================================================================================
// NOTES — user-authored only
// ============================================================================================

const metaCols = (excerpt: string): string =>
  `id, uuid, drive_id, folder_path, title, ${excerpt} AS excerpt, archived_at, created_at, updated_at`;
const META_COLS = metaCols("substr(body, 1, 180)");

export function listNotes(db: Db, orgId: string, driveId?: number | null, folderPath?: string): ScanNoteMeta[] {
  const where: string[] = ["org_id = ?", "archived_at IS NULL"];
  const args: unknown[] = [orgId];
  if (typeof driveId === "number") {
    where.push("drive_id = ?");
    args.push(driveId);
  }
  if (typeof folderPath === "string" && folderPath !== "") {
    where.push("folder_path = ?");
    args.push(folderPath);
  }
  return db
    .prepare(
      `SELECT ${META_COLS} FROM scan_notes WHERE ${where.join(" AND ")} ORDER BY updated_at DESC, created_at DESC LIMIT 500`
    )
    .all(...args) as ScanNoteMeta[];
}

export function getNote(db: Db, orgId: string, uuid: unknown): ScanNote {
  if (typeof uuid !== "string" || uuid === "") throw new Error("Invalid note locator");
  const row = db
    .prepare(`SELECT ${META_COLS}, body FROM scan_notes WHERE org_id = ? AND uuid = ?`)
    .get(orgId, uuid) as ScanNote | undefined;
  if (!row) throw new Error("That note is no longer here.");
  return row;
}

/**
 * + Add Note creates and saves into the SELECTED FOLDER with no dialog (ruled). The title is derived
 * from the folder so a brand-new note is already identifiable in the list.
 */
export function createNote(
  db: Db,
  orgId: string,
  input: { driveId?: number | null; folderPath: unknown; title?: unknown; body?: unknown }
): ScanNote {
  const folderPath = typeof input.folderPath === "string" ? input.folderPath.trim() : "";
  if (folderPath === "") throw new Error("Pick a folder before adding a note.");
  const base = path.basename(folderPath) || folderPath;
  const title =
    typeof input.title === "string" && input.title.trim() !== "" ? input.title.trim().slice(0, 300) : `${base} — Notes`;
  const body = typeof input.body === "string" ? input.body : "";
  const uuid = generateUUIDv7();
  const at = nowIso();
  db.prepare(
    `INSERT INTO scan_notes (uuid, org_id, drive_id, folder_path, title, body, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(uuid, orgId, input.driveId ?? null, folderPath, title, body, at, at);
  logUpdate(db, orgId, {
    level: "info",
    kind: "note",
    message: "Note created",
    detail: `${title} — created and saved inside ${folderPath}.`,
    folderPath,
    sourceUuid: uuid,
  });
  return getNote(db, orgId, uuid);
}

/** The autosave target. Returns the stored row so the renderer can reconcile without a second read. */
export function saveNote(
  db: Db,
  orgId: string,
  input: { uuid: unknown; title?: unknown; body?: unknown }
): ScanNote {
  const uuid = typeof input.uuid === "string" ? input.uuid : "";
  const existing = getNote(db, orgId, uuid); // throws a sentence if it is gone
  const title =
    typeof input.title === "string" && input.title.trim() !== "" ? input.title.trim().slice(0, 300) : existing.title;
  const body = typeof input.body === "string" ? input.body : existing.body;
  const renamed = title !== existing.title;
  db.prepare("UPDATE scan_notes SET title = ?, body = ?, updated_at = ? WHERE org_id = ? AND uuid = ?").run(
    title,
    body,
    nowIso(),
    orgId,
    uuid
  );
  // An autosave every second must NOT write a feed row every second — only a real edit event does.
  if (renamed || body !== existing.body) {
    logUpdate(db, orgId, {
      level: "info",
      kind: "note",
      message: "Folder notes edited",
      detail: `${title} — user notes updated.`,
      folderPath: existing.folder_path,
      sourceUuid: existing.uuid,
    });
  }
  return getNote(db, orgId, uuid);
}

export function archiveNote(db: Db, orgId: string, uuid: unknown): { ok: boolean } {
  const note = getNote(db, orgId, uuid);
  db.prepare("UPDATE scan_notes SET archived_at = ?, updated_at = ? WHERE org_id = ? AND uuid = ?").run(
    nowIso(),
    nowIso(),
    orgId,
    note.uuid
  );
  logUpdate(db, orgId, { level: "info", kind: "note", message: "Note archived", detail: note.title, folderPath: note.folder_path, sourceUuid: note.uuid });
  return { ok: true };
}

/**
 * WORDS, NOT A PHRASE — copied from the Vault's tuned implementation with the table name changed.
 * Every term must appear somewhere in the title or the body, in any order; six terms is the ceiling,
 * because past that a query is a sentence and each term costs a full-body scan.
 */
function searchTerms(q: string): string[] {
  return q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
}

/**
 * RELEVANCE, NOT RECENCY. The score is how many terms land in the TITLE — a note named after your
 * words is what you were looking for — and a shorter title breaks the tie. Recency only decides
 * between equals.
 *
 * WHY NOT FTS5: it would rank better, and it costs a virtual table, a migration and sync triggers on
 * every write. LIKE answers in single-digit milliseconds at this scale. Revisit at ~100k.
 */
export function searchNotes(db: Db, orgId: string, q: unknown, limit = 40): ScanNoteMeta[] {
  const terms = searchTerms(typeof q === "string" ? q.trim() : "");
  if (terms.length === 0) return [];
  const cap = Math.min(Math.max(Number(limit) || 40, 1), 200);
  const like = terms.map((t) => `%${t}%`);

  const clause = `org_id = ? AND archived_at IS NULL AND ${terms
    .map(() => "(title LIKE ? OR body LIKE ?)")
    .join(" AND ")}`;
  const whereArgs: unknown[] = [orgId];
  for (const l of like) whereArgs.push(l, l);

  const order = `(${terms.map(() => "(CASE WHEN title LIKE ? THEN 1 ELSE 0 END)").join(" + ")}) DESC,
                 length(title) ASC, updated_at DESC, created_at DESC`;

  // Ids first, then the rows — the excerpt below reads the body, so ORDER BY must not be the thing
  // that computes it.
  const ids = (
    db.prepare(`SELECT id FROM scan_notes WHERE ${clause} ORDER BY ${order} LIMIT ?`).all(...whereArgs, ...like, cap) as {
      id: number;
    }[]
  ).map((r) => r.id);
  if (ids.length === 0) return [];

  // THE EXCERPT IS THE MATCH, not the head of the file — the window is cut around the first term's
  // first occurrence; a title-only hit falls back to the head, because there is nothing else to show.
  const first = terms[0];
  const cols = metaCols(
    `CASE WHEN instr(lower(body), ?) > 0
            THEN substr(body, max(1, instr(lower(body), ?) - 40), 220)
            ELSE substr(body, 1, 180) END`
  );
  return db
    .prepare(`SELECT ${cols} FROM scan_notes WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY ${order}`)
    .all(first, first, ...ids, ...like) as ScanNoteMeta[];
}

export interface ScanFolderHit {
  path: string;
  name: string;
  /** The name it used to have, when the hit came from — or has — a rename record. */
  renamedFrom: string | null;
  drive_id: number | null;
  /** true when the search term matched the OLD name rather than the current one. */
  matchedOld: boolean;
}

/**
 * Folder search — CURRENT names AND old ones, which is what "old and new" in the box's own
 * placeholder promises.
 *
 * WHAT THIS FIXES (Jason, on device 08-17-2026: "search isnt working"). The first cut queried ONLY
 * `scan_folder_name_history`, so the only folders that could ever be found were the ones that had
 * been renamed — on a fresh archive that table is empty and the search answered nothing, forever,
 * for every query. History is where OLD names live; it was never the index of what exists. The
 * current names come from `scan_folders`, which is the list the tree itself is drawn from.
 *
 * Shorter paths rank first: a folder nearer the drive root is far more often the one meant than
 * something eight levels down that happens to share a word.
 */
export function searchFolders(db: Db, orgId: string, q: unknown, limit = 40): ScanFolderHit[] {
  const term = typeof q === "string" ? q.trim().toLowerCase() : "";
  if (term === "") return [];
  const cap = Math.min(Math.max(Number(limit) || 40, 1), 200);
  const like = `%${term}%`;

  const current = db
    .prepare(
      `SELECT DISTINCT path, drive_id FROM scan_folders
       WHERE org_id = ? AND file_count > 0 AND lower(path) LIKE ?
       ORDER BY length(path), path LIMIT ?`
    )
    .all(orgId, like, cap) as Array<{ path: string; drive_id: number | null }>;

  const seen = new Set(current.map((r) => r.path.toLowerCase()));
  const hits: ScanFolderHit[] = current.map((r) => ({
    path: r.path,
    name: path.basename(r.path) || r.path,
    renamedFrom: null,
    drive_id: r.drive_id,
    matchedOld: false,
  }));

  // A folder whose OLD name matched — the reason the history keeps both names. Only added when the
  // current-name pass did not already return it, so a folder never appears twice.
  const old = db
    .prepare(
      `SELECT folder_path_new, name_old, drive_id FROM scan_folder_name_history
       WHERE org_id = ? AND status = 'applied' AND lower(name_old) LIKE ?
       ORDER BY applied_at DESC, id DESC LIMIT ?`
    )
    .all(orgId, like, cap) as Array<{ folder_path_new: string; name_old: string; drive_id: number | null }>;
  for (const r of old) {
    if (seen.has(r.folder_path_new.toLowerCase())) continue;
    seen.add(r.folder_path_new.toLowerCase());
    hits.push({
      path: r.folder_path_new,
      name: path.basename(r.folder_path_new) || r.folder_path_new,
      renamedFrom: r.name_old,
      drive_id: r.drive_id,
      matchedOld: true,
    });
  }
  return hits.slice(0, cap);
}

/** The Folder History card shows the LATEST change; the full chain lives here and in the feed. */
export function folderHistory(db: Db, orgId: string, folderPath: unknown, limit = 50): ScanHistoryRow[] {
  const p = typeof folderPath === "string" ? folderPath : "";
  if (p === "") return [];
  const cap = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return db
    .prepare(
      `SELECT uuid, volume_serial, folder_path_old, folder_path_new, name_old, name_new,
              changed_at, applied_at, status, stale_reason
       FROM scan_folder_name_history
       WHERE org_id = ? AND (folder_path_new = ? OR folder_path_old = ?)
       ORDER BY changed_at DESC, id DESC LIMIT ?`
    )
    .all(orgId, p, p, cap) as ScanHistoryRow[];
}

// ============================================================================================
// THE RENDERED REPORT CARD — live from scan_folders, never a stored row
// ============================================================================================

export function folderCard(db: Db, orgId: string, folderPath: unknown): ScanFolderCard | null {
  const p = typeof folderPath === "string" ? folderPath : "";
  if (p === "") return null;
  const row = db
    .prepare(
      `SELECT path, media_files, total_files, image_count, video_count, audio_count, unreadable_count,
              total_bytes, date_min, date_max, top_camera, committed_at
       FROM scan_folders WHERE org_id = ? AND path = ? ORDER BY id DESC LIMIT 1`
    )
    .get(orgId, p) as Omit<ScanFolderCard, "name"> | undefined;
  if (!row) return null;
  return { ...row, name: path.basename(row.path) || row.path };
}

// ============================================================================================
// THE DRIVE / FOLDER TREE
// ============================================================================================

/**
 * WINDOWED, THE WAY THE VAULT'S NOTE LIST IS. FIRST_PAGE is what a tree pane can actually show; the
 * renderer paints it immediately and backfills the rest a moment later through driveFolders().
 *
 * WHAT THIS REPLACED (Jason, on device 08-17-2026: opening the tab hung the app). Two faults, and
 * they are the same two the Vault's list had before its 08-12 fix:
 *   1. N+1 WITH A COMPILE IN THE LOOP — a `db.prepare(...)` sat inside `folders.map()`, so a drive
 *      with 800 scanned folders compiled 800 statements to answer one question. The rename lookup is
 *      now ONE query per drive, resolved through a Map.
 *   2. NO WINDOW — it returned up to 2,000 folders and the renderer drew every one, to show eleven.
 * The Vault's note list learned both lessons at 4,089 notes; this is the same shape, not a new idea.
 */
export const FOLDER_FIRST_PAGE = 40;

/** Latest applied rename per destination path, for ONE drive, in ONE query. Later rows win, so the
 *  Map ends up holding the most recent old name for each folder. */
function renamedFromMap(db: Db, orgId: string, driveId: number): Map<string, string> {
  const rows = db
    .prepare(
      `SELECT folder_path_new, name_old FROM scan_folder_name_history
       WHERE org_id = ? AND drive_id = ? AND status = 'applied' ORDER BY applied_at, id`
    )
    .all(orgId, driveId) as Array<{ folder_path_new: string; name_old: string }>;
  return new Map(rows.map((r) => [r.folder_path_new, r.name_old]));
}

const toNode = (p: string, prev: Map<string, string>): { path: string; name: string; renamedFrom: string | null } => ({
  path: p,
  name: path.basename(p) || p,
  renamedFrom: prev.get(p) ?? null,
});

export function driveTree(db: Db, orgId: string, volumes: ScanVolume[]): ScanNotesDriveNode[] {
  const present = new Map(volumes.map((v) => [v.serial.toUpperCase(), v]));
  const drives = db
    .prepare("SELECT id, volume_serial, volume_label FROM scan_drives WHERE org_id = ? ORDER BY volume_label, id")
    .all(orgId) as Array<{ id: number; volume_serial: string; volume_label: string | null }>;

  return drives.map((d) => {
    const vol = present.get(d.volume_serial.toUpperCase());
    const total = (
      db
        .prepare("SELECT COUNT(DISTINCT path) AS n FROM scan_folders WHERE org_id = ? AND drive_id = ? AND file_count > 0")
        .get(orgId, d.id) as { n: number }
    ).n;
    const folders = db
      .prepare(
        `SELECT DISTINCT path FROM scan_folders
         WHERE org_id = ? AND drive_id = ? AND file_count > 0 ORDER BY path LIMIT ?`
      )
      .all(orgId, d.id, FOLDER_FIRST_PAGE) as Array<{ path: string }>;
    const prev = renamedFromMap(db, orgId, d.id);
    return {
      drive_id: d.id,
      volume_serial: d.volume_serial,
      volume_label: d.volume_label,
      letter: vol?.letter ?? null,
      connected: vol != null,
      folder_total: total,
      folders: folders.map((f) => toNode(f.path, prev)),
    };
  });
}

/** The backfill and the scroll page — same shape, one drive at a time. */
export function driveFolders(
  db: Db,
  orgId: string,
  driveId: unknown,
  offset = 0,
  limit = 400
): Array<{ path: string; name: string; renamedFrom: string | null }> {
  const id = Number(driveId);
  if (!Number.isFinite(id)) return [];
  const cap = Math.min(Math.max(Number(limit) || 400, 1), 2000);
  const rows = db
    .prepare(
      `SELECT DISTINCT path FROM scan_folders
       WHERE org_id = ? AND drive_id = ? AND file_count > 0 ORDER BY path LIMIT ? OFFSET ?`
    )
    .all(orgId, id, cap, Math.max(0, Number(offset) || 0)) as Array<{ path: string }>;
  const prev = renamedFromMap(db, orgId, id);
  return rows.map((r) => toNode(r.path, prev));
}

// ============================================================================================
// NAME VALIDATION — written fresh; the one existing fs.rename in this repo is a best-effort
// legacy folder move with none of this (recon §1.5.2).
// ============================================================================================

/** Windows device names are reserved at every directory level, with or without an extension. */
const RESERVED = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);
const ILLEGAL = /[/\\?%*:|"<>]/;
/** Windows' classic path ceiling. A rename that lengthens the name lengthens every descendant. */
const MAX_PATH = 260;

/** Returns a plain sentence when the name is unusable, or null when it is fine. */
export function validateFolderName(name: unknown): string | null {
  if (typeof name !== "string") return "That folder name is not text.";
  const n = name.trim();
  if (n === "") return "A folder needs a name.";
  if (n.length > 200) return "That folder name is too long — keep it under 200 characters.";
  if (ILLEGAL.test(n)) return 'A folder name cannot contain any of  \\ / : * ? " < > |';
  // Windows silently strips a trailing dot or space, so "Wedding " and "Wedding" become the same
  // folder without the user ever being told. Refuse rather than surprise them.
  if (n !== name.trim().replace(/[. ]+$/, "")) return "A folder name cannot end with a dot or a space.";
  if (RESERVED.has(n.toUpperCase().split(".")[0])) return `"${n}" is a name Windows reserves for a device.`;
  return null;
}

// ============================================================================================
// THE RENAME ENGINE
// ============================================================================================

/** Swap a stored path's drive-letter root for the letter the drive answers to RIGHT NOW. */
function remapToLetter(storedPath: string, letter: string): string {
  const root = path.parse(path.resolve(storedPath)).root; // "D:\"
  if (root.length < 2) return storedPath;
  return letter.slice(0, 2) + storedPath.slice(root.length - 1);
}

/** Every stored path under `oldPath` (itself included), longest first so a rewrite cannot double-apply. */
function descendantMaxLength(db: Db, orgId: string, oldPath: string, newPath: string): number {
  const prefix = `${oldPath}\\%`;
  const longest = db
    .prepare(
      `SELECT MAX(LENGTH(path)) AS n FROM (
         SELECT path FROM scan_folders WHERE org_id = ? AND (path = ? OR path LIKE ?)
         UNION ALL
         SELECT path FROM scan_files WHERE org_id = ? AND (path = ? OR path LIKE ?)
       )`
    )
    .get(orgId, oldPath, prefix, orgId, oldPath, prefix) as { n: number | null };
  const worst = longest.n ?? oldPath.length;
  return worst - oldPath.length + newPath.length;
}

/** The database half of a rename: every row that referenced the old prefix now references the new. */
function cascadePaths(db: Db, orgId: string, oldPath: string, newPath: string): void {
  const prefix = `${oldPath}\\%`;
  const cut = oldPath.length + 1; // 1-based substr offset just past the old prefix
  db.prepare(
    `UPDATE scan_folders SET path = ? || substr(path, ?), updated_at = CURRENT_TIMESTAMP
     WHERE org_id = ? AND path LIKE ?`
  ).run(newPath, cut, orgId, prefix);
  db.prepare("UPDATE scan_folders SET path = ?, updated_at = CURRENT_TIMESTAMP WHERE org_id = ? AND path = ?").run(
    newPath,
    orgId,
    oldPath
  );
  db.prepare(
    `UPDATE scan_folders SET parent_path = ? || substr(parent_path, ?), updated_at = CURRENT_TIMESTAMP
     WHERE org_id = ? AND parent_path LIKE ?`
  ).run(newPath, cut, orgId, prefix);
  db.prepare(
    "UPDATE scan_folders SET parent_path = ?, updated_at = CURRENT_TIMESTAMP WHERE org_id = ? AND parent_path = ?"
  ).run(newPath, orgId, oldPath);
  db.prepare(
    `UPDATE scan_files SET path = ? || substr(path, ?), updated_at = CURRENT_TIMESTAMP
     WHERE org_id = ? AND path LIKE ?`
  ).run(newPath, cut, orgId, prefix);
  db.prepare(
    `UPDATE scan_notes SET folder_path = ? || substr(folder_path, ?), updated_at = CURRENT_TIMESTAMP
     WHERE org_id = ? AND folder_path LIKE ?`
  ).run(newPath, cut, orgId, prefix);
  db.prepare(
    "UPDATE scan_notes SET folder_path = ?, updated_at = CURRENT_TIMESTAMP WHERE org_id = ? AND folder_path = ?"
  ).run(newPath, orgId, oldPath);
}

/** Returns the uuid of the row it wrote, so the feed row for the same event can reference it. */
function recordHistory(
  db: Db,
  orgId: string,
  r: {
    driveId: number | null;
    serial: string;
    oldPath: string;
    newPath: string;
    status: ScanRenameStatus;
    staleReason?: string | null;
    appliedAt?: string | null;
  }
): string {
  const uuid = generateUUIDv7();
  db.prepare(
    `INSERT INTO scan_folder_name_history
       (uuid, org_id, drive_id, volume_serial, folder_path_old, folder_path_new, name_old, name_new,
        changed_at, applied_at, status, stale_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    uuid,
    orgId,
    r.driveId,
    r.serial,
    r.oldPath,
    r.newPath,
    path.basename(r.oldPath),
    path.basename(r.newPath),
    nowIso(),
    r.appliedAt ?? null,
    r.status,
    r.staleReason ?? null
  );
  return uuid;
}

export interface RenameResult {
  ok: boolean;
  status: ScanRenameStatus | "refused";
  newPath?: string;
  message: string;
  requestId?: string;
}

/**
 * Rename a scanned folder. Connected → applied now. Not connected → queued, and the reconnect
 * consumer applies it. Either way the history row is written, because the record is the point.
 */
export function renameFolder(
  db: Db,
  orgId: string,
  input: { folderPath: unknown; newName: unknown },
  volumes: ScanVolume[]
): RenameResult {
  const oldPath = typeof input.folderPath === "string" ? input.folderPath.trim() : "";
  const newName = typeof input.newName === "string" ? input.newName.trim() : "";
  if (oldPath === "") return { ok: false, status: "refused", message: "Pick a folder to rename." };

  const bad = validateFolderName(newName);
  if (bad) return { ok: false, status: "refused", message: bad };
  if (newName === path.basename(oldPath)) {
    return { ok: false, status: "refused", message: "That is already the folder's name." };
  }

  const folder = db
    .prepare("SELECT drive_id FROM scan_folders WHERE org_id = ? AND path = ? ORDER BY id DESC LIMIT 1")
    .get(orgId, oldPath) as { drive_id: number | null } | undefined;
  if (!folder) return { ok: false, status: "refused", message: "That folder is not in any scan on record." };

  const drive =
    folder.drive_id != null
      ? (db.prepare("SELECT id, volume_serial, volume_label FROM scan_drives WHERE id = ?").get(folder.drive_id) as
          | { id: number; volume_serial: string; volume_label: string | null }
          | undefined)
      : undefined;
  if (!drive) return { ok: false, status: "refused", message: "That folder's drive is not on record." };

  const newPath = path.join(path.dirname(oldPath), newName);

  const projected = descendantMaxLength(db, orgId, oldPath, newPath);
  if (projected > MAX_PATH) {
    return {
      ok: false,
      status: "refused",
      message: `That name makes the longest file inside this folder ${projected} characters, past Windows' ${MAX_PATH}-character limit. Try a shorter name.`,
    };
  }

  const vol = volumes.find((v) => v.serial.toUpperCase() === drive.volume_serial.toUpperCase());
  const label = drive.volume_label ?? drive.volume_serial;

  // ---- drive absent: queue it, record it pending, and say so ----
  if (!vol) {
    const requestId = newRequestId();
    db.prepare(
      `INSERT INTO scan_rename_queue (uuid, org_id, volume_serial, folder_path_old, folder_path_new, queued_at, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`
    ).run(generateUUIDv7(), orgId, drive.volume_serial, oldPath, newPath, nowIso());
    const historyUuid = recordHistory(db, orgId, {
      driveId: drive.id,
      serial: drive.volume_serial,
      oldPath,
      newPath,
      status: "pending",
    });
    logUpdate(db, orgId, {
      level: "info",
      kind: "rename",
      message: "Folder rename queued",
      detail: `${path.basename(oldPath)} -> ${newName} — waiting for ${label} to be connected.`,
      driveLabel: label,
      requestId,
      folderPath: newPath,
      sourceUuid: historyUuid,
    });
    return {
      ok: true,
      status: "pending",
      newPath,
      requestId,
      message: `${label} is not connected. The rename is queued and will be applied automatically when you plug it in.`,
    };
  }

  return applyRename(db, orgId, { oldPath, newPath, driveId: drive.id, serial: drive.volume_serial, label }, vol);
}

/**
 * The disk half, plus its transaction. Shared by the immediate path and the reconnect consumer so
 * there is exactly ONE place that calls fs.renameSync on a user's folder.
 */
function applyRename(
  db: Db,
  orgId: string,
  r: { oldPath: string; newPath: string; driveId: number | null; serial: string; label: string },
  vol: ScanVolume
): RenameResult {
  const requestId = newRequestId();
  const diskOld = remapToLetter(r.oldPath, vol.letter);
  const diskNew = remapToLetter(r.newPath, vol.letter);

  // STALE CHECK, before anything touches the filesystem: the folder must still be there, and it must
  // still be a folder. A user who renamed it in Explorer first must never have a different directory
  // renamed on their behalf.
  let stat: fs.Stats;
  try {
    stat = fs.statSync(diskOld);
  } catch {
    const reason = `The folder is no longer at ${diskOld} — it was moved, renamed, or deleted outside the app.`;
    const historyUuid = recordHistory(db, orgId, { ...r, driveId: r.driveId, serial: r.serial, status: "stale", staleReason: reason });
    logUpdate(db, orgId, {
      level: "warn",
      kind: "rename",
      message: "Folder rename went stale",
      detail: reason,
      driveLabel: r.label,
      requestId,
      // The OLD path: nothing moved, so the folder — if it is anywhere — is still where it was.
      folderPath: r.oldPath,
      sourceUuid: historyUuid,
    });
    return { ok: false, status: "stale", message: reason, requestId };
  }
  if (!stat.isDirectory()) {
    const reason = `${diskOld} is not a folder any more.`;
    const historyUuid = recordHistory(db, orgId, { ...r, status: "stale", staleReason: reason });
    logUpdate(db, orgId, { level: "warn", kind: "rename", message: "Folder rename went stale", detail: reason, driveLabel: r.label, requestId, folderPath: r.oldPath, sourceUuid: historyUuid });
    return { ok: false, status: "stale", message: reason, requestId };
  }
  // Collision: never overwrite an existing directory. A case-only rename on Windows resolves to the
  // same entry, so it is allowed through — fs.renameSync handles it.
  if (fs.existsSync(diskNew) && diskNew.toLowerCase() !== diskOld.toLowerCase()) {
    const reason = `A folder called ${path.basename(diskNew)} is already there.`;
    const historyUuid = recordHistory(db, orgId, { ...r, status: "stale", staleReason: reason });
    logUpdate(db, orgId, { level: "warn", kind: "rename", message: "Folder rename refused", detail: reason, driveLabel: r.label, requestId, folderPath: r.oldPath, sourceUuid: historyUuid });
    return { ok: false, status: "stale", message: reason, requestId };
  }

  try {
    fs.renameSync(diskOld, diskNew);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    const reason =
      code === "EPERM" || code === "EACCES"
        ? `Windows would not let the app rename that folder — something has it open, or it is read-only.`
        : code === "EBUSY"
          ? `That folder is in use by another program. Close it and try again.`
          : `The folder could not be renamed: ${e instanceof Error ? e.message : String(e)}`;
    const historyUuid = recordHistory(db, orgId, { ...r, status: "stale", staleReason: reason });
    logUpdate(db, orgId, {
      level: "error",
      kind: "rename",
      message: "Folder rename failed",
      detail: `${reason} (${diskOld} -> ${diskNew})`,
      driveLabel: r.label,
      requestId,
      folderPath: r.oldPath, // the rename did not happen, so the folder is still at the old path
      sourceUuid: historyUuid,
    });
    return { ok: false, status: "stale", message: `${reason} Reference ${requestId}.`, requestId };
  }

  // The disk changed. Everything that referenced the old path moves in ONE transaction, so a crash
  // between statements cannot leave half the rows pointing at a folder that no longer exists.
  // The transaction RETURNS the history uuid rather than the feed row being written inside it: a
  // feed write is deliberately non-throwing and must never be able to roll back a rename that
  // already touched the disk.
  const historyUuid = db.transaction(() => {
    cascadePaths(db, orgId, r.oldPath, r.newPath);
    return recordHistory(db, orgId, { ...r, status: "applied", appliedAt: nowIso() });
  })();

  logUpdate(db, orgId, {
    level: "info",
    kind: "rename",
    message: "Folder renamed",
    detail: `${path.basename(r.oldPath)} -> ${path.basename(r.newPath)}`,
    driveLabel: r.label,
    requestId,
    folderPath: r.newPath, // the NEW path — the old one no longer exists to jump to
    sourceUuid: historyUuid,
  });
  return { ok: true, status: "applied", newPath: r.newPath, message: `Renamed to ${path.basename(r.newPath)}.`, requestId };
}

// ============================================================================================
// THE QUEUE
// ============================================================================================

export function pendingRenameCount(db: Db, orgId: string, serials?: string[]): number {
  if (serials && serials.length > 0) {
    const ph = serials.map(() => "?").join(",");
    return (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM scan_rename_queue WHERE org_id = ? AND status = 'pending' AND UPPER(volume_serial) IN (${ph})`
        )
        .get(orgId, ...serials.map((s) => s.toUpperCase())) as { n: number }
    ).n;
  }
  return (
    db.prepare("SELECT COUNT(*) AS n FROM scan_rename_queue WHERE org_id = ? AND status = 'pending'").get(orgId) as {
      n: number;
    }
  ).n;
}

export interface DrainResult {
  applied: number;
  stale: number;
  filesWritten: number;
  drives: Array<{ label: string; serial: string; letter: string; applied: number; stale: number; filesWritten: number }>;
}

/**
 * Apply every queued rename whose drive is present, then run the dumb-total sync for each drive that
 * was touched. Called from the drive watcher's debounced callback, from the manual refresh, and once
 * at startup — because the watcher can miss an event and can fail to start entirely (recon F3).
 *
 * NOTHING HERE THROWS. It runs inside a debounce callback that must survive any single drive's bad
 * day; a failure on one drive is logged and the next drive still gets its turn.
 */
/**
 * A drive's last full mirror rewrite, by serial. The WMI watcher raises several events as volumes
 * enumerate at launch, and without this each one kicked off another 800-folder rewrite — three
 * "Drive synced on connect" lines in one boot, each holding the main thread (Jason, 08-17-2026).
 */
const lastSyncAt = new Map<string, number>();
const SYNC_COOLDOWN_MS = 60_000;

export function drainQueue(db: Db, orgId: string, volumes: ScanVolume[], withSync = true): DrainResult {
  const out: DrainResult = { applied: 0, stale: 0, filesWritten: 0, drives: [] };
  for (const vol of volumes) {
    try {
      const rows = db
        .prepare(
          `SELECT uuid, folder_path_old, folder_path_new FROM scan_rename_queue
           WHERE org_id = ? AND status = 'pending' AND UPPER(volume_serial) = ? ORDER BY id`
        )
        .all(orgId, vol.serial.toUpperCase()) as Array<{ uuid: string; folder_path_old: string; folder_path_new: string }>;

      const drive = db
        .prepare("SELECT id, volume_serial, volume_label FROM scan_drives WHERE org_id = ? AND volume_serial = ?")
        .get(orgId, vol.serial) as { id: number; volume_serial: string; volume_label: string | null } | undefined;
      if (!drive) continue; // a drive this org never scanned — nothing queued can belong to it
      const label = drive.volume_label ?? drive.volume_serial;

      let applied = 0;
      let stale = 0;
      for (const row of rows) {
        try {
          const r = applyRename(
            db,
            orgId,
            {
              oldPath: row.folder_path_old,
              newPath: row.folder_path_new,
              driveId: drive.id,
              serial: drive.volume_serial,
              label,
            },
            vol
          );
          db.prepare("UPDATE scan_rename_queue SET status = ?, applied_at = ?, result_text = ?, updated_at = CURRENT_TIMESTAMP WHERE uuid = ?").run(
            r.status === "applied" ? "applied" : "stale",
            nowIso(),
            r.message,
            row.uuid
          );
          if (r.status === "applied") applied += 1;
          else stale += 1;
        } catch (e) {
          stale += 1;
          logUpdate(db, orgId, {
            level: "error",
            kind: "rename",
            message: "A queued rename could not be processed",
            detail: e instanceof Error ? e.message : String(e),
            driveLabel: label,
            // The queue row is in scope and names the folder; sourceUuid is NOT supplied because
            // this catch fires when applyRename threw, so no history row is known to exist.
            folderPath: row.folder_path_old,
          });
        }
      }

      // Dumb-total sync for this drive, whether or not anything was renamed — a scan may have
      // completed while it was unplugged.
      //
      // "DUMB AND TOTAL" IS ABOUT NOT DIFFING CONTENT, NOT ABOUT HOW OFTEN IT RUNS. Rewriting every
      // file for an 800-folder drive is seconds of synchronous work on the main thread, which is a
      // frozen window; a cooldown and a startup opt-out keep the ruling and stop it firing three
      // times before the first paint. A CONNECT still syncs — that is the ruled moment.
      const key = drive.volume_serial.toUpperCase();
      const cooled = (lastSyncAt.get(key) ?? 0) + SYNC_COOLDOWN_MS < Date.now();
      let filesWritten = 0;
      try {
        if (withSync && (cooled || applied > 0)) {
          lastSyncAt.set(key, Date.now());
          filesWritten = syncDrive(db, orgId, drive.id, vol).filesWritten;
        }
      } catch (e) {
        logUpdate(db, orgId, {
          level: "error",
          kind: "sync",
          message: "Sync failed for this drive",
          detail: e instanceof Error ? e.message : String(e),
          driveLabel: label,
        });
      }

      out.applied += applied;
      out.stale += stale;
      out.filesWritten += filesWritten;
      out.drives.push({ label, serial: drive.volume_serial, letter: vol.letter, applied, stale, filesWritten });

      if (applied > 0 || filesWritten > 0 || stale > 0) {
        logUpdate(db, orgId, {
          level: stale > 0 ? "warn" : "info",
          kind: "sync",
          message: "Drive synced on connect",
          detail: `${applied} pending folder rename${applied === 1 ? "" : "s"} applied, ${filesWritten} file${filesWritten === 1 ? "" : "s"} written to drive${stale > 0 ? `, ${stale} could not be applied` : ""}.`,
          driveLabel: label,
        });
      }
    } catch (e) {
      // One bad drive must never abort the sweep, and must never throw back into the debounce.
      logUpdate(db, orgId, {
        level: "error",
        kind: "sync",
        message: "A drive could not be processed",
        detail: e instanceof Error ? e.message : String(e),
        driveLabel: vol.label || vol.letter,
      });
    }
  }
  return out;
}

// ============================================================================================
// THE DUMB-AND-TOTAL SYNC
// ============================================================================================

/**
 * A MIRROR SEGMENT, not a slug. The name came off a real Windows folder, so it is already legal —
 * the only work here is stripping what NTFS forbids in case a path arrived from somewhere odd, and
 * refusing a trailing dot or space, which Windows silently swallows.
 *
 * WHY THIS IS NOT THE REPORT WRITER'S SANITISER: that one flattens to `[A-Za-z0-9 _-]`, which is
 * right for building ONE filename out of a drive label and wrong for reproducing a folder tree —
 * "Courtney's Videos" would become "Courtneys-Videos" and would no longer match the folder it
 * mirrors. A mirror whose names do not match the thing mirrored is not a mirror.
 */
function mirrorSegment(s: string): string {
  const cleaned = (s ?? "").replace(/[/\\?%*:|"<>]/g, "").replace(/[. ]+$/, "").trim();
  return cleaned !== "" ? cleaned : "_";
}

/**
 * The folder's path RELATIVE to its drive root, as segments: `D:\dev\project\img` → `dev · project ·
 * img`. This is what makes the mirror a TREE.
 *
 * THE BUG THIS REPLACED (Jason, on device 08-17-2026, looking at 827 folders in one directory): the
 * first cut keyed each folder by BASENAME alone, so every scanned folder on the drive — at every
 * depth — landed as a sibling in a single flat list, and the hundreds of folders on a developer's
 * drive that are all called `img`, `sound`, `Icon` or `Assets` collided with each other constantly.
 * The collision guard below is what remains of that: with full relative paths it can no longer fire,
 * because two different folders cannot have the same path.
 */
function relativeSegments(folderPath: string): string[] {
  const root = path.parse(path.resolve(folderPath)).root; // "D:\"
  const rel = folderPath.length > root.length ? folderPath.slice(root.length) : "";
  return rel.split(/[\\/]+/).filter(Boolean).map(mirrorSegment);
}

/** "D Drive", read off the stored paths rather than the live volume — the letter as SCANNED. A
 *  drive that comes back as J: must not orphan its existing tree and start a second one. */
function driveSegmentFor(folderPaths: string[], fallback: string): string {
  const first = folderPaths[0];
  if (!first) return fallback;
  const letter = path.parse(path.resolve(first)).root.replace(/[:\\/]/g, "");
  return letter !== "" ? `${letter} Drive` : fallback;
}

/** Windows' classic ceiling, with headroom for the two filenames written inside the directory. */
const MIRROR_PATH_MAX = MAX_PATH - 20;

/** Documents\Focal Registry\Scan Notes — the hand-built path, NEVER app.getPath("documents"), which
 *  follows the OneDrive redirect on this machine (storage/index.ts:30, :39-40). */
export function localTreeRoot(): string {
  return path.join(app.getPath("home"), "Documents", "Focal Registry", "Scan Notes");
}

function fmtBytes(n: number): string {
  if (n >= 1024 ** 4) return `${(n / 1024 ** 4).toFixed(2)} TB`;
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${n} B`;
}
const fmtDate = (v: string | null): string => (v ? v.slice(0, 10) : "—");

function folderReportMarkdown(card: ScanFolderCard, history: ScanHistoryRow[]): string {
  const latest = history.find((h) => h.status === "applied");
  return [
    "---",
    `title: "${card.name.replace(/"/g, "'")} — folder report"`,
    "type: scan-folder-report",
    `folder: "${card.path.replace(/\\/g, "\\\\").replace(/"/g, "'")}"`,
    `capture_range: "${fmtDate(card.date_min)} → ${fmtDate(card.date_max)}"`,
    `media_files: ${card.media_files}`,
    "tags: [scan-notes, focal-registry]",
    "---",
    "",
    `# ${card.name}`,
    "",
    "| | |",
    "|---|---|",
    `| Folder | \`${card.path}\` |`,
    `| Capture range | ${fmtDate(card.date_min)} → ${fmtDate(card.date_max)} |`,
    `| Size | ${fmtBytes(card.total_bytes)} |`,
    `| Media files | ${card.media_files.toLocaleString()} of ${card.total_files.toLocaleString()} seen |`,
    `| Stills | ${card.image_count.toLocaleString()} |`,
    `| Video | ${card.video_count.toLocaleString()} |`,
    `| Audio | ${card.audio_count.toLocaleString()} |`,
    `| Unreadable | ${card.unreadable_count.toLocaleString()} |`,
    ...(card.top_camera ? [`| Top camera | ${card.top_camera} |`] : []),
    ...(latest ? [`| Renamed from | ${latest.name_old} |`] : []),
    "",
    "_Generated by Focal Registry from the scan record. This file is rewritten on every sync — edit `Folder-Notes.md` instead._",
    "",
  ].join("\n");
}

function folderNotesMarkdown(card: ScanFolderCard, notes: ScanNote[], history: ScanHistoryRow[]): string {
  const lines: string[] = [`# ${card.name} — Notes`, ""];
  if (history.length > 0) {
    lines.push("## Folder history", "");
    for (const h of history) {
      const when = (h.applied_at ?? h.changed_at ?? "").replace("T", " ").slice(0, 16);
      lines.push(
        `- ${when} | [Capture range ${fmtDate(card.date_min)} → ${fmtDate(card.date_max)}] | [Folder Name change: ${h.name_old} -> ${h.name_new}]${h.status !== "applied" ? ` _(${h.status})_` : ""}`
      );
    }
    lines.push("");
  }
  for (const n of notes) {
    lines.push(`## ${n.title}`, "", n.body.trim(), "");
  }
  if (notes.length === 0) lines.push("_No notes yet._", "");
  return lines.join("\n");
}

export interface SyncResult {
  filesWritten: number;
  skipped: number;
}

/**
 * Regenerate EVERY app-owned file for one drive, in both trees. No diffing — the database is
 * authoritative and the files are mirrors.
 *
 * THE SHAPE IS THE DRIVE'S OWN SHAPE (Jason ruled on device, 08-17-2026): `<D Drive>\<the folder's
 * path below the drive root>\`. Open the mirror and you are looking at the same tree you would see
 * in Explorer, at the same depths, under the same names — which is the only arrangement in which a
 * person can find anything.
 */
export function syncDrive(db: Db, orgId: string, driveId: number, vol: ScanVolume | null): SyncResult {
  const drive = db
    .prepare("SELECT id, volume_serial, volume_label FROM scan_drives WHERE org_id = ? AND id = ?")
    .get(orgId, driveId) as { id: number; volume_serial: string; volume_label: string | null } | undefined;
  if (!drive) return { filesWritten: 0, skipped: 0 };

  const folders = db
    .prepare(
      `SELECT DISTINCT path FROM scan_folders WHERE org_id = ? AND drive_id = ? AND file_count > 0 ORDER BY path LIMIT 5000`
    )
    .all(orgId, driveId) as Array<{ path: string }>;
  if (folders.length === 0) return { filesWritten: 0, skipped: 0 };

  const driveSeg = driveSegmentFor(folders.map((f) => f.path), drive.volume_serial);
  const roots: string[] = [path.join(localTreeRoot(), driveSeg)];
  // On the drive itself the `<letter> Drive` segment is redundant, but BOTH mirrors are kept
  // identical on purpose: one path is computed, and a user who copies one tree onto the other finds
  // the halves line up.
  if (vol) roots.push(path.join(`${vol.letter}\\`, REPORTS_FOLDER_NAME, driveSeg));

  let filesWritten = 0;
  let skipped = 0;
  const claimed = new Map<string, string>(); // relative directory -> the folder path that claimed it
  const tooDeep: string[] = []; // a sample, for the ONE summary row written at the end
  let tooDeepCount = 0;

  for (const f of folders) {
    const card = folderCard(db, orgId, f.path);
    if (!card) continue;
    const segs = relativeSegments(f.path);
    if (segs.length === 0) continue; // the drive ROOT itself owns no mirror directory of its own
    const key = segs.join("\\").toLowerCase();
    // Cannot fire now that the key is a full relative path — kept as a cheap invariant check, so a
    // future change to mirrorSegment that DID collapse two names would announce itself rather than
    // silently overwrite one folder's notes with another's.
    const owner = claimed.get(key);
    if (owner && owner !== f.path) {
      skipped += 1;
      logUpdate(db, orgId, {
        level: "warn",
        kind: "sync",
        message: "Two folders want the same notes directory",
        detail: `"${f.path}" was skipped — "${owner}" already writes to ${key}.`,
        driveLabel: drive.volume_label ?? drive.volume_serial,
        // A sync event with a real folder behind it. Most sync rows are drive-level and correctly
        // carry no folder; these two do, and leaving them blank would be the same gap again.
        folderPath: f.path,
      });
      continue;
    }
    claimed.set(key, f.path);

    const history = folderHistory(db, orgId, f.path);
    const notes = (listNotes(db, orgId, driveId, f.path) as ScanNoteMeta[]).map((m) =>
      getNote(db, orgId, m.uuid)
    );
    const report = folderReportMarkdown(card, history);
    const noteDoc = folderNotesMarkdown(card, notes, history);

    for (const root of roots) {
      const dir = path.join(root, ...segs);
      // A deep source folder plus the mirror's own prefix can pass Windows' 260-character ceiling.
      // Saying so beats an ENAMETOOLONG the user cannot interpret.
      if (dir.length > MIRROR_PATH_MAX) {
        // ONE ROW PER SYNC, NOT ONE PER FOLDER. A source tree deep enough to trip this trips it a
        // hundred times, and a hundred identical warnings is not a log — it is a wall that hides
        // every other line in the feed. The names are collected and reported together below.
        skipped += 1;
        if (tooDeep.length < 20) tooDeep.push(f.path);
        tooDeepCount += 1;
        continue;
      }
      try {
        fs.mkdirSync(dir, { recursive: true });
        // App-owned writes — overwritten every sync by ruling. Never named *secret* or *backup*.
        fs.writeFileSync(path.join(dir, "Folder-Report.md"), report, "utf8");
        fs.writeFileSync(path.join(dir, "Folder-Notes.md"), noteDoc, "utf8");
        filesWritten += 2;
      } catch (e) {
        skipped += 1;
        logUpdate(db, orgId, {
          level: "warn",
          kind: "sync",
          message: "A folder's files could not be written",
          detail: `${dir}: ${e instanceof Error ? e.message : String(e)}`,
          driveLabel: drive.volume_label ?? drive.volume_serial,
          folderPath: f.path,
        });
      }
    }
  }
  if (tooDeepCount > 0) {
    logUpdate(db, orgId, {
      level: "warn",
      kind: "sync",
      message: `${tooDeepCount} folder${tooDeepCount === 1 ? " sits" : "s sit"} too deep to mirror`,
      detail:
        `Windows caps a path at ${MAX_PATH} characters and these would pass it once the notes folder's own prefix is added. ` +
        `Their notes are safe in the app — only the file copy was skipped. ` +
        `First few: ${tooDeep.slice(0, 5).join(" · ")}${tooDeepCount > 5 ? ` … and ${tooDeepCount - 5} more` : ""}`,
      driveLabel: drive.volume_label ?? drive.volume_serial,
    });
  }
  return { filesWritten, skipped };
}

/** Sync every drive this org has scanned; present drives also get their on-drive tree. */
export function syncAll(db: Db, orgId: string, volumes: ScanVolume[]): SyncResult {
  const drives = db.prepare("SELECT id, volume_serial FROM scan_drives WHERE org_id = ?").all(orgId) as Array<{
    id: number;
    volume_serial: string;
  }>;
  let filesWritten = 0;
  let skipped = 0;
  for (const d of drives) {
    const vol = volumes.find((v) => v.serial.toUpperCase() === d.volume_serial.toUpperCase()) ?? null;
    try {
      const r = syncDrive(db, orgId, d.id, vol);
      filesWritten += r.filesWritten;
      skipped += r.skipped;
    } catch (e) {
      logUpdate(db, orgId, {
        level: "error",
        kind: "sync",
        message: "Sync failed for a drive",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { filesWritten, skipped };
}

// ============================================================================================
// DESKTOP SHORTCUT — new ground; nothing in this repo created one before (recon §1.6.5)
// ============================================================================================

export function createDesktopShortcut(db: Db, orgId: string): { ok: boolean; existed: boolean; message: string } {
  const target = localTreeRoot();
  const link = path.join(app.getPath("home"), "Desktop", "Scan Notes.lnk");
  try {
    if (fs.existsSync(link)) {
      return {
        ok: true,
        existed: true,
        message: "A Scan Notes shortcut is already on your desktop. A second one was not added.",
      };
    }
    fs.mkdirSync(target, { recursive: true }); // a shortcut to a folder that does not exist is dead on arrival
    const ok = shell.writeShortcutLink(link, "create", { target });
    if (!ok) return { ok: false, existed: false, message: "Windows would not create the shortcut." };
    logUpdate(db, orgId, {
      level: "info",
      kind: "sync",
      message: "Desktop shortcut created",
      detail: `A shortcut to ${target} was added to the desktop.`,
    });
    return { ok: true, existed: false, message: `A shortcut to ${target} was added to your desktop.` };
  } catch (e) {
    return {
      ok: false,
      existed: false,
      message: `The shortcut could not be created: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/** Convenience for callers that have no volume list to hand (startup drain, manual refresh). */
export function currentVolumes(): ScanVolume[] {
  try {
    return listVolumes();
  } catch {
    return []; // enumeration hiccup — the next event or a manual refresh recovers
  }
}
