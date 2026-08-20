// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: The two keys every setup wizard step answers to — Enter advances, Escape quits.
//              Shared rather than copied because Escape here QUITS THE APPLICATION, and a second
//              copy of that is a second chance for one of them to drift into something milder.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: src/components/setupKeys.ts
//------------------------------------------------------------
import { useEffect, useRef } from "react";

/**
 * ENTER ADVANCES, ESCAPE QUITS — on every step, of every setup wizard.
 *
 * ENTER NEVER SKIPS ANYTHING. `onEnter` is handed the decision, not the outcome: each wizard checks
 * its own step and either advances or says what is missing. This hook does not know what "valid"
 * means and must not learn — a keyboard shortcut that could bypass a required field is a keyboard
 * shortcut that ships a half-configured install.
 *
 * ENTER ON A FOCUSED BUTTON IS LEFT ALONE. The browser already activates it, so handling the key
 * here too would run Generate-one AND advance the step from one press.
 *
 * ESCAPE IS A REAL QUIT, deliberately, and it is live even while a save is in flight. A wizard is
 * the one surface with no shell behind it: there is nowhere to cancel back TO. Main quits outright
 * rather than hiding to tray, or the user would be left with a tray icon and no way in.
 */
export function useSetupKeys(onEnter: () => void): void {
  // Held in a ref so the listener binds once instead of re-binding on every keystroke — `onEnter`
  // closes over the wizard's live state and is a new function each render.
  const enter = useRef(onEnter);
  enter.current = onEnter;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        window.api.setupQuit();
        return;
      }
      if (e.key !== "Enter" || e.repeat) return;
      if ((e.target as HTMLElement | null)?.tagName === "BUTTON") return; // the button's own press wins
      e.preventDefault();
      enter.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
