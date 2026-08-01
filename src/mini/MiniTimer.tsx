/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Mini timer strip — one row per active session: colour dot, project name, live clock, and a RED ✕
// to the right of the time that STOPS that timer (and closes this window too when it was the only
// one). Clicking the row body pauses/resumes that one session (existing channels — no new
// mechanism). No top bar: the shell is the drag region. Height is managed MAIN-SIDE by the ticker.
import { useEffect, useState } from "react";

// Local minimal shapes — this window's bespoke bridge (window.miniApi) is not window.api.
interface MiniSession {
  id: number;
  projectId: number;
  projectName: string;
  state: "running" | "paused";
  startedAt: string;
  accumulatedSeconds: number;
}
interface MiniStatus { sessions: MiniSession[]; focusedId: number | null }
interface MiniTick { sessions: Array<{ id: number; elapsedMs: number; state: "running" | "paused" }>; focusedId: number | null }
interface MiniProject { id: number; color: string }

declare global {
  interface Window {
    miniApi: {
      status: () => Promise<MiniStatus>;
      projects: () => Promise<MiniProject[]>;
      pause: (sessionId: number) => Promise<unknown>;
      resume: (sessionId: number) => Promise<unknown>;
      stop: (sessionId: number) => Promise<unknown>;
      close: () => Promise<void>;
      onTick: (cb: (p: MiniTick) => void) => () => void;
      onChanged: (cb: () => void) => () => void;
    };
  }
}

const clock = (totalSeconds: number): string => {
  const s = Math.max(0, Math.floor(totalSeconds));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, "0")).join(":");
};

export default function MiniTimer() {
  const [status, setStatus] = useState<MiniStatus>({ sessions: [], focusedId: null });
  const [tick, setTick] = useState<MiniTick | null>(null);
  const [colors, setColors] = useState<Map<number, string>>(new Map());

  const reload = (): void => {
    void window.miniApi.status().then(setStatus).catch(() => {});
    void window.miniApi.projects()
      .then((ps) => setColors(new Map(ps.map((p) => [p.id, p.color]))))
      .catch(() => {});
  };
  useEffect(() => {
    reload();
    const offTick = window.miniApi.onTick(setTick);
    const offChanged = window.miniApi.onChanged(reload);
    return () => { offTick(); offChanged(); };
  }, []);

  const seconds = (s: MiniSession): number => {
    const t = tick?.sessions.find((x) => x.id === s.id);
    if (t) return t.elapsedMs / 1000;
    return s.state === "paused" ? s.accumulatedSeconds : Math.max(0, (Date.now() - Date.parse(s.startedAt)) / 1000);
  };
  const toggleRow = (s: MiniSession): void => {
    const op = s.state === "running" ? window.miniApi.pause(s.id) : window.miniApi.resume(s.id);
    void op.then(reload).catch(() => {});
  };
  // The red ✕: stop THIS timer; when it was the only one, close the window with it.
  const stopRow = (s: MiniSession): void => {
    const wasOnly = status.sessions.length === 1;
    void window.miniApi.stop(s.id)
      .then(() => (wasOnly ? window.miniApi.close() : reload()))
      .catch(() => {});
  };

  return (
    // No top bar — the shell itself is the drag region; the row/stop buttons opt out (no-drag).
    <div className="mini-shell">
      <div className="mini-rows">
        {status.sessions.length === 0 && <div className="mini-empty">No timers running</div>}
        {status.sessions.map((s) => (
          <div key={s.id} className={"mini-row" + (s.state === "paused" ? " paused" : "")}>
            <button
              className="mini-rowbody"
              title={s.state === "running" ? "Click to pause" : "Click to resume"}
              onClick={() => toggleRow(s)}
            >
              <span className="mini-dot" style={{ background: colors.get(s.projectId) ?? "var(--mc-accent-primary)" }} />
              <span className="mini-name">{s.projectName}</span>
              {s.state === "paused" && <span className="mini-paused">❚❚</span>}
              <span className="mini-clock">{clock(seconds(s))}</span>
            </button>
            <button
              className="mini-stop"
              title={status.sessions.length === 1 ? "Stop this timer and close" : "Stop this timer"}
              aria-label={`Stop ${s.projectName}`}
              onClick={() => stopRow(s)}
            >✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}
