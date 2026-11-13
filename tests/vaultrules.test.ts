/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
/* File: tests/vaultrules.test.ts */
// The two master-password rules main and the screens share (VA-03.6 and VA-03.7): how long an
// unlock try waits after wrong passwords, and the one minimum length. Numbers only — no password,
// no database.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MASTER_PASSWORD_MIN, unlockDelayMs } from "../src/shared/vaultRules";

test("the first three wrong passwords cost no wait", () => {
  assert.deepEqual([0, 1, 2].map(unlockDelayMs), [0, 0, 0]);
});

test("after that the wait doubles from two seconds", () => {
  assert.deepEqual([3, 4, 5, 6].map(unlockDelayMs), [2000, 4000, 8000, 16000]);
});

test("the wait stops at thirty seconds however many wrong tries came before", () => {
  assert.deepEqual([7, 8, 50, 5000].map(unlockDelayMs), [30000, 30000, 30000, 30000]);
});

test("the wait never gets shorter as wrong tries add up", () => {
  for (let n = 0; n < 40; n++) assert.ok(unlockDelayMs(n + 1) >= unlockDelayMs(n), `try ${n + 1}`);
});

test("one minimum length, twelve, for the first master password and for a change", () => {
  assert.equal(MASTER_PASSWORD_MIN, 12);
});
