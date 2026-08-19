/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// THE MEDIA VIEWER — one shell for all three media classes, built to
// MOCKUP-scan-notes-media-modals-v2-08-18-2026.html (approved 08-18-2026). Three bands in one card:
// header (filename, facts, counter, fill-the-window, close) / stage / footer (path + two real
// actions), with the folder reel underneath.
//
// IT READS. IT NEVER WRITES. Nothing in this file touches the file it is showing: playback, an
// in-memory still, and a CSS transform for zoom. The zoom cluster scales a <img> through
// `transform` — the pixels on disk are never re-encoded, resized, or saved (§4.1).
//
// THE REEL DOES NOT DECODE ANYTHING. It renders the `cached` map the grid already fetched for this
// folder — one call, already paid for — and shows a kind glyph for every path that is not in it. It
// must never call `image()`, never mount a <video>, and never enter the thumbnail queue: that
// pipeline is finished and proven (MediaGrid.tsx), and a viewer that quietly started decodes behind
// it would regress the thing it is sitting on top of.
//
// THE ARROW-KEY SPLIT, and why it is not an oversight. MediaTransport owns ArrowLeft/ArrowRight for
// seeking and ArrowUp/ArrowDown for volume, on its own window-level listener, and it is proven on
// device. Binding step-to-next-file to the same two keys would fire BOTH on every press — a seek and
// a file change — so this viewer takes the arrows only where the transport is not mounted: on a
// STILL. On a clip the arrows stay with the transport, and stepping is the on-stage arrows, the
// reel, or the close-and-pick. Escape closes from every class. One listener, added on mount, removed
// on unmount; the component only exists while the viewer is open.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ScanMediaItem } from "../../../shared/types";
import { signalAppToast } from "../../../App";
import MediaTransport from "./MediaTransport";
import "./scannotes-viewer.css";

/** Split at the LAST dot so the extension can be pinned past the stem's ellipsis. A name with no dot
 *  is all stem — there is nothing to protect. Copied from MediaGrid rather than exported from it:
 *  three lines duplicated beats a cross-import between a grid and its own modal. */
const lastDot = (s: string): number => (s.lastIndexOf(".") > 0 ? s.lastIndexOf(".") : s.length);
const stemOf = (s: string): string => s.slice(0, lastDot(s));
const extOf = (s: string): string => s.slice(lastDot(s));

function fmtBytes(n: number | null): string {
  if (!n || n <= 0) return "";
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024).toFixed(0)} KB`;
}

/** m:ss, and nothing at all when there is no honest number — variable-frame-rate phone footage
 *  reports NaN and Infinity as a matter of routine, and `NaN:NaN` in a header is worse than silence.
 *  MediaTransport has its own copy of this and does not export it; it is not edited here (its
 *  behaviour is proven and out of scope), so this is a deliberate three-line duplicate. */
function mmss(t: number): string {
  if (!Number.isFinite(t) || t <= 0) return "";
  const total = Math.floor(t);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Zoom is a fixed ladder, not a continuum: a photographer checking focus wants 100 / 200 / 400, and
 *  a free-running scale gives them 137 percent and no way back to a round number. */
const ZOOM_STEPS = [1, 1.5, 2, 3, 4];

/** What the viewer has LEARNED about a file by displaying it — never persisted, never written, and
 *  never fetched on purpose. Duration comes off the media element that is already playing, size off
 *  the still that is already decoded. Everything here is a by-product of showing the file. */
interface Learned {
  duration?: number;
  width?: number;
  height?: number;
}

const glyphOf = (kind: ScanMediaItem["kind"]): string =>
  kind === "video" ? "🎬" : kind === "audio" ? "🎵" : "🖼";

export interface MediaViewerProps {
  /** The whole folder, in the order the grid shows it — the counter, the arrows and the reel are all
   *  positions in this one list. */
  items: ScanMediaItem[];
  /** Which item is open. The viewer holds no copy of it: the parent owns the position. */
  index: number;
  onClose: () => void;
  onIndexChange: (next: number) => void;
  /** Path → cached thumbnail data URL, exactly as the grid fetched it. READ ONLY, and a miss is a
   *  glyph — see the header note. */
  cached: Record<string, string>;
}

export default function MediaViewer({ items, index, onClose, onIndexChange, cached }: MediaViewerProps) {
  const item: ScanMediaItem | undefined = items[index];
  const path = item?.path ?? null;
  const kind = item?.kind ?? null;

  const [full, setFull] = useState<string | null>(null);
  const [fullErr, setFullErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [paused, setPaused] = useState(true);
  const [learned, setLearned] = useState<Record<string, Learned>>({});
  /** Index into ZOOM_STEPS, not a scale — the ladder is the state, so a step can never land between
   *  two rungs and the reset is `0` rather than a float comparison. */
  const [step, setStep] = useState(0);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const media = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const activeCell = useRef<HTMLButtonElement | null>(null);
  const reel = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ id: number; px: number; py: number; ox: number; oy: number } | null>(null);

  const zoom = ZOOM_STEPS[step] ?? 1;

  /** Merge without churning: a `timeupdate` storm would otherwise replace this map sixty times a
   *  second and re-render the reel with it. */
  const learn = useCallback((key: string, next: Learned) => {
    setLearned((prev) => {
      const cur = prev[key];
      const merged: Learned = { ...cur, ...next };
      if (cur && cur.duration === merged.duration && cur.width === merged.width && cur.height === merged.height) {
        return prev;
      }
      return { ...prev, [key]: merged };
    });
  }, []);

  const go = useCallback(
    (delta: number) => {
      const next = index + delta;
      if (next < 0 || next >= items.length) return;
      onIndexChange(next);
    },
    [index, items.length, onIndexChange]
  );

  // THE VIEWER ASKS FOR ITS OWN COPY of the still rather than reusing a tile's — the cache main-side
  // makes that free, and a viewer that depends on a tile still being mounted breaks the moment the
  // grid scrolls underneath it. Same shape as the effect this replaced in MediaGrid.
  useEffect(() => {
    setFull(null);
    setFullErr(null);
    if (path === null || kind !== "image") return;
    let live = true;
    void window.api.scan.notes
      .image(path)
      .then((r) => {
        if (!live) return;
        if (r.ok && r.dataUrl) setFull(r.dataUrl);
        else setFullErr(r.error ?? "Could not read that file.");
      })
      .catch((e: unknown) => {
        if (live) setFullErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [path, kind]);

  // A NEW FILE IS ALWAYS SHOWN WHOLE. Carrying a 400 percent zoom and a pan offset onto the next
  // photograph shows a corner of it and reads as a broken viewer.
  useEffect(() => {
    setStep(0);
    setPan({ x: 0, y: 0 });
  }, [path]);

  // EVERY FACT IN THE HEADER COMES OFF THE ELEMENT ITSELF, never from a probe of our own: the clip is
  // already open and already knows its duration and frame size. `sync` also drives the big stage play
  // button, which exists only while the clip is paused.
  useEffect(() => {
    const el = media.current;
    if (!el || path === null) return;
    const events = ["loadedmetadata", "durationchange", "play", "pause", "ended"];
    const sync = (): void => {
      setPaused(el.paused || el.ended);
      if (Number.isFinite(el.duration) && el.duration > 0) learn(path, { duration: el.duration });
      if (el instanceof HTMLVideoElement && el.videoWidth > 0) {
        learn(path, { width: el.videoWidth, height: el.videoHeight });
      }
    };
    for (const ev of events) el.addEventListener(ev, sync);
    sync(); // the element may already be past loadedmetadata by the time this runs
    return () => {
      for (const ev of events) el.removeEventListener(ev, sync);
    };
  }, [path, kind, learn]);

  // ONE KEYDOWN LISTENER, and it lives exactly as long as the viewer does. See the header note for
  // why the arrows are conditional on the class rather than unconditional.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (kind !== "image") return; // a clip is mounted: the arrows belong to MediaTransport
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [kind, go, onClose]);

  // The reel follows the viewer. `block: "nearest"` so a horizontal scroll cannot drag the page
  // underneath the modal up or down with it.
  useEffect(() => {
    activeCell.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [index]);

  /** CLAMPED AGAINST THE PAINTED SIZE, not the file size. `clientWidth` is the laid-out box, which
   *  `object-fit: contain` has already fitted to the stage; the transform scales on top of it. So the
   *  maximum offset is half of whatever the scaled box overhangs the stage by, and at 100 percent
   *  there is no overhang and no pan. */
  const clampPan = useCallback((x: number, y: number, z: number): { x: number; y: number } => {
    const stage = stageRef.current;
    const img = imgRef.current;
    if (!stage || !img) return { x: 0, y: 0 };
    const mx = Math.max(0, (img.clientWidth * z - stage.clientWidth) / 2);
    const my = Math.max(0, (img.clientHeight * z - stage.clientHeight) / 2);
    return { x: Math.min(mx, Math.max(-mx, x)), y: Math.min(my, Math.max(-my, y)) };
  }, []);

  // RESET ON STEP, deliberately. Zooming from a panned corner and keeping the offset lands the user
  // somewhere they did not ask for; re-centring is one line and always predictable.
  const stepZoom = useCallback((dir: 1 | -1) => {
    setStep((s) => Math.min(ZOOM_STEPS.length - 1, Math.max(0, s + dir)));
    setPan({ x: 0, y: 0 });
  }, []);

  const resetZoom = useCallback(() => {
    setStep(0);
    setPan({ x: 0, y: 0 });
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLImageElement>) => {
      if (zoom <= 1) return; // nothing overhangs the stage, so there is nothing to drag
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { id: e.pointerId, px: e.clientX, py: e.clientY, ox: pan.x, oy: pan.y };
      setDragging(true);
    },
    [zoom, pan.x, pan.y]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLImageElement>) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      setPan(clampPan(d.ox + (e.clientX - d.px), d.oy + (e.clientY - d.py), zoom));
    },
    [clampPan, zoom]
  );

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLImageElement>) => {
    if (!drag.current) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released — releasing twice is not an error worth surfacing */
    }
    drag.current = null;
    setDragging(false);
  }, []);

  const play = useCallback(() => {
    const el = media.current;
    if (el) void el.play().catch(() => undefined);
  }, []);

  const reveal = useCallback(() => {
    if (path === null) return;
    void window.api.scan.notes
      .revealMedia(path)
      .then((r) => {
        if (!r.ok) signalAppToast(r.error ?? "Could not show that file in Explorer.", "err");
      })
      .catch((e: unknown) => signalAppToast(e instanceof Error ? e.message : String(e), "err"));
  }, [path]);

  const copyPath = useCallback(() => {
    if (path === null) return;
    void navigator.clipboard
      .writeText(path)
      .then(() => signalAppToast("Path copied.", "ok"))
      .catch(() => signalAppToast("Could not copy the path.", "err"));
  }, [path]);

  /** The folder this file sits in — the reel label, and the only place the viewer names a folder. */
  const folderName = useMemo(() => {
    const parts = (path ?? "").split(/[\\/]/).filter(Boolean);
    return parts.length >= 2 ? parts[parts.length - 2] : "";
  }, [path]);

  // An index the parent has moved past the end of its own list is a closed viewer, not a crash.
  if (!item) return null;

  const info: Learned | undefined = learned[item.path];
  // WHATEVER APPLIES, IN THE MOCKUP'S ORDER: duration · dimensions · size · embedded. A fact the file
  // has not told us yet is simply absent — a placeholder dash reads as a missing value rather than as
  // one that does not apply here.
  const metaParts: string[] = [];
  const dur = mmss(info?.duration ?? NaN);
  if (dur) metaParts.push(dur);
  if (info?.width && info.height) metaParts.push(`${info.width}×${info.height}`);
  const size = fmtBytes(item.size_bytes);
  if (size) metaParts.push(size);
  if (item.embedded) metaParts.push("embedded preview");

  const isAudio = item.kind === "audio";
  const isVideo = item.kind === "video";
  const isStill = item.kind === "image";
  const stepHint = isStill ? " (Left/Right arrows)" : "";

  const arrows = (
    <>
      <button
        type="button"
        className="v-arrow prev"
        onClick={() => go(-1)}
        disabled={index <= 0}
        aria-label="Previous"
        title={`Previous${stepHint}`}
      >
        ◀
      </button>
      <button
        type="button"
        className="v-arrow next"
        onClick={() => go(1)}
        disabled={index >= items.length - 1}
        aria-label="Next"
        title={`Next${stepHint}`}
      >
        ▶
      </button>
    </>
  );

  // The transport is MediaTransport, unchanged — only the box it sits in is the mockup's. It is keyed
  // to the path along with the element it drives, so stepping to the next clip gives both a clean
  // mount rather than leaving the transport bound to an element React has already replaced.
  const transport = (
    <div className="v-transport">
      <MediaTransport key={item.path} mediaRef={media} />
    </div>
  );

  /**
   * THE WHEEL SCROLLS THE REEL SIDEWAYS — down goes right, up goes left (Jason, 08-18-2026).
   *
   * A horizontally-scrolling strip with no horizontal input is a strip most people never scroll: a
   * mouse wheel only produces deltaY, and a trackpad's sideways gesture is not something a desktop
   * user reaches for. Without this the reel silently ends at whatever fits, and on a folder of
   * eighty-five clips that is most of the folder.
   *
   * A NATIVE LISTENER WITH `passive: false`, NOT React's onWheel. React attaches wheel handlers at
   * the root as PASSIVE, so `preventDefault()` inside `onWheel` is ignored and logs a console
   * violation — the strip would scroll sideways AND whatever is behind it would scroll down.
   *
   * IT ONLY CLAIMS THE EVENT WHEN IT CAN ACT ON IT. At either end of the strip the default is left
   * alone, so the gesture keeps meaning what it usually means instead of dying against a wall.
   * deltaX is honoured untouched for anyone who does have a horizontal wheel or a trackpad.
   */
  useEffect(() => {
    const el = reel.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      if (e.deltaY === 0) return; // a real horizontal gesture — let the browser do its own thing
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return; // nothing to scroll; do not swallow the gesture
      const next = el.scrollLeft + e.deltaY;
      if ((e.deltaY < 0 && el.scrollLeft <= 0) || (e.deltaY > 0 && el.scrollLeft >= max)) return;
      e.preventDefault();
      el.scrollLeft = Math.max(0, Math.min(max, next));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // items.length so the listener is re-attached when the reel remounts on a folder change.
  }, [items.length]);


  // ===========================================================================================
  // THE NATIVE CAPTION BUTTONS MUST READ AS BEING *UNDER* THIS MODAL.
  //
  // They cannot literally go under it — the OS composites them above all web content and no DOM
  // node can cover them (CLAUDE.md §3.4). The only way to put them behind the modal is to paint
  // them the exact colour the scrim paints the topbar, so the eye reads one continuous dimmed
  // surface. That requires THREE things to agree, and any one of them alone fails:
  //
  //   1. THE SCRIM MUST ACTUALLY REACH THE STRIP. `.scannotes-overlay` is `position:fixed`, but
  //      `.scan-shell` carries `container-type:inline-size` (scan.css:22), which implies layout
  //      containment and makes IT the containing block for fixed descendants — the scrim measured
  //      1258x771 in a ~1690x1030 window. Hence the portal to `document.body`.
  //   2. THE SCRIM'S COLOUR MUST BE THE ONE THE BLEND ASSUMES. `blendWithBackdrop` (windows.ts:96)
  //      composites against rgba(4,8,16,.66) — the shell's `.overlay` backdrop (globals.css:381) —
  //      NOT against this module's old rgba(0,0,0,.5). With the two matched, the strip and the
  //      scrimmed topbar land on the same hex in every theme: light #595c61, dark #101217,
  //      hybrid #070c15. See scannotes-viewer.css for the rule that changes it.
  //   3. THE DIM MUST BE THE ORDINARY ONE, not the "viewer" mode — EXCEPT WHEN EXPANDED.
  //      Un-expanded, what sits under the strip is the scrimmed topbar, so the theme blend is the
  //      right answer. Expanded, the viewer's own header (#1c1917) sits under the strip instead,
  //      and only OVERLAYS.viewer matches that. This is the one case the viewer mode was built for
  //      and the only one where its reasoning survives arithmetic.
  // ===========================================================================================
  return createPortal(
    <div
      className={`scannotes-overlay scannotes-viewer-scrim${expanded ? " expanded" : ""}`}
      data-modal-backdrop={expanded ? "viewer" : ""}
      role="dialog"
      aria-modal="true"
      aria-label={item.filename}
      onClick={onClose}
    >
      <div
        className={`scannotes-viewer-shell${isAudio ? " audio" : ""}${expanded ? " expanded" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="v-card">
          {/* ---- band 1: header ---- */}
          <div className="v-head">
            {/* ONE LINE, full name on hover, extension pinned so it survives the ellipsis — it is how
                you know what you are about to open. */}
            <h2 className="v-name" title={item.filename}>
              <span className="stem">{stemOf(item.filename)}</span>
              <span className="ext">{extOf(item.filename)}</span>
            </h2>
            {metaParts.length > 0 && <span className="v-meta">{metaParts.join(" · ")}</span>}
            <span className="v-count">
              {index + 1} of {items.length}
            </span>
            <button
              type="button"
              className="v-x"
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? "Restore size" : "Fill the window"}
              title={expanded ? "Restore size" : "Fill the window"}
            >
              {expanded ? "⤡" : "⤢"}
            </button>
            <button type="button" className="v-x" onClick={onClose} aria-label="Close" title="Close (Esc)">
              ✕
            </button>
          </div>

          {/* ---- band 2: stage ---- */}
          {isAudio ? (
            // AUDIO IS ITS OWN LAYOUT, and it is not a shrunken video one. A <video> element holding
            // an audio-only file paints a black rectangle the height of the video area and strands
            // the controls at the bottom of that dead space — which is exactly what a nineteen-minute
            // MP3 looked like on device. Glyph, one sentence, transport in the flow.
            <div className="v-stage audio">
              <div className="row">
                <span className="g" aria-hidden="true">
                  🎵
                </span>
                <span>Playback only — the file is never modified.</span>
              </div>
              {item.streamUrl !== null ? (
                <>
                  <audio
                    key={item.path}
                    ref={(el) => {
                      media.current = el;
                    }}
                    src={item.streamUrl}
                    preload="metadata"
                    autoPlay
                    className="scannotes-audioel"
                  />
                  {transport}
                </>
              ) : (
                <div className="v-msg">This product cannot play {item.extension ?? "this format"}.</div>
              )}
            </div>
          ) : isVideo ? (
            <div className="v-stage video" ref={stageRef}>
              {item.streamUrl !== null ? (
                <>
                  {/* No `controls`: the transport is the mockup's bar along the bottom of the stage,
                      and a native bar cannot be moved out of the element it is drawn inside. */}
                  <video
                    key={item.path}
                    ref={(el) => {
                      media.current = el;
                    }}
                    src={item.streamUrl}
                    preload="metadata"
                    autoPlay
                    playsInline
                  >
                    <track kind="captions" />
                  </video>
                  {/* the stage IS the play button until it is running — including when the platform
                      refuses the autoplay, which is the case this covers that a poster frame does not */}
                  {paused && (
                    <button type="button" className="v-play" onClick={play} aria-label="Play" title="Play (Space)">
                      ▶
                    </button>
                  )}
                  <span className="v-cap">Playback only — the file is never modified.</span>
                  {arrows}
                  {transport}
                </>
              ) : (
                <>
                  <div className="v-msg">This product cannot play {item.extension ?? "this format"}.</div>
                  {arrows}
                </>
              )}
            </div>
          ) : (
            <div className="v-stage still" ref={stageRef}>
              {full !== null ? (
                <img
                  ref={imgRef}
                  src={full}
                  alt={item.filename}
                  className={zoom > 1 ? `zoomed${dragging ? " grabbing" : ""}` : undefined}
                  // VIEW ONLY. A transform moves what is on screen and nothing else — no re-encode,
                  // no resize, no write. The file is exactly as the camera left it.
                  style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
                  draggable={false}
                  onLoad={(e) =>
                    learn(item.path, {
                      width: e.currentTarget.naturalWidth,
                      height: e.currentTarget.naturalHeight,
                    })
                  }
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                />
              ) : fullErr !== null ? (
                <div className="v-msg">{fullErr}</div>
              ) : isStill ? (
                <div className="v-msg">Loading…</div>
              ) : (
                <span className="v-ph" aria-hidden="true">
                  {glyphOf(item.kind)}
                </span>
              )}
              {item.embedded && (
                <span className="v-cap">
                  This is the preview the camera embedded — the RAW file itself is untouched.
                </span>
              )}
              {arrows}
              <div className="v-zoom">
                <button type="button" onClick={() => stepZoom(-1)} disabled={step === 0} aria-label="Zoom out" title="Zoom out">
                  −
                </button>
                <button type="button" onClick={resetZoom} aria-label="Fit to the stage" title="Fit to the stage">
                  {Math.round(zoom * 100)}%
                </button>
                <button
                  type="button"
                  onClick={() => stepZoom(1)}
                  disabled={step === ZOOM_STEPS.length - 1}
                  aria-label="Zoom in"
                  title="Zoom in"
                >
                  +
                </button>
              </div>
            </div>
          )}

          {/* ---- band 3: footer ---- */}
          {/* THE PATH IS THE FACT. The mockup also shows a capture date and the exposure; neither is
              on ScanMediaItem (src/shared/types.ts) and neither is fetched here — inventing a probe
              for them would be a second metadata read per step. What a photographer actually needs
              off this screen is where the file is, and both buttons act on exactly that. */}
          <div className="v-foot">
            <span className="v-facts" title={item.path}>
              {item.path}
            </span>
            <button type="button" className="v-btn" onClick={reveal}>
              Show in Explorer
            </button>
            <button type="button" className="v-btn" onClick={copyPath}>
              Copy path
            </button>
          </div>
        </div>

        {/* ---- the reel ---- */}
        {items.length > 1 && (
          <div className="v-reel-wrap">
            <div className="v-reel-label">
              {folderName ? `${folderName} · ` : ""}
              {items.length} files
            </div>
            <div className="v-reel" ref={reel}>
              {items.map((it, i) => {
                // CACHE ONLY — see the header note. A miss is a glyph, never a fetch.
                const thumb = cached[it.path] ?? null;
                const badge = it.kind === "video" ? mmss(learned[it.path]?.duration ?? NaN) : "";
                return (
                  <button
                    key={it.path}
                    type="button"
                    ref={i === index ? activeCell : undefined}
                    className={`v-cell${i === index ? " on" : ""}`}
                    disabled={!it.viewable}
                    onClick={() => onIndexChange(i)}
                    title={it.viewable ? it.path : `${it.path} — this product cannot open ${it.extension ?? "this format"}`}
                  >
                    <div className="pic">
                      {thumb !== null ? <img src={thumb} alt="" /> : <span aria-hidden="true">{glyphOf(it.kind)}</span>}
                      {badge && <span className="dur">{badge}</span>}
                    </div>
                    <div className="nm">{it.filename}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
