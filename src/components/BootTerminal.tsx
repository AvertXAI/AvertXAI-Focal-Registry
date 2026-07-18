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
  tone?: "dim" | "err" | "warn"; // default (no tone) = terminal green, per the mockup
}

interface Props {
  modules: ModuleRow[] | null; // null = still loading; lines regrow when rows arrive
  /** Workspace name (app_settings org_name). null = not yet resolved — typing HOLDS until it
      lands (same Promise as modules), so the lead line always shows the real name, never a flash. */
  orgName: string | null;
  error: string | null; // non-null switches to the failure script
  onComplete: () => void;
  onFail: () => void;
}

export default function BootTerminal({ modules, orgName, error, onComplete, onFail }: Props) {
  const failed = error !== null;
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
            { text: "[Config-as-Data] Connecting to local sqlite... OK", tone: "dim" },
            { text: "> Parsing 'modules' table..." },
            ...(modules ?? []).map((m): Line => ({ text: `   - Mod: ${m.name} (${m.type}) loaded.`, tone: "dim" })),
            { text: "> Rendering Interface..." },
          ],
    [modules, orgName, error, failed]
  );
  const [shown, setShown] = useState(0);

  useEffect(() => {
    // Gate: hold the typing loop (cursor blinks) until the workspace name resolves — it arrives in
    // the same settings Promise as the module rows, so this never waits longer than the data read.
    // A failed read bypasses the gate (the FATAL script doesn't use the name).
    if (!failed && orgName === null) return;
    const done = shown >= lines.length;
    const t = window.setTimeout(
      () => (done ? (failed ? onFail() : onComplete()) : setShown(shown + 1)),
      done ? (failed ? FAIL_MS : DONE_MS) : LINE_MS
    );
    return () => window.clearTimeout(t);
  }, [shown, lines.length, failed, orgName, onComplete, onFail]);

  return (
    <div className="bootterm">
      {/* left-aligned line block inside the centered flexbox; fixed height so the box is
          allocated up front and lines type downward in place instead of re-centering */}
      <div style={{ textAlign: "left", minWidth: "400px", height: "300px" }}>
        {lines.slice(0, shown).map((l, i) => (
          <div key={i} className={l.tone ? `bt-${l.tone}` : undefined}>
            {l.text}
          </div>
        ))}
        <span className="bt-cursor" />
      </div>
    </div>
  );
}
