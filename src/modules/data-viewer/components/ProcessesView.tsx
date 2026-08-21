// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Data Viewer → Processes. Live view of this app's Electron process tree with an end
//              control. Developer mode only — the tab is hidden without it and every channel it
//              calls refuses without it.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: src/modules/data-viewer/components/ProcessesView.tsx
//------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProcRow } from "../../../shared/types";

/** Colour per priority rung. Importance, never usage — see the service for why. */
const COLOUR: Record<string, string> = {
  MAIN: "var(--mc-danger, #e0565c)",
  renderer: "var(--mc-accent-primary)",
  "gpu-process": "#2bb5c4",
  utility: "#d4a843",
  node: "var(--mc-dimmer)",
};

const REFRESH_MS = 2000;

export default function ProcessesView() {
  const [rows, setRows] = useState<ProcRow[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // The poll must not outlive the tab. Without this the interval keeps spawning a PowerShell read
  // every two seconds after the user has navigated away, forever.
  const alive = useRef(true);

  const load = useCallback((): void => {
    void window.api.procmon
      .list()
      .then((r) => { if (alive.current) setRows(r); })
      .catch(() => { if (alive.current) setRows([]); });
  }, []);

  useEffect(() => {
    alive.current = true;
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { alive.current = false; clearInterval(t); };
  }, [load]);

  const run = (fn: () => Promise<unknown>, done: string): void => {
    setBusy(true);
    void fn()
      .then(() => { setNote(done); setPicked(new Set()); load(); })
      .catch((e: unknown) => setNote(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  if (rows === null) return <div className="pm-state">Reading the process tree…</div>;

  const live = rows.filter((r) => r.role !== "node");
  const instances = rows.filter((r) => r.role === "MAIN").length;
  const totalMb = rows.reduce((a, r) => a + r.memoryMb, 0);
  const stale = rows.filter((r) => r.packaged && !r.isSelf);
  const others = live.filter((r) => !r.isSelf);

  const toggle = (pid: number): void => {
    const next = new Set(picked);
    if (next.has(pid)) next.delete(pid); else next.add(pid);
    setPicked(next);
  };

  return (
    <div className="pm-wrap">
      <div className="pm-stats">
        <div className="pm-stat"><span className="k">Instances</span><span className="v">{instances}</span></div>
        <div className="pm-stat"><span className="k">Processes</span><span className="v">{rows.length}</span></div>
        <div className="pm-stat"><span className="k">Memory</span><span className="v">{totalMb} MB</span></div>
        <div className="pm-stat"><span className="k">Selected</span><span className="v">{picked.size}</span></div>
      </div>

      {/* The single reason this surface exists. Dev and the installed app share %APPDATA% and one
          single-instance lock, so a surviving packaged process refocuses a stale window and a device
          gate passes against the wrong bundle. */}
      {stale.length > 0 && (
        <div className="pm-warn">
          <b>Focal Registry.exe is running.</b> It shares the single-instance lock with development,
          so the window you are looking at may be the old packaged build rather than yours. End it
          before you gate.
        </div>
      )}

      <div className="pm-bar">
        <span className="pm-cardtitle">Live — sorted by priority, not usage</span>
        <span className="pm-spacer" />
        <button className="dv-btn danger" disabled={busy || picked.size === 0}
          onClick={() => run(() => Promise.all([...picked].map((p) => window.api.procmon.kill(p))), `Ended ${picked.size} process(es).`)}>
          End selected
        </button>
        <button className="dv-btn danger" disabled={busy || others.length === 0}
          onClick={() => run(() => window.api.procmon.killOthers(), "Every other instance ended. This one is still running.")}
          title="Ends every OTHER instance. This app is never a target — see the note below.">
          End the others ({others.length})
        </button>
      </div>

      {note && <div className="pm-note">{note}</div>}

      <div className="pm-scroll">
        <table className="pm-table">
          <thead><tr>
            <th style={{ width: 34 }} />
            <th style={{ width: 58 }}>Rank</th>
            <th>Role</th>
            <th style={{ width: 80 }}>PID</th>
            <th style={{ width: 80 }}>Parent</th>
            <th style={{ width: 96 }}>Memory</th>
            <th style={{ width: 110 }}>State</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.pid} className={`${picked.has(r.pid) ? "picked" : ""} ${r.isSelf ? "isself" : ""}`}>
                <td>
                  {/* Self has no checkbox at all. A disabled one invites the click that a disabled
                      control then has to explain; absence needs no explanation. */}
                  {!r.isSelf && (
                    <input type="checkbox" checked={picked.has(r.pid)} onChange={() => toggle(r.pid)}
                      aria-label={`Select process ${r.pid}`} />
                  )}
                </td>
                <td><span className="pm-rank" style={{ color: COLOUR[r.role], borderColor: COLOUR[r.role] }}>P{r.rank}</span></td>
                <td>
                  <span className="pm-role">
                    <i className="pm-dot" style={{ background: COLOUR[r.role] }} />
                    {r.role}<span className="pm-exe">{r.name}</span>
                  </span>
                </td>
                <td className="pm-mono">{r.pid}</td>
                <td className="pm-mono pm-dim">{r.parentPid}</td>
                <td className="pm-mono">{r.memoryMb} MB</td>
                <td>
                  {r.isSelf
                    ? <span className="pm-pill self">This app</span>
                    : r.packaged
                      ? <span className="pm-pill stale">Stale build</span>
                      : <span className="pm-pill run">Running</span>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="pm-state">Nothing running.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="pm-hint">
        <b>Priority is importance, never usage.</b> A renderer using four hundred megabytes still sorts
        below the main process, because this table answers “what is holding the gate”, not “what is heavy”.
        <br />
        <b>This app is never ended by “End the others”.</b> It is in its own list, and a literal kill-everything
        would hard-kill the process running the click — skipping <span className="pm-mono">will-quit</span> and
        therefore <span className="pm-mono">closeAllDbs()</span>, leaving every database handle unclosed with no
        checkpoint, and skipping Scout Viewer’s scroll checkpoint. To close this one, close it normally.
      </div>
    </div>
  );
}
