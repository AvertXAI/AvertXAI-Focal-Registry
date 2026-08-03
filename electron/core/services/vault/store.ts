// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Vault secrets service — create, list (METADATA ONLY), read-one-by-locator, supersede,
//              soft-archive. Electron-free; takes (db, orgId, …) with the vault connection handed in.
//              A value lives in EXACTLY ONE place — the append-only vault_secret_versions history
//              (mirror ruled OUT 08-01-2026): reads resolve the highest version, supersede appends
//              version N+1 and updates nothing else, and the derived version number can never drift.
//              THE HARD RULES, enforced here by construction: a value leaves this file through
//              readSecret and nowhere else — every other query names its columns explicitly and no
//              query in this file is SELECT * (the employees services use SELECT *; on the history
//              table that idiom would leak values, so it is banned here). Every ask that could
//              yield a value writes a vault_access_log row FIRST, misses and refusals included; no
//              value and no value fragment ever enters the log, an error message, or a console line.
//              Validators are module-local (employees doctrine) but THROW on oversize instead of
//              slicing — silent truncation would corrupt a stored secret.
//              NAMED store.ts, NOT secrets.ts: the repo .gitignore carries a `*secret*` guard for
//              credential material, and a source file matching it would be silently untrackable.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/vault/store.ts
//------------------------------------------------------------
import { generateUUIDv7 } from "../utils/uuidv7";
import { nowIso, type Db } from "./db";
import type { VaultAction, VaultSecretInput, VaultSecretMeta, VaultSecretWithValue } from "./types";

// ---- validators — local, throw-on-oversize (never slice: a truncated secret is a corrupted one,
// ---- and a truncated kind/label/locator is a different ask than the caller made).
function vText(value: unknown, label: string, maxLen: number): string {
  if (typeof value !== "string") throw new Error(`Invalid ${label}`);
  if (value.length > maxLen) throw new Error(`${label} too long (max ${maxLen} characters)`);
  if (value.trim() === "") throw new Error(`${label} is required`);
  return value;
}

/** Public locator — the std uuid column, as the adjustments surfaces validate theirs. */
function vUuid(value: unknown, label = "secret locator"): string {
  if (typeof value !== "string" || !/^[0-9a-fA-F-]{36}$/.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}

// 64 KiB covers private keys and certificate chains with slack; kind/label/caller are short tags.
const MAX_VALUE = 65_536;
const MAX_TAG = 200;

// Explicit metadata column list — the ONE place it is written, so no meta query can drift into
// carrying a value. `version` is DERIVED from the history's highest row (nothing stores it on the
// secret): a correlated MAX(version) that is a single descent on vault_secret_versions_uniq.
const META_COLS =
  "id, uuid, kind, label, " +
  "(SELECT MAX(v.version) FROM vault_secret_versions v WHERE v.secret_id = vault_secrets.id) AS version, " +
  "archived_at, archive_reason, created_at, updated_at";
// The current value, same derivation path — used by readSecret ALONE; nothing else selects it.
const CURRENT_VALUE =
  "(SELECT v.value FROM vault_secret_versions v WHERE v.secret_id = vault_secrets.id ORDER BY v.version DESC LIMIT 1) AS value";

// ---- access log — module-private writer; store.ts is the only writer by design.
function logAccess(
  db: Db,
  orgId: string,
  action: VaultAction,
  secretUuid: string | null,
  secretLabel: string | null,
  caller: string,
  granted: boolean,
  detail: string | null = null
): void {
  const at = nowIso();
  db.prepare(
    `INSERT INTO vault_access_log (uuid, org_id, ts, action, secret_uuid, secret_label, caller, granted, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(generateUUIDv7(), orgId, at, action, secretUuid, secretLabel, caller, granted ? 1 : 0, detail, at);
}

function metaByRowid(db: Db, rowid: number | bigint): VaultSecretMeta {
  return db.prepare(`SELECT ${META_COLS} FROM vault_secrets WHERE id = ?`).get(rowid) as VaultSecretMeta;
}

/** Creates the secret's identity row AND its version-1 history row in one transaction — the value
    goes into the HISTORY alone, its only home. Returns metadata only — the caller already holds
    the value it just handed in; echoing it back would put a value on a return path that doesn't
    need one. */
export function createSecret(db: Db, orgId: string, caller: string, input: VaultSecretInput): VaultSecretMeta {
  const who = vText(caller, "caller", MAX_TAG);
  const kind = vText(input?.kind, "kind", MAX_TAG);
  const label = vText(input?.label, "label", MAX_TAG);
  const value = vText(input?.value, "value", MAX_VALUE);
  const at = nowIso();
  const uuid = generateUUIDv7();
  const rowid = db.transaction(() => {
    const res = db
      .prepare(
        `INSERT INTO vault_secrets (uuid, org_id, kind, label, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(uuid, orgId, kind, label, at);
    db.prepare(
      `INSERT INTO vault_secret_versions (uuid, org_id, secret_id, version, value, created_at)
       VALUES (?, ?, ?, 1, ?, ?)`
    ).run(generateUUIDv7(), orgId, res.lastInsertRowid, value, at);
    logAccess(db, orgId, "create", uuid, label, who, true);
    return res.lastInsertRowid;
  })();
  return metaByRowid(db, rowid);
}

/** METADATA ONLY — never selects value, never SELECT *. Active secrets by default; archived rows
    appear only when explicitly asked for. Not access-logged: no value is reachable through it. */
export function listSecrets(db: Db, orgId: string, includeArchived = false): VaultSecretMeta[] {
  const where = includeArchived ? "" : "AND archived_at IS NULL";
  return db
    .prepare(`SELECT ${META_COLS} FROM vault_secrets WHERE org_id = ? ${where} ORDER BY label COLLATE NOCASE ASC`)
    .all(orgId) as VaultSecretMeta[];
}

/** THE one value-bearing read — the value resolves from the HIGHEST version in the history (a
    single indexed descent on vault_secret_versions_uniq), never from the secret row, which stores
    none. Logs every ask — hit or miss — before the value is returned; an org-mismatched locator
    behaves exactly like a missing one. Archived secrets remain readable: data access is never
    hostage to retirement (the restore-over-cap doctrine), archive only hides a secret from the
    default list. */
export function readSecret(db: Db, orgId: string, caller: string, uuid: unknown): VaultSecretWithValue {
  const who = vText(caller, "caller", MAX_TAG);
  const locator = vUuid(uuid);
  const row = db
    .prepare(`SELECT ${META_COLS}, ${CURRENT_VALUE} FROM vault_secrets WHERE org_id = ? AND uuid = ?`)
    .get(orgId, locator) as VaultSecretWithValue | undefined;
  if (!row) {
    logAccess(db, orgId, "read", locator, null, who, false, "not found");
    throw new Error("Secret not found");
  }
  logAccess(db, orgId, "read", row.uuid, row.label, who, true);
  return row;
}

/** Supersede: version N+1 is APPENDED to the history and NOTHING ELSE is updated — no column on
    vault_secrets changes (there is none to change). The current-version read (MAX, single indexed
    descent) happens INSIDE the same transaction as the INSERT so no interleaving ask can mint the
    same N+1 twice; vault_secret_versions_uniq backstops even that. Version N is never touched, so
    every value ever stored remains recoverable. Refused for archived secrets (retirement is
    deliberate; a retired secret is frozen). */
export function supersedeSecret(db: Db, orgId: string, caller: string, uuid: unknown, newValue: unknown): VaultSecretMeta {
  const who = vText(caller, "caller", MAX_TAG);
  const locator = vUuid(uuid);
  const value = vText(newValue, "value", MAX_VALUE);
  const row = db
    .prepare(`SELECT ${META_COLS} FROM vault_secrets WHERE org_id = ? AND uuid = ?`)
    .get(orgId, locator) as VaultSecretMeta | undefined;
  if (!row) {
    logAccess(db, orgId, "supersede", locator, null, who, false, "not found");
    throw new Error("Secret not found");
  }
  if (row.archived_at) {
    logAccess(db, orgId, "supersede", row.uuid, row.label, who, false, "archived");
    throw new Error("Secret is archived — an archived secret cannot be superseded");
  }
  const at = nowIso();
  db.transaction(() => {
    const cur = db
      .prepare(`SELECT MAX(version) AS v FROM vault_secret_versions WHERE secret_id = ?`)
      .get(row.id) as { v: number };
    db.prepare(
      `INSERT INTO vault_secret_versions (uuid, org_id, secret_id, version, value, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(generateUUIDv7(), orgId, row.id, cur.v + 1, value, at);
    logAccess(db, orgId, "supersede", row.uuid, row.label, who, true);
  })();
  return metaByRowid(db, row.id);
}

/** Soft archive — hides the secret from the default list; the value and its whole history stay.
    Already-archived is an idempotent no-op (archivePerson precedent), not an error. */
export function archiveSecret(db: Db, orgId: string, caller: string, uuid: unknown, reason: unknown): VaultSecretMeta {
  const who = vText(caller, "caller", MAX_TAG);
  const locator = vUuid(uuid);
  const row = db
    .prepare(`SELECT ${META_COLS} FROM vault_secrets WHERE org_id = ? AND uuid = ?`)
    .get(orgId, locator) as VaultSecretMeta | undefined;
  if (!row) {
    logAccess(db, orgId, "archive", locator, null, who, false, "not found");
    throw new Error("Secret not found");
  }
  if (row.archived_at) return row;
  const at = nowIso();
  const why = reason == null ? null : vText(reason, "reason", 500);
  db.transaction(() => {
    db.prepare(`UPDATE vault_secrets SET archived_at = ?, archive_reason = ?, updated_at = ? WHERE id = ?`).run(
      at,
      why,
      at,
      row.id
    );
    logAccess(db, orgId, "archive", row.uuid, row.label, who, true, why);
  })();
  return metaByRowid(db, row.id);
}
