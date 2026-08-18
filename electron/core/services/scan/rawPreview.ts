// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: The camera's own embedded JPEG preview, read out of a RAW at its recorded offset.
//              TWO CONTAINERS, ONE ENTRY POINT. READ-ONLY, and no RAW decode ever happens (§4.1).
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/scan/rawPreview.ts
//------------------------------------------------------------
//
// ONE ENTRY POINT: `previewFor(path)`. It sniffs the container and dispatches:
//
//     II*\0 / MM\0*  ->  TIFF        -> readTiffPreview      CR2, NEF, ARW, ORF, RW2, DNG, TIFF
//     ....ftyp       ->  ISO BMFF    -> readIsoBmffPreview   CR3
//
// Nikon and Sony are TIFF containers, so they already arrive at the TIFF strategy — the seam is
// there and nothing is built for them ahead of files to test against.
//
// NOTE ON THE WORK ORDER'S DESCRIPTION OF THE SEAM: it says "TIFF via `exifr`". That is out of date
// by about an hour. `exifr` does NOT read a CR2 preview — it parses from a header window and THROWS
// reaching for bytes that live megabytes in ("Invalid typed array length: 15962", which is that
// file's own ThumbnailLength). That is what commit 0faf8c7 fixed. So the TIFF strategy here is our
// own IFD walker, and `exifr` survives only as the last-resort branch in mediaBrowse for HEIC and
// PSD, which are neither of these containers.
//
// =============================================================================================
// WHY NEITHER STRATEGY MAY SIMPLY TAKE THE BIGGEST JPEG IT FINDS
//
// Both containers hold a large block that begins `FF D8 FF` and is the WRONG ANSWER, and in both
// cases taking it would have looked like a success:
//
//   CR2 — the largest candidate is 30,044,307 bytes of RAW SENSOR DATA, which Canon stores as
//         LOSSLESS JPEG (SOF3). It passes a signature check and no browser can draw it. The
//         defence is the START-OF-FRAME marker, not the signature.
//
//   CR3 — `mdat` opens with a full-resolution 8192x5464 JPEG whose length is NOT declared by the
//         box header, so "read to the end of the box" would hand back 55 MB. The defence is that
//         this strategy only ever reads NAMED preview boxes and never touches `mdat`.
//
// =============================================================================================
// MEASURED, 08-18-2026, against D:\Summit — see the reports for the full trees and tallies.
//
//   CR2  IFD0 StripOffsets 273/279 -> full preview   IFD1 ThumbnailOffset 513/514 -> thumbnail
//   CR3  moov/uuid(85c0b687..)/THMB -> 160x120       uuid(eaf42b5e..)/PRVW -> 1620x1080
import fs from "node:fs";

/** How much of the front of the file is read to find the TIFF IFD chain. One sequential read. */
const HEADER_BYTES = 256 * 1024;

/** Offset tags: StripOffsets, and ThumbnailOffset / PreviewImageStart / JpgFromRawStart — which are
 *  all tag 0x0201 in different IFDs. THE TAG NUMBERS ARE THE SAME ACROSS MAKES; only which IFD
 *  carries them differs, which is why walking the chain covers makes this has no files to test. */
const OFFSET_TAGS = new Set([0x0111, 0x0201]);
/** The matching length tags: StripByteCounts, ThumbnailLength / PreviewImageLength. */
const LENGTH_TAGS = new Set([0x0117, 0x0202]);
/** Tags whose value points at another IFD — SubIFDs (where Nikon and Sony keep the big preview)
 *  and the Exif IFD. */
const SUBIFD_TAGS = new Set([0x014a, 0x8769]);

/** SOF markers a browser can actually draw: baseline, extended sequential, progressive. Everything
 *  else in the range is lossless, arithmetic or differential. This set is the whole CR2 defence. */
const DRAWABLE_SOF = new Set([0xc0, 0xc1, 0xc2]);

/** Below this a "preview" is a favicon; above it something has gone wrong with the parse. */
const MIN_PREVIEW = 1024;
const MAX_PREVIEW = 32 * 1024 * 1024;

/** Stops a malformed or hostile file walking forever. A real RAW uses a handful of each. */
const MAX_IFDS = 32;
const MAX_BOXES = 4096;
/** ISO BMFF nesting is walked with an explicit stack, never by recursion — but a file can still
 *  claim boxes inside boxes forever, so depth is capped too. Real CR3 needs 2. */
const MAX_BOX_DEPTH = 6;

/** The Canon preview boxes, in preference order: the big one, then the small one. NOTHING ELSE is
 *  ever read — `mdat` is deliberately not in this set, see the header. */
const CR3_PREVIEW_BOXES = ["PRVW", "THMB"];
/** Boxes worth descending into. An allow-list, not "anything that parses". */
const CR3_CONTAINERS = new Set(["moov", "uuid"]);
/** The JPEG sits at payload+16 in both PRVW and THMB — but the fields BEFORE it are laid out
 *  differently (THMB declares its length at payload+8, PRVW at payload+12), so the start is found
 *  by looking for the signature inside this window rather than by trusting an offset. */
const CR3_SOI_WINDOW = 64;

export interface RawPreview {
  bytes: Buffer;
  /** Absolute file offset the bytes came from, for the diagnostic line. */
  offset: number;
  /** Which strategy answered — "tiff" or "isobmff". */
  via: string;
}

interface Candidate {
  offset: number;
  length: number;
}

/**
 * The Start-Of-Frame marker of a JPEG, or 0 if there is none before the scan starts.
 *
 * Walks the marker segments rather than searching for a byte pattern: `FF C3` occurs by chance
 * inside entropy-coded data often enough that a naive search would be a coin toss.
 */
function startOfFrame(b: Buffer): number {
  let i = 2; // past SOI
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) { i += 1; continue; }
    const marker = b[i + 1];
    if (marker === 0xff) { i += 1; continue; } // fill byte
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    // SOF0..SOF15, excluding DHT (C4), JPG (C8) and DAC (CC), which share the range
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return marker;
    if (marker === 0xda) return 0; // start of scan reached with no SOF — not decodable
    i += 2 + b.readUInt16BE(i + 2);
  }
  return 0;
}

/** Does this look like a JPEG a browser will draw? Signature AND frame header. */
function drawable(probe: Buffer): boolean {
  if (probe.length < 4) return false;
  if (probe[0] !== 0xff || probe[1] !== 0xd8 || probe[2] !== 0xff) return false;
  return DRAWABLE_SOF.has(startOfFrame(probe));
}

/** Trim trailing padding back to the JPEG's own end-of-image marker. A box can be longer than the
 *  image inside it — the measured PRVW carries five bytes of slack — and trailing bytes after EOI
 *  are harmless but pointless to cache. Returns the buffer untouched if no EOI is found. */
function trimToEoi(b: Buffer): Buffer {
  for (let i = b.length - 2; i >= 2; i -= 1) {
    if (b[i] === 0xff && b[i + 1] === 0xd9) return b.subarray(0, i + 2);
  }
  return b;
}

// =============================================================================================
// STRATEGY 1 — TIFF containers (CR2, NEF, ARW, ORF, RW2, DNG)
// =============================================================================================

/**
 * Every offset/length pair in the file's IFD chain, largest first.
 *
 * Follows the next-IFD pointer AND descends into SubIFDs, because that is where makes differ:
 * Canon puts the full preview in IFD0's StripOffsets, Nikon and Sony put theirs in a SubIFD. Same
 * tag numbers either way.
 */
function tiffCandidates(head: Buffer): Candidate[] {
  if (head.length < 8) return [];
  const little = head[0] === 0x49 && head[1] === 0x49;
  const big = head[0] === 0x4d && head[1] === 0x4d;
  if (!little && !big) return [];
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
      if (type !== 3 && type !== 4) continue; // SHORT or LONG; nothing else is an offset
      const value = type === 3 ? u16(e + 8) : u32(e + 8);
      if (SUBIFD_TAGS.has(tag)) {
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

  // Largest first: the full preview beats the 160-by-120 thumbnail whenever both are drawable, and
  // the raw payload that outweighs both is thrown out by the SOF gate, not by this ordering.
  return found.sort((a, b) => b.length - a.length);
}

async function readTiffPreview(handle: fs.promises.FileHandle, head: Buffer, size: number): Promise<RawPreview | null> {
  for (const c of tiffCandidates(head)) {
    if (c.length < MIN_PREVIEW || c.length > MAX_PREVIEW) continue;
    if (c.offset + c.length > size) continue; // a bad parse, not a preview

    // 4 KB is enough for SOI plus the metadata segments ahead of the frame header. The two-step
    // read is the whole point: a rejected candidate costs 4 KB, not 30 MB.
    const probeLen = Math.min(c.length, 4096);
    const probe = Buffer.alloc(probeLen);
    const got = await handle.read(probe, 0, probeLen, c.offset);
    if (!drawable(probe.subarray(0, got.bytesRead))) continue;

    const bytes = Buffer.alloc(c.length);
    const read = await handle.read(bytes, 0, c.length, c.offset);
    if (read.bytesRead < MIN_PREVIEW) continue;
    return { bytes: bytes.subarray(0, read.bytesRead), offset: c.offset, via: "tiff" };
  }
  return null;
}

// =============================================================================================
// STRATEGY 2 — ISO Base Media File Format (CR3)
// =============================================================================================

interface Box {
  type: string;
  /** First byte of the box's PAYLOAD — past the size/type header and past a uuid's 16-byte id. */
  start: number;
  /** One past the box's last byte. */
  end: number;
  depth: number;
}

/** A box type is four printable characters. Used to tell a real header from a field that happens
 *  to sit where one was expected. */
function plausibleType(b: Buffer, at: number): boolean {
  for (let i = at; i < at + 4; i += 1) {
    if (i >= b.length || b[i] < 0x20 || b[i] > 0x7e) return false;
  }
  return true;
}

/**
 * Where a container's first CHILD box actually begins.
 *
 * MEASURED, AND IT IS NOT ALWAYS THE PAYLOAD. The two Canon uuid boxes disagree: the one inside
 * `moov` (85c0b687…) starts its children immediately, while the top-level preview box
 * (eaf42b5e…) carries EIGHT BYTES of version/flags first. Assuming the payload cost the 1620x1080
 * PRVW on every file measured — the walk read `00000000` as a size, treated it as "to the end of
 * the parent", and returned only the 160x120 THMB. Every tile was a real image, and every one of
 * them was the wrong one, which is exactly the kind of near-miss that ships.
 *
 * So the start is PROBED rather than assumed: step forward in four-byte units, a bounded distance,
 * until a size and a four-printable-character type appear that fit inside the parent. Returns -1
 * when nothing plausible is there, which ends the descent cleanly.
 */
function firstChildAt(probe: Buffer, base: number, parentEnd: number): number {
  for (let skip = 0; skip + 8 <= probe.length; skip += 4) {
    const at = base + skip;
    if (at + 8 > parentEnd) return -1;
    if (!plausibleType(probe, skip + 4)) continue;
    const size = probe.readUInt32BE(skip);
    if (size === 1) return at; // 64-bit largesize form; the caller validates the real size
    if (size >= 8 && at + size <= parentEnd) return at;
  }
  return -1;
}

/**
 * Find the named preview boxes by walking the box tree ITERATIVELY.
 *
 * NO RECURSION and NO TRUST. Every size is checked against the parent's end before it is used, a
 * zero size is treated as "to the end of the parent" per the specification, the 64-bit `largesize`
 * form is handled, and both the box count and the depth are capped. A truncated or hostile file
 * ends this loop; it does not hang it and it does not allocate wildly.
 *
 * Only `moov` and `uuid` are descended, and only the named preview boxes are returned — which is
 * how `mdat` is never touched even though it opens with a valid 8192x5464 JPEG.
 */
async function findCr3Boxes(handle: fs.promises.FileHandle, size: number): Promise<Map<string, Box>> {
  const out = new Map<string, Box>();
  const stack: Array<{ at: number; end: number; depth: number }> = [{ at: 0, end: size, depth: 0 }];
  const header = Buffer.alloc(32);
  let budget = MAX_BOXES;

  while (stack.length > 0 && budget > 0) {
    const frame = stack.pop();
    if (!frame) break;

    // One 40-byte probe per container to find where its children really begin — see firstChildAt.
    // The top-level frame starts at 0, where `ftyp` sits with no preamble, so it aligns at once.
    const align = Buffer.alloc(40);
    const probed = await handle.read(align, 0, 40, frame.at);
    let at = firstChildAt(align.subarray(0, probed.bytesRead), frame.at, frame.end);
    if (at < 0) continue;

    while (at + 8 <= frame.end && budget > 0) {
      budget -= 1;
      const got = await handle.read(header, 0, 32, at);
      if (got.bytesRead < 8) break;

      let boxSize = header.readUInt32BE(0);
      const type = header.subarray(4, 8).toString("latin1");
      let headerLen = 8;
      if (boxSize === 1) {
        if (got.bytesRead < 16) break;
        const large = header.readBigUInt64BE(8);
        // A size that cannot be an offset in this file is a corrupt field, not a big box.
        if (large > BigInt(Number.MAX_SAFE_INTEGER)) break;
        boxSize = Number(large);
        headerLen = 16;
      } else if (boxSize === 0) {
        boxSize = frame.end - at; // "to the end of the enclosing box", per the specification
      }
      // THE SANITY CHECK THE WORK ORDER ASKS FOR, and it is what makes a truncated file fail
      // cleanly: a box may not be smaller than its own header, and may not claim to run past its
      // parent. Either means the tree is not walkable from here.
      if (boxSize < headerLen || at + boxSize > frame.end) break;

      // A uuid box's first 16 payload bytes are its identifier, not content.
      const payload = at + headerLen + (type === "uuid" ? 16 : 0);
      const boxEnd = at + boxSize;
      if (payload <= boxEnd) {
        if (CR3_PREVIEW_BOXES.includes(type) && !out.has(type)) {
          out.set(type, { type, start: payload, end: boxEnd, depth: frame.depth });
        } else if (CR3_CONTAINERS.has(type) && frame.depth < MAX_BOX_DEPTH) {
          stack.push({ at: payload, end: boxEnd, depth: frame.depth + 1 });
        }
      }
      if (out.size === CR3_PREVIEW_BOXES.length) return out; // both found, stop walking
      at = boxEnd;
    }
  }
  return out;
}

async function readIsoBmffPreview(handle: fs.promises.FileHandle, size: number): Promise<RawPreview | null> {
  const boxes = await findCr3Boxes(handle, size);
  // Preference order is the order of the names, not the order they were found in the file: the
  // 1620x1080 PRVW is worth far more to a tile and to the viewer than the 160x120 THMB.
  for (const name of CR3_PREVIEW_BOXES) {
    const box = boxes.get(name);
    if (!box) continue;
    const span = box.end - box.start;
    if (span < MIN_PREVIEW || span > MAX_PREVIEW) continue;

    // THE JPEG DOES NOT START AT THE PAYLOAD. Both boxes carry a small fixed-size header first, and
    // the two are laid out DIFFERENTLY — measured, THMB declares its length at payload+8 and PRVW
    // at payload+12, though both put the image at payload+16. Rather than encode an undocumented
    // vendor layout, the signature is located inside a small window. If Canon moves a field, this
    // still finds the image.
    const windowLen = Math.min(span, CR3_SOI_WINDOW + 4096);
    const front = Buffer.alloc(windowLen);
    const got = await handle.read(front, 0, windowLen, box.start);
    const head = front.subarray(0, got.bytesRead);
    let soi = -1;
    for (let i = 0; i + 3 <= head.length && i < CR3_SOI_WINDOW; i += 1) {
      if (head[i] === 0xff && head[i + 1] === 0xd8 && head[i + 2] === 0xff) { soi = i; break; }
    }
    if (soi < 0) continue;
    if (!drawable(head.subarray(soi))) continue;

    const length = span - soi;
    if (length < MIN_PREVIEW || length > MAX_PREVIEW) continue;
    const bytes = Buffer.alloc(length);
    const read = await handle.read(bytes, 0, length, box.start + soi);
    if (read.bytesRead < MIN_PREVIEW) continue;
    // Trailing padding between the image and the end of the box is real — the measured PRVW has
    // five bytes of it — so the buffer is cut back to the image's own end marker.
    return { bytes: trimToEoi(bytes.subarray(0, read.bytesRead)), offset: box.start + soi, via: "isobmff" };
  }
  return null;
}

// =============================================================================================
// THE ENTRY POINT
// =============================================================================================

/**
 * The best drawable embedded JPEG preview in a RAW file, or null.
 *
 * READ-ONLY: the handle is opened "r", and nothing in this file writes, moves, renames or converts
 * anything. A photographer's negative is never modified to look at it.
 *
 * Never throws — a caller forced to wrap this in a try/catch is a caller that will eventually print
 * an exception into the user interface, which is the defect this module was written to end.
 */
export async function previewFor(filePath: string): Promise<RawPreview | null> {
  let handle: fs.promises.FileHandle | null = null;
  try {
    handle = await fs.promises.open(filePath, "r");
    const size = (await handle.stat()).size;
    if (size < 16) return null;

    // One sequential read serves both the container sniff and the whole TIFF walk.
    const head = Buffer.alloc(Math.min(HEADER_BYTES, size));
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    const front = head.subarray(0, bytesRead);
    if (front.length < 12) return null;

    const isTiff = (front[0] === 0x49 && front[1] === 0x49) || (front[0] === 0x4d && front[1] === 0x4d);
    if (isTiff) return await readTiffPreview(handle, front, size);
    // ISO BMFF identifies itself by an `ftyp` box first, at bytes 4..8.
    if (front.subarray(4, 8).toString("latin1") === "ftyp") return await readIsoBmffPreview(handle, size);
    return null; // HEIC without ftyp, PSD, or something else — mediaBrowse falls back to exifr
  } catch {
    // A missing file, a pulled drive, a permission refusal — the caller already has a written
    // sentence for each of those, and it reaches them by finding no preview here.
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
