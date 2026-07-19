// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Standalone verifier for the isobmff reader — dev harness, NEVER shipped, never
//              imported by product code. Walks a fixtures directory, runs readIsoBmffGeometry on
//              every .mp4/.mov/.m4v/.3gp, prints the full geometry, and FAILS LOUDLY (non-zero
//              exit) when encoded dimensions come back null — a silent pass on empty fields is
//              the failure mode this script exists to catch. Ground truth: if an ffprobe binary
//              happens to exist on THIS machine it is used as a LOCAL MEASURING INSTRUMENT ONLY —
//              it is not installed, not a dependency, not referenced from any shipped code path
//              (GPLv3, deliberately removed from the product). Absent ffprobe, ours prints alone.
//              Invocation (crash-test pattern):
//                npx esbuild electron/core/services/scan/verify-isobmff.ts --bundle
//                  --platform=node --format=cjs --outfile=dist-electron/verify-isobmff.cjs
//                ELECTRON_RUN_AS_NODE=1 npx electron dist-electron/verify-isobmff.cjs <fixturesDir>
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/scan/verify-isobmff.ts
//------------------------------------------------------------
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { readIsoBmffGeometry } from "./isobmff-reader";

const ISO_BMFF_EXTS = new Set([".mp4", ".mov", ".m4v", ".3gp"]);
/** Files named *expect-null* assert the negative path: null result required, throw forbidden. */
const EXPECT_NULL_MARKER = "expect-null";

interface FfprobeTruth {
  width: number | null;
  height: number | null;
  bitrate: number | null;
  duration: number | null;
  rotation: number | null;
  codec: string | null;
}

function ffprobeAvailable(): boolean {
  try {
    return spawnSync("ffprobe", ["-version"], { windowsHide: true, timeout: 10_000 }).status === 0;
  } catch {
    return false;
  }
}

function ffprobeTruth(file: string): FfprobeTruth | null {
  try {
    const r = spawnSync(
      "ffprobe",
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file],
      { windowsHide: true, timeout: 30_000, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }
    );
    if (r.status !== 0 || !r.stdout) return null;
    const data = JSON.parse(r.stdout) as { streams?: Array<Record<string, unknown>>; format?: Record<string, unknown> };
    const v = (data.streams ?? []).find((s) => s.codec_type === "video");
    let rotation: number | null = null;
    const sideData = (v?.side_data_list ?? []) as Array<Record<string, unknown>>;
    for (const sd of sideData) {
      const rot = Number(sd.rotation);
      // ffprobe reports counter-clockwise-positive; ours is clockwise. Normalize to clockwise 0-359.
      if (Number.isFinite(rot)) rotation = ((-rot % 360) + 360) % 360;
    }
    return {
      width: typeof v?.width === "number" ? v.width : null,
      height: typeof v?.height === "number" ? v.height : null,
      bitrate: Number(data.format?.bit_rate) > 0 ? Number(data.format?.bit_rate) : null,
      duration: Number(data.format?.duration) > 0 ? Number(data.format?.duration) : null,
      rotation,
      codec: typeof v?.codec_name === "string" ? v.codec_name : null,
    };
  } catch {
    return null;
  }
}

function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.isFile() && ISO_BMFF_EXTS.has(path.extname(e.name).toLowerCase())) yield full;
  }
}

function main(): void {
  const fixturesDir = process.argv[2];
  if (!fixturesDir || !fs.existsSync(fixturesDir)) {
    console.error("usage: verify-isobmff <fixturesDir> — directory not found");
    process.exit(2);
  }
  const haveTruth = ffprobeAvailable();
  console.log(haveTruth
    ? "ffprobe found on this machine — printing ground truth beside ours (local instrument only)."
    : "ffprobe NOT present on this machine — printing our values alone.");

  let failures = 0;
  const rows: string[] = [];
  rows.push("file | encW | encH | dispW | dispH | bitrate | src | rot | fourCC | dur");

  for (const file of walk(fixturesDir)) {
    const name = path.basename(file);
    const expectNull = name.includes(EXPECT_NULL_MARKER);
    const g = readIsoBmffGeometry(file);
    console.log(`\n${name} → ${JSON.stringify(g)}`);

    if (expectNull) {
      if (g !== null) {
        console.log(`[FAIL] ${name}: expected null (negative fixture) but parsed a geometry`);
        failures += 1;
      } else {
        console.log(`[ok] ${name}: null as expected, no throw`);
      }
      rows.push(`${name} | (expect-null: ${g === null ? "null ok" : "PARSED!"})`);
      continue;
    }

    if (g === null || g.encodedWidth === null || g.encodedHeight === null) {
      console.log(`[FAIL] geometry parse returned null for ${name}`);
      failures += 1;
    }
    const truth = haveTruth ? ffprobeTruth(file) : null;
    rows.push(
      `${name} | ${g?.encodedWidth ?? "-"} | ${g?.encodedHeight ?? "-"} | ${g?.displayWidth ?? "-"} | ` +
      `${g?.displayHeight ?? "-"} | ${g?.bitrate ?? "-"} | ${g?.bitrateSource ?? "-"} | ${g?.rotation ?? "-"} | ` +
      `${g?.videoFourCharacterCode ?? "-"} | ${g?.durationSeconds?.toFixed(3) ?? "-"}`
    );
    if (truth) {
      rows.push(
        `  └ ffprobe | ${truth.width ?? "-"} | ${truth.height ?? "-"} | (display n/a) | (display n/a) | ` +
        `${truth.bitrate ?? "-"} | declared | ${truth.rotation ?? "-"} | ${truth.codec ?? "-"} | ${truth.duration?.toFixed(3) ?? "-"}`
      );
      // Field-level disagreement is a hard stop for the wiring phase — a wrong value is worse
      // than a missing one. Encoded dims must match exactly; rotation must match when both known.
      if (g && truth.width !== null && g.encodedWidth !== null && truth.width !== g.encodedWidth) {
        console.log(`[FAIL] ${name}: encodedWidth ${g.encodedWidth} ≠ ffprobe ${truth.width}`);
        failures += 1;
      }
      if (g && truth.height !== null && g.encodedHeight !== null && truth.height !== g.encodedHeight) {
        console.log(`[FAIL] ${name}: encodedHeight ${g.encodedHeight} ≠ ffprobe ${truth.height}`);
        failures += 1;
      }
      if (g && truth.rotation !== null && g.rotation !== null && truth.rotation !== g.rotation) {
        console.log(`[FAIL] ${name}: rotation ${g.rotation} ≠ ffprobe ${truth.rotation}`);
        failures += 1;
      }
      if (g && truth.duration !== null && g.durationSeconds !== null && Math.abs(truth.duration - g.durationSeconds) > 0.25) {
        console.log(`[FAIL] ${name}: duration ${g.durationSeconds} ≠ ffprobe ${truth.duration}`);
        failures += 1;
      }
    }
  }

  console.log("\n===== TABLE =====");
  for (const r of rows) console.log(r);
  console.log(failures === 0 ? "\nALL FIXTURES PASSED" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
