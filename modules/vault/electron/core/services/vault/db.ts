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
import crypto from "node:crypto";
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
  const ACCESS_LOG_COLUMNS = [
    "org_id TEXT NOT NULL",
    "ts TEXT NOT NULL",
    `action TEXT NOT NULL CHECK (action IN (${VAULT_ACTIONS.map((a) => `'${a}'`).join(",")}))`,
    "secret_uuid TEXT", // the locator that was ASKED for — soft reference, see block comment above
    "secret_label TEXT", // denormalized at write time; NULL on a miss
    "caller TEXT NOT NULL", // who asked — stamped by the trust boundary, never self-reported by a page
    "granted INTEGER NOT NULL CHECK (granted IN (0, 1))",
    "detail TEXT", // refusal reason ('not found', 'archived') — NEVER a value
  ];
  createTable(db, "vault_access_log", ACCESS_LOG_COLUMNS);
  /**
   * LEGACY REBUILD (mount, 08-14-2026). A pre-mount vault carries this table with the original
   * FOUR-action CHECK baked into its stored DDL, and SQLite cannot ALTER a CHECK — so 'unlock' and
   * the other newer actions violated it, which made every legacy-org unlock throw the moment it
   * tried to log itself (found on Jason's dev org at the mount gate; Paul's install carries the
   * same table). Detected by the stored DDL lacking 'unlock'; repaired by the standard SQLite
   * rename → create → copy → drop with every row carried across inside one transaction — the
   * column set never changed, only the CHECK text. Idempotent: a current table is a no-op. The
   * additive-only migration rule is knowingly stepped around with Jason's 08-14 go-ahead: an
   * in-place CHECK widen does not exist in SQLite, and this rebuild preserves every row. The
   * dropped indexes are recreated by the IF NOT EXISTS index block at the end of this same pass.
   */
  const accessLogDdl =
    (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'vault_access_log'").get() as
      | { sql?: string }
      | undefined)?.sql ?? "";
  if (accessLogDdl !== "" && !accessLogDdl.includes("'unlock'")) {
    db.transaction(() => {
      db.exec("ALTER TABLE vault_access_log RENAME TO vault_access_log_legacy;");
      createTable(db, "vault_access_log", ACCESS_LOG_COLUMNS);
      db.exec("INSERT INTO vault_access_log SELECT * FROM vault_access_log_legacy;");
      db.exec("DROP TABLE vault_access_log_legacy;");
    })();
  }

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

  // ---- redesign surfaces (08-10-2026, built to MOCKUP-vault-full-v2). All additive. ----

  // Guarded ALTER: the SSH public key is NOT a secret (it is designed to be handed out), so it is
  // metadata — which is what lets the detail pane derive the fingerprint and randomart WITHOUT a
  // logged read. The private key and passphrase stay on the version row like every credential.
  if (!(db.pragma("table_info(vault_secrets)") as { name: string }[]).some((c) => c.name === "public_key")) {
    db.exec("ALTER TABLE vault_secrets ADD COLUMN public_key TEXT;");
  }

  // Secured Notes — notes, runbooks and snippets are ONE stored thing (title, kind, markdown body).
  // The body lives in this SQLCipher file so it is encrypted at rest like everything else; it is
  // CONTENT, not credential material — credentials appear in a note only as @[[vault:…]] locators,
  // resolved through the one logged read. That is why note reads are not access-logged.
  createTable(db, "vault_notes", [
    "org_id TEXT NOT NULL",
    "kind TEXT NOT NULL", // note | runbook | snippet — open set, same doctrine as vault_secrets.kind
    "title TEXT NOT NULL",
    "body TEXT NOT NULL DEFAULT ''",
    "folder TEXT", // free-text group name; NULL = All notes
    "pinned INTEGER NOT NULL DEFAULT 0",
    "archived_at TEXT",
  ]);
  db.exec("CREATE INDEX IF NOT EXISTS idx_vault_notes_kind ON vault_notes (kind);");

  // Infrastructure — servers and DNS records. ssh_secret_uuid and runbook_uuid are SOFT locators
  // (the MindMerge vault_pointer doctrine): a row points AT a credential, never contains one.
  createTable(db, "vault_servers", [
    "org_id TEXT NOT NULL",
    "host TEXT NOT NULL",
    "address TEXT",
    "provider TEXT",
    "role TEXT",
    "ssh_secret_uuid TEXT",
    "runbook_uuid TEXT",
    "notes TEXT",
  ]);
  createTable(db, "vault_dns_records", [
    "org_id TEXT NOT NULL",
    "domain TEXT NOT NULL",
    "name TEXT NOT NULL",
    "rtype TEXT NOT NULL",
    "content TEXT NOT NULL",
    "proxied INTEGER", // 1 / 0 / NULL = unknown (a zone file may not say)
    "ttl TEXT",
    "comment TEXT",
  ]);
  db.exec("CREATE INDEX IF NOT EXISTS idx_vault_dns_domain ON vault_dns_records (domain);");

  // Repos — metadata plus a stored README snapshot so it reads with the network off. The deploy
  // key is a locator into vault_secrets, same soft-pointer rule as servers.
  createTable(db, "vault_repos", [
    "org_id TEXT NOT NULL",
    "name TEXT NOT NULL",
    "description TEXT",
    "visibility TEXT", // public | private
    "language TEXT",
    "license TEXT",
    "stars TEXT",
    "version TEXT",
    "local_path TEXT",
    "remote_url TEXT",
    "deploy_secret_uuid TEXT",
    "readme_md TEXT", // pasted snapshot — the vault never fetches it (two network features, both on Health)
  ]);

  // APPEND-ONLY EVENT LOG — four levels, and a REQUEST ID that is the whole reason it exists. The
  // user is shown a plain sentence plus that reference; the technical truth lands here under the
  // same reference, so a support message of six characters is enough to find the row. Distinct from
  // vault_access_log on purpose: that one answers "who asked for which secret", this one answers
  // "what broke, and where". Neither ever holds a value — there is no column for one, and `detail`
  // carries stacks and reasons only. See log.ts for the two-audience split this table serves.
  createTable(db, "vault_event_log", [
    "org_id TEXT NOT NULL",
    "ts TEXT NOT NULL",
    "level TEXT NOT NULL CHECK (level IN ('debug','info','warn','error'))",
    "area TEXT NOT NULL", // coarse: "ipc", "notes", "import", "dialog"
    "channel TEXT", // the IPC channel or named action, when there is one
    "request_id TEXT", // the reference the user quotes — NOT a security token, it names a row
    "actor TEXT", // "renderer" / "main" / "boot" — stamped at the trust boundary, never self-reported
    "message TEXT NOT NULL", // the technical message; shown to a user only if it passes isUserFacing()
    "detail TEXT", // stack, error code, counts — NEVER a secret value
  ]);

  // NOTE FOLDERS — a real nested tree, ruled 08-11-2026. Notes previously had only a flat
  // `folder` TEXT column: one string, no nesting, no rename, nothing to click. That is why
  // importing a deep source tree collapsed 2,000 files into a single "Category".
  //
  // SEPARATE FROM vault_folders BY RULING, not by accident: "Financial" and "Photography" are
  // PASSWORD folders, and one tree holding both credentials and thousands of markdown files stops
  // being navigable. Same shape, same semantics, two trees.
  //
  // Soft parent reference, exactly like vault_folders: deleting a folder never deletes a note (the
  // note's folder_id stops resolving and it falls back to Unfiled), which is why neither side
  // carries a hard foreign key.
  createTable(db, "vault_note_folders", [
    "org_id TEXT NOT NULL",
    "name TEXT NOT NULL",
    "parent_id INTEGER", // NULL = top level
    "sort_order INTEGER NOT NULL DEFAULT 0",
  ]);
  // Guarded ALTER, AFTER its createTable (scan/db.ts precedent). The old text column is KEPT, not
  // dropped — dropping is banned, and it is the migration source below.
  if (!(db.pragma("table_info(vault_notes)") as { name: string }[]).some((c) => c.name === "folder_id")) {
    db.exec("ALTER TABLE vault_notes ADD COLUMN folder_id INTEGER;");
  }
  /**
   * WHERE A NOTE CAME FROM, and the guard that stops it arriving twice.
   *
   * Jason imported ~2,000 files and the folder read 4,178 — the same documents pulled in four or
   * five times over repeated import runs, because nothing recorded what had already been taken
   * (08-12-2026). Recording the source path makes "have I seen this file?" answerable.
   *
   * The PARTIAL UNIQUE INDEX is what actually makes it safe: NULL source_path is exempt, so notes
   * written in the app are unaffected and can share the absence freely, but two imports of the same
   * file cannot both exist. That is a guarantee from the database rather than a check the importer
   * has to remember to run — and importers are exactly the code that forgets.
   */
  if (!(db.pragma("table_info(vault_notes)") as { name: string }[]).some((c) => c.name === "source_path")) {
    db.exec("ALTER TABLE vault_notes ADD COLUMN source_path TEXT;");
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS vault_notes_source_uniq ON vault_notes (org_id, source_path) WHERE source_path IS NOT NULL;");

  migrateNoteFolders(db);

  // ---- indexes — one per hot query, IF NOT EXISTS so the ensure stays rerunnable. (Per-secret
  // ---- version lookups ride vault_secret_versions_uniq above — see its comment.)
  // audit surface: newest-first page over the whole log
  db.exec("CREATE INDEX IF NOT EXISTS idx_vault_access_log_ts ON vault_access_log (ts);");
  // the log viewer: newest-first page, and the level filter that rides on top of it
  db.exec("CREATE INDEX IF NOT EXISTS idx_vault_event_log_ts ON vault_event_log (ts);");
  // "the user quoted VLT-A3F91C" — the single lookup this whole design exists to make possible
  db.exec("CREATE INDEX IF NOT EXISTS idx_vault_event_log_request ON vault_event_log (request_id);");
  // per-secret audit trail: every ask about one locator
  db.exec("CREATE INDEX IF NOT EXISTS idx_vault_access_log_secret ON vault_access_log (secret_uuid);");
  // the folder browse: every secret in one folder
  db.exec("CREATE INDEX IF NOT EXISTS idx_vault_secrets_folder ON vault_secrets (folder_id);");
  // the folder tree: children of one node
  db.exec("CREATE INDEX IF NOT EXISTS idx_vault_folders_parent ON vault_folders (parent_id);");
  // the note tree: children of one node, and every note in one folder
  db.exec("CREATE INDEX IF NOT EXISTS idx_vault_note_folders_parent ON vault_note_folders (parent_id);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_vault_notes_folder ON vault_notes (folder_id);");
  // The list's ORDER BY. Measured 08-12-2026: this plus picking ids before touching any body takes
  // a 60-row page from 8.46 ms to 1.49 ms at 4,089 notes. A WIDER covering index was tried first and
  // made it WORSE (8 ms -> 17 ms) because `archived_at IS NULL` cannot use an equality seek and the
  // last ORDER BY term still needed a temp B-tree — recorded so it is not "optimised" back in.
  db.exec("CREATE INDEX IF NOT EXISTS idx_vault_notes_list ON vault_notes (org_id, pinned, updated_at);");
}


/**
 * ONE-TIME, IDEMPOTENT lift of the old flat `folder` text column into the real tree.
 *
 * Every distinct non-empty string becomes a TOP-LEVEL folder and its notes get the matching
 * folder_id. Runs on every ensure and does nothing after the first pass, because it only ever
 * touches rows where `folder IS NOT NULL AND folder_id IS NULL` — so a note later MOVED to a
 * different folder is never dragged back to where its old text said.
 *
 * THE TEXT COLUMN IS DELIBERATELY LEFT IN PLACE. Dropping a column is banned, and keeping it costs
 * nothing while making this migration re-runnable and auditable after the fact.
 */
function migrateNoteFolders(db: Db): void {
  const pending = db
    .prepare("SELECT DISTINCT org_id, folder FROM vault_notes WHERE folder IS NOT NULL AND TRIM(folder) <> '' AND folder_id IS NULL")
    .all() as { org_id: string; folder: string }[];
  if (pending.length === 0) return;
  const at = nowIso();
  db.transaction(() => {
    for (const row of pending) {
      const name = row.folder.trim().slice(0, 120);
      let existing = db
        .prepare("SELECT id FROM vault_note_folders WHERE org_id = ? AND parent_id IS NULL AND name = ?")
        .get(row.org_id, name) as { id: number } | undefined;
      if (!existing) {
        const info = db
          .prepare("INSERT INTO vault_note_folders (uuid, org_id, name, parent_id, sort_order, created_at) VALUES (?, ?, ?, NULL, 0, ?)")
          .run(crypto.randomUUID(), row.org_id, name, at);
        existing = { id: Number(info.lastInsertRowid) };
      }
      db.prepare("UPDATE vault_notes SET folder_id = ? WHERE org_id = ? AND folder = ? AND folder_id IS NULL")
        .run(existing.id, row.org_id, row.folder);
    }
  })();
  console.info(`[vault] note folders: lifted ${pending.length} legacy folder name(s) into the tree`);
}
