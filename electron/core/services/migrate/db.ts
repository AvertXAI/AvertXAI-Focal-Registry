// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Migrate module schema — lives in the SHARED org database like Scan and Rename (one
//              connection, cross-module SELECTs stay plain). Drive identity is a FK into Scan's
//              scan_drives rows — NEVER a duplicate serial table. Everything additive: the shared
//              createTable() (std id/uuid/created_at/updated_at) + CREATE INDEX IF NOT EXISTS; any
//              future column follows the PRAGMA table_info guard pattern (scan/db.ts precedent).
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/migrate/db.ts
//------------------------------------------------------------
import type Database from "better-sqlite3-multiple-ciphers";
import { createTable } from "../db";

export type Db = Database.Database;

// Idempotent, additive, safe to re-run on every boot.
export function ensureMigrateSchema(db: Db): void {
  // One row per scan-tab job. target_kind 'drive' → drive_id points at scan_drives (identity by
  // volume serial, Scan's registry); 'folders' → root_paths JSON carries the chosen folders.
  // classes/extensions JSON = the user's SELECTED subset at enqueue time — nothing hardcoded at scan time.
  createTable(db, "migrate_jobs", [
    "org_id TEXT NOT NULL",
    "label TEXT", // tab label: "<class> — <drive label>"
    "target_kind TEXT NOT NULL", // 'drive' | 'folders'
    "drive_id INTEGER", // FK → scan_drives.id (Scan's volume-serial identity; never duplicated here)
    "root_paths TEXT NOT NULL", // JSON string[] — the drive root or the chosen folders
    "classes TEXT NOT NULL", // JSON string[] — selected asset-class keys
    "extensions TEXT NOT NULL", // JSON string[] — selected extensions (lowercase, no dot)
    "opt_folder_names INTEGER DEFAULT 1", // match class folder names as well as file extensions
    "opt_subfolders INTEGER DEFAULT 1", // follow subfolders
    "opt_hidden INTEGER DEFAULT 0", // include hidden/system folders
    "status TEXT NOT NULL", // 'queued' | 'running' | 'completed' | 'failed' | 'aborted' | 'crashed'
    "folders_walked INTEGER DEFAULT 0",
    "files_seen INTEGER DEFAULT 0",
    "files_found INTEGER DEFAULT 0",
    "errors_logged INTEGER DEFAULT 0",
    "total_folders_expected INTEGER", // exact denominator from the pre-count walk (countRun pattern)
    "resume_cursor TEXT", // last fully committed folder (updated inside that folder's tx)
    "started_at DATETIME",
    "finished_at DATETIME",
  ]);
  db.exec("CREATE INDEX IF NOT EXISTS idx_migrate_jobs_org ON migrate_jobs (org_id, id);");

  // One row per found file. selected defaults 1 EXCEPT shipped-with-Adobe files (found, unticked).
  createTable(db, "migrate_items", [
    "org_id TEXT NOT NULL",
    "job_id INTEGER NOT NULL",
    "asset_class TEXT NOT NULL", // registry class key
    "extension TEXT",
    "source_path TEXT NOT NULL",
    "filename TEXT NOT NULL",
    "size_bytes INTEGER",
    "mtime TEXT",
    "selected INTEGER DEFAULT 1",
    "is_shipped_default INTEGER DEFAULT 0", // under a Program Files Adobe install — new machine has it
  ]);
  db.exec("CREATE INDEX IF NOT EXISTS idx_migrate_items_job ON migrate_items (job_id);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_migrate_items_job_class ON migrate_items (job_id, asset_class);");

  // One row per export run. status 'partial' = completed with per-item failures recorded.
  createTable(db, "migrate_bundles", [
    "org_id TEXT NOT NULL",
    "job_id INTEGER NOT NULL",
    "destination_root TEXT NOT NULL", // <dest>\FocalRegistry\Bundles\<label>-MM-DD-YYYY\
    "status TEXT NOT NULL", // 'running' | 'completed' | 'partial' | 'failed' | 'crashed'
    "item_count INTEGER DEFAULT 0",
    "bytes_total INTEGER DEFAULT 0",
    "items_copied INTEGER DEFAULT 0",
    "items_failed INTEGER DEFAULT 0",
    "started_at DATETIME",
    "finished_at DATETIME",
  ]);
  db.exec("CREATE INDEX IF NOT EXISTS idx_migrate_bundles_job ON migrate_bundles (job_id);");

  // The bundle ledger — one row per copied file, sha256 recorded (hash verify is ON for bundles).
  createTable(db, "migrate_bundle_items", [
    "org_id TEXT NOT NULL",
    "bundle_id INTEGER NOT NULL",
    "item_id INTEGER NOT NULL",
    "dest_path TEXT",
    "bytes INTEGER",
    "sha256 TEXT",
    "verified INTEGER DEFAULT 0",
    "status TEXT NOT NULL", // 'copied' | 'skipped' | 'error'
    "error_text TEXT",
  ]);
  db.exec("CREATE INDEX IF NOT EXISTS idx_migrate_bundle_items_bundle ON migrate_bundle_items (bundle_id);");
}
