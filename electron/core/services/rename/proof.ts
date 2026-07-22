// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Rename engine proof harness (mirrors scan/crash-test.ts). Headless — bundle with esbuild,
//              run under ELECTRON_RUN_AS_NODE (native module ABI). Builds a throwaway synthetic tree in
//              a TEMP directory (never a real archive) and proves, with SHA-256 checksums:
//                • per-class sequences (stills/video/audio each own 001..) — correct
//                • two source folders — the sequence CONTINUES, never restarts (3.4)
//                • RAW+JPEG pairs (A2) — N sequence numbers for 2N files, every pair matches
//                • a pre-existing destination file — SKIPPED and marked, NEVER overwritten (3.6)
//                • SIGKILL mid-run — sources byte-identical, no partial copy promoted
//                • revert — originals restored by name, copies still present
//              THE LAW ASSERTION (non-negotiable): every SOURCE file's SHA-256 is identical before and
//              after every operation. If that ever fails, the harness exits non-zero.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/rename/proof.ts
//------------------------------------------------------------
import Database from "better-sqlite3-multiple-ciphers";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ensureRenameSchema, type Db } from "./db";
import { getBatch, markInterruptedRenames, revertMapping, startRename, startRevert } from "./index";
import type { RenameSettings } from "../../../../src/shared/renamePreview";

const ORG = "rename-proof-org";
const SETTINGS: RenameSettings = {
  prefixMode: "both", businessName: "BrightFlashMedia", photographerName: "PaulCruz",
  sequenceStart: 1, sequencePad: 3, clientName: "Acme", projectName: "Summit", shootDate: "2026-03-03", customTag: "",
};

function openTestDb(dbPath: string): Db {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  ensureRenameSchema(db);
  return db;
}

const sha = (p: string): string => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

/** { absolutePath: sha256 } for every file under root (recursive). */
function checksumTree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) out[full] = sha(full);
    }
  };
  walk(root);
  return out;
}

/** Deterministic content of a given byte length, seeded by name — distinct per file so size + hash matter. */
function content(name: string, len: number): Buffer {
  const b = Buffer.alloc(len);
  for (let i = 0; i < len; i++) b[i] = (name.charCodeAt(i % name.length) + i) & 0xff;
  return b;
}

// Two source folders. Folder A: 3 RAW+JPEG still pairs + 1 video + 1 audio. Folder B: 2 RAW+JPEG pairs
// + 1 video. RAW+JPEG share a stem so they must share ONE sequence number (A2). The image counter must
// continue A(001,002,003) → B(004,005); the video counter A(001) → B(002).
function buildTree(root: string): { srcA: string; srcB: string } {
  fs.rmSync(root, { recursive: true, force: true });
  const srcA = path.join(root, "srcA");
  const srcB = path.join(root, "srcB");
  fs.mkdirSync(srcA, { recursive: true });
  fs.mkdirSync(srcB, { recursive: true });
  const pair = (dir: string, stem: string, rawExt: string): void => {
    fs.writeFileSync(path.join(dir, `${stem}.${rawExt}`), content(`${stem}.${rawExt}`, 2048));
    fs.writeFileSync(path.join(dir, `${stem}.JPG`), content(`${stem}.JPG`, 1024));
  };
  pair(srcA, "image_8402", "CR2");
  pair(srcA, "image_8403", "CR2");
  pair(srcA, "image_8404", "CR2");
  fs.writeFileSync(path.join(srcA, "clip_01.MOV"), content("clip_01.MOV", 4096));
  fs.writeFileSync(path.join(srcA, "note_01.WAV"), content("note_01.WAV", 3000));
  pair(srcB, "image_9001", "CR3");
  pair(srcB, "image_9002", "CR3");
  fs.writeFileSync(path.join(srcB, "clip_02.MP4"), content("clip_02.MP4", 5000));
  return { srcA, srcB };
}

// A LARGE tree so the engine's progress cadence fires MID-run — a genuine SIGKILL-during-copy test
// (the small tree above finishes before the first mid-loop tick). ~200 still pairs across two folders.
function buildBigTree(root: string): void {
  fs.rmSync(root, { recursive: true, force: true });
  const srcA = path.join(root, "srcA");
  const srcB = path.join(root, "srcB");
  fs.mkdirSync(srcA, { recursive: true });
  fs.mkdirSync(srcB, { recursive: true });
  const mk = (dir: string, n: number, ext: string): void => {
    for (let i = 0; i < n; i++) {
      const stem = `frame_${String(i).padStart(4, "0")}`;
      fs.writeFileSync(path.join(dir, `${stem}.${ext}`), content(`${stem}.${ext}`, 512 + (i % 7) * 64));
      fs.writeFileSync(path.join(dir, `${stem}.JPG`), content(`${stem}.JPG`, 256 + (i % 5) * 32));
    }
  };
  mk(srcA, 150, "CR2");
  mk(srcB, 60, "CR3");
}

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "[PASS]" : "[FAIL]"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

/** THE LAW: assert a source tree is byte-identical to a checksum snapshot. */
function assertLaw(label: string, root: string, before: Record<string, string>): void {
  const after = checksumTree(root);
  const beforeKeys = Object.keys(before).sort();
  const afterKeys = Object.keys(after).sort();
  const sameSet = beforeKeys.length === afterKeys.length && beforeKeys.every((k, i) => k === afterKeys[i]);
  const sameHash = beforeKeys.every((k) => before[k] === after[k]);
  check(`THE LAW — ${label}: every source byte-identical`, sameSet && sameHash,
    sameSet ? (sameHash ? `${beforeKeys.length} files unchanged` : "A HASH CHANGED") : "FILE SET CHANGED");
}

function seqByClass(db: Db, batchId: number, cls: string): number[] {
  return (db
    .prepare("SELECT DISTINCT sequence_number AS s FROM rename_files WHERE batch_id = ? AND media_class = ? ORDER BY s")
    .all(batchId, cls) as { s: number }[]).map((r) => r.s);
}

async function full(treeDir: string, dbPath: string, destRoot: string): Promise<void> {
  const { srcA, srcB } = buildTree(treeDir);
  fs.rmSync(destRoot, { recursive: true, force: true });
  const beforeA = checksumTree(srcA), beforeB = checksumTree(srcB);

  // ---- Batch 1: A + B → dest ----
  const dest = path.join(destRoot, "batch1");
  const batchId = await startRename(openTestDb(dbPath), ORG, {
    sources: [srcA, srcB], destination: dest, settings: SETTINGS, onProgress: () => {},
  });
  const db = openTestDb(dbPath);

  assertLaw("after rename", srcA, beforeA);
  assertLaw("after rename", srcB, beforeB);

  // Per-class sequences continue across folders (3.4) + pairing (A2).
  const imgSeq = seqByClass(db, batchId, "image");
  const vidSeq = seqByClass(db, batchId, "video");
  const audSeq = seqByClass(db, batchId, "audio");
  const imgRows = (db.prepare("SELECT COUNT(*) AS n FROM rename_files WHERE batch_id = ? AND media_class = 'image'").get(batchId) as { n: number }).n;
  check("stills sequence 001..005 across both folders (continues, no restart)", JSON.stringify(imgSeq) === "[1,2,3,4,5]", `got ${JSON.stringify(imgSeq)}`);
  check("A2 pairing — 5 sequence numbers for 10 still files (RAW+JPEG share one)", imgSeq.length === 5 && imgRows === 10, `seq=${imgSeq.length} rows=${imgRows}`);
  check("video sequence 001..002 (own counter, continues A→B)", JSON.stringify(vidSeq) === "[1,2]", `got ${JSON.stringify(vidSeq)}`);
  check("audio sequence 001 (own counter)", JSON.stringify(audSeq) === "[1]", `got ${JSON.stringify(audSeq)}`);

  // Each pair shares its number: same (source_folder-derived) stem → same sequence_number.
  const pairRows = db.prepare("SELECT stem, sequence_number FROM rename_files WHERE batch_id = ? AND media_class = 'image' ORDER BY stem").all(batchId) as { stem: string; sequence_number: number }[];
  const byStem = new Map<string, Set<number>>();
  for (const r of pairRows) (byStem.get(r.stem) ?? byStem.set(r.stem, new Set()).get(r.stem)!).add(r.sequence_number);
  const everyPairMatches = [...byStem.values()].every((s) => s.size === 1);
  check("A2 pairing — every stem group has exactly ONE sequence number", everyPairMatches);

  // Names + byte-verify: example BrightFlashMedia-PaulCruz-001-image_8402.CR2.
  const example = path.join(dest, "BrightFlashMedia-PaulCruz-001-image_8402.CR2");
  check("copy exists with <prefix>-<seq>-<original> name", fs.existsSync(example), example);
  const copied = db.prepare("SELECT copy_path, bytes FROM rename_files WHERE batch_id = ? AND status = 'copied'").all(batchId) as { copy_path: string; bytes: number }[];
  const allBytesMatch = copied.every((r) => fs.existsSync(r.copy_path) && fs.statSync(r.copy_path).size === r.bytes);
  check("every copied file's byte count matches its source", allBytesMatch, `${copied.length} copies verified`);

  // ---- Pre-existing destination file → skipped, NOT overwritten (3.6) ----
  const dest2 = path.join(destRoot, "batch2");
  fs.mkdirSync(dest2, { recursive: true });
  const collideName = "BrightFlashMedia-PaulCruz-001-image_8402.CR2";
  const sentinel = Buffer.from("PRE-EXISTING — MUST NOT BE OVERWRITTEN");
  fs.writeFileSync(path.join(dest2, collideName), sentinel);
  const beforeA2 = checksumTree(srcA);
  const batch2 = await startRename(openTestDb(dbPath), ORG, { sources: [srcA], destination: dest2, settings: SETTINGS, onProgress: () => {} });
  assertLaw("after collision batch", srcA, beforeA2);
  const skippedRow = db.prepare("SELECT status FROM rename_files WHERE batch_id = ? AND copy_filename = ?").get(batch2, collideName) as { status: string } | undefined;
  check("pre-existing destination file marked 'skipped'", skippedRow?.status === "skipped", `status=${skippedRow?.status}`);
  check("pre-existing destination file NOT overwritten (content intact)", fs.readFileSync(path.join(dest2, collideName)).equals(sentinel));

  // ---- Revert batch 1 → restore originals by name; copies still present ----
  const revertDest = path.join(destRoot, "revert1");
  const mapping = revertMapping(db, ORG, batchId);
  const res = await startRevert(openTestDb(dbPath), ORG, { batchId, copiesFolder: dest, destination: revertDest, onProgress: () => {} });
  assertLaw("after revert", srcA, beforeA);
  assertLaw("after revert", srcB, beforeB);
  check("revert restored every logged copy under its ORIGINAL name", res.restored === mapping.length && mapping.every((m) => fs.existsSync(path.join(revertDest, m.source_filename))), `restored ${res.restored}/${mapping.length}`);
  check("revert left the copies in place (a third file set)", fs.existsSync(example));
  check("revert logged as its own batch (History)", getBatch(db, ORG, res.revertBatchId)?.kind === "revert");

  console.log(failures === 0 ? "\nFULL MODE PASSED — THE LAW HELD" : `\n${failures} FAILURE(S)`);
  if (failures > 0) process.exitCode = 1;
}

async function main(): Promise<void> {
  const [, , mode, treeDir, dbPath, destRoot, snapshotFile] = process.argv;
  if (!mode || !treeDir || !dbPath) throw new Error("usage: proof <build|full|crash|inspect> <treeDir> <dbPath> [destRoot] [snapshotFile]");

  if (mode === "build") {
    const { srcA, srcB } = buildTree(treeDir);
    fs.writeFileSync(dbPath, JSON.stringify({ ...checksumTree(srcA), ...checksumTree(srcB) })); // dbPath doubles as the snapshot file here
    console.log(JSON.stringify({ built: treeDir, srcA, srcB }));
    return;
  }
  if (mode === "full") {
    await full(treeDir, dbPath, destRoot);
    return;
  }
  if (mode === "crash") {
    // Large fresh tree so the SIGKILL lands genuinely MID-copy (after the first 25-row commit flush,
    // with hundreds of files still uncopied) — the hardest LAW test.
    buildBigTree(treeDir);
    const srcA = path.join(treeDir, "srcA");
    const srcB = path.join(treeDir, "srcB");
    fs.writeFileSync(snapshotFile, JSON.stringify({ ...checksumTree(srcA), ...checksumTree(srcB) }));
    const db = openTestDb(dbPath);
    await startRename(db, ORG, {
      sources: [srcA, srcB], destination: destRoot, settings: SETTINGS,
      onProgress: (p) => { if (p.copied >= 30) process.kill(process.pid, "SIGKILL"); }, // crash after >=1 flush, mid-run
    });
    console.log(JSON.stringify({ unexpected: "finished without being killed" }));
    return;
  }
  if (mode === "inspect") {
    const before = JSON.parse(fs.readFileSync(snapshotFile, "utf8")) as Record<string, string>;
    const db = openTestDb(dbPath);
    const crashedMarked = markInterruptedRenames(db);
    const srcA = path.join(treeDir, "srcA");
    const srcB = path.join(treeDir, "srcB");
    // THE LAW after a hard crash: sources unchanged.
    const beforeA = Object.fromEntries(Object.entries(before).filter(([k]) => k.startsWith(srcA)));
    const beforeB = Object.fromEntries(Object.entries(before).filter(([k]) => k.startsWith(srcB)));
    assertLaw("after SIGKILL", srcA, beforeA);
    assertLaw("after SIGKILL", srcB, beforeB);
    // No partial copy promoted: no committed 'copied' row whose dest size ≠ recorded bytes.
    const copied = db.prepare("SELECT copy_path, bytes FROM rename_files WHERE status = 'copied'").all() as { copy_path: string; bytes: number }[];
    const promotedPartial = copied.filter((r) => !fs.existsSync(r.copy_path) || fs.statSync(r.copy_path).size !== r.bytes);
    check("no partial copy promoted (every committed copy is byte-complete)", promotedPartial.length === 0, `crashedMarked=${crashedMarked}, committed=${copied.length}, partial-promoted=${promotedPartial.length}`);
    console.log(failures === 0 ? "\nCRASH INSPECT PASSED — THE LAW HELD" : `\n${failures} FAILURE(S)`);
    if (failures > 0) process.exitCode = 1;
    return;
  }
  throw new Error(`unknown mode ${mode}`);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
