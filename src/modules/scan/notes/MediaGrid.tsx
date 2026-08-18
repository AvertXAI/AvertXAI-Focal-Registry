/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// The media grid — browsing the archive, never touching it. Built to the mockups: a tile wall, a
// lightbox for stills, and a player modal whose transport lives in its FOOTER for both media
// classes (MOCKUP-frmedia-player-route-08-17-2026.html).
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
function VideoThumb({ src, onSettled }: { src: string; onSettled: (how: "painted" | "failed", shot?: string) => void }) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const settle = (how: "painted" | "failed", shot?: string): void => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      onSettled(how, shot);
    };
    const seek = (): void => {
      const d = v.duration;
      const target = Number.isFinite(d) && d > 0 ? Math.min(1, d * 0.1) : 1;
      // Only if the fragment did not already put us there — re-seeking a good position costs a
      // second range request for nothing.
      if (v.currentTime < 0.05) { try { v.currentTime = target; } catch { /* unseekable; the frame at 0 stands */ } }
    };
    /** A frame we cannot KEEP is the same as no frame: the point of this element is the picture it
     *  leaves behind, so a capture failure falls back to the glyph rather than parking a live
     *  decoder on screen forever. */
    const grab = (): void => {
      const shot = capture(v);
      if (shot !== null) settle("painted", shot);
      else settle("failed");
    };
    // `loadeddata` can arrive at frame zero, before the seek lands — and frame zero is black
    // on most camera files. Capture from it only if we are already at the target; otherwise wait for
    // `seeked`.
    const onData = (): void => { if (v.currentTime > 0.05) grab(); };
    const fail = (): void => settle("failed");
    /** At the ceiling, keep a frame if one exists (HAVE_CURRENT_DATA or better) rather than throwing
     *  away a slow container's work. */
    const onCeiling = (): void => { if (v.readyState >= 2) grab(); else settle("failed"); };

    v.addEventListener("loadedmetadata", seek);
    v.addEventListener("loadeddata", onData);
    v.addEventListener("seeked", grab);
    v.addEventListener("error", fail);

    timer = setTimeout(onCeiling, FRAME_CEILING_MS);
    // ORDER IS LOAD-BEARING on both lines. crossOrigin has no effect once src is set, and src is
    // assigned here rather than in JSX so React's attribute emission order cannot decide it.
    v.crossOrigin = "anonymous";
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
  }, [src, onSettled]);

  // NO src PROP — it is assigned in the effect above, after crossOrigin. `#t=1` is the whole of
  // Approach A: Chromium honours the media fragment on load and paints that frame with no script at
  // all, and preload="metadata" keeps the read to the header plus one frame.
  return <video ref={ref} className="tvid" preload="metadata" muted playsInline disablePictureInPicture />;
}

/** One tile. A CACHED picture short-circuits everything below — no queue slot, no decoder, no
 *  `frmedia` request. Only a cache miss is queued, and it converts to a cached <img> the moment
 *  its frame is captured. */
function Tile({ item, queue, cachedUrl, onOpen }: { item: ScanMediaItem; queue: ThumbQueue; cachedUrl: string | null; onOpen: (i: ScanMediaItem) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [granted, setGranted] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const box = useRef<HTMLButtonElement | null>(null);

  const stream = item.streamUrl;
  // The picture, whatever produced it: a still's data URL, a frame captured this session, or a hit
  // from the disk cache. Once there is one, this tile never needs a decoder again.
  const pic = url ?? cachedUrl;
  const wantsVideo = item.kind === "video" && stream !== null && !videoFailed && pic === null;

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

  // THE SWAP THAT RELEASES THE DECODER. Setting `url` makes `pic` non-null, which makes
  // `wantsVideo` false, which unmounts <VideoThumb> and re-runs the registration effect's cleanup.
  // Tearing the element down is not a side effect here — it is the entire point of capturing.
  const onSettled = useCallback(
    (how: "painted" | "failed", shot?: string) => {
      if (how === "painted" && shot !== undefined) {
        setUrl(shot);
        // Fire-and-forget: the tile already has its picture, so a cache that cannot write is slow
        // next launch and broken never.
        void window.api.scan.notes.thumbsPut(item.path, shot).catch(() => undefined);
      } else {
        setVideoFailed(true);
      }
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
        {pic !== null ? (
          <img src={pic} alt="" />
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
  /** Path → cached thumbnail data URL. Fetched once per folder; a path that is absent is a miss. */
  const [cached, setCached] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<ScanMediaItem | null>(null);
  const [full, setFull] = useState<string | null>(null);
  const [fullErr, setFullErr] = useState<string | null>(null);
  const media = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);

  // ONE QUEUE PER FOLDER, and the old one is cancelled the moment the folder changes — a background
  // walk must never outlive the folder it was walking. `folderPath` is a reset key, not a value the
  // constructor reads; that is the whole point of the dependency.
  const queue = useMemo(() => new ThumbQueue(), [folderPath]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => queue.cancel(), [queue]);

  // TILE NAMES FIRST, PICTURES A BEAT LATER, and deliberately in that order — the listing is one
  // cheap query and the cache read is hundreds of file reads, so painting the wall before asking for
  // thumbnails is the difference between a folder that opens and a folder that stalls.
  //
  // ONE CALL FOR THE WHOLE FOLDER, not one per tile: four hundred round trips would cost more in
  // message overhead than the reads themselves. Every hit that comes back is a tile that will never
  // create a decoder or take a queue slot.
  useEffect(() => {
    if (!folderPath) { setItems([]); setCached({}); return; }
    let live = true;
    setCached({});
    void window.api.scan.notes
      .media(folderPath)
      .then((list) => {
        if (!live) return;
        setItems(list);
        const videos = list.filter((i) => i.kind === "video" && i.streamUrl !== null).map((i) => i.path);
        if (videos.length === 0) return;
        return window.api.scan.notes.thumbsGet(videos).then((hits) => {
          if (!live) return;
          setCached(hits);
          if (TRACE) {
            const n = Object.keys(hits).length;
            console.info(`[scan-notes] thumb cache: ${n} hit, ${videos.length - n} to generate, of ${videos.length} clips`);
          }
        });
      })
      .catch(() => { if (live) { setItems([]); setCached({}); } });
    return () => { live = false; };
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
        {items.map((i) => <Tile key={i.path} item={i} queue={queue} cachedUrl={cached[i.path] ?? null} onOpen={setOpen} />)}
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
