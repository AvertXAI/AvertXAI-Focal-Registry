// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: THE single source of truth for what counts as media and how each media file is
//              routed to a metadata engine. Non-media files are counted and skipped — never given a
//              scan_files row, never handed to a parser, never an error row (Phase 3). Routing is
//              decided by CLASS before any parser is called: stills → exifr, video → isobmff +
//              music-metadata, audio → music-metadata. A parser is only called for a format it can
//              actually read, so a format we KNOW a parser cannot handle never produces an error row.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/scan/media.ts
//------------------------------------------------------------

export type MediaClass = "image" | "video" | "audio";

// --- the media set (Jason-approved, 2026-07-19; extended 2026-07-20) — one place, one source ---
// THM (Canon thumbnail sidecars) is deliberately EXCLUDED — it would inflate stills counts.
export const STILL_EXTS = new Set([
  "jpg", "jpeg", "png", "tif", "tiff", "heic", "heif", "webp", "bmp", "gif", "avif", "jxl",
  "cr2", "cr3", "crw", "nef", "nrw", "arw", "srf", "sr2", "dng", "orf", "rw2", "raf", "pef", "srw",
  "3fr", "rwl", "psd", "psb", // psd/psb get a row but NO parser call (same as bmp/gif)
]);
export const VIDEO_EXTS = new Set([
  "mp4", "mov", "m4v", "3gp", "avi", "mts", "m2ts", "m2t", "mkv", "wmv", "mpg", "mpeg", "mpe",
  "webm", "braw", "r3d", "mxf", "insv",
]);
export const AUDIO_EXTS = new Set([
  "wav", "mp3", "m4a", "m4b", "flac", "aac", "ogg", "opus", "wma", "aiff", "caf",
]);

/** Media class of an extension, or null when the file is NOT media (counted + skipped). */
export function mediaClass(ext: string): MediaClass | null {
  const e = ext.toLowerCase();
  if (STILL_EXTS.has(e)) return "image";
  if (VIDEO_EXTS.has(e)) return "video";
  if (AUDIO_EXTS.has(e)) return "audio";
  return null;
}

// --- routing capability: only call a parser for a format it can actually read ---
// exifr reads JPEG/TIFF(+TIFF-based RAW)/HEIC/AVIF/PNG/WebP headers; it CANNOT read bmp, gif, psd,
// psb, or jxl — those get a row with the file-date baseline and NO parser call, NO error row.
const EXIFR_READABLE = new Set([
  "jpg", "jpeg", "tif", "tiff", "heic", "heif", "avif", "png", "webp",
  "cr2", "cr3", "crw", "nef", "nrw", "arw", "srf", "sr2", "dng", "orf", "rw2", "raf", "pef", "srw", "3fr", "rwl",
]);
// music-metadata parses these containers; it cannot read avi/mts/m2t/mpg/mpe/wmv/braw/r3d/mxf/insv —
// handing those to it yields an empty shell, which must NOT become an error row (known-unsupported).
const MUSIC_METADATA_READABLE = new Set([
  "mp4", "mov", "m4v", "3gp", "mkv", "webm", // video containers mm understands
  "wav", "mp3", "m4a", "m4b", "flac", "aac", "ogg", "opus", "wma", "aiff", "caf", // audio
]);
// isobmff geometry reader — ISO base-media containers only.
const ISO_BMFF_READABLE = new Set(["mp4", "mov", "m4v", "3gp"]);

export const canExifr = (ext: string): boolean => EXIFR_READABLE.has(ext.toLowerCase());
export const canMusicMetadata = (ext: string): boolean => MUSIC_METADATA_READABLE.has(ext.toLowerCase());
export const canIsoBmff = (ext: string): boolean => ISO_BMFF_READABLE.has(ext.toLowerCase());
