// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Brand pack — one downloadable file holding every vendor icon, wordmark and the
//              label→domain map, served to the renderer over the `brand://` scheme.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/brandpack/index.ts
// ------------------------------------------------------------
//
// WHY ONE PACK AND NOT ONE REQUEST PER LOGO. This is the load-bearing decision and it is a privacy
// one, not a performance one. A vault that resolves logos individually — favicon service or the
// sites themselves — tells somebody WHICH COMPANIES THE USER HAS ACCOUNTS WITH, which is precisely
// the metadata a credential store exists to keep. Every install downloads the byte-identical pack,
// so the request says nothing about any vault. Do not add a "just fetch the ones we need" path; it
// would look like an optimisation and would be the one leak this design exists to prevent.
//
// The vault's own no-network rule is intact: nothing here reads vault contents, and the sync runs
// on a timer at boot, not in response to anything a user stores.
//
// STORAGE. The pack stays as ONE file and is read by offset. Extracting ~2,200 small files into
// userData would cost a slow first run, 2,200 inodes, and an antivirus scan on every one of them.
// The index is ~200 KB of JSON held in memory; each request is a map lookup plus one positional
// read. Nothing is ever resolved from a caller-supplied path, so traversal is not possible here —
// a domain either exists in the index or it does not.

import { app, net, protocol } from "electron";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";

const SCHEME = "brand";
/**
 * Static file on our own host. No query string, no per-user parameter, identical for everyone.
 * Same origin and same box the installer feed already uses (scripts/release.mjs scp's to
 * avert-core-01:/data/focal-updates, served from https://updates.focalregistry.com) — one host to
 * keep alive rather than two, and that one is already proven in the release path.
 */
const FEED = "https://updates.focalregistry.com/brandpack.json";

/** [offset, length, extension] into the blob region. */
type Entry = [number, number, string];
interface PackIndex {
  version: number;
  vendors: Record<string, string>;
  icons: Record<string, Entry>;
  logos: Record<string, Entry>;
}

const MIME: Record<string, string> = {
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  webp: "image/webp", gif: "image/gif", ico: "image/x-icon",
};

let INDEX: PackIndex | null = null;
let BLOB_BASE = 0;
let PACK_FILE: string | null = null;

const packDir = (): string => path.join(app.getPath("userData"), "brandpack");

/** Call BEFORE app ready — Electron refuses scheme privileges after that. */
export function registerBrandScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

/**
 * Parse `[4-byte BE index length][index JSON][blobs]`. Returns false rather than throwing: a
 * corrupt or half-written pack must degrade to the colour-and-initials tile, never to a dead app.
 */
function load(file: string): boolean {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, "r");
    const head = Buffer.alloc(4);
    if (fs.readSync(fd, head, 0, 4, 0) !== 4) return false;
    const len = head.readUInt32BE(0);
    if (len <= 0 || len > 64 * 1024 * 1024) return false;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, 4);
    const parsed = JSON.parse(buf.toString("utf8")) as PackIndex;
    if (!parsed || typeof parsed !== "object" || !parsed.icons || !parsed.logos) return false;
    INDEX = parsed;
    BLOB_BASE = 4 + len;
    PACK_FILE = file;
    return true;
  } catch {
    return false;
  } finally {
    if (fd !== null) try { fs.closeSync(fd); } catch { /* nothing useful to do */ }
  }
}

/** Newest pack already on disk, if any. Survives a failed sync and an offline boot. */
export function loadLocalPack(): boolean {
  try {
    const dir = packDir();
    if (!fs.existsSync(dir)) return false;
    const files = fs.readdirSync(dir)
      .filter((f) => /^brandpack-\d+\.bin$/.test(f))
      .sort((a, b) => Number(b.match(/\d+/)![0]) - Number(a.match(/\d+/)![0]));
    for (const f of files) if (load(path.join(dir, f))) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * First run, before any download: expand the pack that shipped inside the installer.
 *
 * WHY BUNDLE IT AT ALL when syncBrandPack can fetch the same file. Without this, a fresh install
 * shows initials on every tile until a 20MB download finishes — the app would look broken for the
 * first minute of the only session where first impressions are formed. Shipping it means artwork is
 * correct offline, immediately, forever; the sync then exists only to carry LATER vendor additions
 * without cutting a new release. Costs ~20MB of installer.
 *
 * No digest check here on purpose: this file came out of our own signed installer, so verifying it
 * against a hash stored beside it in the same installer would prove nothing.
 */
export function seedBundledPack(): boolean {
  try {
    const src = path.join(process.resourcesPath, "brandpack-1.bin.gz");
    if (!fs.existsSync(src)) return false;
    const dir = packDir();
    fs.mkdirSync(dir, { recursive: true });
    const raw = zlib.gunzipSync(fs.readFileSync(src));
    // Same partial-then-rename as the download path: a crash mid-write must not leave a truncated
    // pack for loadLocalPack to find on the next boot.
    const dest = path.join(dir, "brandpack-1.bin");
    const tmp = `${dest}.partial`;
    fs.writeFileSync(tmp, raw);
    fs.renameSync(tmp, dest);
    return load(dest);
  } catch {
    return false;
  }
}

function readEntry(entry: Entry): Buffer | null {
  if (!PACK_FILE) return null;
  let fd: number | null = null;
  try {
    fd = fs.openSync(PACK_FILE, "r");
    const buf = Buffer.alloc(entry[1]);
    const got = fs.readSync(fd, buf, 0, entry[1], BLOB_BASE + entry[0]);
    return got === entry[1] ? buf : null;
  } catch {
    return null;
  } finally {
    if (fd !== null) try { fs.closeSync(fd); } catch { /* nothing useful to do */ }
  }
}

/**
 * `brand://icon/<domain>` and `brand://logo/<domain>`.
 * A miss is a plain 404 — BrandMark's onError turns that back into the initials tile, so a pack
 * that has not downloaded yet simply looks like the app did before it existed.
 */
export function installBrandProtocol(): void {
  protocol.handle(SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      const kind = url.hostname;                                   // "icon" | "logo"
      const domain = decodeURIComponent(url.pathname.replace(/^\//, "")).toLowerCase();
      if (!INDEX || (kind !== "icon" && kind !== "logo")) return new Response("Not found", { status: 404 });

      const entry = (kind === "icon" ? INDEX.icons : INDEX.logos)[domain];
      if (!entry) return new Response("Not found", { status: 404 });
      const bytes = readEntry(entry);
      if (!bytes) return new Response("Not found", { status: 404 });

      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: {
          "Content-Type": MIME[entry[2]] ?? "application/octet-stream",
          // The pack is immutable for a given version; the URL changes when the version does.
          "Cache-Control": "public, max-age=31536000, immutable",
          "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

/** The label→domain map, handed to the renderer once so tiles resolve without an IPC per tile. */
export function vendorMap(): { version: number; vendors: Record<string, string> } | null {
  return INDEX ? { version: INDEX.version, vendors: INDEX.vendors } : null;
}

async function getJSON(url: string): Promise<any> {
  const res = await net.fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(await res.text());
}

/**
 * Check the feed, download when the server is ahead, verify, swap in.
 * Every failure path is a silent no-op on purpose — this is cosmetic artwork. It must never block
 * boot, never surface a dialog, and never leave a partial file where loadLocalPack can find it.
 */
export async function syncBrandPack(): Promise<{ updated: boolean; version: number | null; reason?: string }> {
  const have = INDEX?.version ?? 0;
  try {
    const feed = await getJSON(FEED);
    const version = Number(feed?.version);
    const file = String(feed?.file ?? "");
    const sha256 = String(feed?.sha256 ?? "");
    if (!Number.isFinite(version) || !/^brandpack-\d+\.bin\.gz$/.test(file) || !/^[a-f0-9]{64}$/.test(sha256)) {
      return { updated: false, version: have || null, reason: "feed malformed" };
    }
    if (version <= have) return { updated: false, version: have, reason: "already current" };

    const res = await net.fetch(new URL(file, FEED).toString());
    if (!res.ok) return { updated: false, version: have || null, reason: `HTTP ${res.status}` };
    const gz = Buffer.from(await res.arrayBuffer());

    // VERIFY BEFORE DECOMPRESSING. A gzip bomb is cheap to send and expensive to open, and the
    // digest is the only thing standing between this and whatever answered the request.
    const actual = crypto.createHash("sha256").update(gz).digest("hex");
    if (actual !== sha256) return { updated: false, version: have || null, reason: "sha256 mismatch" };

    const raw = zlib.gunzipSync(gz);
    const dir = packDir();
    fs.mkdirSync(dir, { recursive: true });
    // Write to a temp name and rename, so a crash mid-write cannot leave a truncated pack that
    // loadLocalPack would happily pick up on the next boot.
    const dest = path.join(dir, `brandpack-${version}.bin`);
    const tmp = `${dest}.partial`;
    fs.writeFileSync(tmp, raw);
    fs.renameSync(tmp, dest);

    const previous = PACK_FILE;
    if (!load(dest)) return { updated: false, version: have || null, reason: "unreadable after write" };
    if (previous && previous !== dest) try { fs.unlinkSync(previous); } catch { /* stale copy, harmless */ }
    return { updated: true, version };
  } catch (e) {
    return { updated: false, version: have || null, reason: (e as Error).message };
  }
}
