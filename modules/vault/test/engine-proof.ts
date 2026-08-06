// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry — Vault standalone lane
// Description: THE ENGINE PROOF — the one command that says whether the vault works. Assert-based,
//              no framework (mindmerge/smoke.ts precedent). Runs the WHOLE engine against an
//              in-memory SQLite database: schema, the lock gate, create/read/supersede/archive with
//              credential extras, the metadata surfaces, version history, the access log, the
//              generator, health, and the seed load + exact purge — then re-proves the hard rules
//              that must never regress. NEVER touches a real database file; the real vault is not
//              opened, read, or written by this file.
//
//              RUN IT:  npm run vault:proof     (from the repo root — see modules/vault/README.md)
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: modules/vault/test/engine-proof.ts
//------------------------------------------------------------
import assert from "node:assert/strict";
import Database from "better-sqlite3-multiple-ciphers";
import { ensureVaultSchema, VAULT_ACTIONS } from "../electron/core/services/vault/db";
import {
  archiveSecret,
  createSecret,
  listAccessLog,
  listSecrets,
  listVersions,
  readSecret,
  restoreSecret,
  setFavourite,
  supersedeSecret,
  updateSecretMeta,
} from "../electron/core/services/vault/store";
import * as lock from "../electron/core/services/vault/lock";
import { getAllSettings, getSetting, setSetting } from "../electron/core/services/vault/settings";
import { estimateStrength, generatePassword } from "../electron/core/services/vault/generator";
import { analyseHealth } from "../electron/core/services/vault/health";
import { loadSeed, purgeSeed, seedStatus } from "../electron/core/services/vault/seed";
import { SEED_ENTRIES } from "../electron/core/services/vault/seed-data";

const db = new Database(":memory:");
db.pragma("foreign_keys = ON");
const ORG = "proof-org";
const CALLER = "proof";
let pass = 0;
const ok = (msg: string): void => {
  pass += 1;
  console.log(`OK  ${msg}`);
};

// ── 1. schema ──────────────────────────────────────────────────────────────────────────────────
ensureVaultSchema(db);
ensureVaultSchema(db); // idempotent — this runs on every boot
const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'vault_%' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
assert.deepEqual(tables, ["vault_access_log", "vault_folders", "vault_secret_versions", "vault_secrets", "vault_settings"]);
const secretCols = (db.pragma("table_info(vault_secrets)") as { name: string }[]).map((c) => c.name);
assert.ok(!secretCols.includes("value"), "vault_secrets must never hold a credential");
assert.ok(secretCols.includes("username") && secretCols.includes("url") && secretCols.includes("favourite"));
ok(`schema: 5 tables, idempotent, vault_secrets is credential-free (${secretCols.length} metadata columns)`);
assert.ok(VAULT_ACTIONS.length >= 30, "the action vocabulary is deliberately wide");
ok(`access-log vocabulary: ${VAULT_ACTIONS.length} actions accepted (ruled "10x it, just in case")`);

// ── 2. the lock gate [master-password-placeholder] ─────────────────────────────────────────────
lock.resetLockForTest();
lock.ensureMasterPassword(db, ORG);
lock.ensureMasterPassword(db, ORG); // idempotent — must not mint a second verifier
assert.equal(lock.isUnlocked(db, ORG), false, "the vault starts LOCKED");
assert.equal(lock.unlock(db, ORG, "wrong-password").ok, false);
assert.equal(lock.unlock(db, ORG, "").ok, false);
assert.equal(lock.lockState(db, ORG).failedAttempts, 2, "failures are counted");
assert.equal(lock.unlock(db, ORG, "lurpz.bmt@gmail.com").ok, true, "the placeholder credential opens it");
assert.equal(lock.lockState(db, ORG).failedAttempts, 0, "a success clears the counter");
assert.equal(lock.isUnlocked(db, ORG), true);
// the verifier is a hash, not the password
const stored = db.prepare("SELECT value FROM vault_settings WHERE key = 'lock.verifier'").get() as { value: string };
assert.ok(!stored.value.includes("lurpz"), "the password is NEVER stored in readable form");
ok("lock: starts locked, wrong password refused and counted, placeholder opens it, verifier is a hash");

// ── 3. create with credential extras ───────────────────────────────────────────────────────────
const meta = createSecret(db, ORG, CALLER, {
  kind: "login",
  label: "Hetzner",
  value: "n7Q$ka2!vX9m",
  fullName: "Paul Cruz",
  username: "root",
  url: "console.hetzner.cloud",
  notes: "Root only — use the deploy user for Coolify.",
  extras: { backupCodes: ["1194-8823", "7702-3410"], securityQuestions: [{ question: "First pet?", answer: "Maggie" }] },
});
assert.equal(meta.version, 1);
assert.equal(meta.username, "root");
assert.ok(!("value" in meta) && !("extras" in meta), "create returns METADATA — no credential comes back");
ok("create: metadata returned, credential and extras stored on the version row");

// ── 4. THE HARD RULE — lists carry metadata, never a credential ────────────────────────────────
const listed = listSecrets(db, ORG);
assert.equal(listed.length, 1);
assert.ok(listed.every((r) => !("value" in r) && !("extras" in r)), "a list must never carry a credential");
assert.equal(listed[0].url, "console.hetzner.cloud", "…but it does carry the metadata the screen needs");
ok("list: metadata only — no value, no extras, on any row");

// ── 5. the one logged read returns everything ──────────────────────────────────────────────────
const got = readSecret(db, ORG, CALLER, meta.uuid);
assert.equal(got.value, "n7Q$ka2!vX9m");
assert.deepEqual(got.extras?.backupCodes, ["1194-8823", "7702-3410"]);
assert.equal(got.extras?.securityQuestions?.[0].answer, "Maggie");
ok("read: the single value-bearing path returns password, backup codes and security answers");

// ── 6. supersede appends; the old version survives ─────────────────────────────────────────────
supersedeSecret(db, ORG, CALLER, meta.uuid, "second-value", { backupCodes: ["9999-0000"] });
supersedeSecret(db, ORG, CALLER, meta.uuid, "third-value");
const versions = listVersions(db, ORG, meta.uuid);
assert.deepEqual(versions.map((v) => v.version), [3, 2, 1], "newest first, nothing lost");
assert.ok(versions.every((v) => !("value" in v)), "the history is NOT a second way out for credentials");
const history = db.prepare("SELECT version, value FROM vault_secret_versions ORDER BY version").all() as { version: number; value: string }[];
assert.deepEqual(history.map((h) => h.value), ["n7Q$ka2!vX9m", "second-value", "third-value"]);
assert.equal(readSecret(db, ORG, CALLER, meta.uuid).value, "third-value");
ok("supersede: v1 intact, three versions on record, read returns the newest");

// ── 7. metadata edits never touch the credential history ───────────────────────────────────────
const edited = updateSecretMeta(db, ORG, CALLER, meta.uuid, { label: "Hetzner — avert-core-01", username: "deploy" });
assert.equal(edited.label, "Hetzner — avert-core-01");
assert.equal(edited.version, 3, "renaming is not a new version of the password");
setFavourite(db, ORG, meta.uuid, true);
assert.equal(listSecrets(db, ORG)[0].favourite, 1);
ok("metadata: edits and favourites change nothing about the credential or its version");

// ── 8. archive is soft and reversible; the value survives ──────────────────────────────────────
archiveSecret(db, ORG, CALLER, meta.uuid, "rotated out");
assert.equal(listSecrets(db, ORG).length, 0, "archived is hidden by default");
assert.equal(listSecrets(db, ORG, true).length, 1, "…and visible when asked for");
assert.equal(readSecret(db, ORG, CALLER, meta.uuid).value, "third-value", "archived stays readable");
assert.throws(() => supersedeSecret(db, ORG, CALLER, meta.uuid, "nope"), /archived/i);
restoreSecret(db, ORG, CALLER, meta.uuid);
assert.equal(listSecrets(db, ORG).length, 1, "restore always succeeds");
ok("archive: soft, hidden, still readable, frozen against supersede, restorable");

// ── 9. the generator ───────────────────────────────────────────────────────────────────────────
for (let i = 0; i < 200; i++) {
  const p = generatePassword({ length: 20, symbols: true, numbers: true, uppercase: true, lowercase: true });
  assert.equal(p.length, 20);
  assert.ok(/[a-z]/.test(p) && /[A-Z]/.test(p) && /[0-9]/.test(p), "every ticked class actually appears");
}
const noRepeat = generatePassword({ length: 20, noRepeats: true });
assert.equal(new Set(noRepeat).size, 20, "no-repeats means no repeats");
assert.throws(() => generatePassword({ length: 40, noRepeats: true, lowercase: true, uppercase: false, numbers: false, symbols: false }), /at least/i);
assert.ok(estimateStrength("doggy123").level <= 1, "a dumb password must score badly");
assert.ok(estimateStrength(generatePassword({ length: 20 })).level >= 3, "a generated one must score well");
ok("generator: 200 samples all correct, no-repeats honoured, impossible options refused, weak scores weak");

// ── 10. settings are config-as-data with no seeding ────────────────────────────────────────────
assert.equal(db.prepare("SELECT COUNT(*) c FROM vault_settings WHERE key LIKE 'view.%'").get<{ c: number }>()?.c ?? 0, 0);
assert.equal(getSetting(db, ORG, "view.mode"), "list", "an unwritten key reads its default");
setSetting(db, ORG, "view.mode", "grid");
assert.equal(getSetting(db, ORG, "view.mode"), "grid", "…and a written one sticks");
assert.throws(() => setSetting(db, ORG, "lock.verifier", "hack"), /Unknown vault setting/);
assert.ok(Object.keys(getAllSettings(db, ORG)).length > 15);
ok("settings: defaults unseeded, writes stick, internal keys unreachable from the bridge");

// ── 11. seed load — through the REAL services ──────────────────────────────────────────────────
assert.equal(seedStatus(db, ORG).present, false);
const seeded = loadSeed(db, ORG);
assert.ok(seeded.ok, `seed load failed: ${seeded.error ?? ""}`);
assert.equal(seeded.created, SEED_ENTRIES.length);
assert.equal(loadSeed(db, ORG).ok, false, "a second load refuses rather than doubling");
const afterSeed = listSecrets(db, ORG);
assert.equal(afterSeed.length, SEED_ENTRIES.length + 1, "the seed sits beside the entry made by hand");
const gmail = afterSeed.find((s) => s.label === "Google / Gmail");
assert.ok(gmail && gmail.username === "paulcruz@brightflashmedia.com", "the ruled identity is in place");
assert.ok(readSecret(db, ORG, CALLER, gmail!.uuid).extras?.backupCodes?.length === 3, "backup codes came through");
ok(`seed: ${seeded.created} entries loaded through the real services, ${seeded.superseded} with rotation history`);

// ── 12. health finds the engineered problems ───────────────────────────────────────────────────
const report = analyseHealth(db, ORG);
assert.equal(report.total, afterSeed.length);
assert.ok(report.weak >= 10, `expected many weak seeded passwords, got ${report.weak}`);
assert.ok(report.reused >= 8, `expected the reuse habit to show, got ${report.reused}`);
assert.ok(report.items[0].score <= report.items[report.items.length - 1].score, "worst first");
const reasons = JSON.stringify(report.items);
for (const e of SEED_ENTRIES) assert.ok(!reasons.includes(e.password), "a health verdict must never echo a password");
ok(`health: ${report.weak} weak, ${report.reused} reused, ${report.stale} stale, score ${report.score} — and zero passwords in the output`);

// ── 13. THE HARD RULE — the access log holds no credential, ever ───────────────────────────────
const log = JSON.stringify(listAccessLog(db, ORG, { limit: 5000 }));
for (const e of SEED_ENTRIES) assert.ok(!log.includes(e.password), `access log leaked ${e.company}'s password`);
for (const v of ["n7Q$ka2!vX9m", "second-value", "third-value", "lurpz.bmt@gmail.com", "1194-8823", "Maggie"]) {
  assert.ok(!log.includes(v), `access log leaked "${v}"`);
}
assert.ok(log.includes("unlock_failed"), "a failed unlock IS recorded");
ok(`access log: ${listAccessLog(db, ORG, { limit: 5000 }).length} rows, zero credential bytes, failures recorded`);

// ── 14. purge is exact and complete ────────────────────────────────────────────────────────────
const purged = purgeSeed(db, ORG);
assert.ok(purged.ok);
assert.equal(purged.removed, SEED_ENTRIES.length);
const left = listSecrets(db, ORG, true);
assert.equal(left.length, 1, "the hand-made entry SURVIVES an exact purge");
assert.equal(left[0].label, "Hetzner — avert-core-01");
assert.equal((db.prepare("SELECT COUNT(*) c FROM vault_secret_versions").get() as { c: number }).c, 3, "only the survivor's versions remain");
const seededUuids = new Set(afterSeed.filter((s) => s.uuid !== meta.uuid).map((s) => s.uuid));
const logAfter = listAccessLog(db, ORG, { limit: 5000 });
assert.ok(logAfter.every((r) => !r.secret_uuid || !seededUuids.has(r.secret_uuid)), "seeded log rows went too (the ruled exception)");
assert.ok(logAfter.some((r) => r.action === "purge"), "…and the purge itself is on the record");
assert.equal(purgeSeed(db, ORG).ok, false, "purging nothing refuses politely");
ok(`purge: ${purged.removed} removed exactly, hand-made work untouched, seeded log rows cleared, purge recorded`);

// ── 15. the gate actually gates ────────────────────────────────────────────────────────────────
lock.lock(db, ORG);
assert.equal(lock.isUnlocked(db, ORG), false, "locking takes effect immediately");
setSetting(db, ORG, "lock.enabled", "0");
assert.equal(lock.isUnlocked(db, ORG), true, "turning the lock off is a supported choice");
setSetting(db, ORG, "lock.enabled", "1");
assert.equal(lock.isUnlocked(db, ORG), false, "…and turning it back on re-locks");
ok("lock gate: locks, unlocks, and honours its own setting");

console.log(`\nALL ${pass} VAULT ENGINE CHECKS PASSED`);
