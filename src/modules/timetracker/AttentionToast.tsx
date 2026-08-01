/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// TimeTracker attention toasts — mounted at APP level (beside UpdateToast) because a break or idle
// prompt must appear whichever module is open; a toast inside the module dies with its unmount.
// Break: heading + rotating message (breakMessages registry) + Snooze/dismiss; plays the selected
// sound through the ONE WebAudio path — the sound decision is made MAIN-SIDE per fire
// (readSelectedSound re-reads the toggle live and returns null when off: the shipped-bug guard).
// Idle: "discard or keep" prompt — the engine never touches a session until a button is pressed.
import { useEffect, useState } from "react";
import type { TimeTrackerBreakPayload, TimeTrackerIdlePayload } from "../../shared/types";
import { pickBreakMessage } from "./breakMessages";
import { playSoundData } from "./audio";

type ToastState =
  | { kind: "break"; workedMin: number; autopaused: boolean; message: string }
  | { kind: "idle"; thresholdMin: number }
  | null;

export default function AttentionToast() {
  const api = window.api;
  const [toast, setToast] = useState<ToastState>(null);

  useEffect(() => {
    const onBreak = (p: TimeTrackerBreakPayload): void => {
      setToast({ kind: "break", workedMin: p.workedMin, autopaused: p.autopaused, message: pickBreakMessage() });
      // Sound: main-side readSelectedSound re-checks the toggle LIVE on this very call —
      // null when the sound is off, so silence is decided at fire time, never cached.
      void api.timetracker.sounds.readSelected().then((d) => { if (d) void playSoundData(d); }).catch(() => {});
    };
    const onIdle = (p: TimeTrackerIdlePayload): void => setToast({ kind: "idle", thresholdMin: p.thresholdMin });
    api.on<TimeTrackerBreakPayload>("timetracker:break", onBreak);
    api.on<TimeTrackerIdlePayload>("timetracker:idle", onIdle);
    return () => {
      api.off<TimeTrackerBreakPayload>("timetracker:break", onBreak);
      api.off<TimeTrackerIdlePayload>("timetracker:idle", onIdle);
    };
  }, [api]);

  if (!toast) return null;

  if (toast.kind === "break") {
    return (
      <div className="tt-attn" role="alert">
        <div className="tt-attnhead">
          Time for a break{toast.autopaused ? " — timer paused" : ""}
          <button className="tt-attnx" aria-label="Dismiss" onClick={() => setToast(null)}>✕</button>
        </div>
        <p className="tt-attnbody">{toast.message}</p>
        <p className="tt-attnsub">{toast.workedMin} minutes of tracked work.</p>
        <div className="tt-attnacts">
          <button
            className="tt-iconbtn"
            onClick={() => {
              void api.timetracker.attention.snoozeBreak().catch(() => {});
              setToast(null);
            }}
          >
            Snooze 5 min
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="tt-attn" role="alertdialog" aria-label="Idle detected">
      <div className="tt-attnhead">
        Are you still there?
        <button className="tt-attnx" aria-label="Keep the time and dismiss"
          onClick={() => { void api.timetracker.attention.resolveIdle(false).catch(() => {}); setToast(null); }}>✕</button>
      </div>
      <p className="tt-attnbody">
        You've been idle over {toast.thresholdMin} minute{toast.thresholdMin === 1 ? "" : "s"} while a timer runs.
        Nothing has been changed — your call:
      </p>
      <div className="tt-attnacts">
        <button className="tt-iconbtn"
          onClick={() => { void api.timetracker.attention.resolveIdle(true).catch(() => {}); setToast(null); }}>
          Discard the idle time
        </button>
        <button className="tt-iconbtn"
          onClick={() => { void api.timetracker.attention.resolveIdle(false).catch(() => {}); setToast(null); }}>
          Keep it
        </button>
      </div>
    </div>
  );
}
