// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Scan engine — READ-ONLY against the source, always. The only writes are rows into
//              the org database. Deterministic sorted depth-first order everywhere (probe and
//              traversal share the same walk shape) so a resume lands exactly where a fresh run
//              would. The probe samples PROBE_FOLDER_SAMPLE folders, extrapolates a ROUGH estimate
//              (labelled as such), persists it, and returns — it never rolls into the full scan.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/scan/index.ts
//------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";
import exifr from "exifr";
import { parseFile } from "music-metadata";
import { generateUUIDv7 } from "../utils/uuidv7";
import type { Db } from "./db";
import type { ScanRunRow } from "./drives";

/** Folders sampled by the probe before estimating. Named constant by design. */
export const PROBE_FOLDER_SAMPLE = 50;

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

// ---- kind from extension only (this phase reads no file contents) ----
const IMAGE_EXTS = new Set(["jpg","jpeg","png","gif","tif","tiff","bmp","heic","heif","webp","dng","cr2","cr3","crw","nef","nrw","arw","srf","sr2","raf","orf","rw2","pef","srw","rwl","iiq","dcr","x3f","3fr","erf","kdc","k25","mef","mrw","raw","psd"]);
const VIDEO_EXTS = new Set(["mp4","mov","avi","mts","m2ts","mkv","wmv","mpg","mpeg","m4v","webm","braw","r3d","3gp"]);
const AUDIO_EXTS = new Set(["wav","mp3","aac","m4a","flac","ogg","wma","aif","aiff"]);
const SIDECAR_EXTS = new Set(["xmp","thm","aae","lrv","pp3","dop","cos"]);
export function kindForExtension(ext: string): "image" | "video" | "audio" | "sidecar" | "other" {
  const e = ext.toLowerCase();
  if (IMAGE_EXTS.has(e)) return "image";
  if (VIDEO_EXTS.has(e)) return "video";
  if (AUDIO_EXTS.has(e)) return "audio";
  if (SIDECAR_EXTS.has(e)) return "sidecar";
  return "other";
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

// ---- probe — sample, extrapolate, persist, RETURN (never continues into the full scan) ----
export interface ProbeResult {
  runId: number;
  foldersSampled: number;
  filesFound: number;
  elapsedMs: number;
  /** ROUGH GUIDE ONLY — extrapolated from a small sample; label it as such wherever it surfaces. */
  estimatedFiles: number | null;
  estimatedSeconds: number | null;
  roughGuide: true;
}

export function probeRun(db: Db, _orgId: string, runId: number, rules: SkipRules = DEFAULT_SKIP_RULES): ProbeResult {
  const run = getRun(db, runId);
  db.prepare(
    "UPDATE scan_runs SET status = 'probing', started_at = COALESCE(started_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(runId);

  const t0 = Date.now();
  let foldersSampled = 0;
  let filesFound = 0;
  let bytesSeen = 0;

  // Same deterministic DFS the real traversal uses, capped at PROBE_FOLDER_SAMPLE folders.
  const stack: string[] = [run.root_path];
  while (stack.length > 0 && foldersSampled < PROBE_FOLDER_SAMPLE) {
    const dir = stack.pop() as string;
    let listing: Listing;
    try {
      listing = listDirSorted(dir);
    } catch {
      continue; // probe is a sample — unreadable folders just shrink it
    }
    foldersSampled += 1;
    for (const f of listing.files) {
      if (fileSkipRule(f, rules)) continue;
      filesFound += 1;
      try {
        bytesSeen += fs.lstatSync(path.join(dir, f)).size;
      } catch {
        /* unreadable during probe — sample only */
      }
    }
    const subdirs = listing.dirs.filter((d) => !dirSkipRule(d, rules));
    for (let i = subdirs.length - 1; i >= 0; i--) stack.push(path.join(dir, subdirs[i]));
  }
  const elapsedMs = Math.max(1, Date.now() - t0);

  // Extrapolation: average file size from the sample vs the volume's used bytes gives estimated
  // files (drive unit only — a folder's total bytes are unknowable without the full walk);
  // observed files-per-second gives estimated seconds. Rough guide, stored beside the eventual
  // real duration (started_at/finished_at) so later estimates can be calibrated.
  const filesPerSecond = filesFound / (elapsedMs / 1000);
  const avgBytesPerFile = filesFound > 0 ? bytesSeen / filesFound : 0;
  let estimatedFiles: number | null = null;
  if (run.scan_unit === "drive" && avgBytesPerFile > 0 && run.drive_id != null) {
    const drive = db.prepare("SELECT total_bytes, free_bytes FROM scan_drives WHERE id = ?").get(run.drive_id) as
      | { total_bytes: number | null; free_bytes: number | null }
      | undefined;
    const used = (drive?.total_bytes ?? 0) - (drive?.free_bytes ?? 0);
    if (used > 0) estimatedFiles = Math.round(used / avgBytesPerFile);
  }
  const estimatedSeconds = estimatedFiles != null && filesPerSecond > 0 ? estimatedFiles / filesPerSecond : null;

  db.prepare(
    `UPDATE scan_runs SET status = 'estimating', probe_folders_sampled = ?, probe_files_found = ?,
     estimated_files = ?, estimated_seconds = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(foldersSampled, filesFound, estimatedFiles, estimatedSeconds, runId);

  return { runId, foldersSampled, filesFound, elapsedMs, estimatedFiles, estimatedSeconds, roughGuide: true };
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
    try {
      const meta = await parseFile(f.path, { duration: true });
      const fmt = meta.format;
      const tracks = fmt.trackInfo ?? [];
      // Unrecognized bytes do NOT throw — parseFile resolves with an empty shell. Emptiness IS the
      // failure signal: record it honestly as an error row, never as a silently-blank media row.
      if (fmt.container === undefined && fmt.codec === undefined && tracks.length === 0 && !(typeof fmt.duration === "number" && fmt.duration > 0)) {
        f.errors.push({ stage: "media", text: "unrecognized or unreadable media container (no metadata extracted)" });
        continue;
      }
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
    } catch (e) {
      f.errors.push({ stage: "media", text: e instanceof Error ? e.message : String(e) });
    }
  }
}

// Sequential by design: archive drives are spinning disks, and per-file header reads are
// milliseconds — parallel reads would seek-thrash the very hardware this module babies.
async function extractStillsMetadata(files: FileRow[]): Promise<void> {
  for (const f of files) {
    if (f.kind !== "image") continue;
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
      // baseline, an error row records it, the run continues.
      f.errors.push({ stage: "exif", text: e instanceof Error ? e.message : String(e) });
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
  opts: { resume?: boolean; onProgress?: (p: ScanProgress) => void; rules?: SkipRules } = {}
): Promise<ScanRunRow> {
  if (active?.running) throw new Error("a scan is already running — one at a time");
  const rules = opts.rules ?? DEFAULT_SKIP_RULES;
  const run = getRun(db, runId);
  const startable = opts.resume ? ["crashed", "paused"] : ["probing", "estimating"];
  if (!startable.includes(run.status)) {
    throw new Error(`run ${runId} is '${run.status}' — ${opts.resume ? "resume" : "start"} needs ${startable.join("/")}`);
  }

  active = { runId, pauseRequested: false, abortRequested: false, running: true };
  db.prepare(
    "UPDATE scan_runs SET status = 'running', started_at = COALESCE(started_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(runId);

  const progress = (note?: string): void => {
    const r = getRun(db, runId);
    opts.onProgress?.({
      runId,
      status: r.status,
      currentFolder: r.resume_cursor,
      foldersCommitted: r.folders_committed,
      filesRecorded: r.files_recorded,
      errorsLogged: r.errors_logged,
      estimatedFiles: r.estimated_files,
      ...(note ? { note } : {}),
    });
  };

  const isCommitted = db.prepare("SELECT 1 FROM scan_folders WHERE run_id = ? AND path = ?");
  const insFolder = db.prepare(
    `INSERT INTO scan_folders (uuid, org_id, run_id, drive_id, path, depth, parent_path, file_count,
       image_count, video_count, audio_count, other_count, unreadable_count, total_bytes,
       date_min, date_max, top_camera, top_lens, committed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  );
  const insFile = db.prepare(
    `INSERT INTO scan_files (uuid, org_id, run_id, folder_id, path, filename, extension, size_bytes, kind,
       captured_at, captured_at_source, camera_make, camera_model, lens, width, height, original_filename,
       video_codec, audio_codec, bitrate, duration_seconds, description, metadata_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const bumpRun = db.prepare(
    `UPDATE scan_runs SET folders_committed = folders_committed + 1, files_recorded = files_recorded + ?,
     errors_logged = errors_logged + ?, resume_cursor = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  );
  const insError = db.prepare(
    `INSERT INTO scan_errors (uuid, org_id, run_id, path, extension, stage, error_text, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  );

  // ONE transaction per folder: rollup + every file row (metadata included) + counters + cursor.
  // All or nothing — metadata extraction runs BEFORE this, so a committed folder is always complete.
  const commitFolder = db.transaction(
    (dir: string, depth: number, parent: string | null, files: FileRow[]) => {
      const counts = { image: 0, video: 0, audio: 0, other: 0, unreadable: 0 };
      let bytes = 0;
      let dateMin: string | null = null;
      let dateMax: string | null = null;
      const cameraFreq = new Map<string, number>();
      const lensFreq = new Map<string, number>();
      for (const f of files) {
        if (f.kind === "image") counts.image++;
        else if (f.kind === "video") counts.video++;
        else if (f.kind === "audio") counts.audio++;
        else if (f.kind === "unreadable") counts.unreadable++;
        else counts.other++; // sidecar folds into other for the rollup
        bytes += f.sizeBytes ?? 0;
        // Rollups from this folder's own files: date range over media capture dates, most
        // frequent camera and lens over the stills.
        if (f.capturedAt && (f.kind === "image" || f.kind === "video" || f.kind === "audio")) {
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
        counts.image, counts.video, counts.audio, counts.other, counts.unreadable, bytes,
        dateMin, dateMax, top(cameraFreq), top(lensFreq)
      );
      const folderId = Number(folderInfo.lastInsertRowid);
      let errorRows = 0;
      for (const f of files) {
        insFile.run(
          generateUUIDv7(), orgId, runId, folderId, f.path, f.filename, f.extension, f.sizeBytes, f.kind,
          f.capturedAt, f.capturedAtSource, f.cameraMake, f.cameraModel, f.lens, f.width, f.height,
          f.originalFilename, f.videoCodec, f.audioCodec, f.bitrate, f.durationSeconds, f.description, f.metadataDate
        );
        for (const err of f.errors) {
          insError.run(generateUUIDv7(), orgId, runId, f.path, f.extension, err.stage, err.text);
          errorRows += 1;
        }
      }
      bumpRun.run(files.length, errorRows, dir, runId);
    }
  );

  interface Node {
    dir: string;
    depth: number;
    parent: string | null;
  }
  const stack: Node[] = [{ dir: run.root_path, depth: 0, parent: null }];

  try {
    while (stack.length > 0) {
      if (active.abortRequested) {
        db.prepare(
          "UPDATE scan_runs SET status = 'aborted', finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).run(runId);
        progress();
        return getRun(db, runId);
      }
      if (active.pauseRequested) {
        db.prepare("UPDATE scan_runs SET status = 'paused', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(runId);
        progress();
        return getRun(db, runId);
      }

      const node = stack.pop() as Node;
      let listing: Listing;
      try {
        listing = listDirSorted(node.dir);
      } catch (e) {
        if (!fs.existsSync(run.root_path)) {
          // Source vanished mid-run (drive unplugged): pause, stay resumable, say so plainly.
          db.prepare("UPDATE scan_runs SET status = 'paused', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(runId);
          progress("source-missing");
          return getRun(db, runId);
        }
        // One unreadable folder never aborts a run — log and move on.
        logEvent(db, orgId, runId, node.dir, "stat", e instanceof Error ? e.message : String(e));
        continue;
      }

      // Reparse points (symlinks, junctions): never followed, logged, never silent.
      for (const s of listing.symlinks) {
        logEvent(db, orgId, runId, path.join(node.dir, s), "stat", "skipped: symlink/junction (not followed)");
      }

      const subdirs: string[] = [];
      for (const d of listing.dirs) {
        const rule = dirSkipRule(d, rules);
        const full = path.join(node.dir, d);
        if (rule) {
          logEvent(db, orgId, runId, full, "stat", `skipped: ${rule}`);
        } else if (isReparseDir(full)) {
          logEvent(db, orgId, runId, full, "stat", "skipped: symlink/junction (not followed)");
        } else {
          subdirs.push(d);
        }
      }

      // Resume: a folder that already has its committed row is skipped — but its SUBFOLDERS may
      // not be, so descent continues either way. Deterministic order makes the cursor meaningful.
      if (!isCommitted.get(runId, node.dir)) {
        const fileRows: FileRow[] = [];
        for (const name of listing.files) {
          const full = path.join(node.dir, name);
          const rule = fileSkipRule(name, rules);
          if (rule) {
            logEvent(db, orgId, runId, full, "stat", `skipped: ${rule}`);
            continue;
          }
          const ext = path.extname(name).replace(/^\./, "");
          const blank = {
            capturedAt: null, capturedAtSource: null as FileRow["capturedAtSource"], cameraMake: null,
            cameraModel: null, lens: null, width: null, height: null, originalFilename: null,
            videoCodec: null, audioCodec: null, bitrate: null, durationSeconds: null,
            description: null, metadataDate: null,
          };
          try {
            const st = fs.lstatSync(full);
            const kind = kindForExtension(ext);
            const media = kind === "image" || kind === "video" || kind === "audio";
            fileRows.push({
              path: full, filename: name, extension: ext, sizeBytes: st.size, kind,
              mtimeIso: st.mtime.toISOString(), errors: [], ...blank,
              // Baseline before extraction: honest file-date, honestly labelled. EXIF upgrades it.
              capturedAt: media ? st.mtime.toISOString() : null,
              capturedAtSource: media ? "file" : null,
              originalFilename: media ? path.basename(name, path.extname(name)) : null,
            });
          } catch (e) {
            fileRows.push({
              path: full, filename: name, extension: ext, sizeBytes: null, kind: "unreadable",
              mtimeIso: null, errors: [{ stage: "stat", text: e instanceof Error ? e.message : String(e) }], ...blank,
            });
          }
        }
        // Metadata extraction happens HERE — before the transaction — so the per-folder commit
        // stays atomic: a committed folder always carries its metadata, a crash mid-extraction
        // loses only the uncommitted folder. Failures become error rows, never aborts.
        await extractStillsMetadata(fileRows);
        await extractMediaMetadata(fileRows);
        commitFolder(node.dir, node.depth, node.parent, fileRows);
        progress(); // folder-level, never per-file
      }

      for (let i = subdirs.length - 1; i >= 0; i--) {
        stack.push({ dir: path.join(node.dir, subdirs[i]), depth: node.depth + 1, parent: node.dir });
      }
      await tick(); // yield between folders — the main process must stay responsive for hours
    }

    db.prepare(
      "UPDATE scan_runs SET status = 'completed', finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(runId);
    if (run.drive_id != null) {
      db.prepare("UPDATE scan_drives SET last_scanned_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(run.drive_id);
    }
    progress();
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
