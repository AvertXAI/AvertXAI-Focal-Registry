// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Positioned-read feeder for isobmff.ts. Opens a media file READ-ONLY, hops across
//              TOP-LEVEL boxes (moov legally sits before OR after mdat — never assume position,
//              never read a fixed leading window), reads exactly the moov box's byte range, and
//              hands it to parseIsoBmffGeometry. Node fs only, no dependencies. Never throws;
//              malformed sizes (backwards seek, past end-of-file, oversized moov) return null.
//              THE LAW: reads a few kilobytes of headers, writes nothing, always closes the handle.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/scan/isobmff-reader.ts
//------------------------------------------------------------
import fs from "node:fs";
import { parseIsoBmffGeometry, type IsoBmffGeometry } from "./isobmff";

/** Top-level box hops before giving up — a real file reaches moov in a handful. */
const MAXIMUM_TOP_LEVEL_HOPS = 64;
/** Refuse to buffer a moov larger than this — a legitimate movie box is megabytes at most. */
const MAXIMUM_MOOV_BYTES = 64 * 1024 * 1024;
/** 32-bit size + 4-char type + optional 64-bit largesize. */
const BOX_HEADER_BYTES = 16;

/**
 * Read ISO base-media geometry from a file on disk. Returns null for anything that is not a
 * well-formed ISO base-media file (including truncated files and renamed non-media bytes).
 * Never throws; the file handle always closes, error path included.
 */
export function readIsoBmffGeometry(filePath: string): IsoBmffGeometry | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, "r"); // read-only, always
    const fileSizeBytes = fs.fstatSync(fd).size;
    if (fileSizeBytes < 8) return null;

    const header = Buffer.alloc(BOX_HEADER_BYTES);
    let offset = 0;

    for (let hop = 0; hop < MAXIMUM_TOP_LEVEL_HOPS && offset + 8 <= fileSizeBytes; hop += 1) {
      const bytesRead = fs.readSync(fd, header, 0, BOX_HEADER_BYTES, offset);
      if (bytesRead < 8) return null;

      const declaredSize = header.readUInt32BE(0);
      const type = header.toString("latin1", 4, 8);

      let boxSize: number;
      if (declaredSize === 1) {
        // 64-bit largesize follows the type.
        if (bytesRead < BOX_HEADER_BYTES) return null;
        const largeSize = header.readBigUInt64BE(8);
        if (largeSize < 16n || largeSize > BigInt(Number.MAX_SAFE_INTEGER)) return null;
        boxSize = Number(largeSize);
      } else if (declaredSize === 0) {
        // Box runs to end of file.
        boxSize = fileSizeBytes - offset;
      } else if (declaredSize < 8) {
        return null; // undersized declaration — the infinite-loop case
      } else {
        boxSize = declaredSize;
      }

      const boxEnd = offset + boxSize;
      // Never trust a size field: a box that seeks backwards or past end-of-file is malformed.
      if (boxEnd <= offset || boxEnd > fileSizeBytes) return null;

      if (type === "moov") {
        if (boxSize > MAXIMUM_MOOV_BYTES) return null;
        const moov = Buffer.alloc(boxSize);
        const moovRead = fs.readSync(fd, moov, 0, boxSize, offset);
        if (moovRead !== boxSize) return null;
        // The buffer contains exactly the moov box (header included) — a recognizable top-level
        // box, which is what parseIsoBmffGeometry expects. Real file size enables the
        // computed-bitrate fallback.
        return parseIsoBmffGeometry(moov, fileSizeBytes);
      }

      offset = boxEnd;
    }

    return null; // no moov within the hop cap
  } catch {
    return null; // never throws — unreadable is a legitimate outcome, not an exception
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* the handle is the OS's problem now; never mask the caller's result */
      }
    }
  }
}
