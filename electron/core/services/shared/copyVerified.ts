// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: THE shared copy core — extracted verbatim from the Rename engine (THE LAW's enforcement
//              point), consumed by Rename and Migrate. Semantics preserved exactly:
//                • COPYFILE_EXCL — a pre-existing destination is reported skipped, NEVER overwritten.
//                • The source is only ever READ (copyFileSync read side + an explicit read-only fd
//                  when hashing). No rename/unlink/write against a source, ever.
//                • Byte-count verify — destination size compared to expectedBytes (the caller's
//                  recorded size) or to the source's size; a mismatch is an error, the caller's batch
//                  continues, the source is untouched.
//              Additive option (Migrate's ruling, DEFAULT OFF so Rename's proof stays valid):
//                • hash: true — SHA-256 of source AND destination, compared before success. Bundles
//                  land on removable media, which fails silently; the hash catches what size cannot.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/shared/copyVerified.ts
//------------------------------------------------------------
import crypto from "node:crypto";
import fs from "node:fs";

export interface CopyVerifiedOptions {
  /** SHA-256 source + destination, compared before success. DEFAULT OFF — byte-count-only (Rename). */
  hash?: boolean;
  /** Verify destination size against THIS byte count (a caller-recorded size). Omitted → the
   *  source's stat size. Ignored when verify:false. */
  expectedBytes?: number;
  /** Default true. false = EXCL copy with no size verification — Rename's REVERT path semantics
   *  (a user-edited copy still reverts; tightening that would change shipped behavior). */
  verify?: boolean;
}

export interface CopyVerifiedResult {
  ok: boolean;
  /** EEXIST — the destination already existed; NOTHING was written. */
  skipped: boolean;
  /** Destination size when a file was written (even on a failed verify), else 0. */
  bytes: number;
  /** Destination SHA-256 when hash:true and the copy verified clean. */
  sha256?: string;
  /** Failure text — same wording the Rename ledger has always recorded. */
  error?: string;
  /** Underlying fs error code when the failure came from the filesystem. */
  code?: string;
}

// Chunked sync hash — bounded memory on multi-gigabyte video; explicit read-only open.
const HASH_CHUNK = 4 * 1024 * 1024;
export function sha256File(p: string): string {
  const h = crypto.createHash("sha256");
  const fd = fs.openSync(p, "r");
  try {
    const buf = Buffer.allocUnsafe(HASH_CHUNK);
    let n = 0;
    while ((n = fs.readSync(fd, buf, 0, HASH_CHUNK, null)) > 0) h.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest("hex");
}

export function copyVerified(src: string, dest: string, opts: CopyVerifiedOptions = {}): CopyVerifiedResult {
  const { hash = false, verify = true } = opts;
  try {
    // COPYFILE_EXCL: fails with EEXIST if the destination already exists → SKIP, never overwrite.
    fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === "EEXIST") return { ok: false, skipped: true, bytes: 0, error: "destination already exists", code };
    return { ok: false, skipped: false, bytes: 0, error: e instanceof Error ? e.message : String(e), code };
  }

  let bytes = 0;
  try {
    bytes = fs.statSync(dest).size;
  } catch (e) {
    return { ok: false, skipped: false, bytes: 0, error: e instanceof Error ? e.message : String(e) };
  }
  if (verify) {
    const expected = opts.expectedBytes ?? fs.statSync(src).size;
    if (bytes !== expected) {
      // Exact historical wording — the Rename ledger has recorded this string since the engine shipped.
      return { ok: false, skipped: false, bytes, error: `size mismatch: source ${expected}, copy ${bytes}` };
    }
  }
  if (hash) {
    const srcHash = sha256File(src);
    const destHash = sha256File(dest);
    if (srcHash !== destHash) {
      return { ok: false, skipped: false, bytes, error: `checksum mismatch: source ${srcHash.slice(0, 16)}…, copy ${destHash.slice(0, 16)}…` };
    }
    return { ok: true, skipped: false, bytes, sha256: destHash };
  }
  return { ok: true, skipped: false, bytes };
}
