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
import { useCallback, useEffect, useRef, useState } from "react";
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

/**
 * At most six tiles loading metadata at once. The wall is already in-view gated, so this rarely
 * binds — but a fast scroll through a folder of hundreds of clips can queue far more than the eye
 * ever sees, and each one is a file read.
 */
let slots = 6;
const waiting: Array<() => void> = [];
function takeSlot(run: () => void): void {
  if (slots > 0) { slots -= 1; run(); } else waiting.push(run);
}
function freeSlot(): void {
  const next = waiting.shift();
  if (next) next(); // the slot transfers rather than returning to the pool
  else slots += 1;
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
 * AND IT NEVER SPINS FOREVER: no frame within four seconds is a failure like any other, because a
 * container that stalls without erroring is exactly how a wall of tiles ends up hanging.
 */
function VideoThumb({ src, onFail }: { src: string; onFail: () => void }) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const release = (): void => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      freeSlot();
    };
    const fail = (): void => { release(); onFail(); };
    const seek = (): void => {
      const d = v.duration;
      const target = Number.isFinite(d) && d > 0 ? Math.min(1, d * 0.1) : 1;
      // Only if the fragment did not already put us there — re-seeking a good position costs a
      // second range request for nothing.
      if (v.currentTime < 0.05) { try { v.currentTime = target; } catch { /* unseekable; the frame at 0 stands */ } }
    };
    const painted = (): void => release(); // a frame is decoded — the slot is free and the glyph goes

    v.addEventListener("loadedmetadata", seek);
    v.addEventListener("loadeddata", painted);
    v.addEventListener("seeked", painted);
    v.addEventListener("error", fail);

    takeSlot(() => {
      if (done) { freeSlot(); return; } // unmounted while queued
      timer = setTimeout(fail, 4000);
      // `readyState >= 1` means loadedmetadata already fired before this effect ran.
      if (v.readyState >= 1) seek();
      v.load(); // some containers do not begin fetching on src assignment alone
    });

    return () => {
      release();
      v.removeEventListener("loadedmetadata", seek);
      v.removeEventListener("loadeddata", painted);
      v.removeEventListener("seeked", painted);
      v.removeEventListener("error", fail);
      v.removeAttribute("src"); // drop the decoder and any buffered bytes with the tile
      v.load();
    };
  }, [src, onFail]);

  // `#t=1` is the whole of Approach A: Chromium honours the media fragment on load and paints that
  // frame with no script at all. preload="metadata" keeps the read to the header plus one frame.
  return <video ref={ref} className="tvid" src={`${src}#t=1`} preload="metadata" muted playsInline disablePictureInPicture />;
}

/** One tile. It holds off until it is actually visible — the whole reason a folder of four thousand
 *  files opens instantly. */
function Tile({ item, onOpen }: { item: ScanMediaItem; onOpen: (i: ScanMediaItem) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [inView, setInView] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const box = useRef<HTMLButtonElement | null>(null);

  const stream = item.streamUrl;
  const wantsVideo = item.kind === "video" && stream !== null && !videoFailed;

  useEffect(() => {
    if (!box.current) return;
    if (item.kind !== "image" && item.kind !== "video") return; // audio never attempts a frame
    let live = true;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        if (!live) return;
        setInView(true);
        if (item.kind === "image") {
          void window.api.scan.notes
            .image(item.path)
            .then((r) => { if (!live) return; if (r.ok && r.dataUrl) setUrl(r.dataUrl); else setErr(r.error ?? "Could not read that file."); })
            .catch((e: unknown) => { if (live) setErr(e instanceof Error ? e.message : String(e)); });
        }
      },
      { rootMargin: "200px" } // start a screen early so scrolling does not stutter
    );
    io.observe(box.current);
    return () => { live = false; io.disconnect(); };
  }, [item.path, item.kind]);

  const onVideoFail = useCallback(() => setVideoFailed(true), []);
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
        ) : inView && wantsVideo ? (
          <VideoThumb src={stream} onFail={onVideoFail} />
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
        {items.map((i) => <Tile key={i.path} item={i} onOpen={setOpen} />)}
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
