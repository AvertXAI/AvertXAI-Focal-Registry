// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Secured Vault schema — lives in the vault's OWN SQLCipher database (<org_id>.atd —
//              deliberately dull name, ruled 08-02-2026; obscurity only, SQLCipher is the control —
//              connection-registry key "vault"), NEVER the shared org database (FR-DECISIONS §Storage:
//              "Secrets never in the shared database"). Three vault_-prefixed tables through the shared
//              createTable() (std id/uuid/created_at/updated_at), org_id on every table. Money-surface
//              doctrine throughout: a secret value lives in EXACTLY ONE place — the append-only
//              vault_secret_versions history (Jason ruled the current-value mirror OUT, 08-01-2026:
//              a second copy of the same value is a permanent drift risk). Supersede appends version
//              N+1 and updates nothing else; reads resolve the highest version. Nothing is edited,
//              nothing is destroyed; retirement is a soft archive. FRESH schema — no data import, no user_version
//              ladder (timetracker/db.ts precedent). Everything additive; any future column follows the
//              PRAGMA table_info guard pattern placed AFTER its createTable call, never before.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/vault/db.ts
//------------------------------------------------------------
import type Database from "better-sqlite3-multiple-ciphers";
import { createTable } from "../db";

export type Db = Database.Database;

/** ISO-8601 stamp for app-written domain timestamps. A deliberate local copy of TimeTracker's
    helper: modules share a DATABASE pattern, never each other's service layer. */
export function nowIso(): string {
  return new Date().toISOString();
}

// Idempotent, additive, safe to re-run on every boot. Guard-only and versionless. Runs against the
// "vault" connection handle — the caller passes it in; nothing here ever touches getDb()'s shared DB.
export function ensureVaultSchema(db: Db): void {
  // The stored item — IDENTITY AND ARCHIVE STATE ONLY, deliberately value-free. The std uuid
  // column IS the public locator other modules reference (the adjustments doctrine) — a consumer
  // holds the uuid, never the value, exactly as MindMerge's mindmerge_secret_refs.vault_pointer
  // holds a locator and is never resolved by its owner. There is NO value column and NO version
  // column here (mirror ruled OUT 08-01-2026): both derive from vault_secret_versions, so neither
  // can ever drift from the history. `kind` is an open set (api_key, password, taxpayer_id, …) —
  // free text by design; a CHECK here would need a migration per new consumer.
  createTable(db, "vault_secrets", [
    "org_id TEXT NOT NULL",
    "kind TEXT NOT NULL",
    "label TEXT NOT NULL",
    "archived_at TEXT", // soft archive; NULL = active. Rows are NEVER hard-deleted.
    "archive_reason TEXT",
  ]);

  // APPEND-ONLY value history — THE one home a secret value has. Rows are INSERTed and never
  // updated or deleted: superseding a secret writes version N+1 here and nothing removes version
  // N — reversibility is structural, not a convention. The current value/version are always the
  // highest-version row for the secret; nothing else stores them. (secret_id, version) is UNIQUE
  // below so a version can never be silently double-written.
  createTable(db, "vault_secret_versions", [
    "org_id TEXT NOT NULL",
    "secret_id INTEGER NOT NULL REFERENCES vault_secrets(id)",
    "version INTEGER NOT NULL",
    "value TEXT NOT NULL",
  ]);
  // Dedupe the (secret, version) pair (a table constraint can't live mid-column-list under
  // createTable's std wrapper — mindmerge_note_tags_uniq precedent). This composite is ALSO the
  // hot-path index: "highest version for this secret" (MAX(version) WHERE secret_id = ?) is a
  // single indexed descent on it, and its (secret_id) left prefix covers every plain per-secret
  // scan — so no separate idx_vault_secret_versions_secret exists; it would be pure dead weight.
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS vault_secret_versions_uniq ON vault_secret_versions(secret_id, version);");

  // APPEND-ONLY access log: who asked for what, when, and whether it was granted. NO SECRET VALUE
  // EVER ENTERS THIS TABLE — there is no column for one, and detail carries refusal reasons only.
  // secret_uuid is a SOFT reference by design (timetracker_event_log doctrine): a refused read of a
  // locator that doesn't exist still gets a row, and the log must survive whatever happens to the
  // secret it names. secret_label is denormalized at write time so the log stays readable on its own.
  createTable(db, "vault_access_log", [
    "org_id TEXT NOT NULL",
    "ts TEXT NOT NULL",
    "action TEXT NOT NULL CHECK (action IN ('create','read','supersede','archive'))",
    "secret_uuid TEXT", // the locator that was ASKED for — soft reference, see block comment above
    "secret_label TEXT", // denormalized at write time; NULL on a miss
    "caller TEXT NOT NULL", // who asked — stamped by the trust boundary, never self-reported by a page
    "granted INTEGER NOT NULL CHECK (granted IN (0, 1))",
    "detail TEXT", // refusal reason ('not found', 'archived') — NEVER a value
  ]);

  // ---- indexes — one per hot query, IF NOT EXISTS so the ensure stays rerunnable. (Per-secret
  // ---- version lookups ride vault_secret_versions_uniq above — see its comment.)
  // audit surface: newest-first page over the whole log
  db.exec("CREATE INDEX IF NOT EXISTS idx_vault_access_log_ts ON vault_access_log (ts);");
  // per-secret audit trail: every ask about one locator
  db.exec("CREATE INDEX IF NOT EXISTS idx_vault_access_log_secret ON vault_access_log (secret_uuid);");
}
