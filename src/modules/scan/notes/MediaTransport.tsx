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

export interface MediaTransportProps {
  /** The <video> or <audio> this drives. Read live on every interaction — the element is the
   *  authority on its own state, and mirroring it into React would be a second version of the truth. */
  mediaRef: React.RefObject<HTMLVideoElement | HTMLAudioElement | null>;
}

export default function MediaTransport({ mediaRef }: MediaTransportProps) {
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [dur, setDur] = useState(NaN);
  const [muted, setMuted] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const track = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;
    const sync = (): void => {
      setAt(el.currentTime);
      setDur(el.duration);
      setPlaying(!el.paused && !el.ended);
      setMuted(el.muted || el.volume === 0);
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
  const pct = seekable ? Math.min(100, Math.max(0, (at / dur) * 100)) : 0;

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

  const onTrackClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    seekTo((e.clientX - rect.left) / rect.width);
  }, [seekTo]);

  // SPACE AND ARROWS, but only when focus is not already inside a control — otherwise Space would
  // both toggle playback and re-press whichever button the user just tabbed to.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === " ") { e.preventDefault(); toggle(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); nudge(-5); }
      else if (e.key === "ArrowRight") { e.preventDefault(); nudge(5); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, nudge]);

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

      <div
        ref={track}
        className={`scannotes-track${seekable ? "" : " dead"}`}
        onClick={onTrackClick}
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={seekable ? Math.floor(dur) : 0}
        aria-valuenow={Math.floor(at)}
        aria-valuetext={`${clock(at)} of ${clock(dur)}`}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") { e.preventDefault(); nudge(-5); }
          if (e.key === "ArrowRight") { e.preventDefault(); nudge(5); }
        }}
      >
        <i style={{ width: `${pct}%` }} />
      </div>

      <span className="scannotes-tm">
        {clock(at)} / {clock(dur)}
        {buffering && <span className="buf" aria-hidden="true"> ·</span>}
      </span>

      <button
        type="button"
        className="scannotes-tbtn"
        onClick={() => { const el = mediaRef.current; if (el) el.muted = !el.muted; }}
        aria-label={muted ? "Unmute" : "Mute"}
        title={muted ? "Unmute" : "Mute"}
      >
        {muted ? "🔇" : "🔊"}
      </button>
    </div>
  );
}
