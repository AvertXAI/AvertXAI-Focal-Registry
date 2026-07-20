// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Rename engine. Walks user-chosen SOURCE FOLDERS (B1: independent of Scan), classifies
//              via the ONE media source of truth (scan/media.ts), computes names via the ONE pure
//              preview (src/shared/renamePreview.ts), then COPIES each file to the destination under
//              its new name and VERIFIES the byte count. rename_files stores BOTH names per row — the
//              reversal record.
//
//              THE LAW — the whole product promise, enforced here:
//                • The ONLY filesystem calls that touch a SOURCE path are READS (statSync, copyFileSync
//                  reading the source). There is NO rename/unlink/rmdir/write against any source, ever.
//                • Copies use COPYFILE_EXCL — a pre-existing destination is SKIPPED, never overwritten.
//                • A verify failure is recorded and the batch CONTINUES; the source is never touched.
//                • A drive root is refused as a source (B2 guard) before any copy happens.
//              Progress + commit mirror Scan: batched row commits in a transaction, throttle in the
//              host, terminal states flushed. A crash loses the last unflushed rows, never the copies.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/rename/index.ts
//------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";
import { generateUUIDv7 } from "../utils/uuidv7";
import { isExcludedDir, mediaClass } from "../scan/media";
import { buildPreview, type RenameSettings, type RenameSourceFile } from "../../../../src/shared/renamePreview";
import type { Db } from "./db";

export const RENAME_COMMIT_BATCH = 25; // rows flushed per transaction — a crash loses at most this many revert records (never a copy)

export interface RenameProgress {
  batchId: number;
  status: string; // 'running' | 'completed' | 'aborted' | 'crashed' | 'error'
  currentFile: string | null;
  total: number;
  copied: number;
  skipped: number;
  errored: number;
  error?: string; // set when the job itself failed to start/run (e.g. a guard rejection)
}

/** A volume root (E:\, C:\, \\server\share\) — refused as a source (B2 guard). */
export function isDriveRoot(p: string): boolean {
  const r = path.resolve(p);
  return path.dirname(r) === r;
}

// --- disk walk (main-only) — recursive, deterministic, media-only via the shared media set ---
function* walkFiles(dir: string): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // unreadable dir — skip, never crash the walk
  }
  entries.sort((a, b) => a.name.localeCompare(b.name)); // deterministic order → deterministic sequences
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!isExcludedDir(e.name)) yield* walkFiles(full);
    } else if (e.isFile()) {
      yield full;
    }
  }
}

/**
 * Walk the source folders and return every MEDIA file, classified. Non-media files are ignored (never
 * copied) — the same media-only rule as Scan. Source folders are processed in the given order and each
 * is walked depth-first sorted, so the sequence is deterministic and CONTINUES across folders (3.4).
 * Pure read-only: statSync only. Used by the engine AND exposed to the renderer for the live preview.
 */
export function gatherSources(sourceRoots: string[]): RenameSourceFile[] {
  const out: RenameSourceFile[] = [];
  for (const root of sourceRoots) {
    for (const full of walkFiles(root)) {
      const ext = path.extname(full).replace(/^\./, "");
      const cls = mediaClass(ext);
      if (!cls) continue; // non-media — counted-and-skipped semantics: simply not a rename target
      let bytes = 0;
      try {
        bytes = fs.statSync(full).size;
      } catch {
        continue; // vanished between walk and stat — skip
      }
      out.push({
        path: full,
        filename: path.basename(full),
        folder: path.dirname(full),
        sourceRoot: root,
        stem: path.basename(full, path.extname(full)),
        mediaClass: cls,
        bytes,
      });
    }
  }
  return out;
}

interface CommitRow {
  source_path: string;
  source_filename: string;
  source_folder: string;
  stem: string;
  copy_path: string | null;
  copy_filename: string | null;
  media_class: string;
  sequence_number: number;
  bytes: number;
  status: "copied" | "skipped" | "error";
  error_text: string | null;
}

function insertBatch(db: Db, orgId: string, batchId: number, rows: CommitRow[]): void {
  const ins = db.prepare(
    `INSERT INTO rename_files
       (uuid, org_id, batch_id, source_path, source_filename, source_folder, stem, copy_path,
        copy_filename, media_class, sequence_number, bytes, status, error_text)
     VALUES (@uuid, @org_id, @batch_id, @source_path, @source_filename, @source_folder, @stem,
             @copy_path, @copy_filename, @media_class, @sequence_number, @bytes, @status, @error_text)`
  );
  const tx = db.transaction((batch: CommitRow[]) => {
    for (const r of batch) ins.run({ uuid: generateUUIDv7(), org_id: orgId, batch_id: batchId, ...r });
  });
  tx(rows);
}

// In-process abort flags — set by requestAbort, read in the copy loop (mirrors Scan's engine slot).
const aborting = new Set<number>();
export function requestAbort(batchId: number): boolean {
  aborting.add(batchId);
  return true;
}

/** Any batch left 'running' by a crash is marked 'crashed' at service start (mirrors Scan). */
export function markInterruptedRenames(db: Db): number {
  const info = db
    .prepare("UPDATE rename_batches SET status = 'crashed', finished_at = CURRENT_TIMESTAMP WHERE status = 'running'")
    .run();
  return info.changes;
}

export interface StartRenameOpts {
  sources: string[];
  destination: string;
  settings: RenameSettings;
  onProgress: (p: RenameProgress) => void;
}

/**
 * Create the batch row and run the copy job. ASYNC + yielding so a large batch never freezes the main
 * process and progress can stream. Returns the batchId immediately-usable id (the row is created
 * synchronously first). NEVER touches a source. Records every file — copied, skipped, or errored.
 */
export async function startRename(db: Db, orgId: string, opts: StartRenameOpts): Promise<number> {
  const { sources, destination, settings, onProgress } = opts;

  // (B2) Drive-root guard — refuse before anything is created or copied.
  for (const s of sources) {
    if (isDriveRoot(s)) throw new Error(`Refusing a drive root as a source: "${s}". Choose a folder inside the drive.`);
  }
  if (isDriveRoot(destination)) throw new Error(`Refusing a drive root as the destination: "${destination}".`);

  // Create the batch row (status running) + the source rows.
  const batchInfo = db
    .prepare(
      `INSERT INTO rename_batches
         (uuid, org_id, kind, client_name, project_name, shoot_date, custom_tag, prefix_mode,
          business_name, photographer_name, sequence_start, sequence_pad, destination_path, status, started_at)
       VALUES (?, ?, 'rename', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', CURRENT_TIMESTAMP)`
    )
    .run(
      generateUUIDv7(), orgId, settings.clientName, settings.projectName, settings.shootDate, settings.customTag,
      settings.prefixMode, settings.businessName, settings.photographerName, settings.sequenceStart,
      settings.sequencePad, destination
    );
  const batchId = Number(batchInfo.lastInsertRowid);
  const insSource = db.prepare("INSERT INTO rename_sources (uuid, org_id, batch_id, folder_path) VALUES (?, ?, ?, ?)");
  for (const s of sources) insSource.run(generateUUIDv7(), orgId, batchId, s);

  // Gather + name (the ONE pure preview drives both the UI and the real copy names).
  const files = gatherSources(sources);
  const preview = buildPreview(files, settings);
  const total = preview.length;

  fs.mkdirSync(destination, { recursive: true }); // create the destination tree (never a source)

  let copied = 0, skipped = 0, errored = 0;
  let imageCount = 0, videoCount = 0, audioCount = 0;
  const emit = (currentFile: string | null, status = "running"): void =>
    onProgress({ batchId, status, currentFile, total, copied, skipped, errored });
  emit(null);

  const pending: CommitRow[] = [];
  const flush = (): void => {
    if (pending.length === 0) return;
    insertBatch(db, orgId, batchId, pending.splice(0, pending.length));
  };

  let aborted = false;
  for (let i = 0; i < preview.length; i++) {
    if (aborting.has(batchId)) { aborted = true; break; }
    const row = preview[i];
    if (row.mediaClass === "image") imageCount++;
    else if (row.mediaClass === "video") videoCount++;
    else audioCount++;

    const dest = path.join(destination, row.copyFilename);
    const base: CommitRow = {
      source_path: row.path, source_filename: row.filename, source_folder: row.sourceRoot, stem: row.stem,
      copy_path: null, copy_filename: row.copyFilename, media_class: row.mediaClass,
      sequence_number: row.sequenceNumber, bytes: row.bytes, status: "error", error_text: null,
    };
    try {
      // COPYFILE_EXCL: fails with EEXIST if the destination already exists → SKIP, never overwrite (3.6).
      fs.copyFileSync(row.path, dest, fs.constants.COPYFILE_EXCL);
      // Verify the byte count matches — the copy must be identical in size (3.5).
      const destSize = fs.statSync(dest).size;
      if (destSize !== row.bytes) {
        errored++;
        pending.push({ ...base, status: "error", error_text: `size mismatch: source ${row.bytes}, copy ${destSize}` });
      } else {
        copied++;
        pending.push({ ...base, copy_path: dest, status: "copied" });
      }
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code === "EEXIST") {
        skipped++;
        pending.push({ ...base, status: "skipped", error_text: "destination already exists — skipped, not overwritten" });
      } else {
        errored++;
        pending.push({ ...base, status: "error", error_text: e instanceof Error ? e.message : String(e) });
      }
    }

    if (pending.length >= RENAME_COMMIT_BATCH) flush();
    if ((i & 15) === 15) {
      emit(row.copyFilename);
      await new Promise((r) => setImmediate(r)); // yield: keep the UI alive + let throttled progress flush
    }
  }
  flush(); // commit the tail

  const finalStatus = aborted ? "aborted" : errored > 0 && copied === 0 ? "error" : "completed";
  db.prepare(
    `UPDATE rename_batches SET status = ?, finished_at = CURRENT_TIMESTAMP, image_count = ?, video_count = ?,
       audio_count = ?, files_copied = ?, files_skipped = ?, files_errored = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(finalStatus, imageCount, videoCount, audioCount, copied, skipped, errored, batchId);
  aborting.delete(batchId);
  onProgress({ batchId, status: finalStatus, currentFile: null, total, copied, skipped, errored });
  return batchId;
}

// --- queries (History / Revert / Presets consumers) ---
export interface RenameBatchRow {
  id: number;
  kind: string;
  reverted_from_batch_id: number | null;
  client_name: string | null;
  project_name: string | null;
  shoot_date: string | null;
  custom_tag: string | null;
  prefix_mode: string;
  business_name: string | null;
  photographer_name: string | null;
  sequence_start: number;
  sequence_pad: number;
  destination_path: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  image_count: number;
  video_count: number;
  audio_count: number;
  files_copied: number;
  files_skipped: number;
  files_errored: number;
  created_at: string;
}

export function getBatch(db: Db, orgId: string, id: number): RenameBatchRow | null {
  return (db.prepare("SELECT * FROM rename_batches WHERE org_id = ? AND id = ?").get(orgId, id) as RenameBatchRow | undefined) ?? null;
}
export function listBatches(db: Db, orgId: string, limit = 50): RenameBatchRow[] {
  return db.prepare("SELECT * FROM rename_batches WHERE org_id = ? ORDER BY id DESC LIMIT ?").all(orgId, limit) as RenameBatchRow[];
}

export interface RevertRow {
  copy_filename: string;
  source_filename: string;
  source_path: string;
  bytes: number;
}
/** The reverse mapping for a batch's successfully-copied files: copy name → original name (4.1). */
export function revertMapping(db: Db, orgId: string, batchId: number): RevertRow[] {
  return db
    .prepare(
      `SELECT copy_filename, source_filename, source_path, bytes FROM rename_files
       WHERE org_id = ? AND batch_id = ? AND status = 'copied' AND copy_filename IS NOT NULL
       ORDER BY sequence_number, source_filename`
    )
    .all(orgId, batchId) as RevertRow[];
}
/** A bounded sample of a batch's rows for the History card (spec 5.4). */
export function batchSample(db: Db, orgId: string, batchId: number, limit = 6): { source_filename: string; copy_filename: string | null; status: string }[] {
  return db
    .prepare(
      "SELECT source_filename, copy_filename, status FROM rename_files WHERE org_id = ? AND batch_id = ? ORDER BY sequence_number LIMIT ?"
    )
    .all(orgId, batchId, limit) as { source_filename: string; copy_filename: string | null; status: string }[];
}

// --- presets (spec 2.4 / 5.5) — named saved settings + one "(last used)" row rewritten every run ---
const LAST_USED_NAME = "(last used)";
export interface RenamePresetRow {
  id: number;
  name: string;
  is_last_used: number;
  prefix_mode: string | null;
  business_name: string | null;
  photographer_name: string | null;
  sequence_start: number | null;
  sequence_pad: number | null;
  client_name: string | null;
  project_name: string | null;
  custom_tag: string | null;
}
export function listPresets(db: Db, orgId: string): RenamePresetRow[] {
  return db.prepare("SELECT * FROM rename_presets WHERE org_id = ? ORDER BY is_last_used DESC, name COLLATE NOCASE").all(orgId) as RenamePresetRow[];
}
export function lastUsedPreset(db: Db, orgId: string): RenamePresetRow | null {
  return (db.prepare("SELECT * FROM rename_presets WHERE org_id = ? AND is_last_used = 1").get(orgId) as RenamePresetRow | undefined) ?? null;
}
const presetCols = (s: RenameSettings): unknown[] => [
  s.prefixMode, s.businessName, s.photographerName, s.sequenceStart, s.sequencePad, s.clientName, s.projectName, s.customTag,
];
/** Rewrite the single "(last used)" row on every run (restored on module open). */
export function saveLastUsed(db: Db, orgId: string, s: RenameSettings): void {
  const existing = db.prepare("SELECT id FROM rename_presets WHERE org_id = ? AND name = ?").get(orgId, LAST_USED_NAME) as { id: number } | undefined;
  db.prepare("UPDATE rename_presets SET is_last_used = 0 WHERE org_id = ? AND is_last_used = 1").run(orgId);
  if (existing) {
    db.prepare(
      `UPDATE rename_presets SET is_last_used = 1, prefix_mode = ?, business_name = ?, photographer_name = ?,
         sequence_start = ?, sequence_pad = ?, client_name = ?, project_name = ?, custom_tag = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(...presetCols(s), existing.id);
  } else {
    db.prepare(
      `INSERT INTO rename_presets (uuid, org_id, name, is_last_used, prefix_mode, business_name, photographer_name,
         sequence_start, sequence_pad, client_name, project_name, custom_tag)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(generateUUIDv7(), orgId, LAST_USED_NAME, ...presetCols(s));
  }
}
/** Save a NAMED preset (replaces one of the same name). */
export function savePreset(db: Db, orgId: string, name: string, s: RenameSettings): void {
  const clean = name.trim();
  if (!clean || clean === LAST_USED_NAME) return;
  const existing = db.prepare("SELECT id FROM rename_presets WHERE org_id = ? AND name = ?").get(orgId, clean) as { id: number } | undefined;
  if (existing) {
    db.prepare(
      `UPDATE rename_presets SET prefix_mode = ?, business_name = ?, photographer_name = ?, sequence_start = ?,
         sequence_pad = ?, client_name = ?, project_name = ?, custom_tag = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(...presetCols(s), existing.id);
  } else {
    db.prepare(
      `INSERT INTO rename_presets (uuid, org_id, name, is_last_used, prefix_mode, business_name, photographer_name,
         sequence_start, sequence_pad, client_name, project_name, custom_tag)
       VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(generateUUIDv7(), orgId, clean, ...presetCols(s));
  }
}
export function deletePreset(db: Db, orgId: string, id: number): void {
  db.prepare("DELETE FROM rename_presets WHERE org_id = ? AND id = ? AND name <> ?").run(orgId, id, LAST_USED_NAME);
}

// --- Phase 4: REVERT ENGINE ---
// Given a batch and the folder holding its copies, restore each copy to a user-chosen destination
// UNDER ITS ORIGINAL NAME. This makes a THIRD set of files: nothing is renamed in place, nothing is
// deleted, nothing is overwritten (COPYFILE_EXCL). The revert is itself logged as a batch row (4.4).
export interface StartRevertOpts {
  batchId: number;
  copiesFolder: string; // where the batch's copies currently live (read-only source of the revert)
  destination: string; // where restored originals are written (a new, third location)
  onProgress: (p: RenameProgress) => void;
}
export interface RevertResult {
  revertBatchId: number;
  restored: number;
  skipped: number;
  missing: number; // in the log but not on disk (4.3) — reported, not fatal
  extraOnDisk: number; // on disk but not in the log (4.3) — left alone, reported
}

export async function startRevert(db: Db, orgId: string, opts: StartRevertOpts): Promise<RevertResult> {
  const { batchId, copiesFolder, destination, onProgress } = opts;
  if (isDriveRoot(destination)) throw new Error(`Refusing a drive root as the revert destination: "${destination}".`);

  const mapping = revertMapping(db, orgId, batchId);
  const loggedNames = new Set(mapping.map((m) => m.copy_filename.toLowerCase()));

  // (4.3) files on disk not in the log — leave alone, count for the report.
  let extraOnDisk = 0;
  try {
    for (const name of fs.readdirSync(copiesFolder)) {
      const full = path.join(copiesFolder, name);
      try {
        if (fs.statSync(full).isFile() && !loggedNames.has(name.toLowerCase())) extraOnDisk++;
      } catch {
        /* vanished — ignore */
      }
    }
  } catch {
    /* copiesFolder unreadable — the mapping loop reports each entry as missing */
  }

  const original = getBatch(db, orgId, batchId);
  const info = db
    .prepare(
      `INSERT INTO rename_batches (uuid, org_id, kind, reverted_from_batch_id, client_name, project_name,
         prefix_mode, sequence_start, sequence_pad, destination_path, status, started_at)
       VALUES (?, ?, 'revert', ?, ?, ?, 'photo', 1, 3, ?, 'running', CURRENT_TIMESTAMP)`
    )
    .run(generateUUIDv7(), orgId, batchId, original?.client_name ?? null, original?.project_name ?? null, destination);
  const revertBatchId = Number(info.lastInsertRowid);
  db.prepare("INSERT INTO rename_sources (uuid, org_id, batch_id, folder_path) VALUES (?, ?, ?, ?)").run(
    generateUUIDv7(), orgId, revertBatchId, copiesFolder
  );

  fs.mkdirSync(destination, { recursive: true });

  const total = mapping.length;
  let restored = 0, skipped = 0, missing = 0;
  const emit = (currentFile: string | null, status = "running"): void =>
    onProgress({ batchId: revertBatchId, status, currentFile, total, copied: restored, skipped, errored: missing });
  emit(null);

  const pending: CommitRow[] = [];
  const flush = (): void => {
    if (pending.length) insertBatch(db, orgId, revertBatchId, pending.splice(0, pending.length));
  };

  for (let i = 0; i < mapping.length; i++) {
    const m = mapping[i];
    const src = path.join(copiesFolder, m.copy_filename); // the copy we revert FROM (read-only)
    const dest = path.join(destination, m.source_filename); // restore under the ORIGINAL name
    const base: CommitRow = {
      source_path: src, source_filename: m.copy_filename, source_folder: copiesFolder, stem: "",
      copy_path: null, copy_filename: m.source_filename, media_class: "", sequence_number: 0, bytes: m.bytes,
      status: "error", error_text: null,
    };
    if (!fs.existsSync(src)) {
      missing++;
      pending.push({ ...base, status: "error", error_text: "copy missing on disk — not reverted" });
    } else {
      try {
        fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
        restored++;
        pending.push({ ...base, copy_path: dest, status: "copied" });
      } catch (e) {
        const code = (e as NodeJS.ErrnoException)?.code;
        if (code === "EEXIST") {
          skipped++;
          pending.push({ ...base, status: "skipped", error_text: "destination already exists — skipped, not overwritten" });
        } else {
          missing++;
          pending.push({ ...base, status: "error", error_text: e instanceof Error ? e.message : String(e) });
        }
      }
    }
    if (pending.length >= RENAME_COMMIT_BATCH) flush();
    if ((i & 15) === 15) {
      emit(m.source_filename);
      await new Promise((r) => setImmediate(r));
    }
  }
  flush();

  db.prepare(
    `UPDATE rename_batches SET status = 'completed', finished_at = CURRENT_TIMESTAMP, files_copied = ?,
       files_skipped = ?, files_errored = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(restored, skipped, missing, revertBatchId);
  onProgress({ batchId: revertBatchId, status: "completed", currentFile: null, total, copied: restored, skipped, errored: missing });
  return { revertBatchId, restored, skipped, missing, extraOnDisk };
}
