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

// --- directories skipped at ANY depth (build / dependency artifacts, not a photo archive) ---
// Skipped BY RULE: the folder is never descended, so nothing inside is counted, rowed, or parsed —
// and it is NEVER an error row. Lives HERE, beside the media set, so the two "what to ignore" knobs
// (which extensions are media, which folders to skip) sit in one file.
// FUTURE SETTINGS HOOK: a Scan-settings surface would persist the user's added/removed dir names to
// app_settings and merge them over this default set at run start — the SAME hook the media extension
// set would use to become user-editable. (Verified against the audit: node_modules alone held 31,568
// of 31,604 .mts, all TypeScript.)
export const EXCLUDED_DIR_NAMES = new Set([
  "node_modules", ".git", "dist", "build", "release", "release-new", "win-unpacked",
  ".next", ".cache", "vendor",
]);
export const isExcludedDir = (name: string): boolean => EXCLUDED_DIR_NAMES.has(name.toLowerCase());

// --- content-sniff: extensions ambiguous by NAME, classified by CONTENT ---
// `.mts` is BOTH an AVCHD MPEG transport stream AND TypeScript's module extension (.mts / .d.mts).
// Only a real transport stream is video; a TypeScript .mts is non-media (counted, no row, no parser,
// no error). The dir exclusions above remove nearly all of them; this catches the stray config/test
// .mts that live outside node_modules (vitest.config.mts, *.spec.mts, …).
export const CONTENT_SNIFF_EXTS = new Set(["mts"]);
export const needsContentSniff = (ext: string): boolean => CONTENT_SNIFF_EXTS.has(ext.toLowerCase());

/** True iff the first bytes are a real MPEG transport stream. Accepts BOTH packet strides so a
    genuine camcorder file is never skipped: 188-byte TS (sync 0x47 at 0/188/376) AND 192-byte
    BDAV/M2TS as written by AVCHD camcorders (4-byte timecode prefix → sync at 4/196/388). Read the
    first 512 bytes so offset 388 is covered. TypeScript text fails both. */
export function isMpegTransportStream(head: Uint8Array): boolean {
  if (head.length > 376 && head[0] === 0x47 && head[188] === 0x47 && head[376] === 0x47) return true;
  if (head.length > 388 && head[4] === 0x47 && head[196] === 0x47 && head[388] === 0x47) return true;
  return false;
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
