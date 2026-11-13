/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
/* File: tests/renamestop.db.test.ts */
// Runs the real Rename engine on made-up files in the system temp folder and stops it part way,
// the way the quit guard's "Stop safely" does. It needs SQLite, so it runs under Electron-as-Node.
// Every file and every name here is fake: no real archive and no real database is touched.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import Database from "better-sqlite3-multiple-ciphers";
import { ensureRenameSchema } from "../electron/core/services/rename/db";
import { getBatch, renameWork, requestAbort, startRename, startRevert } from "../electron/core/services/rename/index";
import type { RenameSettings } from "../src/shared/renamePreview";

const ORG = "fake-org";
const FILES = 60;
const SETTINGS: RenameSettings = {
  prefixMode: "photo", businessName: "Fake Studio", photographerName: "Fake Shooter",
  sequenceStart: 1, sequencePad: 3, clientName: "Fake Client", projectName: "Fake Project", shootDate: "", customTag: "",
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), "fr-test-"));
const db = new Database(path.join(root, "fake.db"));
ensureRenameSchema(db);
after(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

/** Sixty small fake photos, each a different size, so a short copy cannot pass for a whole one. */
function makeSource(name: string): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir);
  for (let i = 0; i < FILES; i++) {
    fs.writeFileSync(path.join(dir, `frame_${String(i).padStart(3, "0")}.jpg`), Buffer.alloc(200 + i * 13, i + 1));
  }
  return dir;
}

/** Every file in a folder with its bytes, to prove later that the folder was left alone. */
function snapshot(dir: string): Map<string, Buffer> {
  return new Map(fs.readdirSync(dir).sort().map((name) => [name, fs.readFileSync(path.join(dir, name))]));
}
function assertUntouched(dir: string, before: Map<string, Buffer>): void {
  const now = snapshot(dir);
  assert.deepEqual([...now.keys()], [...before.keys()], `${dir} gained or lost a file`);
  for (const [name, bytes] of before) assert.ok(bytes.equals(now.get(name) as Buffer), `${name} changed`);
}

interface LedgerRow {
  source_path: string;
  copy_path: string | null;
  copy_filename: string | null;
  bytes: number;
  status: string;
}
const ledger = (batchId: number): LedgerRow[] =>
  db.prepare("SELECT source_path, copy_path, copy_filename, bytes, status FROM rename_files WHERE batch_id = ?").all(batchId) as LedgerRow[];

/** Every file in `folder` is whole and has a "copied" ledger row, and no row is without its file. */
function assertWholeAndRecorded(folder: string, batchId: number): number {
  const written = fs.readdirSync(folder);
  const rows = ledger(batchId).filter((r) => r.status === "copied");
  const byName = new Map(rows.map((r) => [r.copy_filename, r]));
  for (const name of written) {
    const row = byName.get(name);
    assert.ok(row, `${name} is on disk with no ledger row`);
    assert.equal(row.copy_path, path.join(folder, name));
    const copy = fs.readFileSync(path.join(folder, name));
    assert.equal(copy.length, row.bytes, `${name} is not the size the ledger recorded`);
    assert.ok(copy.equals(fs.readFileSync(row.source_path)), `${name} differs from the file it was copied from`);
  }
  assert.equal(rows.length, written.length, "a ledger row says copied for a file that is not there");
  return written.length;
}

test("QG-01: a rename stopped between files leaves whole copies, a ledger row for each, and an untouched source", async () => {
  const src = makeSource("src-a");
  const dest = path.join(root, "dest-a");
  const before = snapshot(src);
  const seen: Array<{ done: number; total: number }> = [];

  const batchId = await startRename(db, ORG, {
    sources: [src], destination: dest, settings: SETTINGS,
    // The very first report comes before any file is copied, so a stop there would prove nothing.
    // The first report that names a file comes with copies on disk whose ledger rows are not yet
    // written: exactly the rows a quit used to lose.
    onProgress: (p) => {
      if (seen.length > 0 || !p.currentFile) return;
      const work = renameWork().find((w) => w.batchId === p.batchId);
      seen.push({ done: work?.done ?? -1, total: work?.total ?? -1 });
      requestAbort(p.batchId);
    },
  });

  const copied = assertWholeAndRecorded(dest, batchId);
  assert.ok(copied > 0 && copied < FILES, `the stop landed part way, not at ${copied} of ${FILES}`);
  assert.deepEqual(seen, [{ done: copied, total: FILES }], "the engine reported the wrong count while running");
  const batch = getBatch(db, ORG, batchId);
  assert.equal(batch?.status, "aborted");
  assert.equal(batch?.files_copied, copied);
  assert.equal(ledger(batchId).length, copied, "nothing but the copied files is in the ledger");
  assertUntouched(src, before);
  assert.deepEqual(renameWork(), [], "a finished batch must not stay listed as running");

  // What the guard tells him is safe to do next: run the same rename again.
  const again = await startRename(db, ORG, { sources: [src], destination: dest, settings: SETTINGS, onProgress: () => {} });
  const rows = ledger(again);
  assert.equal(getBatch(db, ORG, again)?.status, "completed");
  assert.equal(rows.filter((r) => r.status === "skipped").length, copied, "the copies already made are skipped");
  assert.equal(rows.filter((r) => r.status === "copied").length, FILES - copied);
  assert.equal(fs.readdirSync(dest).length, FILES);
  for (const r of rows) {
    const copy = fs.readFileSync(path.join(dest, r.copy_filename as string));
    assert.ok(copy.equals(fs.readFileSync(r.source_path)), `${r.copy_filename} differs from its source after the second run`);
  }
  assertUntouched(src, before);
});

test("QG-01: a revert stopped between files is recorded as aborted, with a ledger row for every file it restored", async () => {
  const src = makeSource("src-b");
  const copies = path.join(root, "copies-b");
  const restored = path.join(root, "restored-b");
  const batchId = await startRename(db, ORG, { sources: [src], destination: copies, settings: SETTINGS, onProgress: () => {} });
  const beforeSrc = snapshot(src);
  const beforeCopies = snapshot(copies);
  let asked = false;

  const result = await startRevert(db, ORG, {
    batchId, copiesFolder: copies, destination: restored,
    onProgress: (p) => {
      if (asked || !p.currentFile) return;
      asked = true;
      requestAbort(p.batchId);
    },
  });

  const written = assertWholeAndRecorded(restored, result.revertBatchId);
  assert.ok(written > 0 && written < FILES, `the stop landed part way, not at ${written} of ${FILES}`);
  assert.equal(result.restored, written);
  const batch = getBatch(db, ORG, result.revertBatchId);
  assert.equal(batch?.status, "aborted");
  assert.equal(batch?.files_copied, written);
  assert.equal(ledger(result.revertBatchId).length, written, "nothing but the restored files is in the ledger");
  assertUntouched(src, beforeSrc);
  assertUntouched(copies, beforeCopies);
  assert.deepEqual(renameWork(), []);
});
