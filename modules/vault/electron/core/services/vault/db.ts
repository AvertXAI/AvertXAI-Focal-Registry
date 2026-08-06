// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Secured Vault schema — lives in the vault's OWN SQLCipher database (<org_id>.atd —
//              deliberately dull name, ruled 08-02-2026; obscurity only, SQLCipher is the control —
//              connection-registry key "vault"), NEVER the shared org database (FR-DECISIONS §Storage:
//              "Secrets never in the shared database"). Money-surface doctrine throughout: a secret
//              value lives in EXACTLY ONE place — the append-only vault_secret_versions history
//              (mirror ruled OUT 08-01-2026). Supersede appends version N+1 and updates nothing else;
//              reads resolve the highest version.
//
//              PHASE A EXPANSION (Jason's rulings 08-06-2026):
//              · Entry METADATA columns — full_name, username, url, notes, favourite, folder_id —
//                carry the workbook's column set (Company · Full name · Username / ID · URL · Other)
//                and are safe on a list surface because none of them is a credential.
//              · Backup codes and security questions are CREDENTIALS, so they do NOT become metadata.
//                They ride `extras` (JSON) on the VERSION row — same row, same version, one atomic
//                append-only unit as the password, reachable only through the logged single read.
//              · The access-log action CHECK is born GENEROUSLY WIDE ("widen it… then 10x it, just
//                incase") so no future surface ever meets a frozen constraint again.
//              Everything additive; guarded PRAGMA table_info ALTERs sit AFTER their createTable
//              call, never before (scan/db.ts precedent). No destructive DDL anywhere, ever.
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

/**
 * Every action the access log will accept. Deliberately far wider than today's surfaces need —
 * Jason ruled 08-06-2026 "widen it, exceed it as much as you need, then 10x it, just incase",
 * because SQLite cannot ALTER a CHECK and a frozen one would force a banned table rebuild.
 * THIS ARRAY IS THE SOURCE OF TRUTH: the CHECK is generated from it, and the TypeScript union in
 * types.ts mirrors it. Adding a row here is the only step a new logged action ever needs.
 */
export const VAULT_ACTIONS = [
  // core secret lifecycle
  "create", "read", "supersede", "archive", "restore", "delete",
  // reading shapes that are not the plain read
  "reveal", "copy", "view_history", "print",
  // bulk and movement
  "export", "import", "seed", "purge", "wipe", "backup", "restore_backup", "sync", "share",
  // analysis
  "health_scan", "breach_check", "generate",
  // access control (the master-password seam)
  "unlock", "unlock_failed", "lock", "auto_lock", "password_change",
  // organisation and configuration
  "folder_create", "folder_rename", "folder_delete", "move", "favourite", "settings_change",
] as const;

export type VaultAction = (typeof VAULT_ACTIONS)[number];

// Idempotent, additive, safe to re-run on every boot. Guard-only and versionless. Runs against the
// "vault" connection handle — the caller passes it in; nothing here ever touches getDb()'s shared DB.
export function ensureVaultSchema(db: Db): void {
  // The stored item — IDENTITY, PRESENTATION AND ARCHIVE STATE ONLY, deliberately credential-free.
  // The std uuid column IS the public locator other modules reference (the adjustments doctrine) —
  // a consumer holds the uuid, never the value, exactly as MindMerge's mindmerge_secret_refs
  // .vault_pointer holds a locator and is never resolved by its owner. There is NO value column and
  // NO version column here: both derive from vault_secret_versions, so neither can ever drift.
  // `kind` is an open set (login, api_key, taxpayer_id, …) — free text by design; a CHECK here
  // would need a migration per new consumer.
  createTable(db, "vault_secrets", [
    "org_id TEXT NOT NULL",
    "kind TEXT NOT NULL",
    "label TEXT NOT NULL", // the company / display name — the workbook's Company column
    "archived_at TEXT", // soft archive; NULL = active. Rows are NEVER hard-deleted by any UI path.
    "archive_reason TEXT",
  ]);
  // Additive metadata, guarded, AFTER createTable (canon order — never before). Each is safe to
  // return on a LIST because none of them is a credential; the credential material stays on the
  // version row. A fresh database gets these from the loop below on its very first ensure.
  for (const [col, decl] of [
    ["full_name", "full_name TEXT"], // the workbook's Full name — who the account belongs to
    ["username", "username TEXT"], // Username / ID
    ["url", "url TEXT"], // URL / Website
    ["notes", "notes TEXT"], // the workbook's Other column — human context, never a credential
    ["favourite", "favourite INTEGER NOT NULL DEFAULT 0"],
    ["folder_id", "folder_id INTEGER"], // soft reference; a deleted folder must never delete secrets
  ] as const) {
    if (!(db.pragma("table_info(vault_secrets)") as { name: string }[]).some((c) => c.name === col)) {
      db.exec(`ALTER TABLE vault_secrets ADD COLUMN ${decl};`);
    }
  }

  // APPEND-ONLY value history — THE one home a secret value has. Rows are INSERTed and never
  // updated or deleted: superseding a secret writes version N+1 here and nothing removes version
  // N — reversibility is structural, not a convention. The current value/version are always the
  // highest-version row for the secret; nothing else stores them.
  createTable(db, "vault_secret_versions", [
    "org_id TEXT NOT NULL",
    "secret_id INTEGER NOT NULL REFERENCES vault_secrets(id)",
    "version INTEGER NOT NULL",
    "value TEXT NOT NULL",
  ]);
  // `extras` — JSON holding backup codes and security-question answers. These are CREDENTIALS, so
  // they live HERE and not in metadata: they version with the password as one atomic unit, and the
  // only way out is the logged single read. Guarded ALTER, after createTable.
  if (!(db.pragma("table_info(vault_secret_versions)") as { name: string }[]).some((c) => c.name === "extras")) {
    db.exec("ALTER TABLE vault_secret_versions ADD COLUMN extras TEXT;");
  }
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
    `action TEXT NOT NULL CHECK (action IN (${VAULT_ACTIONS.map((a) => `'${a}'`).join(",")}))`,
    "secret_uuid TEXT", // the locator that was ASKED for — soft reference, see block comment above
    "secret_label TEXT", // denormalized at write time; NULL on a miss
    "caller TEXT NOT NULL", // who asked — stamped by the trust boundary, never self-reported by a page
    "granted INTEGER NOT NULL CHECK (granted IN (0, 1))",
    "detail TEXT", // refusal reason ('not found', 'archived') — NEVER a value
  ]);

  // The vault's OWN settings store. Canon: "The Vault owns its own settings. The application's
  // Settings page carries no vault controls, ever." Config-as-data — every vault preference is a
  // ROW read at runtime, never a hardcoded renderer constant, and never app_settings in the shared
  // database (a vault reconfigurable from outside itself hands an attacker a lever).
  createTable(db, "vault_settings", ["org_id TEXT NOT NULL", "key TEXT NOT NULL", "value TEXT NOT NULL"]);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS vault_settings_uniq ON vault_settings(org_id, key);");

  // Folders — nested by a SOFT parent reference. Deleting a folder never deletes a secret (the
  // secret's folder_id simply stops resolving and it falls back to All items); that is why neither
  // side carries a hard foreign key.
  createTable(db, "vault_folders", [
    "org_id TEXT NOT NULL",
    "name TEXT NOT NULL",
    "parent_id INTEGER", // NULL = top level. Soft by design — see block comment above.
    "sort_order INTEGER NOT NULL DEFAULT 0",
  ]);

  // ---- indexes — one per hot query, IF NOT EXISTS so the ensure stays rerunnable. (Per-secret
  // ---- version lookups ride vault_secret_versions_uniq above — see its comment.)
  // audit surface: newest-first page over the whole log
  db.exec("CREATE INDEX IF NOT EXISTS idx_vault_access_log_ts ON vault_access_log (ts);");
  // per-secret audit trail: every ask about one locator
  db.exec("CREATE INDEX IF NOT EXISTS idx_vault_access_log_secret ON vault_access_log (secret_uuid);");
  // the folder browse: every secret in one folder
  db.exec("CREATE INDEX IF NOT EXISTS idx_vault_secrets_folder ON vault_secrets (folder_id);");
  // the folder tree: children of one node
  db.exec("CREATE INDEX IF NOT EXISTS idx_vault_folders_parent ON vault_folders (parent_id);");
}
