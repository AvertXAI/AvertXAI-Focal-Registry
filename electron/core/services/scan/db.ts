// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Scan module schema — lives in the SHARED org database (deliberate decision: Rename's
//              cross-module lookup becomes a plain SELECT; no second connection lifecycle). All
//              metadata columns exist from day one and stay NULL until the metadata phase, so that
//              phase ships with zero migrations. checksum stays NULL in v1 by design.
//              Everything here is additive: CREATE TABLE IF NOT EXISTS via the shared createTable()
//              (standard id/uuid/created_at/updated_at columns) + CREATE INDEX IF NOT EXISTS.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/scan/db.ts
//------------------------------------------------------------
import type Database from "better-sqlite3-multiple-ciphers";
import { createTable } from "../db";

export type Db = Database.Database;

// Idempotent, additive, safe to re-run on every boot (mirrors the modules-table migration pattern).
export function ensureScanSchema(db: Db): void {
  // Drive identity — volume_serial is the key, never the drive letter (letters reassign).
  createTable(db, "scan_drives", [
    "org_id TEXT NOT NULL",
    "volume_serial TEXT NOT NULL",
    "volume_label TEXT",
    "filesystem TEXT",
    "total_bytes INTEGER",
    "free_bytes INTEGER",
    "first_seen_at DATETIME",
    "last_seen_at DATETIME",
    "last_scanned_at DATETIME",
  ]);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_scan_drives_identity ON scan_drives (org_id, volume_serial);");

  // One row per scan attempt. status: probing/estimating/running/paused/completed/aborted/crashed.
  // resume_cursor = path of the LAST fully committed folder (updated inside that folder's tx).
  createTable(db, "scan_runs", [
    "org_id TEXT NOT NULL",
    "drive_id INTEGER",
    "root_path TEXT NOT NULL",
    "status TEXT NOT NULL",
    "scan_unit TEXT NOT NULL", // 'drive' | 'folder' — both first-class
    "started_at DATETIME",
    "finished_at DATETIME",
    "probe_folders_sampled INTEGER",
    "probe_files_found INTEGER",
    "estimated_files INTEGER", // rough guide only — label it as such wherever it surfaces
    "estimated_seconds REAL", // stored beside the real duration (started/finished) for calibration
    "folders_committed INTEGER DEFAULT 0",
    "files_recorded INTEGER DEFAULT 0",
    "errors_logged INTEGER DEFAULT 0",
    "resume_cursor TEXT",
    "report_path TEXT",
    "total_files_expected INTEGER", // EXACT denominator from the pre-scan counting walk (Phase 4)
    "total_folders_expected INTEGER",
  ]);

  // Per-folder rollup, written in the SAME transaction as the folder's scan_files rows.
  // date_min/date_max/top_camera/top_lens stay NULL until the metadata phase.
  createTable(db, "scan_folders", [
    "org_id TEXT NOT NULL",
    "run_id INTEGER NOT NULL",
    "drive_id INTEGER",
    "path TEXT NOT NULL",
    "depth INTEGER",
    "parent_path TEXT",
    "file_count INTEGER DEFAULT 0", // = media_files (rows written) — kept for existing consumers
    "image_count INTEGER DEFAULT 0",
    "video_count INTEGER DEFAULT 0",
    "audio_count INTEGER DEFAULT 0",
    "other_count INTEGER DEFAULT 0",
    "unreadable_count INTEGER DEFAULT 0",
    "total_bytes INTEGER DEFAULT 0",
    "total_files INTEGER DEFAULT 0", // everything seen in the folder (media + non-media)
    "media_files INTEGER DEFAULT 0", // rows written (media only) — Phase 3 media-only behaviour
    "date_min TEXT",
    "date_max TEXT",
    "top_camera TEXT",
    "top_lens TEXT",
    "committed_at DATETIME",
  ]);
  db.exec("CREATE INDEX IF NOT EXISTS idx_scan_folders_run_path ON scan_folders (run_id, path);");

  // One row per file. This phase fills path/filename/extension/size_bytes/kind only; every
  // metadata column (captured_at .. checksum) is created NOW and left NULL — phase 5 adds no
  // migration. checksum stays NULL in v1.
  createTable(db, "scan_files", [
    "org_id TEXT NOT NULL",
    "run_id INTEGER NOT NULL",
    "folder_id INTEGER NOT NULL",
    "path TEXT NOT NULL",
    "filename TEXT NOT NULL",
    "extension TEXT",
    "size_bytes INTEGER",
    "kind TEXT", // 'image' | 'video' | 'audio' | 'sidecar' | 'other' | 'unreadable'
    "captured_at TEXT",
    "captured_at_source TEXT", // 'exif' | 'file'
    "camera_make TEXT",
    "camera_model TEXT",
    "lens TEXT",
    "width INTEGER",
    "height INTEGER",
    "original_filename TEXT",
    "video_codec TEXT",
    "audio_codec TEXT",
    "bitrate INTEGER",
    "duration_seconds REAL",
    "description TEXT",
    "metadata_date TEXT",
    "checksum TEXT",
    "display_width INTEGER",
    "display_height INTEGER",
    "rotation INTEGER",
    "bitrate_source TEXT", // 'btrt' | 'esds' | 'computed' — a computed bitrate is not a declared one
  ]);
  // Additive guarded columns for databases created before the isobmff geometry engine —
  // PRAGMA table_info before every ALTER, safe to re-run, never drop/recreate (the
  // modules.nav_group pattern). Fresh databases get them from createTable above; the guard
  // sees them present and does nothing.
  {
    const fileCols = (db.pragma("table_info(scan_files)") as { name: string }[]).map((c) => c.name);
    if (!fileCols.includes("display_width")) db.exec("ALTER TABLE scan_files ADD COLUMN display_width INTEGER;");
    if (!fileCols.includes("display_height")) db.exec("ALTER TABLE scan_files ADD COLUMN display_height INTEGER;");
    if (!fileCols.includes("rotation")) db.exec("ALTER TABLE scan_files ADD COLUMN rotation INTEGER;");
    if (!fileCols.includes("bitrate_source")) db.exec("ALTER TABLE scan_files ADD COLUMN bitrate_source TEXT;");
    // Phase 3/4 additive columns — media-only counts + exact denominators.
    const folderCols = (db.pragma("table_info(scan_folders)") as { name: string }[]).map((c) => c.name);
    if (!folderCols.includes("total_files")) db.exec("ALTER TABLE scan_folders ADD COLUMN total_files INTEGER DEFAULT 0;");
    if (!folderCols.includes("media_files")) db.exec("ALTER TABLE scan_folders ADD COLUMN media_files INTEGER DEFAULT 0;");
    const runCols = (db.pragma("table_info(scan_runs)") as { name: string }[]).map((c) => c.name);
    if (!runCols.includes("total_files_expected")) db.exec("ALTER TABLE scan_runs ADD COLUMN total_files_expected INTEGER;");
    if (!runCols.includes("total_folders_expected")) db.exec("ALTER TABLE scan_runs ADD COLUMN total_folders_expected INTEGER;");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_scan_files_run_folder ON scan_files (run_id, folder_id);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_scan_files_org_path ON scan_files (org_id, path);");

  // Append-only event log for the run — failures AND rule-skips (error_text prefix 'skipped:'),
  // because a skip must be logged, never silent.
  createTable(db, "scan_errors", [
    "org_id TEXT NOT NULL",
    "run_id INTEGER NOT NULL",
    "path TEXT",
    "extension TEXT",
    "stage TEXT", // 'stat' | 'exif' | 'media' | 'write' ('ffprobe' only in rows written before the 2026-07-19 GPLv3 rejection)
    "error_text TEXT",
    "occurred_at DATETIME",
  ]);
}
