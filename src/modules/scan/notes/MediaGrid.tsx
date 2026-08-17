/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// The media grid — browsing the archive, never touching it. Built to the mockups: a tile wall, a
// lightbox for stills, and a player modal whose transport lives in its FOOTER for both media
// classes (MOCKUP-frmedia-player-route-08-17-2026.html).
//
// HOW A VIDEO TILE GETS ITS PICTURE, and why the first two attempts did not.
//
// Attempt one drew a frame to a <canvas> from a DETACHED video element — `document.createElement`,
// never inserted. Two independent faults, either of which alone is fatal:
//   · an element outside the render tree is not guaranteed to decode a frame at all, and
//   · `frmedia:` is a DISTINCT ORIGIN from the app, so the canvas taints the moment that frame is
//     drawn and `toDataURL()` throws SecurityError. The throw landed in a catch that returned "no
//     poster", so the failure was completely silent — which is exactly what it looked like on
//     device: stills fine, video tiles blank, nothing in the log.
// Un-tainting would mean adding Access-Control-Allow-Origin to our own scheme and marking the
// element crossOrigin — a real widening of the scheme's surface for a thumbnail. Not worth it.
//
// What is here instead needs no canvas and no capture: a REAL <video> in the tile, in the render
// tree, at the tile's real size, with the media fragment `#t=` telling Chromium which frame to
// paint. The element IS the thumbnail. No origin is crossed, nothing is captured, nothing is stored.
//
// NOTHING IS WRITTEN TO DISK, in either media class. §4.1's blanket thumbnail ban is CLAUDE.md's own
// text and Jason overruled it for this view on 08-17-2026 ("claude banned them not me"); what the
// rule actually protects — no artefact left beside a photographer's footage — is intact either way.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScanMediaItem } from "../../../shared/types";
import MediaTransport from "./MediaTransport";
import "./scannotes.css";

/** Split at the LAST dot so the extension can be pinned past the stem's ellipsis. A name with no dot
 *  is all stem — there is nothing to protect. */
const lastDot = (s: string): number => (s.lastIndexOf(".") > 0 ? s.lastIndexOf(".") : s.length);
const stemOf = (s: string): string => s.slice(0, lastDot(s));
const extOf = (s: string): string => s.slice(lastDot(s));

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

/** How many tiles may hold a decoded frame at once — see THE MEMORY POSITION below. */
const PAINTED_CEILING = 40;

type Outcome = "painted" | "failed" | "gone";

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
 * THE MEMORY POSITION, stated outright, because an unstated one is how this ends at four gigabytes.
 * A painted tile is a live <video> holding a decoder plus one decoded frame, and a decoded frame
 * costs at the SOURCE resolution, not the tile's: roughly three megabytes for 1080p and twelve for
 * 4K in YUV420. Five hundred of them is therefore one and a half to six gigabytes, and Chromium
 * separately caps how many media players one renderer may hold — past that cap loads simply fail.
 * So no: five hundred painted videos is NOT safe, and a ceiling is not optional. Forty is the
 * number — about 480 MB worst case at 4K, and roughly two to three screens of tiles, so scrolling
 * back a screen still finds its frames. Past forty, the least-recently-SEEN painted tile drops back
 * to its glyph and re-warms when it returns to the viewport.
 */
class ThumbQueue {
  private readonly starters = new Map<string, () => void>();
  private readonly drops = new Map<string, () => void>();
  private readonly pending = new Set<string>();
  private readonly inFlight = new Set<string>();
  /** key → the tick it was last on screen. Insertion order is not enough: eviction has to follow the
   *  eye, not the order the loads happened to finish in. */
  private readonly painted = new Map<string, number>();
  private order: string[] = [];
  private urgent: string[] = [];
  private cancelled = false;
  private tick = 0;
  readonly counts = { queued: 0, started: 0, painted: 0, failed: 0, gone: 0, evicted: 0 };

  /** Called by every video tile at mount, in document order. This IS the background walk. */
  register(key: string, start: () => void, drop: () => void): void {
    if (this.cancelled) return;
    this.starters.set(key, start);
    this.drops.set(key, drop);
    this.enqueue(key, false);
  }

  /** The tile is on screen. Priority only — it can move a tile to the front of the line and it
   *  renews a painted tile's place against eviction. It never decides whether work happens. */
  seen(key: string): void {
    if (this.cancelled) return;
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
    else this.painted.delete(key);
    this.pump();
  }

  /** The tile itself is gone. Releases first, then forgets how to restart it. */
  forget(key: string): void {
    this.release(key, "gone");
    this.starters.delete(key);
    this.drops.delete(key);
  }

  cancel(): void {
    if (TRACE) console.info("[scan-notes] thumb queue closed —", this.summary());
    this.cancelled = true;
    this.starters.clear(); this.drops.clear(); this.painted.clear();
    this.pending.clear(); this.inFlight.clear();
    this.order = []; this.urgent = [];
  }

  summary(): string {
    const c = this.counts;
    return `queued ${c.queued} · slots taken ${c.started} · released: painted ${c.painted}, failed ${c.failed}, unmounted ${c.gone} · evicted ${c.evicted} · still in flight ${this.inFlight.size} · still waiting ${this.pending.size}`;
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
    while (this.painted.size > PAINTED_CEILING) {
      let oldest: string | null = null;
      let oldestTick = Infinity;
      for (const [k, t] of this.painted) if (t < oldestTick) { oldestTick = t; oldest = k; }
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
    if (TRACE && this.counts.started > 0 && this.inFlight.size === 0 && this.pending.size === 0) {
      console.info("[scan-notes] thumb queue idle —", this.summary());
    }
  }
}

/**
 * THE TILE'S PICTURE IS THE VIDEO ELEMENT ITSELF, paused on one frame.
 *
 * The six traps this is written against, in order:
 *  1. A seek IS issued — the `#t=` media fragment asks for one before any script runs, and the
 *     explicit seek below is the belt to its braces.
 *  2. The explicit seek sits in `loadedmetadata` AND runs immediately when `readyState >= 1`,
 *     because the event can fire before React attaches the listener.
 *  3. The element is IN THE RENDER TREE at the tile's real size. This is the one the previous
 *     attempt broke: a detached element decodes nothing reliably.
 *  4. The target is `min(1, duration * 0.1)`, never 0 (black on most camera files) and never past
 *     the end. `NaN`/`Infinity` duration — routine on variable-frame-rate phone footage — falls back
 *     to one second.
 *  5. A codec Chromium cannot decode fires `error`, and the tile falls back to its glyph.
 *  6. `muted` and `playsInline` are set; without them some paths refuse to load media at all.
 *
 * AND IT NEVER SPINS FOREVER: no frame within FRAME_CEILING_MS is a failure like any other, because
 * a container that stalls without erroring is exactly how a wall of tiles ends up hanging.
 *
 * IT DOES NOT TOUCH THE QUEUE. It mounts only once the queue has already granted its slot, and it
 * reports the outcome upward; the tile owns registration and release, so there is exactly one place
 * a slot can be taken and one place it can be given back.
 */
function VideoThumb({ src, onSettled }: { src: string; onSettled: (how: "painted" | "failed") => void }) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const settle = (how: "painted" | "failed"): void => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      onSettled(how);
    };
    const seek = (): void => {
      const d = v.duration;
      const target = Number.isFinite(d) && d > 0 ? Math.min(1, d * 0.1) : 1;
      // Only if the fragment did not already put us there — re-seeking a good position costs a
      // second range request for nothing.
      if (v.currentTime < 0.05) { try { v.currentTime = target; } catch { /* unseekable; the frame at 0 stands */ } }
    };
    const painted = (): void => settle("painted"); // a frame is decoded — the glyph goes
    const fail = (): void => settle("failed");

    v.addEventListener("loadedmetadata", seek);
    v.addEventListener("loadeddata", painted);
    v.addEventListener("seeked", painted);
    v.addEventListener("error", fail);

    timer = setTimeout(fail, FRAME_CEILING_MS);
    // `readyState >= 1` means loadedmetadata already fired before this effect ran.
    if (v.readyState >= 1) seek();
    v.load(); // some containers do not begin fetching on src assignment alone

    return () => {
      done = true; // the SLOT is released by the tile's registration cleanup, never from here —
      if (timer) clearTimeout(timer); // reporting "failed" on an unmount would libel a healthy tile
      v.removeEventListener("loadedmetadata", seek);
      v.removeEventListener("loadeddata", painted);
      v.removeEventListener("seeked", painted);
      v.removeEventListener("error", fail);
      v.removeAttribute("src"); // drop the decoder and any buffered bytes with the tile
      v.load();
    };
  }, [src, onSettled]);

  // `#t=1` is the whole of Approach A: Chromium honours the media fragment on load and paints that
  // frame with no script at all. preload="metadata" keeps the read to the header plus one frame.
  return <video ref={ref} className="tvid" src={`${src}#t=1`} preload="metadata" muted playsInline disablePictureInPicture />;
}

/** One tile. Its video frame is queued at MOUNT and its picture arrives when the queue reaches it —
 *  scrolling to it only moves it up the line. */
function Tile({ item, queue, onOpen }: { item: ScanMediaItem; queue: ThumbQueue; onOpen: (i: ScanMediaItem) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [granted, setGranted] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const box = useRef<HTMLButtonElement | null>(null);

  const stream = item.streamUrl;
  const wantsVideo = item.kind === "video" && stream !== null && !videoFailed;

  // EVERY video tile registers here, at mount, in document order — this is the whole folder warming
  // in the background. `forget` is the unmount and folder-change release path.
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
        if (!live || !entries.some((e) => e.isIntersecting)) return;
        if (item.kind === "video") { queue.seen(item.path); return; }
        io.disconnect();
        void window.api.scan.notes
          .image(item.path)
          .then((r) => { if (!live) return; if (r.ok && r.dataUrl) setUrl(r.dataUrl); else setErr(r.error ?? "Could not read that file."); })
          .catch((e: unknown) => { if (live) setErr(e instanceof Error ? e.message : String(e)); });
      },
      { rootMargin: "200px" } // start a screen early so scrolling does not stutter
    );
    io.observe(el);
    return () => { live = false; io.disconnect(); };
  }, [item.path, item.kind, queue]);

  const onSettled = useCallback(
    (how: "painted" | "failed") => {
      if (how === "failed") setVideoFailed(true);
      queue.release(item.path, how);
    },
    [queue, item.path]
  );

  // An AUDIO file gets an audio glyph and never a film reel — it is not video and must not look it.
  const glyph = item.kind === "video" ? "🎬" : item.kind === "audio" ? "🎵" : "🖼";

  return (
    <button
      ref={box}
      type="button"
      className={`scannotes-tile${item.viewable ? "" : " dead"}`}
      onClick={() => item.viewable && onOpen(item)}
      title={item.viewable ? item.path : `${item.path} — this product cannot open ${item.extension ?? "this format"}`}
    >
      <div className={`thumb${item.kind === "video" ? " vid" : ""}`}>
        {url ? (
          <img src={url} alt="" />
        ) : granted && wantsVideo && stream !== null ? (
          <VideoThumb src={stream} onSettled={onSettled} />
        ) : (
          <span aria-hidden="true">{glyph}</span>
        )}
      </div>
      <div className="nm">
        {item.filename}
        {item.embedded && url && <span className="sub"> · embedded preview</span>}
        {err && <span className="sub"> · {err}</span>}
        {!err && !item.viewable && <span className="sub"> · {fmtBytes(item.size_bytes) || "not viewable here"}</span>}
      </div>
    </button>
  );
}

export default function MediaGrid({ folderPath }: { folderPath: string | null }) {
  const [items, setItems] = useState<ScanMediaItem[]>([]);
  const [open, setOpen] = useState<ScanMediaItem | null>(null);
  const [full, setFull] = useState<string | null>(null);
  const [fullErr, setFullErr] = useState<string | null>(null);
  const media = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);

  // ONE QUEUE PER FOLDER, and the old one is cancelled the moment the folder changes — a background
  // walk must never outlive the folder it was walking. `folderPath` is a reset key, not a value the
  // constructor reads; that is the whole point of the dependency.
  const queue = useMemo(() => new ThumbQueue(), [folderPath]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => queue.cancel(), [queue]);

  useEffect(() => {
    if (!folderPath) { setItems([]); return; }
    void window.api.scan.notes.media(folderPath).then(setItems).catch(() => setItems([]));
  }, [folderPath]);

  // The lightbox asks for its OWN copy rather than reusing the tile's — the cache main-side makes
  // that free, and a lightbox that depends on a tile still being mounted breaks the moment the grid
  // scrolls underneath it.
  useEffect(() => {
    setFull(null);
    setFullErr(null);
    if (!open || open.kind !== "image") return;
    let live = true;
    void window.api.scan.notes
      .image(open.path)
      .then((r) => { if (!live) return; if (r.ok && r.dataUrl) setFull(r.dataUrl); else setFullErr(r.error ?? "Could not read that file."); })
      .catch((e: unknown) => { if (live) setFullErr(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [open]);

  const close = useCallback(() => setOpen(null), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!folderPath) return <div className="scannotes-empty">Pick a folder on the left.</div>;
  if (items.length === 0) {
    return <div className="scannotes-empty">No media recorded in this folder. Scan it and the files appear here.</div>;
  }

  // AUDIO IS ITS OWN LAYOUT. A <video> element with an audio-only source paints a black rectangle
  // the height of the video area and strands the controls at the bottom of that dead space — which
  // is exactly what a nineteen-minute MP3 looked like on device. The class comes from the SCANNER's
  // own extension list (electron/core/services/scan/media.ts:28-30, resolved into `kind` by
  // mediaBrowse.ts) — there is no second list here to drift from it.
  const isAudio = open?.kind === "audio";

  return (
    <>
      <div className="scannotes-mediagrid">
        {items.map((i) => <Tile key={i.path} item={i} queue={queue} onOpen={setOpen} />)}
      </div>

      {/* data-modal-backdrop dims the OS-drawn min/max/close buttons — they are painted ABOVE all
          web content, so no DOM backdrop can cover them (§3.3/§3.4). */}
      {open && (
        <div className="scannotes-overlay" data-modal-backdrop="" role="dialog" aria-modal="true" aria-label={open.filename} onClick={close}>
          <div
            className={`scannotes-modal${open.kind === "image" ? " lightbox" : isAudio ? " audio" : " player"}`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* ONE LINE, full name on hover, and the extension pinned so it survives the ellipsis —
                it is how you know what you are about to play. */}
            <h2 className="scannotes-medianame" title={open.filename}>
              <span className="stem">{stemOf(open.filename)}</span>
              <span className="ext">{extOf(open.filename)}</span>
            </h2>
            <div className="sub2">Playback only — the file is never modified.</div>

            {open.kind === "image" ? (
              <>
                <div className="screen">
                  {full ? <img src={full} alt={open.filename} /> : <span>{fullErr ?? "Loading…"}</span>}
                </div>
                {open.embedded && <div className="sub2">This is the preview the camera embedded — the RAW file itself is untouched.</div>}
              </>
            ) : (
              open.streamUrl && (
                <>
                  {/* No `controls` on either element: the transport lives in the modal's footer for
                      BOTH classes (ruled 08-17-2026), and a native bar cannot be moved out of the
                      element it is drawn inside. */}
                  {isAudio ? (
                    <audio
                      ref={media as React.RefObject<HTMLAudioElement>}
                      src={open.streamUrl}
                      preload="metadata"
                      autoPlay
                      className="scannotes-audioel"
                    />
                  ) : (
                    <video
                      ref={media as React.RefObject<HTMLVideoElement>}
                      className="screen"
                      src={open.streamUrl}
                      preload="metadata"
                      autoPlay
                      playsInline
                    >
                      <track kind="captions" />
                    </video>
                  )}
                  <MediaTransport mediaRef={media} />
                </>
              )
            )}

            <div className="scannotes-btnrow">
              <button type="button" className="scannotes-btn" onClick={close}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
