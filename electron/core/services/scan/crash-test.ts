// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Scan crash/resume proof harness (mirrors runbook-shredder/smoke.ts). Headless —
//              bundle with esbuild, run under ELECTRON_RUN_AS_NODE (native module ABI). Builds a
//              throwaway synthetic tree in a TEMP directory (never a real archive), scans it,
//              SIGKILLs itself mid-run, then proves: run → crashed, cursor = last committed
//              folder, zero partial folders, and a resume that matches a clean full run.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/scan/crash-test.ts
//------------------------------------------------------------
import Database from "better-sqlite3-multiple-ciphers";
import fs from "node:fs";
import path from "node:path";
import { generateUUIDv7 } from "../utils/uuidv7";
import { ensureScanSchema, type Db } from "./db";
import { createRun, markInterruptedRuns, startRun } from "./index";

const ORG = "crash-test-org";
const KILL_AFTER_FOLDERS = 25; // SIGKILL mid-run, well before the tree's ~85 folders finish

function openTestDb(dbPath: string): Db {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  ensureScanSchema(db);
  return db;
}

function testDrive(db: Db): number {
  const existing = db.prepare("SELECT id FROM scan_drives WHERE org_id = ? AND volume_serial = 'TEST0001'").get(ORG) as
    | { id: number }
    | undefined;
  if (existing) return existing.id;
  const info = db
    .prepare(
      "INSERT INTO scan_drives (uuid, org_id, volume_serial, volume_label, filesystem, first_seen_at, last_seen_at) VALUES (?, ?, 'TEST0001', 'synthetic', 'NTFS', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
    )
    .run(generateUUIDv7(), ORG);
  return Number(info.lastInsertRowid);
}

// Deterministic synthetic tree: root + 4 top dirs x 5 subdirs x 3 leaf dirs = 84 dirs (+root),
// 5 files each level = 425 files. Throwaway, in temp — NEVER a real archive.
function buildTree(root: string): void {
  fs.rmSync(root, { recursive: true, force: true });
  const exts = ["jpg", "mp4", "txt", "cr2", "wav"];
  const writeFiles = (dir: string): void => {
    for (let f = 0; f < 5; f++) fs.writeFileSync(path.join(dir, `f${f}.${exts[f]}`), `synthetic ${f}`);
  };
  fs.mkdirSync(root, { recursive: true });
  writeFiles(root);
  for (let a = 0; a < 4; a++) {
    const da = path.join(root, `d${String(a).padStart(2, "0")}`);
    fs.mkdirSync(da);
    writeFiles(da);
    for (let b = 0; b < 5; b++) {
      const dbDir = path.join(da, `s${String(b).padStart(2, "0")}`);
      fs.mkdirSync(dbDir);
      writeFiles(dbDir);
      for (let c = 0; c < 3; c++) {
        const dc = path.join(dbDir, `t${String(c).padStart(2, "0")}`);
        fs.mkdirSync(dc);
        writeFiles(dc);
      }
    }
  }
}

interface Counts {
  runs: Array<{ id: number; status: string; folders_committed: number; files_recorded: number; errors_logged: number; resume_cursor: string | null }>;
  folderRows: number;
  fileRows: number;
  orphanFiles: number;
  rollupMismatches: number;
  cursorCommitted: boolean | null;
}
function counts(db: Db, runId?: number): Counts {
  const runs = db
    .prepare("SELECT id, status, folders_committed, files_recorded, errors_logged, resume_cursor FROM scan_runs ORDER BY id")
    .all() as Counts["runs"];
  const one = <T>(sql: string, ...args: unknown[]): T => (db.prepare(sql).get(...args) as { n: T }).n;
  const run = runId ?? runs[runs.length - 1]?.id;
  const cursor = runs.find((r) => r.id === run)?.resume_cursor ?? null;
  return {
    runs,
    folderRows: one<number>("SELECT COUNT(*) AS n FROM scan_folders WHERE run_id = ?", run),
    fileRows: one<number>("SELECT COUNT(*) AS n FROM scan_files WHERE run_id = ?", run),
    orphanFiles: one<number>(
      "SELECT COUNT(*) AS n FROM scan_files sf WHERE sf.run_id = ? AND NOT EXISTS (SELECT 1 FROM scan_folders fo WHERE fo.id = sf.folder_id)",
      run
    ),
    rollupMismatches: one<number>(
      "SELECT COUNT(*) AS n FROM scan_folders fo WHERE fo.run_id = ? AND fo.file_count <> (SELECT COUNT(*) FROM scan_files fi WHERE fi.folder_id = fo.id)",
      run
    ),
    cursorCommitted:
      cursor === null
        ? null
        : db.prepare("SELECT 1 FROM scan_folders WHERE run_id = ? AND path = ?").get(run, cursor) !== undefined,
  };
}

async function main(): Promise<void> {
  const [, , mode, treeDir, dbPath] = process.argv;
  if (!mode || !treeDir || !dbPath) throw new Error("usage: crash-test <build|crash|inspect|resume|full> <treeDir> <dbPath>");

  if (mode === "build") {
    buildTree(treeDir);
    console.log(JSON.stringify({ built: treeDir }));
    return;
  }

  const db = openTestDb(dbPath);
  if (mode === "crash") {
    const run = createRun(db, ORG, testDrive(db), treeDir, "folder");
    console.log(JSON.stringify({ runId: run.id, killAfterFolders: KILL_AFTER_FOLDERS }));
    await startRun(db, ORG, run.id, {
      onProgress: (p) => {
        if (p.foldersCommitted >= KILL_AFTER_FOLDERS) process.kill(process.pid, "SIGKILL"); // hard crash, no cleanup
      },
    });
    console.log(JSON.stringify({ unexpected: "run finished without being killed" }));
  } else if (mode === "inspect") {
    const crashedMarked = markInterruptedRuns(db); // service-start behavior: running -> crashed
    console.log(JSON.stringify({ crashedMarked, ...counts(db) }, null, 1));
  } else if (mode === "resume") {
    const last = db.prepare("SELECT id FROM scan_runs ORDER BY id DESC LIMIT 1").get() as { id: number };
    await startRun(db, ORG, last.id, { resume: true });
    console.log(JSON.stringify(counts(db, last.id), null, 1));
  } else if (mode === "full") {
    const run = createRun(db, ORG, testDrive(db), treeDir, "folder");
    await startRun(db, ORG, run.id);
    console.log(JSON.stringify(counts(db, run.id), null, 1));
  } else {
    throw new Error(`unknown mode ${mode}`);
  }
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
