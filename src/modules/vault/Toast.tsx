/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// A brief, non-blocking message in the corner. Built for the scheduled-compaction notice (Jason
// 08-12-2026: "shows a green toast that says something like Focal Registry memory compacted").
//
// WHAT IT IS FOR, and what it is NOT: this reports something that already finished successfully and
// needs no decision. Anything the user must ACT on is a banner or a modal — a message that vanishes
// after four seconds is the wrong home for a failure, because the one person who needed to read it
// is the one who looked away.
//
// It carries `role="status"` and `aria-live="polite"`, so a screen reader announces it at the next
// pause rather than interrupting, which is the right urgency for "housekeeping happened".
import { useEffect, useState } from "react";

export interface ToastProps {
  message: string;
  /** Milliseconds on screen before it fades itself out. */
  ms?: number;
  onDone: () => void;
}

export default function Toast({ message, ms = 4200, onDone }: ToastProps) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    // Two timers on purpose: one starts the fade, the second unmounts once it has played. Unmounting
    // straight away would make the animation invisible.
    const fade = setTimeout(() => setLeaving(true), ms);
    const gone = setTimeout(onDone, ms + 320);
    return () => { clearTimeout(fade); clearTimeout(gone); };
  }, [ms, onDone]);

  return (
    <div className={`vault-toast${leaving ? " leaving" : ""}`} role="status" aria-live="polite">
      <span className="vault-toastdot" aria-hidden="true" />
      <span>{message}</span>
      <button className="vault-toastx" title="Dismiss" onClick={onDone}>✕</button>
    </div>
  );
}
