/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
/* File: tests/jobsources.db.test.ts */
// Drives the real Scan, Rename and Migrate engines through the work registry, the way the quit
// guard does: list what is running, answer "Stop safely", and check what is left behind. It needs
// SQLite, so it runs under Electron-as-Node. Every file, name and row here is fake.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import Database from "better-sqlite3-multiple-ciphers";
import { ensureMigrateSchema } from "../electron/core/services/migrate/db";
import * as migrate from "../electron/core/services/migrate/engine";
import { ensureRenameSchema } from "../electron/core/services/rename/db";
import * as rename from "../electron/core/services/rename/index";
import { ensureScanSchema } from "../electron/core/services/scan/db";
import * as scan from "../electron/core/services/scan/index";
import { jobsLeftRunning, registerJobSources } from "../electron/core/services/work/jobSources";
import { actOnWork, runningWork, type WorkLine } from "../electron/core/services/work/registry";
import type { RenameSettings } from "../src/shared/renamePreview";

const ORG = "fake-org";
const SETTINGS: RenameSettings = {
  prefixMode: "photo", businessName: "Fake Studio", photographerName: "Fake Shooter",
  sequenceStart: 1, sequencePad: 3, clientName: "Fake Client", projectName: "Fake Project", shootDate: "", customTag: "",
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), "fr-test-"));
const db = new Database(path.join(root, "fake.db"));
ensureScanSchema(db);
ensureRenameSchema(db);
ensureMigrateSchema(db);
registerJobSources(() => db);
after(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

let serial = 0;
const fakeUuid = (): string => `fake-uuid-${++serial}`;

/** A folder of small fake files, each a different size. Returns the folder. */
function makeFiles(name: string, count: number, ext: string): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < count; i++) {
    fs.writeFileSync(path.join(dir, `frame_${String(i).padStart(3, "0")}.${ext}`), Buffer.alloc(200 + i * 13, i + 1));
  }
  return dir;
}

/** Every file under a folder, at any depth. */
function filesUnder(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? filesUnder(path.join(dir, e.name)) : [path.join(dir, e.name)]
  );
}

/** Answers "Stop safely" for everything listed, once, and keeps the lines that were listed. */
function stopOnce(listed: WorkLine[][]): void {
  if (listed.length > 0) return;
  const lines = runningWork();
  listed.push(lines);
  for (const line of lines) actOnWork(line.id, "stopSafely");
}

test("QG-01: nothing is listed while no engine is running", () => {
  assert.deepEqual(runningWork(), []);
});

test("QG-01: a job a crash left running is listed once, and not again after the engines relabel it", () => {
  const org = "fake-org-crashed"; // its own org, so the queued job below is never picked up by another test
  const run = db.prepare(
    "INSERT INTO scan_runs (uuid, org_id, root_path, status, scan_unit, files_recorded, total_files_expected) VALUES (?, ?, ?, ?, 'drive', ?, 100)"
  );
  run.run(fakeUuid(), org, "E:\\", "running", 62);
  run.run(fakeUuid(), org, "E:\\", "paused", 10);
  run.run(fakeUuid(), org, "E:\\", "completed", 100);
  run.run(fakeUuid(), org, "E:\\", "counting", 0);

  const batch = db.prepare("INSERT INTO rename_batches (uuid, org_id, kind, destination_path, status) VALUES (?, ?, 'rename', ?, ?)");
  const cut = Number(batch.run(fakeUuid(), org, path.join(root, "nowhere"), "running").lastInsertRowid);
  batch.run(fakeUuid(), org, path.join(root, "nowhere"), "aborted");
  const file = db.prepare(
    "INSERT INTO rename_files (uuid, org_id, batch_id, source_path, source_filename, status) VALUES (?, ?, ?, 'fake-path', 'fake-name', 'copied')"
  );
  for (let i = 0; i < 3; i++) file.run(fakeUuid(), org, cut);

  const job = db.prepare(
    "INSERT INTO migrate_jobs (uuid, org_id, target_kind, root_paths, classes, extensions, status, folders_walked, total_folders_expected) VALUES (?, ?, 'folders', '[]', '[]', '[]', ?, ?, ?)"
  );
  job.run(fakeUuid(), org, "running", 120, 4000);
  job.run(fakeUuid(), org, "queued", 0, null);
  job.run(fakeUuid(), org, "aborted", 5, 4000);

  const bundle = db.prepare(
    "INSERT INTO migrate_bundles (uuid, org_id, job_id, destination_root, status, item_count, items_copied, items_failed) VALUES (?, ?, 1, ?, ?, 60, 15, 1)"
  );
  bundle.run(fakeUuid(), org, path.join(root, "nowhere"), "running");
  bundle.run(fakeUuid(), org, path.join(root, "nowhere"), "aborted");

  const left = jobsLeftRunning(db);
  assert.deepEqual(left.map((l) => l.text), [
    "Scan of drive E: stopped at 62 percent",
    "Rename stopped after 3 recorded files",
    "Migrate search stopped at 120 of 4,000 folders",
    "Bundle export stopped at 16 of 60 files",
  ]);
  for (const l of left) {
    assert.ok(l.next.length > 0, `${l.text} says nothing about what is safe to do next`);
    assert.ok(!Number.isNaN(Date.parse(l.at)), `${l.text} has no usable time`);
  }

  // The engines' own relabel, as it runs at every start. After it, the same jobs are not listed
  // a second time at the launch after that.
  scan.markInterruptedRuns(db);
  rename.markInterruptedRenames(db);
  migrate.markInterruptedMigrate(db);
  assert.deepEqual(jobsLeftRunning(db), []);
});

test("QG-01: a running rename is listed, and Stop safely through the registry stops it between files", async () => {
  const src = makeFiles("src-r", 60, "jpg");
  const dest = path.join(root, "dest-r");
  const listed: WorkLine[][] = [];

  const batchId = await rename.startRename(db, ORG, {
    sources: [src], destination: dest, settings: SETTINGS,
    // The first report that names a file: by then copies are on disk.
    onProgress: (p) => {
      if (p.currentFile) stopOnce(listed);
    },
  });

  const copied = fs.readdirSync(dest).length;
  assert.ok(copied > 0 && copied < 60, `the stop landed part way, not at ${copied} of 60`);
  assert.deepEqual(listed.map((lines) => lines.map((l) => l.text)), [[`Rename: ${copied} of 60 files`]]);
  assert.deepEqual(listed[0][0].actions, ["finish", "stopSafely"]);
  assert.ok(listed[0][0].next);
  assert.equal(rename.getBatch(db, ORG, batchId)?.status, "aborted");
  assert.deepEqual(runningWork(), []);
});

test("QG-01: Stop safely stops the search in flight and holds the queue, and the queue still works afterwards", async () => {
  const tree = path.join(root, "search-tree");
  for (let i = 0; i < 6; i++) makeFiles(path.join("search-tree", `shoot-${i}`), 1, "jpg");
  const opts: migrate.CreateJobOpts = {
    label: "fake search", targetKind: "folders", driveId: null, rootPaths: [tree], classes: ["custom"],
    extensions: ["jpg"], optFolderNames: false, optSubfolders: true, optHidden: false,
  };
  const first = migrate.createJob(db, ORG, opts);
  const second = migrate.createJob(db, ORG, opts);
  const listed: WorkLine[][] = [];

  await migrate.pumpQueue(db, ORG, () => stopOnce(listed));

  assert.deepEqual(listed.map((lines) => lines.map((l) => l.text)), [["Migrate search: counting folders · 1 more queued"]]);
  assert.equal(migrate.getJob(db, first)?.status, "aborted");
  assert.equal(migrate.getJob(db, second)?.status, "queued", "a queued search must not start after Stop safely");
  assert.equal(migrate.isEngineBusy(), false);
  assert.deepEqual(runningWork(), []);

  // A quit that is cancelled after the stop must not leave the queue dead for the session.
  await migrate.pumpQueue(db, ORG, () => {});
  assert.equal(migrate.getJob(db, second)?.status, "completed");
  assert.equal(migrate.getJob(db, second)?.files_found, 6);
});

test("QG-01: a bundle stopped between files is recorded as aborted and its manifest lists what was copied", async (t) => {
  const org = "fake-org-bundle"; // its own org, so the search queue above never sees this job
  const src = makeFiles("src-m", 20, "jpg");
  const destRoot = path.join(root, "dest-m");
  fs.mkdirSync(destRoot);
  const jobId = migrate.createJob(db, org, {
    label: "fake bundle", targetKind: "folders", driveId: null, rootPaths: [src], classes: ["custom"],
    extensions: ["jpg"], optFolderNames: false, optSubfolders: true, optHidden: false,
  });
  const item = db.prepare(
    "INSERT INTO migrate_items (uuid, org_id, job_id, asset_class, extension, source_path, filename, size_bytes, selected) VALUES (?, ?, ?, 'custom', 'jpg', ?, ?, ?, 1)"
  );
  for (const name of fs.readdirSync(src)) {
    item.run(fakeUuid(), org, jobId, path.join(src, name), name, fs.statSync(path.join(src, name)).size);
  }
  // The engine refuses to start without the destination drive's free space, which it asks
  // PowerShell for. A machine that cannot answer cannot run this test.
  const pre = migrate.bundlePreflight(db, jobId, destRoot);
  if (!pre.ok) {
    t.skip(`the free-space check could not run here: ${pre.error}`);
    return;
  }
  const listed: WorkLine[][] = [];
  let asked = false;

  await migrate.startBundle(db, org, jobId, destRoot, () => {
    if (asked) return;
    asked = true;
    // The first report comes before any file is copied. One turn of the event loop later is the
    // engine's first pause between files, which is the earliest the guard could ask.
    setImmediate(() => stopOnce(listed));
  });

  const bundle = migrate.listBundles(db, jobId)[0];
  const onDisk = filesUnder(bundle.destination_root).filter((p) => path.basename(p) !== "manifest.json");
  assert.ok(onDisk.length > 0 && onDisk.length < 20, `the stop landed part way, not at ${onDisk.length} of 20`);
  assert.deepEqual(listed.map((lines) => lines.map((l) => l.text)), [[`Bundle export: ${onDisk.length} of 20 files`]]);
  assert.equal(bundle.status, "aborted");
  assert.equal(bundle.items_copied, onDisk.length);

  const rows = db.prepare("SELECT dest_path, bytes, status FROM migrate_bundle_items WHERE bundle_id = ?").all(bundle.id) as Array<{
    dest_path: string; bytes: number; status: string;
  }>;
  assert.deepEqual(rows.map((r) => r.dest_path).sort(), [...onDisk].sort(), "every copied file has a ledger row, and nothing else does");
  for (const r of rows) {
    assert.equal(r.status, "copied");
    assert.equal(fs.statSync(r.dest_path).size, r.bytes);
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(bundle.destination_root, "manifest.json"), "utf8")) as {
    itemCount: number; files: Array<{ originalPath: string; destination: string }>;
  };
  assert.equal(manifest.itemCount, onDisk.length);
  for (const f of manifest.files) {
    const copy = fs.readFileSync(path.join(bundle.destination_root, f.destination));
    assert.ok(copy.equals(fs.readFileSync(f.originalPath)), `${f.destination} differs from its original`);
  }
  assert.deepEqual(migrate.bundleWork(), []);
  assert.deepEqual(runningWork(), []);
});

test("QG-01: Stop safely drops a count and pauses a scan, and the paused scan resumes to the end", async () => {
  // .bmp is media the scan records without handing it to a metadata reader, so the fake bytes
  // are never parsed.
  const tree = path.join(root, "scan-tree");
  for (let i = 0; i < 5; i++) makeFiles(path.join("scan-tree", `shoot-${i}`), 2, "bmp");

  const counted = scan.createRun(db, ORG, 1, tree, "folder");
  const countListed: WorkLine[][] = [];
  await scan.countRun(db, ORG, counted.id, { onProgress: () => stopOnce(countListed) });
  assert.deepEqual(countListed.map((lines) => lines.map((l) => l.text)), [["Scan: folder scan-tree · counting files"]]);
  assert.equal(scan.getRun(db, counted.id).status, "aborted");
  assert.deepEqual(runningWork(), []);

  const run = scan.createRun(db, ORG, 1, tree, "folder");
  const scanListed: WorkLine[][] = [];
  const paused = await scan.startRun(db, ORG, run.id, { onProgress: () => stopOnce(scanListed) });
  assert.deepEqual(scanListed.map((lines) => lines.map((l) => l.text)), [["Scan: folder scan-tree · 0 files"]]);
  assert.equal(paused.status, "paused");
  assert.deepEqual(runningWork(), []);

  const done = await scan.startRun(db, ORG, run.id, { resume: true });
  assert.equal(done.status, "completed");
  assert.equal(done.files_recorded, 10);
});
