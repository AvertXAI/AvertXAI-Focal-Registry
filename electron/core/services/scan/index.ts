// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Scan engine — READ-ONLY against the source, always. The only writes are rows into
//              the org database. Deterministic sorted depth-first order everywhere (counting walk
//              and traversal share the same walk shape) so a resume lands exactly where a fresh run
//              would. A pre-scan counting walk (countRun) measures EXACT folder + media-file counts
//              — no extrapolation. Only media files get rows; non-media is counted and skipped.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/scan/index.ts
//------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";
import exifr from "exifr";
import { parseFile } from "music-metadata";
import { readIsoBmffGeometry } from "./isobmff-reader";
import { canExifr, canIsoBmff, canMusicMetadata, mediaClass } from "./media";
import { generateUUIDv7 } from "../utils/uuidv7";
import type { Db } from "./db";
import type { ScanRunRow } from "./drives";

// ── RAW_MODE — diagnostic throughput configuration. DEFAULT FALSE. One place, easily flipped. ──
// When true: commit every RAW_COMMIT_BATCH folders instead of every folder (a crash loses up to
// that many folders instead of one — deliberately traded for throughput measurement), skip the
// double-scan guard so a drive can be re-run for benchmarking, and log files/sec + folders/sec to
// the console. When false the shipped default is UNCHANGED. NEVER ship this true.
export const RAW_MODE = false;
export const RAW_COMMIT_BATCH = 100;

/** Progress emitted at most this often during long walks (counting + scanning). */
const PROGRESS_EMIT_INTERVAL_MS = 400;

// ---- skip rules — defaults per spec; configurable per run; every skip is LOGGED, never silent ----
export interface SkipRules {
  dirNames: string[]; // exact folder names, case-insensitive
  dirSuffixes: string[]; // folder name suffixes (Lightroom's *.lrdata preview packages)
  fileSuffixes: string[]; // file name suffixes
  /** Dot-prefixed folders as the stdlib proxy for hidden system folders — Node's fs exposes no
      Windows hidden/system attribute without a native dependency. Limitation documented. */
  skipDotPrefixedDirs: boolean;
}
export const DEFAULT_SKIP_RULES: SkipRules = {
  dirNames: ["$RECYCLE.BIN", "System Volume Information"],
  dirSuffixes: [".lrdata"],
  fileSuffixes: [".lrcat", ".lrdata", ".tmp"],
  skipDotPrefixedDirs: true,
};

function dirSkipRule(name: string, rules: SkipRules): string | null {
  const lower = name.toLowerCase();
  if (rules.dirNames.some((n) => n.toLowerCase() === lower)) return `dir-name ${name}`;
  if (rules.dirSuffixes.some((s) => lower.endsWith(s))) return `dir-suffix ${name}`;
  if (rules.skipDotPrefixedDirs && name.startsWith(".")) return `hidden-dot ${name}`;
  return null;
}
function fileSkipRule(name: string, rules: SkipRules): string | null {
  const lower = name.toLowerCase();
  if (rules.fileSuffixes.some((s) => lower.endsWith(s))) return `file-suffix ${name}`;
  return null;
}

// Classification is the single source of truth in media.ts. kindForExtension stays exported for
// the harness; non-media returns "other" (media-only traversal never writes an "other" row).
export function kindForExtension(ext: string): "image" | "video" | "audio" | "other" {
  return mediaClass(ext) ?? "other";
}

// ---- deterministic listing — ONE sort used by probe and traversal (codepoint order, locale-free) ----
interface Listing {
  dirs: string[]; // names, ascending
  files: string[]; // names, ascending
  symlinks: string[]; // anything reparse-like — never followed
}
function listDirSorted(dir: string): Listing {
  const out: Listing = { dirs: [], files: [], symlinks: [] };
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isSymbolicLink()) out.symlinks.push(e.name);
    else if (e.isDirectory()) out.dirs.push(e.name);
    else if (e.isFile()) out.files.push(e.name);
    // sockets/devices etc. are ignored — not meaningful on a photo archive volume
  }
  const byCodepoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  out.dirs.sort(byCodepoint);
  out.files.sort(byCodepoint);
  out.symlinks.sort(byCodepoint);
  return out;
}

// Windows junctions can slip past Dirent.isSymbolicLink on some volumes — lstat is authoritative.
function isReparseDir(full: string): boolean {
  try {
    return fs.lstatSync(full).isSymbolicLink();
  } catch {
    return true; // unreadable lstat on a dir → treat as do-not-follow
  }
}

// ---- run lifecycle ----
export function getRun(db: Db, runId: number): ScanRunRow {
  const run = db.prepare("SELECT * FROM scan_runs WHERE id = ?").get(runId) as ScanRunRow | undefined;
  if (!run) throw new Error(`scan run ${runId} not found`);
  return run;
}

export function createRun(
  db: Db,
  orgId: string,
  driveId: number,
  rootPath: string,
  scanUnit: "drive" | "folder"
): ScanRunRow {
  const info = db
    .prepare(
      `INSERT INTO scan_runs (uuid, org_id, drive_id, root_path, status, scan_unit)
       VALUES (?, ?, ?, ?, 'probing', ?)`
    )
    .run(generateUUIDv7(), orgId, driveId, path.resolve(rootPath), scanUnit);
  return getRun(db, Number(info.lastInsertRowid));
}

/** Service start: anything still in-flight when the process died is a crash. Idempotent. */
export function markInterruptedRuns(db: Db): number {
  return db
    .prepare("UPDATE scan_runs SET status = 'crashed', updated_at = CURRENT_TIMESTAMP WHERE status IN ('probing', 'estimating', 'running')")
    .run().changes;
}

// Append-only event log; failures and skips both land here (skips prefixed 'skipped:'), and the
// run's errors_logged counter tracks the row count.
function logEvent(db: Db, orgId: string, runId: number, p: string | null, stage: string, text: string): void {
  db.prepare(
    `INSERT INTO scan_errors (uuid, org_id, run_id, path, extension, stage, error_text, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).run(generateUUIDv7(), orgId, runId, p, p ? path.extname(p).replace(/^\./, "") : null, stage, text);
  db.prepare("UPDATE scan_runs SET errors_logged = errors_logged + 1 WHERE id = ?").run(runId);
}

// ---- counting walk — EXACT denominators (Phase 4). Replaces extrapolation entirely. ----
export interface CountResult {
  runId: number;
  folders: number;
  mediaFiles: number; // the EXACT denominator that matches files_recorded
  totalFiles: number; // everything seen (media + non-media), for the record
  elapsedMs: number;
}

/**
 * Walk the ENTIRE tree with directory listing only — no stat, no metadata, no inserts, no
 * transactions. Counts folders and, by extension alone, the exact number of MEDIA files the scan
 * will record. Descends exactly the folders the scan will (same dir-skip rules), so the media count
 * is the true denominator. Emits an indeterminate 'counting' progress with a live folder count —
 * it is NOT a percentage, because nothing is known until the walk finishes. Async + throttled so a
 * multi-terabyte count keeps the main process responsive.
 */
export async function countRun(
  db: Db, _orgId: string, runId: number,
  opts: { onProgress?: (p: ScanProgress) => void; rules?: SkipRules } = {}
): Promise<CountResult> {
  const rules = opts.rules ?? DEFAULT_SKIP_RULES;
  const run = getRun(db, runId);
  db.prepare(
    "UPDATE scan_runs SET status = 'counting', started_at = COALESCE(started_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(runId);

  const t0 = Date.now();
  let folders = 0, mediaFiles = 0, totalFiles = 0, lastEmit = 0;
  const stack: string[] = [run.root_path];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let listing: Listing;
    try {
      listing = listDirSorted(dir);
    } catch {
      continue; // an unreadable folder during counting just isn't counted; the scan will log it
    }
    folders += 1;
    for (const name of listing.files) {
      totalFiles += 1;
      if (fileSkipRule(name, rules)) continue;
      if (mediaClass(path.extname(name).replace(/^\./, "")) !== null) mediaFiles += 1;
    }
    for (const d of listing.dirs) {
      const full = path.join(dir, d);
      if (!dirSkipRule(d, rules) && !isReparseDir(full)) stack.push(full);
    }
    const now = Date.now();
    if (now - lastEmit >= PROGRESS_EMIT_INTERVAL_MS) {
      lastEmit = now;
      opts.onProgress?.({
        runId, status: "counting", currentFolder: dir, foldersCommitted: folders,
        filesRecorded: 0, errorsLogged: 0, estimatedFiles: mediaFiles, // running media tally, not a %
      });
    }
    await tick();
  }
  const elapsedMs = Math.max(1, Date.now() - t0);

  db.prepare(
    `UPDATE scan_runs SET status = 'estimating', total_files_expected = ?, total_folders_expected = ?,
     estimated_files = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(mediaFiles, folders, mediaFiles, runId);
  // Terminal-ish 'estimating' event carries the EXACT numbers for the estimate card.
  opts.onProgress?.({
    runId, status: "estimating", currentFolder: null, foldersCommitted: folders,
    filesRecorded: 0, errorsLogged: 0, estimatedFiles: mediaFiles,
  });
  return { runId, folders, mediaFiles, totalFiles, elapsedMs };
}

// ---- the crash-safe traversal core ----

interface FileRow {
  path: string;
  filename: string;
  extension: string;
  sizeBytes: number | null;
  kind: string;
  mtimeIso: string | null;
  capturedAt: string | null;
  capturedAtSource: "exif" | "file" | null; // NEVER conflated — a guessed date must not look measured
  cameraMake: string | null;
  cameraModel: string | null;
  lens: string | null;
  width: number | null;
  height: number | null;
  originalFilename: string | null;
  videoCodec: string | null;
  audioCodec: string | null;
  bitrate: number | null;
  durationSeconds: number | null;
  description: string | null;
  metadataDate: string | null;
  displayWidth: number | null;
  displayHeight: number | null;
  rotation: number | null;
  bitrateSource: string | null; // 'btrt' | 'esds' | 'computed' — provenance, never conflated
  errors: Array<{ stage: string; text: string }>; // become scan_errors rows in the same tx
}

// EXIF fields read — header tags only; exifr does chunked header reads and NEVER decodes pixels.
const EXIF_PICK = [
  "DateTimeOriginal", "DateTimeDigitized", "Make", "Model", "LensModel",
  "ExifImageWidth", "ExifImageHeight", "ImageWidth", "ImageHeight",
];

// Media containers (video AND audio, same treatment) — music-metadata (MIT, pure JavaScript),
// container metadata only: no decode, no frames, no thumbnails, ever. Replaces the GPLv3 ffprobe
// binary rejected 2026-07-19. Sequential like the EXIF pass: there is no spawn cost to hide, and
// parallel reads seek-thrash the spinning archive disks this module is pointed at.
// A file that cannot be parsed is recorded honestly (stage='media' error row, metadata stays NULL,
// kind stays as classified) — never given a guessed value. Known unsupported formats (AVI, MTS,
// M2TS, MPG, BRAW, R3D — and MOV until proven) land here by design so the gap is countable.
async function extractMediaMetadata(files: FileRow[]): Promise<void> {
  for (const f of files) {
    if (f.kind !== "video" && f.kind !== "audio") continue;
    // Route by capability: only call music-metadata for a container it can read. A known-unsupported
    // format (avi/mts/m2ts/mpg/wmv/braw/r3d) gets NO call and NO error row — it is a media row with
    // null container metadata, honestly. isobmff still runs below for iso-bmff video.
    if (!canMusicMetadata(f.extension)) {
      if (f.kind === "video" && canIsoBmff(f.extension)) runIsoBmff(f);
      continue;
    }
    try {
      const meta = await parseFile(f.path, { duration: true });
      const fmt = meta.format;
      const tracks = fmt.trackInfo ?? [];
      // Unrecognized bytes do NOT throw — parseFile resolves with an empty shell. Emptiness IS the
      // failure signal: record it honestly as an error row, never as a silently-blank media row.
      // No `continue`: the isobmff second engine below still gets its chance at the file.
      if (fmt.container === undefined && fmt.codec === undefined && tracks.length === 0 && !(typeof fmt.duration === "number" && fmt.duration > 0)) {
        f.errors.push({ stage: "media", text: "unrecognized or unreadable media container (no metadata extracted)" });
      } else {
      // ISO-BMFF quirk (probed 2026-07-19): music-metadata types EVERY MP4/MOV track as audio and
      // wraps raw stsd fourccs in angle brackets — classify video tracks by fourcc, not by t.video
      // (that field is populated for Matroska only, where it also carries pixel dimensions).
      const VIDEO_FOURCCS = new Set(["avc1","avc3","hvc1","hev1","mp4v","av01","vp08","vp09","dvhe","dvh1","apch","apcn","apcs","apco","ap4h","mjpa","jpeg"]);
      const stripCodec = (s: string): string => s.replace(/^<|>$/g, "").trim();
      let vTrackVideo: { pixelWidth?: number; pixelHeight?: number } | undefined;
      for (const t of tracks) {
        const cn = typeof t.codecName === "string" ? stripCodec(t.codecName) : "";
        if (cn === "") continue;
        if (t.video !== undefined) {
          if (!f.videoCodec) { f.videoCodec = cn; vTrackVideo = t.video; }
        } else if (VIDEO_FOURCCS.has(cn.toLowerCase())) {
          if (!f.videoCodec) f.videoCodec = cn;
        } else if (!f.audioCodec) {
          f.audioCodec = cn;
        }
      }
      // Pure-audio containers (WAV/MP3/FLAC…) carry the codec at format level, not in trackInfo.
      if (!f.audioCodec && typeof fmt.codec === "string" && fmt.codec.trim() !== "") f.audioCodec = fmt.codec;
      if (typeof vTrackVideo?.pixelWidth === "number" && vTrackVideo.pixelWidth > 0) f.width = vTrackVideo.pixelWidth;
      if (typeof vTrackVideo?.pixelHeight === "number" && vTrackVideo.pixelHeight > 0) f.height = vTrackVideo.pixelHeight;
      if (typeof fmt.duration === "number" && fmt.duration > 0) f.durationSeconds = fmt.duration;
      if (typeof fmt.bitrate === "number" && fmt.bitrate > 0) f.bitrate = Math.round(fmt.bitrate);
      const c = meta.common;
      const firstComment = Array.isArray(c.comment) && c.comment.length > 0 ? c.comment[0] : undefined;
      const commentText = typeof firstComment === "string" ? firstComment : firstComment?.text;
      const desc = c.description?.[0] ?? commentText;
      if (typeof desc === "string" && desc.trim() !== "") f.description = desc.trim();
      const tagDate = c.date ?? c.originaldate ?? (c.year != null ? String(c.year) : undefined);
      if (typeof tagDate === "string" && tagDate.trim() !== "") f.metadataDate = tagDate.trim();
      if (!f.metadataDate && fmt.creationTime instanceof Date && !Number.isNaN(fmt.creationTime.getTime())) {
        f.metadataDate = fmt.creationTime.toISOString();
      }
      }
    } catch (e) {
      f.errors.push({ stage: "media", text: e instanceof Error ? e.message : String(e) });
    }
    // SECOND ENGINE for iso-bmff video — merge, never overwrite.
    if (canIsoBmff(f.extension)) runIsoBmff(f);
  }
}

// isobmff geometry — MERGE, NEVER OVERWRITE: fills only what music-metadata left null/zero, and
// owns display/rotation/bitrate-source outright. A null return is a legitimate unreadable outcome,
// NOT an error row; an error row is written only if the reader throws (its contract forbids that).
function runIsoBmff(f: FileRow): void {
  try {
    const g = readIsoBmffGeometry(f.path);
    if (g === null) return;
    if ((f.width === null || f.width === 0) && g.encodedWidth !== null) f.width = g.encodedWidth;
    if ((f.height === null || f.height === 0) && g.encodedHeight !== null) f.height = g.encodedHeight;
    if ((f.bitrate === null || f.bitrate === 0) && g.bitrate !== null) {
      f.bitrate = g.bitrate;
      f.bitrateSource = g.bitrateSource;
    }
    if (f.videoCodec === null && g.videoFourCharacterCode !== null) f.videoCodec = g.videoFourCharacterCode;
    if (f.durationSeconds === null && g.durationSeconds !== null) f.durationSeconds = g.durationSeconds;
    f.displayWidth = g.displayWidth;
    f.displayHeight = g.displayHeight;
    f.rotation = g.rotation;
  } catch (e) {
    f.errors.push({ stage: "media", text: `isobmff reader threw unexpectedly: ${e instanceof Error ? e.message : String(e)}` });
  }
}

// Sequential by design: archive drives are spinning disks, and per-file header reads are
// milliseconds — parallel reads would seek-thrash the very hardware this module babies.
async function extractStillsMetadata(files: FileRow[]): Promise<void> {
  for (const f of files) {
    if (f.kind !== "image") continue;
    // Route by capability: bmp/gif are stills but exifr cannot read them — they get their row with
    // the honest file-date baseline and NO exifr call, NO error row. exifr runs only where it can,
    // so a throw here is a genuine failure on a format we expected to parse.
    if (!canExifr(f.extension)) continue;
    try {
      const meta = (await exifr.parse(f.path, { pick: EXIF_PICK })) as Record<string, unknown> | undefined;
      const dto = meta?.DateTimeOriginal ?? meta?.DateTimeDigitized;
      if (dto instanceof Date && !Number.isNaN(dto.getTime())) {
        f.capturedAt = dto.toISOString();
        f.capturedAtSource = "exif"; // measured, not guessed — the mtime baseline stays 'file'
      }
      if (typeof meta?.Make === "string") f.cameraMake = meta.Make.trim();
      if (typeof meta?.Model === "string") f.cameraModel = meta.Model.trim();
      if (typeof meta?.LensModel === "string") f.lens = meta.LensModel.trim();
      const w = meta?.ExifImageWidth ?? meta?.ImageWidth;
      const h = meta?.ExifImageHeight ?? meta?.ImageHeight;
      if (typeof w === "number" && w > 0) f.width = w;
      if (typeof h === "number" && h > 0) f.height = h;
      // original_filename: MakerNote DCF name is not decodable by any pure-JS library — the
      // current stem (set at stat time) is the documented fallback until/unless that changes.
    } catch (e) {
      // EXIF failure is never fatal: kind stays 'image', metadata stays at the honest file-date
      // baseline, the run continues. ABSENCE of EXIF is NOT a failure — a PNG/WebP/CR3 with no
      // parseable header makes exifr throw "Unknown file format"; that is the normal no-metadata
      // case, not corruption, and must NOT produce an error row (Defect D). Only a genuinely
      // unexpected exception is logged.
      const msg = e instanceof Error ? e.message : String(e);
      if (!/unknown file format|no exif|not a|unsupported|invalid/i.test(msg)) {
        f.errors.push({ stage: "exif", text: msg });
      }
    }
  }
}

export interface ScanProgress {
  runId: number;
  status: string;
  currentFolder: string | null;
  foldersCommitted: number;
  filesRecorded: number;
  errorsLogged: number;
  /** Rough guide only (probe extrapolation) — label it as such in any surface. */
  estimatedFiles: number | null;
  /** Present when the engine paused itself, e.g. "source-missing" after a drive unplug. */
  note?: string;
  /** Terminal-only: the written report path, or the write error, surfaced on completion. */
  reportPath?: string | null;
  reportError?: string | null;
}

interface EngineState {
  runId: number;
  pauseRequested: boolean;
  abortRequested: boolean;
  running: boolean;
}
// One scan at a time per process — a photographer's machine has one archive spinning, and two
// concurrent walks would thrash the same disk. ponytail: single-slot engine; queue if ever needed.
let active: EngineState | null = null;

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

export function isRunning(): boolean {
  return active?.running === true;
}

export function requestPause(runId: number): boolean {
  if (active?.running && active.runId === runId) {
    active.pauseRequested = true;
    return true;
  }
  return false;
}

export function requestAbort(db: Db, runId: number): boolean {
  if (active?.running && active.runId === runId) {
    active.abortRequested = true;
    return true;
  }
  // Not in flight (paused / crashed / estimating) — abort is a plain status write.
  const r = db
    .prepare(
      "UPDATE scan_runs SET status = 'aborted', finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('probing', 'estimating', 'paused', 'crashed')"
    )
    .run(runId);
  return r.changes > 0;
}

/**
 * Run (or resume) the traversal. Deterministic sorted depth-first; ONE transaction per folder
 * covering that folder's scan_files rows, its scan_folders rollup, the run counters, and the
 * resume_cursor — all or nothing. Resume re-walks the same order and skips any folder that already
 * has a committed scan_folders row, so a crash loses at most the in-flight folder. Memory stays
 * bounded: only one folder's file list is ever held.
 */
export async function startRun(
  db: Db,
  orgId: string,
  runId: number,
  opts: { resume?: boolean; onProgress?: (p: ScanProgress) => void; rules?: SkipRules; rawMode?: boolean } = {}
): Promise<ScanRunRow> {
  if (active?.running) throw new Error("a scan is already running — one at a time");
  const rules = opts.rules ?? DEFAULT_SKIP_RULES;
  const raw = opts.rawMode ?? RAW_MODE; // per-call override for the benchmark harness; const is the default
  const run = getRun(db, runId);
  const startable = opts.resume ? ["crashed", "paused"] : ["probing", "estimating"];
  if (!startable.includes(run.status)) {
    throw new Error(`run ${runId} is '${run.status}' — ${opts.resume ? "resume" : "start"} needs ${startable.join("/")}`);
  }

  active = { runId, pauseRequested: false, abortRequested: false, running: true };
  db.prepare(
    "UPDATE scan_runs SET status = 'running', started_at = COALESCE(started_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(runId);

  // Real arithmetic: the denominator is the EXACT media-file count from the counting walk (Phase 4),
  // stored on the run. No 99% clamp — filesRecorded reaches total_files_expected at completion.
  let lastEmit = 0;
  const emit = (note?: string): void => {
    const r = getRun(db, runId);
    opts.onProgress?.({
      runId, status: r.status, currentFolder: r.resume_cursor,
      foldersCommitted: r.folders_committed, filesRecorded: r.files_recorded,
      errorsLogged: r.errors_logged, estimatedFiles: r.total_files_expected ?? r.estimated_files,
      ...(note ? { note } : {}),
    });
  };
  const maybeEmit = (): void => {
    const now = Date.now();
    if (now - lastEmit < PROGRESS_EMIT_INTERVAL_MS) return;
    lastEmit = now;
    emit();
  };
  emit(); // immediate 'running' so the UI switches to the console the instant Start is pressed
  lastEmit = Date.now();

  const isCommitted = db.prepare("SELECT 1 FROM scan_folders WHERE run_id = ? AND path = ?");
  const insFolder = db.prepare(
    `INSERT INTO scan_folders (uuid, org_id, run_id, drive_id, path, depth, parent_path, file_count,
       image_count, video_count, audio_count, other_count, unreadable_count, total_bytes,
       total_files, media_files, date_min, date_max, top_camera, top_lens, committed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  );
  const insFile = db.prepare(
    `INSERT INTO scan_files (uuid, org_id, run_id, folder_id, path, filename, extension, size_bytes, kind,
       captured_at, captured_at_source, camera_make, camera_model, lens, width, height, original_filename,
       video_codec, audio_codec, bitrate, duration_seconds, description, metadata_date,
       display_width, display_height, rotation, bitrate_source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const bumpRun = db.prepare(
    `UPDATE scan_runs SET folders_committed = folders_committed + ?, files_recorded = files_recorded + ?,
     errors_logged = errors_logged + ?, resume_cursor = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  );
  const insError = db.prepare(
    `INSERT INTO scan_errors (uuid, org_id, run_id, path, extension, stage, error_text, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  );

  interface Committable { dir: string; depth: number; parent: string | null; files: FileRow[]; totalFilesSeen: number }

  // Commit a BATCH of folders in ONE transaction — one folder by default; up to RAW_COMMIT_BATCH in
  // RAW_MODE. Metadata extraction runs BEFORE this, so every committed folder is complete; the
  // resume_cursor advances to the last folder in the batch (a crash loses only the uncommitted tail).
  const commitBatch = db.transaction((batch: Committable[]) => {
    let mediaTotal = 0, errorTotal = 0, cursor = "";
    for (const { dir, depth, parent, files, totalFilesSeen } of batch) {
      const counts = { image: 0, video: 0, audio: 0, unreadable: 0 };
      let bytes = 0, dateMin: string | null = null, dateMax: string | null = null;
      const cameraFreq = new Map<string, number>(), lensFreq = new Map<string, number>();
      for (const f of files) {
        if (f.kind === "image") counts.image++;
        else if (f.kind === "video") counts.video++;
        else if (f.kind === "audio") counts.audio++;
        else counts.unreadable++;
        bytes += f.sizeBytes ?? 0;
        if (f.capturedAt) {
          if (dateMin === null || f.capturedAt < dateMin) dateMin = f.capturedAt;
          if (dateMax === null || f.capturedAt > dateMax) dateMax = f.capturedAt;
        }
        if (f.cameraModel) cameraFreq.set(f.cameraModel, (cameraFreq.get(f.cameraModel) ?? 0) + 1);
        if (f.lens) lensFreq.set(f.lens, (lensFreq.get(f.lens) ?? 0) + 1);
      }
      const top = (m: Map<string, number>): string | null =>
        m.size === 0 ? null : [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
      const folderInfo = insFolder.run(
        generateUUIDv7(), orgId, runId, run.drive_id, dir, depth, parent, files.length,
        counts.image, counts.video, counts.audio, 0, counts.unreadable, bytes,
        totalFilesSeen, files.length, dateMin, dateMax, top(cameraFreq), top(lensFreq)
      );
      const folderId = Number(folderInfo.lastInsertRowid);
      for (const f of files) {
        insFile.run(
          generateUUIDv7(), orgId, runId, folderId, f.path, f.filename, f.extension, f.sizeBytes, f.kind,
          f.capturedAt, f.capturedAtSource, f.cameraMake, f.cameraModel, f.lens, f.width, f.height,
          f.originalFilename, f.videoCodec, f.audioCodec, f.bitrate, f.durationSeconds, f.description, f.metadataDate,
          f.displayWidth, f.displayHeight, f.rotation, f.bitrateSource
        );
        for (const err of f.errors) {
          insError.run(generateUUIDv7(), orgId, runId, f.path, f.extension, err.stage, err.text);
          errorTotal += 1;
        }
      }
      mediaTotal += files.length;
      cursor = dir;
    }
    bumpRun.run(batch.length, mediaTotal, errorTotal, cursor, runId);
  });

  const pending: Committable[] = [];
  const flushPending = (): void => {
    if (pending.length === 0) return;
    commitBatch(pending.splice(0, pending.length));
  };

  // RAW_MODE throughput logging — files/sec, folders/sec, elapsed, to the console only.
  const rawStart = Date.now();
  const rawLog = (): void => {
    if (!raw) return;
    const r = getRun(db, runId);
    const secs = Math.max(0.001, (Date.now() - rawStart) / 1000);
    console.log(`[scan RAW] ${r.folders_committed} folders · ${r.files_recorded} media files · ${(r.files_recorded / secs).toFixed(0)} files/s · ${(r.folders_committed / secs).toFixed(1)} folders/s · ${secs.toFixed(0)}s elapsed`);
  };

  interface Node { dir: string; depth: number; parent: string | null }
  const stack: Node[] = [{ dir: run.root_path, depth: 0, parent: null }];

  try {
    while (stack.length > 0) {
      if (active.abortRequested) {
        flushPending(); // commit whatever is gathered before stopping
        db.prepare(
          "UPDATE scan_runs SET status = 'aborted', finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).run(runId);
        emit();
        return getRun(db, runId);
      }
      if (active.pauseRequested) {
        flushPending();
        db.prepare("UPDATE scan_runs SET status = 'paused', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(runId);
        emit();
        return getRun(db, runId);
      }

      const node = stack.pop() as Node;
      let listing: Listing;
      try {
        listing = listDirSorted(node.dir);
      } catch (e) {
        if (!fs.existsSync(run.root_path)) {
          // Source vanished mid-run (drive unplugged): commit gathered work, pause, stay resumable.
          flushPending();
          db.prepare("UPDATE scan_runs SET status = 'paused', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(runId);
          emit("source-missing");
          return getRun(db, runId);
        }
        // One unreadable folder is a genuine failure (permission denied) — error row, then move on.
        // Distinct from a deliberate skip, which is never logged.
        logEvent(db, orgId, runId, node.dir, "stat", e instanceof Error ? e.message : String(e));
        continue;
      }

      // Reparse points and rule-skipped dirs: never followed. DELIBERATE SKIPS ARE NOT ERROR ROWS
      // (Phase 3.5) — they are simply not descended. isReparseDir/dirSkipRule govern; nothing logged.
      const subdirs: string[] = [];
      for (const d of listing.dirs) {
        const full = path.join(node.dir, d);
        if (!dirSkipRule(d, rules) && !isReparseDir(full)) subdirs.push(d);
      }

      // Resume: a folder that already has its committed row is skipped — but its SUBFOLDERS may
      // not be, so descent continues either way. Deterministic order makes the cursor meaningful.
      if (!isCommitted.get(runId, node.dir)) {
        const fileRows: FileRow[] = [];
        let totalFilesSeen = 0; // everything the listing showed (media + non-media + rule-skipped)
        for (const name of listing.files) {
          totalFilesSeen += 1;
          if (fileSkipRule(name, rules)) continue; // deliberate skip — counted, no row, no error
          const ext = path.extname(name).replace(/^\./, "");
          const cls = mediaClass(ext);
          if (cls === null) continue; // NON-MEDIA — counted in totalFilesSeen, no row, no parser, no error
          const full = path.join(node.dir, name);
          const blank = {
            capturedAt: null, capturedAtSource: null as FileRow["capturedAtSource"], cameraMake: null,
            cameraModel: null, lens: null, width: null, height: null, originalFilename: null,
            videoCodec: null, audioCodec: null, bitrate: null, durationSeconds: null,
            description: null, metadataDate: null,
            displayWidth: null, displayHeight: null, rotation: null, bitrateSource: null,
          };
          try {
            const st = fs.lstatSync(full);
            fileRows.push({
              path: full, filename: name, extension: ext, sizeBytes: st.size, kind: cls,
              mtimeIso: st.mtime.toISOString(), errors: [], ...blank,
              capturedAt: st.mtime.toISOString(), // honest file-date baseline; EXIF upgrades it
              capturedAtSource: "file",
              originalFilename: path.basename(name, path.extname(name)),
            });
          } catch (e) {
            // A MEDIA file we could not even stat is a genuine failure — error row, kind unreadable.
            fileRows.push({
              path: full, filename: name, extension: ext, sizeBytes: null, kind: "unreadable",
              mtimeIso: null, errors: [{ stage: "stat", text: e instanceof Error ? e.message : String(e) }], ...blank,
            });
          }
        }
        // Metadata BEFORE the transaction — a committed folder always carries its metadata; a crash
        // mid-extraction loses only the uncommitted folder. Class-routed inside each extractor.
        await extractStillsMetadata(fileRows);
        await extractMediaMetadata(fileRows);
        pending.push({ dir: node.dir, depth: node.depth, parent: node.parent, files: fileRows, totalFilesSeen });
        // Commit per folder (default) or every RAW_COMMIT_BATCH folders (RAW_MODE diagnostic).
        if (!raw || pending.length >= RAW_COMMIT_BATCH) { flushPending(); rawLog(); }
        maybeEmit();
      }

      for (let i = subdirs.length - 1; i >= 0; i--) {
        stack.push({ dir: path.join(node.dir, subdirs[i]), depth: node.depth + 1, parent: node.dir });
      }
      await tick(); // yield between folders — the main process must stay responsive for hours
    }
    flushPending(); // RAW_MODE tail — commit whatever is left before finishing
    rawLog();

    db.prepare(
      "UPDATE scan_runs SET status = 'completed', finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(runId);
    if (run.drive_id != null) {
      db.prepare("UPDATE scan_drives SET last_scanned_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(run.drive_id);
    }
    emit();
    return getRun(db, runId);
  } finally {
    active.running = false;
  }
}

export function listRuns(db: Db, orgId: string, limit = 50): ScanRunRow[] {
  return db
    .prepare("SELECT * FROM scan_runs WHERE org_id = ? ORDER BY id DESC LIMIT ?")
    .all(orgId, limit) as ScanRunRow[];
}

export function runStatus(db: Db, runId: number): { run: ScanRunRow; engineActive: boolean } {
  return { run: getRun(db, runId), engineActive: active?.running === true && active.runId === runId };
}

/** Most recent run for a volume by SERIAL (identity, not the drive letter) — powers the
    already-scanned/show-report path and Option B's per-drive card. Null if the drive or run is unknown. */
export function lastRunForVolume(db: Db, orgId: string, volumeSerial: string): ScanRunRow | null {
  const drive = db
    .prepare("SELECT id FROM scan_drives WHERE org_id = ? AND volume_serial = ?")
    .get(orgId, volumeSerial) as { id: number } | undefined;
  if (!drive) return null;
  return (db
    .prepare("SELECT * FROM scan_runs WHERE org_id = ? AND drive_id = ? ORDER BY id DESC LIMIT 1")
    .get(orgId, drive.id) as ScanRunRow | undefined) ?? null;
}

export interface ScanFolderSummary {
  path: string;
  depth: number;
  file_count: number;
  image_count: number;
  video_count: number;
  audio_count: number;
  total_bytes: number;
  date_min: string | null;
  date_max: string | null;
  top_camera: string | null;
}
/** Top-level folders of a run for Option B's table (shallowest first, largest first within depth). */
export function listFolders(db: Db, runId: number, limit = 200): ScanFolderSummary[] {
  return db
    .prepare(
      `SELECT path, depth, file_count, image_count, video_count, audio_count, total_bytes,
              date_min, date_max, top_camera
       FROM scan_folders WHERE run_id = ? ORDER BY depth ASC, total_bytes DESC LIMIT ?`
    )
    .all(runId, limit) as ScanFolderSummary[];
}
