/**
 * ============================================================================
 *  AvertXAI Focal Registry — PROPRIETARY
 *  Copyright (c) 2026 AvertXAI Umbrella Corp. All rights reserved.
 * ----------------------------------------------------------------------------
 *  isobmff.ts — ISO base media file format geometry reader.
 *  Recovers the four fields music-metadata cannot deliver for MP4/MOV:
 *  bitrate, encoded dimensions, display dimensions, rotation.
 *  Written from ISO/IEC 14496-12 and the QuickTime File Format specification.
 *  Pure function. Knows nothing of the database, IPC, or the scan engine.
 * ============================================================================
 */

/** Result of a parse. Every field is independently nullable — a partial read is
 *  a success, not a failure. Absent means "not present in this file", never zero. */
export interface IsoBmffGeometry {
  /** Encoded pixels, from the visual sample description. */
  encodedWidth: number | null;
  encodedHeight: number | null;
  /** Display pixels, from the track header (post-transform, 16.16 fixed point). */
  displayWidth: number | null;
  displayHeight: number | null;
  /** Bits per second. */
  bitrate: number | null;
  /** Where the bitrate came from. A computed value is not a declared one. */
  bitrateSource: "btrt" | "esds" | "computed" | null;
  /** Degrees clockwise: 0, 90, 180, or 270. Null when the transform matrix is
   *  non-canonical — a wrong rotation is worse than an absent one. */
  rotation: number | null;
  /** Four-character code of the video sample entry, recorded verbatim rather
   *  than matched against a whitelist. Unknown codecs degrade to a string. */
  videoFourCharacterCode: string | null;
  /** Seconds. Present as a cross-check against music-metadata, never a replacement. */
  durationSeconds: number | null;
}

/** Traversal ceilings. A malformed file must not become an infinite walk.
 *  MAXIMUM_BOX_DEPTH is exported-but-unenforced: the current walk never self-recurses (callers
 *  descend deliberately) and MAXIMUM_BOXES_WALKED bounds the total — the cap is published for the
 *  harness and for any future caller that adds recursive descent. */
export const MAXIMUM_BOX_DEPTH = 12;
const MAXIMUM_BOXES_WALKED = 8192;
const MINIMUM_BOX_SIZE = 8;

/** Degrees of slack permitted when snapping a transform matrix to a right angle. */
const ROTATION_TOLERANCE_DEGREES = 1;

interface BoxHeader {
  type: string;
  contentStart: number;
  contentEnd: number;
  boxEnd: number;
}

interface WalkState {
  boxesWalked: number;
}

/**
 * Parse ISO base media format geometry from a buffer.
 *
 * The buffer must contain the `moov` box. `moov` may legally sit before or after
 * `mdat`, so a caller reading only a leading window may miss it — a null return
 * with no fields populated means "moov not found in this buffer", not "bad file".
 *
 * @param buffer        Bytes to parse. Never mutated.
 * @param fileSizeBytes Optional. Enables the computed-bitrate fallback when the
 *                      file declares no `btrt` or `esds` value.
 * @returns Geometry, or null when the buffer is not ISO base media format.
 *          Never throws.
 */
export function parseIsoBmffGeometry(
  buffer: Buffer,
  fileSizeBytes?: number
): IsoBmffGeometry | null {
  try {
    if (!Buffer.isBuffer(buffer) || buffer.length < MINIMUM_BOX_SIZE) {
      return null;
    }

    const state: WalkState = { boxesWalked: 0 };
    const topLevelBoxes = readBoxes(buffer, 0, buffer.length, state);

    // A valid file opens with ftyp (MP4) or begins with a recognized top-level
    // box (some QuickTime writers omit ftyp). Require at least one known box.
    const hasRecognizableStructure = topLevelBoxes.some((box) =>
      ["ftyp", "moov", "mdat", "free", "skip", "wide", "pnot"].includes(box.type)
    );
    if (!hasRecognizableStructure) {
      return null;
    }

    const movieBox = topLevelBoxes.find((box) => box.type === "moov");
    if (!movieBox) {
      return emptyGeometry();
    }

    const geometry = emptyGeometry();
    const trackBoxes = readBoxes(
      buffer,
      movieBox.contentStart,
      movieBox.contentEnd,
      state
    ).filter((box) => box.type === "trak");

    for (const trackBox of trackBoxes) {
      readTrack(buffer, trackBox, state, geometry);
    }

    // Computed fallback is last, and only when nothing was declared.
    if (
      geometry.bitrate === null &&
      typeof fileSizeBytes === "number" &&
      fileSizeBytes > 0 &&
      geometry.durationSeconds !== null &&
      geometry.durationSeconds > 0
    ) {
      geometry.bitrate = Math.round((fileSizeBytes * 8) / geometry.durationSeconds);
      geometry.bitrateSource = "computed";
    }

    return geometry;
  } catch {
    // A parse failure is a null result, never a thrown error. The scan continues.
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Track traversal                                                             */
/* -------------------------------------------------------------------------- */

function readTrack(
  buffer: Buffer,
  trackBox: BoxHeader,
  state: WalkState,
  geometry: IsoBmffGeometry
): void {
  const trackChildren = readBoxes(
    buffer,
    trackBox.contentStart,
    trackBox.contentEnd,
    state
  );

  const mediaBox = trackChildren.find((box) => box.type === "mdia");
  if (!mediaBox) {
    return;
  }

  const mediaChildren = readBoxes(
    buffer,
    mediaBox.contentStart,
    mediaBox.contentEnd,
    state
  );

  // Handler type selects the track. 'vide' is the only one carrying geometry.
  const handlerBox = mediaChildren.find((box) => box.type === "hdlr");
  if (!handlerBox) {
    return;
  }
  const handlerType = readHandlerType(buffer, handlerBox);
  if (handlerType !== "vide") {
    return;
  }

  // Track header: display dimensions and the transform matrix.
  const trackHeaderBox = trackChildren.find((box) => box.type === "tkhd");
  if (trackHeaderBox) {
    readTrackHeader(buffer, trackHeaderBox, geometry);
  }

  // Media header: timescale and duration.
  const mediaHeaderBox = mediaChildren.find((box) => box.type === "mdhd");
  if (mediaHeaderBox) {
    readMediaHeader(buffer, mediaHeaderBox, geometry);
  }

  // Sample description: encoded dimensions, four-character code, declared bitrate.
  const mediaInformationBox = mediaChildren.find((box) => box.type === "minf");
  if (!mediaInformationBox) {
    return;
  }
  const sampleTableBox = readBoxes(
    buffer,
    mediaInformationBox.contentStart,
    mediaInformationBox.contentEnd,
    state
  ).find((box) => box.type === "stbl");
  if (!sampleTableBox) {
    return;
  }
  const sampleDescriptionBox = readBoxes(
    buffer,
    sampleTableBox.contentStart,
    sampleTableBox.contentEnd,
    state
  ).find((box) => box.type === "stsd");
  if (sampleDescriptionBox) {
    readVisualSampleDescription(buffer, sampleDescriptionBox, state, geometry);
  }
}

/* -------------------------------------------------------------------------- */
/* Individual box readers                                                      */
/* -------------------------------------------------------------------------- */

function readHandlerType(buffer: Buffer, handlerBox: BoxHeader): string | null {
  // version+flags (4), pre_defined (4), handler_type (4)
  const offset = handlerBox.contentStart + 8;
  if (offset + 4 > handlerBox.contentEnd) {
    return null;
  }
  return buffer.toString("latin1", offset, offset + 4);
}

function readTrackHeader(
  buffer: Buffer,
  trackHeaderBox: BoxHeader,
  geometry: IsoBmffGeometry
): void {
  const start = trackHeaderBox.contentStart;
  if (start + 4 > trackHeaderBox.contentEnd) {
    return;
  }

  const version = buffer.readUInt8(start);

  // Version 1 widens creation, modification, and duration to 64 bits.
  // v0: creation(4) modification(4) trackID(4) reserved(4) duration(4) = 20
  // v1: creation(8) modification(8) trackID(4) reserved(4) duration(8) = 32
  const afterVersionAndFlags = start + 4;
  const variableBlockLength = version === 1 ? 32 : 20;

  // Then: reserved(8) layer(2) alternateGroup(2) volume(2) reserved(2) = 16
  const matrixStart = afterVersionAndFlags + variableBlockLength + 16;
  const matrixLength = 36;
  const dimensionsStart = matrixStart + matrixLength;

  if (dimensionsStart + 8 > trackHeaderBox.contentEnd) {
    return;
  }

  // Matrix: nine 32-bit values. The first six are 16.16 fixed point.
  const matrixA = buffer.readInt32BE(matrixStart) / 65536;
  const matrixB = buffer.readInt32BE(matrixStart + 4) / 65536;

  geometry.rotation = deriveRotationDegrees(matrixA, matrixB);

  // Display dimensions are 16.16 fixed point.
  const displayWidth = buffer.readUInt32BE(dimensionsStart) / 65536;
  const displayHeight = buffer.readUInt32BE(dimensionsStart + 4) / 65536;

  if (displayWidth > 0) {
    geometry.displayWidth = Math.round(displayWidth);
  }
  if (displayHeight > 0) {
    geometry.displayHeight = Math.round(displayHeight);
  }
}

function readMediaHeader(
  buffer: Buffer,
  mediaHeaderBox: BoxHeader,
  geometry: IsoBmffGeometry
): void {
  const start = mediaHeaderBox.contentStart;
  if (start + 4 > mediaHeaderBox.contentEnd) {
    return;
  }

  const version = buffer.readUInt8(start);
  const afterVersionAndFlags = start + 4;

  let timescale: number;
  let duration: number;

  if (version === 1) {
    // creation(8) modification(8) timescale(4) duration(8)
    if (afterVersionAndFlags + 28 > mediaHeaderBox.contentEnd) {
      return;
    }
    timescale = buffer.readUInt32BE(afterVersionAndFlags + 16);
    const durationBig = buffer.readBigUInt64BE(afterVersionAndFlags + 20);
    duration = Number(durationBig);
  } else {
    // creation(4) modification(4) timescale(4) duration(4)
    if (afterVersionAndFlags + 16 > mediaHeaderBox.contentEnd) {
      return;
    }
    timescale = buffer.readUInt32BE(afterVersionAndFlags + 8);
    duration = buffer.readUInt32BE(afterVersionAndFlags + 12);
  }

  if (timescale > 0 && duration > 0 && Number.isFinite(duration)) {
    geometry.durationSeconds = duration / timescale;
  }
}

function readVisualSampleDescription(
  buffer: Buffer,
  sampleDescriptionBox: BoxHeader,
  state: WalkState,
  geometry: IsoBmffGeometry
): void {
  // version+flags (4), entry_count (4)
  const entriesStart = sampleDescriptionBox.contentStart + 8;
  if (entriesStart + 4 > sampleDescriptionBox.contentEnd) {
    return;
  }

  const entryCount = buffer.readUInt32BE(sampleDescriptionBox.contentStart + 4);
  let cursor = entriesStart;

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + MINIMUM_BOX_SIZE > sampleDescriptionBox.contentEnd) {
      return;
    }

    const entrySize = buffer.readUInt32BE(cursor);
    if (entrySize < MINIMUM_BOX_SIZE || cursor + entrySize > sampleDescriptionBox.contentEnd) {
      return;
    }

    const fourCharacterCode = buffer.toString("latin1", cursor + 4, cursor + 8);

    // VisualSampleEntry layout, from the start of the entry:
    //   size(4) format(4) reserved(6) dataReferenceIndex(2)
    //   preDefined(2) reserved(2) preDefined(12)
    //   width(2) height(2) ...
    const widthOffset = cursor + 32;
    if (widthOffset + 4 <= cursor + entrySize) {
      const encodedWidth = buffer.readUInt16BE(widthOffset);
      const encodedHeight = buffer.readUInt16BE(widthOffset + 2);

      if (encodedWidth > 0 && encodedHeight > 0) {
        geometry.encodedWidth = encodedWidth;
        geometry.encodedHeight = encodedHeight;
        geometry.videoFourCharacterCode = fourCharacterCode;

        // Extension boxes follow the fixed 86-byte visual sample entry header.
        const extensionsStart = cursor + 86;
        const extensionsEnd = cursor + entrySize;
        if (extensionsStart < extensionsEnd) {
          readSampleEntryExtensions(buffer, extensionsStart, extensionsEnd, state, geometry);
        }
      }
    }

    cursor += entrySize;
  }
}

function readSampleEntryExtensions(
  buffer: Buffer,
  start: number,
  end: number,
  state: WalkState,
  geometry: IsoBmffGeometry
): void {
  const extensionBoxes = readBoxes(buffer, start, end, state);

  for (const box of extensionBoxes) {
    if (box.type === "btrt" && geometry.bitrateSource !== "btrt") {
      // bufferSizeDB(4) maxBitrate(4) avgBitrate(4)
      if (box.contentStart + 12 <= box.contentEnd) {
        const averageBitrate = buffer.readUInt32BE(box.contentStart + 8);
        if (averageBitrate > 0) {
          geometry.bitrate = averageBitrate;
          geometry.bitrateSource = "btrt";
        }
      }
    } else if (box.type === "esds" && geometry.bitrateSource === null) {
      const averageBitrate = readElementaryStreamBitrate(buffer, box);
      if (averageBitrate !== null) {
        geometry.bitrate = averageBitrate;
        geometry.bitrateSource = "esds";
      }
    }
  }
}

/**
 * Walk the elementary stream descriptor chain for the declared average bitrate.
 * Descriptor lengths use 7-bit continuation encoding.
 */
function readElementaryStreamBitrate(buffer: Buffer, esdsBox: BoxHeader): number | null {
  let cursor = esdsBox.contentStart + 4; // skip version+flags
  const end = esdsBox.contentEnd;
  let descriptorsRead = 0;

  while (cursor < end && descriptorsRead < 32) {
    descriptorsRead += 1;

    const tag = buffer.readUInt8(cursor);
    cursor += 1;

    let length = 0;
    let lengthBytesRead = 0;
    while (cursor < end && lengthBytesRead < 4) {
      const lengthByte = buffer.readUInt8(cursor);
      cursor += 1;
      lengthBytesRead += 1;
      length = (length << 7) | (lengthByte & 0x7f);
      if ((lengthByte & 0x80) === 0) {
        break;
      }
    }

    if (tag === 0x03) {
      // ES_Descriptor: esId(2) flags(1), then nested descriptors.
      if (cursor + 3 > end) {
        return null;
      }
      const flags = buffer.readUInt8(cursor + 2);
      cursor += 3;
      if (flags & 0x80) cursor += 2; // stream dependence
      if (flags & 0x40) {
        if (cursor >= end) return null;
        cursor += 1 + buffer.readUInt8(cursor); // URL
      }
      if (flags & 0x20) cursor += 2; // OCR stream
      continue;
    }

    if (tag === 0x04) {
      // DecoderConfigDescriptor:
      //   objectTypeIndication(1) streamType(1) bufferSizeDB(3)
      //   maxBitrate(4) avgBitrate(4)
      if (cursor + 13 > end) {
        return null;
      }
      const averageBitrate = buffer.readUInt32BE(cursor + 9);
      return averageBitrate > 0 ? averageBitrate : null;
    }

    cursor += length;
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Box primitives                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Read sibling boxes across a byte range. Never recurses on its own — callers
 * descend deliberately, which keeps depth bounded and the walk auditable.
 */
function readBoxes(
  buffer: Buffer,
  start: number,
  end: number,
  state: WalkState
): BoxHeader[] {
  const boxes: BoxHeader[] = [];
  let cursor = start;

  while (cursor + MINIMUM_BOX_SIZE <= end) {
    if (state.boxesWalked >= MAXIMUM_BOXES_WALKED) {
      return boxes;
    }
    state.boxesWalked += 1;

    const declaredSize = buffer.readUInt32BE(cursor);
    const type = buffer.toString("latin1", cursor + 4, cursor + 8);
    let contentStart = cursor + 8;
    let boxEnd: number;

    if (declaredSize === 1) {
      // A size of 1 means a 64-bit largesize follows the type.
      if (cursor + 16 > end) {
        return boxes;
      }
      const largeSize = buffer.readBigUInt64BE(cursor + 8);
      if (largeSize < 16n || largeSize > BigInt(Number.MAX_SAFE_INTEGER)) {
        return boxes;
      }
      contentStart = cursor + 16;
      boxEnd = cursor + Number(largeSize);
    } else if (declaredSize === 0) {
      // A size of 0 means the box runs to the end of the range.
      boxEnd = end;
    } else if (declaredSize < MINIMUM_BOX_SIZE) {
      // Zero or undersized declarations are the infinite-loop case. Bail out.
      return boxes;
    } else {
      boxEnd = cursor + declaredSize;
    }

    if (boxEnd > end || boxEnd <= cursor) {
      // Never trust a size field to fall inside the buffer.
      return boxes;
    }

    boxes.push({ type, contentStart, contentEnd: boxEnd, boxEnd });
    cursor = boxEnd;
  }

  return boxes;
}

/**
 * Derive clockwise rotation from the first row of the transform matrix.
 * Returns null for any matrix that does not sit within tolerance of a right
 * angle — an unrecognized transform is recorded as unknown, never guessed.
 */
function deriveRotationDegrees(matrixA: number, matrixB: number): number | null {
  if (matrixA === 0 && matrixB === 0) {
    return null;
  }

  const radians = Math.atan2(matrixB, matrixA);
  const degrees = (radians * 180) / Math.PI;
  const normalized = ((degrees % 360) + 360) % 360;

  for (const candidate of [0, 90, 180, 270]) {
    const difference = Math.min(
      Math.abs(normalized - candidate),
      Math.abs(normalized - candidate - 360)
    );
    if (difference <= ROTATION_TOLERANCE_DEGREES) {
      return candidate;
    }
  }

  return null;
}

function emptyGeometry(): IsoBmffGeometry {
  return {
    encodedWidth: null,
    encodedHeight: null,
    displayWidth: null,
    displayHeight: null,
    bitrate: null,
    bitrateSource: null,
    rotation: null,
    videoFourCharacterCode: null,
    durationSeconds: null,
  };
}