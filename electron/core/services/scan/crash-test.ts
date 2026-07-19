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

// ---- minimal valid ISO base-media (MP4 / MOV) — hand-crafted box tree: ftyp + moov(mvhd,
// trak-video(avc1+avcC), trak-audio(mp4a+esds)) + mdat. 640x480, 2 seconds, AAC-LC 8 kHz mono.
// The .mov variant differs ONLY in the ftyp major brand ('qt  ') — THE deciding assertion:
// a valid MP4 proves ISO-BMFF parsing, it does NOT prove QuickTime branding parses. Synthetic
// (no real camera file on this machine) — reported as such.
const u16 = (n: number): Buffer => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u32 = (n: number): Buffer => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const zeros = (n: number): Buffer => Buffer.alloc(n);
const latin = (s: string): Buffer => Buffer.from(s, "latin1");
function bmffBox(type: string, ...payloads: Buffer[]): Buffer {
  const body = Buffer.concat(payloads);
  return Buffer.concat([u32(body.length + 8), latin(type), body]);
}
function bmffFullBox(type: string, version: number, flags: number, ...payloads: Buffer[]): Buffer {
  const vf = Buffer.alloc(4);
  vf.writeUInt8(version, 0);
  vf.writeUIntBE(flags, 1, 3);
  return bmffBox(type, vf, ...payloads);
}
const BMFF_MATRIX = Buffer.concat([u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000)]);
const emptyStbl = (stsd: Buffer): Buffer =>
  bmffBox("stbl", stsd,
    bmffFullBox("stts", 0, 0, u32(0)), bmffFullBox("stsc", 0, 0, u32(0)),
    bmffFullBox("stsz", 0, 0, u32(0), u32(0)), bmffFullBox("stco", 0, 0, u32(0)));
const bmffDinf = (): Buffer => bmffBox("dinf", bmffFullBox("dref", 0, 0, u32(1), bmffFullBox("url ", 0, 1)));

function buildIsoBmff(majorBrand: string): Buffer {
  const compat = majorBrand === "qt  " ? latin("qt  ") : latin("isomiso2avc1mp41");
  const ftyp = bmffBox("ftyp", latin(majorBrand), u32(0x200), compat);
  const mvhd = bmffFullBox("mvhd", 0, 0, u32(0), u32(0), u32(1000), u32(2000), u32(0x10000), u16(0x100), u16(0), zeros(8), BMFF_MATRIX, zeros(24), u32(3));
  // video track — avc1 with a minimal avcC (0 SPS / 0 PPS)
  const tkhdV = bmffFullBox("tkhd", 0, 3, u32(0), u32(0), u32(1), u32(0), u32(2000), zeros(8), u16(0), u16(0), u16(0), u16(0), BMFF_MATRIX, u32(640 << 16), u32(480 << 16));
  const mdhdV = bmffFullBox("mdhd", 0, 0, u32(0), u32(0), u32(1000), u32(2000), u16(0x55c4), u16(0));
  const hdlrV = bmffFullBox("hdlr", 0, 0, u32(0), latin("vide"), zeros(12), latin("VideoHandler\0"));
  const avcC = bmffBox("avcC", Buffer.from([1, 0x42, 0x00, 0x1e, 0xff, 0xe0, 0x00]));
  const avc1 = bmffBox("avc1", zeros(6), u16(1), u16(0), u16(0), zeros(12), u16(640), u16(480), u32(0x480000), u32(0x480000), u32(0), u16(1), zeros(32), u16(0x18), u16(0xffff), avcC);
  const minfV = bmffBox("minf", bmffFullBox("vmhd", 0, 1, u16(0), zeros(6)), bmffDinf(), emptyStbl(bmffFullBox("stsd", 0, 0, u32(1), avc1)));
  const trakV = bmffBox("trak", tkhdV, bmffBox("mdia", mdhdV, hdlrV, minfV));
  // audio track — mp4a with a minimal esds (AAC-LC, 8 kHz, mono)
  const tkhdA = bmffFullBox("tkhd", 0, 3, u32(0), u32(0), u32(2), u32(0), u32(2000), zeros(8), u16(0), u16(0), u16(0x100), u16(0), BMFF_MATRIX, u32(0), u32(0));
  const mdhdA = bmffFullBox("mdhd", 0, 0, u32(0), u32(0), u32(8000), u32(16000), u16(0x55c4), u16(0));
  const hdlrA = bmffFullBox("hdlr", 0, 0, u32(0), latin("soun"), zeros(12), latin("SoundHandler\0"));
  const esds = bmffFullBox("esds", 0, 0, Buffer.concat([
    Buffer.from([3, 25]), u16(0), Buffer.from([0]), // ES_Descriptor: ES_ID, flags
    Buffer.from([4, 17, 0x40, 0x15, 0, 0, 0]), u32(128000), u32(128000), // DecoderConfig: AAC, audio, buffers, bitrates
    Buffer.from([5, 2, 0x15, 0x88]), // DecSpecificInfo: AAC-LC, 8 kHz, mono
    Buffer.from([6, 1, 2]), // SLConfig
  ]));
  const mp4a = bmffBox("mp4a", zeros(6), u16(1), u16(0), u16(0), u32(0), u16(1), u16(16), u16(0), u16(0), u32(8000 << 16), esds);
  const minfA = bmffBox("minf", bmffFullBox("smhd", 0, 0, u16(0), u16(0)), bmffDinf(), emptyStbl(bmffFullBox("stsd", 0, 0, u32(1), mp4a)));
  const trakA = bmffBox("trak", tkhdA, bmffBox("mdia", mdhdA, hdlrA, minfA));
  const moov = bmffBox("moov", mvhd, trakV, trakA);
  const mdat = bmffBox("mdat", zeros(32000)); // ~32 KB over 2 s so size-derived bitrate math has substance
  return Buffer.concat([ftyp, moov, mdat]);
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
// 7 files each level = 595 files. Per folder: real EXIF JPEG, CR2-shaped TIFF, valid WAV, plain
// text, a CORRUPT .mp4 (failure path), a minimal VALID .mp4, and a synthetic QuickTime-branded
// .mov (the deciding assertion).
function buildTree(root: string): void {
  fs.rmSync(root, { recursive: true, force: true });
  const tiff = buildExifTiff("Canon", "Canon EOS R5", "RF24-70mm F2.8 L IS USM", "2019:06:15 10:30:00", 640, 480);
  const jpeg = buildJpegWithExif(tiff);
  const wav = buildWav();
  const mp4 = buildIsoBmff("isom");
  const mov = buildIsoBmff("qt  ");
  const writeFiles = (dir: string): void => {
    fs.writeFileSync(path.join(dir, "f0.jpg"), jpeg);
    fs.writeFileSync(path.join(dir, "f1.wav"), wav);
    fs.writeFileSync(path.join(dir, "f2.txt"), "synthetic text");
    fs.writeFileSync(path.join(dir, "f3.cr2"), tiff);
    fs.writeFileSync(path.join(dir, "f4.mp4"), "definitely not an mp4"); // media parse must fail, run must continue
    fs.writeFileSync(path.join(dir, "f5.mp4"), mp4);
    fs.writeFileSync(path.join(dir, "f6.mov"), mov);
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
  mediaErrorRows: number; // failure-path rows; corrupt f4.mp4 contributes one per folder
  foldersWithTopCamera: number; // must equal folderRows
  foldersMissingImageMeta: number; // committed folders holding an image row without EXIF-sourced date — must be 0
  /** Per-format field presence — the coverage assertions. rows = committed rows of that fixture. */
  mp4: FormatPresence; // valid f5.mp4
  mov: FormatPresence; // synthetic QuickTime-branded f6.mov — THE deciding assertion
  corrupt: { rows: number; withAnyMetadata: number; errorRows: number }; // f4.mp4 — must be rows / 0 / rows
}
interface FormatPresence {
  rows: number;
  videoCodec: number;
  audioCodec: number;
  duration: number;
  bitrate: number;
  width: number;
  height: number;
  metadataDate: number;
  displayWidth: number;
  displayHeight: number;
  rotation: number;
  bitrateSource: number;
}
function counts(db: Db, runId?: number): Counts {
  const runs = db
    .prepare("SELECT id, status, folders_committed, files_recorded, errors_logged, resume_cursor FROM scan_runs ORDER BY id")
    .all() as Counts["runs"];
  const one = <T>(sql: string, ...args: unknown[]): T => (db.prepare(sql).get(...args) as { n: T }).n;
  const run = runId ?? runs[runs.length - 1]?.id;
  const cursor = runs.find((r) => r.id === run)?.resume_cursor ?? null;
  const presence = (filename: string): FormatPresence => {
    const field = (col: string): number =>
      one<number>(`SELECT COUNT(*) AS n FROM scan_files WHERE run_id = ? AND filename = ? AND ${col} IS NOT NULL`, run, filename);
    return {
      rows: one<number>("SELECT COUNT(*) AS n FROM scan_files WHERE run_id = ? AND filename = ?", run, filename),
      videoCodec: field("video_codec"),
      audioCodec: field("audio_codec"),
      duration: field("duration_seconds"),
      bitrate: field("bitrate"),
      width: field("width"),
      height: field("height"),
      metadataDate: field("metadata_date"),
      displayWidth: field("display_width"),
      displayHeight: field("display_height"),
      rotation: field("rotation"),
      bitrateSource: field("bitrate_source"),
    };
  };
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
    mp4: presence("f5.mp4"),
    mov: presence("f6.mov"),
    corrupt: {
      rows: one<number>("SELECT COUNT(*) AS n FROM scan_files WHERE run_id = ? AND filename = 'f4.mp4'", run),
      withAnyMetadata: one<number>(
        "SELECT COUNT(*) AS n FROM scan_files WHERE run_id = ? AND filename = 'f4.mp4' AND (video_codec IS NOT NULL OR audio_codec IS NOT NULL OR duration_seconds IS NOT NULL OR bitrate IS NOT NULL)",
        run
      ),
      errorRows: one<number>("SELECT COUNT(*) AS n FROM scan_errors WHERE run_id = ? AND stage = 'media' AND path LIKE '%f4.mp4'", run),
    },
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
  } else if (mode === "fixtures") {
    // Real-fixtures mode: scan a directory of REAL media files through the FULL engine (traversal,
    // both metadata engines, per-folder transaction) and dump every media row's fields — the
    // end-to-end complement to verify-isobmff's reader-unit check. Files named *expect-null* must
    // come out with NULL geometry and must not have crashed the run.
    const run = createRun(db, ORG, testDrive(db), treeDir, "folder");
    await startRun(db, ORG, run.id);
    const rows = db
      .prepare(
        `SELECT filename, kind, video_codec, audio_codec, width, height, display_width, display_height,
                rotation, bitrate, bitrate_source, duration_seconds, metadata_date
         FROM scan_files WHERE run_id = ? AND kind IN ('video', 'audio') ORDER BY filename`
      )
      .all(run.id) as Array<Record<string, unknown>>;
    let failures = 0;
    for (const r of rows) {
      console.log(JSON.stringify(r));
      const name = String(r.filename);
      const geometryNull = r.width == null && r.height == null && r.display_width == null;
      if (name.includes("expect-null") && !geometryNull) {
        console.log(`[FAIL] ${name}: negative fixture carries geometry`);
        failures += 1;
      }
      if (!name.includes("expect-null") && r.kind === "video" && (r.width == null || r.height == null)) {
        console.log(`[FAIL] ${name}: video fixture missing encoded dimensions`);
        failures += 1;
      }
    }
    const finalRun = db.prepare("SELECT status, files_recorded, errors_logged FROM scan_runs WHERE id = ?").get(run.id);
    console.log("run:", JSON.stringify(finalRun), failures === 0 ? "FIXTURES MODE PASSED" : `${failures} FAILURE(S)`);
    if (failures > 0) process.exitCode = 1;
  } else {
    throw new Error(`unknown mode ${mode}`);
  }
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
