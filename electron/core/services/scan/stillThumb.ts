// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Downscale a still to a tile-sized JPEG, main-side, using Electron's own nativeImage.
//              READ-ONLY on the source; the thumbnail is a derived file in the app-owned cache.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/scan/stillThumb.ts
//------------------------------------------------------------
//
// WHY THIS EXISTS. Stills shipped to the renderer AT FULL SIZE and were sized by CSS. Measured
// 08-18-2026 on `D:\Summit\Day 1 - Jason`: an average JPEG is 7,790 KB, so its data URL is about
// 10,387 KB — per tile — and the renderer then decoded 6000x4000 to paint roughly 320 pixels.
// Video has done this correctly since the cache shipped: capture, downscale, encode small, store.
// Stills never got that treatment. Measured here: the same photograph becomes an 11 KB thumbnail,
// which is about 945 times smaller.
//
// NO NEW DEPENDENCY. `nativeImage` is Electron's own — createFromPath, createFromBuffer, resize,
// toJPEG. No sharp, no ImageMagick, no FFmpeg.
//
// =============================================================================================
// MEASURED FINDING — `nativeImage` IGNORES EXIF ORIENTATION, so we apply it ourselves.
//
// There is no rotated original anywhere on the test drive (901 files checked, one orientation
// value), so the fixture was built by copying a JPEG and rewriting its Orientation tag — the
// source was never opened for writing. Both rotated fixtures came back UNROTATED:
//
//     portrait6.jpg (Orientation 6, "Rotate 90 CW")  -> nativeImage 6000x4000  landscape
//     portrait8.jpg (Orientation 8, "Rotate 270 CW") -> nativeImage 6000x4000  landscape
//
// Left alone, every phone photo and every camera portrait would paint on its side. `nativeImage`
// has no rotate method, so the transform is done on the bitmap — AFTER the downscale, where it
// costs a loop over about 68,000 pixels instead of 24,000,000.
import { nativeImage } from "electron";
import exifr from "exifr";

/** Tile geometry. The wall draws at roughly 320 CSS pixels; matching the video thumbnails keeps one
 *  geometry and one quality across the whole grid. */
const THUMB_WIDTH = 320;
const THUMB_QUALITY = 70;

/** Guardrail on the encoded result. A tile thumbnail that lands above this did not downscale. */
const MAX_THUMB_BYTES = 512 * 1024;

/**
 * EXIF orientation, as the eight transforms it actually means.
 *
 * `[swapsAxes, flipX, flipY]` applied to the DESTINATION sampling. 1 is the identity and returns
 * early, which is the overwhelmingly common case and costs nothing.
 */
const ORIENT: Record<number, { swap: boolean; flipX: boolean; flipY: boolean }> = {
  2: { swap: false, flipX: true, flipY: false },  // mirror horizontal
  3: { swap: false, flipX: true, flipY: true },   // rotate 180
  4: { swap: false, flipX: false, flipY: true },  // mirror vertical
  5: { swap: true, flipX: false, flipY: false },  // transpose
  6: { swap: true, flipX: true, flipY: false },   // rotate 90 clockwise
  7: { swap: true, flipX: true, flipY: true },    // transverse
  8: { swap: true, flipX: false, flipY: true },   // rotate 270 clockwise
};

/**
 * Rotate/flip a BGRA bitmap to match an EXIF orientation.
 *
 * Done on the SMALL image on purpose. At 320 pixels wide this is a loop over roughly 68,000 pixels;
 * on the 24-megapixel original it would be 350 times that, for an identical result.
 */
function applyOrientation(bitmap: Buffer, w: number, h: number, orientation: number): { buf: Buffer; w: number; h: number } {
  const t = ORIENT[orientation];
  if (!t) return { buf: bitmap, w, h }; // 1, absent, or a value no camera writes
  const dw = t.swap ? h : w;
  const dh = t.swap ? w : h;
  const out = Buffer.allocUnsafe(dw * dh * 4);
  for (let dy = 0; dy < dh; dy += 1) {
    for (let dx = 0; dx < dw; dx += 1) {
      // Map the destination pixel back to its source, so every destination pixel is written
      // exactly once and no gaps are possible.
      let sx = t.swap ? dy : dx;
      let sy = t.swap ? dx : dy;
      if (t.flipX) sx = w - 1 - sx;
      if (t.flipY) sy = h - 1 - sy;
      bitmap.copy(out, (dy * dw + dx) * 4, (sy * w + sx) * 4, (sy * w + sx) * 4 + 4);
    }
  }
  return { buf: out, w: dw, h: dh };
}

/** The Orientation tag, or 1. Never throws: an unreadable tag means "assume upright", which is what
 *  the old full-size path effectively did anyway. */
async function orientationOf(filePath: string): Promise<number> {
  try {
    const r = (await exifr.parse(filePath, { pick: ["Orientation"], translateValues: false })) as
      | { Orientation?: unknown }
      | undefined;
    const v = Number(r?.Orientation);
    return Number.isInteger(v) && v >= 1 && v <= 8 ? v : 1;
  } catch {
    return 1;
  }
}

/**
 * A tile-sized JPEG data URL for one still, or null if this image cannot be decoded here.
 *
 * `source` is the already-obtained bytes for a RAW (the resolver's embedded preview) — this
 * function never opens a RAW itself, and never touches the resolver's extraction logic. For a
 * browser-native still, `source` is null and the path is read directly.
 *
 * NULL IS NOT A FAILURE — it means "fall back to today's behaviour". A working slow tile beats a
 * broken fast one, so the caller ships the full-size image rather than a glyph.
 */
export async function makeStillThumb(filePath: string, source: Buffer | null): Promise<string | null> {
  try {
    const img = source === null ? nativeImage.createFromPath(filePath) : nativeImage.createFromBuffer(source);
    if (img.isEmpty()) return null; // nativeImage refuses this format — measured: a .CR2 FILE is empty

    const size = img.getSize();
    if (size.width <= 0 || size.height <= 0) return null;

    // Already small enough is still worth encoding — it normalises the format and puts the tile in
    // the cache — but never UPSCALE, which would cost bytes for no pixels.
    const small = size.width > THUMB_WIDTH ? img.resize({ width: THUMB_WIDTH, quality: "good" }) : img;

    const orientation = await orientationOf(filePath);
    let out = small;
    if (orientation !== 1) {
      const s = small.getSize();
      const r = applyOrientation(small.toBitmap(), s.width, s.height, orientation);
      const rotated = nativeImage.createFromBitmap(r.buf, { width: r.w, height: r.h });
      if (!rotated.isEmpty()) out = rotated;
    }

    const jpeg = out.toJPEG(THUMB_QUALITY);
    if (jpeg.length === 0 || jpeg.length > MAX_THUMB_BYTES) return null;
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch {
    // A decode refusal, an unplugged drive, a permission change — all "fall back", never an error.
    return null;
  }
}
