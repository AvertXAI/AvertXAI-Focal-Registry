// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Rename module schema — lives in the SHARED org database (same file as Scan). Rename
//              walks user-chosen SOURCE FOLDERS directly and COPIES to a destination (B1 ruling:
//              independent of Scan, no scan_files SELECT). rename_files is THE REVERSAL RECORD: both
//              the source and the copy filename are stored for EVERY file, so a batch is reversible
//              even after the originals are gone. Everything is additive: createTable() (standard
//              id/uuid/created_at/updated_at) + CREATE INDEX IF NOT EXISTS + guarded PRAGMA/ALTER —
//              the exact pattern in scan/db.ts. THE LAW: this module never modifies/moves/deletes an
//              original; it only ever writes NEW copies. Nothing here writes to a source path.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/rename/db.ts
//------------------------------------------------------------
import type Database from "better-sqlite3-multiple-ciphers";
import { createTable } from "../db";

export type Db = Database.Database;

// Idempotent, additive, safe to re-run on every boot (mirrors ensureScanSchema).
export function ensureRenameSchema(db: Db): void {
  // One row per batch. A batch is a set of source folders + settings → a run of copies into one
  // destination. `kind` distinguishes a normal rename from a revert (Phase 4.4 logs the revert as its
  // own batch row so History shows it happened). Client/project/shoot_date/custom_tag are METADATA
  // (A1 ruling) — stored here, NEVER in the filename.
  createTable(db, "rename_batches", [
    "org_id TEXT NOT NULL",
    "kind TEXT NOT NULL DEFAULT 'rename'", // 'rename' | 'revert'
    "reverted_from_batch_id INTEGER", // set on a revert row → the batch it reversed
    "client_name TEXT",
    "project_name TEXT",
    "shoot_date TEXT", // metadata only (dateOnly/fileStamp when surfaced) — not in the filename
    "custom_tag TEXT",
    "prefix_mode TEXT NOT NULL DEFAULT 'photo'", // 'photo' | 'biz' | 'both'
    "business_name TEXT",
    "photographer_name TEXT",
    "sequence_start INTEGER NOT NULL DEFAULT 1",
    "sequence_pad INTEGER NOT NULL DEFAULT 3",
    "destination_path TEXT NOT NULL",
    "status TEXT NOT NULL", // 'running' | 'completed' | 'aborted' | 'crashed' | 'error'
    "started_at DATETIME",
    "finished_at DATETIME",
    "image_count INTEGER DEFAULT 0",
    "video_count INTEGER DEFAULT 0",
    "audio_count INTEGER DEFAULT 0",
    "files_copied INTEGER DEFAULT 0",
    "files_skipped INTEGER DEFAULT 0",
    "files_errored INTEGER DEFAULT 0",
  ]);

  // A batch has MANY source folders (B2 ruling). The drive-root guard is enforced in the ENGINE
  // before a folder is ever accepted — never a volume root like E:\.
  createTable(db, "rename_sources", [
    "org_id TEXT NOT NULL",
    "batch_id INTEGER NOT NULL",
    "folder_path TEXT NOT NULL",
  ]);

  // THE REVERSAL RECORD — the most important table in this module. Both filenames stored for EVERY
  // file. `stem` is the pairing key: files sharing PARENT FOLDER + STEM are one unit and share ONE
  // sequence_number (A2 ruling — RAW+JPEG pairs). media_class routes the per-class counter.
  createTable(db, "rename_files", [
    "org_id TEXT NOT NULL",
    "batch_id INTEGER NOT NULL",
    "source_path TEXT NOT NULL", // full path of the ORIGINAL (read-only; never written to)
    "source_filename TEXT NOT NULL",
    "source_folder TEXT", // the source root this file came from (for reporting)
    "stem TEXT", // filename without extension — the pairing key within a parent folder
    "copy_path TEXT", // full path of the written copy (NULL if skipped/errored before write)
    "copy_filename TEXT", // the new name — revert looks up by this
    "media_class TEXT", // 'image' | 'video' | 'audio' (from media.ts mediaClass)
    "sequence_number INTEGER",
    "bytes INTEGER",
    "status TEXT NOT NULL", // 'copied' | 'skipped' | 'error'
    "error_text TEXT",
  ]);

  // Named saved settings + exactly one row flagged is_last_used=1, rewritten on every run and restored
  // on module open (spec 2.4). Kept in the DB (not localStorage) — canon-compliant persistence.
  createTable(db, "rename_presets", [
    "org_id TEXT NOT NULL",
    "name TEXT NOT NULL",
    "is_last_used INTEGER NOT NULL DEFAULT 0",
    "prefix_mode TEXT",
    "business_name TEXT",
    "photographer_name TEXT",
    "sequence_start INTEGER",
    "sequence_pad INTEGER",
    "client_name TEXT",
    "project_name TEXT",
    "custom_tag TEXT",
  ]);

  // (2.5) Revert looks up by the copied name; History/preview list by batch.
  db.exec("CREATE INDEX IF NOT EXISTS idx_rename_files_batch ON rename_files (batch_id);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_rename_files_copyname ON rename_files (copy_filename);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_rename_sources_batch ON rename_sources (batch_id);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_rename_batches_org ON rename_batches (org_id, id);");
}
