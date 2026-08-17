/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// ONE TRANSPORT, ONE PLACE, BOTH MEDIA CLASSES (Jason ruled 08-17-2026). Built to the controls row
// in MOCKUP-frmedia-player-route-08-17-2026.html: play/pause · seek track · elapsed/total · volume.
//
// WHY THIS EXISTS AT ALL, rather than moving the native bar: browser controls are drawn INSIDE the
// media element and cannot be relocated. Honouring "the transport lives in the modal footer" means
// the `controls` attribute comes off and this takes its place. It is also what fixes the audio case
// — a <video> holding an audio-only file paints a black rectangle and strands the native bar at the
// bottom of that dead space, which is what a nineteen-minute MP3 looked like on device.
//
// POSITION COMES FROM THE ELEMENT, NEVER FROM A TIMER. Every readout here is driven by the media
// element's own events — `timeupdate`, `loadedmetadata`, `durationchange`, `play`, `pause`, `ended`,
// `waiting`. A transport that guesses at position with setInterval drifts against the real playhead,
// and a seek bar that lies about where you are is worse than no seek bar: you stop trusting it and
// you cannot tell when it is wrong.
//
// NaN AND Infinity ARE ROUTINE, not edge cases — variable-frame-rate phone footage reports them
// constantly, and a stream still loading has no duration at all. Every one of those shows `--:--`
// and disables seeking rather than rendering `NaN:NaN` or dividing by it.
import { useCallback, useEffect, useRef, useState } from "react";

/** m:ss, or `--:--` when there is no honest number to show. Hours roll into the minutes field
 *  rather than adding a third column that is empty on everything a photographer owns. */
function clock(t: number): string {
  if (!Number.isFinite(t) || t < 0) return "--:--";
  const total = Math.floor(t);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** VOLUME CARRIES ACROSS FILES FOR THE SESSION, and no further. Turning every clip down one at a
 *  time is the actual complaint, and module state fixes it in two variables. It deliberately does
 *  NOT reach `app_settings`: a persisted key needs the RENDERER_KEYS whitelist and a Settings
 *  surface to change it from (§3.8), and that is a decision to take on purpose rather than by
 *  drift. It resets when the window closes. */
let lastVolume = 1;
let lastMuted = false;

/** Arrow keys move volume by five percent — one percent needs twenty presses to do anything. */
const VOLUME_STEP = 0.05;

export interface MediaTransportProps {
  /** The <video> or <audio> this drives. Read live on every interaction — the element is the
   *  authority on its own state, and mirroring it into React would be a second version of the truth. */
  mediaRef: React.RefObject<HTMLVideoElement | HTMLAudioElement | null>;
}

export default function MediaTransport({ mediaRef }: MediaTransportProps) {
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [dur, setDur] = useState(NaN);
  const [muted, setMuted] = useState(lastMuted);
  const [vol, setVol] = useState(lastVolume);
  const [buffering, setBuffering] = useState(false);
  /** Fraction 0–1 while a drag is in progress, `null` when it is not. */
  const [scrubAt, setScrubAt] = useState<number | null>(null);
  const track = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;
    // Pick up where the last clip left off, BEFORE the first sync — otherwise the readout shows the
    // element's default of full volume for a frame and then jumps.
    el.volume = lastVolume;
    el.muted = lastMuted;
    const sync = (): void => {
      setAt(el.currentTime);
      setDur(el.duration);
      setPlaying(!el.paused && !el.ended);
      setMuted(el.muted || el.volume === 0);
      setVol(el.volume);
      lastVolume = el.volume;
      lastMuted = el.muted;
    };
    const onWait = (): void => setBuffering(true);
    const onGo = (): void => { setBuffering(false); sync(); };
    for (const ev of ["timeupdate", "loadedmetadata", "durationchange", "play", "pause", "ended", "volumechange", "seeked"]) {
      el.addEventListener(ev, sync);
    }
    el.addEventListener("waiting", onWait);
    el.addEventListener("playing", onGo);
    el.addEventListener("canplay", onGo);
    sync(); // the element may already be past loadedmetadata by the time this mounts
    return () => {
      for (const ev of ["timeupdate", "loadedmetadata", "durationchange", "play", "pause", "ended", "volumechange", "seeked"]) {
        el.removeEventListener(ev, sync);
      }
      el.removeEventListener("waiting", onWait);
      el.removeEventListener("playing", onGo);
      el.removeEventListener("canplay", onGo);
    };
  }, [mediaRef]);

  const seekable = Number.isFinite(dur) && dur > 0;
  // WHILE SCRUBBING THE DISPLAY FOLLOWS THE DRAG, not `timeupdate`. The element reports the position
  // it has actually decoded to, which lags a fast drag by a beat and reads as the bar fighting the
  // pointer. The drag is the truth until it ends; then the element takes the readout back.
  const shown = scrubAt !== null && seekable ? scrubAt * dur : at;
  const pct = scrubAt !== null ? scrubAt * 100 : seekable ? Math.min(100, Math.max(0, (at / dur) * 100)) : 0;

  const toggle = useCallback(() => {
    const el = mediaRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => undefined);
    else el.pause();
  }, [mediaRef]);

  const seekTo = useCallback((fraction: number) => {
    const el = mediaRef.current;
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;
    el.currentTime = Math.min(el.duration, Math.max(0, fraction * el.duration));
  }, [mediaRef]);

  const nudge = useCallback((seconds: number) => {
    const el = mediaRef.current;
    if (!el) return;
    const d = Number.isFinite(el.duration) ? el.duration : Infinity;
    el.currentTime = Math.min(d, Math.max(0, el.currentTime + seconds));
  }, [mediaRef]);

  /** MUTE AND LEVEL ARE TWO DIFFERENT THINGS, and the element already models both — `muted` does not
   *  touch `volume`, so the prior level survives a mute untouched and comes straight back on unmute.
   *  Nothing here ever writes `volume = 0` to mute; that is what destroys the level. */
  const setVolume = useCallback((v: number) => {
    const el = mediaRef.current;
    if (!el) return;
    el.volume = Math.min(1, Math.max(0, v));
    if (el.volume > 0) el.muted = false; // reaching for the slider means you want to hear it
  }, [mediaRef]);

  const bumpVolume = useCallback((delta: number) => {
    const el = mediaRef.current;
    if (!el) return;
    setVolume((el.muted ? 0 : el.volume) + delta);
  }, [mediaRef, setVolume]);

  /** Position from the pointer's X and NOTHING ELSE. `clientY` is ignored on purpose: a drag that
   *  wanders above or below a sixteen-pixel bar is how people actually scrub, and treating that as
   *  "the pointer left the control" is how a scrub dies halfway across. Pointer capture keeps the
   *  events arriving here even when the pointer is nowhere near the element. */
  const fractionFrom = useCallback((clientX: number): number => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }, []);

  const onDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!seekable) return;
    e.preventDefault();
    track.current?.setPointerCapture(e.pointerId);
    const f = fractionFrom(e.clientX);
    setScrubAt(f);
    seekTo(f); // a press alone is a seek — press-and-release without moving is a click
  }, [seekable, fractionFrom, seekTo]);

  const onMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (scrubAt === null) return;
    const f = fractionFrom(e.clientX);
    setScrubAt(f);
    seekTo(f);
  }, [scrubAt, fractionFrom, seekTo]);

  const onUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (scrubAt === null) return;
    try { track.current?.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    setScrubAt(null);
  }, [scrubAt]);

  // SPACE AND ARROWS, but only when focus is not already inside a control — otherwise Space would
  // both toggle playback and re-press whichever button the user just tabbed to.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === " ") { e.preventDefault(); toggle(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); nudge(-5); }
      else if (e.key === "ArrowRight") { e.preventDefault(); nudge(5); }
      else if (e.key === "ArrowUp") { e.preventDefault(); bumpVolume(VOLUME_STEP); }
      else if (e.key === "ArrowDown") { e.preventDefault(); bumpVolume(-VOLUME_STEP); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, nudge, bumpVolume]);

  return (
    <div className="scannotes-transport">
      <button
        type="button"
        className="scannotes-tbtn pri"
        onClick={toggle}
        aria-label={playing ? "Pause" : "Play"}
        title={playing ? "Pause (Space)" : "Play (Space)"}
      >
        {playing ? "⏸" : "▶"}
      </button>

      {/* EVERY POINTER HANDLER IS ON THE TRACK ITSELF. The fill and its thumb are pointer-events:none
          (scannotes.css) so a press on the FILLED half — which is every backward seek — reaches this
          element instead of being swallowed by the thing painted on top of it.
          No onKeyDown here: the window-level handler below already serves ArrowLeft/ArrowRight and
          fires whether or not the track holds focus. Having both meant a focused track seeked ten
          seconds per press instead of five. */}
      <div
        ref={track}
        className={`scannotes-track${seekable ? "" : " dead"}${scrubAt !== null ? " scrub" : ""}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={seekable ? Math.floor(dur) : 0}
        aria-valuenow={Math.floor(shown)}
        aria-valuetext={`${clock(shown)} of ${clock(dur)}`}
      >
        <i style={{ width: `${pct}%` }} />
      </div>

      <span className="scannotes-tm">
        {clock(shown)} / {clock(dur)}
        {buffering && <span className="buf" aria-hidden="true"> ·</span>}
      </span>

      {/* The SPEAKER still mutes — the slider is a level, not a replacement for the switch. */}
      <button
        type="button"
        className="scannotes-tbtn"
        onClick={() => { const el = mediaRef.current; if (el) el.muted = !el.muted; }}
        aria-label={muted ? "Unmute" : "Mute"}
        title={muted ? "Unmute" : "Mute"}
      >
        {muted ? "🔇" : "🔊"}
      </button>

      {/* A NATIVE RANGE, not a hand-rolled bar: `accent-color` paints the thumb AND the filled part
          of the track in Chromium, so "reads as filled" comes free and themed, and every keyboard
          and assistive-technology behaviour a slider owes is already correct. It shows 0 while muted
          without the element's `volume` ever being written to 0 — the level is intact underneath. */}
      <input
        type="range"
        className="scannotes-vol"
        min={0}
        max={1}
        step={VOLUME_STEP}
        value={muted ? 0 : vol}
        onChange={(e) => setVolume(Number(e.target.value))}
        aria-label="Volume"
        title={`Volume ${Math.round((muted ? 0 : vol) * 100)}% (Up/Down)`}
      />
    </div>
  );
}
