// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Proof for the authored-document schema — that both shapes coexist, that an authored
//              note needs no file, that a duplicate import refuses, and that the ensure is rerunnable.
//              Developer harness, excluded from the package by the build.files whitelist.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/mindmerge/schema-proof.ts
//------------------------------------------------------------
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { nowIso, openMindMergeDb } from "./db";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-schema-proof-"));
const db = openMindMergeDb("org-test", dir);
const names = new Set(
  (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name)
);

// 1 — both shapes stand side by side. This is the ruling, expressed as a test.
for (const t of ["mindmerge_docs", "mindmerge_doc_folders", "mindmerge_notes", "tags", "mindmerge_note_tags", "mindmerge_secret_refs"]) {
  assert.ok(names.has(t), `missing table ${t}`);
}

// 2 — an authored note has no file. Two of them coexist, which the ingest table's
//     file_path UNIQUE NOT NULL could never allow.
const ins = db.prepare("INSERT INTO mindmerge_docs (uuid, org_id, kind, title, body, updated_at) VALUES (?,?,?,?,?,?)");
ins.run("u1", "org-test", "note", "Authored", "body", nowIso());
ins.run("u2", "org-test", "note", "Also authored", "body", nowIso());
assert.equal((db.prepare("SELECT COUNT(*) c FROM mindmerge_docs").get() as { c: number }).c, 2);

// 3 — the import guard. The same file twice must refuse at the database, not in the importer.
const imp = db.prepare(
  "INSERT INTO mindmerge_docs (uuid, org_id, kind, title, body, source_path, updated_at) VALUES (?,?,?,?,?,?,?)"
);
imp.run("u3", "org-test", "note", "Imported", "b", "D:/x/a.md", nowIso());
assert.throws(() => imp.run("u4", "org-test", "note", "Imported again", "b", "D:/x/a.md", nowIso()), /UNIQUE/);

// 4 — rerunnable. A second open on the same directory must not throw.
const db2 = openMindMergeDb("org-test-2", dir);

// BOTH handles close before the directory goes. Windows holds a lock on an open SQLite file, so
// leaving the second one open makes the cleanup fail — which is how this proof failed the first time.
db.close();
db2.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log("SCHEMA PROOF 4/4 OK — both shapes coexist · authored notes need no file · duplicate import refused · rerunnable");
