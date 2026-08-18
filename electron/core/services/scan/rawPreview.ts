// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: The camera's own embedded JPEG preview, read out of a TIFF-container RAW at its
//              recorded offset. READ-ONLY, and no RAW decode ever happens here (§4.1).
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/scan/rawPreview.ts
//------------------------------------------------------------
//
// WHY THIS FILE EXISTS.
//
// `exifr.thumbnail()` does not work on a Canon CR2, and it does not fail quietly — it THROWS.
// Measured 08-18-2026 against `D:\Summit\Day 1 - Jason`:
//
//     IMG_0541.CR2  33,746,639 bytes   exifr.thumbnail() THREW: Invalid typed array length: 15962
//     IMG_0543.CR2  37,747,915 bytes   exifr.thumbnail() THREW: Invalid typed array length: 19100
//     IMG_0544.CR2  39,056,130 bytes   exifr.thumbnail() THREW: Invalid typed array length: 19339
//
// The number in each message is that file's own `ThumbnailLength`, so exifr READ THE TAGS
// CORRECTLY and then failed to fetch the bytes: it parses from a header window, and the preview
// lives past the end of it. Exactly the failure canon predicts for a header-only reader.
//
// That throw is also why the tile caption read `IMG_0541.CR2 · That f…` — it landed in readImage's
// catch and came back as `That file could not be read: …`. ONE ROOT CAUSE, BOTH REPORTED DEFECTS.
//
// ---------------------------------------------------------------------------------------------
// THE TRAP THAT MAKES THIS MORE THAN A SEEK, and the reason `FF D8 FF` alone is not enough.
//
// A CR2 holds FOUR candidate offset/length pairs. Ordered by size, the first is a 30 MB block that
// begins `FF D8 FF` and is NOT a preview — it is the RAW SENSOR DATA, which Canon stores as
// LOSSLESS JPEG. It passes a signature check, no browser on earth can draw it, and taking it would
// have put 30 MB of undecodable payload through the cache for every file:
//
//     offset 3,702,332  len 30,044,307  SOF3  ← lossless JPEG: the raw sensor data
//     offset    69,304  len  2,570,353  SOF0  ← THE ONE WE WANT: the full-size preview
//     offset 2,639,660  len  1,062,672        ← not a JPEG at all
//     offset    53,340  len     15,962        ← the small IFD1 thumbnail
//
// So the gate is the START-OF-FRAME MARKER, not the signature. A browser draws SOF0 (baseline),
// SOF1 (extended sequential) and SOF2 (progressive). Every other SOF is lossless, arithmetic or
// differential. Checking it costs a 4 KB read and is the difference between the right image and
// thirty megabytes of the wrong one.
//
// RESULT over the first fifty .CR2 in that folder: 50 previews, 0 fallbacks, 0 failures, typical
// preview 2,635 KB against a ~35 MB file — about 7 percent of the file read.
import fs from "node:fs";

/** How much of the front of the file is read to find the IFD chain. The chain itself lives in the
 *  first few kilobytes of every file measured; this is slack, not a requirement, and it is ONE
 *  sequential read rather than a series of seeks. */
const HEADER_BYTES = 256 * 1024;

/** Offset tags: StripOffsets, and ThumbnailOffset / PreviewImageStart / JpgFromRawStart — which are
 *  all tag 0x0201 in different IFDs. THE TAG NUMBERS ARE THE SAME ACROSS MAKES; only which IFD
 *  carries them differs, which is why walking the chain covers makes this has no files to test. */
const OFFSET_TAGS = new Set([0x0111, 0x0201]);
/** The matching length tags: StripByteCounts, ThumbnailLength / PreviewImageLength. */
const LENGTH_TAGS = new Set([0x0117, 0x0202]);
/** Tags whose value is a pointer to another IFD — SubIFDs (where Nikon and Sony keep the big
 *  preview) and the Exif IFD. */
const SUBIFD_TAGS = new Set([0x014a, 0x8769]);

/** SOF markers a browser can actually draw. See the trap above — this set is the whole defence. */
const DRAWABLE_SOF = new Set([0xc0, 0xc1, 0xc2]);

/** Below this a "preview" is a favicon, above it something has gone wrong with the parse. */
const MIN_PREVIEW = 1024;
const MAX_PREVIEW = 32 * 1024 * 1024;

/** Stop a malformed or hostile file from walking forever. A real RAW uses a handful. */
const MAX_IFDS = 32;

export interface RawPreview {
  bytes: Buffer;
  /** Where it came from, for the diagnostic line. */
  offset: number;
}

interface Candidate {
  offset: number;
  length: number;
}

/**
 * The Start-Of-Frame marker of a JPEG, or 0 if there is not one before the scan starts.
 *
 * Walks the marker segments rather than scanning for a byte pattern: `FF C3` occurs by chance
 * inside entropy-coded data often enough that a naive search would be a coin toss.
 */
function startOfFrame(b: Buffer): number {
  let i = 2; // past SOI
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) { i += 1; continue; }
    const marker = b[i + 1];
    // fill byte, or a standalone marker carrying no length
    if (marker === 0xff) { i += 1; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    // SOF0..SOF15, excluding DHT (C4), JPG (C8) and DAC (CC), which share the range
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return marker;
    if (marker === 0xda) return 0; // start of scan — there was no SOF, so this is not decodable
    i += 2 + b.readUInt16BE(i + 2);
  }
  return 0;
}

/**
 * Every offset/length pair in the file's IFD chain, largest first.
 *
 * Follows the next-IFD pointer AND descends into SubIFDs, because that is where the makes differ:
 * Canon puts the full preview in IFD0's StripOffsets, and Nikon and Sony put theirs in a SubIFD.
 * Same tag numbers either way.
 */
function candidates(head: Buffer): Candidate[] {
  if (head.length < 8) return [];
  const little = head[0] === 0x49 && head[1] === 0x49;
  const big = head[0] === 0x4d && head[1] === 0x4d;
  if (!little && !big) return []; // not a TIFF container — HEIC and CR3 are ISO-BMFF, not this
  const u16 = (o: number): number => (o + 2 > head.length ? 0 : little ? head.readUInt16LE(o) : head.readUInt16BE(o));
  const u32 = (o: number): number => (o + 4 > head.length ? 0 : little ? head.readUInt32LE(o) : head.readUInt32BE(o));
  if (u16(2) !== 42) return []; // the TIFF magic

  const found: Candidate[] = [];
  const seen = new Set<number>();
  const queue: number[] = [u32(4)];

  while (queue.length > 0 && seen.size < MAX_IFDS) {
    const at = queue.shift() ?? 0;
    if (at <= 0 || at + 2 > head.length || seen.has(at)) continue;
    seen.add(at);
    const count = u16(at);
    if (count === 0 || count > 512) continue;
    const end = at + 2 + count * 12;
    if (end + 4 > head.length) continue;

    let offset = 0;
    let length = 0;
    for (let i = 0; i < count; i += 1) {
      const e = at + 2 + i * 12;
      const tag = u16(e);
      const type = u16(e + 2);
      const n = u32(e + 4);
      if (type !== 3 && type !== 4) continue; // SHORT or LONG; anything else is not an offset
      const value = type === 3 ? u16(e + 8) : u32(e + 8);
      if (SUBIFD_TAGS.has(tag)) {
        // One pointer sits inline; several are stored out of line as an array of LONGs.
        if (n === 1) queue.push(value);
        else if (type === 4 && n > 1 && n < 16) for (let k = 0; k < n; k += 1) queue.push(u32(value + k * 4));
        continue;
      }
      if (n !== 1) continue; // a multi-strip image is not a preview
      if (OFFSET_TAGS.has(tag)) offset = value;
      else if (LENGTH_TAGS.has(tag)) length = value;
    }
    if (offset > 0 && length > 0) found.push({ offset, length });
    queue.push(u32(end)); // the next IFD in the chain
  }

  // Largest first: the full-size preview beats the 160-by-120 thumbnail whenever both are drawable,
  // and the raw payload that outweighs both is thrown out by the SOF gate, not by this ordering.
  return found.sort((a, b) => b.length - a.length);
}

/**
 * The best drawable embedded JPEG in a TIFF-container RAW, or null.
 *
 * READ-ONLY: the handle is opened "r", and nothing in this file writes, moves or converts anything.
 * Never throws — a caller that has to wrap this in a try/catch is a caller that will print the
 * exception into the user interface, which is the defect this replaces.
 */
export async function readEmbeddedPreview(filePath: string): Promise<RawPreview | null> {
  let handle: fs.promises.FileHandle | null = null;
  try {
    handle = await fs.promises.open(filePath, "r");
    const size = (await handle.stat()).size;

    const head = Buffer.alloc(Math.min(HEADER_BYTES, size));
    const { bytesRead } = await handle.read(head, 0, head.length, 0);

    for (const c of candidates(head.subarray(0, bytesRead))) {
      if (c.length < MIN_PREVIEW || c.length > MAX_PREVIEW) continue;
      if (c.offset + c.length > size) continue; // a bad parse, not a preview

      // 4 KB is enough for SOI plus the metadata segments ahead of the frame header. The whole
      // point of the two-step read is that a rejected candidate costs 4 KB, not 30 MB.
      const probeLen = Math.min(c.length, 4096);
      const probe = Buffer.alloc(probeLen);
      const got = await handle.read(probe, 0, probeLen, c.offset);
      if (got.bytesRead < 4) continue;
      if (probe[0] !== 0xff || probe[1] !== 0xd8 || probe[2] !== 0xff) continue;
      if (!DRAWABLE_SOF.has(startOfFrame(probe.subarray(0, got.bytesRead)))) continue;

      const bytes = Buffer.alloc(c.length);
      const read = await handle.read(bytes, 0, c.length, c.offset);
      if (read.bytesRead < MIN_PREVIEW) continue;
      return { bytes: read.bytesRead === c.length ? bytes : bytes.subarray(0, read.bytesRead), offset: c.offset };
    }
    return null;
  } catch {
    // A missing file, a pulled drive, a permission refusal — the caller already has a sentence for
    // each of those, and it reaches them by finding no preview here.
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
