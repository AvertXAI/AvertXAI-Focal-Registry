/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
/* File: tests/vaultaccesslog.db.test.ts */
// What the access log says when a value is revealed, copied or starred (VA-03.3).
// Every value here is made up and the databases are throwaway files under the temp folder.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import Database from "better-sqlite3-multiple-ciphers";
import { ensureVaultSchema } from "../electron/core/services/vault/db";
import { createSecret, listAccessLog, listSecrets, logAccess, readSecret } from "../electron/core/services/vault/store";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fr-test-"));
const db = new Database(path.join(dir, "vault.db"));
ensureVaultSchema(db);
after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const ORG = "org-log";
const WHO = "test";
const entry = createSecret(db, ORG, WHO, { kind: "login", label: "Made-up Site", value: "made-up-value-01" });

/** Newest first, for one entry. */
function actions(uuid: string): string[] {
  return listAccessLog(db, ORG, { secretUuid: uuid }).map((row) => row.action);
}

test("a reveal and a copy are logged under their own names, and the value still comes back", () => {
  assert.equal(readSecret(db, ORG, WHO, entry.uuid, "reveal").value, "made-up-value-01");
  assert.equal(actions(entry.uuid)[0], "reveal");
  assert.equal(readSecret(db, ORG, WHO, entry.uuid, "copy").value, "made-up-value-01");
  assert.equal(actions(entry.uuid)[0], "copy");
});

test("a read with no reason, or a reason outside those two, stays a plain read", () => {
  readSecret(db, ORG, WHO, entry.uuid);
  assert.equal(actions(entry.uuid)[0], "read");
  readSecret(db, ORG, WHO, entry.uuid, "delete");
  assert.equal(actions(entry.uuid)[0], "read", "the page cannot write any action it likes");
});

test("a reveal or a copy still counts as the entry's last read", () => {
  const other = createSecret(db, ORG, WHO, { kind: "login", label: "Made-up Other", value: "made-up-value-02" });
  const lastRead = (): string | null => listSecrets(db, ORG).find((s) => s.uuid === other.uuid)?.last_read_at ?? null;
  assert.equal(lastRead(), null);
  readSecret(db, ORG, WHO, other.uuid, "copy");
  assert.notEqual(lastRead(), null);
});

test("the star is an action the log table accepts", () => {
  logAccess(db, ORG, "favourite", entry.uuid, entry.label, WHO, true, "added");
  assert.equal(actions(entry.uuid)[0], "favourite");
});

test("a vault file whose log table predates the two names still hands the value over", () => {
  const old = new Database(path.join(dir, "old.db"));
  try {
    ensureVaultSchema(old);
    // The older table, built from the app's own definition with the two names taken out.
    const made = old.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'vault_access_log'").get() as { sql: string };
    old.exec("DROP TABLE vault_access_log;");
    old.exec(made.sql.replace("'reveal',", "").replace("'copy',", ""));
    assert.throws(() => logAccess(old, ORG, "reveal", null, null, WHO, true), "the older table really does refuse the name");

    const kept = createSecret(old, ORG, WHO, { kind: "login", label: "Made-up Old", value: "made-up-value-03" });
    assert.equal(readSecret(old, ORG, WHO, kept.uuid, "reveal").value, "made-up-value-03");
    const newest = listAccessLog(old, ORG, { secretUuid: kept.uuid })[0];
    assert.equal(newest.action, "read");
    assert.equal(newest.detail, "reveal", "the reason is kept even though the name was refused");
  } finally {
    old.close();
  }
});
