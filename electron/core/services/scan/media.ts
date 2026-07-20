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

// --- the media set (Jason-approved list, 2026-07-19) — one place, reported for approval ---
export const STILL_EXTS = new Set([
  "jpg", "jpeg", "png", "tif", "tiff", "heic", "heif", "webp", "bmp", "gif",
  "cr2", "cr3", "nef", "arw", "dng", "orf", "rw2", "raf", "pef", "srw",
]);
export const VIDEO_EXTS = new Set([
  "mp4", "mov", "m4v", "3gp", "avi", "mts", "m2ts", "mkv", "wmv", "mpg", "mpeg", "webm", "braw", "r3d",
]);
export const AUDIO_EXTS = new Set([
  "wav", "mp3", "m4a", "flac", "aac", "ogg", "wma", "aiff",
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
// exifr reads JPEG/TIFF(+TIFF-based RAW)/HEIC/PNG/WebP headers; it CANNOT read bmp or gif.
const EXIFR_READABLE = new Set([
  "jpg", "jpeg", "tif", "tiff", "heic", "heif", "png", "webp",
  "cr2", "cr3", "nef", "arw", "dng", "orf", "rw2", "raf", "pef", "srw",
]);
// music-metadata parses these containers; it cannot read avi/mts/m2ts/mpg/wmv/braw/r3d — handing
// those to it yields an empty shell, which must NOT become an error row (they are known-unsupported).
const MUSIC_METADATA_READABLE = new Set([
  "mp4", "mov", "m4v", "3gp", "mkv", "webm", // video containers mm understands
  "wav", "mp3", "m4a", "flac", "aac", "ogg", "wma", "aiff", // audio
]);
// isobmff geometry reader — ISO base-media containers only.
const ISO_BMFF_READABLE = new Set(["mp4", "mov", "m4v", "3gp"]);

export const canExifr = (ext: string): boolean => EXIFR_READABLE.has(ext.toLowerCase());
export const canMusicMetadata = (ext: string): boolean => MUSIC_METADATA_READABLE.has(ext.toLowerCase());
export const canIsoBmff = (ext: string): boolean => ISO_BMFF_READABLE.has(ext.toLowerCase());
