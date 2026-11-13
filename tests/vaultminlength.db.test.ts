/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
/* File: tests/vaultminlength.db.test.ts */
// One minimum length for the master password, twelve, on both ways in (VA-03.7): the first
// password, and a change. Every password here is made up and the database is a throwaway file
// under the temp folder.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, test } from "node:test";
import Database from "better-sqlite3-multiple-ciphers";
import { ensureVaultSchema } from "../electron/core/services/vault/db";
import { changeMasterPassword, resetLockForTest, seedMasterPassword, unlock } from "../electron/core/services/vault/lock";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fr-test-"));
const db = new Database(path.join(dir, "vault.db"));
ensureVaultSchema(db);
beforeEach(() => resetLockForTest());
after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const ELEVEN = "made-up-11c";
const TWELVE = "made-up-12ch";
const OTHER_TWELVE = "made-up-12cx";

test("the two samples are the lengths their names say", () => {
  assert.equal(ELEVEN.length, 11);
  assert.equal(TWELVE.length, 12);
});

test("a first password of eleven characters is refused", () => {
  assert.throws(() => seedMasterPassword(db, "org-short-first", ELEVEN), /at least 12 characters/);
  assert.equal(unlock(db, "org-short-first", ELEVEN).ok, false, "nothing was stored");
});

test("a change to eleven characters is refused, and the old password still opens the vault", () => {
  seedMasterPassword(db, "org-short-change", TWELVE);
  assert.throws(() => changeMasterPassword(db, "org-short-change", TWELVE, ELEVEN), /at least 12 characters/);
  resetLockForTest();
  assert.equal(unlock(db, "org-short-change", ELEVEN).ok, false);
  assert.equal(unlock(db, "org-short-change", TWELVE).ok, true);
});

test("twelve characters is enough on both ways in", () => {
  seedMasterPassword(db, "org-twelve", TWELVE);
  changeMasterPassword(db, "org-twelve", TWELVE, OTHER_TWELVE);
  resetLockForTest();
  assert.equal(unlock(db, "org-twelve", OTHER_TWELVE).ok, true);
});
