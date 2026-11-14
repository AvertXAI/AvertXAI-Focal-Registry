/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
/* File: tests/taxnumbers.db.test.ts */
// Employee tax numbers, encrypted one value at a time (SEC-02). Against throwaway databases in the
// temp folder: the one-time migration of values an older version stored plain, the order a launch
// runs it in, and what the page is and is not handed. Runs under Electron-as-Node, because the
// SQLite module is built for Electron. The key is made-up bytes, never the Windows-wrapped one,
// and every name and number below is made up.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import Database from "better-sqlite3-multiple-ciphers";
import { ensureEmployeesSchema } from "../electron/core/services/employees/db";
import { createPerson, getPerson, personForPage, revealTax, updatePerson } from "../electron/core/services/employees/people";
import {
  TAX_PREFIX,
  createTaxCrypto,
  isEncryptedTax,
  keepNewKeyFile,
  maskTax,
  readTax,
  type TaxCrypto,
} from "../electron/core/services/employees/taxCrypto";
import {
  countLegacyTax,
  migrateTaxNumbers,
  runTaxMigration,
  taxMigrationNotice,
} from "../electron/core/services/employees/taxMigration";
import type { PersonInput } from "../electron/core/services/employees/types";

const ORG = "org-fake";
const FAKE_A = "000-00-1234";
const FAKE_B = "000-00-5678";
const FAKE_C = "000-00-9012";
const FAKE_FOLDER = path.join("fake-folder", "Fake Copy 2026-11-14 0900");

const tax = createTaxCrypto(Buffer.alloc(32, 7));
const otherKey = createTaxCrypto(Buffer.alloc(32, 9));
// The key that cannot be opened: the data was moved to another PC or Windows account.
const closed: TaxCrypto = {
  encrypt() {
    throw new Error("The fake key is closed.");
  },
  decrypt() {
    throw new Error("The fake key is closed.");
  },
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fr-test-"));
const opened: Database.Database[] = [];
after(() => {
  for (const db of opened) db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function fakeDb(): { db: Database.Database; file: string } {
  const file = path.join(dir, `fake-${opened.length}.db`);
  const db = new Database(file);
  // createPerson reads the licence rows from here. An empty table is the Free tier: five people.
  db.exec("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT)");
  ensureEmployeesSchema(db);
  opened.push(db);
  return { db, file };
}

/** A row as an older version left it: whatever is in `ssn` goes into the column untouched. */
const oldRow = (db: Database.Database, name: string, ssn: string | null): number =>
  Number(
    db.prepare(`INSERT INTO employee_people (uuid, org_id, name, ssn) VALUES (?, ?, ?, ?)`).run(randomUUID(), ORG, name, ssn)
      .lastInsertRowid
  );
const stored = (db: Database.Database, id: number): string | null =>
  (db.prepare(`SELECT ssn FROM employee_people WHERE id = ?`).get(id) as { ssn: string | null }).ssn;
const everyStored = (db: Database.Database): (string | null)[] =>
  (db.prepare(`SELECT ssn FROM employee_people ORDER BY id`).all() as { ssn: string | null }[]).map((row) => row.ssn);

const form = (over: Partial<PersonInput> = {}): PersonInput => ({
  name: "Fake Person",
  email: null,
  phone: null,
  role: null,
  defaultRate: null,
  notes: null,
  streetAddress: null,
  city: null,
  state: null,
  zip: null,
  defaultPayType: null,
  defaultProjectId: null,
  defaultProjectName: null,
  ...over,
});

test("the mask shows the last four digits and nothing else", () => {
  assert.equal(maskTax(FAKE_A), "***-**-1234");
  assert.equal(maskTax("000001234"), "***-**-1234", "the dashes are not what is counted");
  assert.equal(maskTax("12-3"), "***-**-****", "fewer than four digits shows none of them");
  assert.equal(maskTax(""), "", "nothing on file is not a mask over nothing");
  assert.equal(maskTax("  "), "");
});

test("a value is encrypted differently every time and reads back only with its own key", () => {
  const one = tax.encrypt(FAKE_A);
  const two = tax.encrypt(FAKE_A);
  assert.notEqual(one, two, "a fresh random start for every value");
  assert.ok(one.startsWith(TAX_PREFIX) && isEncryptedTax(one));
  assert.ok(!one.includes(FAKE_A));
  assert.equal(isEncryptedTax(FAKE_A), false);
  assert.equal(isEncryptedTax(null), false);
  assert.equal(tax.decrypt(one), FAKE_A);
  assert.equal(tax.decrypt(two), FAKE_A);

  const refusal = (run: () => unknown): string => {
    try {
      run();
    } catch (err) {
      return (err as Error).message;
    }
    return "";
  };
  for (const said of [
    refusal(() => otherKey.decrypt(one)),
    refusal(() => tax.decrypt(one.slice(0, -4) + "AAAA")),
    refusal(() => tax.decrypt(FAKE_A)),
  ]) {
    assert.match(said, /cannot be read on this PC/);
    assert.ok(!/\d/.test(said), "a refusal never carries a digit of the number");
  }

  assert.equal(readTax(null, tax), "");
  assert.equal(readTax("", tax), "");
  assert.equal(readTax(FAKE_B, tax), FAKE_B, "a value an older version stored plain is still read");
  assert.equal(readTax(one, tax), FAKE_A);
  assert.throws(() => tax.encrypt(""), /no tax number/, "an empty value is never encrypted");
});

test("a new key file is written whole, never over one that is there, and never left half-written", () => {
  const keyPath = path.join(dir, "fake-org.exd");
  const first = Buffer.from("fake wrapped key, first");
  keepNewKeyFile(keyPath, first);
  assert.deepEqual(fs.readFileSync(keyPath), first);

  // A second key in its place would leave every number stored under the first unreadable.
  assert.throws(() => keepNewKeyFile(keyPath, Buffer.from("fake wrapped key, second")), /EEXIST/);
  assert.deepEqual(fs.readFileSync(keyPath), first, "the key that was there is untouched");

  // A write that fails part-way leaves no file: a half-written one would be refused as a key
  // from another PC at every start from then on.
  const failed = path.join(dir, "fake-org-failed.exd");
  assert.throws(() => keepNewKeyFile(failed, { not: "bytes" } as unknown as Buffer));
  assert.equal(fs.existsSync(failed), false);
});

test("the migration encrypts every plain value, reads each one back, and leaves the rest alone", () => {
  const { db, file } = fakeDb();
  const already = tax.encrypt(FAKE_C);
  const a = oldRow(db, "Fake Person A", FAKE_A);
  const b = oldRow(db, "Fake Person B", FAKE_B);
  const none = oldRow(db, "Fake Person C", null);
  const blank = oldRow(db, "Fake Person D", "");
  const done = oldRow(db, "Fake Person E", already);
  assert.equal(countLegacyTax(db), 2);
  assert.ok(fs.readFileSync(file).includes(FAKE_A), "the file holds the plain number before the migration");

  assert.deepEqual(migrateTaxNumbers(db, tax), { encrypted: 2, alreadyEncrypted: 1 });

  for (const [id, plain] of [[a, FAKE_A], [b, FAKE_B]] as const) {
    assert.ok(isEncryptedTax(stored(db, id)));
    assert.equal(readTax(stored(db, id), tax), plain);
  }
  assert.equal(stored(db, none), null, "no number on file stays no number");
  assert.equal(stored(db, blank), "", "an empty value is never encrypted");
  assert.equal(stored(db, done), already, "a value that was already encrypted is not encrypted twice");
  assert.equal(countLegacyTax(db), 0);
  // The old row bytes are cleared, not only replaced: a copy of the file must not give them up.
  const bytes = fs.readFileSync(file);
  assert.ok(!bytes.includes(FAKE_A) && !bytes.includes(FAKE_B), "no plain number is left anywhere in the file");
});

test("a second run changes nothing", () => {
  const { db } = fakeDb();
  oldRow(db, "Fake Person A", FAKE_A);
  oldRow(db, "Fake Person B", FAKE_B);
  migrateTaxNumbers(db, tax);
  const first = everyStored(db);

  assert.deepEqual(migrateTaxNumbers(db, tax), { encrypted: 0, alreadyEncrypted: 2 });
  assert.deepEqual(everyStored(db), first);
});

test("one value that reads back wrong rolls the whole migration back", () => {
  const { db } = fakeDb();
  oldRow(db, "Fake Person A", FAKE_A);
  oldRow(db, "Fake Person B", FAKE_B);
  // The first value reads back right and is written; the second comes back as another number.
  let reads = 0;
  const lying: TaxCrypto = {
    encrypt: tax.encrypt,
    decrypt: (value) => ((reads += 1) === 2 ? "000-00-0000" : tax.decrypt(value)),
  };

  assert.throws(
    () => migrateTaxNumbers(db, lying),
    (err: Error) => /did not read back the same/.test(err.message) && !/\d/.test(err.message)
  );
  assert.equal(reads, 2, "the first value had already been written when the second one failed");
  assert.deepEqual(everyStored(db), [FAKE_A, FAKE_B], "every value is plain again, the first one included");
  assert.equal(countLegacyTax(db), 2, "so the next launch tries again");
});

test("a backup that fails skips the migration and leaves every value as it was", async () => {
  for (const runBackup of [
    async () => ({ ok: false as const, error: "The fake copy did not finish." }),
    async (): Promise<never> => {
      throw new Error("The fake copy did not finish.");
    },
  ]) {
    const { db } = fakeDb();
    oldRow(db, "Fake Person A", FAKE_A);
    let migrated = false;
    const outcome = await runTaxMigration({
      countLegacy: () => countLegacyTax(db),
      openKey: () => tax,
      runBackup,
      migrate: (key) => {
        migrated = true;
        return migrateTaxNumbers(db, key);
      },
    });

    assert.equal(outcome.kind, "backupFailed");
    assert.equal(migrated, false);
    assert.deepEqual(everyStored(db), [FAKE_A]);
    const notice = taxMigrationNotice(outcome);
    assert.equal(notice?.tone, "err");
    assert.match(notice?.text ?? "", /backup that has to come first did not finish\. The fake copy did not finish\./);
  }
});

test("the launch runs the backup only when a plain value exists, and the migration only after it", async () => {
  const { db } = fakeDb();
  const order: string[] = [];
  const parts = {
    countLegacy: () => countLegacyTax(db),
    openKey: () => {
      order.push("key");
      return tax;
    },
    runBackup: async () => {
      order.push("backup");
      return { ok: true as const, path: FAKE_FOLDER };
    },
    migrate: (key: TaxCrypto) => {
      order.push("migrate");
      return migrateTaxNumbers(db, key);
    },
  };

  oldRow(db, "Fake Person A", tax.encrypt(FAKE_A));
  const nothingToDo = await runTaxMigration(parts);
  assert.equal(nothingToDo.kind, "none");
  assert.deepEqual(order, [], "no key, no backup, no migration");
  assert.equal(taxMigrationNotice(nothingToDo), null, "and nothing to tell him");

  oldRow(db, "Fake Person B", FAKE_B);
  const outcome = await runTaxMigration(parts);
  assert.deepEqual(outcome, { kind: "encrypted", count: 1, folder: FAKE_FOLDER });
  assert.deepEqual(order, ["key", "backup", "migrate"]);
  assert.equal(countLegacyTax(db), 0);
  const notice = taxMigrationNotice(outcome);
  assert.equal(notice?.tone, "ok");
  assert.ok(notice?.text.includes(FAKE_FOLDER), "the toast names the backup folder");
  assert.ok(!notice?.text.includes("000-00"), "and never a number");

  assert.equal((await runTaxMigration(parts)).kind, "none", "the next launch finds nothing left to do");
  assert.deepEqual(order, ["key", "backup", "migrate"]);
});

test("a key that cannot be opened costs no backup, and a rolled-back migration says so without a number", async () => {
  const { db } = fakeDb();
  oldRow(db, "Fake Person A", FAKE_A);
  let copies = 0;
  const runBackup = async () => {
    copies += 1;
    return { ok: true as const, path: FAKE_FOLDER };
  };

  const noKey = await runTaxMigration({
    countLegacy: () => countLegacyTax(db),
    openKey: () => {
      throw new Error("The fake key is closed.");
    },
    runBackup,
    migrate: (key) => migrateTaxNumbers(db, key),
  });
  assert.deepEqual(noKey, { kind: "noKey", why: "The fake key is closed." });
  assert.equal(copies, 0);
  assert.equal(taxMigrationNotice(noKey)?.tone, "err");

  const rolledBack = await runTaxMigration({
    countLegacy: () => countLegacyTax(db),
    openKey: () => ({ encrypt: tax.encrypt, decrypt: () => "000-00-0000" }),
    runBackup,
    migrate: (key) => migrateTaxNumbers(db, key),
  });
  assert.equal(rolledBack.kind, "rolledBack");
  assert.equal(copies, 1);
  assert.deepEqual(everyStored(db), [FAKE_A]);
  const notice = taxMigrationNotice(rolledBack);
  assert.equal(notice?.tone, "err");
  assert.match(notice?.text ?? "", /every number was put back as it was/);
  assert.ok(notice?.text.includes(FAKE_FOLDER));
  assert.ok(!notice?.text.includes("000-00"));
});

test("a saved number is stored encrypted, the page gets the mask, and Reveal gets the whole number", () => {
  const { db } = fakeDb();
  const made = createPerson(db, ORG, form({ ssn: FAKE_A }), tax);
  const inColumn = stored(db, made.id) ?? "";
  assert.ok(isEncryptedTax(inColumn), "the column holds encrypted text");
  assert.ok(!inColumn.includes(FAKE_A));

  const page = personForPage(getPerson(db, made.id), tax);
  assert.equal(page.has_ssn, true);
  assert.equal(page.ssn_masked, "***-**-1234");
  assert.equal(page.ssn_unreadable, null);
  assert.equal("ssn" in page, false, "the stored value does not travel with the person");
  const sent = JSON.stringify(page);
  assert.ok(!sent.includes("000-00") && !sent.includes(TAX_PREFIX), "neither the number nor its encrypted form");
  assert.equal(revealTax(db, made.id, tax), FAKE_A);

  // Until the migration has run, a value an older version stored plain reads the same way.
  const old = oldRow(db, "Fake Person B", FAKE_B);
  assert.equal(personForPage(getPerson(db, old), tax).ssn_masked, "***-**-5678");
  assert.equal(revealTax(db, old, tax), FAKE_B);

  const empty = personForPage(createPerson(db, ORG, form({ name: "Fake Person C" }), tax), tax);
  assert.equal(empty.has_ssn, false);
  assert.equal(empty.ssn_masked, "");
});

test("the form sending the mask back, or nothing, leaves the stored number alone", () => {
  const { db } = fakeDb();
  const id = createPerson(db, ORG, form({ ssn: FAKE_A }), tax).id;
  const before = stored(db, id);

  updatePerson(db, id, form({ name: "Fake Person Renamed", ssn: "***-**-1234" }), tax);
  assert.equal(stored(db, id), before, "the mask is never saved as a number");
  assert.equal(getPerson(db, id).name, "Fake Person Renamed", "while the rest of the form is still saved");
  updatePerson(db, id, form({ ssn: "***-**-****" }), tax);
  assert.equal(stored(db, id), before);
  updatePerson(db, id, form(), tax);
  assert.equal(stored(db, id), before, "an untouched field leaves it alone");

  updatePerson(db, id, form({ ssn: FAKE_B }), tax);
  assert.notEqual(stored(db, id), before);
  assert.ok(isEncryptedTax(stored(db, id)));
  assert.equal(revealTax(db, id, tax), FAKE_B, "a typed number replaces it");

  updatePerson(db, id, form({ ssn: null }), tax);
  assert.equal(stored(db, id), null, "a cleared field clears it");
});

test("with the key closed nothing is destroyed and nothing is stored plain", () => {
  const { db } = fakeDb();
  const count = (): number => (db.prepare(`SELECT COUNT(*) AS n FROM employee_people`).get() as { n: number }).n;

  assert.throws(() => createPerson(db, ORG, form({ ssn: FAKE_A }), closed), /fake key is closed/);
  assert.throws(() => createPerson(db, ORG, form({ ssn: FAKE_A })), /cannot be saved/, "no key at all is refused the same way");
  assert.equal(count(), 0, "a refused save stores nothing, not even the rest of the person");

  const id = oldRow(db, "Fake Person A", tax.encrypt(FAKE_A));
  const before = stored(db, id);
  const page = personForPage(getPerson(db, id), closed);
  assert.equal(page.has_ssn, true);
  assert.equal(page.ssn_masked, "");
  assert.match(page.ssn_unreadable ?? "", /cannot be read on this PC/);
  assert.throws(() => revealTax(db, id, closed), /fake key is closed/);

  updatePerson(db, id, form({ ssn: null }), closed);
  assert.equal(stored(db, id), before, "a number that cannot be read is never cleared blind");
  assert.throws(() => updatePerson(db, id, form({ ssn: FAKE_B }), closed), /fake key is closed/);
  assert.equal(stored(db, id), before);
  updatePerson(db, id, form({ ssn: FAKE_B }), otherKey);
  assert.equal(revealTax(db, id, otherKey), FAKE_B, "only a number he typed takes its place");

  const plainOnly = createPerson(db, ORG, form({ name: "Fake Person B" }), closed);
  assert.equal(stored(db, plainOnly.id), null, "a person with no number is still saved");
});
