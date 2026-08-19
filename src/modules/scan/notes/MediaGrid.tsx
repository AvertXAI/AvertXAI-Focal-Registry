/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// The media grid — browsing the archive, never touching it. Built to the mockups: a tile wall, and a
// three-band viewer for every media class (MOCKUP-scan-notes-media-modals-v2-08-18-2026.html). The
// viewer itself lives in MediaViewer.tsx; this file owns the wall, the thumbnail pipeline, and which
// item is open.
//
// HOW A VIDEO TILE GETS ITS PICTURE — THE EXPLORER PATTERN, arrived at over three passes.
//
// Attempt one drew a frame to a <canvas> from a DETACHED video element and failed twice over: an
// element outside the render tree is not guaranteed to decode at all, and `frmedia:` was a
// distinct origin with no CORS, so the canvas tainted and `toDataURL()` threw SecurityError into
// a silent catch. Attempt two dropped the canvas entirely and made the <video> element itself the
// thumbnail, in the render tree, seeked with `#t=`. That painted — and cost a decoder plus a
// decoded frame at SOURCE resolution per tile, about three megabytes at 1080p and twelve at 4K,
// which is why it needed a forty-tile ceiling and why scrolling away lost pictures.
//
// This is attempt three, and it is what Windows Explorer does: decode ONE frame, draw it small,
// write it to disk, throw the decoder away. Jason ruled the blocker fixed on 08-17-2026 — the
// `frmedia` handler now returns Access-Control-Allow-Origin and the scheme is registered
// `corsEnabled`, so a frame our renderer is already allowed to DISPLAY is one it may also READ.
// A tile is therefore a live <video> for exactly as long as it takes to produce one JPEG, and a
// plain <img> for the rest of its life. Cached tiles cost no decoder at all.
//
// WHAT IS WRITTEN, AND WHERE. §4.1's blanket thumbnail ban is CLAUDE.md's own text; Jason overruled
// it for this view on 08-17-2026 ("claude banned them not me") and ruled the disk cache in the same
// day. What the rule actually protects — no artefact left beside a photographer's footage — is
// enforced, not merely intended: every byte lands in the app-owned hidden cache under the local tree
// (electron/core/services/scan/thumbs.ts). Nothing is ever written to the scanned drive.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ScanMediaItem, ScanThumbFailReason, ScanThumbFailure } from "../../../shared/types";
import MediaViewer from "./MediaViewer";
import { computeWindow, checkWindowMath } from "./mediaWindow";
import "./scannotes.css";

/* The stem/extension split moved to MediaViewer.tsx with the header that used it — a tile shows the
   whole filename and never truncates it, so nothing here needs the pair any more. */

function fmtBytes(n: number | null): string {
  if (!n || n <= 0) return "";
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024).toFixed(0)} KB`;
}

/** Six loads in flight. A video thumbnail is a file read plus a decode, and the reads are served
 *  synchronously by the MAIN process — more parallelism there buys nothing and costs responsiveness
 *  everywhere else in the application. */
const CONCURRENCY = 6;

/** No frame in ten seconds is a failure. It was four, and four was wrong: four seconds is a
 *  plausible honest read for a large clip on an external drive, so the ceiling was killing tiles
 *  that were merely slow and turning a queue into a wall of permanent glyphs. */
const FRAME_CEILING_MS = 10_000;

/**
 * THE DECODER CEILING IS NOW STRUCTURAL, WHICH IS WHY THERE IS NO CONSTANT HERE ANY MORE.
 *
 * There used to be a PAINTED_CEILING of 40 and an eviction pass to enforce it, because a tile that
 * had painted from a live <video> was still holding the decoder and the decoded frame beside it.
 * From this phase a decoder exists only inside a BENCH slot, and there are never more of those than
 * CONCURRENCY — six, whatever the folder holds and wherever the user has scrolled to. A tile is an
 * <img> or a glyph and holds nothing at all.
 *
 * So eviction is gone rather than tuned. It had one job, the bench does that job by construction,
 * and a second mechanism aimed at the same thing is how a picture ended up being taken off the
 * user's screen in the first place.
 */

/**
 * `noframe` IS NOT A FAILURE, AND CALLING IT ONE WAS A LIE THE COUNTS TOLD.
 *
 * Device evidence, 08-18-2026: an .mp3 in a YouTube Downloads folder reported
 * `code=none readyState=4 networkState=1 buffered=1`. Read it against the video failures and it is
 * their exact opposite — readyState 4 and buffered 1 mean the file loaded COMPLETELY and
 * SUCCESSFULLY, and code=none means the element reported no error at all. Nothing went wrong. There
 * is simply no video track to take a frame from.
 *
 * The test is kind-independent on purpose: a container that reaches HAVE_FUTURE_DATA with no error
 * and no video dimensions has been demuxed successfully and genuinely carries no video. A codec
 * Chromium cannot decode does not get that far — it errors, or it stalls at readyState 0 or 1 — so
 * this cannot swallow a real decode failure, and it protects the counts even if a file arrives
 * mis-classified.
 */
type Outcome = "painted" | "failed" | "gone" | "noframe";

/**
 * WHAT A TILE ENDED UP AS.
 *  · painted — a frame was captured; the tile becomes an <img> and the decoder is released
 *  · shown   — a frame decoded and is ON SCREEN, but could not be read back, so it stays a <video>
 *  · failed  — no frame at all; the glyph
 *
 * `shown` EXISTS BECAUSE OF A BUG THIS FIXES. The first cut of the cache treated an unreadable
 * frame as no frame and fell back to the glyph — which threw away a perfectly good, already-decoded,
 * already-visible picture because the CACHE could not have it. A cache failure must never be a
 * display failure. When capture is refused, the behaviour degrades to exactly what shipped before
 * the cache existed: the frame you can see is the thumbnail.
 */
/**
 * HOW MANY TOTAL ATTEMPTS EACH CLASS GETS, per folder open. Counting TOTAL attempts, not retries:
 * transient gets its first try plus one more, unknown gets its first try and nothing else.
 *
 * `unknown` IS CAPPED AT ONE DELIBERATELY, and it is worth being explicit that this makes it behave
 * like `permanent` for now. The instruction is "treat as transient, but cap it harder", and the
 * hardest useful cap on a class we cannot explain is: do not spend slots on it. What `unknown` still
 * buys over `permanent` is that it is COUNTED and reported — if it starts dominating, that shows up
 * as a number in the session summary rather than as a folder that mysteriously takes forever. The
 * user's own Retry control covers it either way.
 */
const ATTEMPT_BUDGET: Record<ScanThumbFailReason, number> = { transient: 2, unknown: 1, permanent: 0 };

/** How long after the queue drains before a retry round starts. Three seconds: long enough that a
 *  drive which was genuinely busy has a moment to recover and is not hammered, short enough that a
 *  user watching the folder settle sees the second attempt land rather than wondering. */
const RETRY_BACKOFF_MS = 3000;

/** How many thumbnails the grid keeps in memory across folder changes. At ~11 KB each this is about
 *  22 MB at the ceiling — cheap enough that the toggle is free, bounded so a long session is not a
 *  slow leak. Beyond it the oldest go, and a dropped one is a disk-cache hit, not a regeneration. */
const SESSION_THUMB_MAX = 2000;

/** How many paths go to the disk cache in ONE round trip.
 *
 *  `thumbsGet` is a synchronous statSync + readFileSync loop on the thread that owns every window,
 *  and it answers with base64 — so both the block and the payload scale with the array handed over.
 *  A 2,500-row folder in one call is a long block AND roughly 37 MB of string. At 500 the payload is
 *  about 7 MB and the loop is a fifth of the work, and the batches land progressively so the top of
 *  the wall paints while the rest is still being read. Matches THUMBS_MAX in ipc.ts. */
const CACHE_BATCH = 500;


type Settled = "painted" | "shown" | "failed" | "noframe";

/**
 * WHY A TILE FAILED, decided here because this is the only place the media element's own error
 * exists. It is the difference between a safety net and a treadmill: a clip whose format Chromium
 * cannot decode fails identically on the two hundredth attempt as on the first, and retrying it
 * costs a queue slot, a file read and ten seconds of ceiling every single time.
 *
 * THE MAPPING, in the order it is evaluated:
 *
 *   code 1  MEDIA_ERR_ABORTED           -> transient   the load was cancelled, not refused
 *   code 2  MEDIA_ERR_NETWORK           -> transient   the bytes did not arrive; they might next time
 *   code 3  MEDIA_ERR_DECODE            -> permanent IF the container parsed, else transient
 *   code 4  MEDIA_ERR_SRC_NOT_SUPPORTED -> permanent IF the container parsed, else transient
 *   no error, the ceiling fired         -> transient   it stalled; nothing was actually wrong
 *   no error, parsed, no video track    -> permanent   audio-only .mp4, or a codec with no decoder
 *   anything else                       -> unknown
 *
 * `readyState >= 1` (HAVE_METADATA) IS THE "IT WAS DELIVERED" TEST, and it is the hinge of the
 * whole classifier. Metadata parsed means the container was read and understood — so a decode error
 * after that is the CODEC losing, which will lose again forever. The same error with readyState 0
 * means the container itself was never parsed, which is a delivery problem and is exactly the shape
 * the 64 MB range cap produced: 6 of 85 files erroring identically with nothing wrong with them.
 * Classifying those as permanent would have made a serving bug permanently invisible.
 */
function classify(v: HTMLVideoElement, ceilingFired: boolean): { reason: ScanThumbFailReason; detail: string } {
  const code = v.error?.code ?? 0;
  const gotMetadata = v.readyState >= 1;
  const detail =
    `code=${code} readyState=${v.readyState} networkState=${v.networkState} ` +
    `buffered=${v.buffered.length} "${v.error?.message ?? ""}"`;
  if (code === 1 || code === 2) return { reason: "transient", detail };
  if (code === 3 || code === 4) return { reason: gotMetadata ? "permanent" : "transient", detail };
  if (ceilingFired) return { reason: "transient", detail };
  if (gotMetadata && v.videoWidth === 0) return { reason: "permanent", detail };
  return { reason: "unknown", detail };
}

/** What the USER is told. Plain sentences, no error codes — a tile that shows a glyph with no
 *  explanation reads as a broken application, and a tile that shows `MEDIA_ERR_SRC_NOT_SUPPORTED`
 *  reads as a broken application written by someone who did not care. */
export function failSentence(reason: ScanThumbFailReason): string {
  if (reason === "permanent") return "This video's format can't be previewed here.";
  if (reason === "transient") return "Couldn't read this file — the drive may have been busy.";
  return "Couldn't preview this file.";
}

/**
 * LEARNED ONCE PER SESSION, and only ever from PROOF.
 *   null  — untested
 *   true  — a frame was actually captured; the disk cache is live
 *   false — proven unreadable; stop paying for the attempt on every other tile
 *
 * IT IS NEVER SET FROM A FAILED LOAD, and that restraint is the whole point. An `error` event does
 * not say why: a cross-origin refusal and a codec Chromium cannot decode look identical from here,
 * and this list contains real files of both kinds — an HEVC .mov passes the extension filter and
 * then fails to decode. Blaming the first error on CORS meant one bad clip could switch capture off
 * for every other clip in the session. So `false` is written in exactly two places, both of which
 * have already observed the outcome: a retry WITHOUT the attribute that then succeeds (which proves
 * the attribute was the blocker), or a decoded frame with real dimensions that the canvas still
 * refuses to export (which proves a taint).
 *
 * Without the memo a folder of two hundred clips would pay a refused load plus a retry two hundred
 * times over. One tile teaches the rest — but only once it actually knows something.
 */
let captureViable: boolean | null = null;

/** Roughly the tile's own width. The frame is drawn at THIS size, not the source resolution — a 4K
 *  clip and a phone clip both cost the same few tens of kilobytes once they are here. */
const CAPTURE_WIDTH = 320;

/** JPEG, not PNG. A PNG of a photographic frame is an order of magnitude larger for no visible gain
 *  at 320 pixels wide, and 0.7 is the point where a thumbnail stops getting smaller and starts
 *  getting worse. */
const CAPTURE_QUALITY = 0.7;

/**
 * ONE FRAME, ONCE, THEN THE DECODER GOES. This is the whole Explorer trick: a decoded 4K frame costs
 * about twelve megabytes and holds a live decoder beside it, while the JPEG this produces is tens of
 * kilobytes. Capturing lets the tile become a plain <img> and lets the <video> be torn down, which
 * is what makes a folder of hundreds keep every picture instead of trading them away as you scroll.
 *
 * IF THIS THROWS SecurityError, NOTHING HERE IS THE BUG. It means the frame's origin is still opaque
 * to us, and there are exactly two causes: the `frmedia` response is missing its
 * Access-Control-Allow-Origin (or the scheme was registered without `corsEnabled`), or
 * `crossOrigin` was assigned to the element AFTER its `src`, where it has no effect
 * at all. Both are named in the message below — do not paper either over with a fallback that
 * quietly ships blank tiles.
 */
function capture(v: HTMLVideoElement): string | null {
  const w = v.videoWidth;
  const h = v.videoHeight;
  if (w === 0 || h === 0) return null; // no frame decoded — nothing to draw, and drawImage would lie
  const cw = Math.min(CAPTURE_WIDTH, w);
  const ch = Math.max(1, Math.round((h / w) * cw));
  try {
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return null;
    ctx.drawImage(v, 0, 0, cw, ch);
    return canvas.toDataURL("image/jpeg", CAPTURE_QUALITY); // throws if the canvas is tainted
  } catch (e) {
    console.error(
      "[scan-notes] thumbnail capture failed. A SecurityError here means the frame is still cross-origin: " +
        "check that frmedia returns Access-Control-Allow-Origin and is registered with corsEnabled, and that " +
        "crossOrigin is assigned BEFORE src on the element.",
      e
    );
    return null;
  }
}

/** Tracing rides the shell's existing DIAG switch (env `DIAG=1`, `src/diag.ts`). Off, it costs one
 *  boolean read per queue transition and prints nothing. */
let TRACE = false;
void window.api.diag?.enabled()
  .then((e) => {
    TRACE = e === true;
    // THE WINDOW ARITHMETIC CHECKS ITSELF, under DIAG and nowhere else. A virtualized wall that
    // renders the wrong slice cannot be caught by looking at it, so the four numbers that decide
    // what exists are asserted against cases that include the last row and a folder shorter than a
    // screen. It reports rather than throws: a broken assertion must never take the pane down.
    if (!TRACE) return;
    const bad = checkWindowMath();
    if (bad.length > 0) console.error("[scan-notes] WINDOW ARITHMETIC IS WRONG —", bad);
    else console.info("[scan-notes] window arithmetic checks out");
  })
  .catch(() => undefined);

/**
 * THE THUMBNAIL QUEUE.
 *
 * WHAT WAS WRONG, proven in the source before it was replaced. The pool was `let slots = 6` at
 * MODULE scope with hand-paired take/free calls. On the unmount-while-queued path a tile released a
 * slot it had never taken — twice: once from the effect cleanup, and again when its stale thunk was
 * finally popped and returned early. A counter cannot survive an unmatched release, and because the
 * counter was module state that drift outlived every folder change for the life of the window.
 * Separately, and this is what put the grey placeholders on screen, a tile only ever ASKED for a
 * load at the instant it crossed the viewport: everything below the fold never entered the queue at
 * all, and everything already in it was competing against a pool whose arithmetic had drifted.
 *
 * WHAT IS HERE. In-flight is a SET OF KEYS, not a counter — releasing is a delete, so releasing
 * twice is the same as releasing once and no exit path can corrupt the pool however often it fires.
 * The pending list is in listing order and nothing is ever refused entry: every video in the FOLDER
 * LISTING is registered as soon as that listing lands, so the whole folder warms whether or not the
 * wall is even being shown. Being on screen is a PRIORITY signal that jumps the line — never the
 * door, and no longer a registration: tiles come and go with the scroll now, and work that started
 * when a tile mounted would stop the moment it scrolled away again.
 *
 * IT IS PER-FOLDER. MediaGrid builds one and cancels it on folder change or unmount, so a walk can
 * never outlive the folder it was walking.
 *
 * THE MEMORY POSITION, restated for the cache. It used to be that a painted tile WAS a live <video>
 * holding a decoder plus one decoded frame at SOURCE resolution — three megabytes at 1080p, twelve
 * at 4K — so five hundred of them was one and a half to six gigabytes, past which Chromium's own cap
 * on concurrent media players starts refusing loads outright. That is why PAINTED_CEILING exists.
 *
 * It is no longer the thing that governs. A tile now holds a <video> only for as long as it takes to
 * capture one JPEG, then becomes an <img> and the decoder is released; a tile with a cached picture
 * never creates one at all. So the ceiling has stopped being a limit on what a FOLDER can show and
 * has become what Jason ruled it on 08-17-2026: a decoder limit, a backstop over the handful of
 * tiles that are mid-generation at any moment. Cached tiles are not subject to it, which is what
 * makes scrolling non-destructive — nothing is traded away any more, because nothing expensive is
 * being held. What a fully painted folder costs now is one decoded 320-pixel bitmap per tile, about
 * 230 KB, so five hundred is roughly 115 MB against the 1.5 to 6 GB it used to be.
 */
class ThumbQueue {
  private readonly starters = new Map<string, () => void>();
  private readonly drops = new Map<string, () => void>();
  private readonly pending = new Set<string>();
  private readonly inFlight = new Set<string>();
  /** key → the tick it was last dealt with. Its remaining job is to stop a finished file being
   *  queued a second time; the eviction order it used to carry no longer exists — see above. */
  private readonly painted = new Map<string, number>();
  private order: string[] = [];
  private urgent: string[] = [];
  private cancelled = false;
  private tick = 0;
  readonly counts = { queued: 0, started: 0, painted: 0, failed: 0, gone: 0, noframe: 0 };
  /** The retry pass's own tally, written by MediaGrid — the classification lives up there, with the
   *  media element's error, and this object exists so ONE line tells the whole story of a run.
   *  `recovered` is the number that matters: it is the entire justification for the retry. */
  readonly retry = { retried: 0, recovered: 0, gaveUp: 0, permanent: 0, unknown: 0 };
  /** Fired when the last slot empties with nothing waiting. This is the retry's trigger, and it is
   *  deliberately the SAME drain the summary line already used rather than a second notion of
   *  "finished" — a retry that could interleave with first attempts would spend a slot on a file
   *  nobody is looking at while a tile on screen waits. */
  onIdle: (() => void) | null = null;

  /** Called once per video in the folder, in listing order, as soon as the listing lands. This IS
   *  the background walk, and it is deliberately no longer driven by anything that can unmount. */
  register(key: string, start: () => void, drop: () => void): void {
    // Deliberately NOT gated on `cancelled` — see open(). Work that arrives while the queue is closed
    // is remembered and starts when it reopens; pump() is the one and only gate on starting.
    this.starters.set(key, start);
    this.drops.set(key, drop);
    this.enqueue(key, false);
  }

  /** The file is on screen. Priority only — it moves a waiting file to the front of the line. It
   *  never decides whether work happens, and nothing anywhere waits on it. */
  seen(key: string): void {
    this.tick += 1;
    if (this.painted.has(key)) { this.painted.set(key, this.tick); return; }
    if (this.inFlight.has(key)) return;
    if (this.pending.has(key)) { this.urgent.unshift(key); this.pump(); return; }
    this.enqueue(key, true); // evicted earlier, or never registered — either way, back in line first
  }

  /** EVERY exit path lands here: frame decoded, `error`, the ceiling, unmount, folder change. */
  release(key: string, how: Outcome): void {
    this.pending.delete(key);
    if (this.inFlight.delete(key)) this.counts[how] += 1;
    if (how === "painted") this.painted.set(key, ++this.tick);
    else this.painted.delete(key); // failed, gone and noframe alike may all be asked for again
    this.pump();
  }

  /** The tile itself is gone. Releases first, then forgets how to restart it. */
  forget(key: string): void {
    this.release(key, "gone");
    this.starters.delete(key);
    this.drops.delete(key);
  }

  /**
   * STOP STARTING WORK. It deliberately destroys NOTHING.
   *
   * THIS IS A STRICTMODE FIX AND THE SHAPE MATTERS. The queue has to exist during render, because
   * every tile takes it as a prop — so it is built in useMemo and torn down in an effect cleanup.
   * In development React runs a mount as setup → cleanup → setup, which means that cleanup fires
   * ONCE BEFORE THE COMPONENT IS REALLY ALIVE. The previous version latched `cancelled` and wiped
   * every map, so the committed queue was permanently dead and every tile's second registration was
   * refused: on the first folder the media pane opened, no thumbnail was ever generated. Because
   * child effects run before parent effects, re-arming in the parent's setup could not have rescued
   * it either — the tiles had already been turned away.
   *
   * So closing is now reversible and registrations survive it. On a real folder change nothing is
   * lost by keeping the maps: the tiles unmount and forget themselves, and the queue object is
   * discarded with the folder.
   */
  cancel(): void {
    if (TRACE) console.info("[scan-notes] thumb queue closed —", this.summary());
    this.cancelled = true;
  }

  /** Re-arm, and pick up anything that registered while closed. */
  open(): void {
    if (!this.cancelled) return;
    this.cancelled = false;
    this.pump();
  }

  summary(): string {
    const c = this.counts;
    const r = this.retry;
    const noframe = c.noframe > 0 ? `, no video track ${c.noframe}` : "";
    const base = `queued ${c.queued} · slots taken ${c.started} · released: painted ${c.painted}, failed ${c.failed}${noframe}, dropped ${c.gone} · still in flight ${this.inFlight.size} · still waiting ${this.pending.size}`;
    // Appended only when there is something to say, so a healthy folder's line stays the one line
    // it has always been.
    if (r.retried === 0 && r.permanent === 0 && r.unknown === 0) return base;
    return (
      base +
      ` · retried ${r.retried} (${r.recovered} recovered, ${r.gaveUp} gave up)` +
      ` · permanent ${r.permanent} · unknown ${r.unknown}`
    );
  }

  private enqueue(key: string, urgent: boolean): void {
    if (!this.starters.has(key)) return;
    if (this.painted.has(key) || this.inFlight.has(key) || this.pending.has(key)) return;
    this.pending.add(key);
    this.counts.queued += 1;
    if (urgent) this.urgent.unshift(key); else this.order.push(key);
    this.pump();
  }

  private nextKey(): string | null {
    for (const lane of [this.urgent, this.order]) {
      while (lane.length > 0) {
        const k = lane.shift() as string;
        if (this.pending.has(k) && !this.inFlight.has(k)) return k;
      }
    }
    return null;
  }

  private pump(): void {
    if (this.cancelled) return;
    while (this.inFlight.size < CONCURRENCY) {
      const key = this.nextKey();
      if (key === null) break;
      this.inFlight.add(key);
      this.counts.started += 1;
      const start = this.starters.get(key);
      // Deferred by one microtask: `start` sets React state, and re-entering this loop from inside
      // it would read the in-flight set mid-update.
      queueMicrotask(() => { if (!this.cancelled && this.inFlight.has(key)) start?.(); });
    }
    // DRAINED. The trace is TRACE-gated; the callback is not — the retry has to run whether or not
    // anyone is watching the console.
    if (this.counts.started > 0 && this.inFlight.size === 0 && this.pending.size === 0) {
      if (TRACE) console.info("[scan-notes] thumb queue idle —", this.summary());
      this.onIdle?.();
    }
  }
}

/**
 * THE TILE'S PICTURE IS THE VIDEO ELEMENT ITSELF, paused on one frame.
 *
 * The six traps this is written against, in order:
 *  1. A seek IS issued — the `#t=` media fragment asks for one before any script runs, and the
 *     explicit seek below is the belt to its braces.
 *  2. `src` is assigned in the EFFECT, after the listeners and after `crossOrigin`. Both
 *     orderings matter: React cannot be relied on to emit attributes in prop order, and
 *     `crossOrigin` set after `src` is simply ignored — which on device reads exactly
 *     like the server's CORS header not working, and sends you to debug the wrong process.
 *  3. The element is IN THE RENDER TREE at the tile's real size. This is the one the previous
 *     attempt broke: a detached element decodes nothing reliably.
 *  4. The target is `min(1, duration * 0.1)`, never 0 (black on most camera files) and never past
 *     the end. `NaN`/`Infinity` duration — routine on variable-frame-rate phone footage — falls back
 *     to one second.
 *  5. A codec Chromium cannot decode fires `error`, and the tile falls back to its glyph.
 *  6. `muted` and `playsInline` are set; without them some paths refuse to load media at all.
 *
 * AND IT NEVER SPINS FOREVER: no frame within FRAME_CEILING_MS is a failure like any other, because
 * a container that stalls without erroring is exactly how a wall of tiles ends up hanging. At the
 * ceiling it still tries to KEEP whatever frame exists — a slow container that got one frame out is
 * a thumbnail, not a failure.
 *
 * IT DOES NOT TOUCH THE QUEUE. It mounts only once the queue has already granted its slot, and it
 * reports the outcome upward; the tile owns registration and release, so there is exactly one place
 * a slot can be taken and one place it can be given back.
 *
 * IT IS TRANSIENT BY DESIGN. On success it hands back a captured JPEG, the tile replaces it with an
 * <img>, and that unmounts this component and releases the decoder. The element exists for exactly
 * as long as it takes to produce one picture.
 */
function VideoThumb({ src, onSettled }: { src: string; onSettled: (how: Settled, shot?: string, why?: ScanThumbFailReason, detail?: string) => void }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  /** ATTEMPT ONE ASKS FOR PIXEL ACCESS. If the load is refused only because of that ask, attempt two
   *  drops it and we are back to a visible frame with no cache — never worse than before the cache
   *  existed. At most one retry: this only ever goes true → false. */
  const [useCors, setUseCors] = useState(captureViable !== false);
  /** True once this tile has actually fallen back. It is what separates "we retried and it worked,
   *  so the attribute was the problem" from "we never tried the attribute in the first place". */
  const retried = useRef(false);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    /** Set only by onCeiling. The classifier needs it because a stall that produced no error at all
     *  is indistinguishable from a file that simply has no video track without knowing which of the
     *  two ended the attempt. */
    let ceilingFired = false;

    const settle = (how: Settled, shot?: string): void => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      // WHY IT FAILED, in the element's own words. A wall of failed tiles is indistinguishable from
      // a wall of refused ones without this, and the two have nothing to do with each other:
      //   code 4 (SRC_NOT_SUPPORTED) with a demuxer message = the container could not be parsed,
      //     which for a camera original almost always means the index never arrived
      //   code 3 (DECODE)                                   = the bytes arrived and the codec lost
      //   no code at all, readyState 0, networkState 2      = the ceiling expired mid-load; nothing
      //     was wrong, it simply never finished
      // buffered.length is the tell-tale: zero means not one byte was usable.
      if (TRACE && how === "failed") {
        const err = v.error;
        console.warn(
          `[scan-notes] thumb failed: code=${err?.code ?? "none"} "${err?.message ?? ""}" ` +
            `readyState=${v.readyState} networkState=${v.networkState} buffered=${v.buffered.length} ` +
            `cors=${useCors} ${src}`
        );
      }
      if (how === "failed") {
        const { reason, detail } = classify(v, ceilingFired);
        onSettled(how, shot, reason, detail);
        return;
      }
      onSettled(how, shot);
    };
    const seek = (): void => {
      const d = v.duration;
      const target = Number.isFinite(d) && d > 0 ? Math.min(1, d * 0.1) : 1;
      // Only if the fragment did not already put us there — re-seeking a good position costs a
      // second range request for nothing.
      if (v.currentTime < 0.05) { try { v.currentTime = target; } catch { /* unseekable; the frame at 0 stands */ } }
    };
    /** Capture if we can, keep the picture either way — but only ever call something a picture when
     *  there is genuinely a frame behind it. */
    const grab = (): void => {
      // NO FRAME IS NOT A TAINT, and — since 08-18-2026 — it is not automatically a failure either.
      // videoWidth stays 0 for two completely different situations and they must not share a verdict:
      //
      //   loaded fine, no video track   readyState >= 3, no error   -> noframe. An .mp3, an audio-only
      //                                                                .mp4. Nothing went wrong.
      //   never got that far            anything else               -> failed, classified as usual
      //
      // Counting the first as a failure was a lie in the summary line, an entry in the failure log,
      // and a retry budget spent on a file that will answer identically forever.
      if (v.videoWidth === 0 || v.videoHeight === 0) {
        settle(v.readyState >= 3 && v.error === null ? "noframe" : "failed");
        return;
      }

      if (!useCors) {
        // We are here without the attribute and we have a real frame. If the first attempt errored,
        // that PROVES the attribute was what it choked on — the one honest place to write the memo.
        if (captureViable === null && retried.current) {
          captureViable = false;
          console.warn(
            "[scan-notes] frmedia refused the cross-origin read — the same file loads fine without it. " +
              "Thumbnails will show; the disk cache is off for this session. Check corsEnabled on the " +
              "scheme and the Access-Control-Allow-Origin header in mediaBrowse.ts."
          );
        }
        settle("shown");
        return;
      }

      const shot = capture(v);
      if (shot !== null) { captureViable = true; settle("painted", shot); return; }
      // A real frame, on screen, that the canvas will not export: that is a taint, and unlike an
      // error it is unambiguous.
      if (captureViable === null) {
        console.warn(
          "[scan-notes] the video frame decoded but the canvas refused to export it, so thumbnails " +
            "will show and will NOT be cached this session. That is a canvas taint: check that " +
            "frmedia returns Access-Control-Allow-Origin and is registered corsEnabled."
        );
      }
      captureViable = false;
      settle("shown");
    };
    // `loadeddata` can arrive at frame zero, before the seek lands — and frame zero is black on
    // most camera files. The guard has to be `!v.seeking` and NOT `currentTime > 0.05`: the HTML
    // seek algorithm writes the official playback position the moment a seek is ISSUED, while the
    // old frame is still the decoded one — so a currentTime test passes during the seek and captures
    // exactly the black frame it was written to avoid. That mistake now costs more than it used to,
    // because the black frame gets written to the disk cache and outlives the session.
    const onData = (): void => { if (!v.seeking && v.currentTime > 0.05) grab(); };
    /**
     * EVERY tile that asked for pixel access retries, not just the first one to fail.
     *
     * The previous cut gated this on `captureViable === null`, and with CONCURRENCY at six that meant
     * the first tile to error took the retry and its five in-flight siblings — which had all mounted
     * before the memo was written — fell straight through to the glyph. Worse, `failed` unregisters
     * the tile, so those five could never be queued again for the life of the folder. Six concurrent
     * loads, one rescued, five killed.
     *
     * The retry is deliberately cheap to be wrong about: if the file is simply undecodable, the
     * second attempt errors too and the tile glyphs one load later than it would have.
     */
    const fail = (): void => {
      if (useCors) {
        retried.current = true;
        setUseCors(false); // re-runs this effect and reloads without the attribute; the retry settles
        return;
      }
      settle("failed");
    };
    /** At the ceiling, keep a frame if one exists (HAVE_CURRENT_DATA or better) rather than throwing
     *  away a slow container's work. */
    const onCeiling = (): void => { ceilingFired = true; if (v.readyState >= 2) grab(); else settle("failed"); };

    v.addEventListener("loadedmetadata", seek);
    v.addEventListener("loadeddata", onData);
    v.addEventListener("seeked", grab);
    v.addEventListener("error", fail);

    timer = setTimeout(onCeiling, FRAME_CEILING_MS);
    // ORDER IS LOAD-BEARING on both lines. crossOrigin has no effect once src is set, and src is
    // assigned here rather than in JSX so React's attribute emission order cannot decide it.
    if (useCors) v.crossOrigin = "anonymous";
    else v.removeAttribute("crossorigin"); // the retry must not carry the attribute that failed
    v.src = `${src}#t=1`;
    v.load(); // some containers do not begin fetching on src assignment alone

    return () => {
      done = true; // the SLOT is released by the tile's registration cleanup, never from here —
      if (timer) clearTimeout(timer); // reporting "failed" on an unmount would libel a healthy tile
      v.removeEventListener("loadedmetadata", seek);
      v.removeEventListener("loadeddata", onData);
      v.removeEventListener("seeked", grab);
      v.removeEventListener("error", fail);
      v.removeAttribute("src"); // drop the decoder and any buffered bytes with the tile
      v.load();
    };
  }, [src, onSettled, useCors]);

  // NO src PROP — it is assigned in the effect above, after crossOrigin. `#t=1` is the whole of
  // Approach A: Chromium honours the media fragment on load and paints that frame with no script at
  // all, and preload="metadata" keeps the read to the header plus one frame.
  return <video ref={ref} className="tvid" preload="metadata" muted playsInline disablePictureInPicture />;
}

/**
 * ONE TILE, AND IT NO LONGER FETCHES ANYTHING.
 *
 * WHAT MOVED, AND WHY IT HAD TO. A tile used to be the thing that asked: it registered itself with
 * the thumbnail queue at mount, it ran its own IntersectionObserver, and it called `stillThumb` the
 * first time it crossed the viewport. Every one of those is a promise that the tile EXISTS — and
 * from this phase on, a tile only exists while it is on screen. Left as it was, virtualization would
 * have quietly meant "the folder warms only as far as you scrolled", which is the 250-tile defect in
 * a form nobody could see.
 *
 * So the asking lives in MediaGrid now, off the back of the LISTING rather than off the back of a
 * mounted element, and a tile is what it always should have been: a picture, a name, and a click.
 * `onSeen` is the one signal it still sends, and it is a PRIORITY signal, never a door — mounting
 * means the user is looking at this file, so it jumps both queues. Nothing anywhere waits on it.
 */
function Tile({ item, pic, failReason, readErr, onSeen, onOpen }: {
  item: ScanMediaItem;
  /** The picture, whatever produced it — the grid holds every one of them. Null is a glyph. */
  pic: string | null;
  /** Why this file has no picture, if it is known to have failed. Null while it is still coming. */
  failReason: ScanThumbFailReason | null;
  /** A read error in the file's own words, for the one case the classifier cannot cover. */
  readErr: string | null;
  /** "The user is looking at this one." Priority only. */
  onSeen: (path: string) => void;
  onOpen: (i: ScanMediaItem) => void;
}) {
  // MOUNTING IS THE VIEWPORT SIGNAL NOW. With the wall virtualized, a tile that exists is a tile on
  // screen or within the overscan margin — so the observer that used to establish this is redundant
  // and has been removed rather than left to fire alongside it. One source of truth for "visible".
  useEffect(() => { onSeen(item.path); }, [onSeen, item.path]);

  // An AUDIO file gets an audio glyph and never a film reel — it is not video and must not look it.
  const glyph = item.kind === "video" ? "🎬" : item.kind === "audio" ? "🎵" : "🖼";

  // EVERY TILE STATE THAT HAS SOMETHING TO SAY, resolved in one place and said in one place.
  // Ordered most specific first: a concrete read failure beats the general "cannot open this
  // format", which beats a size.
  const note =
    readErr !== null && readErr !== ""
      ? readErr
      : !item.viewable
        ? `This product cannot open ${item.extension ?? "this format"}${fmtBytes(item.size_bytes) ? ` — ${fmtBytes(item.size_bytes)}` : ""}.`
        : failReason !== null && pic === null
          ? failSentence(failReason)
          : item.embedded && pic
            ? "This is the preview the camera embedded in the file."
            : null;

  return (
    <button
      type="button"
      className={`scannotes-tile${item.viewable ? "" : " dead"}`}
      onClick={() => item.viewable && onOpen(item)}
      // THE CAPTION IS THE FILE'S NAME. Nothing else. A reason appended to it was truncated by the
      // caption's own ellipsis into `IMG_0541.CR2 · That f…`, which tells the user there is a
      // sentence and then refuses to show it — worse than either the name alone or the sentence
      // alone. The full path lives here so hovering the name still gives the name in full.
      title={item.path}
    >
      {/* THE REASON RIDES ON THE GLYPH, which is the part of the tile that looks wrong. It is a
          plain sentence with no error code: a photographer cannot act on "MediaError 4", and a
          number in the interface reads as a bug that shipped anyway. */}
      <div className={`thumb${item.kind === "video" ? " vid" : ""}`} title={note ?? undefined}>
        {/* A DOUBLED WALL HAS TO BE READABLE AT A GLANCE. With the toggle on, a RAW and its JPEG
            sibling are the same photograph twice; the badge is what tells them apart without
            reading two filenames. */}
        {item.raw && <span className="raw">RAW</span>}
        {pic !== null ? <img src={pic} alt="" /> : <span aria-hidden="true">{glyph}</span>}
      </div>
      <div className="nm">{item.filename}</div>
    </button>
  );
}

/**
 * ONE BENCH SLOT — a <video> that exists to produce one JPEG and then goes away.
 *
 * THIS IS WHERE THE DECODERS LIVE NOW. VideoThumb is unchanged and still needs to be in the render
 * tree at a real size (attempt one of this feature proved a detached element decodes nothing
 * reliably), so the bench is positioned OFF-SCREEN at tile size rather than hidden — `display:none`
 * or a zero-sized box would be attempt one again under a different name.
 *
 * It exists per KEY so `onSettled` can be stable per file. VideoThumb takes `onSettled` as an effect
 * dependency, so a fresh closure on every grid render would tear the element down and reload it
 * mid-decode, over and over, on a wall that re-renders every time a thumbnail lands.
 */
function BenchSlot({ path, src, onDone }: {
  path: string;
  src: string;
  onDone: (path: string, how: Settled, shot?: string, why?: ScanThumbFailReason, detail?: string) => void;
}) {
  const settled = useCallback(
    (how: Settled, shot?: string, why?: ScanThumbFailReason, detail?: string) => onDone(path, how, shot, why, detail),
    [onDone, path]
  );
  return <VideoThumb src={src} onSettled={settled} />;
}

/** What the two chips report. Counted, never estimated: a file is done when a picture for it exists
 *  or it has genuinely failed — so the number can lag the drive but can never lead it. */
export interface WarmProgress {
  photos: { done: number; total: number };
  raw: { done: number; total: number };
}

/**
 * THE TWO WARM-UP CHIPS, drawn in the Scan Notes tab action row to
 * MOCKUP-scan-notes-background-warm-v2-08-18-2026.html.
 *
 * They live up in ScanModule beside "+ Add Note" and "View media" because that row is visible from
 * the REPORT, which is where the user is standing while the folder warms — a counter inside the
 * media pane would only ever appear once the work it describes was already finished.
 *
 * THE ODOMETER RULE. Both numbers are counts of files that genuinely have a picture (or have
 * genuinely failed), never a share of elapsed time, so the figure can lag the drive and can never
 * lead it. A stall holds the number where it is; the bar holds with it. Neither ever runs ahead to
 * a hundred and then waits, which is the thing that makes a progress bar stop being believed.
 *
 * A LANE WITH NOTHING IN IT DRAWS NOTHING. A folder of JPEGs shows one chip, not a RAW chip reading
 * "0 of 0".
 */
export function WarmChips({ warm }: { warm: WarmProgress | null }) {
  if (warm === null) return null;
  const lanes = [
    { key: "photos", label: "Photos", ...warm.photos },
    { key: "raw", label: "RAW", ...warm.raw },
  ].filter((l) => l.total > 0);
  if (lanes.length === 0) return null;
  return (
    <div className="scannotes-warmwrap">
      {lanes.map((l) => {
        const done = l.done >= l.total;
        return (
          <div key={l.key} className={`scannotes-warm${done ? " done" : ""}`}>
            <span className="bar" aria-hidden="true">
              <i style={{ width: `${Math.round((l.done / l.total) * 100)}%` }} />
            </span>
            <span className="num">
              {done ? (
                <>
                  <span className="tick" aria-hidden="true">✓</span> {l.label} ready
                </>
              ) : (
                `${l.label} ${l.done.toLocaleString()} of ${l.total.toLocaleString()}`
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** How many stills the background warm-up asks for at once. It matches the worker window's own pool
 *  (electron/core/services/scan/thumbWorker.ts) — asking for more only queues them a layer earlier
 *  and costs the main process a longer read queue for no extra throughput. */
const STILL_CONCURRENCY = 4;

/** How many rows of tiles stay mounted beyond each edge of the scrollport. Three is roughly a
 *  flick's worth at this tile size: enough that a fast scroll lands on pictures rather than on
 *  glyphs, few enough that the element count stays a screenful. */
const OVERSCAN_ROWS = 3;

/** How many tiles the wall renders before it has measured itself. One screenful at the widest
 *  reachable pane plus overscan is under a hundred at this tile size; two hundred is that with room
 *  to spare, and it exists for a single frame. */
const PROBE_SLICE = 200;

/** How often the warm figures are handed to the shell. The chips are drawn by ScanModule, so every
 *  update re-renders the whole Scan surface including an 800-folder tree — at four hundred
 *  thumbnails that is four hundred renders of everything. Four times a second is faster than a
 *  reader can follow and cheap enough to be invisible. */
const WARM_REPORT_MS = 250;

export default function MediaGrid({ folderPath, showRaw, active, host, onProgress, onHiddenRaw, onWarm }: {
  folderPath: string | null;
  showRaw: boolean;
  /** Is the media wall actually being shown? The pipeline runs either way — that is the whole point
   *  of the warm-up — and this decides only whether a wall is drawn. */
  active: boolean;
  /** WHERE THE WALL IS DRAWN. This component is mounted permanently by ScanModule so a folder can
   *  warm while the user is reading its report; the wall itself belongs inside the media pane's
   *  scroller, which is ScanNotesTab's element. Portalling into it is what lets one mounted grid
   *  serve both — moving the component between two parents would unmount it, and an unmounted grid
   *  restarts the folder every time the user presses View media. */
  host: HTMLElement | null;
  /** REPORTED UP, NOT RENDERED HERE. Jason placed the loading line in the media pane HEADER row,
   *  beside the Show RAW files toggle (annotated screenshot, 08-18-2026) — and that row belongs to
   *  ScanNotesTab. Only this component knows the counts, so it hands them over. */
  onProgress?: (p: { done: number; total: number } | null) => void;
  /** How many RAW the filter is holding back — drawn on the header row beside the loading line. */
  onHiddenRaw?: (n: number) => void;
  /** The two warm-up chips, drawn in the tab action row (MOCKUP-scan-notes-background-warm-v2). */
  onWarm?: (w: WarmProgress | null) => void;
}) {
  const [items, setItems] = useState<ScanMediaItem[]>([]);
  /** Path → thumbnail data URL. Every picture on the wall comes from here — the tiles hold none of
   *  their own, which is what makes the RAW toggle a re-render rather than a reload and what lets a
   *  virtualized tile be destroyed and rebuilt without losing anything. */
  const [cached, setCached] = useState<Record<string, string>>({});
  /** Path → the recorded failure, read once per folder open alongside the cache. A `permanent`
   *  entry is never attempted again until the user asks. */
  const [failures, setFailures] = useState<Record<string, ScanThumbFailure>>({});
  /** Failures observed THIS open, path → reason. Separate from `failures` on purpose: that one is
   *  what disk remembers, this one is what just happened, and the retry budget is spent against
   *  this one so a folder reopened an hour later gets a clean set of attempts. */
  const [failedNow, setFailedNow] = useState<Record<string, ScanThumbFailReason>>({});
  /** A still that could not be read, in the main process's own words. Stills do not go through the
   *  video classifier — there is no media element and no error code to classify. */
  const [stillErr, setStillErr] = useState<Record<string, string>>({});
  /** Attempts spent per path THIS open. A ref, not state: it is read inside the retry decision and
   *  must never drive a render. */
  const attempts = useRef(new Map<string, number>());
  /** True once the queue has drained at least once. The line under the grid waits for it, so nothing
   *  appears while tiles are still working — it must not flash and must not move the grid. */
  const [settled, setSettled] = useState(false);
  /** Rows the FOLDER holds, which is not always rows the wall received. Only ever differs if the
   *  20,000-row sanity bound binds, and if it does the user is told rather than left to count. */
  const [rowTotal, setRowTotal] = useState(0);
  /** The video files currently holding a decoder on the bench. Never longer than CONCURRENCY. */
  const [bench, setBench] = useState<string[]>([]);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** WHICH ITEM IS OPEN, still held as the item itself so `onOpen` on four hundred tiles stays the
   *  plain `setOpen` it has always been. */
  const [open, setOpen] = useState<ScanMediaItem | null>(null);

  /** PATHS THE USER IS ACTUALLY LOOKING AT. Written by every mounted tile, drained by the still
   *  pump and by the video queue. A ref because it is written during other components' effects and
   *  must never cause a render of its own — the tile it came from is already on screen. */
  const urgent = useRef<Set<string>>(new Set());
  /** Everything the pipeline has already dealt with this folder, so a re-entrant pump cannot ask
   *  twice for the same file. Seeded from the disk-cache sweep. */
  const have = useRef<Set<string>>(new Set());

  // ONE QUEUE PER FOLDER, and the old one is cancelled the moment the folder changes — a background
  // walk must never outlive the folder it was walking.
  const queue = useMemo(() => new ThumbQueue(), [folderPath]); // eslint-disable-line react-hooks/exhaustive-deps
  // open() on every setup, not just the first: React's development double-invoke closes this queue
  // once before the component is really mounted, and without the re-open the first folder would
  // never generate a single video thumbnail.
  useEffect(() => {
    queue.open();
    return () => queue.cancel();
  }, [queue]);

  /**
   * A THUMBNAIL LIVES IN THE GRID, NOT IN THE TILE — and from this phase that is load-bearing rather
   * than merely tidy. A virtualized tile is destroyed the moment it leaves the overscan margin, so a
   * picture held inside one would be thrown away on every scroll and fetched again on the way back.
   *
   * BOUNDED. At roughly 11 KB a thumbnail, SESSION_THUMB_MAX is about 22 MB at worst. Oldest keys
   * are dropped first; a dropped one is a disk-cache hit next time, not a regeneration.
   */
  const onCached = useCallback((p: string, dataUrl: string) => {
    have.current.add(p);
    setCached((c) => {
      if (c[p] === dataUrl) return c;
      const next = { ...c, [p]: dataUrl };
      const keys = Object.keys(next);
      if (keys.length > SESSION_THUMB_MAX) for (const k of keys.slice(0, keys.length - SESSION_THUMB_MAX)) delete next[k];
      return next;
    });
  }, []);

  /** A tile came on screen. Priority in BOTH pipelines, and nothing else. */
  const onSeen = useCallback((p: string) => {
    if (have.current.has(p)) return;
    urgent.current.add(p);
    queue.seen(p); // a no-op for anything the video queue does not know about
  }, [queue]);

  const onOutcome = useCallback((p: string, how: "painted" | "failed", why?: ScanThumbFailReason) => {
    if (how === "painted") {
      // RECOVERED, and only if it had actually failed before. A tile that paints on its first
      // attempt is not a recovery, and counting it as one would make the number that justifies this
      // whole feature meaningless.
      if ((attempts.current.get(p) ?? 0) > 0) queue.retry.recovered += 1;
      setFailedNow((prev) => {
        if (!(p in prev)) return prev; // no state churn for the overwhelming majority that never failed
        const next = { ...prev };
        delete next[p];
        return next;
      });
      return;
    }
    attempts.current.set(p, (attempts.current.get(p) ?? 0) + 1);
    setFailedNow((prev) => ({ ...prev, [p]: why ?? "unknown" }));
  }, [queue]);

  /** Path → its stream URL, for the bench. Built once per listing rather than searched per slot. */
  const streams = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of items) if (i.kind === "video" && i.streamUrl !== null) m.set(i.path, i.streamUrl);
    return m;
  }, [items]);

  /**
   * A BENCH SLOT FINISHED. This is the whole of the video pipeline's write side, and it is the same
   * set of outcomes the tile used to handle — it has simply stopped being a tile's business.
   *
   * `shown` IS AN ACCEPTED LOSS HERE, and it is worth naming. It means a frame decoded but the
   * canvas would not export it, which used to leave the live <video> on screen as the thumbnail. A
   * bench slot is off-screen, so there is nothing to leave: that file glyphs instead. It only
   * happens when frame capture is unavailable altogether — the console warning in `capture()` says
   * so in as many words — and the alternative is keeping a decoder alive per file for the life of
   * the folder, which is the memory position this whole design exists to escape.
   */
  const benchDone = useCallback(
    (p: string, how: Settled, shot?: string, why?: ScanThumbFailReason, detail?: string) => {
      if (how === "painted" && shot !== undefined) {
        onCached(p, shot);
        // Fire-and-forget: the picture already exists, so a cache that cannot write is slow next
        // launch and broken never.
        void window.api.scan.notes.thumbsPut(p, shot).catch(() => undefined);
        onOutcome(p, "painted");
      } else if (how === "failed") {
        onOutcome(p, "failed", why ?? "unknown");
        void window.api.scan.notes.thumbFailurePut(p, why ?? "unknown", detail ?? "").catch(() => undefined);
      } else if (how === "noframe") {
        // Nothing went wrong — there is simply no video track. Recorded NOWHERE, counted as no
        // failure, never retried. An audio file mis-typed as video lands here.
        have.current.add(p);
      } else {
        have.current.add(p); // "shown" — see above
      }
      setBench((b) => b.filter((k) => k !== p));
      queue.release(p, how === "failed" ? "failed" : how === "noframe" ? "noframe" : "painted");
    },
    [onCached, onOutcome, queue]
  );

  /**
   * THE RETRY ROUND. Armed by the queue draining, delayed by RETRY_BACKOFF_MS, and it re-queues only
   * what still has budget. Everything else here is the stopping condition, which is the part that
   * matters: a retry that cannot succeed is a treadmill.
   */
  useEffect(() => {
    queue.onIdle = () => {
      setSettled(true);
      if (retryTimer.current !== null) return; // a round is already armed
      retryTimer.current = setTimeout(() => {
        retryTimer.current = null;
        setFailedNow((current) => {
          const entries = Object.entries(current);
          const due = entries.filter(([p, r]) => (attempts.current.get(p) ?? 0) < ATTEMPT_BUDGET[r]);
          // SET rather than accumulated: it describes the folder as it stands, so a second drain
          // does not double-count what the first one already reported.
          queue.retry.gaveUp = entries.length - due.length;
          queue.retry.permanent = entries.filter(([, r]) => r === "permanent").length;
          queue.retry.unknown = entries.filter(([, r]) => r === "unknown").length;
          if (due.length > 0) {
            queue.retry.retried += due.length;
            // RE-REGISTERED DIRECTLY, which is the whole of a retry now. There is no second queue
            // and no second code path: a retry is a file asking again, in the ordinary lane.
            for (const [p] of due) {
              if (!streams.has(p)) continue;
              have.current.delete(p);
              queue.register(p, () => setBench((b) => (b.includes(p) ? b : [...b, p])), () => undefined);
            }
          }
          return current; // read-only use of the setter
        });
      }, RETRY_BACKOFF_MS);
    };
    // CANCELLED WITH THE FOLDER, exactly as the first pass is.
    return () => {
      queue.onIdle = null;
      if (retryTimer.current !== null) { clearTimeout(retryTimer.current); retryTimer.current = null; }
    };
  }, [queue, streams]);

  /** Everything that could not be previewed: what failed this session, plus what disk already knows
   *  is hopeless — a `permanent` file is never attempted, so it never appears in failedNow. */
  const failedPaths = useMemo(() => {
    const s = new Set(Object.keys(failedNow));
    for (const i of items) if (failures[i.path]?.reason === "permanent") s.add(i.path);
    return [...s];
  }, [failedNow, failures, items]);

  /** The human override. It clears the record for this folder — `permanent` included — and re-arms
   *  every failed file. An explicit request outranks the classifier, which may be wrong; what it
   *  must not do is let the classifier be wrong repeatedly and for free. */
  const retryAll = useCallback(() => {
    if (failedPaths.length === 0) return;
    void window.api.scan.notes.thumbFailuresClear(failedPaths).catch(() => undefined);
    attempts.current.clear();
    queue.retry.retried += failedPaths.length;
    setFailures({});   // drops the `permanent` bar, so those files mount a decoder again
    setFailedNow({});
    // VIDEO ONLY, exactly as before this phase. A still that could not be read has already had its
    // one attempt and its own sentence on the tile; re-arming it here would clear the sentence
    // without re-running the read, which is worse than leaving it — it would look fixed.
    for (const p of failedPaths) {
      if (!streams.has(p)) continue;
      have.current.delete(p);
      queue.register(p, () => setBench((b) => (b.includes(p) ? b : [...b, p])), () => undefined);
    }
  }, [failedPaths, queue, streams]);

  /**
   * THE FOLDER, END TO END: list it, read what the cache already has, then warm the rest.
   *
   * IT RUNS WHETHER OR NOT THE WALL IS SHOWING, and that is the entire point of the phase. A folder
   * clicked in the tree opens on its report; by the time the user presses View media the pictures
   * are already on disk. `active` is not a dependency here and must never become one.
   *
   * THE ORDER IS THE RULING. Standard photographs first, then video, then RAW — Jason's, on the
   * grounds that a standard image is what you are most likely to want and a RAW is the one that
   * costs an extraction. Anything the user actually looks at jumps all three lanes.
   */
  useEffect(() => {
    attempts.current.clear();
    urgent.current = new Set();
    have.current = new Set();
    setFailedNow({});
    setStillErr({});
    setBench([]);
    setSettled(false);
    if (!folderPath) { setItems([]); setCached({}); setFailures({}); setRowTotal(0); return; }
    let live = true;

    void (async () => {
      // ISSUE THIS FOLDER'S TOKEN FIRST, BEFORE ANY WORK CAN BE ASKED FOR. Bumping the counter
      // main-side is itself the cancellation of the previous folder's outstanding work — there is
      // no list of jobs to walk, and none can be missed. THE PHASE 0 MECHANISM IS THE ONLY ONE:
      // the warm-up deliberately adds no second notion of "stop".
      // The token is a LOCAL, not state: only this run's own requests carry it, and a render has
      // no use for it. Holding it in state would re-render the whole wall for a number nothing draws.
      const token = await window.api.scan.notes.jobToken().catch(() => 0);
      if (!live) return;

      const res = await window.api.scan.notes.media(folderPath).catch(() => null);
      if (!live) return;
      if (res === null) { setItems([]); setCached({}); setFailures({}); setRowTotal(0); return; }
      // TOLERATES THE OLD SHAPE. A reply that is still a bare array (an older main process during a
      // hot reload) is treated as a complete folder rather than crashing the wall.
      const list = Array.isArray(res) ? res : res.items;
      setItems(list);
      setRowTotal(Array.isArray(res) ? res.length : res.total);

      const videos = list.filter((i) => i.kind === "video" && i.streamUrl !== null).map((i) => i.path);
      // THE FAILURE LOG. Read with its own catch and never allowed to decide whether the LISTING
      // happened — the names are already on screen by now, and no record is the same as no failures.
      const dead = await window.api.scan.notes.thumbFailuresGet(videos)
        .catch(() => ({}) as Record<string, ScanThumbFailure>);
      if (!live) return;
      setFailures(dead);

      const cacheable = list.filter((i) => i.kind === "image" || (i.kind === "video" && i.streamUrl !== null)).map((i) => i.path);
      if (cacheable.length === 0) { setCached({}); setFailures({}); return; }

      // CHUNKED, AND THE CHUNKING IS THE FIX. `thumbsGet` is a SYNCHRONOUS statSync + readFileSync
      // loop on the thread that owns every window and it answers with base64, so both the block and
      // the payload scale with the array handed over. Batches bound each, and they land
      // progressively, so the top of the wall paints while the rest is still being read.
      for (let i = 0; i < cacheable.length; i += CACHE_BATCH) {
        if (!live) return; // folder changed mid-sweep: stop asking for a folder nobody is on
        const slice = cacheable.slice(i, i + CACHE_BATCH);
        const hits = await window.api.scan.notes.thumbsGet(slice).catch(() => ({}) as Record<string, string>);
        if (!live) return;
        for (const k of Object.keys(hits)) have.current.add(k);
        // MERGE, NEVER REPLACE. Work started the moment the listing landed, so this round trip can
        // arrive AFTER some pictures are already in — replacing would throw those away and make
        // them generate a second time. Session entries win.
        setCached((c) => ({ ...hits, ...c }));
        if (TRACE) {
          console.info(
            `[scan-notes] thumb cache batch ${i / CACHE_BATCH + 1}: ${Object.keys(hits).length} hit of ${slice.length} asked ` +
              `(${cacheable.length} in folder)`
          );
        }
      }
      if (!live) return;

      // ---- THE VIDEO LANE. Registered from the LISTING, not from a mounted tile: that is the
      // rehoming this phase is named for. A dead file (recorded `permanent`) is not registered at
      // all — it has already proved on this machine that it cannot be decoded, and spending a
      // decoder plus ten seconds of ceiling to learn that again is the whole point of the log.
      for (const p of videos) {
        if (have.current.has(p) || dead[p]?.reason === "permanent") continue;
        queue.register(p, () => setBench((b) => (b.includes(p) ? b : [...b, p])), () => undefined);
      }

      // ---- THE STILL LANE. Standard photographs, then RAW, and whatever the user is looking at
      // ahead of both. STILL_CONCURRENCY walkers share one cursor, so a slow file holds up nothing
      // but its own walker.
      const standard = list.filter((i) => i.kind === "image" && !i.raw).map((i) => i.path);
      const raws = list.filter((i) => i.kind === "image" && i.raw).map((i) => i.path);
      const lane = [...standard, ...raws];
      const inLane = new Set(lane);
      let cursor = 0;
      const nextPath = (): string | null => {
        // THE QUEUE-JUMP, and it is one loop rather than a second queue. A tile mounting is the only
        // thing that puts a path here, so this is by definition what is on screen right now.
        for (const u of urgent.current) {
          urgent.current.delete(u);
          if (inLane.has(u) && !have.current.has(u)) return u;
        }
        while (cursor < lane.length) {
          const p = lane[cursor++];
          if (!have.current.has(p)) return p;
        }
        return null;
      };
      const walk = async (): Promise<void> => {
        for (;;) {
          if (!live) return;
          const p = nextPath();
          if (p === null) return;
          have.current.add(p); // claimed before the await, so two walkers can never take the same file
          const r = await window.api.scan.notes.stillThumb(p, token).catch(() => null);
          if (!live) return;
          if (r === null) { setStillErr((e) => ({ ...e, [p]: "Could not read that file just now." })); continue; }
          if (r.ok && r.dataUrl) { onCached(p, r.dataUrl); continue; }
          // A CANCELLED JOB IS NOT A FAILURE AND MUST NOT PAINT ONE. The folder moved on while this
          // was in flight. Showing "could not read that file" would be the app apologising for
          // doing the right thing.
          if (r.cancelled) return;
          setStillErr((e) => ({ ...e, [p]: r.error ?? "Could not read that file." }));
        }
      };
      await Promise.all(Array.from({ length: STILL_CONCURRENCY }, walk));
      if (live && TRACE) console.info(`[scan-notes] still warm-up finished — ${lane.length} in folder`);
    })();

    // ON THE WAY OUT TOO, and this is the case the `live` flags never covered: leaving Scan Notes
    // entirely, or closing the window, left a folder's worth of decodes running to completion for a
    // grid that no longer exists. Bumping the token on unmount abandons them.
    return () => { live = false; void window.api.scan.notes.jobToken().catch(() => undefined); };
  }, [folderPath, queue, onCached]);

  const close = useCallback(() => setOpen(null), []);

  /**
   * THE RAW FILTER — a DERIVED list, deliberately not a second fetch. Filtering here rather than
   * re-listing is what makes the toggle instant and leaves the thumbnail cache untouched: a RAW that
   * was already extracted paints from cache the moment it is switched back on, because nothing was
   * ever thrown away. Since the warm-up covers the whole folder, that is now true of every RAW in it
   * rather than only the ones that had been scrolled past.
   */
  const shownItems = useMemo(() => (showRaw ? items : items.filter((i) => !i.raw)), [items, showRaw]);
  const hiddenRaw = items.length - shownItems.length;

  /** Does this file want a picture at all? Audio never does, and neither does a video with no
   *  stream. Counting those would give a denominator that can never be reached. */
  const wantsPic = useCallback(
    (i: ScanMediaItem) => i.kind === "image" || (i.kind === "video" && i.streamUrl !== null),
    []
  );
  const isDone = useCallback(
    (p: string) => cached[p] !== undefined || failedNow[p] !== undefined || stillErr[p] !== undefined,
    [cached, failedNow, stillErr]
  );

  // ---------------------------------------------------------------- the warm-up chips
  //
  // COUNTED, NEVER ESTIMATED. `done` is files that have a picture or have genuinely failed, so the
  // figure can lag the drive and can never lead it — which is the odometer rule, and the reason a
  // percentage-of-elapsed-time bar was never on the table.
  const warm = useMemo<WarmProgress | null>(() => {
    const photos = items.filter((i) => i.kind === "image" && !i.raw);
    const raw = items.filter((i) => i.kind === "image" && i.raw);
    if (photos.length === 0 && raw.length === 0) return null;
    return {
      photos: { done: photos.filter((i) => isDone(i.path)).length, total: photos.length },
      raw: { done: raw.filter((i) => isDone(i.path)).length, total: raw.length },
    };
  }, [items, isDone]);

  /* HANDED UP ON A TIMER, NOT ON EVERY THUMBNAIL. The chips are drawn by ScanModule, so each report
     re-renders the whole Scan surface — four hundred of those during a warm-up would be four hundred
     renders of an 800-folder tree. The reported figures are compared before being sent, so a settled
     folder costs nothing at all. */
  const warmRef = useRef<WarmProgress | null>(warm);
  warmRef.current = warm;
  useEffect(() => {
    if (!onWarm) return;
    let last = "";
    const push = (): void => {
      const w = warmRef.current;
      const key = w === null ? "" : `${w.photos.done}/${w.photos.total}/${w.raw.done}/${w.raw.total}`;
      if (key === last) return;
      last = key;
      onWarm(w);
    };
    push();
    const id = setInterval(push, WARM_REPORT_MS);
    return () => { clearInterval(id); onWarm(null); };
  }, [onWarm]);

  /* WHAT IS STILL COMING, for the media pane's own header line. Every file on the wall that wants a
     picture counts — which is honest now that every one of them is genuinely queued. */
  const inBatch = shownItems.filter(wantsPic);
  const total = inBatch.length;
  const doneCount = inBatch.filter((i) => isDone(i.path)).length;
  const pending = total - doneCount;

  /* Reported from an effect on PRIMITIVES, never from render: calling the parent's setState during
     render is what turns a progress readout into an infinite loop. Null the moment nothing is in
     flight, so the header clears itself. */
  useEffect(() => {
    onProgress?.(pending > 0 ? { done: doneCount, total } : null);
  }, [onProgress, pending, doneCount, total]);
  useEffect(() => () => onProgress?.(null), [onProgress]);

  useEffect(() => { onHiddenRaw?.(hiddenRaw); }, [onHiddenRaw, hiddenRaw]);
  useEffect(() => () => onHiddenRaw?.(0), [onHiddenRaw]);

  // ---------------------------------------------------------------- the window
  //
  // ONLY WHAT IS ON SCREEN EXISTS AS AN ELEMENT, and the numbers that decide which rows those are
  // come from MEASURING the wall, never from assuming it. The pane is a three-column grid at 1440
  // and a different count at 740, the rail collapses, and `auto-fill` re-flows on every one of
  // those — so the column count is read out of the grid's own resolved `grid-template-columns` and
  // the row height out of a real tile.
  //
  // IT FAILS OPEN. Until those measurements exist, or if they ever come back nonsense, `end` is the
  // whole list and the wall renders complete — heavier, never short. A windowed grid that drops the
  // tail is the 250-tile defect wearing a new coat, and it is invisible by nature, so the failure
  // direction is the one design decision here that is not negotiable.
  const gridRef = useRef<HTMLDivElement | null>(null);
  const scroller = useRef<HTMLElement | null>(null);
  const [geo, setGeo] = useState({ cols: 0, rowH: 0, gap: 0, gridTop: 0, viewH: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  /** Set only if a grid WITH tiles in it refused to yield a column count or a row height. It is the
   *  escape hatch that keeps the fail-open promise honest: without it, the pre-measurement slice
   *  below would be a permanent silent truncation on any machine where the measurement broke. */
  const [unmeasurable, setUnmeasurable] = useState(false);

  const measure = useCallback(() => {
    const g = gridRef.current;
    const s = scroller.current;
    if (!g || !s) return;
    const cs = getComputedStyle(g);
    // `grid-template-columns` resolves to a list of used pixel values, one per column — this IS the
    // measured count, whatever auto-fill decided at this width with this rail state.
    const cols = cs.gridTemplateColumns.split(" ").filter((t) => t !== "").length;
    const gap = Number.parseFloat(cs.rowGap) || 0;
    const tile = g.querySelector(".scannotes-tile") as HTMLElement | null;
    const rowH = tile ? tile.offsetHeight + gap : 0;
    // Exact, and immune to whatever the offsetParent chain happens to be: the grid's top in the
    // scroller's own content coordinates.
    const gridTop = g.getBoundingClientRect().top - s.getBoundingClientRect().top + s.scrollTop;
    if (tile !== null && (cols === 0 || rowH === 0)) setUnmeasurable(true);
    setGeo((p) =>
      p.cols === cols && p.rowH === rowH && p.gap === gap && p.gridTop === gridTop && p.viewH === s.clientHeight
        ? p
        : { cols, rowH, gap, gridTop, viewH: s.clientHeight }
    );
  }, []);

  /* The scroller belongs to ScanNotesTab, so it is found rather than owned. If it is ever not found
     the wall simply does not window — complete and heavier, which is the safe direction. */
  useEffect(() => {
    if (!active || host === null) { scroller.current = null; return; }
    const s = (host.closest(".scannotes-mscroll") as HTMLElement | null) ?? host;
    scroller.current = s;
    let raf = 0;
    const onScroll = (): void => {
      if (raf !== 0) return;
      // rAF-coalesced: a scroll fires far faster than a frame, and one setState per event would
      // re-render the wall dozens of times between paints for no visible difference.
      raf = requestAnimationFrame(() => { raf = 0; setScrollTop(s.scrollTop); });
    };
    s.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(s);
    if (gridRef.current) ro.observe(gridRef.current);
    measure();
    setScrollTop(s.scrollTop);
    return () => {
      if (raf !== 0) cancelAnimationFrame(raf);
      s.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [active, host, measure]);

  /* A tile has to exist before its height can be read, so the first measurement happens on the
     commit that created it — a LAYOUT effect, so the corrected window is in place before the
     browser paints and the slice above is never something the user sees. It re-runs whenever the
     list changes size, because the trunc line appearing above the grid moves `gridTop`. */
  useLayoutEffect(() => { measure(); }, [measure, shownItems.length, active, host]);

  /* A NEW FOLDER STARTS AT THE TOP. Without this the scroller keeps the previous folder's offset,
     which on a shorter folder is silently clamped to somewhere in the middle of it. */
  useEffect(() => {
    const s = scroller.current;
    if (s) { s.scrollTop = 0; setScrollTop(0); }
  }, [folderPath]);

  /* THE FOUR NUMBERS THAT DECIDE WHAT EXISTS, computed by a pure function that has no React and no
     DOM in it and checks itself under DIAG — see mediaWindow.ts. It fails open by construction:
     any measurement it cannot use returns the whole list. */
  const win = computeWindow({
    count: shownItems.length,
    cols: geo.cols,
    rowH: geo.rowH,
    gap: geo.gap,
    gridTop: geo.gridTop,
    viewH: geo.viewH,
    scrollTop,
    overscan: OVERSCAN_ROWS,
  });
  const { start, padTop, padBottom, windowed } = win;
  const cols = geo.cols > 0 ? geo.cols : 1;
  /* BEFORE THE FIRST MEASUREMENT there is no grid to measure, and a row height cannot be read from
     tiles that do not exist yet. Rendering the whole folder for that one frame would cost exactly
     the 2,500-element commit this phase removes, so the first pass renders a slice big enough to
     fill any reachable viewport and the measurement corrects it on the same commit. If the
     measurement ever comes back nonsense the slice is abandoned and the wall renders complete —
     heavier is a performance problem, short is a correctness one. */
  const end = windowed
    ? win.end
    : unmeasurable
      ? shownItems.length
      : Math.min(shownItems.length, PROBE_SLICE);

  /** The first item on screen, kept current so the RAW toggle can put it back where it was. */
  const anchor = useRef<string | null>(null);
  /** Position in the FULL list, which is what survives a filter change. */
  const fullIndex = useMemo(() => {
    const m = new Map<string, number>();
    items.forEach((i, n) => m.set(i.path, n));
    return m;
  }, [items]);

  /* NOTHING JUMPS WHEN THE FILTER FLIPS. Turning RAW off can halve the wall's height, and a browser
     that finds its scroll offset past the new bottom silently clamps it — so the user lands
     somewhere they never chose, and turning RAW back on does not undo it. The file that was at the
     top of the screen is put back at the top of the screen instead. It runs BEFORE the effect that
     refreshes the anchor, deliberately: on this render `anchor` still holds the pre-toggle file. */
  const firstShowRaw = useRef(true);
  useEffect(() => {
    if (firstShowRaw.current) { firstShowRaw.current = false; return; }
    const s = scroller.current;
    const a = anchor.current;
    if (!s || a === null || !windowed) return;
    const want = fullIndex.get(a) ?? 0;
    // The anchor itself may be a RAW that has just been hidden — in which case the nearest thing to
    // "where you were" is the first surviving file at or after it.
    let idx = shownItems.findIndex((i) => (fullIndex.get(i.path) ?? 0) >= want);
    if (idx < 0) idx = Math.max(0, shownItems.length - 1);
    s.scrollTop = Math.max(0, geo.gridTop + Math.floor(idx / cols) * geo.rowH);
    setScrollTop(s.scrollTop);
  }, [showRaw]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    anchor.current = shownItems[start]?.path ?? null;
  }, [shownItems, start]);

  // THE OPEN ITEM AS A POSITION. Matched on the absolute PATH rather than on object identity, so a
  // listing replaced underneath an open viewer still finds its file; -1 means it genuinely is not in
  // this folder any more, and the viewer renders nothing rather than the wrong file.
  const openIndex = open === null ? -1 : shownItems.findIndex((i) => i.path === open.path);

  const wall =
    folderPath === null ? (
      <div className="scannotes-empty">Pick a folder on the left.</div>
    ) : items.length === 0 ? (
      <div className="scannotes-empty">No media recorded in this folder. Scan it and the files appear here.</div>
    ) : shownItems.length === 0 ? (
      // A RAW-ONLY SHOOT WITH THE TOGGLE OFF. The folder is not empty and must not claim to be.
      <div className="scannotes-empty">
        Every file in this folder is a RAW. Turn on <strong>Show RAW files</strong> above to see
        {hiddenRaw === 1 ? " it." : ` all ${hiddenRaw.toLocaleString()} of them.`}
      </div>
    ) : (
      <>
        {/* NOTHING MAY TRUNCATE SILENTLY. A wall of 250 tiles looks exactly like a complete one,
            which is how 165 missing photographs stayed invisible. The sanity bound should never fire
            on a real archive — but if it ever does, the count is on screen rather than left for the
            user to discover by counting. Deliberately ABOVE the grid: a notice under 20,000 tiles is
            not a notice. */}
        {rowTotal > items.length && (
          <div className="scannotes-truncline">
            Showing {items.length.toLocaleString()} of {rowTotal.toLocaleString()} files in this folder.
          </div>
        )}
        <div className="scannotes-mediagrid" ref={gridRef}>
          {padTop > 0 && <div className="scannotes-vpad" style={{ height: padTop }} />}
          {shownItems.slice(start, end).map((i) => (
            <Tile
              key={i.path}
              item={i}
              pic={cached[i.path] ?? null}
              failReason={failedNow[i.path] ?? failures[i.path]?.reason ?? null}
              readErr={stillErr[i.path] ?? null}
              onSeen={onSeen}
              onOpen={setOpen}
            />
          ))}
          {padBottom > 0 && <div className="scannotes-vpad" style={{ height: padBottom }} />}
        </div>

        {/* ONE QUIET LINE, and only once the folder has settled. It sits BELOW the grid and is
            conditional on a count, so it can never reflow the tiles while they are still working. */}
        {settled && failedPaths.length > 0 && (
          <div className="scannotes-failline">
            <span>
              {failedPaths.length} file{failedPaths.length === 1 ? "" : "s"} couldn&rsquo;t be previewed.
            </span>
            <button type="button" className="scannotes-failretry" onClick={retryAll}>
              Retry
            </button>
          </div>
        )}
      </>
    );

  return (
    <>
      {/* THE BENCH. Off-screen, at tile size, and present whether or not the wall is — a folder
          warms while its report is being read. It is never longer than the queue's own concurrency,
          so this is at most a handful of decoders at any moment however large the folder. */}
      <div className="scannotes-bench" aria-hidden="true">
        {bench.map((p) => {
          const s = streams.get(p);
          return s ? <BenchSlot key={p} path={p} src={s} onDone={benchDone} /> : null;
        })}
      </div>

      {active && host !== null ? createPortal(wall, host) : null}

      {/* THE VIEWER. It owns its own scrim, its own keyboard, and its own copy of whatever it is
          showing — this file hands it the folder, the position, and the thumbnail cache it has
          ALREADY fetched. That last prop is the load-bearing one: the reel renders out of this map
          and never starts a decode of its own. */}
      {active && openIndex >= 0 && (
        <MediaViewer
          items={shownItems}
          index={openIndex}
          onClose={close}
          onIndexChange={(i) => setOpen(shownItems[i] ?? null)}
          cached={cached}
        />
      )}
    </>
  );
}
