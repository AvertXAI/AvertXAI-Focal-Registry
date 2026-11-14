/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
/* File: tests/taxexport.db.test.ts */
// Employee tax numbers on their way out of the app: Export all data masks them unless they are
// asked for in full, and Backup takes their key file along. The database is a fake one built with
// the app's own schema functions, the key is 32 made-up bytes, and every number is made up.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { copyEverything, keyFilesIn } from "../electron/core/services/data/copyAll";
import { exportAll, sharedModuleOf, type ExportPlan, type ExportResult } from "../electron/core/services/data/exportAll";
import { closeAllDbs, getDb, initDb } from "../electron/core/services/db";
import { ensureAllModuleSchemas } from "../electron/core/services/db/allSchemas";
import { createTaxCrypto, isEncryptedTax, maskTax, type TaxCrypto } from "../electron/core/services/employees/taxCrypto";

interface Manifest {
  notes: string[];
  taxNumbers: { included: boolean; note: string; unreadable: number };
}

const ORG = "fake-org-0001";
const SHARED_FILE = `focalregistry_${ORG}.db`;
const LEGACY = "000-00-1234"; // typed before 0.2.17: still plain text in the column
const SEALED = "000-00-5678"; // typed after: encrypted in the column
const taxCrypto = createTaxCrypto(Buffer.alloc(32, 7));
// A key file from another Windows account: every read fails.
const wrongKey: TaxCrypto = {
  encrypt: () => {
    throw new Error("fake: this key cannot write");
  },
  decrypt: () => {
    throw new Error("fake: this key cannot read");
  },
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fr-test-"));
const destination = path.join(dir, "out");
fs.mkdirSync(destination);

initDb(path.join(dir, SHARED_FILE));
const shared = getDb();
ensureAllModuleSchemas(shared);
const stored = taxCrypto.encrypt(SEALED);
const person = shared.prepare("INSERT INTO employee_people (uuid, org_id, name, ssn) VALUES (?, ?, ?, ?)");
person.run("fake-person-1", ORG, "Fake Person One", LEGACY);
person.run("fake-person-2", ORG, "Fake Person Two", stored);
person.run("fake-person-3", ORG, "Fake Person Three", null);

after(() => {
  closeAllDbs();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});

const plan = (extra: Partial<ExportPlan> = {}): ExportPlan => ({
  sources: [{ db: shared, file: SHARED_FILE, module: sharedModuleOf }],
  vault: null,
  includeVault: false,
  taxCrypto,
  destination,
  appVersion: "0.0.0-test",
  ...extra,
});

function finished(result: ExportResult): Extract<ExportResult, { ok: true }> {
  if (!result.ok) throw new Error(`the export failed: ${result.error}`);
  return result;
}

const manifestOf = (root: string): Manifest => JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8")) as Manifest;
const readMeOf = (root: string): string => fs.readFileSync(path.join(root, "README.txt"), "utf8");

function filesUnder(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(root, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  });
}

/** Each person's tax number as the export wrote it, by name. */
function taxNumbersIn(root: string): Map<string, string | null> {
  const text = fs.readFileSync(path.join(root, "employees", "employee_people.jsonl"), "utf8");
  return new Map(
    text
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as { name: string; ssn: string | null })
      .map((row) => [row.name, row.ssn] as const)
  );
}

function noFileHolds(root: string, values: string[]): void {
  for (const file of filesUnder(root)) {
    const bytes = fs.readFileSync(file);
    for (const value of values) assert.equal(bytes.includes(value), false, `"${value}" is readable in ${file}`);
  }
}

test("SEC-02: the fake rows are what 0.2.17 stores, one plain and one encrypted, and a mask hides the number", () => {
  assert.equal(isEncryptedTax(LEGACY), false);
  assert.equal(isEncryptedTax(stored), true);
  assert.equal(stored.includes(SEALED), false);
  assert.notEqual(maskTax(LEGACY), LEGACY);
  assert.notEqual(maskTax(SEALED), SEALED);
});

test("SEC-02: box unticked, a plain tax number and an encrypted one both go out masked", async () => {
  const out = finished(await exportAll(plan({ now: new Date(2026, 0, 2, 3, 4) })));
  const written = taxNumbersIn(out.path);
  assert.equal(written.get("Fake Person One"), maskTax(LEGACY));
  assert.equal(written.get("Fake Person Two"), maskTax(SEALED));
  assert.equal(written.get("Fake Person Three"), null);
  noFileHolds(out.path, [LEGACY, SEALED, stored]);
  const { taxNumbers } = manifestOf(out.path);
  assert.equal(taxNumbers.included, false);
  assert.equal(taxNumbers.unreadable, 0);
  assert.match(taxNumbers.note, /shows only the last four digits/);
  assert.match(readMeOf(out.path), /EMPLOYEE TAX NUMBERS/);
  assert.match(readMeOf(out.path), /shows only the last four digits/);
  assert.match(readMeOf(out.path), /"Include full tax numbers" box/);
});

test("SEC-02: box ticked, both go out in full and the read-me says so", async () => {
  const notes: string[] = [];
  const out = finished(await exportAll(plan({ includeTaxNumbers: true, notes, now: new Date(2026, 0, 2, 3, 5) })));
  const written = taxNumbersIn(out.path);
  assert.equal(written.get("Fake Person One"), LEGACY);
  assert.equal(written.get("Fake Person Two"), SEALED);
  assert.equal(written.get("Fake Person Three"), null);
  noFileHolds(out.path, [stored]);
  assert.deepEqual(notes, []);
  assert.equal(manifestOf(out.path).taxNumbers.included, true);
  assert.equal(manifestOf(out.path).taxNumbers.unreadable, 0);
  assert.match(readMeOf(out.path), /in full, as plain text/);
  assert.doesNotMatch(readMeOf(out.path), /shows only the last four digits/);
});

for (const [why, crypto, minute] of [
  ["its key file is missing", null, 6],
  ["its key file cannot read it", wrongKey, 7],
] as const) {
  test(`SEC-02: a tax number that cannot be read because ${why} goes out as a sentence, and the export still finishes`, async () => {
    const notes: string[] = [];
    // Ticked, the harder case: nothing may fall back to writing the column as it is stored.
    const out = finished(
      await exportAll(plan({ taxCrypto: crypto, includeTaxNumbers: true, notes, now: new Date(2026, 0, 2, 3, minute) }))
    );
    const written = taxNumbersIn(out.path);
    const two = written.get("Fake Person Two") ?? "";
    assert.match(two, /could not be read on this PC/);
    assert.equal(isEncryptedTax(two), false);
    noFileHolds(out.path, [stored, SEALED]);
    // A number that was never encrypted needs no key.
    assert.equal(written.get("Fake Person One"), LEGACY);
    assert.equal(written.get("Fake Person Three"), null);
    // The gap is said aloud: the caller's own list, the manifest and the read-me all carry it.
    assert.equal(notes.length, 1);
    assert.match(notes[0], /^1 employee tax number could not be read on this PC/);
    assert.deepEqual(manifestOf(out.path).notes, notes);
    assert.equal(manifestOf(out.path).taxNumbers.unreadable, 1);
    assert.ok(readMeOf(out.path).includes(notes[0]));
  });
}

test("SEC-02: Backup takes the tax number key file with the other key files and lists it in the manifest", async () => {
  const data = path.join(dir, "data");
  fs.mkdirSync(data);
  for (const ending of [".ixd", ".mxd", ".exd"]) fs.writeFileSync(path.join(data, ORG + ending), `made-up ${ending} bytes`);
  fs.writeFileSync(path.join(data, "another-fake-org.exd"), "made-up bytes of another organisation");

  const files = keyFilesIn(data, ORG);
  assert.deepEqual(files.map((file) => file.to).sort(), [`${ORG}.exd`, `${ORG}.ixd`, `${ORG}.mxd`]);
  assert.ok(files.every((file) => file.from === path.join(data, file.to)));

  const result = await copyEverything({
    databases: [],
    files,
    folders: [],
    destinationRoot: path.join(dir, "copies"),
    stamp: "2026-11-14 0900",
    appVersion: "0.0.0-test",
    notes: [],
    shouldStop: () => false,
    report: () => {},
  });
  if (!result.ok) throw new Error(`the copy failed: ${result.error}`);
  assert.equal(fs.readFileSync(path.join(result.path, `${ORG}.exd`), "utf8"), "made-up .exd bytes");
  const manifest = JSON.parse(fs.readFileSync(path.join(result.path, "manifest.json"), "utf8")) as {
    complete: boolean;
    copied: Array<{ file: string; bytes: number }>;
  };
  assert.equal(manifest.complete, true);
  assert.deepEqual(manifest.copied.map((item) => item.file).sort(), [`${ORG}.exd`, `${ORG}.ixd`, `${ORG}.mxd`]);
  assert.equal(manifest.copied.find((item) => item.file === `${ORG}.exd`)?.bytes, "made-up .exd bytes".length);

  // An install that has no tax number on file has no such key file, and none is made up for it.
  fs.rmSync(path.join(data, `${ORG}.exd`));
  assert.deepEqual(keyFilesIn(data, ORG).map((file) => file.to).sort(), [`${ORG}.ixd`, `${ORG}.mxd`]);
});
