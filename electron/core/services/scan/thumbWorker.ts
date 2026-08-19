// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Main-side owner of the hidden thumbnail worker window — lifecycle, queue,
//              concurrency, timeouts and crash recovery. Does the dispatching; does no decoding.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/scan/thumbWorker.ts
//------------------------------------------------------------
//
// WHY A WINDOW AND NOT A utilityProcess. Measured 08-18-2026: `nativeImage` does not exist inside a
// `utilityProcess` — the child sees only `net` and `systemPreferences` — and a utility process has
// no DOM, so no `createImageBitmap` either. A renderer has both. Option A is dead on measurement,
// not on preference.
//
// WHAT THIS BUYS, MEASURED, NOT ARGUED. At one file in flight the worker is slightly SLOWER than the
// main-process path (149 ms against 141 ms) — the scaled decode does not win on its own. The gain is
// PARALLELISM: `createImageBitmap` and `convertToBlob` hand off to Chromium's internal pool, so at
// four in flight it is 80.9 ms/file, about 1.75x — and none of it runs on the thread that owns every
// window.
//
// THROTTLING IS ACCEPTED, NOT FOUGHT. A hidden window is throttled while the app is minimised —
// timers 213/s to 69/s, work ~168 to ~229 ms — and `backgroundThrottling: false` makes NO measurable
// difference on this Electron version. Ruled 08-18-2026: accept it. There is deliberately NO
// fallback that switches back to the main process while minimised; a warm-up that quietly moves onto
// the thread owning the interface to save a third of its time is exactly the trade this work exists
// to stop making.
//
// THIS FILE NEVER TOUCHES THE OVERLAY. `applyOverlayNow()` in `electron/core/windows.ts` remains the
// single writer of `setTitleBarOverlay` and `setBackgroundColor` (CLAUDE.md §3.3). A window that is
// never shown has no frame to paint, and nothing below calls either.
import { BrowserWindow, app, ipcMain } from "electron";
import path from "node:path";

/** Matches stillThumb.ts. One geometry and one quality across both paths, so a cache entry means the
 *  same thing whichever path wrote it. */
const THUMB_WIDTH = 320;
const THUMB_QUALITY = 0.7;

/**
 * FOUR IN FLIGHT, from the measured curve rather than a guess:
 *
 *     1 -> 149.0 ms/file    2 -> 120.5    3 -> 95.3    4 -> 80.9    6 -> 68.2
 *
 * The knee is between 1 and 3 (a 36% gain); 3 to 4 still buys 15%; 4 to 6 buys 16% for half again as
 * much simultaneous disk and CPU competition with the foreground. Four sits past the knee with
 * headroom left, which is what "polite to the drive" means here.
 */
const CONCURRENCY = 4;

/** A job that has not answered by now is treated as lost and the caller falls back. This is not a
 *  performance bound — it is 250x the measured per-file cost — it exists so a wedged renderer can
 *  never leave a tile waiting forever with no picture and no error. */
const JOB_TIMEOUT_MS = 20_000;

/** Above this the bytes do not go to the worker at all. Structured-clone across the IPC boundary
 *  copies the buffer, so a pathological source would cost that much twice; the main-process path
 *  handles these instead. A 24-megapixel JPEG is ~8 MB, so nothing real lands here. */
const MAX_WORKER_SOURCE_BYTES = 64 * 1024 * 1024;

/** How long the window gets to load its preload and say hello before every caller gives up on it. */
const STARTUP_TIMEOUT_MS = 10_000;

interface Pending {
  resolve: (v: Buffer | null) => void;
  timer: NodeJS.Timeout;
}

let win: BrowserWindow | null = null;
let ready: Promise<boolean> | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
const queue: Array<() => void> = [];
let inFlight = 0;
let listenersBound = false;

/** Answer a job once and only once — from the worker, from a timeout, or from a crash sweep. */
function settle(id: number, value: Buffer | null): void {
  const job = pending.get(id);
  if (!job) return; // already settled by whichever of the three got there first
  pending.delete(id);
  clearTimeout(job.timer);
  inFlight -= 1;
  job.resolve(value);
  const next = queue.shift();
  if (next) next();
}

/** Every outstanding job answers null, so every waiting caller falls back to the main-process path
 *  rather than hanging. Called on crash, on unresponsive, and on teardown. */
function failAll(): void {
  for (const id of [...pending.keys()]) settle(id, null);
  queue.length = 0;
  inFlight = 0;
}

function bindListeners(): void {
  if (listenersBound) return;
  listenersBound = true;
  // BOUND ON FIRST USE, NOT AT MODULE SCOPE. Nothing is registered until there is a worker to tear
  // down, which also keeps this module inert for an install that never opens Scan Notes.
  app.on("before-quit", teardown);
  ipcMain.on("thumb:done", (e, id: number, bytes: ArrayBuffer | null) => {
    // Ignore anything from a window that is no longer the worker — a reply arriving from a renderer
    // we already gave up on must not settle a job that has since been reissued.
    if (!win || win.isDestroyed() || e.sender !== win.webContents) return;
    settle(id, bytes ? Buffer.from(new Uint8Array(bytes)) : null);
  });
}

/** Drop the worker and answer everything it was holding. Safe to call twice. */
function teardown(): void {
  const w = win;
  win = null;
  ready = null;
  failAll();
  if (w && !w.isDestroyed()) w.destroy();
}

/**
 * The worker window, created on FIRST USE and not at boot — an install that never opens Scan Notes
 * never pays for it.
 */
function ensureWorker(): Promise<boolean> {
  if (ready) return ready;
  bindListeners();

  ready = new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    try {
      const w = new BrowserWindow({
        show: false,
        width: 1,
        height: 1,
        webPreferences: {
          preload: path.join(__dirname, "thumb-preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          // The preload needs Node to reach `ipcRenderer`, and the page it loads is a blank `data:`
          // URL with no script, no network access and no navigation — there is no untrusted content
          // in this window for a sandbox to contain.
          sandbox: false,
        },
      });
      win = w;

      // A crash answers every outstanding job with null (they fall back), then clears the handle so
      // the NEXT call builds a fresh worker. Recovery is lazy on purpose: rebuilding immediately
      // after a crash risks a loop, and rebuilding on demand costs one window creation.
      w.webContents.on("render-process-gone", (_e, details) => {
        console.warn("[scan-notes] thumb worker gone:", details.reason);
        done(false);
        teardown();
      });
      w.webContents.on("unresponsive", () => {
        console.warn("[scan-notes] thumb worker unresponsive — recycling");
        done(false);
        teardown();
      });
      w.on("closed", () => {
        if (win === w) teardown();
      });

      ipcMain.once("thumb:ready", () => {
        done(true);
        reportIdleMemory(w);
      });

      // A worker that never reports ready must not leave every caller awaiting a promise that will
      // not settle. This is the one failure mode that would look like a hang rather than a fallback.
      w.webContents.on("did-fail-load", (_e, code, desc) => {
        console.warn(`[scan-notes] thumb worker failed to load: ${desc} (${code})`);
        done(false);
        teardown();
      });
      setTimeout(() => {
        if (settled) return;
        console.warn("[scan-notes] thumb worker did not report ready — falling back");
        done(false);
        teardown();
      }, STARTUP_TIMEOUT_MS);

      // A blank page. All of the work lives in the preload, so there is no HTML asset to ship, no
      // vite entry to keep in step, and nothing on disk that could be swapped for something else.
      void w.loadURL("data:text/html,<!doctype html><title>t</title>");
    } catch (e) {
      console.warn("[scan-notes] thumb worker could not start:", e);
      done(false);
      teardown();
    }
  });

  return ready;
}

/** One line, once per worker: the idle cost of keeping it alive. Kept in the shipped code because it
 *  is the only honest way to answer "what does this cost when nothing is happening". */
function reportIdleMemory(w: BrowserWindow): void {
  setTimeout(() => {
    try {
      if (w.isDestroyed()) return;
      const pid = w.webContents.getOSProcessId();
      const m = app.getAppMetrics().find((x) => x.pid === pid);
      const kb = m?.memory?.workingSetSize ?? 0;
      console.info(`[scan-notes] thumb worker idle — pid ${pid}, working set ${(kb / 1024).toFixed(1)} MB`);
    } catch {
      /* a metric we could not read is not worth an error */
    }
  }, 3_000);
}

/**
 * Downscale one still's bytes in the worker. Resolves to JPEG bytes, or **null meaning "fall back"**
 * — a dead worker, a crash, a timeout, an over-size source or a decode the worker refused all come
 * back the same way, because the caller's response to all of them is identical.
 *
 * The bytes cross as a transferable `ArrayBuffer`. Never base64, never a string: base64 is a third
 * bigger and costs an encode on the main thread and a decode in the worker, which is precisely the
 * main-thread work this exists to remove.
 */
export async function workerThumb(bytes: Buffer, cancelled?: () => boolean): Promise<Buffer | null> {
  if (bytes.length === 0 || bytes.length > MAX_WORKER_SOURCE_BYTES) return null;
  if (cancelled?.()) return null;
  if (!(await ensureWorker())) return null;
  const w = win;
  if (!w || w.isDestroyed()) return null;

  const id = nextId;
  nextId += 1;

  return new Promise<Buffer | null>((resolve) => {
    const start = (): void => {
      if (!win || win.isDestroyed()) {
        resolve(null);
        return;
      }
      // CHECKED AGAIN HERE, AND THIS IS THE CHECK THAT MATTERS. A job waiting behind three others
      // has had time for the folder to change; dispatching it anyway is exactly the wasted decode
      // this exists to stop. The entry check above only catches work cancelled before it queued.
      if (cancelled?.()) {
        resolve(null);
        const next = queue.shift();
        if (next) next();
        return;
      }
      inFlight += 1;
      pending.set(id, { resolve, timer: setTimeout(() => settle(id, null), JOB_TIMEOUT_MS) });
      // Copy out of the Buffer's slab: Node pools small allocations, so `bytes.buffer` can be an
      // 8 KB arena holding unrelated data. `slice` here is the exact bytes and nothing else.
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      win.webContents.send("thumb:job", id, ab, THUMB_WIDTH, THUMB_QUALITY);
    };

    if (inFlight < CONCURRENCY) start();
    else queue.push(start);
  });
}
