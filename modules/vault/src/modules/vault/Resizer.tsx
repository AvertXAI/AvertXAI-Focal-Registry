// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: The draggable vertical divider, shared by the sidebar and the Secured Notes list
//              (Jason 08-12-2026: "for both sidebars, the one for shortcut and secured notes, i need
//              to adjust the vertical divider, one so i can read the folder completely, and the
//              other for notes").
//
//              WHY A DRAG AND NOT A WIDER FIXED COLUMN: a 142-folder import produces names like
//              "AvertXAI-BuildersAudit-Platform". Any fixed width is wrong for somebody — wide enough
//              for those names wastes half the window for a vault with six folders. The user decides,
//              once, and it sticks.
//
//              IT CANNOT SQUEEZE THE PANE BESIDE IT OUT OF EXISTENCE. The cap is computed at
//              pointer-down from the NEIGHBOUR'S REAL WIDTH — how much slack it has above its own
//              floor — not from a guessed maximum. That is what makes this safe at the 740-pixel
//              window floor (CLAUDE.md §3.4) without a media query: at 740 the neighbour has almost
//              no slack, so the handle simply stops moving.
//
//              WIDTH IS LOCAL WHILE DRAGGING, PERSISTED ON RELEASE. A database write per pointermove
//              would be hundreds of round trips for one drag.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: src/modules/vault/Resizer.tsx
//------------------------------------------------------------
import { useEffect, useRef, useState } from "react";

export interface ResizerProps {
  /** The width the pane is at right now, in CSS pixels. */
  width: number;
  /** Narrowest this pane may become. */
  min: number;
  /** Widest, before the neighbour's slack is taken into account. */
  max: number;
  /**
   * The pane that gives up the space, and the width it must keep. Queried from the DOM at
   * pointer-down rather than passed in, because its width changes with the window and with the OTHER
   * divider — a number computed at render time would already be stale by the time you drag.
   */
  neighbour: { selector: string; min: number };
  /** Live, every pointermove — drives the layout so the drag looks like a drag. */
  onDrag: (w: number) => void;
  /** Once, on release — this is the one that writes to the database. */
  onDone: (w: number) => void;
  /** Double-click resets to this. */
  reset: number;
  /** For the tooltip and the screen reader. */
  label: string;
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.round(n)));

/**
 * Read a stored width back through the SAME clamp the drag uses.
 *
 * Clamping only on drag is not enough and this is not theoretical: the first ceilings shipped at 460
 * and 520, Jason dragged to both, and they were saved. Lowering the constants afterwards would have
 * left him sitting at the old maximum forever, because nothing re-checks a value on the way out of
 * the database. A stored width is untrusted input like any other.
 */
export function clampWidth(stored: unknown, min: number, max: number, fallback: number): number {
  const n = Number(stored);
  return Number.isFinite(n) && n > 0 ? clamp(n, min, max) : fallback;
}

export default function Resizer({ width, min, max, neighbour, onDrag, onDone, reset, label }: ResizerProps) {
  /** Where the drag began and how far it may go. Null when no drag is in progress. */
  const grab = useRef<{ x: number; w: number; cap: number } | null>(null);

  /**
   * THE DIAL (Jason 08-12-2026: "add a dial to the vertical dividers, that way I can adjust where I
   * want the line at, tell you what number it landed on, and you edit the divider to that number").
   *
   * A live pixel readout, so calibrating a width is reading a number off the screen instead of me
   * estimating one off a screenshot — which is exactly how the first ceilings came out at 460 and 520.
   *
   * IT ALSO SAYS WHEN THE NUMBER IS NOT HIS CHOICE. A dial reading 320 at the ceiling and a dial
   * reading 320 because that is where he stopped are the same digits and opposite instructions: one
   * means "raise the ceiling", the other means "set it here". So a pinned edge is labelled `max` or
   * `min`, and `cap` marks the third case — stopped early because the neighbouring pane ran out of
   * room at this window width, which is a number that would be wrong to hardcode.
   */
  const [dialY, setDialY] = useState<number | null>(null);
  const [held, setHeld] = useState(false);
  /**
   * The cap from the last drag, kept in STATE rather than read off `grab` — which is null by the
   * time the readout is lingering, i.e. exactly when it is being read. Without this the "no room"
   * tag disappears at the moment it matters and a capped number looks like a chosen one.
   */
  const [cap, setCap] = useState<number | null>(null);
  const linger = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (linger.current) clearTimeout(linger.current); }, []);

  /** Track the pointer down the strip so the readout sits where the eye already is. */
  const track = (e: React.PointerEvent): void => {
    const r = e.currentTarget.getBoundingClientRect();
    setDialY(clamp(e.clientY - r.top, 22, Math.max(22, r.height - 22)));
  };

  const at = (e: React.PointerEvent): number => {
    const g = grab.current;
    if (!g) return width;
    return clamp(g.w + (e.clientX - g.x), min, g.cap);
  };

  /** Which edge, if any, this width is sitting against. Null when it is a free choice. */
  const edge: "min" | "max" | "cap" | null =
    width <= min ? "min"
      : width >= max ? "max"
        : cap != null && width >= cap ? "cap"
          : null;

  return (
    <div
      className="vault-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={`${label} — drag to resize, double-click to reset, arrow keys for 16px steps`}
      tabIndex={0}
      // A fresh hover knows no cap — that is only measurable at pointer-down, so clear the stale one
      // rather than report a limit from a previous drag at a previous window size.
      onPointerEnter={(e) => { setCap(null); setHeld(true); track(e); }}
      onPointerLeave={() => { if (!grab.current) setHeld(false); }}
      onFocus={() => setHeld(true)}
      onBlur={() => { if (!grab.current) setHeld(false); }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault(); // or the browser starts a text selection instead of a drag
        e.currentTarget.setPointerCapture(e.pointerId);
        const sib = document.querySelector(neighbour.selector);
        // The neighbour's SLACK — everything it has above its own floor — is exactly how much this
        // pane may grow. No slack, no growth, whatever `max` says.
        const slack = sib ? Math.max(0, sib.clientWidth - neighbour.min) : 0;
        const limit = Math.min(max, width + slack);
        grab.current = { x: e.clientX, w: width, cap: limit };
        setCap(limit);
        // Two things this class does, both of which are wrong without it: it kills the .16s width
        // transition the collapse animation put on these panes (dragging against an easing curve
        // feels like the app is lagging), and it pins the col-resize cursor to the whole window so
        // it does not flicker every time the pointer strays off a 6-pixel strip mid-drag.
        document.body.classList.add("vault-resizing");
        if (linger.current) clearTimeout(linger.current);
        setHeld(true);
      }}
      onPointerMove={(e) => { track(e); if (grab.current) onDrag(at(e)); }}
      onPointerUp={(e) => {
        if (!grab.current) return;
        const w = at(e);
        grab.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
        document.body.classList.remove("vault-resizing");
        onDrag(w);
        onDone(w); // the only write
        // THE READOUT OUTLIVES THE DRAG by two and a half seconds. The number is only useful if it
        // can be read, and it cannot be read while the hand that produced it is still on the mouse
        // — releasing usually moves the pointer off a 6-pixel strip, which would blank it instantly.
        if (linger.current) clearTimeout(linger.current);
        linger.current = setTimeout(() => setHeld(false), 2500);
      }}
      onPointerCancel={() => { grab.current = null; setHeld(false); document.body.classList.remove("vault-resizing"); }}
      onDoubleClick={() => { onDrag(reset); onDone(reset); }}
      // Keyboard, because a divider that only responds to a precise drag is unusable for anyone who
      // cannot make one. Same clamps, 16 pixels a press.
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const w = clamp(width + (e.key === "ArrowRight" ? 16 : -16), min, max);
        onDrag(w);
        onDone(w);
      }}
    >
      {/* pointer-events:none is load-bearing — a readout that can be hit is a readout that swallows
          the drag it exists to report on. */}
      {held && (
        // dialY is null until a pointer has moved over the strip — a keyboard focus has no pointer,
        // so the readout parks near the top rather than not appearing at all.
        <div className="vault-dial" style={{ top: dialY ?? 40 }}>
          <b>{Math.round(width)}</b> px
          {edge === "max" && <span className="lim"> · at max {max}</span>}
          {edge === "min" && <span className="lim"> · at min {min}</span>}
          {edge === "cap" && <span className="lim"> · stopped, no room</span>}
        </div>
      )}
    </div>
  );
}
