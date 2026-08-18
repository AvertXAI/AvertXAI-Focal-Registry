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
//              is shown is the JPEG the camera already embedded — exifr reads it from the header
//              without decoding a single raw pixel. That is metadata extraction, which this product
//              does, rather than image decoding, which it does not.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/scan/mediaBrowse.ts
//------------------------------------------------------------
import { protocol } from "electron";
import exifr from "exifr";
import fs from "node:fs";
import path from "node:path";
import type { Db } from "./notesDb";
import { AUDIO_EXTS, STILL_EXTS, VIDEO_EXTS } from "./media";
import { isUnderScannedRoot } from "./index";

export const MEDIA_SCHEME = "frmedia";

/** Stills a browser can draw itself. Everything else in STILL_EXTS needs the embedded preview. */
const BROWSER_IMAGE = new Set(["jpg", "jpeg", "png", "webp", "bmp", "gif", "avif"]);
/** Containers Chromium plays natively. mkv/avi/wmv/mts/braw/r3d/mxf are listed in VIDEO_EXTS
 *  because a SCAN must count them; they are absent here because a PLAYER cannot open them, and
 *  offering a play button that produces a black rectangle is worse than saying so. */
const BROWSER_VIDEO = new Set(["mp4", "m4v", "mov", "webm"]);
const BROWSER_AUDIO = new Set(["mp3", "m4a", "wav", "flac", "ogg", "opus", "aac"]);

/** Base64 is 4/3 of the bytes it carries, so this is really a ~27 MB string per entry. */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const CACHE_MAX = 40;

const ext = (p: string): string => path.extname(p).slice(1).toLowerCase();

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

  return rows.map((r) => {
    const e = (r.extension ?? ext(r.path)).toLowerCase();
    const kind: MediaKind =
      STILL_EXTS.has(e) ? "image" : VIDEO_EXTS.has(e) ? "video" : AUDIO_EXTS.has(e) ? "audio" : "other";
    const playable = kind === "video" ? BROWSER_VIDEO.has(e) : kind === "audio" ? BROWSER_AUDIO.has(e) : false;
    return {
      path: r.path,
      filename: r.filename,
      extension: e || null,
      kind,
      size_bytes: r.size_bytes,
      viewable: kind === "image" ? true : playable,
      embedded: kind === "image" && !BROWSER_IMAGE.has(e),
      streamUrl: playable ? streamUrl(r.path) : null,
    };
  });
}

/** `frmedia://media/?p=<encoded absolute path>`. The path is a QUERY value, never a URL path
 *  segment: a Windows path carries backslashes and a colon, and a path segment would mangle both. */
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
    // RAW, TIFF, HEIC, PSD — the camera's own embedded JPEG, read from the header. No raw decode
    // happens here and none ever will (§4.1).
    const thumb = await exifr.thumbnail(p);
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
  let stat: fs.Stats;
  try {
    stat = fs.statSync(p);
  } catch {
    return "That file is not there any more — the drive may be unplugged.";
  }
  if (!stat.isFile()) return "That is not a file.";
  const e = ext(p);
  const ok =
    want === "image"
      ? STILL_EXTS.has(e)
      : (VIDEO_EXTS.has(e) && BROWSER_VIDEO.has(e)) || (AUDIO_EXTS.has(e) && BROWSER_AUDIO.has(e));
  if (!ok) return `${path.basename(p)} is not something this product can open.`;
  // THE ONE THAT MATTERS: without it, a renderer bug becomes "read any file on this machine".
  if (!isUnderScannedRoot(db, orgId, p)) return "That file is outside any scanned drive.";
  return null;
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
const AV_MIME: Record<string, string> = {
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/mp4", webm: "video/webm",
  mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", flac: "audio/flac",
  ogg: "audio/ogg", opus: "audio/ogg", aac: "audio/aac",
};

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
 * FOUR MEGABYTES, down from sixty-four (Jason ruled 08-17-2026). This bound applies to the
 * OPEN-ENDED form alone — `bytes=0-`, which is what a player sends before it has read the header
 * and knows what to ask for. Every explicit `bytes=a-b` is still served exactly as requested, and
 * Chromium switches to explicit ranges immediately after headers, so playback and seeking are
 * untouched. Sixty-four megabytes of synchronous read on the main thread to satisfy an opening
 * probe was the cost that made a wall of thumbnails feel stuck; four is seconds of buffered video
 * and the player asks for the next slice long before it runs out.
 */
const OPEN_ENDED_MAX = 4 * 1024 * 1024;

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
  protocol.handle(MEDIA_SCHEME, (request) => {
    try {
      const cors = allowOrigin(request);
      // `Range` is a CORS-safelisted request header, so a media fetch should never preflight. Answered
      // anyway: if Chromium ever does send one, an unhandled OPTIONS is a thumbnail that fails with
      // nothing in the log, and the answer costs four lines.
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: { "Access-Control-Allow-Origin": cors, "Access-Control-Allow-Headers": "Range", "Access-Control-Max-Age": "86400" },
        });
      }

      const p = new URL(request.url).searchParams.get("p");
      if (!p) return new Response("Bad request", { status: 400 });
      const ctx = resolve();
      if (!ctx) return new Response("No active organization", { status: 403 });
      const refused = guardPath(ctx.db, ctx.orgId, p, "playable");
      if (refused) return new Response(refused, { status: 403 });

      const size = fs.statSync(p).size;
      const type = AV_MIME[ext(p)] ?? "application/octet-stream";
      const range = request.headers.get("Range") ?? request.headers.get("range");

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
        if (Number.isNaN(b)) return [a, Math.min(size - 1, a + OPEN_ENDED_MAX - 1)]; // open-ended → one bounded slice
        return [a, Math.min(b, size - 1)];
      })();

      if (start >= size || start > end) {
        return new Response("Range not satisfiable", { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      }

      // READ THE SLICE INTO A BUFFER RATHER THAN STREAMING IT (Jason, on device 08-17-2026 — after
      // the first Range cut, clips stopped playing entirely rather than merely stuttering).
      //
      // A streamed body has to be right about three things at once: the exact byte count in
      // Content-Length, the lifetime of the file handle, and what happens when the player ABANDONS a
      // request mid-flight — which a seeking media element does constantly. Any one of them wrong
      // shows up as a video that loads forever and never starts, with nothing in the log. A bounded
      // buffer has none of those failure modes: the length is what was actually read, the handle is
      // closed before the response exists, and an abandoned request drops a Buffer rather than
      // leaking a descriptor. Two megabytes off an SSD is single-digit milliseconds, and the player
      // simply asks for the next slice.
      // The body is handed over as a bare ArrayBuffer. Buffer and Uint8Array are both ArrayBufferView
      // and both are REJECTED by this project's BodyInit typing (their ArrayBufferLike generic does
      // not line up); an ArrayBuffer is unambiguous and needs no cast.
      const fd = fs.openSync(p, "r");
      let body: ArrayBuffer;
      try {
        const store = new ArrayBuffer(end - start + 1);
        const view = new Uint8Array(store);
        const read = fs.readSync(fd, view, 0, view.length, start);
        body = read < view.length ? store.slice(0, read) : store; // short read at EOF — never over-claim
      } finally {
        fs.closeSync(fd);
      }

      return new Response(body, {
        status: range ? 206 : 200,
        headers: {
          "Content-Type": type,
          "Content-Length": String(body.byteLength),
          "Accept-Ranges": "bytes",
          "Access-Control-Allow-Origin": cors,
          // Without the expose list a CORS response hides every non-safelisted header from the
          // renderer, which is how a ranged read looks like it succeeded and then has no length.
          "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
          ...(range ? { "Content-Range": `bytes ${start}-${start + body.byteLength - 1}/${size}` } : {}),
        },
      });
    } catch (e) {
      console.error("[scan-notes] frmedia request failed:", e);
      return new Response("Unavailable", { status: 500 });
    }
  });
}
