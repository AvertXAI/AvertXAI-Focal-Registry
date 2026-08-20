/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Settings as an OVERLAY rather than a view (Jason 08-19). The active module never changes, so
// closing this returns the user exactly where they were and the ← → arrows ignore it entirely.
//
// It wraps the EXISTING src/views/Settings.tsx unchanged — every pane, toggle and business-profile
// field keeps working. This file owns only the shell: the scrim, the card, the dark chrome band and
// the dismissal.
//
// TWO THINGS THAT LOOK LIKE STYLE AND ARE NOT:
//
// 1. `.overlay` — App.tsx's body MutationObserver watches `.overlay, .scan-modal-back,
//    [data-modal-backdrop]` and dims the native caption buttons for ANY modal carrying one. That is
//    why there is no setModalDim call in this file: per-modal wiring is what kept regressing, so the
//    shell does it centrally. Do not add a second call here.
//
// 2. NO `data-modal-backdrop="viewer"` — REMOVED 08-19-2026, and it must not come back.
//    This card used to declare it and paint itself a matching near-black band, on the theory that
//    the OS caption strip was "a continuation of that band". THE GEOMETRY DISPROVES THAT. `.overlay`
//    centres its child (`align-items:center`) and this card is `height:86vh`, so there is always
//    (100-86)/2 = 7vh of bare scrim above it — 44px at the 640 floor, 72px at 1080p — against a
//    36px caption strip. The band NEVER reaches the strip at any reachable window height; what sits
//    under the native buttons is always the scrimmed topbar.
//    So this is the ordinary case: keep `.overlay` (whose rgba(4,8,16,.66) is exactly what
//    blendWithBackdrop() composites against) and let the funnel dim the ACTIVE THEME, which lands
//    the strip and the scrimmed topbar on the same hex in all three modes. The "viewer" mode stays
//    reserved for the media viewer, whose own chrome genuinely IS up there when expanded.
//    The old band was near-black in light mode too, and its #4a4642 ink on #1c1917 was 1.87:1 —
//    the caption-GLYPH colour, chosen to make buttons recede, reused as text.
//
// Escape and outside-click both dismiss, per the shell-modal rule.
import { useEffect } from "react";
import Settings from "../views/Settings";
import type { ThemeMode } from "../App";

interface Props {
  onClose: () => void;
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

export default function SettingsModal({ onClose, themeMode, onThemeChange }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-modal-chrome">
          <span className="settings-modal-title">Settings</span>
          {/* autoFocus: aria-modal="true" hides everything behind the scrim from assistive tech,
              so leaving focus parked on the ▤ button strands the caret outside the dialog.
              ponytail: initial focus only — no Tab-cycling trap, add one if Tab is reported
              escaping to the page underneath. */}
          <button className="settings-modal-close" aria-label="Close settings" autoFocus onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="settings-modal-body">
          <Settings themeMode={themeMode} onThemeChange={onThemeChange} />
        </div>
      </div>
    </div>
  );
}
