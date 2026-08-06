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
//
//              PHASE A (08-06-2026): entry METADATA (full name, username, url, notes, favourite,
//              folder) joins the list surfaces because none of it is a credential; backup codes and
//              security answers do NOT — they ride `extras` on the VERSION row, versioned with the
//              password as one atomic unit and reachable only through readSecret. The rule the file
//              is built around is unchanged and now covers three kinds of credential instead of one.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/vault/store.ts
//------------------------------------------------------------
import { generateUUIDv7 } from "../utils/uuidv7";
import { nowIso, type Db } from "./db";
import type {
  VaultAccessRow,
  VaultAction,
  VaultSecretExtras,
  VaultSecretInput,
  VaultSecretMeta,
  VaultSecretWithValue,
  VaultVersionRow,
} from "./types";

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
const MAX_NOTES = 4_000;

/** Optional presentation text. null and "" both mean "not set" — stored as NULL either way. */
function vOptional(value: unknown, label: string, maxLen: number): string | null {
  if (value == null || value === "") return null;
  return vText(value, label, maxLen);
}

/** Credential extras in, as JSON out. Shapes are checked here so no malformed blob reaches SQL,
    and the whole thing is capped — an unbounded JSON column is a denial-of-service in a text box. */
function vExtras(value: unknown): string | null {
  if (value == null) return null;
  const e = value as VaultSecretExtras;
  const codes = Array.isArray(e.backupCodes)
    ? e.backupCodes.filter((c): c is string => typeof c === "string" && c.trim() !== "").map((c) => c.slice(0, 200))
    : [];
  const questions = Array.isArray(e.securityQuestions)
    ? e.securityQuestions
        .filter((q) => q && typeof q.question === "string" && typeof q.answer === "string")
        .map((q) => ({ question: q.question.slice(0, 300), answer: q.answer.slice(0, 300) }))
    : [];
  if (codes.length === 0 && questions.length === 0) return null;
  const json = JSON.stringify({ backupCodes: codes, securityQuestions: questions });
  if (json.length > MAX_VALUE) throw new Error("Backup codes and security questions are too long to store.");
  return json;
}

/** Parses the stored blob back. A corrupt row returns null rather than throwing — a secret whose
    password reads fine must never be unreachable because its extras JSON went bad. */
function parseExtras(raw: unknown): VaultSecretExtras | null {
  if (typeof raw !== "string" || raw === "") return null;
  try {
    return JSON.parse(raw) as VaultSecretExtras;
  } catch {
    return null;
  }
}

// Explicit metadata column list — the ONE place it is written, so no meta query can drift into
// carrying a credential. Everything named here is presentation data (who the account belongs to,
// where it lives, what the user wrote about it); the password, backup codes and security answers
// are all on the version row and appear in exactly one query, below. `version` is DERIVED from the
// history's highest row (nothing stores it on the secret): a correlated MAX(version) that is a
// single descent on vault_secret_versions_uniq.
const META_COLS =
  "id, uuid, kind, label, full_name, username, url, notes, favourite, folder_id, " +
  "(SELECT MAX(v.version) FROM vault_secret_versions v WHERE v.secret_id = vault_secrets.id) AS version, " +
  "archived_at, archive_reason, created_at, updated_at";
// Newest access-log stamp per secret — the ledger's "Last read" column. Derived, never stored.
const LAST_READ =
  "(SELECT MAX(a.ts) FROM vault_access_log a WHERE a.secret_uuid = vault_secrets.uuid AND a.action = 'read' AND a.granted = 1) AS last_read_at";
// The current credential payload, same derivation path — used by readSecret ALONE; nothing else
// selects either column. `extras` rides the same row so one read returns one coherent version.
const CURRENT_VALUE =
  "(SELECT v.value FROM vault_secret_versions v WHERE v.secret_id = vault_secrets.id ORDER BY v.version DESC LIMIT 1) AS value, " +
  "(SELECT v.extras FROM vault_secret_versions v WHERE v.secret_id = vault_secrets.id ORDER BY v.version DESC LIMIT 1) AS extras";

// ---- access log — store.ts is the ONE writer by design. Exported so the lock and seed surfaces
// ---- can record their own actions without a second INSERT statement existing anywhere.
export function logAccess(
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
  const fullName = vOptional(input?.fullName, "full name", MAX_TAG);
  const username = vOptional(input?.username, "username", MAX_TAG);
  const url = vOptional(input?.url, "website", 500);
  const notes = vOptional(input?.notes, "notes", MAX_NOTES);
  const folderId = input?.folderId == null ? null : Number(input.folderId);
  const extras = vExtras(input?.extras);
  const rowid = db.transaction(() => {
    const res = db
      .prepare(
        `INSERT INTO vault_secrets (uuid, org_id, kind, label, full_name, username, url, notes, folder_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(uuid, orgId, kind, label, fullName, username, url, notes, folderId, at);
    db.prepare(
      `INSERT INTO vault_secret_versions (uuid, org_id, secret_id, version, value, extras, created_at)
       VALUES (?, ?, ?, 1, ?, ?, ?)`
    ).run(generateUUIDv7(), orgId, res.lastInsertRowid, value, extras, at);
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
    .prepare(
      `SELECT ${META_COLS}, ${LAST_READ} FROM vault_secrets WHERE org_id = ? ${where} ORDER BY label COLLATE NOCASE ASC`
    )
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
    .get(orgId, locator) as (VaultSecretWithValue & { extras: unknown }) | undefined;
  if (!row) {
    logAccess(db, orgId, "read", locator, null, who, false, "not found");
    throw new Error("Secret not found");
  }
  logAccess(db, orgId, "read", row.uuid, row.label, who, true);
  return { ...row, extras: parseExtras(row.extras) };
}

/** Supersede: version N+1 is APPENDED to the history and NOTHING ELSE is updated — no column on
    vault_secrets changes (there is none to change). The current-version read (MAX, single indexed
    descent) happens INSIDE the same transaction as the INSERT so no interleaving ask can mint the
    same N+1 twice; vault_secret_versions_uniq backstops even that. Version N is never touched, so
    every value ever stored remains recoverable. Refused for archived secrets (retirement is
    deliberate; a retired secret is frozen). */
export function supersedeSecret(
  db: Db,
  orgId: string,
  caller: string,
  uuid: unknown,
  newValue: unknown,
  newExtras?: unknown
): VaultSecretMeta {
  const who = vText(caller, "caller", MAX_TAG);
  const locator = vUuid(uuid);
  const value = vText(newValue, "value", MAX_VALUE);
  const extras = vExtras(newExtras);
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
      `INSERT INTO vault_secret_versions (uuid, org_id, secret_id, version, value, extras, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(generateUUIDv7(), orgId, row.id, cur.v + 1, value, extras, at);
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
  const why = reason == null ? null : vOptional(reason, "reason", 500);
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

/** Restores an archived secret. The mirror of archive, and deliberately never capped or refused —
    data access is never hostage to retirement (the restore-over-cap doctrine). */
export function restoreSecret(db: Db, orgId: string, caller: string, uuid: unknown): VaultSecretMeta {
  const who = vText(caller, "caller", MAX_TAG);
  const locator = vUuid(uuid);
  const row = db
    .prepare(`SELECT ${META_COLS} FROM vault_secrets WHERE org_id = ? AND uuid = ?`)
    .get(orgId, locator) as VaultSecretMeta | undefined;
  if (!row) {
    logAccess(db, orgId, "restore", locator, null, who, false, "not found");
    throw new Error("Secret not found");
  }
  if (!row.archived_at) return row;
  const at = nowIso();
  db.transaction(() => {
    db.prepare(`UPDATE vault_secrets SET archived_at = NULL, archive_reason = NULL, updated_at = ? WHERE id = ?`).run(
      at,
      row.id
    );
    logAccess(db, orgId, "restore", row.uuid, row.label, who, true);
  })();
  return metaByRowid(db, row.id);
}

/**
 * Edits the PRESENTATION fields — never the credential. Changing a label or a username is not a
 * new version of the password, so this deliberately does NOT touch the history: superseding is the
 * only way a credential ever changes, and keeping the two operations apart is what makes the
 * version number mean "how many times the secret itself changed".
 */
export function updateSecretMeta(db: Db, orgId: string, caller: string, uuid: unknown, input: unknown): VaultSecretMeta {
  const who = vText(caller, "caller", MAX_TAG);
  const locator = vUuid(uuid);
  const patch = (input ?? {}) as Partial<VaultSecretInput>;
  const row = db
    .prepare(`SELECT ${META_COLS} FROM vault_secrets WHERE org_id = ? AND uuid = ?`)
    .get(orgId, locator) as VaultSecretMeta | undefined;
  if (!row) {
    logAccess(db, orgId, "settings_change", locator, null, who, false, "not found");
    throw new Error("Secret not found");
  }
  const at = nowIso();
  db.prepare(
    `UPDATE vault_secrets SET kind = ?, label = ?, full_name = ?, username = ?, url = ?, notes = ?,
       folder_id = ?, updated_at = ? WHERE id = ?`
  ).run(
    patch.kind === undefined ? row.kind : vText(patch.kind, "kind", MAX_TAG),
    patch.label === undefined ? row.label : vText(patch.label, "label", MAX_TAG),
    patch.fullName === undefined ? row.full_name : vOptional(patch.fullName, "full name", MAX_TAG),
    patch.username === undefined ? row.username : vOptional(patch.username, "username", MAX_TAG),
    patch.url === undefined ? row.url : vOptional(patch.url, "website", 500),
    patch.notes === undefined ? row.notes : vOptional(patch.notes, "notes", MAX_NOTES),
    patch.folderId === undefined ? row.folder_id : patch.folderId == null ? null : Number(patch.folderId),
    at,
    row.id
  );
  return metaByRowid(db, row.id);
}

/** The favourites star. Its own tiny surface because it fires from a list row, not a form. */
export function setFavourite(db: Db, orgId: string, uuid: unknown, on: unknown): VaultSecretMeta {
  const locator = vUuid(uuid);
  const row = db.prepare("SELECT id FROM vault_secrets WHERE org_id = ? AND uuid = ?").get(orgId, locator) as
    | { id: number }
    | undefined;
  if (!row) throw new Error("Secret not found");
  db.prepare("UPDATE vault_secrets SET favourite = ?, updated_at = ? WHERE id = ?").run(on === true ? 1 : 0, nowIso(), row.id);
  return metaByRowid(db, row.id);
}

/**
 * The version history for one secret — NUMBERS AND TIMESTAMPS ONLY. This is deliberately not a
 * second way out for credentials: `has_extras` says whether backup codes rode along, never what
 * they were, and no `value` column appears in the SELECT at all. Reading an OLD version's value is
 * not offered by any surface; if it is ever wanted it must be its own explicitly logged read.
 */
export function listVersions(db: Db, orgId: string, uuid: unknown): VaultVersionRow[] {
  const locator = vUuid(uuid);
  const rows = db
    .prepare(
      `SELECT v.version, v.created_at, (v.extras IS NOT NULL) AS has_extras
         FROM vault_secret_versions v
         JOIN vault_secrets s ON s.id = v.secret_id
        WHERE s.org_id = ? AND s.uuid = ?
        ORDER BY v.version DESC`
    )
    .all(orgId, locator) as { version: number; created_at: string; has_extras: number }[];
  return rows.map((r) => ({ version: r.version, created_at: r.created_at, has_extras: r.has_extras === 1 }));
}

/** The audit surface. Safe by construction — the table has no value column to select. */
export function listAccessLog(db: Db, orgId: string, opts?: { limit?: number; secretUuid?: string }): VaultAccessRow[] {
  const limit = Math.min(Math.max(1, Math.floor(opts?.limit ?? 500)), 5000);
  if (opts?.secretUuid) {
    return db
      .prepare(
        `SELECT id, ts, action, secret_uuid, secret_label, caller, granted, detail
           FROM vault_access_log WHERE org_id = ? AND secret_uuid = ? ORDER BY id DESC LIMIT ?`
      )
      .all(orgId, opts.secretUuid, limit) as VaultAccessRow[];
  }
  return db
    .prepare(
      `SELECT id, ts, action, secret_uuid, secret_label, caller, granted, detail
         FROM vault_access_log WHERE org_id = ? ORDER BY id DESC LIMIT ?`
    )
    .all(orgId, limit) as VaultAccessRow[];
}

/**
 * MAIN-SIDE ONLY. Every current value, for the health analysis. This is the one function that
 * hands out the whole set, and it exists so the ANALYSIS can run beside the data instead of the
 * data travelling to the analysis: health.ts consumes it in-process and returns verdicts, and
 * nothing here is reachable from IPC. Do not export it through a channel, ever.
 */
export function readAllForAnalysis(db: Db, orgId: string): { uuid: string; label: string; username: string | null; value: string; created_at: string }[] {
  return db
    .prepare(
      `SELECT s.uuid, s.label, s.username,
              (SELECT v.value FROM vault_secret_versions v WHERE v.secret_id = s.id ORDER BY v.version DESC LIMIT 1) AS value,
              (SELECT v.created_at FROM vault_secret_versions v WHERE v.secret_id = s.id ORDER BY v.version DESC LIMIT 1) AS created_at
         FROM vault_secrets s
        WHERE s.org_id = ? AND s.archived_at IS NULL`
    )
    .all(orgId) as { uuid: string; label: string; username: string | null; value: string; created_at: string }[];
}
