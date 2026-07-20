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
