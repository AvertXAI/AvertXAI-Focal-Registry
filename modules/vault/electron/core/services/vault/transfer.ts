// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Import and export — the two operations that move credentials across the vault's own
//              boundary, so they are written to be the most careful code in the module.
//
//              THE RULE THAT SHAPES THIS FILE: no exported value ever crosses IPC. The renderer
//              hands in a PATH and gets back a COUNT. Reading happens main-side (store.readAllForExport),
//              writing happens main-side, and the bridge never sees a password on the way out. The
//              health surface established the pattern — send the work to the data — and export is the
//              same shape with a file at the end instead of a verdict.
//
//              IMPORT IS TWO STEPS ON PURPOSE. preview() reads the header row and a few sample lines
//              so a human can say which column is which; commit() is the only thing that writes. A
//              one-shot "import this file" would guess, and guessing wrong writes 400 wrong rows into
//              an encrypted store where nobody will notice for a year.
//
//              NO CSV DEPENDENCY. RFC 4180 is a small format and the parser below is thirty lines —
//              cheaper than a licence review (§2.10) and it cannot pull a transitive tree.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/vault/transfer.ts
//------------------------------------------------------------
import crypto from "node:crypto";
import fs from "node:fs";
import { nowIso, type Db } from "./db";
import { createSecret, logAccess, readAllForExport } from "./store";

// ---------------------------------------------------------------- CSV, both directions

/** RFC 4180: a field containing a quote, comma, or newline is quoted and its quotes are doubled. */
function csvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Parses RFC 4180 including quoted fields with embedded commas and newlines. Written as a character
 * walk rather than a regex because a regex that handles embedded newlines correctly is unreadable,
 * and this is the code that decides whether someone's password survives the trip.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  // A BOM survives Excel round-trips and would otherwise become part of the first header name.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } // an escaped quote, not the end of the field
        else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(cell); cell = ""; continue; }
    if (c === "\r") continue; // CRLF and LF both end a record; \r is never data outside quotes
    if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    cell += c;
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  // A trailing newline leaves one empty record; a file of blank lines leaves several.
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

// ---------------------------------------------------------------- export

/** The column order an export writes AND an import expects, so a Focal Registry export round-trips
    through the mapping step without the user touching a single dropdown. */
const EXPORT_COLUMNS = [
  "label", "kind", "username", "password", "url", "notes",
  "folder", "favourite", "backup_codes", "security_questions", "version", "created_at",
] as const;

function extrasToColumns(raw: string | null): { codes: string; questions: string } {
  if (!raw) return { codes: "", questions: "" };
  try {
    const e = JSON.parse(raw) as { backupCodes?: string[]; securityQuestions?: { question: string; answer: string }[] };
    return {
      codes: (e.backupCodes ?? []).join("\n"),
      questions: (e.securityQuestions ?? []).map((q) => `${q.question} ${q.answer}`).join("\n"),
    };
  } catch {
    return { codes: "", questions: "" };
  }
}

/**
 * PLAIN CSV — every secret in the clear, which is why the screen that calls this is the most
 * reluctant one in the vault. The access-log row is written BEFORE the file, so an export that
 * crashes half-written is still an export that happened and still says so.
 */
export function exportCsv(db: Db, orgId: string, caller: string, filePath: unknown): { count: number; path: string } {
  const target = vPath(filePath);
  const rows = readAllForExport(db, orgId);
  logAccess(db, orgId, "export", null, null, caller, true, `plain CSV · ${rows.length} entries`);
  const lines = [EXPORT_COLUMNS.join(",")];
  for (const r of rows) {
    const { codes, questions } = extrasToColumns(r.extras);
    lines.push([
      r.label, r.kind, r.username ?? "", r.value ?? "", r.url ?? "", r.notes ?? "",
      r.folder_name ?? "", r.favourite === 1 ? "yes" : "", codes, questions, r.version, r.created_at,
    ].map(csvCell).join(","));
  }
  fs.writeFileSync(target, `${lines.join("\r\n")}\r\n`, "utf8");
  return { count: rows.length, path: target };
}

// ---------------------------------------------------------------- encrypted archive

const ARCHIVE_FORMAT = "avertxai-vault-archive";
const ARCHIVE_VERSION = 1;

/**
 * scrypt, not Argon2id, and deliberately: the vault's own key derivation is pinned to a CONSTANT
 * salt so it stays deterministic across boots (see crypto.ts). An archive is the opposite case — it
 * wants a fresh random salt every time — and scrypt is in the Node standard library, so this costs
 * no dependency at all (§2.10 never fires).
 */
function archiveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 });
}

/**
 * ENCRYPTED ARCHIVE — the one export that is still protected after it leaves. AES-256-GCM, so a
 * tampered file fails to open rather than opening wrong. The passphrase is the user's and is NOT the
 * vault's key: an archive tied to this machine's key would restore nowhere else, which is the one
 * thing a backup must never be.
 */
export function exportArchive(
  db: Db, orgId: string, caller: string, filePath: unknown, passphrase: unknown
): { count: number; path: string } {
  const target = vPath(filePath);
  const pass = vPassphrase(passphrase);
  const rows = readAllForExport(db, orgId);
  logAccess(db, orgId, "export", null, null, caller, true, `encrypted archive · ${rows.length} entries`);
  const payload = JSON.stringify({
    exported_at: nowIso(),
    entries: rows.map((r) => ({
      label: r.label, kind: r.kind, username: r.username, url: r.url, notes: r.notes,
      full_name: r.full_name, folder: r.folder_name, favourite: r.favourite,
      value: r.value, extras: r.extras, created_at: r.created_at,
    })),
  });
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", archiveKey(pass, salt), iv);
  const body = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  fs.writeFileSync(
    target,
    JSON.stringify({
      format: ARCHIVE_FORMAT, version: ARCHIVE_VERSION, kdf: "scrypt", cipher: "aes-256-gcm",
      salt: salt.toString("base64"), iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"), data: body.toString("base64"),
    }, null, 2),
    "utf8"
  );
  return { count: rows.length, path: target };
}

interface ArchiveEntry {
  label: string; kind?: string; username?: string | null; url?: string | null; notes?: string | null;
  full_name?: string | null; value: string; extras?: string | null;
}

/** Opens an archive. A wrong passphrase and a tampered file both land here as the SAME failure,
    because GCM cannot tell them apart — so the message says both rather than guessing one. */
function openArchive(filePath: string, passphrase: string): ArchiveEntry[] {
  let env: Record<string, string>;
  try {
    env = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, string>;
  } catch {
    throw new Error("That file is not a vault archive.");
  }
  if (env.format !== ARCHIVE_FORMAT) throw new Error("That file is not a vault archive.");
  if (Number(env.version) > ARCHIVE_VERSION) {
    throw new Error("That archive was written by a newer version of the vault than this one.");
  }
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      archiveKey(passphrase, Buffer.from(env.salt, "base64")),
      Buffer.from(env.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(env.tag, "base64"));
    const plain = Buffer.concat([decipher.update(Buffer.from(env.data, "base64")), decipher.final()]).toString("utf8");
    return (JSON.parse(plain) as { entries: ArchiveEntry[] }).entries ?? [];
  } catch {
    throw new Error("That passphrase does not open this archive — or the file has been altered since it was written.");
  }
}

// ---------------------------------------------------------------- import

export interface ImportPreview {
  headers: string[];
  /** First few DATA rows so a human can see what each column actually contains. */
  sample: string[][];
  total: number;
  /** Our best guess at the mapping, for the form to start from. -1 means "not found". */
  guess: ImportMapping;
}

export interface ImportMapping {
  label: number;
  value: number;
  username: number;
  url: number;
  notes: number;
}

// What the exporters of the world actually call these columns. Chrome, Firefox, 1Password,
// Bitwarden, LastPass, KeePass, Keeper, Dashlane and RoboForm are all in here — matched
// case-insensitively against the header row so the mapping form opens already filled in.
const HEADER_HINTS: [keyof ImportMapping, string[]][] = [
  ["label", ["name", "title", "account", "account name", "item name", "entry", "display name", "site name", "label"]],
  ["value", ["password", "pwd", "pass", "secret", "login_password", "value"]],
  ["username", ["username", "user name", "login", "login name", "login_username", "user", "email", "e-mail", "userid"]],
  ["url", ["url", "urls", "website", "web site", "site", "login_uri", "address", "link", "hostname"]],
  ["notes", ["notes", "note", "comments", "comment", "extra", "description", "memo"]],
];

function guessMapping(headers: string[]): ImportMapping {
  const lower = headers.map((h) => h.trim().toLowerCase());
  const find = (names: string[]): number => {
    for (const n of names) { const i = lower.indexOf(n); if (i !== -1) return i; }
    // Nothing matched exactly — fall back to a contains match, which catches "Login URL" and friends.
    for (const n of names) { const i = lower.findIndex((h) => h.includes(n)); if (i !== -1) return i; }
    return -1;
  };
  const out = { label: -1, value: -1, username: -1, url: -1, notes: -1 } as ImportMapping;
  for (const [field, names] of HEADER_HINTS) out[field] = find(names);
  return out;
}

/** Reads the file and describes it. WRITES NOTHING — that is the entire point of a separate step. */
export function importPreview(filePath: unknown): ImportPreview {
  const target = vPath(filePath);
  const rows = parseCsv(fs.readFileSync(target, "utf8"));
  if (rows.length === 0) throw new Error("That file has no rows in it.");
  const [headers, ...data] = rows;
  return { headers, sample: data.slice(0, 5), total: data.length, guess: guessMapping(headers) };
}

export interface ImportResult {
  created: number;
  skipped: number;
  /** Row number and the reason, so a partial import can be understood rather than just counted. */
  problems: { row: number; reason: string }[];
}

/**
 * THE write. Every row is its own createSecret so one bad row cannot take the others down with it —
 * a 400-row import that fails wholesale on row 7 is worse than one that imports 399 and tells you
 * about row 7. Rows missing a label or a value are SKIPPED, never invented: an entry with no
 * password is not a password entry.
 */
export function importCsv(
  db: Db, orgId: string, caller: string, filePath: unknown, mapping: unknown
): ImportResult {
  const target = vPath(filePath);
  const map = vMapping(mapping);
  const rows = parseCsv(fs.readFileSync(target, "utf8"));
  const data = rows.slice(1);
  const out: ImportResult = { created: 0, skipped: 0, problems: [] };
  const at = (row: string[], i: number): string => (i >= 0 && i < row.length ? row[i].trim() : "");

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const label = at(row, map.label);
    const value = at(row, map.value);
    if (!label || !value) {
      out.skipped++;
      out.problems.push({ row: i + 2, reason: !label ? "no name in the name column" : "no password in the password column" });
      continue;
    }
    try {
      createSecret(db, orgId, caller, {
        kind: "login", label,
        value,
        username: at(row, map.username) || null,
        url: at(row, map.url) || null,
        notes: at(row, map.notes) || null,
      });
      out.created++;
    } catch (e) {
      out.skipped++;
      // The message may quote a field length but never a value — createSecret's validators are
      // written that way, and this is the one place that would leak it if they were not.
      out.problems.push({ row: i + 2, reason: e instanceof Error ? e.message : "could not be stored" });
    }
  }
  logAccess(db, orgId, "import", null, null, caller, true, `CSV · ${out.created} created, ${out.skipped} skipped`);
  return out;
}

/** Restores an encrypted archive. Same per-row isolation as the CSV path, same refusal to invent. */
export function importArchive(
  db: Db, orgId: string, caller: string, filePath: unknown, passphrase: unknown
): ImportResult {
  const entries = openArchive(vPath(filePath), vPassphrase(passphrase));
  const out: ImportResult = { created: 0, skipped: 0, problems: [] };
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e?.label || !e?.value) {
      out.skipped++;
      out.problems.push({ row: i + 1, reason: "the archive row has no name or no value" });
      continue;
    }
    try {
      createSecret(db, orgId, caller, {
        kind: e.kind || "login", label: e.label, value: e.value,
        fullName: e.full_name ?? null, username: e.username ?? null,
        url: e.url ?? null, notes: e.notes ?? null,
        extras: e.extras ? (JSON.parse(e.extras) as never) : null,
      });
      out.created++;
    } catch (err) {
      out.skipped++;
      out.problems.push({ row: i + 1, reason: err instanceof Error ? err.message : "could not be stored" });
    }
  }
  logAccess(db, orgId, "import", null, null, caller, true, `archive · ${out.created} created, ${out.skipped} skipped`);
  return out;
}

// ---------------------------------------------------------------- validators (module-local, as everywhere else here)

/** A path arrives from a main-side dialog, never typed by the page — but it still crosses IPC, so
    it is checked rather than trusted. */
function vPath(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error("No file was chosen.");
  return value;
}

function vPassphrase(value: unknown): string {
  if (typeof value !== "string" || value.length < 8) {
    throw new Error("An archive passphrase must be at least 8 characters — it is the only thing protecting the file.");
  }
  return value;
}

function vMapping(value: unknown): ImportMapping {
  const m = (value ?? {}) as Partial<Record<keyof ImportMapping, unknown>>;
  const num = (v: unknown): number => (Number.isInteger(v) && Number(v) >= 0 ? Number(v) : -1);
  const out: ImportMapping = {
    label: num(m.label), value: num(m.value), username: num(m.username), url: num(m.url), notes: num(m.notes),
  };
  if (out.label < 0 || out.value < 0) {
    throw new Error("The name column and the password column both have to be chosen before anything can be imported.");
  }
  return out;
}
