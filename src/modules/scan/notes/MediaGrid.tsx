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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScanMediaItem, ScanThumbFailReason, ScanThumbFailure } from "../../../shared/types";
import MediaViewer from "./MediaViewer";
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
 * How many tiles may hold a decoded frame at once — but read THE MEMORY POSITION below, because this
 * is a floor on the bound and not the bound itself. Eviction yields to what is on screen, so the
 * real cap is `max(PAINTED_CEILING, tiles currently visible)`. At the 1920-by-1080 profile that
 * visible set is about eight columns by eight rows once the observer's 200-pixel margin is counted,
 * so the worst case is roughly seventy live elements rather than forty-six — and it is only
 * reachable at all when frame capture is unavailable and tiles cannot become plain images.
 */
const PAINTED_CEILING = 40;

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
void window.api.diag?.enabled().then((e) => { TRACE = e === true; }).catch(() => undefined);

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
 * The pending list is in document order and nothing is ever refused entry: every video tile in the
 * folder registers at mount and the whole folder warms in the background whether it is scrolled to
 * or not. Crossing the viewport is a PRIORITY signal that jumps the line — never the door.
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
  /** key → the tick it was last on screen. Insertion order is not enough: eviction has to follow the
   *  eye, not the order the loads happened to finish in. */
  private readonly painted = new Map<string, number>();
  /** Keys the IntersectionObserver currently reports as intersecting — which is the viewport PLUS
   *  its 200-pixel rootMargin, so roughly a row and a half beyond each edge, not the screen exactly.
   *  Eviction consults this and nothing else can override it: a tile the user is looking at is never
   *  taken away, however long it has been sitting there. */
  private readonly visible = new Set<string>();
  private order: string[] = [];
  private urgent: string[] = [];
  private cancelled = false;
  private tick = 0;
  readonly counts = { queued: 0, started: 0, painted: 0, failed: 0, gone: 0, evicted: 0, noframe: 0 };
  /** The retry pass's own tally, written by MediaGrid — the classification lives up there, with the
   *  media element's error, and this object exists so ONE line tells the whole story of a run.
   *  `recovered` is the number that matters: it is the entire justification for the retry. */
  readonly retry = { retried: 0, recovered: 0, gaveUp: 0, permanent: 0, unknown: 0 };
  /** Fired when the last slot empties with nothing waiting. This is the retry's trigger, and it is
   *  deliberately the SAME drain the summary line already used rather than a second notion of
   *  "finished" — a retry that could interleave with first attempts would spend a slot on a file
   *  nobody is looking at while a tile on screen waits. */
  onIdle: (() => void) | null = null;

  /** Called by every video tile at mount, in document order. This IS the background walk. */
  register(key: string, start: () => void, drop: () => void): void {
    // Deliberately NOT gated on `cancelled` — see open(). Work that arrives while the queue is closed
    // is remembered and starts when it reopens; pump() is the one and only gate on starting.
    this.starters.set(key, start);
    this.drops.set(key, drop);
    this.enqueue(key, false);
  }

  /**
   * On screen, or no longer on screen.
   *
   * THIS EXISTS BECAUSE "least recently seen" WAS A LIE WITHOUT IT. `tick` only advanced when a tile
   * crossed the viewport or settled, so on a folder the user opens and does not scroll, no tick ever
   * advances again and the "oldest" tile is simply the first one that finished — the top of the
   * folder, in plain sight. Eviction would then walk down the visible rows taking pictures away, and
   * they could not come back, because an IntersectionObserver does not re-fire for an element that
   * never left the viewport. Tracking visibility directly is the fix: the tick ordering decides
   * WHICH off-screen tile goes, and this decides that an on-screen one never does.
   */
  setVisible(key: string, on: boolean): void {
    if (on) { this.visible.add(key); this.seen(key); }
    else this.visible.delete(key);
  }

  /** The tile is on screen. Priority only — it can move a tile to the front of the line and it
   *  renews a painted tile's place against eviction. It never decides whether work happens. */
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
    if (how === "painted") { this.painted.set(key, ++this.tick); this.trim(); }
    else this.painted.delete(key); // failed, gone and noframe alike hold no decoder worth protecting
    this.pump();
  }

  /** The tile itself is gone. Releases first, then forgets how to restart it. */
  forget(key: string): void {
    this.release(key, "gone");
    this.starters.delete(key);
    this.drops.delete(key);
    this.visible.delete(key);
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
    const base = `queued ${c.queued} · slots taken ${c.started} · released: painted ${c.painted}, failed ${c.failed}${noframe}, unmounted ${c.gone} · evicted ${c.evicted} · still in flight ${this.inFlight.size} · still waiting ${this.pending.size}`;
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

  private trim(): void {
    // Bounded by the map's own size: every pass deletes exactly one entry, and the guard means a
    // drop callback that misbehaves cannot spin this loop.
    let guard = this.painted.size;
    while (this.painted.size > PAINTED_CEILING && guard-- > 0) {
      let oldest: string | null = null;
      let oldestTick = Infinity;
      for (const [k, t] of this.painted) {
        if (this.visible.has(k)) continue; // never take a picture off the user's screen
        if (t < oldestTick) { oldestTick = t; oldest = k; }
      }
      // Everything painted is on screen. The ceiling yields rather than blanking the viewport — a
      // viewport that large is a handful of extra decoders, and a blank tile is a defect.
      if (oldest === null) return;
      this.painted.delete(oldest);
      this.counts.evicted += 1;
      this.drops.get(oldest)?.(); // back to its glyph; `seen` re-queues it when it returns
    }
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

/** One tile. A CACHED picture short-circuits everything below — no queue slot, no decoder, no
 *  `frmedia` request. Only a cache miss is queued, and it converts to a cached <img> the moment
 *  its frame is captured. */
function Tile({ item, queue, cachedUrl, failure, retryToken, onOutcome, onOpen, onCached }: {
  item: ScanMediaItem;
  queue: ThumbQueue;
  cachedUrl: string | null;
  failure: ScanThumbFailure | null;
  /** Bumped by the grid when THIS tile is chosen for a retry round. Zero means never chosen. */
  retryToken: number;
  onOutcome: (path: string, how: "painted" | "failed", why?: ScanThumbFailReason) => void;
  /** Lifts a freshly generated thumbnail into the GRID's state so it outlives this component.
   *  Without it, hiding a tile with the RAW toggle destroys its picture and showing it again
   *  re-crosses IPC for something the session already had. */
  onCached: (path: string, dataUrl: string) => void;
  onOpen: (i: ScanMediaItem) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [granted, setGranted] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  /** Why THIS session's attempt failed, for the tooltip. Seeded from the recorded log so a file that
   *  is not attempted at all still explains itself. */
  const [failWhy, setFailWhy] = useState<ScanThumbFailReason | null>(failure?.reason ?? null);
  const box = useRef<HTMLButtonElement | null>(null);

  const stream = item.streamUrl;
  // The picture, whatever produced it: a still's data URL, a frame captured this session, or a hit
  // from the disk cache. Once there is one, this tile never needs a decoder again.
  const pic = url ?? cachedUrl;
  // A RECORDED `permanent` FAILURE MEANS DO NOT TRY. That is the entire payoff of the log: this file
  // has already proved on this machine that it cannot be decoded, so attempting it again would cost
  // a queue slot, an frmedia request, a decoder and ten seconds of ceiling to learn nothing. The
  // user's own Retry control clears the record and overrides this — the classifier may be wrong, but
  // it does not get to be wrong repeatedly and for free.
  const knownDead = failure?.reason === "permanent";
  /**
   * ONLY VIDEO EVER ENTERS THE THUMBNAIL QUEUE. The kind comes from the scanner's own extension
   * lists (electron/core/services/scan/media.ts), resolved into `kind` by mediaBrowse.ts — there is
   * no second list here and there must never be one.
   *
   * An audio file is therefore never queued, never given a slot, never handed to a <video> element
   * and never counted. Device evidence on 08-18-2026 showed an .mp3 doing all four, which by this
   * source is impossible: "mp3" is in AUDIO_EXTS and not in VIDEO_EXTS, and `kind` is recomputed
   * from the extension on every listing — so for that .mp3 to reach a <video>, its `kind` must have
   * arrived as "video".
   *
   * I could not reproduce that by reading, and did not guess at it. The one mechanism that produces
   * it is the listing's stored extension disagreeing with the file's own name, and mediaBrowse.ts
   * now names exactly that under DIAG. The `noframe` outcome above is the belt to that brace: even
   * a mis-classified audio file can no longer be recorded or counted as a failure.
   */
  const isVideo = item.kind === "video";
  const wantsVideo = isVideo && stream !== null && !videoFailed && !knownDead && pic === null;

  // THE RETRY, from the tile's side, and it is deliberately three lines. Clearing videoFailed makes
  // wantsVideo true again, which re-runs the registration effect below, which puts this tile back in
  // the queue in the ordinary lane. There is no second queue and no second code path: a retry is
  // just a tile asking again.
  useEffect(() => {
    if (retryToken === 0) return;
    setVideoFailed(false);
    setFailWhy(null);
  }, [retryToken]);

  // EVERY video tile registers here, at mount, in document order — this is the whole folder warming
  // in the background. A tile that already has its picture never registers at all, which is what
  // makes a warm folder open with no work: the queue is empty because there is nothing to do.
  // `forget` is the unmount and folder-change release path.
  useEffect(() => {
    if (!wantsVideo) return;
    const key = item.path;
    queue.register(key, () => setGranted(true), () => setGranted(false));
    return () => queue.forget(key);
  }, [queue, item.path, wantsVideo]);

  // Crossing the viewport is a priority signal for VIDEO, and it must keep firing — it also renews a
  // painted tile's place against eviction — so that observer is never disconnected. An IMAGE is
  // fetched once and held in state, so its observer is finished after the first crossing.
  //
  // Images stay in-view gated on purpose: each one crosses IPC as a base64 data URL of up to twenty
  // megabytes, so warming a whole folder of them eagerly would trade this defect for a worse one.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (item.kind !== "image" && item.kind !== "video") return; // audio never attempts a frame
    let live = true;
    const io = new IntersectionObserver(
      (entries) => {
        if (!live) return;
        const on = entries.some((e) => e.isIntersecting);
        // BOTH edges matter for video, not just entry: leaving the viewport is what makes a tile
        // eligible for eviction, and staying in it is what protects it. Reporting only entry was how
        // eviction ended up blanking rows the user was looking at.
        if (item.kind === "video") { queue.setVisible(item.path, on); return; }
        if (!on) return;
        io.disconnect();
        // THE THUMB, NOT THE IMAGE. `stillThumb` returns a ~320px JPEG of about 11 KB; `image`
        // returns the full file, which for this folder averages a 10.4 MB base64 string per tile.
        // The viewer still calls `image` — it needs the pixels this one throws away.
        void window.api.scan.notes
          .stillThumb(item.path)
          .then((r) => {
            if (!live) return;
            if (r.ok && r.dataUrl) { setUrl(r.dataUrl); onCached(item.path, r.dataUrl); }
            else setErr(r.error ?? "Could not read that file.");
          })
          // THE SECOND PLACE AN EXCEPTION BECAME USER-FACING COPY, found auditing the first. The
          // main process already answers `{ ok: false, error }` with a written sentence for every
          // failure it can name, so anything reaching here is the channel itself falling over —
          // and `e.message` for that is a stack-trace fragment, not something a photographer can
          // act on. The reason is not lost: it goes to the console, where it is of use.
          .catch((e: unknown) => {
            console.error("[scan-notes] image read failed:", item.path, e);
            if (live) setErr("Could not read that file just now.");
          });
      },
      { rootMargin: "200px" } // start a screen early so scrolling does not stutter
    );
    io.observe(el);
    return () => { live = false; io.disconnect(); };
  }, [item.path, item.kind, queue]);

  // THE SWAP THAT RELEASES THE DECODER. Setting `url` makes `pic` non-null, which makes
  // `wantsVideo` false, which unmounts <VideoThumb> and re-runs the registration effect's cleanup.
  // Tearing the element down is not a side effect here — it is the entire point of capturing.
  const onSettled = useCallback(
    (how: Settled, shot?: string, why?: ScanThumbFailReason, detail?: string) => {
      if (how === "painted" && shot !== undefined) {
        setUrl(shot);
        onCached(item.path, shot); // survives this tile being filtered out and back in
        // Fire-and-forget: the tile already has its picture, so a cache that cannot write is slow
        // next launch and broken never.
        void window.api.scan.notes.thumbsPut(item.path, shot).catch(() => undefined);
        onOutcome(item.path, "painted");
      } else if (how === "failed") {
        setVideoFailed(true);
        setFailWhy(why ?? "unknown");
        onOutcome(item.path, "failed", why ?? "unknown");
        // Same fire-and-forget discipline as the cache write above, and for a stronger reason: the
        // tile has already shown its glyph, so a log that cannot be written costs one wasted attempt
        // next launch. A log that could BREAK the grid would be the exact inversion this exists to
        // prevent, and that inversion has already happened once in this file.
        void window.api.scan.notes.thumbFailurePut(item.path, why ?? "unknown", detail ?? "").catch(() => undefined);
      } else if (how === "noframe") {
        // Stop trying — there is nothing here to capture — and record NOTHING. This tile is not
        // broken, is not counted under "couldn't be previewed", and is never retried. It falls back
        // to its own glyph, which for audio is a note and not a film reel.
        setVideoFailed(true);
        if (TRACE) {
          console.info(
            `[scan-notes] no video track (not a failure): kind=${item.kind} ${item.filename}`
          );
        }
      }
      // "shown" deliberately sets NOTHING: pic stays null and videoFailed stays false, so wantsVideo
      // stays true and the <video> stays mounted with its frame on screen. It is released to the
      // queue as painted because it is holding a live decoder — which is exactly what
      // PAINTED_CEILING governs, and why that ceiling is still here.
      queue.release(item.path, how === "failed" ? "failed" : how === "noframe" ? "noframe" : "painted");
    },
    [queue, item.path, onOutcome, onCached]
  );

  // An AUDIO file gets an audio glyph and never a film reel — it is not video and must not look it.
  const glyph = item.kind === "video" ? "🎬" : item.kind === "audio" ? "🎵" : "🖼";

  // EVERY TILE STATE THAT HAS SOMETHING TO SAY, resolved in one place and said in one place. These
  // were four separate spans appended to the caption; three of them are answers rather than the
  // file's name, and the fourth was an exception message. Ordered most specific first: a concrete
  // read failure beats the general "cannot open this format", which beats a size.
  const note =
    err !== null && err !== ""
      ? err
      : !item.viewable
        ? `This product cannot open ${item.extension ?? "this format"}${fmtBytes(item.size_bytes) ? ` — ${fmtBytes(item.size_bytes)}` : ""}.`
        : failWhy !== null && pic === null
          ? failSentence(failWhy)
          : item.embedded && url
            ? "This is the preview the camera embedded in the file."
            : null;

  return (
    <button
      ref={box}
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
          number in the interface reads as a bug that shipped anyway. No title at all when there is
          nothing to explain — the button's own path title shows through, and an empty tooltip is
          a flicker of nothing on every hover. */}
      <div className={`thumb${item.kind === "video" ? " vid" : ""}`} title={note ?? undefined}>
        {/* A DOUBLED WALL HAS TO BE READABLE AT A GLANCE. With the toggle on, a RAW and its JPEG
            sibling are the same photograph twice; the badge is what tells them apart without
            reading two filenames. Only rendered when RAW is shown, because when it is off every
            tile on the wall is a JPEG and a badge on none of them says nothing. */}
        {item.raw && <span className="raw">RAW</span>}
        {pic !== null ? (
          <img src={pic} alt="" />
        ) : granted && wantsVideo && stream !== null ? (
          <VideoThumb src={stream} onSettled={onSettled} />
        ) : (
          <span aria-hidden="true">{glyph}</span>
        )}
      </div>
      <div className="nm">{item.filename}</div>
    </button>
  );
}

export default function MediaGrid({ folderPath, showRaw, onProgress }: {
  folderPath: string | null;
  showRaw: boolean;
  /** REPORTED UP, NOT RENDERED HERE. Jason placed the loading line in the media pane HEADER row,
   *  beside the Show RAW files toggle (annotated screenshot, 08-18-2026) — and that row belongs to
   *  ScanNotesTab. Only this component knows the counts, so it hands them over and the header draws
   *  them. Null means there is nothing in flight. */
  onProgress?: (p: { done: number; total: number; raw: boolean } | null) => void;
}) {
  const [items, setItems] = useState<ScanMediaItem[]>([]);
  /** Path → cached thumbnail data URL. Fetched once per folder; a path that is absent is a miss. */
  const [cached, setCached] = useState<Record<string, string>>({});
  /** Path → the recorded failure, read once per folder open alongside the cache. A `permanent`
   *  entry stops its tile from ever mounting a decoder; the rest are informational until the retry
   *  pass reads them. */
  const [failures, setFailures] = useState<Record<string, ScanThumbFailure>>({});
  /** Failures observed THIS open, path → reason. Separate from `failures` on purpose: that one is
   *  what disk remembers, this one is what just happened, and the retry budget is spent against
   *  this one so a folder reopened an hour later gets a clean set of attempts. */
  const [failedNow, setFailedNow] = useState<Record<string, ScanThumbFailReason>>({});
  /** Attempts spent per path THIS open. A ref, not state: it is read inside the retry decision and
   *  must never drive a render. */
  const attempts = useRef(new Map<string, number>());
  /** The paths chosen for the current retry round, and the round number that arms them. */
  const [retrySet, setRetrySet] = useState<ReadonlySet<string>>(new Set());
  const [retryRound, setRetryRound] = useState(0);
  /** True once the queue has drained at least once. The line under the grid waits for it, so nothing
   *  appears while tiles are still working — it must not flash and must not move the grid. */
  const [settled, setSettled] = useState(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** WHICH ITEM IS OPEN, still held as the item itself so `onOpen` on four hundred tiles stays the
   *  plain `setOpen` it has always been. The viewer wants a POSITION — it counts, steps and reels off
   *  it — so the render block below converts between the two in one line each way. */
  const [open, setOpen] = useState<ScanMediaItem | null>(null);

  // ONE QUEUE PER FOLDER, and the old one is cancelled the moment the folder changes — a background
  // walk must never outlive the folder it was walking. `folderPath` is a reset key, not a value the
  // constructor reads; that is the whole point of the dependency.
  const queue = useMemo(() => new ThumbQueue(), [folderPath]); // eslint-disable-line react-hooks/exhaustive-deps
  // open() on every setup, not just the first: React's development double-invoke closes this queue
  // once before the component is really mounted, and without the re-open the first folder the media
  // pane is opened against would never generate a single thumbnail.
  useEffect(() => {
    queue.open();
    return () => queue.cancel();
  }, [queue]);

  /** Every video tile's verdict lands here. Stable identity — it is a dependency of every tile's
   *  onSettled, and a new function each render would re-run four hundred callbacks. */
  /**
   * A THUMBNAIL LIVES IN THE GRID, NOT IN THE TILE. This is what makes the RAW toggle a re-render
   * rather than a reload: a filtered-out tile unmounts and its local state dies with it, so before
   * this the picture was fetched again the moment it came back. Keyed by path, so React reuses the
   * tiles that did not move and the ones that did come back already holding their picture.
   *
   * BOUNDED. At roughly 11 KB a thumbnail, SESSION_THUMB_MAX is about 22 MB at worst — but "small"
   * is not "unbounded", and a session that browses forty folders would otherwise keep every tile
   * it ever saw. Oldest keys are dropped first; a dropped one is a disk-cache hit next time, not a
   * regeneration.
   */
  const onCached = useCallback((p: string, dataUrl: string) => {
    setCached((c) => {
      if (c[p] === dataUrl) return c;
      const next = { ...c, [p]: dataUrl };
      const keys = Object.keys(next);
      if (keys.length > SESSION_THUMB_MAX) for (const k of keys.slice(0, keys.length - SESSION_THUMB_MAX)) delete next[k];
      return next;
    });
  }, []);

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

  /**
   * THE RETRY ROUND. Armed by the queue draining, delayed by RETRY_BACKOFF_MS, and it re-queues only
   * what still has budget. Everything else in this function is the stopping condition, which is the
   * part that matters: a retry that cannot succeed is a treadmill, and a treadmill on a folder of
   * four hundred clips is an application that never stops working.
   */
  useEffect(() => {
    queue.onIdle = () => {
      setSettled(true);
      if (retryTimer.current !== null) return; // a round is already armed; draining again changes nothing
      retryTimer.current = setTimeout(() => {
        retryTimer.current = null;
        setFailedNow((current) => {
          const entries = Object.entries(current);
          const due = entries.filter(([p, r]) => (attempts.current.get(p) ?? 0) < ATTEMPT_BUDGET[r]);
          // The tally is SET rather than accumulated: it describes the folder as it stands, so a
          // second drain does not double-count what the first one already reported.
          queue.retry.gaveUp = entries.length - due.length;
          queue.retry.permanent = entries.filter(([, r]) => r === "permanent").length;
          queue.retry.unknown = entries.filter(([, r]) => r === "unknown").length;
          if (due.length > 0) {
            queue.retry.retried += due.length;
            setRetrySet(new Set(due.map(([p]) => p)));
            setRetryRound((n) => n + 1);
          }
          return current; // read-only use of the setter — nothing about the failure map changes here
        });
      }, RETRY_BACKOFF_MS);
    };
    // CANCELLED WITH THE FOLDER, exactly as the first pass is. A retry that outlived its folder would
    // burn slots on files that have already unmounted, and the new folder would pay for it.
    return () => {
      queue.onIdle = null;
      if (retryTimer.current !== null) { clearTimeout(retryTimer.current); retryTimer.current = null; }
    };
  }, [queue]);

  /** Everything that could not be previewed: what failed this session, plus what disk already knows
   *  is hopeless — a `permanent` tile never attempts, so it never appears in failedNow, and leaving
   *  it out of the count would be the silent film-glyph this feature exists to end. */
  const failedPaths = useMemo(() => {
    const s = new Set(Object.keys(failedNow));
    for (const i of items) if (failures[i.path]?.reason === "permanent") s.add(i.path);
    return [...s];
  }, [failedNow, failures, items]);

  /** The human override. It clears the record for this folder — `permanent` included — and re-arms
   *  every failed tile. An explicit request outranks the classifier, which may be wrong; what it
   *  must not do is let the classifier be wrong repeatedly and for free. */
  const retryAll = useCallback(() => {
    if (failedPaths.length === 0) return;
    void window.api.scan.notes.thumbFailuresClear(failedPaths).catch(() => undefined);
    attempts.current.clear();
    queue.retry.retried += failedPaths.length;
    setFailures({});   // drops knownDead, so a permanent tile mounts a decoder again
    setFailedNow({});
    setRetrySet(new Set(failedPaths));
    setRetryRound((n) => n + 1);
  }, [failedPaths, queue]);

  // TILE NAMES FIRST, PICTURES A BEAT LATER, and deliberately in that order — the listing is one
  // cheap query and the cache read is hundreds of file reads, so painting the wall before asking for
  // thumbnails is the difference between a folder that opens and a folder that stalls.
  //
  // ONE CALL FOR THE WHOLE FOLDER, not one per tile: four hundred round trips would cost more in
  // message overhead than the reads themselves. Every hit that comes back is a tile that will never
  // create a decoder or take a queue slot.
  useEffect(() => {
    // A NEW FOLDER IS A CLEAN SLATE for everything the retry reasons about. The transient budget
    // resets here and only here — "never more than once per open" is this line.
    attempts.current.clear();
    setFailedNow({});
    setRetrySet(new Set());
    setSettled(false);
    if (!folderPath) { setItems([]); setCached({}); setFailures({}); return; }
    let live = true;
    // NOT cleared here. Clearing it while the item list still held the OUTGOING folder made every one of
    // that folder's cached tiles lose their picture for a beat — so they flashed from a
    // picture to the film-reel glyph and started decoding themselves into the new folder's queue,
    // burning slots on files that were about to unmount. The map is replaced when the new listing
    // lands, and keys are absolute paths, so a stale entry can never match the wrong file.
    void window.api.scan.notes
      .media(folderPath)
      .then((list) => {
        if (!live) return;
        setItems(list);
        const videos = list.filter((i) => i.kind === "video" && i.streamUrl !== null).map((i) => i.path);
        // STILLS ARE IN THE BATCH NOW. They were excluded because a still's cached form used to be
        // the whole file — hundreds of multi-megabyte data URLs on one round trip. A thumbnail is
        // about 11 KB, so a warm folder of four hundred stills is roughly 4 MB and ONE call, and
        // every tile paints with no IPC of its own and no decode at all.
        const cacheable = list.filter((i) => i.kind === "image" || (i.kind === "video" && i.streamUrl !== null)).map((i) => i.path);
        if (cacheable.length === 0) { setCached({}); setFailures({}); return; }
        // THE FAILURE LOG, read alongside the cache and never chained into it. Two independent
        // round trips with independent catches: neither is allowed to decide whether the other
        // happened, and neither is allowed to decide whether the LISTING happened. The tiles are
        // already on screen by now.
        void window.api.scan.notes
          .thumbFailuresGet(videos)
          .then((rec) => { if (live) setFailures(rec); })
          .catch(() => undefined); // no record is the same as no failures — every tile attempts
        // CAUGHT HERE, NOT DOWNSTREAM. Returning this promise into the outer chain meant a rejected
        // CACHE read landed in the catch below and called setItems([]) — so a folder full of media
        // rendered "No media recorded in this folder." because a thumbnail lookup failed. A cache is
        // never allowed to decide whether the listing exists.
        void window.api.scan.notes
          .thumbsGet(cacheable)
          .then((hits) => {
            if (!live) return;
            // MERGE, NEVER REPLACE. Tiles start generating the moment they scroll into view, so
            // this round trip can land AFTER some have already reported theirs — and replacing
            // would throw those away and make them generate a second time. Session entries win.
            setCached((c) => ({ ...hits, ...c }));
            if (TRACE) {
              const n = Object.keys(hits).length;
              console.info(`[scan-notes] thumb cache: ${n} hit, ${videos.length - n} to generate, of ${videos.length} clips`);
            }
          })
          .catch(() => undefined); // a miss for every tile; they generate as usual
      })
      .catch(() => { if (live) { setItems([]); setCached({}); setFailures({}); } });
    return () => { live = false; };
  }, [folderPath]);

  // THE STILL FETCH AND THE ESCAPE KEY BOTH MOVED INTO MediaViewer, and neither is duplicated here:
  // the viewer steps between files on its own, so a copy of the image held in the GRID would be the
  // wrong file the moment the user pressed Next, and a second window-level keydown listener would
  // mean two handlers racing for one Escape.
  const close = useCallback(() => setOpen(null), []);

  /**
   * THE RAW FILTER — a DERIVED list, deliberately not a second fetch.
   *
   * `items` holds the whole folder; this is what the wall actually renders. Filtering here rather
   * than re-listing is what makes the toggle instant and leaves the thumbnail cache untouched: a
   * RAW that was already extracted paints from cache the moment it is switched back on, because
   * nothing was ever thrown away.
   *
   * IT IS ALSO WHERE THE COST GENUINELY DISAPPEARS, not merely where it is hidden. A still costs
   * nothing until its Tile mounts and its IntersectionObserver fires the `image` call — no Tile,
   * no observer, no IPC round trip, no preview extraction, no cache lookup. A filtered-out RAW
   * never becomes an element, so the expensive half of a RAW-plus-JPEG folder is never asked for.
   */
  // WHAT IS STILL COMING. A tile is "done" once the grid holds its picture or it has failed; the
  // denominator is every tile on the wall that needs one. Stills get the same treatment as RAW,
  // because a cold folder of JPEGs takes just as long and deserves the same honesty.
  const shownItems = showRaw ? items : items.filter((i) => !i.raw);
  const hiddenRaw = items.length - shownItems.length;
  /* Nothing vanishes silently — the same voice as the hidden-folders line in the tree. Rendered
     only when something IS hidden; a folder with no RAW gets no line and no explanation it does
     not need. */
  const needsPicture = shownItems.filter((i) => i.kind === "image" || i.kind === "video");
  const doneCount = needsPicture.filter((i) => cached[i.path] !== undefined || failedNow[i.path] !== undefined).length;
  const total = needsPicture.length;
  const pending = total - doneCount;
  const rawInFlight = showRaw && needsPicture.some((i) => i.raw);

  /* HANDED UP FOR THE HEADER TO DRAW. Reported from an effect on PRIMITIVES, never from render:
     calling the parent's setState during render is what turns a progress readout into an infinite
     loop. Null the moment nothing is in flight, so the header clears itself. */
  useEffect(() => {
    onProgress?.(pending > 0 ? { done: doneCount, total, raw: rawInFlight } : null);
  }, [onProgress, pending, doneCount, total, rawInFlight]);

  /* On unmount — leaving media mode, or changing tab — the header must not keep a stale line. */
  useEffect(() => () => onProgress?.(null), [onProgress]);

  const hiddenLine =
    hiddenRaw > 0 ? (
      <div className="scannotes-rawhidden">
        {hiddenRaw === 1 ? "1 RAW file hidden." : `${hiddenRaw.toLocaleString()} RAW files hidden.`}
      </div>
    ) : null;

  if (!folderPath) return <div className="scannotes-empty">Pick a folder on the left.</div>;
  if (items.length === 0) {
    return <div className="scannotes-empty">No media recorded in this folder. Scan it and the files appear here.</div>;
  }
  // A RAW-ONLY SHOOT WITH THE TOGGLE OFF. The folder is not empty and must not claim to be — the
  // count line is the whole trace of what is here, so it says so in full rather than leaving the
  // user staring at a blank wall wondering whether the scan failed.
  if (shownItems.length === 0) {
    return (
      <div className="scannotes-empty">
        Every file in this folder is a RAW. Turn on <strong>Show RAW files</strong> above to see
        {hiddenRaw === 1 ? " it." : ` all ${hiddenRaw.toLocaleString()} of them.`}
      </div>
    );
  }

  // THE OPEN ITEM AS A POSITION. Matched on the absolute PATH rather than on object identity, so a
  // listing replaced underneath an open viewer still finds its file; -1 means it genuinely is not in
  // this folder any more, and the viewer renders nothing rather than the wrong file.
  // Indexed into the SHOWN list, not the full one, so Next and Previous in the viewer step through
  // exactly what the wall is showing. Stepping into a tile the user cannot see would be a viewer
  // that disagrees with the grid behind it.
  const openIndex = open === null ? -1 : shownItems.findIndex((i) => i.path === open.path);

  return (
    <>
      {hiddenLine}
      <div className="scannotes-mediagrid">
        {shownItems.map((i) => (
          <Tile
            key={i.path}
            item={i}
            queue={queue}
            cachedUrl={cached[i.path] ?? null}
            failure={failures[i.path] ?? null}
            retryToken={retrySet.has(i.path) ? retryRound : 0}
            onOutcome={onOutcome}
            onCached={onCached}
            onOpen={setOpen}
          />
        ))}
      </div>

      {/* ONE QUIET LINE, and only once the folder has settled. It sits BELOW the grid and is
          conditional on a count, so it can never reflow the tiles while they are still working —
          nothing flashes and nothing pops. */}
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

      {/* THE VIEWER. It owns its own scrim (data-modal-backdrop and all), its own keyboard, and its
          own copy of whatever it is showing — this file hands it the folder, the position, and the
          thumbnail cache it has ALREADY fetched. That last prop is the load-bearing one: the reel
          renders out of this map and never starts a decode of its own, so the pipeline above stays
          the only thing in this module that makes a thumbnail. */}
      {openIndex >= 0 && (
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
