/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
/* File: tests/datacopy.db.test.ts */
// "Back up everything" against throwaway databases in the temp folder. Runs under Electron-as-Node,
// because the SQLite build is the Electron one. Every row, file and the key below are made up:
// nothing here may ever be copied from a real database.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import Database from "better-sqlite3-multiple-ciphers";
import { copyEverything, isInside, stampOf, type CopyPlan } from "../electron/core/services/data/copyAll";
import { closeAllDbs, createTable, openDb } from "../electron/core/services/db";

const MADE_UP_KEY = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const STAMP = "2026-11-13 0900";
const PLAIN_ROWS = 40;
const LOCKED_ROWS = 25;

function fill(db: Database.Database, rows: number): void {
  createTable(db, "things", ["label TEXT NOT NULL"]);
  const add = db.prepare("INSERT INTO things (uuid, label) VALUES (?, ?)");
  for (let i = 0; i < rows; i += 1) add.run(`made-up-${i}`, `made-up row ${i}`);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fr-test-"));
const source = path.join(dir, "data");
fs.mkdirSync(source);
// The app's own open: write-ahead log on, exactly as the shared database runs.
const plain = openDb(path.join(source, "plain-source.db"), "datacopy-test-plain");
// No automatic checkpoint, so every row below stays in the log and never reaches the main file.
plain.pragma("wal_autocheckpoint = 0");
fill(plain, PLAIN_ROWS);
// The app's own keyed open: cipher scheme, then the key, exactly as the Vault is opened.
const locked = openDb(path.join(source, "locked-source.db"), "datacopy-test-locked", MADE_UP_KEY);
fill(locked, LOCKED_ROWS);
fs.writeFileSync(path.join(source, "envelope.bin"), "made-up envelope bytes");
fs.mkdirSync(path.join(source, "contracts", "7"), { recursive: true });
fs.writeFileSync(path.join(source, "contracts", "7", "agreement.txt"), "made-up contract");

after(() => {
  closeAllDbs();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Rows in a copy, opened fresh from disk the way a restore would open it. */
function rowsIn(file: string, key?: string): number {
  const db = new Database(file, { fileMustExist: true });
  try {
    if (key) {
      db.pragma("cipher = 'sqlcipher'");
      db.pragma(`key = "x'${key}'"`);
    }
    return (db.prepare("SELECT count(*) AS n FROM things").get() as { n: number }).n;
  } finally {
    db.close();
  }
}

function planFor(destinationRoot: string): CopyPlan {
  return {
    databases: [
      { name: "Fake shared database", fileName: "shared-fake.db", db: plain },
      { name: "Fake vault", fileName: "vault-fake.db", db: locked },
    ],
    files: [{ from: path.join(source, "envelope.bin"), to: "envelope.bin" }],
    folders: [{ from: path.join(source, "contracts"), to: path.join("TimeTracker", "contracts") }],
    destinationRoot,
    stamp: STAMP,
    appVersion: "0.0.0-test",
    notes: ["made-up note"],
    shouldStop: () => false,
    report: () => {},
  };
}

test("DS-01: the plain rows are still only in the write-ahead log, so a copy of the file misses them", () => {
  assert.ok(fs.statSync(path.join(source, "plain-source.db-wal")).size > 0);
  const raw = path.join(dir, "raw-file-copy.db");
  fs.copyFileSync(path.join(source, "plain-source.db"), raw);
  const db = new Database(raw);
  try {
    const found = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'things'").get() as { n: number };
    assert.equal(found.n, 0);
  } finally {
    db.close();
  }
});

test("DS-01: both databases are copied whole, and the encrypted one opens only with its key", async () => {
  const result = await copyEverything(planFor(path.join(dir, "out-whole")));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(path.basename(result.path), STAMP);
  assert.equal(fs.existsSync(`${result.path} (incomplete)`), false);
  assert.equal(fs.existsSync(path.join(result.path, "FAILED.txt")), false);

  assert.equal(rowsIn(path.join(result.path, "shared-fake.db")), PLAIN_ROWS);
  assert.equal(rowsIn(path.join(result.path, "vault-fake.db"), MADE_UP_KEY), LOCKED_ROWS);
  assert.throws(() => rowsIn(path.join(result.path, "vault-fake.db")));

  assert.equal(fs.readFileSync(path.join(result.path, "envelope.bin"), "utf8"), "made-up envelope bytes");
  assert.equal(
    fs.readFileSync(path.join(result.path, "TimeTracker", "contracts", "7", "agreement.txt"), "utf8"),
    "made-up contract"
  );

  const manifest = JSON.parse(fs.readFileSync(path.join(result.path, "manifest.json"), "utf8")) as {
    complete: boolean;
    appVersion: string;
    notes: string[];
    copied: Array<{ file: string; bytes: number }>;
  };
  assert.equal(manifest.complete, true);
  assert.equal(manifest.appVersion, "0.0.0-test");
  assert.deepEqual(manifest.notes, ["made-up note"]);
  assert.equal(manifest.copied.length, 4);
  for (const item of manifest.copied) {
    assert.equal(item.bytes, fs.statSync(path.join(result.path, item.file)).size);
  }
});

test("DS-01: a stop between files leaves a folder marked incomplete, with the reason inside", async () => {
  const root = path.join(dir, "out-stopped");
  let asked = 0;
  // Asked once before each file: no before the first database, yes before the second.
  const result = await copyEverything({ ...planFor(root), shouldStop: () => (asked += 1) > 1 });
  assert.equal(result.ok, false);
  if (result.ok) return;
  const left = result.path ?? "";
  assert.equal(path.basename(left), `${STAMP} (incomplete)`);
  assert.equal(fs.existsSync(path.join(root, STAMP)), false);
  assert.match(fs.readFileSync(path.join(left, "FAILED.txt"), "utf8"), /stopped/);
  assert.equal(fs.existsSync(path.join(left, "manifest.json")), false);
  // The one file that finished is whole; the one that never started is not there at all.
  assert.equal(rowsIn(path.join(left, "shared-fake.db")), PLAIN_ROWS);
  assert.equal(fs.existsSync(path.join(left, "vault-fake.db")), false);

  // The next run in the same minute steps around what the stopped one left behind.
  const again = await copyEverything(planFor(root));
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.match(path.basename(again.path), /^2026-11-13 0900\d\d$/);
  assert.equal(fs.existsSync(path.join(left, "FAILED.txt")), true);
});

test("DS-01: a folder that already exists is never written into", async () => {
  const root = path.join(dir, "out-taken");
  fs.mkdirSync(path.join(root, STAMP), { recursive: true });
  fs.writeFileSync(path.join(root, STAMP, "earlier.txt"), "made-up earlier copy");
  const result = await copyEverything(planFor(root));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(path.basename(result.path), /^2026-11-13 0900\d\d$/);
  assert.deepEqual(fs.readdirSync(path.join(root, STAMP)), ["earlier.txt"]);
  assert.equal(fs.readFileSync(path.join(root, STAMP, "earlier.txt"), "utf8"), "made-up earlier copy");
});

test("DS-01: a destination inside a folder being copied is refused before anything is written", async () => {
  const inside = path.join(source, "contracts", "copies-here");
  const result = await copyEverything(planFor(inside));
  assert.equal(result.ok, false);
  assert.equal(fs.existsSync(inside), false);
});

test("DS-01: the folder beside the data folder is not inside it, and the stamp is local and sortable", () => {
  const data = path.join(os.tmpdir(), "Documents", "Focal Registry");
  assert.equal(isInside(path.join(os.tmpdir(), "Documents", "Focal Registry Backups"), data), false);
  assert.equal(isInside(path.join(data, "Scan Notes", "E Drive"), data), true);
  assert.equal(isInside(data, data), true);
  assert.equal(stampOf(new Date(2026, 10, 3, 9, 5, 59)), "2026-11-03 0905");
});
