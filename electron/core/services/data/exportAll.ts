// Focal Registry — Export all data.
// Description: writes every database out as plain files another app can read: a folder per module,
//              a .jsonl file per table, pictures as picture files, a manifest and a read-me.
//              No Electron import: the caller hands over the handles that are already open, so
//              this runs headless against fake databases in the tests.
// File: electron/core/services/data/exportAll.ts
import type Database from "better-sqlite3-multiple-ciphers";
import fs from "node:fs";
import path from "node:path";
import { isEncryptedTax, maskTax, type TaxCrypto } from "../employees/taxCrypto";

type Db = Database.Database;
type Reader = Database.Statement<unknown[], unknown[]>;

export interface ExportSource {
  /** The handle the app already holds. Nothing is opened here. */
  db: Db;
  /** The database's file name on disk, so the manifest can say where each table came from. */
  file: string;
  /** The folder a table's rows go to: one module for the whole file, or a rule per table. */
  module: string | ((table: string) => string);
  /** True for a store the app keeps encrypted on disk and that goes out readable. */
  encrypted?: boolean;
}

export interface VaultSource {
  db: Db;
  file: string;
  /** The key file beside the Vault's database. It is copied next to the encrypted copy, never read. */
  keyEnvelope: string;
}

export interface ExportProgress {
  table: string;
  /** The table being written, counted from 1. */
  done: number;
  total: number;
}

export interface ExportPlan {
  sources: ExportSource[];
  /** Null when no Vault is open on this install. */
  vault: VaultSource | null;
  /** True writes the Vault as plain text. The caller has already checked that it is unlocked. */
  includeVault: boolean;
  /** True writes employee tax numbers in full. Left out or false, each one goes out masked. */
  includeTaxNumbers?: boolean;
  /** Reads the tax numbers the app keeps encrypted. Null or left out when this install's key could
      not be had: a number that needs it then goes out as a sentence saying so. */
  taxCrypto?: TaxCrypto | null;
  /** The folder he picked. The export makes its own folder inside it. */
  destination: string;
  appVersion: string;
  /** Plain sentences about anything the caller could not hand over, for the manifest and read-me.
      The export adds its own to this same list, so the caller reads them back after the run. */
  notes?: string[];
  shouldStop?: () => boolean;
  onProgress?: (progress: ExportProgress) => void;
  now?: Date;
}

export type ExportResult =
  | { ok: true; path: string; tables: number; rows: number }
  | { ok: false; error: string; path?: string };

interface FoundTable {
  name: string;
  sql: string | null;
  /** SQLite's own word for it: "table", "virtual" or "shadow". */
  kind: string;
  withoutRowid: boolean;
}

interface ManifestTable {
  name: string;
  module: string;
  file: string;
  rows: number;
  columns: string[];
  sql: string | null;
}

interface ManifestDatabase {
  file: string;
  encryptedInApp: boolean;
  userVersion: number;
  schemaVersion: null;
  schemaVersionNote: string;
  modules: string[];
  tables: ManifestTable[];
  skipped: Array<{ name: string; reason: string }>;
  otherSchema: Array<{ type: string; name: string; table: string; sql: string }>;
}

interface ManifestVault {
  included: boolean;
  note: string;
  encryptedCopy?: string;
  keyEnvelope?: string | null;
}

interface ManifestTax {
  /** True when the numbers were written in full. */
  included: boolean;
  note: string;
  unreadable: number;
}

const INCOMPLETE = " (incomplete)";
const VAULT = "vault";

// One burst is one stretch of reading without letting the rest of the app run. Small enough that
// the window keeps answering; the byte cap is for tables that hold pictures or long notes.
const BURST_ROWS = 2000;
const BURST_BYTES = 8 * 1024 * 1024;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

// The device row identifies this computer. The comment where the table is made says it is "never
// included in any report, export, or error payload", and canon keeps it "LOCAL ONLY", so it stays
// behind. Emptying this set is the whole change if that is ever ruled otherwise.
const LOCAL_ONLY = new Set(["device_provenance"]);

const SHARED_PREFIXES: Array<[prefix: string, module: string]> = [
  ["scan_", "scan"],
  ["rename_", "rename"],
  ["migrate_", "migrate"],
  ["timetracker_", "timetracker"],
  ["employee_", "employees"],
];

/** The shared database holds several modules' tables. A table's prefix says whose it is. */
export function sharedModuleOf(table: string): string {
  return SHARED_PREFIXES.find(([prefix]) => table.startsWith(prefix))?.[1] ?? "shell";
}

/** Local time, because he reads it in a folder list: "FocalRegistry-Export-2026-11-13 0407". */
export function exportFolderName(at: Date): string {
  const two = (n: number): string => String(n).padStart(2, "0");
  const day = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`;
  return `FocalRegistry-Export-${day} ${two(at.getHours())}${two(at.getMinutes())}`;
}

const FOLDERS: Record<string, string> = {
  registry: "Which organisation this install opens.",
  shell: "App settings, the module list and Scout Viewer targets.",
  scan: "Scan and Scan Notes: drives, runs, folders, files, errors, notes and folder renames.",
  rename: "Rename: batches, the folders and files in them, and presets.",
  migrate: "Migrate: jobs, the items they found, and bundles.",
  timetracker: "TimeTracker: clients, projects, time entries, payments, costs, notes and logs.",
  employees: "Employees: people, entries, tasks, payments, adjustments and sessions.",
  mindmerge: "MindMerge: documents, folders, imported files and tags. Pictures are in mindmerge/attachments.",
  vault: "The Secured Vault. See THE SECURED VAULT below.",
};

const ROW_FORMAT = {
  file: "One .jsonl file per table: one row per line, a JSON object, UTF-8, keys in column order.",
  null: "An empty value (SQL NULL).",
  $int: 'A whole number too large for a JSON number, written out in full: {"$int":"9007199254740993"}.',
  $real: 'An infinite number: {"$real":"Infinity"} or {"$real":"-Infinity"}.',
  $file:
    'Binary data, such as a picture: {"$file":"mindmerge/attachments/<id>.png"}. The bytes are in that file. The path starts at the export folder and uses forward slashes.',
};

const NO_SCHEMA_VERSION =
  "Focal Registry keeps no schema version in its databases. userVersion is SQLite's PRAGMA user_version; each table's sql is the statement that rebuilds its shape.";

const VAULT_PLAIN =
  "The Secured Vault is in this export as plain text, in the vault folder. Anyone who has this folder can read every password in it.";
const VAULT_ENCRYPTED =
  "The Secured Vault was not written as plain text. Its encrypted file was copied as it is, with its key file. That pair opens only in Focal Registry, under the same Windows user account, on the same PC. To take the passwords to another app, unlock the Vault and export again with the Vault box ticked.";
const VAULT_ENCRYPTED_NO_KEY =
  "The Secured Vault was not written as plain text. Its encrypted file was copied as it is, but its key file was not found, so this copy cannot be opened.";
const NO_VAULT = "No Secured Vault was open on this install, so nothing of it is here.";

// Employee tax numbers are the one value that does not go out as it is stored, so the table and
// column that hold them are named here and nowhere else.
const TAX_TABLE = "employee_people";
const TAX_COLUMN = "ssn";
const TAX_WHERE = `the ${TAX_COLUMN} column of employees/${TAX_TABLE}.jsonl`;
const TAX_MASKED = `Employee tax numbers are masked in this export: ${TAX_WHERE} shows only the last four digits of each one. To write them in full, export again with the "Include full tax numbers" box ticked.`;
const TAX_FULL = `Employee tax numbers are in this export in full, as plain text, in ${TAX_WHERE}. Anyone who has this folder can read them.`;
const TAX_UNREADABLE = "This tax number could not be read on this PC, so it is not in this export.";

const ALWAYS_LEFT_OUT = [
  "Files the app keeps outside its databases. They are ordinary files and are still where the app put them, under the records folder chosen in Settings, Storage, and under Documents\\Focal Registry: TimeTracker contract files and custom alert sounds, Scan reports, exported PDF, CSV and spreadsheet files, and the Scan Notes folder with its thumbnail cache. A row that points at such a file holds its path.",
  "Things only this install can use: Scout Viewer sign-ins, your spell-check words, feedback reports that were not sent yet, and downloaded brand artwork.",
  "Your photos and videos. The app only ever reads them.",
];

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/x-icon": "ico",
};

class Stopped extends Error {}

const pause = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const fileSafe = (name: string): string => name.replace(/[^0-9A-Za-z_.-]/g, "_");

/** Never reuses a name: a second export in the same minute gets " (2)". Nothing is ever replaced. */
function freeName(parent: string, base: string): string {
  for (let n = 1; ; n += 1) {
    const name = n === 1 ? base : `${base} (${n})`;
    if (!fs.existsSync(path.join(parent, name)) && !fs.existsSync(path.join(parent, name + INCOMPLETE))) return name;
  }
}

function tablesOf(db: Db): FoundTable[] {
  // sqlite_master names the tables. table_list adds what a name cannot tell: which ones SQLite
  // keeps for itself behind a search index, and which have no rowid to page by.
  const listed = new Map(
    (db.pragma("table_list") as Array<{ schema: string; name: string; type: string; wr: number }>)
      .filter((t) => t.schema === "main")
      .map((t) => [t.name, t] as const)
  );
  const rows = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{
    name: string;
    sql: string | null;
  }>;
  return rows
    .filter((t) => !t.name.startsWith("sqlite_"))
    .map((t) => ({
      name: t.name,
      sql: t.sql,
      kind: listed.get(t.name)?.type ?? "table",
      withoutRowid: listed.get(t.name)?.wr === 1,
    }));
}

function skipReason(table: FoundTable): string | null {
  if (table.kind === "virtual") return "A search index. It is rebuilt from the table it indexes.";
  if (table.kind === "shadow") return "Storage SQLite keeps for a search index. It is rebuilt with the index.";
  if (LOCAL_ONLY.has(table.name)) return "It identifies this computer, and the app's standing rule keeps it out of every export.";
  return null;
}

function describeDatabase(source: ExportSource): ManifestDatabase {
  return {
    file: source.file,
    encryptedInApp: source.encrypted === true,
    userVersion: source.db.pragma("user_version", { simple: true }) as number,
    schemaVersion: null,
    schemaVersionNote: NO_SCHEMA_VERSION,
    modules: [],
    tables: [],
    skipped: [],
    // Indexes, triggers and views: a unique index is a rule the new app has to keep too.
    otherSchema: source.db
      .prepare(
        `SELECT type, name, tbl_name AS "table", sql FROM sqlite_master
         WHERE type != 'table' AND sql IS NOT NULL ORDER BY type, name`
      )
      .all() as ManifestDatabase["otherSchema"],
  };
}

function encode(value: unknown): string {
  if (typeof value === "bigint") {
    // Most readers hold a JSON number as a double. Past 2^53 it would come back as another number.
    return value >= -MAX_SAFE && value <= MAX_SAFE ? value.toString() : `{"$int":"${value}"}`;
  }
  // JSON has no word for infinity and would silently write null.
  if (typeof value === "number" && !Number.isFinite(value)) return `{"$real":"${value}"}`;
  return JSON.stringify(value);
}

/** A picture is named by its row's id, so "mindmerge://<id>" in a document finds its file. */
function blobName(column: string, uuid: unknown, mime: unknown, ordinal: number): string {
  const stem = typeof uuid === "string" && /^[0-9A-Za-z-]{1,64}$/.test(uuid) ? uuid : `row-${ordinal}`;
  const ext = EXT_BY_MIME[typeof mime === "string" ? mime.toLowerCase() : ""] ?? "bin";
  // Every binary column in the app is called "bytes". Any other column says which one it is.
  return `${stem}${column === "bytes" ? "" : `.${fileSafe(column)}`}.${ext}`;
}

/** What one stored tax number goes out as. Null when the app keeps it encrypted and it cannot be read here. */
function taxOut(stored: string, crypto: TaxCrypto | null, full: boolean): string | null {
  let plain = stored;
  if (isEncryptedTax(stored)) {
    try {
      plain = crypto ? crypto.decrypt(stored) : "";
    } catch {
      // The caller counts it and the export says so: one unreadable number must not lose the rest.
      plain = "";
    }
    // Never the stored ciphertext, and never an empty cell that would read as "no number on file".
    if (plain === "") return null;
  }
  return full ? plain : maskTax(plain);
}

async function writeTable(
  db: Db,
  table: FoundTable,
  work: string,
  module: string,
  tax: (stored: string) => string
): Promise<{ file: string; rows: number; columns: string[] }> {
  const quoted = `"${table.name.replace(/"/g, '""')}"`;
  const read = (sql: string): Reader => db.prepare<unknown[], unknown[]>(sql).safeIntegers(true).raw(true);
  const columns = read(`SELECT * FROM ${quoted}`).columns().map((c) => c.name);
  // Read a stretch, let the app run, carry on after the last rowid. No cursor stays open in
  // between: the timers write through this same connection every second, and an open cursor would
  // refuse them. A table with no rowid, or with a column named "rowid", is read in one stretch.
  const paged = !table.withoutRowid && !columns.some((c) => c.toLowerCase() === "rowid");
  const first = read(paged ? `SELECT rowid, * FROM ${quoted} ORDER BY rowid` : `SELECT * FROM ${quoted}`);
  const next = paged ? read(`SELECT rowid, * FROM ${quoted} WHERE rowid > ? ORDER BY rowid`) : null;
  const lead = paged ? 1 : 0;
  const keys = columns.map((c) => `${JSON.stringify(c)}:`);
  const uuidAt = columns.indexOf("uuid");
  const mimeAt = columns.indexOf("mime");
  const taxAt = table.name === TAX_TABLE ? columns.indexOf(TAX_COLUMN) : -1;
  // "mindmerge_attachments" in the mindmerge folder puts its pictures in mindmerge/attachments.
  const ownName = table.name.startsWith(`${module}_`) ? table.name.slice(module.length + 1) : table.name;
  const blobFolder = `${module}/${fileSafe(ownName)}`;
  let blobFolderMade = false;

  const file = `${module}/${fileSafe(table.name)}.jsonl`;
  fs.mkdirSync(path.join(work, module), { recursive: true });
  const fd = fs.openSync(path.join(work, file), "wx");
  let rows = 0;
  let last: unknown = null;
  let lines: string[] = [];
  let weight = 0;
  const flush = (): void => {
    fs.writeSync(fd, lines.join(""));
    lines = [];
    weight = 0;
  };
  const saveBlob = (bytes: Buffer, column: string, row: unknown[]): string => {
    if (!blobFolderMade) {
      fs.mkdirSync(path.join(work, blobFolder), { recursive: true });
      blobFolderMade = true;
    }
    const mime = mimeAt < 0 ? null : row[mimeAt + lead];
    let rel = `${blobFolder}/${blobName(column, uuidAt < 0 ? null : row[uuidAt + lead], mime, rows)}`;
    // Two ids that differ only in letter case are one file name on Windows: the second goes by its row.
    if (fs.existsSync(path.join(work, rel))) rel = `${blobFolder}/${blobName(column, null, mime, rows)}`;
    fs.writeFileSync(path.join(work, rel), bytes, { flag: "wx" });
    weight += bytes.length;
    return rel;
  };
  try {
    for (;;) {
      let more = false;
      for (const row of last === null || !next ? first.iterate() : next.iterate(last)) {
        rows += 1;
        if (paged) last = row[0];
        const cells = keys.map((key, i) => {
          const held = row[i + lead];
          const value = i === taxAt && typeof held === "string" && held !== "" ? tax(held) : held;
          return key + (Buffer.isBuffer(value) ? `{"$file":${JSON.stringify(saveBlob(value, columns[i], row))}}` : encode(value));
        });
        const line = `{${cells.join(",")}}\n`;
        lines.push(line);
        weight += line.length;
        if (lines.length >= BURST_ROWS || weight >= BURST_BYTES) {
          flush();
          // Only a paged read can stop here and carry on after this row.
          if (paged) {
            more = true;
            break;
          }
        }
      }
      flush();
      if (!more) break;
      await pause();
    }
  } finally {
    fs.closeSync(fd);
  }
  return { file, rows, columns };
}

function copyVaultEncrypted(vault: VaultSource, work: string): ManifestVault {
  fs.mkdirSync(path.join(work, VAULT), { recursive: true });
  const copy = `${VAULT}/${vault.file}`;
  // VACUUM INTO through the live handle, not a file copy: recent writes still sit in the
  // write-ahead log beside the file, and SQLite's own copy is whole and keeps the cipher and key.
  vault.db.exec(`VACUUM INTO '${path.join(work, copy).replace(/'/g, "''")}'`);
  if (!fs.existsSync(vault.keyEnvelope)) {
    return { included: false, note: VAULT_ENCRYPTED_NO_KEY, encryptedCopy: copy, keyEnvelope: null };
  }
  const keyCopy = `${VAULT}/${path.basename(vault.keyEnvelope)}`;
  fs.copyFileSync(vault.keyEnvelope, path.join(work, keyCopy), fs.constants.COPYFILE_EXCL);
  return { included: false, note: VAULT_ENCRYPTED, encryptedCopy: copy, keyEnvelope: keyCopy };
}

function readMe(
  appVersion: string,
  at: Date,
  databases: ManifestDatabase[],
  vault: ManifestVault,
  tax: ManifestTax,
  notes: string[]
): string {
  const folders = new Set(databases.flatMap((d) => d.modules));
  if (vault.encryptedCopy) folders.add(VAULT);
  const lines = [
    "FOCAL REGISTRY EXPORT",
    `Made ${at.toLocaleString()} by Focal Registry ${appVersion}.`,
    "",
    "Everything the app keeps in its databases, written as plain files so that another app can read it.",
    "Apart from an encrypted Vault file (see below), nothing here needs Focal Registry to open.",
    "",
    "THIS FOLDER IS NOT ENCRYPTED. Anyone who has it can read your settings and licence key, your notes,",
    "and the details of your clients and employees. For their tax numbers, see EMPLOYEE TAX NUMBERS below.",
    "Keep it somewhere private.",
    "",
    "FOLDERS",
    ...[...folders].sort().map((folder) => `  ${folder.padEnd(13)}${FOLDERS[folder] ?? "Tables that belong to no named module."}`),
    "",
    "HOW TO READ IT",
    "  manifest.json lists every database, its tables, their columns, how many rows each holds, and the",
    "  SQL statement that rebuilds each table.",
    "  Each table is one .jsonl file: one row per line, written as a JSON object, in UTF-8.",
    "  Text is a string, a number is a number, an empty value is null. Three values are written specially:",
    '    {"$int":"9007199254740993"}  a whole number too large for a JSON number, written out in full',
    '    {"$real":"Infinity"}         an infinite number (or "-Infinity")',
    '    {"$file":"mindmerge/attachments/<id>.png"}  binary data, such as a picture: the bytes are in',
    "                                 that file. The path starts at this folder and uses forward slashes.",
    "  A MindMerge document names a picture as mindmerge://<id>. That picture is the file",
    "  mindmerge/attachments/<id> with its type as the ending (.png, .jpg and so on). The app keeps these",
    "  pictures encrypted; here they are ordinary picture files.",
    "",
    "THE SECURED VAULT",
    `  ${vault.note}`,
    ...(vault.encryptedCopy ? [`  Encrypted file: ${vault.encryptedCopy}`, `  Key file: ${vault.keyEnvelope ?? "not found"}`] : []),
    "",
    "EMPLOYEE TAX NUMBERS",
    `  ${tax.note}`,
    "  An employee with no tax number on file has an empty value there. A number the app could not read",
    `  on this PC has this sentence in its place: ${TAX_UNREADABLE}`,
    "",
    "LEFT OUT OF THIS EXPORT",
    ...databases.flatMap((d) => d.skipped.map((s) => `  - The table ${s.name} (${d.file}). ${s.reason}`)),
    ...ALWAYS_LEFT_OUT.map((line) => `  - ${line}`),
    ...notes.map((line) => `  - ${line}`),
  ];
  return `${lines.join("\r\n")}\r\n`;
}

/** A sentence he can read. The raw message goes into FAILED.txt, never into the toast. */
function plainReason(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === "ENOSPC") return "The disk is full.";
  if (code === "ENOENT") return "The folder is no longer there.";
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") return "Windows did not allow writing there.";
  return `It stopped on an error${typeof code === "string" ? ` (${code})` : ""}.`;
}

/** Windows can hold a folder for a moment after files land in it (antivirus, the search indexer). */
async function renameWhenFree(from: string, to: string): Promise<boolean> {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      fs.renameSync(from, to);
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  return false;
}

/**
 * Writes the whole export into "<name> (incomplete)" and renames it once everything is in it, so a
 * folder without that ending is always a whole export. It never deletes: a failed or stopped run
 * leaves its folder, with FAILED.txt saying why.
 */
export async function exportAll(plan: ExportPlan): Promise<ExportResult> {
  const at = plan.now ?? new Date();
  let work = "";
  let written = 0;
  let total = 0;
  try {
    const name = freeName(plan.destination, exportFolderName(at));
    const made = path.join(plan.destination, name + INCOMPLETE);
    fs.mkdirSync(made);
    work = made;

    const sources: ExportSource[] =
      plan.includeVault && plan.vault
        ? [...plan.sources, { db: plan.vault.db, file: plan.vault.file, module: VAULT, encrypted: true }]
        : plan.sources;
    // Every table is listed before the first is written, so the job line can count from the start.
    const found = sources.map((source) => ({ source, tables: tablesOf(source.db) }));
    total = found.reduce((n, f) => n + f.tables.filter((t) => !skipReason(t)).length, 0);

    // ponytail: rows are read live, table after table, not from one frozen moment. A row changed
    // while the export runs is seen either before or after its change. Freezing them all needs a
    // second connection per database, which the encrypted stores cannot open without their key.
    const databases: ManifestDatabase[] = [];
    let rows = 0;
    let unreadableTax = 0;
    const tax = (stored: string): string => {
      const out = taxOut(stored, plan.taxCrypto ?? null, plan.includeTaxNumbers === true);
      if (out === null) unreadableTax += 1;
      return out ?? TAX_UNREADABLE;
    };
    for (const { source, tables } of found) {
      const entry = describeDatabase(source);
      for (const table of tables) {
        const skipped = skipReason(table);
        if (skipped) {
          entry.skipped.push({ name: table.name, reason: skipped });
          continue;
        }
        // ponytail: a stop is honoured between tables, so no table file is ever half-written and
        // one very large table is finished first. Check between bursts if that wait is ever felt.
        if (plan.shouldStop?.()) throw new Stopped();
        plan.onProgress?.({ table: table.name, done: written + 1, total });
        const module = typeof source.module === "string" ? source.module : source.module(table.name);
        const out = await writeTable(source.db, table, work, module, tax);
        entry.tables.push({ name: table.name, module, file: out.file, rows: out.rows, columns: out.columns, sql: table.sql });
        rows += out.rows;
        written += 1;
        await pause();
      }
      entry.modules = [...new Set(entry.tables.map((t) => t.module))].sort();
      databases.push(entry);
    }

    let vault: ManifestVault;
    if (!plan.vault) vault = { included: false, note: NO_VAULT };
    else if (plan.includeVault) vault = { included: true, note: VAULT_PLAIN };
    else {
      if (plan.shouldStop?.()) throw new Stopped();
      plan.onProgress?.({ table: "Secured Vault, still encrypted", done: total, total });
      vault = copyVaultEncrypted(plan.vault, work);
    }

    const notes = plan.notes ?? [];
    if (unreadableTax > 0) {
      const one = unreadableTax === 1;
      notes.push(
        `${one ? "1 employee tax number" : `${unreadableTax} employee tax numbers`} could not be read on this PC, so a sentence saying so is in ${one ? "its" : "their"} place.`
      );
    }
    const taxNumbers: ManifestTax = {
      included: plan.includeTaxNumbers === true,
      note: plan.includeTaxNumbers === true ? TAX_FULL : TAX_MASKED,
      unreadable: unreadableTax,
    };
    const manifest = {
      format: "focal-registry-export",
      formatVersion: 1,
      app: "Focal Registry",
      appVersion: plan.appVersion,
      exportedAt: at.toISOString(),
      rowFormat: ROW_FORMAT,
      vault,
      taxNumbers,
      notes,
      totals: { tables: written, rows },
      databases,
    };
    fs.writeFileSync(path.join(work, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    fs.writeFileSync(path.join(work, "README.txt"), readMe(plan.appVersion, at, databases, vault, taxNumbers, notes), { flag: "wx" });

    const done = path.join(plan.destination, name);
    if (!(await renameWhenFree(work, done))) {
      return {
        ok: false,
        path: work,
        error: `Everything was written, but Windows would not let the folder be renamed. The export is complete: remove "${INCOMPLETE}" from the name of the folder "${name}${INCOMPLETE}".`,
      };
    }
    return { ok: true, path: done, tables: written, rows };
  } catch (err) {
    const stopped = err instanceof Stopped;
    const reason = stopped ? "It was stopped before it finished." : plainReason(err);
    if (!work) return { ok: false, error: `The export could not start. ${reason}` };
    try {
      fs.writeFileSync(
        path.join(work, "FAILED.txt"),
        [
          "This export did not finish.",
          "",
          `Why: ${reason}`,
          `When: ${new Date().toLocaleString()}`,
          `Tables written before it stopped: ${written} of ${total}.`,
          ...(stopped ? [] : [`Technical detail: ${err instanceof Error ? err.message : String(err)}`]),
          "",
          "This folder is not a complete export. Your data in the app is untouched.",
          "You can delete this folder and export again.",
          "",
        ].join("\r\n")
      );
    } catch {
      // The folder itself is gone or the disk is full. The sentence returned below still says so.
    }
    return {
      ok: false,
      path: work,
      error: `The export did not finish. ${reason} What was written is in the folder "${path.basename(work)}". Your data in the app is untouched.`,
    };
  }
}
