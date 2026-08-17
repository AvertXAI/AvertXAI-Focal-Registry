/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// THE FULL-WINDOW LOADING SCRIM. Dead centre over the ENTIRE application — above every pane, above
// the nav rail, above the topbar — because the thing it covers is the whole window being busy, and
// a spinner tucked inside one pane does not answer "is this app alive".
//
// SHELL-LANE, authorized by Jason 08-17-2026 for this purpose only. It is a shared component with no
// module knowledge: callers raise it with a caption and lower it in a `finally`.
//
// NO PERCENTAGES AND NO FAKE PROGRESS. A bar that invents its own position is worse than a spinner —
// it makes a promise about how long this will take that nothing here can keep. One caption line, one
// spinner, and it goes away.
//
// IT CANNOT STRAND ANYONE. Two independent guarantees: every caller lowers it in a `finally`, and
// this component enforces a hard ceiling of its own (see LOADING_CEILING_MS in App.tsx). A modal
// scrim that outlives its operation locks the user out of their own application, and that failure
// costs far more than a spinner that vanishes early.
import { useEffect, useState } from "react";

export interface AppLoadingProps {
  /** One line, plain language, present tense — "Loading scan report…". */
  caption: string;
  /** Delay before the scrim appears. An operation that finishes in 120 ms should not flash a scrim
   *  on and off; one that takes two seconds must not look frozen for the first two. */
  delayMs?: number;
}

export default function AppLoading({ caption, delayMs = 180 }: AppLoadingProps) {
  const [show, setShow] = useState(delayMs === 0);
  useEffect(() => {
    if (delayMs === 0) return;
    const t = setTimeout(() => setShow(true), delayMs);
    return () => clearTimeout(t);
  }, [delayMs]);
  if (!show) return null;
  return (
    <div className="apploading" role="status" aria-live="polite" aria-busy="true">
      <div className="apploading-card">
        <span className="apploading-spinner" aria-hidden="true" />
        <span className="apploading-caption">{caption}</span>
      </div>
    </div>
  );
}
