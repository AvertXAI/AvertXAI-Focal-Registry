/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Terminal-style boot mask — prints a staged boot script (~1.5s) over the shell mount, with the
// Config-as-Data module rows woven in. Success hands off via onComplete; a Config-as-Data read
// failure prints the [FATAL] script and hands off via onFail (the shell then boots Safe Mode:
// chrome with an empty module list and a persistent retry banner).
import { useEffect, useMemo, useState } from "react";
import type { ModuleRow } from "../shared/types";

const LINE_MS = 400; // per-line cadence — snappy premium: readable steps, never blocking
const DONE_MS = 1500; // hold on "> Rendering Interface..." before dropping into the shell
const FAIL_MS = 1500; // pause after the last failure line so the user can read it

interface Line {
  text: string;
  tone?: "dim" | "err" | "warn" | "hold" | "load"; // default (no tone) = terminal green; "load" = whole-line straight orange (ruled 08-30-2026)
  slug?: string; // module rows only — how holdSlug finds its line WITHOUT counting the preamble
}

interface Props {
  modules: ModuleRow[] | null; // null = still loading; lines regrow when rows arrive
  /** Workspace name (app_settings org_name). null = not yet resolved — typing HOLDS until it
      lands (same Promise as modules), so the lead line always shows the real name, never a flash. */
  orgName: string | null;
  error: string | null; // non-null switches to the failure script
  /** THE STOP-AND-LOAD PLAN (ruled 08-31-2026: "it should stop here, and load mindmerges
      contents, THEN move on to the next module"). Slugs of modules with saved data, in this
      script's own line order. The typing STOPS on each planned module's line — whole line
      straight orange, dots animating — fires onLoadModule for it, and advances only when
      loadStatus marks that slug "done". The line then flips to "loaded." in place. */
  loadPlan: string[];
  loadStatus: Record<string, "loading" | "done">;
  /** Fired (idempotently — the parent ref-guards re-fires) when the script stops on a planned
      module's line: run that ONE module's load and flip its loadStatus to "done". */
  onLoadModule: (slug: string) => void;
  /** Slug of a module whose line the script STOPS on — it prints as "... setup required" and the
      typing loop holds there indefinitely, with no timeout and no fallback, until the parent sets
      this back to null. Matched by SLUG, never by position: the script's order is `display_order`
      straight out of the database and has already surprised once. null = type straight through. */
  holdSlug: string | null;
  /** Fired ONCE, at the moment the script actually stops on the held line — not when the parent
      decides a hold is needed. Those are different moments and the gap is the whole boot script:
      whatever the parent puts on screen in response must not appear until the user has watched the
      boot get there, or the wizard covers a terminal that has barely started. */
  onHold: () => void;
  onComplete: () => void;
  onFail: () => void;
}

export default function BootTerminal({ modules, orgName, error, loadPlan, loadStatus, onLoadModule, holdSlug, onHold, onComplete, onFail }: Props) {
  const failed = error !== null;
  // Latched, never cleared: this boot stopped for setup at some point. It survives holdSlug going
  // back to null, which is what lets the resumed script end on "> Opening Secured Vault..." — the
  // line only makes sense on a boot that actually held.
  const [held, setHeld] = useState(false);
  const lines = useMemo<Line[]>(
    () =>
      failed
        ? [
            { text: "> Initializing AvertXAI Shell..." },
            { text: `[FATAL] Config-as-Data read failed: ${error}`, tone: "err" },
            { text: "> Connection lost or corrupted." },
            { text: "[warn] modules unavailable — booting safe mode", tone: "warn" },
          ]
        : [
            // The workspace identity (TopBar crumb name) IS the shell being initialized. The ??
            // fallback can only render if the gate below is ever bypassed — belt and suspenders.
            { text: `> Initializing ${orgName ?? "AvertXAI"} Shell...` },
            { text: "> Loading platform configurations..." },
            { text: "Connecting to local sqlite... OK", tone: "dim" },
            { text: "> Parsing 'modules' table..." },
            ...(modules ?? []).map((m): Line => {
              if (m.slug === holdSlug) return { text: `   - Mod: ${m.name} ... setup required`, tone: "hold", slug: m.slug };
              // A planned module not yet done is LOADING from the moment its line appears — whole
              // line straight orange, dots animated (the .bt-dots span below). "in the plan and
              // not done" rather than "status says loading" so the very first paint of the line
              // is already orange, before the parent's state write lands. It flips to "loaded."
              // IN PLACE when done — same index, so the hold arithmetic never shifts.
              if (loadPlan.includes(m.slug) && loadStatus[m.slug] !== "done") return { text: `   - Mod: ${m.name} loading`, tone: "load", slug: m.slug };
              return { text: `   - Mod: ${m.name} loaded.`, tone: "dim", slug: m.slug };
            }),
            { text: "> Rendering Interface..." },
            ...(held ? [{ text: "> Opening Secured Vault...", tone: "dim" } as Line] : []),
          ],
    [modules, orgName, error, failed, holdSlug, held, loadPlan, loadStatus]
  );
  const [shown, setShown] = useState(0);
  // -1 when there is nothing to hold for, and ALSO when holdSlug names a module that is not in the
  // list (disabled, or not seeded). A slug the script never prints must not stall the boot forever.
  const holdIndex = useMemo(() => (holdSlug === null ? -1 : lines.findIndex((l) => l.slug === holdSlug)), [lines, holdSlug]);

  useEffect(() => {
    // Gate: hold the typing loop (cursor blinks) until the workspace name resolves — it arrives in
    // the same settings Promise as the module rows, so this never waits longer than the data read.
    // A failed read bypasses the gate (the FATAL script doesn't use the name).
    if (!failed && orgName === null) return;
    // Second gate, same primitive: stop with the held line VISIBLE (shown === holdIndex + 1) and
    // stay there. No timer is set, so nothing can advance past it — the only way out is the parent
    // clearing holdSlug, which re-runs this effect and resumes typing from where it stopped. That
    // is deliberate: a timeout here would let the user into a vault still holding its seeded
    // password, which is the exact state the wizard exists to end.
    if (!failed && holdIndex >= 0 && shown > holdIndex) {
      // Guarded so it fires once. The parent is told HERE, with the held line already painted, so
      // the wizard opens over a boot the user has watched run — not over an empty terminal.
      if (!held) {
        setHeld(true);
        onHold();
      }
      return;
    }
    // Third gate, same primitive (ruled 08-31-2026: "stop here, and load … THEN move on"): REAL
    // WORK, one module at a time. The first planned module line that is visible but not yet done
    // stops the script ON that line — orange, dots breathing, cursor blinking beneath — while its
    // load runs. No timer is set; the parent flipping that slug to "done" re-runs this effect,
    // the line flips to "loaded." in place, and typing advances to the next line (which may be
    // the next planned module — each stop repeats this gate). Matched by SLUG, never position.
    const loadingIndex = lines.findIndex((l) => l.slug && loadPlan.includes(l.slug) && loadStatus[l.slug] !== "done" && l.slug !== holdSlug);
    if (!failed && loadingIndex >= 0 && shown > loadingIndex) {
      onLoadModule(lines[loadingIndex].slug as string);
      return;
    }
    const done = shown >= lines.length;
    const t = window.setTimeout(
      () => (done ? (failed ? onFail() : onComplete()) : setShown(shown + 1)),
      done ? (failed ? FAIL_MS : DONE_MS) : LINE_MS
    );
    return () => window.clearTimeout(t);
  }, [shown, lines, failed, orgName, holdIndex, held, loadPlan, loadStatus, holdSlug, onLoadModule, onHold, onComplete, onFail]);

  return (
    <div className="bootterm">
      {/* left-aligned line block inside the centered flexbox; fixed height so the box is
          allocated up front and lines type downward in place instead of re-centering */}
      <div style={{ textAlign: "left", minWidth: "400px", height: "300px" }}>
        {lines.slice(0, shown).map((l, i) => (
          <div key={i} className={l.tone ? `bt-${l.tone}` : undefined}>
            {l.text}
            {l.tone === "load" && <span className="bt-dots" />}
          </div>
        ))}
        <span className="bt-cursor" />
      </div>
    </div>
  );
}
