/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
/* File: tests/vaultlock.db.test.ts */
// When the lock screen may still show its first-setup note and the developer reveal (VA-01).
// Every password here is made up and the database is a throwaway file under the temp folder.
// Nothing in this file derives this machine's real generated password: the answer the app gets
// from the device is passed in as a plain function instead.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import Database from "better-sqlite3-multiple-ciphers";
import { ensureVaultSchema } from "../electron/core/services/vault/db";
import { changeMasterPassword, initialStillActive, seedMasterPassword } from "../electron/core/services/vault/lock";
import { clearInternal } from "../electron/core/services/vault/settings";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fr-test-"));
const db = new Database(path.join(dir, "vault.db"));
ensureVaultSchema(db);
after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const RECORD = "lock.chosen_at";

// Stands in for the device read, and counts how often it was asked: the rule turns a failed ask
// into "hide", so a stand-in that threw could not tell "never asked" from "asked and failed".
function machine(answer: boolean): { ask: () => boolean; asked: () => number } {
  let count = 0;
  return {
    ask: () => {
      count += 1;
      return answer;
    },
    asked: () => count,
  };
}

// A vault as every existing one stands today: a verifier written once and no record of who chose
// the password. A generated verifier and a chosen one are stored identically, so seeding a made-up
// password and taking the record away gives exactly that state.
function seedWithoutRecord(org: string, password: string): void {
  seedMasterPassword(db, org, password);
  clearInternal(db, org, RECORD);
}

test("a fresh install still on its generated password shows", () => {
  seedWithoutRecord("org-fresh", "made-up-generated-01");
  const m = machine(true);
  assert.equal(initialStillActive(db, "org-fresh", false, m.ask), true);
  assert.equal(m.asked(), 1);
});

test("a developer build hides when the machine says the password is not the generated one", () => {
  seedWithoutRecord("org-not-generated", "made-up-generated-02");
  assert.equal(initialStillActive(db, "org-not-generated", false, machine(false).ask), false);
});

test("once the password is changed the record is written and nothing shows again", () => {
  seedWithoutRecord("org-changed", "made-up-generated-03");
  assert.equal(initialStillActive(db, "org-changed", false, machine(true).ask), true);

  changeMasterPassword(db, "org-changed", "made-up-generated-03", "made-up-chosen-pass-03");

  const record = db.prepare("SELECT value FROM vault_settings WHERE org_id = ? AND key = ?").get("org-changed", RECORD) as
    | { value: string }
    | undefined;
  assert.match(record?.value ?? "", /^\d{4}-\d{2}-\d{2}T/, "the record is a timestamp and nothing else");
  const m = machine(true);
  assert.equal(initialStillActive(db, "org-changed", false, m.ask), false);
  assert.equal(initialStillActive(db, "org-changed", true, m.ask), false);
  assert.equal(m.asked(), 0, "the stored record answers before the machine is asked");
});

test("the record alone is enough: a password chosen at first run never shows", () => {
  seedMasterPassword(db, "org-first-run", "made-up-first-run-04");
  const m = machine(true);
  assert.equal(initialStillActive(db, "org-first-run", false, m.ask), false);
  assert.equal(initialStillActive(db, "org-first-run", true, m.ask), false);
  assert.equal(m.asked(), 0);
});

test("a change made before the record existed is proven by the rewritten verifier row", () => {
  seedWithoutRecord("org-changed-earlier", "made-up-generated-05");
  // What an earlier build's change left behind: the same row, written a second time.
  db.prepare("UPDATE vault_settings SET updated_at = ? WHERE org_id = ? AND key = 'lock.verifier'").run(
    "2099-01-01T00:00:00.000Z",
    "org-changed-earlier"
  );
  const m = machine(true);
  assert.equal(initialStillActive(db, "org-changed-earlier", false, m.ask), false);
  assert.equal(initialStillActive(db, "org-changed-earlier", true, m.ask), false);
  assert.equal(m.asked(), 0);
});

test("unknown state in a packaged build hides, and the machine is not asked", () => {
  seedWithoutRecord("org-unknown", "made-up-generated-06");
  const m = machine(true);
  assert.equal(initialStillActive(db, "org-unknown", true, m.ask), false);
  assert.equal(m.asked(), 0);
});

test("anything that cannot be answered hides", () => {
  assert.equal(initialStillActive(db, "org-never-seeded", false, machine(true).ask), false, "no verifier at all");

  seedWithoutRecord("org-no-identity", "made-up-generated-07");
  const broken = (): boolean => {
    throw new Error("made-up failure: device identity unavailable");
  };
  assert.equal(initialStillActive(db, "org-no-identity", false, broken), false, "the device read failed");

  const closed = new Database(path.join(dir, "closed.db"));
  closed.close();
  assert.equal(initialStillActive(closed, "org-fresh", false, machine(true).ask), false, "the table could not be read");
});
