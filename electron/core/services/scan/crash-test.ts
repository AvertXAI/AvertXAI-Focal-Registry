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

// ---- real-media synthesis (Phase 5): metadata extraction must be provable, so the tree holds
// files with genuine parseable headers — never a real archive, never touched after creation. ----

// Minimal little-endian TIFF with IFD0 (Make, Model, ExifIFD pointer) and an Exif IFD
// (DateTimeOriginal, PixelXDimension, PixelYDimension, LensModel). This IS what sits inside a
// JPEG APP1 segment — and a bare TIFF like this is also structurally what a CR2 container is.
function buildExifTiff(make: string, model: string, lens: string, dto: string, w: number, h: number): Buffer {
  const buf = Buffer.alloc(512);
  buf.write("II", 0, "ascii");
  buf.writeUInt16LE(0x2a, 2);
  buf.writeUInt32LE(8, 4); // IFD0 at offset 8
  let dataOff = 104; // after IFD0 (8+42=50) and ExifIFD (50+54=104)
  const putString = (s: string): { off: number; len: number } => {
    const len = s.length + 1;
    buf.write(s, dataOff, "ascii");
    const off = dataOff;
    dataOff += len;
    return { off, len };
  };
  const entry = (at: number, tag: number, type: number, count: number, value: number): void => {
    buf.writeUInt16LE(tag, at);
    buf.writeUInt16LE(type, at + 2);
    buf.writeUInt32LE(count, at + 4);
    buf.writeUInt32LE(value, at + 8);
  };
  // IFD0: 3 entries, ascending tag order
  buf.writeUInt16LE(3, 8);
  const mk = putString(make);
  entry(10, 0x010f, 2, mk.len, mk.off); // Make (ASCII, offset)
  const md = putString(model);
  entry(22, 0x0110, 2, md.len, md.off); // Model
  entry(34, 0x8769, 4, 1, 50); // ExifIFD pointer -> offset 50
  buf.writeUInt32LE(0, 46); // next IFD = none
  // Exif IFD: 4 entries
  buf.writeUInt16LE(4, 50);
  const dt = putString(dto); // "YYYY:MM:DD HH:MM:SS"
  entry(52, 0x9003, 2, dt.len, dt.off); // DateTimeOriginal
  entry(64, 0xa002, 4, 1, w); // PixelXDimension (LONG inline)
  entry(76, 0xa003, 4, 1, h); // PixelYDimension
  const ln = putString(lens);
  entry(88, 0xa434, 2, ln.len, ln.off); // LensModel
  buf.writeUInt32LE(0, 100); // next IFD = none
  return buf.subarray(0, dataOff);
}

function buildJpegWithExif(tiff: Buffer): Buffer {
  const app1Body = Buffer.concat([Buffer.from("Exif\0\0", "ascii"), tiff]);
  const app1 = Buffer.alloc(4);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(app1Body.length + 2, 2); // segment length includes the length field
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, app1Body, Buffer.from([0xff, 0xd9])]);
}

// One second of silent 16-bit mono PCM at 8 kHz — a fully valid WAV any container parser reads.
function buildWav(): Buffer {
  const dataLen = 16000;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(8000, 24); // sample rate
  buf.writeUInt32LE(16000, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataLen, 40);
  return buf;
}

// Deterministic synthetic tree: root + 4 top dirs x 5 subdirs x 3 leaf dirs = 84 dirs (+root),
// 5 files each level = 425 files. Per folder: a real EXIF JPEG, a real CR2-shaped TIFF, a valid
// WAV, a garbage .mp4 (exercises the media-parse FAILURE path), and a plain .txt.
function buildTree(root: string): void {
  fs.rmSync(root, { recursive: true, force: true });
  const tiff = buildExifTiff("Canon", "Canon EOS R5", "RF24-70mm F2.8 L IS USM", "2019:06:15 10:30:00", 640, 480);
  const jpeg = buildJpegWithExif(tiff);
  const wav = buildWav();
  const writeFiles = (dir: string): void => {
    fs.writeFileSync(path.join(dir, "f0.jpg"), jpeg);
    fs.writeFileSync(path.join(dir, "f1.wav"), wav);
    fs.writeFileSync(path.join(dir, "f2.txt"), "synthetic text");
    fs.writeFileSync(path.join(dir, "f3.cr2"), tiff);
    fs.writeFileSync(path.join(dir, "f4.mp4"), "definitely not an mp4"); // media parse must fail, run must continue
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
  // Phase 5 — metadata must exist on every COMMITTED row, or extraction ran outside the tx.
  imageRows: number;
  imagesWithExifSource: number; // must equal imageRows (every synthetic image carries EXIF)
  audioRows: number;
  audioWithCodec: number; // must equal audioRows (real WAVs)
  videoRows: number;
  mediaErrorRows: number; // must equal folderRows (one garbage .mp4 per folder)
  foldersWithTopCamera: number; // must equal folderRows
  foldersMissingImageMeta: number; // committed folders holding an image row without EXIF-sourced date — must be 0
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
    imageRows: one<number>("SELECT COUNT(*) AS n FROM scan_files WHERE run_id = ? AND kind = 'image'", run),
    imagesWithExifSource: one<number>(
      "SELECT COUNT(*) AS n FROM scan_files WHERE run_id = ? AND kind = 'image' AND captured_at_source = 'exif' AND camera_model IS NOT NULL",
      run
    ),
    audioRows: one<number>("SELECT COUNT(*) AS n FROM scan_files WHERE run_id = ? AND kind = 'audio'", run),
    audioWithCodec: one<number>(
      "SELECT COUNT(*) AS n FROM scan_files WHERE run_id = ? AND kind = 'audio' AND audio_codec IS NOT NULL AND duration_seconds IS NOT NULL",
      run
    ),
    videoRows: one<number>("SELECT COUNT(*) AS n FROM scan_files WHERE run_id = ? AND kind = 'video'", run),
    mediaErrorRows: one<number>("SELECT COUNT(*) AS n FROM scan_errors WHERE run_id = ? AND stage = 'media'", run),
    foldersWithTopCamera: one<number>("SELECT COUNT(*) AS n FROM scan_folders WHERE run_id = ? AND top_camera IS NOT NULL", run),
    foldersMissingImageMeta: one<number>(
      `SELECT COUNT(*) AS n FROM scan_folders fo WHERE fo.run_id = ? AND EXISTS (
         SELECT 1 FROM scan_files fi WHERE fi.folder_id = fo.id AND fi.kind = 'image' AND fi.captured_at_source <> 'exif')`,
      run
    ),
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
