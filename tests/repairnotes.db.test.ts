// The damaged-note finder against a throwaway database under the temp folder. Every note here is
// made up, and so are the workspace ids: nothing is read from, or written to, a real database.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import Database from "better-sqlite3-multiple-ciphers";
import { createSchema, generateUUIDv7 } from "../electron/core/services/mindmerge/db";
import { listDamagedDocs, readDocBody } from "../electron/core/services/mindmerge/repair";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "fr-test-"));
const db = new Database(path.join(root, "fake.db"));
createSchema(db);
after(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

function addNote(orgId: string, title: string, body: string): string {
  const uuid = generateUUIDv7();
  db.prepare("INSERT INTO mindmerge_docs (uuid, org_id, kind, title, body) VALUES (?, ?, 'note', ?, ?)").run(uuid, orgId, title, body);
  return uuid;
}

test("the list holds each damaged note with its kinds, and nothing clean, in code, or from another workspace", () => {
  const cache = addNote("org-a", "Fake cache", "\\*\\*Cache:\\*\\*redis\\://default:FAKE000\\@fake.internal:6379/0");
  const mail = addNote("org-a", "Fake mail", "write to fake\\@fake.internal");
  const shot = addNote("org-a", "Fake screenshot", "before\n\n![shot.png](mindmerge-pending:fake1)\n\nafter");
  addNote("org-a", "Fake clean", "**Cache:**redis://default:FAKE000@fake.internal:6379/0");
  addNote("org-a", "Fake code", "```\ngrep 'a\\@b' https\\://fake.internal \\*\\*k:\\*\\*v\n```");
  addNote("org-b", "Fake other workspace", "write to fake\\@fake.internal");

  assert.deepEqual(listDamagedDocs(db, "org-a"), [
    { uuid: cache, title: "Fake cache", kinds: ["scheme", "at", "label"] },
    { uuid: mail, title: "Fake mail", kinds: ["at"] },
    { uuid: shot, title: "Fake screenshot", kinds: ["picture"] },
  ]);
  assert.deepEqual(listDamagedDocs(db, "org-none"), []);
});

test("one note's text is read exactly as stored, and only inside its own workspace", () => {
  const body = "line one\r\n\\*\\*Host:\\*\\*fake.internal\n\n";
  const uuid = addNote("org-a", "Fake exact", body);
  assert.deepEqual(readDocBody(db, "org-a", uuid), { body });
  assert.equal(readDocBody(db, "org-b", uuid), null);
  assert.equal(readDocBody(db, "org-a", "no-such-note"), null);
});

test("finding and reading change nothing in the database", () => {
  const before = db.prepare("SELECT uuid, title, body, updated_at FROM mindmerge_docs ORDER BY id").all();
  listDamagedDocs(db, "org-a");
  for (const row of before as { uuid: string }[]) readDocBody(db, "org-a", row.uuid);
  assert.deepEqual(db.prepare("SELECT uuid, title, body, updated_at FROM mindmerge_docs ORDER BY id").all(), before);
});
