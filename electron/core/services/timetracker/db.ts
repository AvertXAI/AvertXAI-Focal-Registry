// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: TimeTracker module schema — lives in the SHARED org database like Scan, Rename, and
//              Migrate (one connection, cross-module SELECTs stay plain). Twelve timetracker_-prefixed
//              tables through the shared createTable() (std id/uuid/created_at/updated_at), org_id on
//              every table, CHECK constraints lifted verbatim from the proven standalone engine.
//              FRESH schema — no data import, no user_version ladder (FR-DECISIONS §TimeTracker).
//              Everything additive; any future column follows the PRAGMA table_info guard pattern,
//              placed AFTER its createTable call (scan/db.ts precedent — never before).
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/timetracker/db.ts
//------------------------------------------------------------
import type Database from "better-sqlite3-multiple-ciphers";
import { createTable } from "../db";

export type Db = Database.Database;

/** ISO-8601 stamp for app-written domain timestamps (session clocks, audit entries). The std
    created_at/updated_at columns exist on every table; domain logic writes ISO explicitly so the
    timer math (Date.parse) and strftime bucketing see one consistent format per column. */
export function nowIso(): string {
  return new Date().toISOString();
}

// Idempotent, additive, safe to re-run on every boot. Guard-only, rerunnable, versionless — the
// standalone app's V2→V9 PRAGMA user_version ladder collapses into these final-shape tables.
export function ensureTimeTrackerSchema(db: Db): void {
  createTable(db, "timetracker_clients", [
    "org_id TEXT NOT NULL",
    "name TEXT NOT NULL",
    "contact_phone TEXT",
    "email TEXT",
  ]);

  createTable(db, "timetracker_groups", [
    "org_id TEXT NOT NULL",
    "name TEXT NOT NULL UNIQUE",
    "color TEXT NOT NULL DEFAULT '#3b82f6'",
    "sort_order INTEGER NOT NULL DEFAULT 0",
  ]);

  createTable(db, "timetracker_projects", [
    "org_id TEXT NOT NULL",
    "client_id INTEGER NOT NULL REFERENCES timetracker_clients(id)",
    "name TEXT NOT NULL",
    "color TEXT NOT NULL DEFAULT '#2f6df6'",
    "status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','parked','done'))",
    "rate_type TEXT NOT NULL DEFAULT 'hourly' CHECK (rate_type IN ('hourly','contract'))",
    "hourly_rate REAL",
    "priority_order INTEGER NOT NULL DEFAULT 0",
    "group_id INTEGER REFERENCES timetracker_groups(id)",
    "contract_amount REAL",
    "contract_description TEXT",
    "contract_file_path TEXT",
    "contract_kind TEXT CHECK (contract_kind IN ('paid','donated'))",
    "target_hours REAL",
    "time_display_mode TEXT CHECK (time_display_mode IN ('elapsed','remaining'))",
    "archived_at TEXT",
    "archive_reason TEXT",
    "archive_audit TEXT", // append-only JSON array of {action, at, reason?} entries
  ]);

  // time_entries is written by exactly ONE service path (timer closeSession) and is never
  // modified by any migration or adjustment — the standalone engine's hard constraint carries over.
  createTable(db, "timetracker_time_entries", [
    "org_id TEXT NOT NULL",
    "project_id INTEGER NOT NULL REFERENCES timetracker_projects(id)",
    "started_at TEXT NOT NULL",
    "ended_at TEXT NOT NULL",
    "duration_seconds INTEGER NOT NULL",
    "note TEXT",
  ]);

  // ONE active session per project (UNIQUE-enforced) — pause is a FLAG on the open row
  // (state='paused' + last_paused_at), never a split entry (FR-DECISIONS §TimeTracker).
  createTable(db, "timetracker_active_sessions", [
    "org_id TEXT NOT NULL",
    "project_id INTEGER NOT NULL UNIQUE REFERENCES timetracker_projects(id)",
    "note TEXT",
    "started_at TEXT NOT NULL", // elapsed base — shifted forward on resume
    "wall_started_at TEXT NOT NULL", // real wall-clock start — never shifted
    "accumulated_seconds INTEGER NOT NULL DEFAULT 0", // frozen elapsed while paused
    "state TEXT NOT NULL DEFAULT 'running' CHECK (state IN ('running','paused'))",
    "last_paused_at TEXT",
    "last_resumed_at TEXT",
    "last_heartbeat TEXT NOT NULL", // ~5s ticker heartbeat — the crash-recovery source
    "is_focused INTEGER NOT NULL DEFAULT 0",
  ]);

  createTable(db, "timetracker_value_ledger", [
    "org_id TEXT NOT NULL",
    "project_id INTEGER NOT NULL REFERENCES timetracker_projects(id)",
    "amount REAL NOT NULL",
    "previous_amount REAL",
    "action TEXT NOT NULL CHECK (action IN ('set','update'))",
    "note TEXT",
  ]);

  createTable(db, "timetracker_notes", [
    "org_id TEXT NOT NULL",
    "project_id INTEGER NOT NULL UNIQUE REFERENCES timetracker_projects(id)",
    "body TEXT NOT NULL DEFAULT ''",
  ]);

  createTable(db, "timetracker_costs", [
    "org_id TEXT NOT NULL",
    "project_id INTEGER NOT NULL REFERENCES timetracker_projects(id)",
    "label TEXT NOT NULL",
    "category TEXT NOT NULL DEFAULT ''",
    "amount REAL NOT NULL",
    "recurrence TEXT NOT NULL DEFAULT 'once' CHECK (recurrence IN ('once','monthly','yearly'))",
    "url TEXT",
  ]);

  // The std uuid column IS the adjustment's public id (the standalone app's adj_<uuid> TEXT PK
  // collapses onto it). Caps NEVER apply to adjustments — they exist to correct history.
  createTable(db, "timetracker_adjustments", [
    "org_id TEXT NOT NULL",
    "project_id INTEGER NOT NULL REFERENCES timetracker_projects(id)",
    "delta_minutes INTEGER NOT NULL",
    "note TEXT NOT NULL",
    "deleted_at TEXT", // soft delete — rows are never hard-removed except by project cascade
    "audit_log TEXT NOT NULL", // append-only JSON array; history is never rewritten
  ]);

  // Tombstones written by purge BEFORE the cascade — the wasted-hours metric reads these.
  createTable(db, "timetracker_deletion_log", [
    "org_id TEXT NOT NULL",
    "project_name TEXT NOT NULL",
    "project_type TEXT NOT NULL",
    "total_minutes INTEGER NOT NULL",
    "purged_at TEXT NOT NULL",
    "purge_reason TEXT NOT NULL",
  ]);

  // Custom uploads only — bundled sounds are listed live from the shipped assets folder,
  // never seeded as rows (installs/updates can ship new ones without a migration).
  createTable(db, "timetracker_alert_sounds", [
    "org_id TEXT NOT NULL",
    "display_name TEXT NOT NULL",
    "file_path TEXT NOT NULL",
    "is_bundled INTEGER NOT NULL DEFAULT 0",
  ]);

  // DELIBERATE: project_id has NO foreign key. The event log is append-only history that must
  // SURVIVE a project purge (deletion_log gets the tombstone; this keeps the actions) — a hard FK
  // would cascade-delete it or block the purge. project_name is denormalized at write time so the
  // log stays readable after a rename/archive/purge. DO NOT "fix" this by adding a FK.
  createTable(db, "timetracker_event_log", [
    "org_id TEXT NOT NULL",
    "ts TEXT NOT NULL",
    "event_type TEXT NOT NULL CHECK (event_type IN ('started','paused','resumed','stopped','crashed','recovered','ignored'))",
    "project_id INTEGER", // soft reference by design — see block comment above
    "project_name TEXT NOT NULL",
    "detail TEXT",
  ]);

  // ---- indexes — the standalone source shipped ZERO (verified by grep, recon §5); every hot
  // ---- ported query gets one here. IF NOT EXISTS keeps the ensure rerunnable.
  // totals rollup + detail: every project total sums time_entries by project_id
  db.exec("CREATE INDEX IF NOT EXISTS idx_timetracker_time_entries_project ON timetracker_time_entries (project_id);");
  // analytics time-series: range cutoff filters + buckets on started_at across the whole table
  db.exec("CREATE INDEX IF NOT EXISTS idx_timetracker_time_entries_started ON timetracker_time_entries (started_at);");
  // activity tab: newest-first page, whole log and per-project
  db.exec("CREATE INDEX IF NOT EXISTS idx_timetracker_event_log_ts ON timetracker_event_log (ts);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_timetracker_event_log_project ON timetracker_event_log (project_id);");
  // per-project cost lists + total_costs subquery
  db.exec("CREATE INDEX IF NOT EXISTS idx_timetracker_costs_project ON timetracker_costs (project_id);");
  // per-project adjustment lists + the totals rollup's non-deleted sum
  db.exec("CREATE INDEX IF NOT EXISTS idx_timetracker_adjustments_project ON timetracker_adjustments (project_id);");
  // per-project ledger list + latest-amount subquery
  db.exec("CREATE INDEX IF NOT EXISTS idx_timetracker_value_ledger_project ON timetracker_value_ledger (project_id);");
  // sidebar regroup/reorder sibling scans + group rollups
  db.exec("CREATE INDEX IF NOT EXISTS idx_timetracker_projects_group ON timetracker_projects (group_id);");
}
