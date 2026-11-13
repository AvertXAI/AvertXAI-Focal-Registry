/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// The quit guard's toast. Main holds a quit while a timer or a job is running and sends the list
// here. The quit goes ahead only when every line has an answer, or Cancel keeps the app open.
//
// A SIBLING OF UpdateToast (App.tsx), NOT A NEW STAGE OF IT, and the reasons are not style.
// UpdateToast holds one message, so any module's notice would replace the question, and every stage
// of it has a close cross. This one has to outlive other notices and can only be answered or
// cancelled: there is no cross, no timeout and no key that closes it. It wears the same classes
// (.updatetoast.ask), so the shell still has one toast look.
//
// Nothing is decided here. Each click goes to main and main sends back the state that is drawn:
// the chosen answer per line, and `waiting` once the answers are carried out and only jobs that
// are finishing are left.
import { useEffect, useState } from "react";
import type { QuitGuardState, WorkAction } from "../shared/types";
import { ACTION_LABEL, quitTitle } from "./quitGuardText";

interface Props {
  /** Told when the toast appears and when it goes, so App can keep the Scout guest from covering it. */
  onOpenChange: (open: boolean) => void;
}

export default function QuitGuardToast({ onOpenChange }: Props) {
  const [state, setState] = useState<QuitGuardState | null>(null);

  useEffect(() => {
    // The quit may have been held before this mounted (the boot screen has no toast), so the state
    // is also read once. A push is always the newer of the two: once one has arrived, or this effect
    // is gone, the read's answer is dropped so it cannot put back a toast that was already taken down.
    let settled = false;
    const off = window.api.on<QuitGuardState | null>("quitguard:state", (next) => {
      settled = true;
      setState(next);
    });
    void window.api.quitGuard
      .state()
      .then((now) => {
        if (!settled) setState(now);
      })
      .catch(() => undefined); // a held quit is pushed again every second, so a failed read heals itself
    return () => {
      settled = true;
      off();
    };
  }, []);

  const open = state !== null;
  useEffect(() => {
    onOpenChange(open);
  }, [open, onOpenChange]);

  if (!state) return null;

  // No local "chosen" state: main sends the new state straight back, and a call that fails
  // changes nothing on screen, which is the truth.
  const answer = (id: string, action: WorkAction): void => {
    void window.api.quitGuard.answer(id, action).catch(() => undefined);
  };
  const cancel = (): void => {
    void window.api.quitGuard.cancel().catch(() => undefined);
  };

  const title = quitTitle(state.reason);
  return (
    <div className="updatetoast ask quitguard" role="alertdialog" aria-label={title}>
      <div className="updatetoast-ask">
        <b>{title}</b>
        <span className="updatetoast-line">
          {state.waiting
            ? "Waiting for the last job to finish. The app closes by itself."
            : "Still running. The app closes once every line below has an answer."}
        </span>
        {state.lines.map((line) => (
          <div key={line.id} className="quitguard-row">
            <span className="updatetoast-line quitguard-text">{line.text}</span>
            {state.waiting ? (
              // Carried out already, so it is shown as words: a button here would promise a change
              // main no longer accepts.
              <span className="quitguard-chosen">{line.answer && ACTION_LABEL[line.answer]}</span>
            ) : (
              <div className="updatetoast-actions">
                {line.actions.map((action) => (
                  <button
                    key={action}
                    className={"btn" + (line.answer === action ? " updatetoast-primary" : "")}
                    aria-pressed={line.answer === action}
                    onClick={() => answer(line.id, action)}
                  >
                    {ACTION_LABEL[action]}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        <div className="updatetoast-actions quitguard-foot">
          <button className="btn" onClick={cancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
