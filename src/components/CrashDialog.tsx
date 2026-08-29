/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// The crash prompt — the ONLY thing a user ever sees on their own from this feature. Everything else
// (Report a problem, Suggest something) is something they went looking for in the Help menu.
//
// Ruled 08-23-2026. Small, one line of explanation, three answers:
//
//   Restart the app · Continue · Send a report
//
// FOUR RULES THAT LOOK COSMETIC AND ARE NOT:
//
// 1. IT DOES NOT MENTION THE SCREENSHOT. "the screenshot will be there, it will be present and they
//    will have an understanding, so there is no need to directly tell them." Announcing that the app
//    has just photographed their screen, in the same breath as telling them it broke, is how a
//    helpful feature reads as a creepy one.
//
// 2. "Continue" and dismissal DELETE the picture — feedback.discard(). The shot is not parked, not
//    queued, not kept "in case they change their mind". An application holding images of somebody's
//    screen that they declined to send is the breach headline, and the delete is what makes the
//    silent capture defensible in the first place.
//
// 3. Restart comes back to the default opening state with the Jarvis window visible and does NOT ask
//    the user to register or enter a password. Somebody whose app just died does not then get an
//    interrogation.
//
// 4. NOBODY AT THE KEYBOARD MEANS NO DIALOG. This component is only mounted when the window is
//    actually visible — main decides, see the mount condition in App.tsx. Unattended, the app closes
//    silently: no dialog, no screenshot, no report.
import { useEffect } from "react";

interface Props {
  /** The module or area that threw, named plainly. */
  where: string;
  /** Reference and screenshot already taken at the moment of the error. */
  begun: { reference: string; thumb: string | null };
  /** Hands the reference and shot straight to the report form — no second, later capture. */
  onReport: () => void;
  /** Dismiss and destroy the screenshot. */
  onDismiss: () => void;
}

export default function CrashDialog({ where, begun, onReport, onDismiss }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") onDismiss(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return (
    <div className="overlay" onClick={onDismiss}>
      <div
        className="fb-modal crash"
        role="alertdialog"
        aria-modal="true"
        aria-label="Something went wrong"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="fb-crashhead">
          <span className="fb-crashdot" aria-hidden="true" />
          <h3>Something went wrong</h3>
        </div>
        <p className="fb-sub">
          The app hit an error in <b>{where}</b> and had to stop what it was doing.
        </p>
        <div className="fb-acts">
          <button
            className="fb-btn"
            onClick={() => {
              // Discard before relaunching. A restart that leaves the declined picture behind is the
              // same failure as parking it, just harder to notice.
              void window.api.feedback.discard(begun.reference).catch(() => undefined);
              window.api.feedback.restart();
            }}
          >
            Restart the app
          </button>
          <span className="fb-spacer" />
          <button className="fb-btn" onClick={onDismiss}>Continue</button>
          <button className="fb-btn primary" autoFocus onClick={onReport}>Send a report</button>
        </div>
      </div>
    </div>
  );
}
