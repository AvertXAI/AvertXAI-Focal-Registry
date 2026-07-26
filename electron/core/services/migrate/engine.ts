// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Migrate engine — discovery (crash-safe walk, Scan's pattern: exact pre-count, ONE
//              transaction per folder covering rows + counters + cursor) and bundle export (the
//              shared copyVerified core with hash:TRUE — bundles land on removable media, which
//              fails silently). Jobs drain a SINGLE-SLOT queue (Jason's ruling — same-drive
//              parallelism causes disk contention); tabs are renderer state.
//              READ-ONLY toward sources, always: no rename/unlink/write against a found file, ever.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/migrate/engine.ts
//------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";
import { generateUUIDv7 } from "../utils/uuidv7";
import { isExcludedDir } from "../scan/media";
import { copyVerified } from "../shared/copyVerified";
import { listVolumes } from "../scan/drives";
import { ASSET_CLASSES, bundleSubfolder } from "./registry";
import type { Db } from "./db";

export const MIGRATE_COMMIT_BATCH_YIELD = 32; // folders between event-loop yields on the count walk

export interface MigrateProgress {
  kind: "discover" | "bundle";
  jobId: number;
  bundleId?: number;
  status: string; // job/bundle status ('counting' | 'running' | terminal states)
  currentPath: string | null;
  foldersWalked: number;
  foldersTotal: number | null; // exact denominator once the pre-count finishes
  filesFound: number;
  copied?: number;
  failed?: number;
  totalItems?: number;
  bytesDone?: number;
  bytesTotal?: number;
  error?: string;
}
type OnProgress = (p: MigrateProgress) => void;

export interface CreateJobOpts {
  label: string;
  targetKind: "drive" | "folders";
  driveId: number | null;
  rootPaths: string[];
  classes: string[];
  extensions: string[]; // lowercase, no dot — the user's selected subset
  optFolderNames: boolean;
  optSubfolders: boolean;
  optHidden: boolean;
}

export interface MigrateJobRow {
  id: number; uuid: string; org_id: string; label: string | null; target_kind: string;
  drive_id: number | null; root_paths: string; classes: string; extensions: string;
  opt_folder_names: number; opt_subfolders: number; opt_hidden: number; status: string;
  folders_walked: number; files_seen: number; files_found: number; errors_logged: number;
  total_folders_expected: number | null; resume_cursor: string | null;
  started_at: string | null; finished_at: string | null;
}
export interface MigrateItemRow {
  id: number; job_id: number; asset_class: string; extension: string | null; source_path: string;
  filename: string; size_bytes: number | null; mtime: string | null; selected: number; is_shipped_default: number;
}
export interface MigrateBundleRow {
  id: number; job_id: number; destination_root: string; status: string; item_count: number;
  bytes_total: number; items_copied: number; items_failed: number; started_at: string | null; finished_at: string | null;
}

/** Runs left 'running' by a crash become 'crashed' before any UI asks (Scan's pattern). */
export function markInterruptedMigrate(db: Db): void {
  db.prepare("UPDATE migrate_jobs SET status = 'crashed', finished_at = CURRENT_TIMESTAMP WHERE status IN ('running','counting')").run();
  db.prepare("UPDATE migrate_bundles SET status = 'crashed', finished_at = CURRENT_TIMESTAMP WHERE status = 'running'").run();
}

// A file that shipped with an Adobe install — found, but UNTICKED by default (the new machine has it).
const SHIPPED_RE = /[\\/]program files( \(x86\))?[\\/]adobe[\\/]/i;

const PROGRESS_THROTTLE_MS = 400; // Scan's cadence; state transitions always send
let lastProgressAt = 0;
function throttled(onProgress: OnProgress, p: MigrateProgress, force = false): void {
  const now = Date.now();
  if (!force && now - lastProgressAt < PROGRESS_THROTTLE_MS) return;
  lastProgressAt = now;
  onProgress(p);
}

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

// Deterministic sorted listing (Scan's ONE sort — codepoint order, locale-free).
function listSorted(dir: string): { dirs: string[]; files: string[] } | null {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null; // unreadable — log + skip, never crash the run
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const dirs: string[] = [];
  const files: string[] = [];
  for (const e of entries) {
    if (e.isDirectory()) dirs.push(e.name);
    else if (e.isFile()) files.push(e.name);
  }
  return { dirs, files };
}

const isHiddenName = (name: string): boolean => name.startsWith(".");
// ponytail: dotfile heuristic — true Windows hidden-ATTRIBUTE detection needs a per-entry attrib
// call (or a native dep); the option gate covers dot-prefixed and the excluded-dir list. Upgrade
// path: batch attrib -s -h listing per folder if real-world trees demand it.

const aborting = new Set<number>();
export function requestAbortJob(jobId: number): boolean {
  aborting.add(jobId);
  return true;
}

// ---- the single-slot queue --------------------------------------------------------------------
let draining = false;
export function isEngineBusy(): boolean {
  return draining;
}

export function createJob(db: Db, orgId: string, opts: CreateJobOpts): number {
  const info = db
    .prepare(
      `INSERT INTO migrate_jobs (uuid, org_id, label, target_kind, drive_id, root_paths, classes,
         extensions, opt_folder_names, opt_subfolders, opt_hidden, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued')`
    )
    .run(
      generateUUIDv7(), orgId, opts.label, opts.targetKind, opts.driveId,
      JSON.stringify(opts.rootPaths), JSON.stringify(opts.classes), JSON.stringify(opts.extensions),
      opts.optFolderNames ? 1 : 0, opts.optSubfolders ? 1 : 0, opts.optHidden ? 1 : 0
    );
  return Number(info.lastInsertRowid);
}

/** Drain queued jobs one at a time (single-slot ruling). Fire-and-forget from the IPC layer. */
export async function pumpQueue(db: Db, orgId: string, onProgress: OnProgress): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    for (;;) {
      const job = db
        .prepare("SELECT * FROM migrate_jobs WHERE org_id = ? AND status = 'queued' ORDER BY id LIMIT 1")
        .get(orgId) as MigrateJobRow | undefined;
      if (!job) break;
      try {
        await runDiscovery(db, orgId, job, onProgress);
      } catch (e) {
        db.prepare("UPDATE migrate_jobs SET status = 'failed', finished_at = CURRENT_TIMESTAMP WHERE id = ?").run(job.id);
        throttled(onProgress, {
          kind: "discover", jobId: job.id, status: "failed", currentPath: null,
          foldersWalked: 0, foldersTotal: null, filesFound: 0,
          error: e instanceof Error ? e.message : String(e),
        }, true);
      }
    }
  } finally {
    draining = false;
  }
}

// ---- discovery --------------------------------------------------------------------------------
async function runDiscovery(db: Db, orgId: string, job: MigrateJobRow, onProgress: OnProgress): Promise<void> {
  const roots = (JSON.parse(job.root_paths) as string[]).map((r) => path.resolve(r));
  const selectedClasses = new Set(JSON.parse(job.classes) as string[]);
  const selectedExts = new Set((JSON.parse(job.extensions) as string[]).map((e) => e.toLowerCase()));
  const followSub = job.opt_subfolders === 1;
  const includeHidden = job.opt_hidden === 1;
  const folderNamesOn = job.opt_folder_names === 1;

  // ext → class map + folder-name → class map, from the SELECTED subset only.
  const extClass = new Map<string, string>();
  const folderClass = new Map<string, string>();
  for (const c of ASSET_CLASSES) {
    if (!selectedClasses.has(c.key)) continue;
    for (const e of c.extensions) if (selectedExts.has(e.ext)) extClass.set(e.ext, c.key);
    if (folderNamesOn) for (const fn of c.folderNames) folderClass.set(fn, c.key);
  }
  // Custom class: selected extensions not owned by any class body land under 'custom'.
  if (selectedClasses.has("custom")) {
    for (const e of selectedExts) if (!extClass.has(e)) extClass.set(e, "custom");
  }

  const skipDir = (name: string): boolean =>
    isExcludedDir(name) || (!includeHidden && isHiddenName(name));

  const emit = (status: string, current: string | null, walked: number, total: number | null, found: number, force = false): void =>
    throttled(onProgress, { kind: "discover", jobId: job.id, status, currentPath: current, foldersWalked: walked, foldersTotal: total, filesFound: found }, force);

  // -- exact pre-count (countRun pattern — listing only, no stat, no inserts) --
  db.prepare("UPDATE migrate_jobs SET status = 'counting', started_at = COALESCE(started_at, CURRENT_TIMESTAMP) WHERE id = ?").run(job.id);
  emit("counting", null, 0, null, 0, true);
  let foldersTotal = 0;
  {
    const stack = [...roots];
    let sinceYield = 0;
    while (stack.length > 0) {
      if (aborting.has(job.id)) break;
      const dir = stack.pop()!;
      const listing = listSorted(dir);
      if (!listing) continue;
      foldersTotal++;
      if (followSub) for (const d of listing.dirs) if (!skipDir(d)) stack.push(path.join(dir, d));
      if (++sinceYield >= MIGRATE_COMMIT_BATCH_YIELD) {
        sinceYield = 0;
        emit("counting", dir, foldersTotal, null, 0);
        await tick();
      }
    }
  }
  db.prepare("UPDATE migrate_jobs SET total_folders_expected = ? WHERE id = ?").run(foldersTotal, job.id);

  // -- the walk — deterministic DFS; ONE transaction per folder (items + counters + cursor) --
  db.prepare("UPDATE migrate_jobs SET status = 'running' WHERE id = ?").run(job.id);
  const resumeCursor = job.resume_cursor; // set on a crashed run being re-queued
  let passedCursor = resumeCursor == null;

  const insItem = db.prepare(
    `INSERT INTO migrate_items (uuid, org_id, job_id, asset_class, extension, source_path, filename,
       size_bytes, mtime, selected, is_shipped_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const commitFolder = db.transaction(
    (dir: string, rows: Array<[string, string | null, string, string, number | null, string | null, number, number]>, seen: number, errs: number) => {
      for (const r of rows) insItem.run(generateUUIDv7(), orgId, job.id, ...r);
      db.prepare(
        `UPDATE migrate_jobs SET folders_walked = folders_walked + 1, files_seen = files_seen + ?,
           files_found = files_found + ?, errors_logged = errors_logged + ?, resume_cursor = ?,
           updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).run(seen, rows.length, errs, dir, job.id);
    }
  );

  let walked = 0, found = 0, aborted = false;
  const walk = async (dir: string, dirClass: string | null): Promise<void> => {
    if (aborting.has(job.id)) { aborted = true; return; }
    const listing = listSorted(dir);
    let errs = 0;
    if (!listing) {
      errs = 1;
      db.prepare("UPDATE migrate_jobs SET errors_logged = errors_logged + 1 WHERE id = ?").run(job.id);
      return;
    }
    // Resume: skip folders at-or-before the committed cursor in the SAME deterministic order.
    const shouldCommit = passedCursor || dir > (resumeCursor ?? "");
    if (!passedCursor && dir === resumeCursor) passedCursor = true;

    if (shouldCommit) {
      const rows: Array<[string, string | null, string, string, number | null, string | null, number, number]> = [];
      for (const name of listing.files) {
        if (!includeHidden && isHiddenName(name)) continue;
        const ext = path.extname(name).slice(1).toLowerCase() || null;
        const cls = (ext && extClass.get(ext)) ?? dirClass; // folder-name context catches non-listed exts
        if (!cls) continue;
        const full = path.join(dir, name);
        let size: number | null = null, mtime: string | null = null;
        try {
          const st = fs.statSync(full);
          size = st.size;
          mtime = st.mtime.toISOString();
        } catch {
          errs++;
          continue; // unreadable file — logged via counter, run continues
        }
        const shipped = SHIPPED_RE.test(full) ? 1 : 0;
        rows.push([cls, ext, full, name, size, mtime, shipped ? 0 : 1, shipped]);
      }
      commitFolder(dir, rows, listing.files.length, errs);
      walked++;
      found += rows.length;
      emit("running", dir, walked, foldersTotal, found);
      await tick();
    }

    if (followSub) {
      for (const d of listing.dirs) {
        if (skipDir(d)) continue;
        const childClass = folderClass.get(d.toLowerCase()) ?? dirClass;
        await walk(path.join(dir, d), childClass);
        if (aborted) return;
      }
    }
  };

  for (const root of roots) {
    await walk(root, folderClass.get(path.basename(root).toLowerCase()) ?? null);
    if (aborted) break;
  }

  const finalStatus = aborted ? "aborted" : "completed";
  db.prepare("UPDATE migrate_jobs SET status = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?").run(finalStatus, job.id);
  aborting.delete(job.id);
  const j = getJob(db, job.id);
  throttled(onProgress, {
    kind: "discover", jobId: job.id, status: finalStatus, currentPath: null,
    foldersWalked: j?.folders_walked ?? walked, foldersTotal, filesFound: j?.files_found ?? found,
  }, true);
}

// ---- queries ----------------------------------------------------------------------------------
export function getJob(db: Db, id: number): MigrateJobRow | null {
  return (db.prepare("SELECT * FROM migrate_jobs WHERE id = ?").get(id) as MigrateJobRow | undefined) ?? null;
}
export function listJobs(db: Db, orgId: string, limit = 50): MigrateJobRow[] {
  return db.prepare("SELECT * FROM migrate_jobs WHERE org_id = ? ORDER BY id DESC LIMIT ?").all(orgId, limit) as MigrateJobRow[];
}
export interface JobGroupSummary {
  extension: string | null;
  count: number;
  bytes: number;
  selected: number;
}
export function jobSummary(db: Db, jobId: number): { groups: JobGroupSummary[]; total: number; bytes: number; selected: number; selectedBytes: number } {
  const groups = db
    .prepare(
      `SELECT extension, COUNT(*) AS count, COALESCE(SUM(size_bytes),0) AS bytes,
              SUM(selected) AS selected FROM migrate_items WHERE job_id = ? GROUP BY extension ORDER BY count DESC`
    )
    .all(jobId) as JobGroupSummary[];
  const t = db
    .prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(size_bytes),0) AS bytes,
              COALESCE(SUM(CASE WHEN selected = 1 THEN 1 ELSE 0 END),0) AS selected,
              COALESCE(SUM(CASE WHEN selected = 1 THEN size_bytes ELSE 0 END),0) AS selectedBytes
       FROM migrate_items WHERE job_id = ?`
    )
    .get(jobId) as { total: number; bytes: number; selected: number; selectedBytes: number };
  return { groups, ...t };
}
export function jobItems(db: Db, jobId: number, extension: string | null, limit = 500): MigrateItemRow[] {
  return extension === null
    ? (db.prepare("SELECT * FROM migrate_items WHERE job_id = ? ORDER BY filename LIMIT ?").all(jobId, limit) as MigrateItemRow[])
    : (db.prepare("SELECT * FROM migrate_items WHERE job_id = ? AND extension = ? ORDER BY filename LIMIT ?").all(jobId, extension, limit) as MigrateItemRow[]);
}
export function setItemsSelected(db: Db, jobId: number, ids: number[], selected: boolean): void {
  const upd = db.prepare("UPDATE migrate_items SET selected = ?, updated_at = CURRENT_TIMESTAMP WHERE job_id = ? AND id = ?");
  const tx = db.transaction(() => {
    for (const id of ids) upd.run(selected ? 1 : 0, jobId, id);
  });
  tx();
}
export function setScopeSelected(db: Db, jobId: number, extension: string | null, selected: boolean): void {
  if (extension === null) db.prepare("UPDATE migrate_items SET selected = ? WHERE job_id = ?").run(selected ? 1 : 0, jobId);
  else db.prepare("UPDATE migrate_items SET selected = ? WHERE job_id = ? AND extension = ?").run(selected ? 1 : 0, jobId, extension);
}
export function listBundles(db: Db, jobId: number): MigrateBundleRow[] {
  return db.prepare("SELECT * FROM migrate_bundles WHERE job_id = ? ORDER BY id DESC").all(jobId) as MigrateBundleRow[];
}

// ---- bundle export (Phase 1.5) ----------------------------------------------------------------
const sanitizeLabel = (s: string): string => s.replace(/[^A-Za-z0-9._ -]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "bundle";
const mmddyyyy = (d: Date): string =>
  `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}-${d.getFullYear()}`;

export interface PreflightResult {
  ok: boolean;
  neededBytes: number;
  freeBytes: number | null;
  bundleDir: string;
  error?: string;
}

/** THE TWO REQUIRED GUARDS (recon F17): destination free space + destination-inside-source. */
export function bundlePreflight(db: Db, jobId: number, destRoot: string): PreflightResult {
  const job = getJob(db, jobId);
  if (!job) return { ok: false, neededBytes: 0, freeBytes: null, bundleDir: "", error: "job not found" };
  const { selectedBytes } = jobSummary(db, jobId);
  const label = sanitizeLabel(job.label ?? `job-${jobId}`);
  const bundleDir = path.join(path.resolve(destRoot), "FocalRegistry", "Bundles", `${label}-${mmddyyyy(new Date())}`);

  // GUARD 2 — destination inside a source tree → self-recursion on a same-drive bundle. Refuse.
  const roots = (JSON.parse(job.root_paths) as string[]).map((r) => path.resolve(r).toLowerCase() + path.sep);
  const destLower = bundleDir.toLowerCase() + path.sep;
  for (const r of roots) {
    if (destLower.startsWith(r)) {
      return {
        ok: false, neededBytes: selectedBytes, freeBytes: null, bundleDir,
        error: `The destination sits inside a folder being copied from (${r}). Choose a destination outside every source.`,
      };
    }
  }

  // GUARD 1 — free space on the destination volume, with a 2% + 64 MB margin for filesystem overhead.
  let freeBytes: number | null = null;
  try {
    const letter = path.parse(path.resolve(destRoot)).root.slice(0, 2).toUpperCase();
    const vol = listVolumes().find((v) => v.letter.toUpperCase() === letter);
    freeBytes = vol?.freeBytes ?? null;
  } catch {
    freeBytes = null; // enumeration hiccup — treated as unknown, not as a pass
  }
  const needed = Math.ceil(selectedBytes * 1.02) + 64 * 1024 * 1024;
  if (freeBytes === null) {
    return { ok: false, neededBytes: needed, freeBytes, bundleDir, error: "Could not read the destination drive's free space. Reconnect the drive and try again." };
  }
  if (freeBytes < needed) {
    const gb = (n: number): string => (n / 1073741824).toFixed(2);
    return {
      ok: false, neededBytes: needed, freeBytes, bundleDir,
      error: `Not enough space on the destination: ${gb(needed)} gigabytes needed (selection plus margin), ${gb(freeBytes)} free.`,
    };
  }
  return { ok: true, neededBytes: needed, freeBytes, bundleDir };
}

export async function startBundle(db: Db, orgId: string, jobId: number, destRoot: string, onProgress: OnProgress): Promise<number> {
  const pre = bundlePreflight(db, jobId, destRoot);
  if (!pre.ok) throw new Error(pre.error ?? "preflight failed");
  const job = getJob(db, jobId)!;
  const items = db
    .prepare("SELECT * FROM migrate_items WHERE job_id = ? AND selected = 1 ORDER BY asset_class, filename")
    .all(jobId) as MigrateItemRow[];
  const bytesTotal = items.reduce((a, i) => a + (i.size_bytes ?? 0), 0);

  const info = db
    .prepare(
      `INSERT INTO migrate_bundles (uuid, org_id, job_id, destination_root, status, item_count, bytes_total, started_at)
       VALUES (?, ?, ?, ?, 'running', ?, ?, CURRENT_TIMESTAMP)`
    )
    .run(generateUUIDv7(), orgId, jobId, pre.bundleDir, items.length, bytesTotal);
  const bundleId = Number(info.lastInsertRowid);

  fs.mkdirSync(pre.bundleDir, { recursive: true });

  const insRow = db.prepare(
    `INSERT INTO migrate_bundle_items (uuid, org_id, bundle_id, item_id, dest_path, bytes, sha256, verified, status, error_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const bump = db.prepare("UPDATE migrate_bundles SET items_copied = ?, items_failed = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");

  interface ManifestEntry {
    originalPath: string; assetClass: string; sizeBytes: number | null; sha256: string | null; destination: string;
  }
  const manifest: ManifestEntry[] = [];
  const usedNames = new Map<string, number>(); // per-subfolder collision suffixing (two sources, same filename)
  let copied = 0, failed = 0, bytesDone = 0;

  const emit = (status: string, current: string | null, force = false): void =>
    throttled(onProgress, {
      kind: "bundle", jobId, bundleId, status, currentPath: current,
      foldersWalked: 0, foldersTotal: null, filesFound: items.length,
      copied, failed, totalItems: items.length, bytesDone, bytesTotal,
    }, force);
  emit("running", null, true);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const sub = bundleSubfolder(item.asset_class, item.extension);
    const subDir = path.join(pre.bundleDir, sub);
    fs.mkdirSync(subDir, { recursive: true });
    // In-run name collision → suffix -2, -3… BEFORE copy (report.ts collision pattern). A pre-existing
    // file from a PRIOR run of the same bundle folder EEXCL-skips below — that is the resume path.
    let destName = item.filename;
    const key = `${sub}\\${destName.toLowerCase()}`;
    const n = usedNames.get(key) ?? 0;
    usedNames.set(key, n + 1);
    if (n > 0) {
      const ext = path.extname(destName);
      destName = `${path.basename(destName, ext)}-${n + 1}${ext}`;
    }
    const dest = path.join(subDir, destName);

    const r = copyVerified(item.source_path, dest, { hash: true, expectedBytes: item.size_bytes ?? undefined });
    if (r.ok) {
      copied++;
      bytesDone += r.bytes;
      insRow.run(generateUUIDv7(), orgId, bundleId, item.id, dest, r.bytes, r.sha256 ?? null, 1, "copied", null);
      manifest.push({ originalPath: item.source_path, assetClass: item.asset_class, sizeBytes: item.size_bytes, sha256: r.sha256 ?? null, destination: path.relative(pre.bundleDir, dest) });
    } else if (r.skipped) {
      // Resume: already present from a prior run of this bundle folder — recorded, never overwritten.
      copied++;
      bytesDone += item.size_bytes ?? 0;
      insRow.run(generateUUIDv7(), orgId, bundleId, item.id, dest, item.size_bytes, null, 0, "skipped", "already present — resumed, not overwritten");
      manifest.push({ originalPath: item.source_path, assetClass: item.asset_class, sizeBytes: item.size_bytes, sha256: null, destination: path.relative(pre.bundleDir, dest) });
    } else {
      failed++;
      insRow.run(generateUUIDv7(), orgId, bundleId, item.id, dest, r.bytes, null, 0, "error", r.error ?? "copy failed");
    }
    if ((i & 7) === 7) {
      bump.run(copied, failed, bundleId);
      emit("running", item.filename);
      await tick();
    }
  }
  bump.run(copied, failed, bundleId);

  // manifest.json — every file's origin, class, size, hash, destination. Our own bundle folder.
  fs.writeFileSync(
    path.join(pre.bundleDir, "manifest.json"),
    JSON.stringify({ bundle: path.basename(pre.bundleDir), createdAt: new Date().toISOString(), sourceRoots: JSON.parse(job.root_paths) as string[], itemCount: manifest.length, files: manifest }, null, 2),
    "utf8"
  );

  const finalStatus = failed > 0 ? (copied > 0 ? "partial" : "failed") : "completed";
  db.prepare("UPDATE migrate_bundles SET status = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?").run(finalStatus, bundleId);
  emit(finalStatus, null, true);
  return bundleId;
}
