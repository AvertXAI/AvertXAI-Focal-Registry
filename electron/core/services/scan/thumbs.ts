/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// THE THUMBNAIL CACHE — Windows Explorer's thumbcache, at this product's scale.
//
// WHAT THIS REPLACES. Holding a live <video> per tile costs a decoded frame at the SOURCE
// resolution — roughly three megabytes for 1080p and twelve for 4K — plus a decoder, which is why
// the grid needed a forty-tile ceiling and why scrolling away lost pictures. Explorer does not do
// that: it decodes one frame ONCE, writes a small image to disk, and throws the decoder away. A
// cached thumbnail here is a few tens of kilobytes. Two hundred of them is single-digit megabytes,
// not a gigabyte, and they survive a restart.
//
// CONTENT-ADDRESSED FILES, NOT DATABASE BLOBS — the same shape Explorer uses, and for the same
// reason: a cache is not data. Losing the whole folder costs one re-decode per tile and nothing
// else, so it never needs a migration, a transaction, or a backup, and it must never be able to
// take the organisation database down with it.
//
// §4.1 NOTE. This writes an image derived from a video frame, which the blanket "no thumbnails"
// line in CLAUDE.md would forbid. Jason overruled that line for this view on 08-17-2026 ("claude
// banned them not me") and ruled the disk cache in on 08-17-2026. What the rule actually protects —
// no artefact left beside a photographer's footage — is intact and is enforced below: every byte
// lands under the app-owned local tree. Nothing is ever written to the scanned drive or into a
// media folder.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { localTreeRoot } from "./notes";

/** Total bytes the cache may occupy before the sweep starts deleting. At the observed size of a
 *  320-pixel JPEG this is tens of thousands of thumbnails — far past any real archive folder — so
 *  in practice the sweep never fires. The ceiling exists so an unattended machine that scans
 *  terabytes for a year cannot quietly fill a disk. */
const CACHE_CEILING_BYTES = 500 * 1024 * 1024;

/** The sweep walks the whole cache directory, so it must never sit on a per-tile path. It is
 *  triggered two ways, both off that path: once shortly after startup, and once whenever this much
 *  has been written since the last sweep — a counter comparison on the write path, with the walk
 *  itself deferred onto a timer. */
const SWEEP_AFTER_WRITTEN_BYTES = 50 * 1024 * 1024;

/** How stale an entry's stamp must be before a read bothers to refresh it. Without this, one folder
 *  open of two hundred hits would be two hundred metadata writes to record something the sweep only
 *  ever compares at day scale. */
const TOUCH_COALESCE_MS = 6 * 60 * 60 * 1000;

/** No single thumbnail may be larger than this. A 320-pixel JPEG is tens of kilobytes; anything near
 *  a megabyte is a bug upstream, and without a bound a buggy renderer could hand the main thread a
 *  several-hundred-megabyte string to decode and write synchronously. Every other payload in this
 *  subsystem is bounded (MAX_IMAGE_BYTES, OPEN_ENDED_MAX); this one was not. */
const MAX_THUMB_BYTES = 1024 * 1024;

/** JPEG start-of-image marker. A cache entry that does not begin with it was truncated by a crash or
 *  a full disk, and must be treated as a miss rather than served as a broken picture. */
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

/** Hidden, and under the LOCAL tree — never `app.getPath("documents")`, which follows this machine's
 *  OneDrive redirect and would cloud-sync a cache. Mirrors `localTreeRoot()` in notes.ts. */
export function thumbsRoot(): string {
  return path.join(localTreeRoot(), ".thumbs");
}

/**
 * THE CACHE KEY: absolute path + size + modified time, hashed.
 *
 * SHA-1 is fine here and the choice is deliberate: this is a cache key, not a security boundary. A
 * collision costs one wrong thumbnail, and nothing downstream trusts the digest for anything else.
 *
 * Size and modified time are in the key so a file that is edited or replaced in place produces a
 * DIFFERENT key and re-thumbnails by itself. There is no invalidation code to get wrong, because
 * there is no invalidation.
 *
 * THE CONSEQUENCE, stated rather than engineered around this pass: the absolute path is in the key,
 * so RENAMING A FOLDER changes every key underneath it and those thumbnails regenerate on the next
 * visit. The old entries are not orphaned forever — the sweep reclaims them — but a rename does
 * cost one re-decode per file. Accepted. A path-independent key would have to be content-addressed
 * off the file's own bytes, which means reading the file to decide whether to read the file.
 */
/**
 * CACHE GENERATION — bump this whenever a change makes ALREADY-STORED thumbnails wrong.
 *
 * The key is (path, size, mtime), which is exactly right for "the file changed" and useless for
 * "our generator changed": a fixed bug leaves every stale, wrong thumbnail sitting in the cache
 * looking like a valid hit. That happened on 08-18-2026 — EXIF orientations 6 and 8 were swapped,
 * so a whole shoot cached upside down and would have kept serving upside down after the fix.
 *
 * Bumping invalidates video frames too. That is deliberate and cheap: they simply regenerate on
 * next view, and the sweep reclaims the orphans. A stale-but-plausible cache entry is far more
 * expensive than a re-decode, because nobody ever suspects it.
 *
 *   1 — original
 *   2 — 08-18-2026, EXIF orientation 6/8 fix
 *   3 — 08-18-2026, stills now generated in the worker window. THREE independent reasons the bytes
 *       differ from generation 2: rotation happens in Chromium's decoder rather than in our own
 *       transform, `resizeQuality: "high"` is a different resampler from `nativeImage.resize`, and
 *       the encoder is Chromium's rather than Electron's `toJPEG`. The two paths would otherwise
 *       write mutually incompatible entries under one key.
 */
const CACHE_GENERATION = 3;

export function keyFor(target: string, size: number, mtimeMs: number): string {
  const id =
    path.resolve(target).toLowerCase() + "|" + String(size) + "|" + String(Math.round(mtimeMs)) +
    "|g" + String(CACHE_GENERATION);
  return createHash("sha1").update(id).digest("hex");
}

/** Sharded on the first two hex characters — 256 directories, so no single directory ever holds tens
 *  of thousands of entries. Explorer's thumbcache shards for the same reason. */
function fileFor(key: string): string {
  return path.join(thumbsRoot(), key.slice(0, 2), key + ".jpg");
}

/** Same shape as `storage/index.ts:53`, and the same rule from DECISIONS-48: attrib.exe is resolved
 *  from SystemRoot, NEVER via PATH, and never a hardcoded Windows directory. */
function hide(dir: string): void {
  if (process.platform !== "win32") return;
  const sysRoot = process.env.SystemRoot;
  if (!sysRoot) return;
  try {
    spawnSync(path.join(sysRoot, "System32", "attrib.exe"), ["+h", dir], { windowsHide: true, timeout: 10_000 });
  } catch {
    /* best-effort — a missing hidden bit never blocks anything */
  }
}

let rootReady = false;
function ensureRoot(): void {
  if (rootReady) return;
  const root = thumbsRoot();
  fs.mkdirSync(root, { recursive: true });
  hide(root);
  rootReady = true;
}

/**
 * ONE CALL PER FOLDER, not one per tile. Opening a folder of four hundred clips is a single IPC
 * round trip; four hundred calls would cost more in message overhead than the reads themselves.
 *
 * A miss is silent and simply returns nothing for that path — the tile then generates it. Every
 * failure mode here (drive unplugged mid-listing, a cache file truncated by a crash, a permission
 * change) is a miss and never an error, because a cache that can fail the thing it is accelerating
 * is worse than no cache.
 */
export function getMany(targets: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const now = Date.now();
  for (const target of targets) {
    try {
      const src = fs.statSync(target);
      const file = fileFor(keyFor(target, src.size, src.mtimeMs));
      const cached = fs.statSync(file);
      const bytes = fs.readFileSync(file);
      // A TRUNCATED ENTRY IS A MISS, NOT A HIT, and it has to be checked rather than assumed: a
      // partial file stats and reads perfectly well, so without this it comes back as a valid hit
      // and the tile shows a broken image FOREVER — a cache hit stops the tile from ever mounting a
      // <video>, so nothing can recapture it, and the key only changes if the source file does.
      if (bytes.length < 3 || bytes[0] !== JPEG_MAGIC[0] || bytes[1] !== JPEG_MAGIC[1] || bytes[2] !== JPEG_MAGIC[2]) {
        try { fs.unlinkSync(file); } catch { /* next sweep takes it */ }
        continue;
      }
      out[target] = "data:image/jpeg;base64," + bytes.toString("base64");
      // Recency for the sweep. Windows disables last-access-time updates by default, so atime is not
      // a usable signal on this platform; the cache file's modified time is stamped here instead,
      // and coalesced so a folder open is not a burst of metadata writes.
      if (now - cached.mtimeMs > TOUCH_COALESCE_MS) {
        try { fs.utimesSync(file, new Date(now), new Date(now)); } catch { /* the stamp is advisory */ }
      }
    } catch {
      /* miss — the tile generates it */
    }
  }
  return out;
}

let writtenSinceSweep = 0;

/** Write one thumbnail. A failure is logged and swallowed: the tile already holds its picture in
 *  memory, so a cache that cannot write is slow next time and broken never. */
export function put(target: string, dataUrl: string): void {
  try {
    const comma = dataUrl.indexOf(",");
    if (comma < 0) return;
    const bytes = Buffer.from(dataUrl.slice(comma + 1), "base64");
    if (bytes.length === 0 || bytes.length > MAX_THUMB_BYTES) return;
    const src = fs.statSync(target);
    const file = fileFor(keyFor(target, src.size, src.mtimeMs));
    ensureRoot();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // WRITE THEN RENAME. A bare writeFileSync is not atomic, so a crash or a full disk mid-write
    // leaves a partial JPEG that reads back as a perfectly good hit and pins a broken tile forever.
    // Rename over the same volume is atomic, so a reader sees the whole file or no file.
    const tmp = file + "." + String(src.size) + ".part";
    fs.writeFileSync(tmp, bytes);
    try { fs.renameSync(tmp, file); } catch (e) { try { fs.unlinkSync(tmp); } catch { /* ignore */ } throw e; }
    writtenSinceSweep += bytes.length;
    if (writtenSinceSweep >= SWEEP_AFTER_WRITTEN_BYTES) {
      writtenSinceSweep = 0;
      scheduleSweep(5_000);
    }
  } catch (e) {
    console.warn("[scan-notes] thumb cache write failed:", e);
  }
}

let sweepQueued = false;

/** Defer a sweep onto a timer. Never called synchronously from a tile's path — the trigger is a
 *  counter comparison; the directory walk happens later and on its own. */
export function scheduleSweep(delayMs: number): void {
  if (sweepQueued) return;
  sweepQueued = true;
  setTimeout(() => {
    sweepQueued = false;
    try { sweep(); } catch (e) { console.warn("[scan-notes] thumb cache sweep failed:", e); }
  }, delayMs);
}

/** Least-recently-stamped first, until the total is back under the ceiling. */
function sweep(): void {
  const root = thumbsRoot();
  if (!fs.existsSync(root)) return;
  const entries: Array<{ file: string; size: number; at: number }> = [];
  let total = 0;
  for (const shard of fs.readdirSync(root)) {
    const dir = path.join(root, shard);
    let names: string[];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const name of names) {
      const file = path.join(dir, name);
      try {
        const st = fs.statSync(file);
        if (!st.isFile()) continue;
        entries.push({ file, size: st.size, at: st.mtimeMs });
        total += st.size;
      } catch { /* vanished between readdir and stat */ }
    }
  }
  if (total <= CACHE_CEILING_BYTES) return;
  entries.sort((a, b) => a.at - b.at);
  let freed = 0;
  for (const e of entries) {
    if (total - freed <= CACHE_CEILING_BYTES) break;
    try { fs.unlinkSync(e.file); freed += e.size; } catch { /* in use; the next sweep takes it */ }
  }
  const mb = (n: number): string => (n / 1024 ** 2).toFixed(1) + " MB";
  console.info(
    "[scan-notes] thumb cache swept — " + mb(freed) + " freed, " +
    mb(total - freed) + " of " + mb(CACHE_CEILING_BYTES) + " in use"
  );
}
