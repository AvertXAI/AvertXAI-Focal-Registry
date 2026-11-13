/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
/* File: tests/vaultautolock.db.test.ts */
// The idle lock as the lock screen sees it (VA-03.2): a state read after the idle limit has passed
// must answer "locked", so a screen that keeps asking returns to the lock screen on its own.
// The password is made up and the database is a throwaway file under the temp folder.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, test } from "node:test";
import Database from "better-sqlite3-multiple-ciphers";
import { ensureVaultSchema } from "../electron/core/services/vault/db";
import { lockState, resetLockForTest, seedMasterPassword, touch, unlock } from "../electron/core/services/vault/lock";
import { setSetting } from "../electron/core/services/vault/settings";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fr-test-"));
const db = new Database(path.join(dir, "vault.db"));
ensureVaultSchema(db);

const ORG = "org-idle";
const PASSWORD = "made-up-master-pass-01";
seedMasterPassword(db, ORG, PASSWORD);

// The lock keeps its idle clock in the process, so the test moves the process clock instead of
// waiting for real minutes to pass.
const realNow = Date.now;
function minutesLater(minutes: number): void {
  const at = realNow() + minutes * 60_000;
  Date.now = () => at;
}

beforeEach(() => {
  Date.now = realNow;
  resetLockForTest();
});
after(() => {
  Date.now = realNow;
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a state read after the idle limit answers locked", () => {
  setSetting(db, ORG, "lock.auto_minutes", "5");
  assert.equal(unlock(db, ORG, PASSWORD).ok, true);
  assert.equal(lockState(db, ORG).locked, false);
  minutesLater(4);
  assert.equal(lockState(db, ORG).locked, false, "still inside the limit");
  minutesLater(6);
  assert.equal(lockState(db, ORG).locked, true);
});

test("asking for the state does not count as use", () => {
  setSetting(db, ORG, "lock.auto_minutes", "5");
  unlock(db, ORG, PASSWORD);
  minutesLater(3);
  lockState(db, ORG);
  minutesLater(6);
  assert.equal(lockState(db, ORG).locked, true, "the read at three minutes did not restart the clock");
});

test("real use pushes the limit back", () => {
  setSetting(db, ORG, "lock.auto_minutes", "5");
  unlock(db, ORG, PASSWORD);
  minutesLater(3);
  touch();
  minutesLater(6);
  assert.equal(lockState(db, ORG).locked, false, "three minutes since the last use");
  minutesLater(9);
  assert.equal(lockState(db, ORG).locked, true);
});

test("set to never, it never locks on its own", () => {
  setSetting(db, ORG, "lock.auto_minutes", "0");
  unlock(db, ORG, PASSWORD);
  minutesLater(600);
  assert.equal(lockState(db, ORG).locked, false);
});
