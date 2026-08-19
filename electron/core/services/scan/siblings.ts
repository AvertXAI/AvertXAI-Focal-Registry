// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: A RAW's verified standard sibling — same stem, same folder, same capture time.
//              Resolution only; it decides nothing about thumbnails.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/scan/siblings.ts
//------------------------------------------------------------
//
// WHY THIS EXISTS. Measured on the test drive: 415/415, 209/209 and 59/59 RAW files have a
// same-stem standard sibling — zero unpaired, zero ambiguous. Photographers shoot RAW+JPEG, so
// half of every generation in this module is a second decode of a photograph we already have.
//
// =============================================================================================
// IT IS A GUARD, NOT AN ASSUMPTION, AND THAT IS THE WHOLE DESIGN.
//
// Jason ruled it, verbatim: "do it right. we dont know what we dont know, better to try and predict
// the future of what could happen then wait and find out and the user complains."
//
// SHOWING A PHOTOGRAPH UNDER THE WRONG FILENAME IS THE WORST DEFECT THIS MODULE COULD SHIP. It
// would look entirely correct — a real photograph, a real filename, from the right folder — so
// nobody would ever catch it by looking. The archive would quietly start lying. Every branch below
// therefore fails CLOSED: anything short of proof generates the RAW's own preview, which costs
// milliseconds, where a wrong match costs trust.
//
// Three ways it refuses:
//   NO SIBLING     — nothing with that stem. Generate.
//   AMBIGUOUS      — two or more candidates. Ambiguity is not a coin flip. Generate.
//   TIME MISMATCH  — capture timestamps differ, or either is missing. Generate.
//
// =============================================================================================
// WHY AN INDEX AND NOT A QUERY PER FILE.
//
// The obvious shape is `WHERE path LIKE 'folder\stem.%'` per RAW. It is wrong twice. First it is
// 415 queries where one will do. Second, and worse: **`_` is a single-character WILDCARD in SQL
// LIKE**, and camera stems are `IMG_0541`. That pattern also matches `IMGX0541.jpg` — a different
// photograph, silently. Escaping it needs an ESCAPE clause whose escape character then collides
// with the backslash already doing duty as the path separator in the folder patterns nearby.
//
// One query per FOLDER and an exact-match map in JavaScript has neither problem, and the stem
// comparison is a plain string equality that cannot be tricked.
import path from "node:path";
import type { Db } from "./notesDb";
import { RAW_EXTS, STILL_EXTS, extOf, normalizeExt } from "./media";

/** Why a RAW did or did not get to reuse a sibling. Reported as a tally, per the work order. */
export type SiblingOutcome = "reused" | "no-sibling" | "ambiguous" | "time-mismatch" | "not-raw";

interface Row {
  path: string;
  captured_at: string | null;
}

/** One folder at a time. The wall only ever shows one, and a bounded single-entry cache cannot
 *  become a leak the way a growing map keyed by folder would. */
let cachedFolder = "";
let cachedIndex: Map<string, Row[]> = new Map();

/** Everything in this folder that is a STANDARD still (never a RAW), grouped by lower-cased stem. */
function indexFor(db: Db, orgId: string, folder: string): Map<string, Row[]> {
  const key = folder.toLowerCase();
  if (key === cachedFolder) return cachedIndex;

  const rows = db
    .prepare(
      `SELECT path, extension, captured_at FROM scan_files
       WHERE org_id = ? AND path LIKE ? AND path NOT LIKE ? AND kind = 'image'`
    )
    .all(orgId, folder + "\\%", folder + "\\%\\%") as Array<{
    path: string;
    extension: string | null;
    captured_at: string | null;
  }>;

  const index = new Map<string, Row[]>();
  for (const r of rows) {
    const stored = (r.extension ?? "").trim();
    const e = stored !== "" ? normalizeExt(stored) : extOf(r.path);
    // A RAW is never a candidate: reusing one RAW's preview for another would defeat the point and
    // could pair two different photographs that happen to share a stem across formats.
    if (RAW_EXTS.has(e) || !STILL_EXTS.has(e)) continue;
    const stem = path.basename(r.path, path.extname(r.path)).toLowerCase();
    const list = index.get(stem);
    if (list) list.push({ path: r.path, captured_at: r.captured_at });
    else index.set(stem, [{ path: r.path, captured_at: r.captured_at }]);
  }

  cachedFolder = key;
  cachedIndex = index;
  return index;
}

/**
 * The verified sibling for a RAW, or null with the reason it was refused.
 *
 * `rawCapturedAt` is the RAW's own capture time, read from the same row the listing came from.
 * A missing value on EITHER side is a refusal, not a pass: "both unknown" is not evidence that two
 * files are the same photograph, and treating it as one is exactly how a wrong tile would ship.
 */
export function siblingOf(
  db: Db,
  orgId: string,
  rawPath: string,
  rawCapturedAt: string | null
): { path: string | null; outcome: SiblingOutcome } {
  const e = extOf(rawPath);
  if (!RAW_EXTS.has(e)) return { path: null, outcome: "not-raw" };

  const folder = path.dirname(rawPath);
  const stem = path.basename(rawPath, path.extname(rawPath)).toLowerCase();
  const candidates = indexFor(db, orgId, folder).get(stem) ?? [];

  if (candidates.length === 0) return { path: null, outcome: "no-sibling" };
  // TWO CANDIDATES IS A REFUSAL, NOT A CHOICE. IMG_0541.jpg beside IMG_0541.png could be two
  // different exports, or a proof beside a final. Picking either is a guess, and a guess here is
  // the wrong-photograph defect.
  if (candidates.length > 1) return { path: null, outcome: "ambiguous" };

  const sib = candidates[0];
  if (!rawCapturedAt || !sib.captured_at || rawCapturedAt !== sib.captured_at) {
    return { path: null, outcome: "time-mismatch" };
  }
  return { path: sib.path, outcome: "reused" };
}

/** The running tally, so the work order's "report the tally" is a number rather than a claim. */
const tally: Record<SiblingOutcome, number> = {
  reused: 0, "no-sibling": 0, ambiguous: 0, "time-mismatch": 0, "not-raw": 0,
};

export function count(o: SiblingOutcome): void {
  tally[o] += 1;
}

export function tallySnapshot(): Record<SiblingOutcome, number> {
  return { ...tally };
}

export function resetTally(): void {
  for (const k of Object.keys(tally) as SiblingOutcome[]) tally[k] = 0;
}
