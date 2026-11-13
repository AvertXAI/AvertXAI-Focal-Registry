/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// The next-launch prompt: what was left behind when Focal Registry last closed.
//
// A timer that was running while the app was closed keeps counting until somebody answers for it,
// so this is the one shell dialog with no way out but its own buttons. There is deliberately no
// backdrop close and no Escape: either would leave the timer counting with nobody asked.
// Jobs that were cut short are listed under the timers with what is safe to do next; that list
// only needs an OK.
//
// It rides .overlay and .fb-modal, so App's body observer dims the caption buttons with no wiring
// here (SettingsModal.tsx explains why a dialog never calls setModalDim itself).
import { useEffect, useState } from "react";
import { signalAppToast } from "../App";
import type { CutShortJob, LeftoverTimer } from "../shared/types";
import { parseStored, readEndTime, toInputValue, whenText } from "./quitGuardText";

interface Props {
  /** Told when the prompt opens and when it closes, so App can keep the Scout guest from covering it. */
  onOpenChange: (open: boolean) => void;
}

// A failed call is answered in a plain sentence; the raw error means nothing to the person reading it.
const FAILED = "That did not go through. Try again.";

function TimerBlock({ timer, onDone }: { timer: LeftoverTimer; onDone: () => void }) {
  const [entering, setEntering] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastSeen = whenText(timer.lastSeenAt);

  // `busy` holds every button of this block until main answers: a second click on a timer the
  // first click already settled would come back as an error for something that worked.
  const resolve = (choice: "keep" | "stopAtLastSeen" | "stopAt", endIso?: string): void => {
    setBusy(true);
    setError(null);
    void window.api.quitGuard
      .resolveTimer(timer.id, choice, endIso)
      .then((result) => {
        if (result.ok) {
          onDone();
          return;
        }
        setBusy(false);
        setError(result.error ?? FAILED);
      })
      .catch(() => {
        setBusy(false);
        setError(FAILED);
      });
  };

  const enter = (): void => {
    setEntering(true);
    // Starts from the last time the app was open: the real end is usually near it, and an empty
    // field makes him type the whole date.
    setTyped((current) => current || toInputValue(parseStored(timer.lastSeenAt)));
  };

  const save = (): void => {
    const end = readEndTime(typed, timer.startedAt, Date.now());
    if ("error" in end) setError(end.error);
    else resolve("stopAt", end.iso);
  };

  return (
    <div className="leftover-block">
      <div className="leftover-head">
        {timer.project}
        {timer.person ? ` · ${timer.person}` : ""}
      </div>
      <p className="fb-sub">
        A timer was running while Focal Registry was closed, from {whenText(timer.startedAt)} until {lastSeen}.
      </p>
      <div className="fb-acts">
        <button className="fb-btn" disabled={busy} onClick={() => resolve("keep")}>Keep all of it</button>
        <button className="fb-btn" disabled={busy} onClick={() => resolve("stopAtLastSeen")}>Stop it at {lastSeen}</button>
        <button className="fb-btn" disabled={busy} aria-expanded={entering} onClick={enter}>Enter the end time</button>
      </div>
      {entering && (
        <div className="fb-acts">
          <input
            className="input"
            type="datetime-local"
            aria-label="End time"
            autoFocus
            value={typed}
            min={toInputValue(parseStored(timer.startedAt))}
            max={toInputValue(Date.now())}
            disabled={busy}
            onChange={(e) => setTyped(e.target.value)}
          />
          <button className="fb-btn primary" disabled={busy || typed === ""} onClick={save}>Save</button>
        </div>
      )}
      {error && <div className="fb-error" role="alert">{error}</div>}
    </div>
  );
}

export default function LeftoverPrompt({ onOpenChange }: Props) {
  const [timers, setTimers] = useState<LeftoverTimer[]>([]);
  const [jobs, setJobs] = useState<CutShortJob[]>([]);

  useEffect(() => {
    void window.api.quitGuard
      .leftovers()
      .then((found) => {
        setTimers(found.timers);
        setJobs(found.jobs);
      })
      .catch(() =>
        // Said out loud, not swallowed: a timer nobody was asked about keeps counting.
        signalAppToast(
          "Focal Registry could not check whether a timer was left running while it was closed. If one is still running, stop it from its own screen.",
          "err"
        )
      );
  }, []);

  const open = timers.length > 0 || jobs.length > 0;
  useEffect(() => {
    onOpenChange(open);
  }, [open, onOpenChange]);

  const dismissJobs = (): void => {
    // Closed either way. If the saved list could not be cleared it comes back at the next launch,
    // which is where it belongs: nothing he was told is lost.
    void window.api.quitGuard.dismissJobs().catch(() => undefined);
    setJobs([]);
  };

  if (!open) return null;
  return (
    <div className="overlay">
      <div className="fb-modal" role="alertdialog" aria-modal="true" aria-label="While Focal Registry was closed">
        {/* ponytail: no initial focus and no Tab trap, the same as the other shell dialogs
            (SettingsModal.tsx). For a prompt that opens by itself that is the safer side: no answer
            is one keystroke away. Add a trap if Tab is seen reaching the page underneath. */}
        <h2 className="fb-title">While Focal Registry was closed</h2>
        {timers.map((timer) => (
          <TimerBlock
            key={timer.id}
            timer={timer}
            onDone={() => setTimers((all) => all.filter((other) => other.id !== timer.id))}
          />
        ))}
        {jobs.length > 0 && (
          <div className="leftover-block">
            <div className="leftover-head">Jobs that were cut short</div>
            <ul className="leftover-jobs">
              {jobs.map((job, index) => (
                <li key={index}>
                  {job.text}
                  <span className="leftover-note">
                    {[job.at && whenText(job.at), job.next].filter(Boolean).join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
            <div className="fb-acts">
              <span className="fb-spacer" />
              <button className="fb-btn primary" onClick={dismissJobs}>OK</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
