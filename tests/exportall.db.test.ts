/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
/* File: tests/exportall.db.test.ts */
// Export all data, on fake databases built with the app's own schema functions: every row and
// every column is read back from the written files and compared with its source. Every value here
// is made up. Nothing under the app's real data folders is opened.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import Database from "better-sqlite3-multiple-ciphers";
import { exportAll, exportFolderName, sharedModuleOf, type ExportPlan, type ExportProgress, type ExportResult } from "../electron/core/services/data/exportAll";
import { closeAllDbs, createTable, getDb, initDb, openDb } from "../electron/core/services/db";
import { ensureAllModuleSchemas } from "../electron/core/services/db/allSchemas";
import { openAttachmentsDb } from "../electron/core/services/mindmerge/attachDb";
import { saveAttachment } from "../electron/core/services/mindmerge/attachments";
import { openMindMergeDb } from "../electron/core/services/mindmerge/db";
import { generateUUIDv7 } from "../electron/core/services/utils/uuidv7";
import { ensureVaultSchema } from "../electron/core/services/vault/db";

type Db = Database.Database;
type Cell = null | number | bigint | string | Buffer;

interface ManifestTable {
  name: string;
  module: string;
  file: string;
  rows: number;
  columns: string[];
  sql: string | null;
}
interface Manifest {
  appVersion: string;
  vault: { included: boolean; note: string; encryptedCopy?: string; keyEnvelope?: string | null };
  totals: { tables: number; rows: number };
  databases: Array<{
    file: string;
    schemaVersion: null;
    userVersion: number;
    modules: string[];
    tables: ManifestTable[];
    skipped: Array<{ name: string; reason: string }>;
  }>;
}

const ORG = "fake-org-0001";
const FAKE_KEY = "0f".repeat(32); // a made-up 32-byte key, as hex
const UNICODE = 'Zoë — 東京 😀 "quoted" \\ back\nsecond line\ttab';
const VAULT_MARKER = "FAKE-VAULT-VALUE-must-not-leak";
const DEVICE_MARKER = "FAKE-MACHINE-GUID-must-stay-home";
const PICTURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3, 250, 251, 252, 253]);
const ENVELOPE = Buffer.from("fake key envelope bytes");
const BIG = 9007199254740993n; // 2^53 + 1: a double cannot hold it

const SHARED_FILE = `focalregistry_${ORG}.db`;
const DOCS_FILE = `mindmerge_${ORG}.db`;
const PICTURES_FILE = `${ORG}.mtd`;
const VAULT_FILE = `${ORG}.atd`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fr-test-"));
const destination = path.join(dir, "out");
fs.mkdirSync(destination);

// ---- the shared database: the app's real shell and module schemas, plus fake rows ----
initDb(path.join(dir, SHARED_FILE));
const shared = getDb();
ensureAllModuleSchemas(shared);
shared.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)").run("fake.unicode", UNICODE);
shared
  .prepare("INSERT INTO scan_drives (uuid, org_id, volume_serial, volume_label, total_bytes, free_bytes) VALUES (?, ?, ?, ?, ?, ?)")
  .run(generateUUIDv7(), ORG, "FAKE-SERIAL", UNICODE, BIG, null);
shared
  .prepare("INSERT INTO device_provenance (uuid, org_id, machine_guid, hardware_uuid, machine_name) VALUES (?, ?, ?, ?, ?)")
  .run(generateUUIDv7(), ORG, DEVICE_MARKER, "FAKE-HARDWARE-ID", "FAKE-PC");
// Values the real shared tables do not hold today: binary data in two columns, a missing one,
// a name that cannot be a file name, infinity.
createTable(shared, "fake_things", ["label TEXT", "ratio REAL", "mime TEXT", "bytes BLOB", "spare BLOB"]);
const thing = shared.prepare("INSERT INTO fake_things (uuid, label, ratio, mime, bytes, spare) VALUES (?, ?, ?, ?, ?, ?)");
thing.run(generateUUIDv7(), UNICODE, 0.1, "image/png", PICTURE, null);
thing.run(generateUUIDv7(), "", -1.5e300, null, Buffer.from([0]), Buffer.from([0, 255, 10, 13]));
thing.run("not a file name / at all", null, Infinity, "image/jpeg", PICTURE, null);
// More rows than one burst reads, and a negative id, so the paging is walked end to end.
createTable(shared, "fake_many", ["n INTEGER"]);
const many = shared.prepare("INSERT INTO fake_many (id, uuid, n) VALUES (?, ?, ?)");
shared.transaction(() => {
  many.run(-5, "fake-negative", -5);
  for (let n = 1; n <= 4500; n += 1) many.run(n, `fake-${n}`, n * 1000);
})();
// A table with no rowid cannot be paged; it takes the read-in-one-stretch path.
shared.exec("CREATE TABLE fake_pairs (k TEXT PRIMARY KEY, v TEXT) WITHOUT ROWID");
shared.prepare("INSERT INTO fake_pairs (k, v) VALUES (?, ?), (?, ?)").run("b", UNICODE, "a", null);

// ---- MindMerge: the plain documents database and the encrypted picture store ----
const pictures = openAttachmentsDb(ORG, dir, FAKE_KEY);
const picture = saveAttachment(pictures, ORG, { name: "fake-picture.png", mime: "image/png", dataBase64: PICTURE.toString("base64") });
const docs = openMindMergeDb(ORG, dir);
docs
  .prepare("INSERT INTO mindmerge_docs (uuid, org_id, kind, title, body) VALUES (?, ?, 'note', ?, ?)")
  .run(generateUUIDv7(), ORG, "Fake note", `${UNICODE}\n![fake-picture.png](mindmerge://${picture.uuid})`);
// An ingested file also fills the search index, which the export must leave behind.
docs
  .prepare("INSERT INTO mindmerge_notes (uuid, title, body_md, tags_flat, file_path) VALUES (?, ?, ?, ?, ?)")
  .run(generateUUIDv7(), "Fake ingested file", "fake body words", "fake", "C:\\fake\\file.md");

// ---- a fake Vault: the app's SQLCipher open and its real schema, with a made-up key ----
const vault = openDb(path.join(dir, VAULT_FILE), "vault", FAKE_KEY);
ensureVaultSchema(vault);
vault
  .prepare("INSERT INTO vault_notes (uuid, org_id, kind, title, body) VALUES (?, ?, 'note', ?, ?)")
  .run(generateUUIDv7(), ORG, "Fake secured note", VAULT_MARKER);
const vaultPicture = generateUUIDv7();
vault
  .prepare("INSERT INTO vault_attachments (uuid, org_id, name, mime, byte_count, bytes) VALUES (?, ?, ?, ?, ?, ?)")
  .run(vaultPicture, ORG, "fake-vault-picture.png", "image/png", PICTURE.length, PICTURE);
const keyEnvelope = path.join(dir, `${ORG}.ixd`);
fs.writeFileSync(keyEnvelope, ENVELOPE);

const handles: Record<string, Db> = { [SHARED_FILE]: shared, [DOCS_FILE]: docs, [PICTURES_FILE]: pictures, [VAULT_FILE]: vault };

after(() => {
  docs.close();
  pictures.close();
  closeAllDbs(); // the shared database and the fake Vault
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});

const plan = (extra: Partial<ExportPlan> = {}): ExportPlan => ({
  sources: [
    { db: shared, file: SHARED_FILE, module: sharedModuleOf },
    { db: docs, file: DOCS_FILE, module: "mindmerge" },
    { db: pictures, file: PICTURES_FILE, module: "mindmerge", encrypted: true },
  ],
  vault: { db: vault, file: VAULT_FILE, keyEnvelope },
  includeVault: false,
  destination,
  appVersion: "0.0.0-test",
  ...extra,
});

function finished(result: ExportResult): Extract<ExportResult, { ok: true }> {
  if (!result.ok) throw new Error(`the export failed: ${result.error}`);
  return result;
}

const manifestOf = (root: string): Manifest => JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8")) as Manifest;

function filesUnder(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(root, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  });
}

/** Turns one written value back into what SQLite held. */
function decode(root: string, value: unknown): Cell {
  if (value !== null && typeof value === "object") {
    const tagged = value as { $int?: string; $real?: string; $file?: string };
    if (tagged.$int !== undefined) return BigInt(tagged.$int);
    if (tagged.$real !== undefined) return Number(tagged.$real);
    if (tagged.$file !== undefined) return fs.readFileSync(path.join(root, tagged.$file));
    throw new Error(`a value was written in a shape the read-me does not describe: ${JSON.stringify(value)}`);
  }
  return value as Cell;
}

/** Reads one table's file back and compares every row and every column with the database. */
function sameAsSource(root: string, db: Db, table: ManifestTable): number {
  const order = table.name === "fake_pairs" ? "" : " ORDER BY rowid";
  const source = db.prepare<unknown[], Cell[]>(`SELECT * FROM "${table.name}"${order}`).safeIntegers(true).raw(true);
  const columns = source.columns().map((c) => c.name);
  const rows = source.all();
  assert.deepEqual(table.columns, columns, `${table.name}: columns`);
  assert.equal(table.rows, rows.length, `${table.name}: the manifest's row count`);
  const text = fs.readFileSync(path.join(root, table.file), "utf8");
  const lines = text === "" ? [] : text.trimEnd().split("\n");
  assert.equal(lines.length, rows.length, `${table.name}: lines in the file`);
  lines.forEach((line, r) => {
    const written = JSON.parse(line) as Record<string, unknown>;
    assert.deepEqual(Object.keys(written), columns, `${table.name} row ${r + 1}: keys`);
    columns.forEach((column, c) => {
      const held = rows[r][c];
      // A whole number that fits a double is written as a plain JSON number.
      const want = typeof held === "bigint" && held >= -9007199254740991n && held <= 9007199254740991n ? Number(held) : held;
      const got = decode(root, written[column]);
      if (Buffer.isBuffer(want)) assert.ok(Buffer.isBuffer(got) && got.equals(want), `${table.name}.${column} row ${r + 1}: bytes`);
      else assert.strictEqual(got, want, `${table.name}.${column} row ${r + 1}`);
    });
  });
  return rows.length;
}

test("a shared table goes to the folder of the module that owns it", () => {
  assert.equal(sharedModuleOf("scan_notes_updates"), "scan");
  assert.equal(sharedModuleOf("rename_batches"), "rename");
  assert.equal(sharedModuleOf("migrate_bundle_items"), "migrate");
  assert.equal(sharedModuleOf("timetracker_time_entries"), "timetracker");
  assert.equal(sharedModuleOf("employee_people"), "employees");
  assert.equal(sharedModuleOf("app_settings"), "shell");
  assert.equal(sharedModuleOf("scout_targets"), "shell");
});

test("the export folder is named for the local minute it was made", () => {
  assert.equal(exportFolderName(new Date(2026, 10, 13, 4, 7)), "FocalRegistry-Export-2026-11-13 0407");
});

test("Vault unticked: every row and column reads back, and the Vault goes only as its encrypted file", async () => {
  const out = finished(await exportAll(plan({ now: new Date(2026, 0, 2, 3, 4) })));
  assert.equal(path.basename(out.path), "FocalRegistry-Export-2026-01-02 0304");
  assert.equal(fs.existsSync(`${out.path} (incomplete)`), false);
  const manifest = manifestOf(out.path);
  assert.equal(manifest.appVersion, "0.0.0-test");

  // Every table of every database is either written and identical, or named as left out.
  let tables = 0;
  let rows = 0;
  assert.deepEqual(manifest.databases.map((d) => d.file), [SHARED_FILE, DOCS_FILE, PICTURES_FILE]);
  for (const database of manifest.databases) {
    const db = handles[database.file];
    const all = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'").pluck().all() as string[];
    assert.deepEqual([...database.tables.map((t) => t.name), ...database.skipped.map((s) => s.name)].sort(), all.sort(), database.file);
    assert.equal(database.schemaVersion, null);
    assert.equal(database.userVersion, 0);
    for (const table of database.tables) {
      assert.ok(table.sql?.startsWith("CREATE TABLE"), `${table.name}: the statement that rebuilds it`);
      rows += sameAsSource(out.path, db, table);
      tables += 1;
    }
  }
  assert.equal(out.tables, tables);
  assert.equal(out.rows, rows);
  assert.deepEqual(manifest.totals, { tables, rows });

  // The right folder for each module.
  const fileOf = (name: string): string | undefined => manifest.databases.flatMap((d) => d.tables).find((t) => t.name === name)?.file;
  assert.equal(fileOf("app_settings"), "shell/app_settings.jsonl");
  assert.equal(fileOf("scout_targets"), "shell/scout_targets.jsonl");
  assert.equal(fileOf("scan_notes"), "scan/scan_notes.jsonl");
  assert.equal(fileOf("rename_batches"), "rename/rename_batches.jsonl");
  assert.equal(fileOf("migrate_jobs"), "migrate/migrate_jobs.jsonl");
  assert.equal(fileOf("timetracker_time_entries"), "timetracker/timetracker_time_entries.jsonl");
  assert.equal(fileOf("employee_people"), "employees/employee_people.jsonl");
  assert.equal(fileOf("mindmerge_docs"), "mindmerge/mindmerge_docs.jsonl");
  assert.equal(fileOf("mindmerge_attachments"), "mindmerge/mindmerge_attachments.jsonl");

  // What is left out is named, and only that: the search index and the device row.
  const skippedIn = (file: string): string[] => (manifest.databases.find((d) => d.file === file)?.skipped ?? []).map((s) => s.name).sort();
  assert.deepEqual(skippedIn(SHARED_FILE), ["device_provenance"]);
  assert.deepEqual(skippedIn(PICTURES_FILE), []);
  assert.ok(skippedIn(DOCS_FILE).includes("mindmerge_fts"));
  assert.ok(skippedIn(DOCS_FILE).length > 1, "the search index's own storage tables are left out with it");
  assert.ok(skippedIn(DOCS_FILE).every((name) => name.startsWith("mindmerge_fts")));
  assert.equal(filesUnder(out.path).some((file) => path.basename(file).startsWith("mindmerge_fts")), false);

  // The number a double cannot hold is written out in full.
  assert.ok(fs.readFileSync(path.join(out.path, "scan", "scan_drives.jsonl"), "utf8").includes(`"total_bytes":{"$int":"${BIG}"}`));

  // The MindMerge picture is an ordinary file, named by the id the document refers to.
  assert.ok(fs.readFileSync(path.join(out.path, "mindmerge", "attachments", `${picture.uuid}.png`)).equals(PICTURE));

  // The Vault: no plain rows anywhere, only its encrypted file and its key file.
  assert.equal(manifest.vault.included, false);
  assert.equal(manifest.vault.encryptedCopy, `vault/${VAULT_FILE}`);
  assert.equal(manifest.vault.keyEnvelope, `vault/${ORG}.ixd`);
  assert.equal(filesUnder(path.join(out.path, "vault")).some((file) => file.endsWith(".jsonl")), false, "a Vault table was written as plain rows");
  assert.equal(manifest.databases.some((d) => d.file === VAULT_FILE), false, "the manifest lists Vault tables");
  assert.ok(fs.readFileSync(path.join(out.path, "vault", `${ORG}.ixd`)).equals(ENVELOPE));
  for (const file of filesUnder(out.path)) {
    const bytes = fs.readFileSync(file);
    assert.equal(bytes.includes(VAULT_MARKER), false, `a Vault value is readable in ${file}`);
    assert.equal(bytes.includes(DEVICE_MARKER), false, `the device row is in ${file}`);
  }
  const copy = path.join(out.path, "vault", VAULT_FILE);
  const keyless = new Database(copy, { readonly: true, fileMustExist: true });
  assert.throws(() => keyless.prepare("SELECT body FROM vault_notes").get(), "the copy opens without its key");
  keyless.close();
  const keyed = new Database(copy, { readonly: true, fileMustExist: true });
  keyed.pragma("cipher = 'sqlcipher'");
  keyed.pragma(`key = "x'${FAKE_KEY}'"`);
  assert.equal(keyed.prepare("SELECT body FROM vault_notes").pluck().get(), VAULT_MARKER);
  keyed.close();

  const readMe = fs.readFileSync(path.join(out.path, "README.txt"), "utf8");
  assert.match(readMe, /same Windows user account, on the same PC/);
  assert.match(readMe, /device_provenance/);
  assert.match(readMe, /mindmerge_fts/);
});

test("Vault ticked: its rows are written as plain text, its pictures as files, and no encrypted copy", async () => {
  const seen: ExportProgress[] = [];
  const out = finished(await exportAll(plan({ includeVault: true, now: new Date(2026, 0, 2, 3, 5), onProgress: (p) => seen.push(p) })));
  const manifest = manifestOf(out.path);
  assert.equal(manifest.vault.included, true);
  const database = manifest.databases.find((d) => d.file === VAULT_FILE);
  if (!database) throw new Error("the Vault is not listed as a database");
  assert.deepEqual(database.modules, ["vault"]);
  for (const table of database.tables) sameAsSource(out.path, vault, table);
  assert.equal(database.tables.find((t) => t.name === "vault_notes")?.rows, 1);
  assert.ok(fs.readFileSync(path.join(out.path, "vault", "vault_notes.jsonl"), "utf8").includes(VAULT_MARKER));
  assert.ok(fs.readFileSync(path.join(out.path, "vault", "attachments", `${vaultPicture}.png`)).equals(PICTURE));
  assert.equal(fs.existsSync(path.join(out.path, "vault", VAULT_FILE)), false);
  // The job line counts every table once, from 1 to the total.
  assert.equal(seen.length, out.tables);
  assert.deepEqual(seen.map((p) => p.done), seen.map((_p, i) => i + 1));
  assert.ok(seen.every((p) => p.total === out.tables));
});

test("a stop between tables leaves the unfinished folder with FAILED.txt and deletes nothing", async () => {
  let asked = 0;
  const result = await exportAll(plan({ now: new Date(2026, 0, 2, 3, 6), shouldStop: () => ++asked > 3 }));
  if (result.ok || !result.path) throw new Error("the export should have stopped and kept its folder");
  assert.equal(path.basename(result.path), "FocalRegistry-Export-2026-01-02 0306 (incomplete)");
  assert.match(fs.readFileSync(path.join(result.path, "FAILED.txt"), "utf8"), /stopped before it finished/);
  assert.equal(fs.existsSync(path.join(result.path, "manifest.json")), false);
  assert.equal(filesUnder(result.path).filter((file) => file.endsWith(".jsonl")).length, 3);
  assert.equal(fs.existsSync(path.join(destination, "FocalRegistry-Export-2026-01-02 0306")), false);
  // The two finished exports from the tests above are still there.
  assert.ok(fs.existsSync(path.join(destination, "FocalRegistry-Export-2026-01-02 0304", "manifest.json")));
  assert.ok(fs.existsSync(path.join(destination, "FocalRegistry-Export-2026-01-02 0305", "manifest.json")));
});

test("a second export in the same minute gets its own folder, and a missing destination is refused", async () => {
  const again = finished(await exportAll(plan({ now: new Date(2026, 0, 2, 3, 4) })));
  assert.equal(path.basename(again.path), "FocalRegistry-Export-2026-01-02 0304 (2)");
  const nowhere = await exportAll(plan({ destination: path.join(dir, "no-such-folder") }));
  if (nowhere.ok) throw new Error("an export into a folder that does not exist should be refused");
  assert.equal(nowhere.path, undefined);
  assert.match(nowhere.error, /could not start/);
});
