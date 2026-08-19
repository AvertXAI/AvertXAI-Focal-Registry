// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: The thumbnail worker's whole implementation. Runs in a hidden window's isolated
//              world — off the main process, which owns every window.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/thumb-preload.ts
//------------------------------------------------------------
//
// WHY THE WORK LIVES IN A PRELOAD RATHER THAN A PAGE. A preload's isolated world has the DOM
// globals this needs — `createImageBitmap`, `OffscreenCanvas`, `Blob` — and `ipcRenderer`. Putting
// the logic here means the hidden window can load a blank `data:` URL: no HTML asset to ship, no
// vite entry to add, and nothing on disk for a page to be swapped out from under.
//
// NO contextBridge EXPOSURE. Nothing is published to the page's world, because the page has no
// script and no job. This file talks only to the main process.
//
// =============================================================================================
// THE ORIENTATION POINT, WHICH OUTRANKS THE SPEED.
//
// `imageOrientation: "from-image"` applies the EXIF rotation INSIDE CHROMIUM'S DECODER. There is no
// transform table here, and there never will be — the primary path cannot express rotation as a
// hand-written mapping, so it cannot get one backwards. On 08-18-2026 entries 6 and 8 of exactly
// such a table were swapped and a whole shoot rendered upside down. That class of bug is
// STRUCTURALLY IMPOSSIBLE on this path, not merely fixed.
import { ipcRenderer } from "electron";

/** Matches THUMB_WIDTH / THUMB_QUALITY in stillThumb.ts — one geometry across both paths. */
interface Job {
  id: number;
  bytes: ArrayBuffer;
  width: number;
  quality: number;
}

async function run(job: Job): Promise<void> {
  try {
    // A SCALED DECODE. `resizeWidth` lets Chromium decode straight to the target, so the
    // 24-megapixel bitmap is never materialised.
    //
    // KNOWN, ACCEPTED SIMPLIFICATION: an image already narrower than the target is scaled UP to it.
    // Avoiding that would mean decoding once to learn the size and again to resize, which costs
    // more than it saves — and at tile size the browser would have upscaled it for display anyway.
    const bitmap = await createImageBitmap(new Blob([job.bytes], { type: "image/jpeg" }), {
      resizeWidth: job.width,
      resizeQuality: "high",
      imageOrientation: "from-image",
    });

    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      ipcRenderer.send("thumb:done", job.id, null, "no 2d context");
      return;
    }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close(); // release the decoded frame immediately, not at the next collection

    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: job.quality });
    const out = await blob.arrayBuffer();
    ipcRenderer.send("thumb:done", job.id, out);
  } catch (e) {
    // NEVER THROW OUT OF HERE. An unanswered job is a tile that hangs; a reported failure is a tile
    // that falls back to the main-process path and still gets its picture.
    ipcRenderer.send("thumb:done", job.id, null, e instanceof Error ? e.message : String(e));
  }
}

// Concurrency is governed by the MAIN process (it holds the queue), so this listener simply starts
// whatever it is handed. Jobs overlap because createImageBitmap and convertToBlob hand off to
// Chromium's internal thread pool — which is where the measured 1.75x at four in flight comes from.
ipcRenderer.on("thumb:job", (_e, id: number, bytes: ArrayBuffer, width: number, quality: number) => {
  void run({ id, bytes, width, quality });
});

// The handshake. Main will not dispatch until this arrives, so a job can never be sent into a
// window that has not finished loading.
ipcRenderer.send("thumb:ready");
