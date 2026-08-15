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
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3-multiple-ciphers";
import { importLocalRepos, listRepos, readReadme, saveRepo } from "../../../electron/core/services/vault/repos";
import { copyWithClear, _resetForTest } from "../../../electron/core/services/vault/clipboard";
import { ensureVaultSchema, VAULT_ACTIONS } from "../../../electron/core/services/vault/db";
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
} from "../../../electron/core/services/vault/store";
import * as lock from "../../../electron/core/services/vault/lock";
import { archiveNote, createNote, getNote, importDocs, listNotes, searchNotes, updateNote } from "../../../electron/core/services/vault/notes";
import {
  archiveNoteFolder, createNoteFolder, deleteNoteFolder, emptyNoteFolder, noteFolderCounts, noteFolderSubtree,
  setNoteFolder, unfiledNoteCount,
} from "../../../electron/core/services/vault/noteFolders";
import { getAllSettings, getSetting, setSetting } from "../../../electron/core/services/vault/settings";
import { estimateStrength, generatePassword } from "../../../electron/core/services/vault/generator";
import { analyseHealth } from "../../../electron/core/services/vault/health";
import { loadSeed, purgeSeed, seedStatus } from "../../../electron/core/services/vault/seed";
import { SEED_ENTRIES } from "../../../electron/core/services/vault/seed-data";

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
// The list is EXACT on purpose — a table appearing here unannounced is a schema change nobody
// reviewed. Grown twice since it was written: the redesign added notes/servers/dns/repos, and
// 08-11-2026 added vault_event_log (the four-level log behind the reference ids).
assert.deepEqual(tables, [
  "vault_access_log",
  "vault_dns_records",
  "vault_event_log",
  "vault_folders",
  "vault_note_folders",
  "vault_notes",
  "vault_repos",
  "vault_secret_versions",
  "vault_secrets",
  "vault_servers",
  "vault_settings",
]);
const secretCols = (db.pragma("table_info(vault_secrets)") as { name: string }[]).map((c) => c.name);
assert.ok(!secretCols.includes("value"), "vault_secrets must never hold a credential");
assert.ok(secretCols.includes("username") && secretCols.includes("url") && secretCols.includes("favourite"));
// The event log is the OTHER table that must never hold a credential — same rule, same reason.
const logCols = (db.pragma("table_info(vault_event_log)") as { name: string }[]).map((c) => c.name);
assert.ok(!logCols.includes("value") && !logCols.includes("password"), "vault_event_log must never hold a credential");
assert.ok(logCols.includes("request_id"), "the reference id is the whole point of the log");
// The note tree: a real parent_id, and notes carry a reference to it. Both added 08-11-2026.
const nfCols = (db.pragma("table_info(vault_note_folders)") as { name: string }[]).map((c) => c.name);
assert.ok(nfCols.includes("parent_id"), "note folders nest");
const noteCols = (db.pragma("table_info(vault_notes)") as { name: string }[]).map((c) => c.name);
assert.ok(noteCols.includes("folder_id"), "notes reference the tree");
assert.ok(noteCols.includes("folder"), "the legacy text column is KEPT — it is the migration source");
ok(`schema: ${tables.length} tables, idempotent, vault_secrets and vault_event_log are credential-free (${secretCols.length} metadata columns)`);
assert.ok(VAULT_ACTIONS.length >= 30, "the action vocabulary is deliberately wide");
ok(`access-log vocabulary: ${VAULT_ACTIONS.length} actions accepted (ruled "10x it, just in case")`);

// ── 1b. legacy access-log rebuild — a pre-mount vault must widen its CHECK, rows intact ────────
// (The bug this pins down: Jason's dev org could not unlock post-mount because the pre-mount table
//  rejected the 'unlock' action. Found at the 08-14 mount gate; must never return.)
{
  const legacy = new Database(":memory:");
  legacy.pragma("foreign_keys = ON");
  // The table EXACTLY as the pre-mount app created it: same columns, four-action CHECK.
  legacy.exec(
    "CREATE TABLE vault_access_log (\n" +
      "  id INTEGER PRIMARY KEY,\n" +
      "  uuid TEXT UNIQUE NOT NULL,\n" +
      "  org_id TEXT NOT NULL,\n" +
      "  ts TEXT NOT NULL,\n" +
      "  action TEXT NOT NULL CHECK (action IN ('create','read','supersede','archive')),\n" +
      "  secret_uuid TEXT,\n" +
      "  secret_label TEXT,\n" +
      "  caller TEXT NOT NULL,\n" +
      "  granted INTEGER NOT NULL CHECK (granted IN (0, 1)),\n" +
      "  detail TEXT,\n" +
      "  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n" +
      "  updated_at DATETIME\n" +
      ");"
  );
  legacy
    .prepare(
      "INSERT INTO vault_access_log (uuid, org_id, ts, action, secret_uuid, secret_label, caller, granted) VALUES ('legacy-row', ?, '2026-08-01T00:00:00Z', 'read', null, null, 'proof', 1)"
    )
    .run(ORG);
  ensureVaultSchema(legacy);
  const kept = legacy.prepare("SELECT COUNT(*) AS n FROM vault_access_log WHERE action = 'read'").get() as { n: number };
  assert.equal(kept.n, 1, "the legacy row survives the rebuild");
  // this exact insert is what threw pre-rebuild
  legacy
    .prepare(
      "INSERT INTO vault_access_log (uuid, org_id, ts, action, secret_uuid, secret_label, caller, granted) VALUES ('new-row', ?, '2026-08-14T00:00:00Z', 'unlock', null, null, 'proof', 1)"
    )
    .run(ORG);
  const ddl = (legacy.prepare("SELECT sql FROM sqlite_master WHERE name = 'vault_access_log'").get() as { sql: string }).sql;
  assert.ok(ddl.includes("'unlock'"), "the stored DDL now carries the full vocabulary");
  legacy.close();
  ok("legacy access-log: pre-mount 4-action CHECK rebuilt to the full vocabulary, rows preserved");
}

// ── 2. the lock gate [master-password-placeholder] ─────────────────────────────────────────────
lock.resetLockForTest();
lock.ensureMasterPassword(db, ORG);
lock.ensureMasterPassword(db, ORG); // idempotent — must not mint a second verifier
// [master-password-placeholder] — the initial is DERIVED from device identity (ruled 2026-08-14).
// Recomputing it here proves the seeded verifier matches what the dev-mode reveal will show.
const INITIAL_MASTER = lock.deriveInitialMasterPassword();
assert.ok(/^[A-Za-z0-9]{16}$/.test(INITIAL_MASTER), "the derived initial is exactly 16 alphanumerics, no symbols");
ok("derived initial: machine-derived, recomputable, 16 alphanumerics");
assert.equal(lock.isUnlocked(db, ORG), false, "the vault starts LOCKED");
assert.equal(lock.unlock(db, ORG, "wrong-password").ok, false);
assert.equal(lock.unlock(db, ORG, "").ok, false);
assert.equal(lock.lockState(db, ORG).failedAttempts, 2, "failures are counted");
assert.equal(lock.unlock(db, ORG, INITIAL_MASTER).ok, true, "the derived initial credential opens it");
assert.equal(lock.lockState(db, ORG).failedAttempts, 0, "a success clears the counter");
assert.equal(lock.isUnlocked(db, ORG), true);
// the verifier is a hash, not the password
const stored = db.prepare("SELECT value FROM vault_settings WHERE key = 'lock.verifier'").get() as { value: string };
assert.ok(!stored.value.includes(INITIAL_MASTER), "the password is NEVER stored in readable form");
ok("lock: starts locked, wrong password refused and counted, derived initial opens it, verifier is a hash");

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

// ── 6b. TIER-1 FIX 2 — rotation carries extras forward; it never strips the active version ──────
// v2 was superseded WITH an explicit extras edit; v3 was superseded with NONE. Before the fix, v3
// landed with extras = null — rotating a password silently stripped backup codes, security answers
// and the SSH passphrase from the version every read returns. The old version kept them, so nothing
// was destroyed — but the ACTIVE credential lied.
{
  const ex = (v: number): string | null =>
    (db.prepare("SELECT extras FROM vault_secret_versions WHERE version = ?").get(v) as { extras: string | null }).extras;
  assert.ok(ex(1) !== null && ex(2) !== null, "both edited versions stored their extras");
  assert.notEqual(ex(2), ex(1), "an EXPLICIT extras edit replaces — v2's differ from v1's");
  assert.equal(ex(3), ex(2), "a no-edit rotation CARRIES the prior extras byte-for-byte");
  const active = readSecret(db, ORG, CALLER, meta.uuid);
  assert.deepEqual(active.extras?.backupCodes, ["9999-0000"], "the active version still answers with the backup codes");
  ok("supersede extras: an edit replaces, a plain rotation carries — the active version never silently strips");
}

// ── 7. metadata edits never touch the credential history ───────────────────────────────────────
const edited = updateSecretMeta(db, ORG, CALLER, meta.uuid, { label: "Hetzner — avert-core-01", username: "deploy" });
assert.equal(edited.label, "Hetzner — avert-core-01");
assert.equal(edited.version, 3, "renaming is not a new version of the password");
setFavourite(db, ORG, meta.uuid, true);
assert.equal(listSecrets(db, ORG)[0].favourite, 1);
ok("metadata: edits and favourites change nothing about the credential or its version");

// ── 7b. TIER-1 FIX 4 — an SSH public-key EDIT persists ─────────────────────────────────────────
// The service always supported publicKey on update; the entry form only sent it on CREATE, so an
// edit looked saved and silently reverted on the next open. The form now sends it for ssh_key —
// this pins the contract that patch relies on: sent = saved, absent = kept, empty = cleared.
{
  const SSH_ORG = "ssh-org"; // its own org — sections 8/14 assert EXACT counts on the main one
  const KEY_V1 = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEdvWg9N7dW/WZnaVDiQr2lexPRxF9arzJhs2Mq7guYD jason@old";
  const KEY_V2 = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAr8pQnJ0eV6xKcT2mWdY9uZbN3sLfHgXvE4iQjRkTpM jason@new";
  const ssh = createSecret(db, SSH_ORG, CALLER, {
    kind: "ssh_key", label: "deploy key", value: "unused-private-half-placeholder",
    publicKey: KEY_V1, extras: { passphrase: "correct horse" },
  });
  assert.equal(ssh.public_key, KEY_V1, "the key lands on create");
  const reKeyed = updateSecretMeta(db, SSH_ORG, CALLER, ssh.uuid, { label: "deploy key", publicKey: KEY_V2 });
  assert.equal(reKeyed.public_key, KEY_V2, "an edited public key STICKS");
  const untouched = updateSecretMeta(db, SSH_ORG, CALLER, ssh.uuid, { label: "deploy key (renamed)" });
  assert.equal(untouched.public_key, KEY_V2, "a patch that does not mention the key keeps it");
  assert.deepEqual(readSecret(db, SSH_ORG, CALLER, ssh.uuid).extras?.passphrase, "correct horse",
    "the passphrase rides the version row, unbothered by metadata edits");
  ok("ssh public key: create stores it, an edit sticks, an unrelated patch keeps it");
}

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
for (const v of ["n7Q$ka2!vX9m", "second-value", "third-value", INITIAL_MASTER, "1194-8823", "Maggie"]) {
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
// Scoped to ORG deliberately (08-15-2026): section 7b keeps an ssh_key fixture in its own org, so
// the whole-file count is no longer the purge's to answer. Within the purged org it stays EXACT.
assert.equal((db.prepare("SELECT COUNT(*) c FROM vault_secret_versions WHERE org_id = ?").get(ORG) as { c: number }).c, 3, "only the survivor's versions remain");
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


// ── the import duplicate guard (08-12-2026) ────────────────────────────────────────────────────
// Jason imported ~2,000 files and the folder read 4,178 — the same documents pulled in four or five
// times across repeated runs. The guard is a PARTIAL UNIQUE INDEX, so this is a database guarantee
// rather than a check the importer has to remember.
{
  const twice = { name: "a.md", rel: "x/a.md", path: "D:/dev/x/a.md", text: "hello", birthtimeMs: 0, mtimeMs: 0 };
  const first = importDocs(db, ORG, [twice], {});
  assert.equal(first.created, 1, "the first import creates it");
  const second = importDocs(db, ORG, [twice], {});
  assert.equal(second.created, 0, "the SAME file does not come in twice");
  assert.equal(second.skipped, 1, "…and it is reported as skipped, never silently dropped");

  // A different file from the same folder still imports — the guard must not block new work.
  const other = importDocs(db, ORG, [{ name: "b.md", rel: "x/b.md", path: "D:/dev/x/b.md", text: "hi", birthtimeMs: 0, mtimeMs: 0 }], {});
  assert.equal(other.created, 1, "a new file in an already-imported folder still arrives");

  // Notes written IN the app carry no source path, and must be free to share that absence.
  createNote(db, ORG, { kind: "note", title: "hand-written one", body: "" });
  createNote(db, ORG, { kind: "note", title: "hand-written two", body: "" });

  // And the index is the real backstop — a direct insert of a duplicate path must be refused.
  assert.throws(
    () => db.prepare("INSERT INTO vault_notes (uuid, org_id, kind, title, body, source_path, created_at) VALUES (?,?,?,?,?,?,?)")
      .run("dupe-uuid", ORG, "note", "sneaky", "", "D:/dev/x/a.md", new Date().toISOString()),
    /UNIQUE/,
    "the partial unique index refuses a duplicate source_path"
  );
  ok("import guard: the same file cannot arrive twice, new files still can, hand-written notes unaffected");
}


// ── the import arithmetic, and WHERE the skipped ones went (08-12-2026) ────────────────────────
// Jason: "_source says it has 2078 files, but the imported modal says different" — 2,084 already
// here against a folder reading 2,078. Nothing on screen could account for the 6, so the report was
// indistinguishable from a bug. It is not one: the tree hides archived notes and the import guard
// does not. This pins BOTH — the totals must sum, and the split must name the difference.
{
  const ORG4 = "import-count-org";
  const file = (n: number): Record<string, unknown> =>
    ({ name: `f${n}.md`, rel: `src/f${n}.md`, path: `D:/src/f${n}.md`, text: `body ${n}`, birthtimeMs: 0, mtimeMs: 0 });
  const all = [1, 2, 3, 4, 5].map(file);

  const first = importDocs(db, ORG4, all, { folder: "src", mirror: true });
  assert.equal(first.created, 5, "five files in, five notes out");
  assert.equal(first.scanned, first.created + first.skipped + first.failed,
    "SCANNED === CREATED + SKIPPED + FAILED — the totals reconcile by construction, not by luck");

  // Put one on the Archived shelf and unfile another. Now the folder tree and the import guard are
  // legitimately looking at different sets — exactly Jason's situation.
  const rows = listNotes(db, ORG4, undefined, false).rows;
  archiveNote(db, ORG4, rows[0].uuid);
  setNoteFolder(db, ORG4, rows[1].uuid, null);

  const again = importDocs(db, ORG4, all, { folder: "src", mirror: true });
  assert.equal(again.created, 0, "nothing new — every file is already in the vault");
  assert.equal(again.skipped, 5, "all five skipped");
  assert.equal(again.skippedFiled + again.skippedUnfiled + again.skippedArchived, again.skipped,
    "THE SPLIT SUMS TO THE TOTAL — a breakdown that does not add up is worse than no breakdown");
  assert.equal(again.skippedArchived, 1, "the archived one is counted as archived, not as filed");
  assert.equal(again.skippedUnfiled, 1, "the unfiled one is counted as unfiled");
  assert.equal(again.skippedFiled, 3, "leaving 3 filed");

  // AND THE PAYOFF: skippedFiled is the number the sidebar shows. That equality is the whole reason
  // the split exists — it turns "2,084 vs 2,078" into an arithmetic anyone can check on screen.
  const tree = noteFolderCounts(db, ORG4);
  const shown = Object.values(tree).length > 0 ? Math.max(...Object.values(tree)) : 0;
  assert.equal(shown, again.skippedFiled,
    "the folder's own count EQUALS skippedFiled — the gap to `skipped` is the archived and unfiled ones");

  ok("import counts: scanned reconciles, the skip split sums, and skippedFiled matches the tree exactly");
}


// ── folder delete + the Unfiled count (08-12-2026) ─────────────────────────────────────────────
// Jason: deleted a folder holding 7 notes, Unfiled went 6 -> 7 instead of staying at 6 (delete) or
// reaching 13 (keep). Both readings cannot be right, so the two paths and the counter are pinned
// here rather than reasoned about.
{
  const ORG2 = "folder-proof-org";
  const mk = (title: string, folderId: number | null): void => {
    const n = createNote(db, ORG2, { kind: "note", title, body: "x" });
    if (folderId != null) setNoteFolder(db, ORG2, n.uuid, folderId);
  };

  // Six loose notes, then a parent folder with a child, 7 notes between them.
  for (let i = 0; i < 6; i++) mk(`loose-${i}`, null);
  const parent = createNoteFolder(db, ORG2, "parent", null);
  const child = createNoteFolder(db, ORG2, "child", parent.id);
  for (let i = 0; i < 4; i++) mk(`p-${i}`, parent.id);
  for (let i = 0; i < 3; i++) mk(`c-${i}`, child.id);

  assert.equal(unfiledNoteCount(db, ORG2), 6, "six loose notes to start");
  assert.equal(noteFolderCounts(db, ORG2)[parent.id], 7, "parent counts its own 4 plus the child's 3");
  assert.deepEqual(noteFolderSubtree(db, ORG2, parent.id), { folders: 2, notes: 7, directNotes: 4, archived: 0 },
    "the confirm is told 2 folders and 7 notes BEFORE anything happens");

  // EMPTY — every note in the SUBTREE goes to Unfiled, folders stay, nothing is deleted.
  const emptied = emptyNoteFolder(db, ORG2, parent.id);
  assert.equal(emptied.movedNotes, 7, "all 7 — the parent's 4 AND the child's 3, not just the direct ones");
  assert.equal(unfiledNoteCount(db, ORG2), 13, "6 + 7 = 13, which is the number Jason expected to see");
  assert.equal(noteFolderCounts(db, ORG2)[child.id], 0, "the child folder still exists and is now empty");

  // DELETE — the whole subtree, notes included, and Unfiled must NOT move.
  const p2 = createNoteFolder(db, ORG2, "p2", null);
  const c2 = createNoteFolder(db, ORG2, "c2", p2.id);
  for (let i = 0; i < 4; i++) mk(`p2-${i}`, p2.id);
  for (let i = 0; i < 3; i++) mk(`c2-${i}`, c2.id);
  const before = unfiledNoteCount(db, ORG2);
  const wiped = deleteNoteFolder(db, ORG2, p2.id);
  assert.equal(wiped.deletedNotes, 7, "EVERYTHING in the folder — subfolders and their notes included");
  assert.equal(wiped.deletedFolders, 2, "both folders went");
  assert.equal(unfiledNoteCount(db, ORG2), before,
    "UNFILED MUST NOT MOVE — deleting is not unfiling, and there is no longer a path that confuses the two");

  // A note created WITH a folder must land in it — not in Unfiled to be moved by a second call.
  const filed = createNote(db, ORG2, { kind: "note", title: "born filed", body: "", folderId: child.id });
  assert.equal(getNote(db, ORG2, filed.uuid).folder_id, child.id, "createNote files it directly");

  ok("folders: EMPTY unfiles the whole subtree, DELETE removes it entirely, createNote files directly");
}


// ── the THIRD door, and the count that made the tree look broken (08-12-2026) ──────────────────
// Jason: the note trashbin offers cancel/delete/archive; the folder prompt offered only two. And he
// archived a note, deleted its folder, and watched the parent's count fall by TWO for one delete.
// Both behaviours are pinned here: archive-a-folder is real, and the two counts differ for a stated
// reason rather than by accident.
{
  const ORG3 = "folder-archive-org";
  const mk = (title: string, folderId: number | null): string => {
    const n = createNote(db, ORG3, { kind: "note", title, body: "x" });
    if (folderId != null) setNoteFolder(db, ORG3, n.uuid, folderId);
    return n.uuid;
  };

  const top = createNoteFolder(db, ORG3, "top", null);
  const sub = createNoteFolder(db, ORG3, "sub", top.id);
  for (let i = 0; i < 3; i++) mk(`t-${i}`, top.id);
  const archivedOne = mk("s-archived", sub.id);
  mk("s-live", sub.id);

  // THE DIVERGENCE, made explicit. Archive one note and the two counts stop matching — legitimately.
  archiveNote(db, ORG3, archivedOne);
  assert.equal(noteFolderCounts(db, ORG3)[top.id], 4, "the TREE hides archived notes: 5 filed, 4 shown");
  const sub1 = noteFolderSubtree(db, ORG3, top.id);
  assert.equal(sub1.notes, 5, "the CONFIRM counts them: a delete would take all 5");
  assert.equal(sub1.archived, 1,
    "and it now says how many are archived — the one number that explains why 5 and 4 are both right");

  // ARCHIVE THE FOLDER — every live note to the shelf, folders gone, NOTHING erased.
  const before = listNotes(db, ORG3, undefined, true).total;
  const r = archiveNoteFolder(db, ORG3, top.id);
  assert.equal(r.archivedNotes, 4, "the 4 live ones moved; the already-archived one was not re-stamped");
  assert.equal(r.deletedFolders, 2, "both folders removed — an archived tree of empty boxes is litter");
  assert.equal(listNotes(db, ORG3, undefined, true).total, before + 4,
    "ARCHIVE IS NOT DELETE — every note is still in the vault, on the Archived shelf");
  assert.equal(listNotes(db, ORG3, undefined, false).total, 0, "and none of them is on the working shelf");
  assert.equal(unfiledNoteCount(db, ORG3), 0,
    "archived notes are not 'unfiled' — Unfiled is the working shelf's overflow and must not absorb them");

  ok("folder archive: every note kept and restorable, folders removed, and the tree/confirm counts reconcile");
}


// ── search: words not a phrase, title before mention, and an excerpt that shows the match ───────
// Jason 08-12-2026, all three in one report: "when i search for builders audit, i get no hits, when
// i should", and "i should [not] have to scroll all the way down for that specific keyword like
// buildersaudit". The old query was one %needle% LIKE ordered by updated_at, so adjacent-words-only
// matching and pure recency were both baked in. This pins the replacement.
{
  const ORG4 = "search-org";
  const mk = (title: string, body: string): void => { createNote(db, ORG4, { kind: "note", title, body }); };

  // The note actually named after the words — written FIRST, so recency ordering would bury it.
  mk("IDEAS-BUILDERSAUDIT.md", "Project: BuildersAudit. Parent: AvertXAI Umbrella.");
  mk("Builders Audit — handoff", "the two words, spaced, in the title");
  mk("Quarterly review", "the audit ran long and the builders were late"); // reversed AND far apart
  // ...under a pile of notes that only MENTION them, each one newer than the last.
  for (let i = 0; i < 12; i++) mk(`STATUS-${i}.md`, `Product state. ${"filler ".repeat(60)}buildersaudit was mentioned here in passing.`);

  const one = searchNotes(db, ORG4, "buildersaudit", 50);
  assert.equal(one.length, 13, "one term: the title hit plus all 12 body mentions");
  assert.equal(one[0].title, "IDEAS-BUILDERSAUDIT.md",
    "RELEVANCE, NOT RECENCY — the note named after the word sorts above 12 newer notes that mention it");

  // TWO WORDS, ANY ORDER. Under the old single %builders audit% LIKE this returned NOTHING — the
  // words had to be adjacent and in that order.
  const two = searchNotes(db, ORG4, "builders audit", 50);
  assert.equal(two[0].title, "IDEAS-BUILDERSAUDIT.md", "still the note named for the words");
  assert.ok(two.some((n) => n.title === "Builders Audit — handoff"), "the spaced title is found");
  assert.ok(two.some((n) => n.title === "Quarterly review"),
    "and so is a body that says them BACKWARDS, six words apart — which is the whole point");
  assert.deepEqual(
    searchNotes(db, ORG4, "audit builders", 50).map((n) => n.uuid),
    two.map((n) => n.uuid),
    "order of the typed words changes nothing"
  );
  assert.equal(searchNotes(db, ORG4, "builders nonesuch", 50).length, 0,
    "AND, not OR — one term missing means no hit, or a second word could only ever add noise");

  // THE EXCERPT IS THE MATCH. A body hit 400 characters in used to show the head of the file, so
  // twenty markdown notes produced twenty identical-looking rows explaining nothing.
  const deep = one.find((n) => n.title === "STATUS-0.md");
  assert.ok(deep, "the body mention is in the results");
  assert.ok(deep.excerpt.toLowerCase().includes("buildersaudit"),
    "the window is cut around the term, not off the front of the file");
  assert.ok(!deep.excerpt.startsWith("Product state."), "which means it is NOT the head of the file");
  // A title-only hit has nowhere better to point, and still gets an excerpt rather than an empty cell.
  const titleOnly = two.find((n) => n.title === "Builders Audit — handoff");
  assert.ok(titleOnly && titleOnly.excerpt.length > 0, "a title match falls back to the head of the body");

  assert.deepEqual(searchNotes(db, ORG4, "   ", 50), [], "whitespace is not a search");
  // Punctuation is part of the term, not syntax. (LIKE's own wildcards % and _ still act as
  // wildcards inside a term — a widened match, never an injection, since every term is a bound
  // parameter. Worth knowing before someone reports "STATUS_0 found STATUS-0".)
  assert.equal(searchNotes(db, ORG4, "STATUS-0.md", 50)[0].title, "STATUS-0.md",
    "a hyphenated, dotted filename searches as one term");

  ok("note search: AND across words, title beats mention, and the excerpt shows why the row is there");
}


// ── a note names itself from its own first heading ──────────────────────────────────────────────
// Jason 08-12-2026: "this md file auto saved, but the file to the left, still says untitled".
{
  const ORG5 = "title-org";
  const save = (uuid: string, body: string): string => updateNote(db, ORG5, uuid, { body }).title;

  const a = createNote(db, ORG5, { kind: "note", title: "Untitled", body: "" });
  assert.equal(save(a.uuid, "# Remote Desktop Idea\n\nWebRTC inside Electron."), "Remote Desktop Idea",
    "the placeholder is replaced by the leading heading, the same rule import has always used");
  assert.equal(save(a.uuid, "# Something Else\n\nchanged my mind"), "Remote Desktop Idea",
    "and NEVER again — once a note has a name it is the note's, not the heading's");

  const b = createNote(db, ORG5, { kind: "note", title: "Untitled", body: "" });
  assert.equal(save(b.uuid, "just prose, no heading at all"), "Untitled",
    "prose is not a title — half a sentence in the list would be its own bug");
  assert.equal(save(b.uuid, "### Deep heading works too"), "Deep heading works too", "h1 through h3 count");

  const c = createNote(db, ORG5, { kind: "note", title: "My own name", body: "" });
  assert.equal(save(c.uuid, "# Ignore me"), "My own name", "a title you chose is never overwritten");

  const d = createNote(db, ORG5, { kind: "note", title: "Untitled", body: "" });
  assert.equal(updateNote(db, ORG5, d.uuid, { title: "Untitled", body: "  # Padded  " }).title, "Padded",
    "leading whitespace on the heading line is trimmed, not stored");

  ok("note titles: a hand-made note adopts its first heading exactly once, and never overrides yours");
}


// ── the scan reads READMEs, and never overwrites one you wrote ───────────────────────────────────
// Jason 08-13-2026: "ik there are readme's in these folders, but the app isnt reading any of them".
{
  const ORG6 = "repo-org";
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vault-readme-"));
  const repoDir = path.join(tmp, "world-monitor");
  fs.mkdirSync(repoDir);
  fs.writeFileSync(path.join(repoDir, "README.md"), "# World Monitor\n\nWhat it does.", "utf8");

  assert.equal(readReadme(repoDir), "# World Monitor\n\nWhat it does.", "the file is read verbatim");
  assert.equal(readReadme(path.join(tmp, "nothing-here")), "", "a folder with none returns empty, never throws");
  // Lower-case spelling is just as common in the wild as the shouty one.
  const alt = path.join(tmp, "alt");
  fs.mkdirSync(alt);
  fs.writeFileSync(path.join(alt, "readme.md"), "lower", "utf8");
  assert.equal(readReadme(alt), "lower", "readme.md counts too");

  // FIRST scan: the snapshot lands.
  importLocalRepos(db, ORG6, [{ name: "world-monitor", localPath: repoDir, remoteUrl: "", branch: "main", readme: readReadme(repoDir) }]);
  const one = listRepos(db, ORG6).find((r) => r.name === "world-monitor");
  assert.ok(one?.readme_md?.startsWith("# World Monitor"), "a scanned repo arrives WITH its README");

  // A HAND EDIT, then a rescan. The edit must survive — a rescan that silently replaces what you
  // typed with what happens to be on disk is the bug this CASE expression exists to prevent.
  saveRepo(db, ORG6, { uuid: one!.uuid, name: "world-monitor", readmeMd: "MY OWN NOTES" });
  importLocalRepos(db, ORG6, [{ name: "world-monitor", localPath: repoDir, remoteUrl: "", branch: "main", readme: "# World Monitor\n\nWhat it does." }]);
  assert.equal(listRepos(db, ORG6).find((r) => r.name === "world-monitor")?.readme_md, "MY OWN NOTES",
    "a rescan NEVER overwrites a README a human wrote");

  // And a scan that finds nothing must not wipe what is already stored.
  importLocalRepos(db, ORG6, [{ name: "world-monitor", localPath: repoDir, remoteUrl: "", branch: "main", readme: "" }]);
  assert.equal(listRepos(db, ORG6).find((r) => r.name === "world-monitor")?.readme_md, "MY OWN NOTES",
    "an empty read is not a delete");

  fs.rmSync(tmp, { recursive: true, force: true });
  ok("repo scan: READMEs are read off disk, fill only an empty snapshot, and never clobber an edit");
}

// ── the clipboard clear actually happens — and never eats the user's own copy ────────────────────
// Tier-1 fix 1 (vault-broken-patch.md): clipboard.clear_seconds shipped with ZERO readers, so the
// promised clear never ran. The helper is proven here with hand-driven ports: the fake clock
// exposes the armed callback so the proof IS the timer firing, not a sleep.
{
  const fake = { text: "pre-existing", read: () => fake.text, write: (t: string) => { fake.text = t; }, clear: () => { fake.text = ""; } };
  let armed: (() => void) | null = null;
  let armedMs = 0;
  let cancelled = 0;
  const clock = {
    set: (fn: () => void, ms: number): unknown => { armed = fn; armedMs = ms; return { fn }; },
    clear: (_t: unknown): void => { cancelled += 1; armed = null; },
  };

  // copy → timer fires → cleared. The claim the product has been making, finally true.
  copyWithClear("hunter2", 30, fake, clock);
  assert.equal(fake.text, "hunter2", "the value lands on the clipboard");
  assert.equal(armedMs, 30_000, "the timer is armed with the setting's seconds");
  armed!();
  assert.equal(fake.text, "", "after the timer, the clipboard is empty");

  // copy → the user copies something else → the timer must NOT clobber it.
  copyWithClear("s3cret", 30, fake, clock);
  fake.write("the user's own later copy");
  armed!();
  assert.equal(fake.text, "the user's own later copy", "a later copy by the user survives the timer");

  // "0" means never — no timer is armed at all.
  armed = null;
  copyWithClear("keep-me", 0, fake, clock);
  assert.equal(fake.text, "keep-me", "the copy itself still happens");
  assert.equal(armed, null, "zero arms nothing — never means never");
  // A malformed setting must fail SAFE (no clear), not throw or arm garbage.
  copyWithClear("still-here", Number.NaN, fake, clock);
  assert.equal(armed, null, "NaN arms nothing");

  // A second copy cancels the first timer — one pending clear, ever.
  const before = cancelled;
  copyWithClear("first", 30, fake, clock);
  copyWithClear("second", 30, fake, clock);
  assert.equal(cancelled, before + 1, "re-copying cancels the previous timer");
  armed!();
  assert.equal(fake.text, "", "the surviving timer clears the surviving value");

  _resetForTest();
  ok("clipboard: copy clears after the timer, spares the user's later copy, honours 0/NaN, one pending timer");
}

console.log(`\nALL ${pass} VAULT ENGINE CHECKS PASSED`);
