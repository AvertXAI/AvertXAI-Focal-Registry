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
    "file_count INTEGER DEFAULT 0",
    "image_count INTEGER DEFAULT 0",
    "video_count INTEGER DEFAULT 0",
    "audio_count INTEGER DEFAULT 0",
    "other_count INTEGER DEFAULT 0",
    "unreadable_count INTEGER DEFAULT 0",
    "total_bytes INTEGER DEFAULT 0",
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
  ]);
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
