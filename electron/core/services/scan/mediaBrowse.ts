// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Scan Notes media browsing — LOOKING at the archive, never touching it. Every path in
//              this file is opened read-only; nothing here writes, moves, renames or deletes a
//              user's file, and no thumbnail, proxy or preview is ever SAVED (§4.1 is strict about
//              this — what is decoded lives in memory for the length of a session and nowhere else).
//
//              TWO TRANSPORTS, AND THE SPLIT IS THE WHOLE DESIGN:
//                • STILLS go over IPC as a data URL. The page's Content Security Policy already
//                  permits `img-src 'self' data:`, so a photograph costs NO policy change. A 20 MB
//                  ceiling and a 40-entry cache keep a folder of 60-megapixel files from becoming a
//                  heap problem — base64 is 4/3 the size of the bytes it carries.
//                • VIDEO AND AUDIO go over the frmedia: scheme. A three-gigabyte tape capture cannot
//                  be a data URL at any ceiling, and a <video> element needs byte-range requests to
//                  seek at all. This is the ONE thing that required a policy directive, and it is
//                  exactly one: `media-src frmedia:` (ruled 08-17-2026).
//
//              THE SCHEME IS NOT A FILE SERVER. Its handler refuses anything that is not (a) an
//              existing file, (b) of a class this product plays, and (c) underneath a root this org
//              actually scanned — the same isUnderScannedRoot guard the scan:openPath channel uses.
//              Without (c) a renderer bug becomes "read any file on the machine".
//
//              RAW HAS NO SECOND DECODER. A Canon CR2 is not a picture a browser can draw, so what
//              is shown is the JPEG the camera already embedded — located by its recorded tag offset
//              and read straight off disk, without decoding a single raw pixel. That is metadata
//              extraction, which this product does, rather than image decoding, which it does not.
//              The offset is the whole point: it is MEGABYTES into the file, which is why a
//              header-only reader cannot fetch it and why rawPreview.ts exists.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/scan/mediaBrowse.ts
//------------------------------------------------------------
import { protocol } from "electron";
import exifr from "exifr";
import fs from "node:fs";
import path from "node:path";
import type { Db } from "./notesDb";
import { AUDIO_EXTS, RAW_EXTS, STILL_EXTS, VIDEO_EXTS, extOf, normalizeExt } from "./media";
import { isUnderScannedRoot } from "./index";
import { previewFor } from "./rawPreview";
import { makeStillThumb } from "./stillThumb";
import { workerThumb } from "./thumbWorker";
import * as jobs from "./jobs";
import * as thumbs from "./thumbs";

export const MEDIA_SCHEME = "frmedia";

/** Stills a browser can draw itself. Everything else in STILL_EXTS needs the embedded preview. */
const BROWSER_IMAGE = new Set(["jpg", "jpeg", "png", "webp", "bmp", "gif", "avif"].map(normalizeExt));
/** Containers Chromium plays natively. mkv/avi/wmv/mts/braw/r3d/mxf are listed in VIDEO_EXTS
 *  because a SCAN must count them; they are absent here because a PLAYER cannot open them, and
 *  offering a play button that produces a black rectangle is worse than saying so. */
const BROWSER_VIDEO = new Set(["mp4", "m4v", "mov", "webm"].map(normalizeExt));
const BROWSER_AUDIO = new Set(["mp3", "m4a", "wav", "flac", "ogg", "opus", "aac"].map(normalizeExt));

/** Base64 is 4/3 of the bytes it carries, so this is really a ~27 MB string per entry. */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** What a cancelled job answers with. NOT an error: the tile that asked for it has already been
 *  unmounted or superseded, so nothing is waiting to display this and nothing should log it. */
const CANCELLED: ImageResult = { ok: false, cancelled: true };

/** Guardrail on a WALL tile. A 320-pixel JPEG is tens of kilobytes; anything near this did not
 *  downscale, and shipping it would undo the whole point of the tile path. Matches stillThumb.ts. */
const MAX_WALL_THUMB_BYTES = 512 * 1024;
const CACHE_MAX = 40;

// Was a private copy of the same one-liner. It is now media.ts's extOf, so there is exactly one
// definition of "what is this file's extension" in the product and no second place to drift.
const ext = extOf;

/**
 * CASE TRACE — the same hard gate as electron/diag.ts, off unless `DIAG=1` (npm run dev:diag).
 *
 * It is here because the uppercase-extension defect could NOT be reproduced by reading: every
 * comparison in this chain already normalises, so either the refusal happens somewhere this
 * inventory did not reach, or the cause was never the extension at all. Rather than guess, both
 * gates a file must pass now say out loud what they extracted and which branch turned it away. A
 * passing run prints one listing line per folder and nothing else; a failing one names the branch.
 */
const CASE_TRACE = process.env.DIAG === "1";

export type MediaKind = "image" | "video" | "audio" | "other";
export interface MediaItem {
  path: string;
  filename: string;
  extension: string | null;
  kind: MediaKind;
  size_bytes: number | null;
  /** false when this product cannot show it — the tile says so instead of failing on click. */
  viewable: boolean;
  /** true when the still is RAW/TIFF and what you see is the camera's embedded preview. */
  embedded: boolean;
  /** true for a CAMERA NEGATIVE specifically — narrower than `embedded`, which also covers HEIC,
   *  TIFF and PSD. The Scan Notes wall hides these by default; see RAW_EXTS in media.ts. */
  raw: boolean;
  /** frmedia: URL for video and audio; null for stills, which come over IPC. */
  streamUrl: string | null;
}

// ============================================================================================
// THE LIST
// ============================================================================================

/** One folder's media, straight out of scan_files — no directory walk, so an unplugged drive still
 *  lists what it holds and each tile says plainly that it cannot be opened right now. */
export function listFolderMedia(db: Db, orgId: string, folderPath: unknown, limit = 500): MediaItem[] {
  const p = typeof folderPath === "string" ? folderPath : "";
  if (p === "") return [];
  const cap = Math.min(Math.max(Number(limit) || 500, 1), 2000);
  const rows = db
    .prepare(
      `SELECT path, filename, extension, kind, size_bytes FROM scan_files
       WHERE org_id = ? AND path LIKE ? AND path NOT LIKE ?
       ORDER BY filename LIMIT ?`
    )
    // Direct children only: "<folder>\%" minus "<folder>\%\%" — a subfolder is its own tile row in
    // the tree, and flattening a whole archive into one grid helps nobody.
    .all(orgId, `${p}\\%`, `${p}\\%\\%`, cap) as Array<{
    path: string;
    filename: string;
    extension: string | null;
    kind: string | null;
    size_bytes: number | null;
  }>;

  const items = rows.map((r) => {
    // The stored column is normalised on write now, but rows written before that change still carry
    // the filesystem's casing — and an empty string is not nullish, so it must not win the ??.
    const stored = (r.extension ?? "").trim();
    const e = stored !== "" ? normalizeExt(stored) : ext(r.path);
    const kind: MediaKind =
      STILL_EXTS.has(e) ? "image" : VIDEO_EXTS.has(e) ? "video" : AUDIO_EXTS.has(e) ? "audio" : "other";
    // THE STORED EXTENSION DISAGREEING WITH THE FILE'S OWN NAME is the only mechanism I can find
    // that explains the device report of an .mp3 being handed to a <video> element: `kind` is
    // derived from `e`, and `e` prefers the database column over the path. A row written with the
    // wrong extension is therefore inherited by every downstream decision — the kind, the glyph, the
    // queue, the player. This names it rather than leaving it to be rediscovered.
    if (CASE_TRACE && e !== extOf(r.path)) {
      console.warn(
        `[scan-notes] listing: stored extension "${e}" disagrees with the path ".${extOf(r.path)}" ` +
          `— kind=${kind} ${r.filename}`
      );
    }
    const playable = kind === "video" ? BROWSER_VIDEO.has(e) : kind === "audio" ? BROWSER_AUDIO.has(e) : false;
    return {
      path: r.path,
      filename: r.filename,
      extension: e || null,
      kind,
      size_bytes: r.size_bytes,
      viewable: kind === "image" ? true : playable,
      embedded: kind === "image" && !BROWSER_IMAGE.has(e),
      raw: kind === "image" && RAW_EXTS.has(e),
      streamUrl: playable ? streamUrl(r.path) : null,
    };
  });
  traceListing(p, rows, items);
  return items;
}

/** One line per folder listing when DIAG=1 — the gate BEFORE guardPath. If a tile never paints and
 *  guardPath printed nothing, the file was refused here instead, and this says why: it reports how
 *  many rows came back, how many were handed a stream URL, and every distinct extension that was
 *  NOT, with the casing the database is holding. */
function traceListing(folderPath: string, rows: Array<{ path: string; extension: string | null }>, out: MediaItem[]): void {
  if (!CASE_TRACE) return;
  const refused = new Map<string, number>();
  out.forEach((item, n) => {
    if (item.streamUrl !== null || item.kind === "image") return;
    const stored = rows[n]?.extension ?? "(null)";
    const label = `${item.kind}:${item.extension ?? "?"} stored="${stored}"`;
    refused.set(label, (refused.get(label) ?? 0) + 1);
  });
  const summary = refused.size === 0
    ? "none refused"
    : [...refused].map(([k, n]) => `${k} x${n}`).join(", ");
  console.info(`[scan-notes] listing ${path.basename(folderPath)}: ${out.length} rows, ${out.filter((i) => i.streamUrl !== null).length} streamable — ${summary}`);
}

/** `frmedia://media/?p=<encoded absolute path>`. The path is a QUERY value, never a URL path
 *  segment: a Windows path carries backslashes and a colon, and a path segment would mangle both. */
/** Is this an audio file? Straight off the scanner's own AUDIO_EXTS — no second list, no second
 *  notion of what counts as audio. Used to keep audio out of the thumbnail failure log, where it has
 *  no business: a file with no video track cannot fail to yield a frame. */
export function isAudioPath(p: string): boolean {
  return AUDIO_EXTS.has(ext(p));
}

export function streamUrl(absolutePath: string): string {
  return `${MEDIA_SCHEME}://media/?p=${encodeURIComponent(absolutePath)}`;
}

// ============================================================================================
// STILLS — over IPC, cached, bounded
// ============================================================================================

/** Insertion-ordered Map as the LRU: a hit is delete-then-set (moving it to the end), and eviction
 *  takes the first key. ponytail: 40 entries and no byte accounting — a real byte budget is the
 *  upgrade if a folder of 20 MB TIFFs ever proves this too loose. */
const cache = new Map<string, string>();
function cacheGet(key: string): string | undefined {
  const hit = cache.get(key);
  if (hit === undefined) return undefined;
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}
function cachePut(key: string, value: string): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}
/** A rename or a re-scan can point the same path at different bytes; the browse session is short,
 *  but leaving a stale picture on screen is the kind of thing nobody ever debugs. */
export function clearMediaCache(): void {
  cache.clear();
}

export interface ImageResult {
  ok: boolean;
  dataUrl?: string;
  /** true when what came back is the camera's embedded preview rather than the file itself. */
  embedded?: boolean;
  error?: string;
  /** ABANDONED, NOT FAILED. The folder moved on while this was in flight. The tile that asked has
   *  already gone, so the renderer must not show an error for it — there is nothing wrong. */
  cancelled?: boolean;
}

const MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  bmp: "image/bmp", gif: "image/gif", avif: "image/avif",
};

/**
 * One still, as a data URL. Guarded the same way the scheme is — an image read is still a file read.
 * Never throws: every failure is a plain sentence the tile can show.
 */
export async function readImage(db: Db, orgId: string, target: unknown): Promise<ImageResult> {
  const p = typeof target === "string" ? target : "";
  if (p === "") return { ok: false, error: "No file was named." };
  const hit = cacheGet(p);
  if (hit) return { ok: true, dataUrl: hit, embedded: !BROWSER_IMAGE.has(ext(p)) };

  const guard = guardPath(db, orgId, p, "image");
  if (guard) return { ok: false, error: guard };

  const e = ext(p);
  try {
    if (BROWSER_IMAGE.has(e)) {
      const size = fs.statSync(p).size;
      if (size > MAX_IMAGE_BYTES) {
        return {
          ok: false,
          error: `That file is ${(size / 1024 ** 2).toFixed(0)} MB — too large to preview in the app. Open it in your usual viewer.`,
        };
      }
      const url = `data:${MIME[e] ?? "image/jpeg"};base64,${fs.readFileSync(p).toString("base64")}`;
      cachePut(p, url);
      return { ok: true, dataUrl: url, embedded: false };
    }
    // RAW, TIFF, HEIC, PSD — the camera's own embedded JPEG. No raw decode happens here and none
    // ever will (§4.1).
    //
    // THE POSITIONED READ COMES FIRST because exifr cannot do this one. It parses from a header
    // window, and a RAW's preview is recorded in a tag pointing MEGABYTES into the file — so on
    // every .CR2 measured it read the tags correctly and then THREW reaching for the bytes
    // ("Invalid typed array length: 15962", which is that file's own ThumbnailLength). See
    // rawPreview.ts for the measurements and for the lossless-JPEG trap that makes a bare
    // FF-D8-FF check the wrong test.
    const preview = await previewFor(p);
    if (preview) {
      const url = `data:image/jpeg;base64,${preview.bytes.toString("base64")}`;
      cachePut(p, url);
      if (CASE_TRACE) {
        console.info(
          `[scan-notes] embedded preview ${path.basename(p)}: ${preview.bytes.length} bytes @ ${preview.offset} via ${preview.via}`
        );
      }
      return { ok: true, dataUrl: url, embedded: true };
    }
    // CR3 is handled above by the ISO BMFF strategy. What still reaches here is HEIC and PSD —
    // neither a TIFF nor an ftyp-led container this walker claims. ITS THROW IS CAUGHT HERE, not by the outer catch: an exception from
    // a library is not a sentence to show a photographer, and printing one is how the caption came
    // to read "That f…".
    const thumb = await exifr.thumbnail(p).catch(() => null);
    if (!thumb) {
      return { ok: false, error: `${path.basename(p)} has no embedded preview, and this product does not decode RAW.` };
    }
    const url = `data:image/jpeg;base64,${Buffer.from(thumb).toString("base64")}`;
    cachePut(p, url);
    return { ok: true, dataUrl: url, embedded: true };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return {
      ok: false,
      error:
        code === "ENOENT"
          ? "That file is not there any more — the drive may be unplugged."
          : code === "EACCES" || code === "EPERM"
            ? "Windows would not let the app read that file."
            : `That file could not be read: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * ONE STILL, TILE-SIZED — the wall's path. `readImage` above stays the VIEWER's path and is
 * unchanged, because the viewer needs the full image and zoom needs it at full resolution.
 *
 *   MediaGrid tile  -> readStillThumb  -> ~320px, ~11 KB, cached to .thumbs
 *   MediaViewer     -> readImage       -> full size, in-memory LRU, never downscaled
 *
 * Conflating the two is how a photo zoomed to 400% turns into a blurry 320-pixel smear, so they
 * are deliberately two functions with two ceilings.
 *
 * SAME STORE, SAME KEY, SAME SWEEP as the video thumbnails — `thumbs.getMany` / `thumbs.put`,
 * content-keyed on (path, size, mtime). No second cache exists.
 */
export async function readStillThumb(db: Db, orgId: string, target: unknown, token?: unknown): Promise<ImageResult> {
  const p = typeof target === "string" ? target : "";
  if (p === "") return { ok: false, error: "No file was named." };

  // THE EARLIEST SAFE POINT. A job for a folder the user has already left does no file read, no
  // decode and no encode — it returns before touching the disk at all.
  if (jobs.stale(token)) return CANCELLED;
  jobs.markStarted();

  const guard = guardPath(db, orgId, p, "image");
  if (guard) return { ok: false, error: guard };

  const e = ext(p);
  const embedded = !BROWSER_IMAGE.has(e);

  // The disk cache first — a warm tile costs one read and no decode at all.
  try {
    const hit = thumbs.getMany([p])[p];
    if (hit) return { ok: true, dataUrl: hit, embedded };
  } catch {
    // A cache that cannot be read is a miss. It may never be an error: a cache that can fail the
    // thing it accelerates is worse than no cache.
  }

  try {
    let source: Buffer | null = null;
    if (embedded) {
      // RAW and friends: the resolver hands over the camera's own JPEG. Its extraction logic is
      // untouched — this only decides what happens to the bytes afterwards.
      const preview = await previewFor(p);
      if (!preview) return await readImage(db, orgId, p); // HEIC/PSD etc — old path, exifr fallback
      source = preview.bytes;
    }
    // THE WORKER IS THE PRIMARY PATH. It decodes straight to tile size in a hidden window, so the
    // thread that owns every window does no image work at all, and four files overlap. Crucially it
    // applies EXIF rotation INSIDE Chromium's decoder — there is no transform table on this path to
    // get backwards, which is the class of bug that shipped a folder upside down this morning.
    let url: string | null = null;
    const bytes = source ?? (await fs.promises.readFile(p).catch(() => null));
    if (bytes) {
      const out = await workerThumb(bytes, () => jobs.stale(token));
      // Only a real JPEG counts. The cache serves its bytes back verbatim, so anything else here
      // would pin a broken tile until the source file itself changed.
      if (out && out.length > 3 && out[0] === 0xff && out[1] === 0xd8 && out[2] === 0xff && out.length <= MAX_WALL_THUMB_BYTES) {
        url = `data:image/jpeg;base64,${out.toString("base64")}`;
      }
    }

    // NULL MEANS FALL BACK, NEVER FAIL — twice over. A dead or crashed worker drops to the
    // main-process path per file; a format that path refuses drops to the full-size image. Slower
    // and larger, but present. A working slow tile beats a broken fast one.
    // BEFORE THE FALLBACK, NOT AFTER. `workerThumb` answers null both for "failed" and for
    // "cancelled", and falling back on a cancelled job would run the whole expensive main-process
    // path for a folder nobody is looking at — the exact work this phase exists to abandon.
    if (jobs.stale(token)) { jobs.markDone(true); return CANCELLED; }
    if (url === null) url = await makeStillThumb(p, source);
    if (url === null) { jobs.markDone(true); return await readImage(db, orgId, p); }

    try {
      thumbs.put(p, url);
    } catch {
      // Fire and forget: the tile already has its picture, so a cache that cannot write is slow
      // next launch and broken never.
    }
    if (CASE_TRACE) console.info(`[scan-notes] still thumb ${path.basename(p)}: ${Math.round(url.length / 1024)} KB`);
    // BANKED, THEN DROPPED. The thumbnail above is already written to the cache and is correct — it
    // is simply not wanted on screen any more, so the base64 payload is not sent back across the
    // boundary. Next time this folder opens it is a cache hit rather than a regeneration.
    if (jobs.stale(token)) { jobs.markDone(true); return CANCELLED; }
    jobs.markDone(false);
    return { ok: true, dataUrl: url, embedded };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return {
      ok: false,
      error:
        code === "ENOENT"
          ? "That file is not there any more — the drive may be unplugged."
          : code === "EACCES" || code === "EPERM"
            ? "Windows would not let the app read that file."
            : "That file could not be read.",
    };
  }
}

// ============================================================================================
// THE frmedia: SCHEME
// ============================================================================================

/**
 * MUST RUN BEFORE app.whenReady() — Chromium builds its scheme registry once, at startup, and a
 * privileged registration after that point is silently ignored.
 *
 * `stream: true` is what makes a <video> element seekable: without it Chromium will not issue byte-
 * range requests and a long capture can only be played from the beginning. `secure` + `standard`
 * keep the scheme out of the "potentially trustworthy" exceptions list. bypassCSP is deliberately
 * NOT set — the policy names this scheme explicitly, and a scheme that ignores the policy would make
 * that directive a lie.
 *
 * `corsEnabled` is what lets the thumbnail pipeline read PIXELS back. A <video crossOrigin="anonymous">
 * switches its fetch into CORS mode; on a scheme Chromium does not run CORS for, that request is
 * refused outright rather than merely tainted, so the attribute and the response header below are
 * both useless without this privilege. It grants nothing on its own — the response still has to say
 * yes, and guardPath still runs on every single request.
 */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } },
  ]);
}

/** The three checks, in one place, so the scheme and the image reader cannot drift apart. Returns a
 *  plain sentence when the path is refused, or null when it is allowed. */
function guardPath(db: Db, orgId: string, p: string, want: "image" | "playable"): string | null {
  // THE ONE THAT MATTERS, AND IT GOES FIRST. Without it a renderer bug becomes "read any file on
  // this machine" — and the ORDER is load-bearing too, not just the check. It used to sit last,
  // after fs.statSync, which meant every path a caller named was touched by the main process before
  // it was refused. On Windows that is not free: statSync on a UNC path (\\host\share\x.mp4) opens
  // an outbound SMB connection and hands the machine's credentials to whatever answers, and an
  // unresolvable host blocks on DNS and TCP for seconds. This check is a database lookup on path
  // prefixes and touches no filesystem, so refusing here costs nothing and reaches nothing.
  const e = ext(p);
  // The receipt names the branch, not just the refusal, so a device run distinguishes "the
  // extension was read wrong" from "the file is outside a scanned root" from "the drive is gone".
  const trace = (branch: string): string => {
    if (CASE_TRACE) {
      console.info(
        `[scan-notes] guard REFUSED (${branch}) want=${want} ext="${e}" raw="${path.extname(p)}" ${path.basename(p)}`
      );
    }
    return branch;
  };

  if (!isUnderScannedRoot(db, orgId, p)) {
    trace("outside-scanned-root");
    return "That file is outside any scanned drive.";
  }
  const ok =
    want === "image"
      ? STILL_EXTS.has(e)
      : (VIDEO_EXTS.has(e) && BROWSER_VIDEO.has(e)) || (AUDIO_EXTS.has(e) && BROWSER_AUDIO.has(e));
  if (!ok) {
    trace("extension-not-openable");
    return `${path.basename(p)} is not something this product can open.`;
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(p);
  } catch {
    trace("stat-failed");
    return "That file is not there any more — the drive may be unplugged.";
  }
  if (!stat.isFile()) {
    trace("not-a-file");
    return "That is not a file.";
  }
  return null;
}

/** The scanned-root check ALONE, for callers that do their own stat and never read the target's
 *  bytes — the thumbnail cache reads only its own JPEG. Skipping the guard's stat here is what stops
 *  a four-hundred-path folder open from stat-ing the external drive twice for every tile. */
export function isUnderScannedDrive(db: Db, orgId: string, target: string): boolean {
  return isUnderScannedRoot(db, orgId, target);
}

/** THE SAME THREE CHECKS the scheme runs, exposed for callers that touch a media path without going
 *  through the scheme — the thumbnail cache is the first. Shared deliberately: a second copy of this
 *  rule is a second place for it to drift, and the rule that matters (isUnderScannedRoot) is the one
 *  standing between a renderer bug and every file on the machine. */
export function isPlayablePath(db: Db, orgId: string, target: string): boolean {
  return guardPath(db, orgId, target, "playable") === null;
}

/** Content types for the formats this product plays. .mov is served as video/mp4 deliberately: it is
 *  the same ISO base media container, and Chromium is markedly happier with that label than with
 *  video/quicktime. */
const AV_MIME_SOURCE: Record<string, string> = {
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/mp4", webm: "video/webm",
  mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", flac: "audio/flac",
  ogg: "audio/ogg", opus: "audio/ogg", aac: "audio/aac",
};
/** Keys normalised at definition, for the same reason the extension sets are. */
const AV_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(AV_MIME_SOURCE).map(([k, v]) => [normalizeExt(k), v])
);

/**
 * HOW BIG A BITE THE STREAM TAKES OFF THE DRIVE AT A TIME. This is NOT a cap on what a request may
 * receive — there is no such cap any more — it is the size of one read in a loop that runs until the
 * requested span is exhausted.
 *
 * IT IS DELIBERATELY NOT THE OLD `OPEN_ENDED_MAX` RENAMED. That constant meant "the most bytes a
 * client may have", this one means "the most bytes resident at once", and they are opposite kinds of
 * number. Reusing the name would have carried three passes of comment history about a ceiling onto a
 * value that is no longer a ceiling, and that confusion is exactly what produced the 64 → 4 → 64
 * oscillation. New meaning, new name.
 *
 * FOUR MEGABYTES. Peak resident bytes on this path is now roughly one chunk per in-flight request
 * instead of one whole file: six concurrent tiles cost about 24 MB rather than the 546 MB that six
 * ninety-one-megabyte buffers would have cost. The value is large enough that a 91 MB clip is 23
 * reads rather than 91, and small enough that six of them are noise.
 */
const CHUNK_BYTES = 4 * 1024 * 1024;

/**
 * WHY THERE IS NO SIZE CAP ANY MORE — kept because this decision was reversed three times and the
 * evidence that settled it should not have to be rediscovered a fourth.
 *
 * Jason ruled 08-18-2026: no size cap on an open-ended range. A user must never be asked to buy a
 * codec or split a file to see a thumbnail of footage that plays fine in Explorer.
 *
 * THE DEVICE EVIDENCE WAS TOTAL. Of 85 iPhone .MP4 files in one folder, 78 painted and 6 failed
 * (one was a cache hit). Every file that logged (WHOLE FILE) painted; every file that logged
 * (PARTIAL) failed; no exceptions in either direction. The six failures were exactly the six files
 * larger than the then-current 64 MB bound, and their second request was `bytes=0-` AGAIN rather
 * than a tail read — given a truncated answer to an open-ended range the player retries from zero,
 * so it can never reach a trailing moov atom and never decodes. Healthy files showed the opposite
 * shape: whole file, then a small tail read, then a seek from byte 65536.
 *
 * IT IS NOT A CODEC PROBLEM. Same camera, same folder, same container — 78 of them decoded. The
 * only variable was size.
 *
 * THE MEMORY COST THE CAP EXISTED TO PREVENT IS NOW PAID BY THE STREAM, not by the client. See
 * CHUNK_BYTES above.
 */

/**
 * How much an OPEN-ENDED range (`bytes=0-`) returns in one response. Jason ruled the cap up on
 * 08-17-2026 ("if its a buffer problem, make it unlimited") after a small chunk was suspected of
 * stalling playback, and 64 MB is effectively that for this product: a photographer's clip arrives
 * whole, in one response, and only a multi-gigabyte capture is ever split.
 *
 * IT IS NOT LITERALLY UNLIMITED, and the reason is one line: this body is read into memory in the
 * main process, so `bytes=0-` on a four-gigabyte tape capture would allocate four gigabytes inside
 * the process that owns every window.
 *
 * SIXTY-FOUR MEGABYTES, and it went 64 → 4 → 64 for reasons worth writing down so it does not
 * oscillate a third time.
 *
 * IT WAS LOWERED to stop sixty-four megabytes of SYNCHRONOUS read holding the main thread. That
 * cost was real. The bound was the wrong lever for it.
 *
 * IT IS RAISED BACK because four megabytes breaks camera originals, measured on device 08-18-2026:
 * eighty-five .MP4 files, every one classified, guarded and served with no refusal anywhere, and
 * every one failing to produce a frame — while the same files painted under the sixty-four megabyte
 * version. A camera writes its `moov` atom — the index a demuxer needs before it can decode
 * anything — at the END of the file. At sixty-four megabytes a 29 MB clip arrived whole in one
 * response and the index came with it. At four it did not. Web-sourced clips kept working because
 * they are routinely written `faststart`, index at the front, inside the first four megabytes;
 * that split is exactly what the failure predicted.
 *
 * THE COST IS PAID SOMEWHERE ELSE NOW. The read below is asynchronous, so a large slice costs
 * throughput on the threadpool rather than responsiveness on the thread that owns every window.
 *
 * This bounds the OPEN-ENDED form alone — `bytes=0-`, what a player sends before it has read the
 * header and knows what to ask for. Every explicit `bytes=a-b` is served exactly as requested.
 *
 * ---- SUPERSEDED 08-18-2026. The bound is gone entirely; see the two blocks above. The history is
 * kept because a future reader will be tempted to reintroduce a cap the moment they see a 91 MB
 * response, and the six files that proves wrong are named in the note above. ----
 */

/**
 * WHO MAY READ THE PIXELS. The renderer draws a seeked video frame to a canvas to make a thumbnail,
 * and without an Access-Control-Allow-Origin the canvas is TAINTED the instant that frame lands —
 * toDataURL then throws SecurityError, which is exactly how the first thumbnail attempt failed
 * silently. This header grants pixel-reading to our own renderer. It grants NOBODY file access:
 * guardPath (and isUnderScannedRoot inside it) runs on every request, unchanged.
 *
 * WHICH VALUE SHIPS, AND WHY. Jason's ruling is "the app's own origin if it is determinable, `*`
 * only if it is not". It is not. This renderer is loaded with `win.loadFile` (electron/main.ts:196)
 * in every configuration — `npm run dev` is a real build followed by `electron .`, with no Vite dev
 * server anywhere — so the page origin is a `file://` opaque origin, which serialises as the literal
 * string "null" and matches no scoped value. So `*` is what ships today. The echo below is not
 * decoration: the moment this app is loaded from a real origin (a dev server, or an app:// scheme)
 * it tightens to exactly that origin with no further edit.
 *
 * WHAT `*` ACTUALLY EXPOSES HERE: nothing outside this application. `frmedia:` exists only inside
 * this Electron process — it is registered at startup and no browser, page, or remote host can
 * address the scheme at all. The set of third-party origins this widens to is empty.
 */
function allowOrigin(request: Request): string {
  const o = request.headers.get("Origin");
  return o !== null && o !== "" && o !== "null" ? o : "*";
}

/** One line the first time a file is served, so "it hangs" can be diagnosed from the console
 *  instead of guessed at. Once per path per session — a media element makes dozens of requests. */
const announced = new Set<string>();

/**
 * HOW MANY TIMES EACH FILE HAS BEEN ASKED FOR, this session. DIAG-gated.
 *
 * The one-line-per-file announcement above prints only the FIRST range, which is exactly the
 * information that cannot answer the question in front of us: when every tile fails, the thing that
 * separates "the player gave up after one slice" from "the player came back for the tail and still
 * failed" is whether there was a SECOND request. One is a bounded-response fault; the other is not,
 * and they need opposite fixes.
 */
const requestCount = new Map<string, number>();

/**
 * Installed once, after app ready.
 *
 * RANGE IS HANDLED HERE, BY HAND, AND IT HAS TO BE. The first cut of this handed the request to
 * `net.fetch(pathToFileURL(p))`, on the reasoning that Electron would carry byte ranges for free.
 * It does not: that response arrives with no `Accept-Ranges` and no `Content-Length`, so Chromium
 * cannot seek, cannot judge how much it has, and falls back to stalling and re-requesting — which
 * on device looked exactly like a video playing three seconds, pausing, playing five, pausing
 * (Jason, 08-17-2026). A media element needs three things from a server and this now sends all
 * three: `Accept-Ranges: bytes`, an accurate `Content-Length`, and a real 206 with `Content-Range`.
 */
export function installMediaProtocol(resolve: () => { db: Db; orgId: string } | null): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    // HOISTED ABOVE THE try ON PURPOSE: the catch below returns a response too, and it cannot reach
    // a binding scoped inside the block it is catching for.
    const cors = allowOrigin(request);
    /** EVERY response carries the CORS header, not just the successful ones. This is not tidiness.
     *  In CORS mode Chromium converts a response without an Access-Control-Allow-Origin into a
     *  GENERIC NETWORK ERROR — the renderer never sees the 403, never sees the sentence explaining
     *  that the drive is unplugged, and gets an indistinguishable `error` event on the media
     *  element. The thumbnail pipeline reads that as a cross-origin refusal and switches the disk
     *  cache off for the whole session. One unplugged file was enough to do it. */
    const head = (extra?: Record<string, string>): Record<string, string> => ({
      "Access-Control-Allow-Origin": cors,
      "Cross-Origin-Resource-Policy": "cross-origin",
      ...(extra ?? {}),
    });
    try {
      // `Range` is a CORS-safelisted request header, so a media fetch should never preflight. Answered
      // anyway: if Chromium ever does send one, an unhandled OPTIONS is a thumbnail that fails with
      // nothing in the log, and the answer costs four lines.
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: head({ "Access-Control-Allow-Headers": "Range", "Access-Control-Max-Age": "86400" }),
        });
      }

      const p = new URL(request.url).searchParams.get("p");
      if (!p) return new Response("Bad request", { status: 400, headers: head() });
      const ctx = resolve();
      if (!ctx) return new Response("No active organization", { status: 403, headers: head() });
      const refused = guardPath(ctx.db, ctx.orgId, p, "playable");
      if (refused) return new Response(refused, { status: 403, headers: head() });

      const size = (await fs.promises.stat(p)).size;
      const type = AV_MIME[ext(p)] ?? "application/octet-stream";
      const range = request.headers.get("Range") ?? request.headers.get("range");
      const nth = (requestCount.get(p) ?? 0) + 1;
      requestCount.set(p, nth);

      if (!announced.has(p)) {
        announced.add(p);
        console.info(`[scan-notes] frmedia serving ${path.basename(p)} (${type}, ${size} bytes), first Range = ${range ?? "none"}`);
      }

      // NO RANGE MEANS THE WHOLE FILE, and that is not a preference — a 200 response carries the
      // entire entity by definition. An earlier cut here answered a plain GET with 200 plus only the
      // first chunk and a Content-Length to match, which told Chromium a sixty-megabyte clip was two
      // megabytes long: it decoded the fragment, waited for the rest of what it had been promised,
      // and sat there looking like it was about to play. If a Range IS present it is honoured, and
      // only the open-ended form is bounded.
      const [start, end] = ((): [number, number] => {
        const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
        if (!m) return [0, size - 1];
        const a = m[1] === "" ? NaN : Number(m[1]);
        const b = m[2] === "" ? NaN : Number(m[2]);
        // `bytes=-500` means the LAST 500 bytes — how a player finds an MP4 whose moov atom sits at
        // the end of the file. Getting this branch wrong makes exactly those clips unplayable.
        if (Number.isNaN(a)) return [Math.max(0, size - (Number.isNaN(b) ? 0 : b)), size - 1];
        // OPEN-ENDED — THE WHOLE REMAINDER, no ceiling. The index a demuxer needs may sit anywhere
        // in the file, and on a camera original it sits at the END, so any ceiling at all is a
        // coin-flip on whether the clip decodes. It costs nothing to be complete now: the body is
        // streamed in CHUNK_BYTES bites, so a 91 MB answer holds 4 MB of memory, not 91.
        if (Number.isNaN(b)) return [a, size - 1];
        return [a, Math.min(b, size - 1)];
      })();

      if (start >= size || start > end) {
        if (CASE_TRACE) {
          console.info(`[scan-notes] frmedia #${nth} ${path.basename(p)} Range="${range ?? "none"}" -> 416 (size ${size})`);
        }
        return new Response("Range not satisfiable", { status: 416, headers: head({ "Content-Range": `bytes */${size}` }) });
      }

      // STREAM THE SPAN RATHER THAN BUFFERING IT, and this is the whole of pass 7.
      //
      // The earlier version read the entire span into one ArrayBuffer before responding. That was
      // correct and it was safe, and it forced a ceiling: without one, `bytes=0-` on a
      // four-gigabyte capture would have allocated four gigabytes inside the process that owns every
      // window. With a ceiling, every file above it was handed a prefix and never decoded. There was
      // no value of the ceiling that was right — the trade itself was wrong.
      //
      // A stream retires the trade. Peak memory becomes one chunk per in-flight request instead of
      // one file, so the span can be unbounded and the client always receives everything it asked
      // for.
      //
      // THE THREE THINGS A STREAMED BODY HAS TO GET RIGHT, all of which have bitten this handler:
      //
      // 1. THE DECLARED LENGTH. Content-Length and Content-Range describe the FULL span, computed
      //    from start/end — the stream is how the bytes travel, not what they are. An earlier cut
      //    answered a plain GET with 200 plus only the first chunk AND a Content-Length to match,
      //    telling Chromium a sixty-megabyte clip was two megabytes long; it decoded the fragment,
      //    waited for the rest of what it had been promised, and sat there looking like it was about
      //    to play. `end` is clamped against a stat taken microseconds ago, so the span is what is
      //    on disk unless the file is truncated mid-request — in which case the short read below
      //    closes the stream early and Chromium reports a length mismatch, which is the honest
      //    answer and strictly better than silently under-delivering.
      //
      // 2. THE HANDLE'S LIFETIME. It is opened before the Response exists and closed by exactly one
      //    function, `shut()`, which is idempotent — so completion, error and cancellation all
      //    converge on one close and a double close is a no-op.
      //
      // 3. ABANDONMENT, which a seeking media element does constantly, and a thumbnail tile does
      //    every time it settles. `cancel()` is wired to `shut()` and the pull loop stops with it. A
      //    stream that keeps grinding through a 91 MB file nobody is watching would be worse than
      //    the buffer ever was.
      //
      // BACKPRESSURE IS WHY THIS IS PULL-BASED. `pull` is called only when the consumer has room,
      // so a slow reader throttles the drive instead of filling memory with queued chunks. A push
      // loop would read the whole file at full speed into the stream's internal queue and give back
      // precisely the allocation this exists to avoid.
      const span = end - start + 1;
      const handle = await fs.promises.open(p, "r");
      let closed = false;
      const shut = async (): Promise<void> => {
        if (closed) return;
        closed = true;
        try {
          await handle.close();
        } catch {
          /* already gone — a close that fails must never surface as a failed media request */
        }
      };
      let cursor = start;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (cursor > end) {
            await shut();
            controller.close();
            return;
          }
          const want = Math.min(CHUNK_BYTES, end - cursor + 1);
          const buf = new Uint8Array(want);
          try {
            const { bytesRead } = await handle.read(buf, 0, want, cursor);
            if (bytesRead === 0) {
              // EOF earlier than the stat promised. Close cleanly rather than looping forever.
              await shut();
              controller.close();
              return;
            }
            cursor += bytesRead;
            controller.enqueue(bytesRead < want ? buf.subarray(0, bytesRead) : buf);
          } catch (e) {
            await shut();
            controller.error(e);
          }
        },
        async cancel() {
          // The tile settled, the modal closed, or the player seeked away. Stop reading.
          await shut();
        },
      });

      if (CASE_TRACE) {
        const whole = start === 0 && end >= size - 1;
        console.info(
          `[scan-notes] frmedia #${nth} ${path.basename(p)} Range="${range ?? "none"}" -> ${range ? 206 : 200} ` +
            `bytes ${start}-${end}/${size}${whole ? " (WHOLE FILE)" : " (PARTIAL)"} ` +
            `streamed in ${Math.ceil(span / CHUNK_BYTES)} chunk(s)`
        );
      }
      return new Response(body, {
        status: range ? 206 : 200,
        headers: head({
          "Content-Type": type,
          "Content-Length": String(span),
          "Accept-Ranges": "bytes",
          // Without the expose list a CORS response hides every non-safelisted header from the
          // renderer, which is how a ranged read looks like it succeeded and then has no length.
          "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
          ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
        }),
      });
    } catch (e) {
      console.error("[scan-notes] frmedia request failed:", e);
      return new Response("Unavailable", { status: 500, headers: head() });
    }
  });
}
