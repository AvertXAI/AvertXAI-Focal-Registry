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
const IMAGE_EXTS = new Set(["jpg","jpeg","png","gif","tif","tiff","bmp","heic","heif","webp","dng","cr2","cr3","nef","nrw","arw","raf","orf","rw2","pef","srw","x3f","3fr","erf","kdc","mrw","raw","psd"]);
const VIDEO_EXTS = new Set(["mp4","mov","avi","mts","m2ts","mkv","wmv","mpg","mpeg","m4v","webm","braw","r3d","3gp"]);
const AUDIO_EXTS = new Set(["wav","mp3","aac","m4a","flac","ogg","wma","aif","aiff"]);
const SIDECAR_EXTS = new Set(["xmp","thm","lrv","pp3","dop","cos"]);
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

export function probeRun(db: Db, orgId: string, runId: number, rules: SkipRules = DEFAULT_SKIP_RULES): ProbeResult {
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
