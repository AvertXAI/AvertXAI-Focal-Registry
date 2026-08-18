// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Scan Notes schema — a SIBLING of scan/db.ts, in the SAME shared org database. Split
//              into its own file because scan/db.ts already carries five tables and two guard blocks
//              for a different feature; one file per feature keeps each readable. Registered as its
//              own entry in SHARED_SCHEMA_ENSURES so the tables exist because an org exists, never
//              because someone opened a tab (db/allSchemas.ts states that rule).
//
//              FOUR TABLES, and the split between them is deliberate:
//                • scan_notes                — USER-AUTHORED notes only. A folder's generated report
//                  card is RENDERED LIVE from scan_folders and is never materialized as a row here
//                  (ruled 08-17-2026), so this table stays as small as the user's own writing.
//                • scan_folder_name_history  — the append-only RECORD of every folder rename, no cap.
//                  Old AND new names are both indexed because both are searchable by ruling.
//                • scan_rename_queue         — the WORK LIST for renames that could not be applied
//                  yet. History is what happened; the queue is what still has to happen. An applied
//                  row keeps its outcome rather than being deleted, so a drive that reconnects twice
//                  cannot replay a rename.
//                • scan_notes_updates        — the Updated Notes feed, which doubles as this module's
//                  four-level event log (the standing rule promoted from the Vault lane). One table,
//                  because "what changed" and "what went wrong" are the same question to the user.
//
//              PLAINTEXT, BY RULING. These rows live in the shared org database, not the encrypted
//              vault file: a photographer's folder notes are not credentials, and Rename/Scan need to
//              read them with a plain SELECT.
//
//              ADDING A COLUMN LATER: PRAGMA table_info guard, and the guard goes AFTER the
//              createTable it guards — never before (scan/db.ts:156-157 records why: reversing the
//              order throws "no such table" on a FRESH database only, which an existing dev database
//              will not catch). ONE guard block exists, on scan_notes_updates — see it for why.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/scan/notesDb.ts
//------------------------------------------------------------
import type Database from "better-sqlite3-multiple-ciphers";
import { createTable } from "../db";
import { backfillFeedFolders } from "./notesBackfill";

export type Db = Database.Database;

/** Rename lifecycle. `pending` is queued work; `applied` and `stale` are both terminal. */
export type ScanRenameStatus = "pending" | "applied" | "stale";

/** Feed levels — the four the standing rule names. */
export type ScanNotesLevel = "debug" | "info" | "warn" | "error";

/** What a feed row is about. Drives the tag chip in the Updated Notes table. */
export type ScanNotesKind = "note" | "rename" | "scan" | "sync";

// Idempotent, additive, safe to re-run on every boot — the same contract ensureScanSchema honours.
export function ensureScanNotesSchema(db: Db): void {
  // ---- user-authored notes ------------------------------------------------------------------
  // folder_path is the join key to scan_folders.path and is rewritten in the SAME transaction as a
  // folder rename, so a note never orphans from the folder it belongs to.
  createTable(db, "scan_notes", [
    "org_id TEXT NOT NULL",
    "drive_id INTEGER", // shaped to scan_drives.id — soft, like every other cross-module reference here
    "folder_path TEXT NOT NULL",
    "title TEXT NOT NULL",
    "body TEXT NOT NULL DEFAULT ''",
    "archived_at DATETIME",
  ]);
  // The list/lookup path: every note for one folder on one drive.
  db.exec("CREATE INDEX IF NOT EXISTS idx_scan_notes_folder ON scan_notes (org_id, drive_id, folder_path);");

  // ---- append-only folder-name history ------------------------------------------------------
  // NO CAP, by ruling — the whole chain is kept. name_old/name_new are the BASENAMES (what the user
  // reads and searches); folder_path_old/new are the full paths (what the rename engine acts on).
  // Both are stored because searching a basename must not require parsing a path.
  createTable(db, "scan_folder_name_history", [
    "org_id TEXT NOT NULL",
    "drive_id INTEGER",
    "volume_serial TEXT NOT NULL", // drive identity — never the letter (scan/drives.ts:21)
    "folder_path_old TEXT NOT NULL",
    "folder_path_new TEXT NOT NULL",
    "name_old TEXT NOT NULL",
    "name_new TEXT NOT NULL",
    "changed_at DATETIME", // when the user asked
    "applied_at DATETIME", // when the disk actually changed — NULL while pending
    "status TEXT NOT NULL", // applied | pending | stale
    "stale_reason TEXT", // plain sentence, shown to the user; NULL unless status = 'stale'
  ]);
  // Per-drive history — the Folder History card and the reconnect consumer both read this way.
  db.exec("CREATE INDEX IF NOT EXISTS idx_scan_fnh_serial ON scan_folder_name_history (org_id, volume_serial);");
  // The old-AND-new name search, by ruling. Two indexes, because a LIKE on either column must be
  // able to start from an index range rather than a full table scan.
  db.exec("CREATE INDEX IF NOT EXISTS idx_scan_fnh_name_old ON scan_folder_name_history (org_id, name_old);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_scan_fnh_name_new ON scan_folder_name_history (org_id, name_new);");

  // ---- the rename work list -----------------------------------------------------------------
  // A row is created ONLY when the rename could not be applied immediately (drive absent). It is
  // marked applied/stale in place rather than deleted, so the outcome survives and a second
  // reconnect cannot replay it.
  createTable(db, "scan_rename_queue", [
    "org_id TEXT NOT NULL",
    "volume_serial TEXT NOT NULL",
    "folder_path_old TEXT NOT NULL",
    "folder_path_new TEXT NOT NULL",
    "queued_at DATETIME",
    "applied_at DATETIME",
    "status TEXT NOT NULL", // pending | applied | stale
    "result_text TEXT", // the outcome sentence, kept on applied and stale rows alike
  ]);
  // THE consumer query: pending rows for the serials that just came back. Without the status column
  // in the index this scans every historical applied row on a drive that has been renamed often.
  db.exec("CREATE INDEX IF NOT EXISTS idx_scan_queue_pending ON scan_rename_queue (org_id, volume_serial, status);");

  // ---- the Updated Notes feed (and the module event log) ------------------------------------
  // seen_at NULL = unseen, which is what the tab badge counts. Opening the tab stamps it.
  createTable(db, "scan_notes_updates", [
    "org_id TEXT NOT NULL",
    "ts DATETIME",
    "level TEXT NOT NULL", // debug | info | warn | error
    "kind TEXT NOT NULL", // note | rename | scan | sync
    "request_id TEXT", // SCN-XXXXXX — quoted by the user, found by the developer
    "message TEXT NOT NULL", // the sentence a person reads
    "detail TEXT", // the technical half — stacks, paths, counts
    "drive_label TEXT", // shown in the feed's Drive column
    "folder_path TEXT", // the folder the event happened TO — what Recent Work jumps to
    "source_uuid TEXT", // the row that CAUSED it: scan_notes.uuid, or scan_folder_name_history.uuid
    "seen_at DATETIME",
  ]);
  // FIRST GUARD IN THIS FILE, and it goes AFTER the createTable it guards — never before (see the
  // header note; scan/db.ts records that reversing the order throws "no such table" on a FRESH
  // database only, which an existing development database will not catch).
  //
  // TWO COLUMNS, ADDED 08-18-2026, and they close the same gap from both ends. A feed row saying a
  // folder was renamed without recording WHICH folder is an incomplete log — Jason ruled the full
  // fix rather than the panel-shaped one ("dont do things half ass"). `folder_path` is where the
  // event happened; `source_uuid` is the row that caused it.
  //
  // ONE source_uuid COLUMN, NOT TWO, and the reason is that the two references are mutually
  // exclusive: a note event never has a history row and a rename event never has a note. `kind`
  // already says which table to look in, so a second column would be permanently NULL on every row
  // that used the first — one column means one guard, one index, and one thing to keep in step.
  //
  // THE BACKFILL RUNS ONLY WHEN THE ALTER FIRES, which makes it exactly-once per database by
  // construction with no marker row to maintain: if the column is already there, it has already run.
  // Both share this function's transaction, so a crash between them rolls back and the next launch
  // retries rather than leaving a half-repaired log.
  {
    const cols = (db.pragma("table_info(scan_notes_updates)") as { name: string }[]).map((c) => c.name);
    const needFolder = !cols.includes("folder_path");
    const needSource = !cols.includes("source_uuid");
    if (needFolder || needSource) {
      // THE TRANSACTION IS DECLARED HERE, NOT ASSUMED FROM THE CALLER, and an adversarial review on
      // 08-18-2026 is why. The first cut's comment claimed the ALTER and the backfill shared "the
      // migration's transaction" — there is none: `ensureAllModuleSchemas` (db/allSchemas.ts) is a
      // bare loop, and every one of the four call sites invokes it without wrapping. So under
      // better-sqlite3 the ALTER autocommitted on its own, and a crash between it and the backfill
      // would have left the column present, this guard satisfied, and the repair skipped FOREVER —
      // no marker row, no version counter, no way back in. SQLite makes DDL transactional, so
      // declaring it here makes the pair genuinely atomic: either the column and the repaired rows
      // both land, or neither does and the next launch tries again.
      db.transaction(() => {
        if (needFolder) db.exec("ALTER TABLE scan_notes_updates ADD COLUMN folder_path TEXT;");
        if (needSource) db.exec("ALTER TABLE scan_notes_updates ADD COLUMN source_uuid TEXT;");
        if (needFolder) {
          const c = backfillFeedFolders(db);
          console.info(
            `[scan-notes] feed backfill — ${c.examined} rows examined, ${c.exact} matched and written, ` +
              `${c.ambiguous} left NULL for ambiguity, ${c.none} left NULL with no candidate`
          );
        }
      })();
    }
  }
  // Recent Work reads newest-first over the rows that HAVE a folder, which is a small subset of a
  // log that grows forever. Without this it scans the whole table on every mount.
  db.exec("CREATE INDEX IF NOT EXISTS idx_scan_updates_folder ON scan_notes_updates (org_id, folder_path, ts);");
  // Newest-first paging — the feed's only ordering.
  db.exec("CREATE INDEX IF NOT EXISTS idx_scan_updates_ts ON scan_notes_updates (org_id, ts);");
  // The badge count runs on every feed write and every mount; it must not scan the whole log.
  db.exec("CREATE INDEX IF NOT EXISTS idx_scan_updates_seen ON scan_notes_updates (org_id, seen_at);");
}
