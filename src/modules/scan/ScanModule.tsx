// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Scan module UI. Three mockup surfaces in one component driven by run state —
//              Option A (guided estimate) → Option C (live console) → Option B (populated
//              dashboard). Talks to the engine ONLY via window.api.scan; subscribes to the
//              throttled scan:progress push and rejoins any run still in flight on mount (jobs
//              survive navigating away). Behaviour follows canon, layout follows the approved
//              mockup. The completion state opens the REAL report this scan wrote — never a stub.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: src/modules/scan/ScanModule.tsx
//------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from "react";
import type { ScanFolderSummary, ScanProgress, ScanRunRow, ScanVolume } from "../../shared/types";
import { bumpRender } from "../../diag";
import "./scan.css";

type Tab = "new" | "history" | "reports";
type LogLine = { at: string; kind: "folder" | "warn" | "check"; text: string };
const MAX_LOG_LINES = 200; // console keeps the tail only — a multi-hour run must not grow the heap

const IN_FLIGHT = new Set(["counting", "probing", "estimating", "running", "paused"]);
const SCANNING = new Set(["running", "paused"]);
const isTerminal = (s: string): boolean => ["completed", "aborted", "crashed", "error"].includes(s);

function fmtBytes(n: number | null | undefined): string {
  if (!n || n <= 0) return "—";
  if (n >= 1024 ** 4) return `${(n / 1024 ** 4).toFixed(2)} TB`;
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024).toFixed(0)} KB`;
}
function fmtDateRange(a: string | null, b: string | null): string {
  const d = (s: string | null): string => (s ? s.slice(0, 10) : "");
  if (!a && !b) return "—";
  return `${d(a)} → ${d(b)}`;
}
function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

export default function ScanModule() {
  bumpRender("scan"); // DIAG-2
  const [tab, setTab] = useState<Tab>("new");
  const [drives, setDrives] = useState<ScanVolume[]>([]);
  const [selected, setSelected] = useState<ScanVolume | null>(null);
  const [runs, setRuns] = useState<ScanRunRow[]>([]);
  const [lastRun, setLastRun] = useState<ScanRunRow | null>(null); // last run for the selected drive
  const [folders, setFolders] = useState<ScanFolderSummary[]>([]);
  const [probeRunId, setProbeRunId] = useState<number | null>(null); // the run we counted/are scanning
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef<number | null>(null);
  const rateWindow = useRef<Array<{ t: number; files: number }>>([]); // trailing window for ETA
  const [, forceTick] = useState(0);

  // Elapsed ticker while a run is live.
  useEffect(() => {
    if (activeRunId === null) return;
    const id = window.setInterval(() => forceTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [activeRunId]);

  const refreshRuns = useCallback(async () => {
    try {
      setRuns(await window.api.scan.listRuns());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Mount: enumerate drives, load run history, and REJOIN any run still in flight (survives
  // navigating away — the engine kept running; we reattach to its progress).
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [dv, rs] = await Promise.all([window.api.scan.listDrives(), window.api.scan.listRuns()]);
        if (!alive) return;
        setDrives(dv);
        setRuns(rs);
        const live = rs.find((r) => IN_FLIGHT.has(r.status));
        if (live) {
          // Rejoin the in-flight run — the console renders off the progress push, not off a
          // selected drive, so a scan started before navigating away reappears immediately.
          setActiveRunId(live.id);
          startedAt.current = live.started_at ? Date.parse(live.started_at) : Date.now();
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { alive = false; };
  }, []);

  // Subscribe to the throttled progress push for the WHOLE module lifetime.
  useEffect(() => {
    const onProgress = (p: ScanProgress): void => {
      setProgress(p);
      setActiveRunId(IN_FLIGHT.has(p.status) ? p.runId : null);
      if (SCANNING.has(p.status)) {
        // Trailing window for a measured throughput ETA (never a fixed assumption).
        const w = rateWindow.current;
        w.push({ t: Date.now(), files: p.filesRecorded });
        while (w.length > 8) w.shift();
      }
      if (p.currentFolder && (SCANNING.has(p.status) || p.status === "counting")) {
        setLog((prev) => {
          const line: LogLine = { at: new Date().toLocaleTimeString(), kind: "folder", text: p.currentFolder as string };
          return [...prev.slice(-(MAX_LOG_LINES - 1)), line];
        });
      }
      if (isTerminal(p.status)) {
        void refreshRuns();
        if (p.reportError) setError(`Report could not be written: ${p.reportError}. The scan is complete and its data is saved.`);
      }
    };
    window.api.on<ScanProgress>("scan:progress", onProgress);
    return () => window.api.off<ScanProgress>("scan:progress", onProgress);
  }, [refreshRuns]);

  // When a drive is selected, look up its last run (by serial — identity, not letter) + folders.
  useEffect(() => {
    if (!selected) { setLastRun(null); setFolders([]); return; }
    let alive = true;
    void (async () => {
      try {
        const lr = await window.api.scan.lastRunForVolume(selected.serial);
        if (!alive) return;
        setLastRun(lr);
        setFolders(lr && lr.status === "completed" ? await window.api.scan.folders(lr.id) : []);
      } catch {
        // The prior-run lookup is a convenience, not load-bearing — its failure must NEVER take
        // over the page. Degrade to "no prior run" (the drive reads as never-scanned) so a drive
        // can still be scanned. (A stale dev bundle missing this handler lands here harmlessly.)
        if (alive) { setLastRun(null); setFolders([]); }
      }
    })();
    return () => { alive = false; };
  }, [selected]);

  const doProbe = async (): Promise<void> => {
    if (!selected) return;
    setBusy(true); setError(null); setProgress(null); setLog([]);
    try {
      // Kicks off the EXACT counting walk; returns immediately. Counts arrive over scan:progress.
      const r = await window.api.scan.probe(`${selected.letter}\\`, "drive");
      setProbeRunId(r.runId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const startRun = async (): Promise<void> => {
    if (probeRunId === null) return;
    setBusy(true); setError(null); setLog([]); rateWindow.current = [];
    try {
      await window.api.scan.start(probeRunId);
      setActiveRunId(probeRunId);
      startedAt.current = Date.now();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const abortRun = async (): Promise<void> => {
    if (activeRunId === null) return;
    try { await window.api.scan.abort(activeRunId); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const pauseRun = async (): Promise<void> => {
    if (activeRunId === null) return;
    try { await window.api.scan.pause(activeRunId); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const resumeRun = async (): Promise<void> => {
    const id = activeRunId ?? progress?.runId;
    if (id == null) return;
    try { await window.api.scan.resume(id); startedAt.current = startedAt.current ?? Date.now(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const viewReport = async (runId: number): Promise<void> => {
    const r = await window.api.scan.openReport(runId);
    if (!r.ok) setError(r.error ?? "No report to open.");
  };
  const openReportsFolder = (runId: number): void => { void window.api.scan.openReportsFolder(runId); };

  const elapsedMs = startedAt.current ? Date.now() - startedAt.current : 0;
  const st = progress?.status;
  const counting = st === "counting";
  const estimating = st === "estimating";
  const running = progress != null && SCANNING.has(st ?? "") && activeRunId !== null;
  // REAL arithmetic — denominator is the exact media count; no 99% clamp, reaches 100 at the end.
  const total = progress?.estimatedFiles ?? null;
  const pct = total && total > 0 ? Math.min(100, Math.round((progress!.filesRecorded / total) * 100)) : null;
  // ETA from measured throughput over the trailing window (rough guide, never a fixed assumption).
  const eta = ((): string | null => {
    if (!running || !total) return null;
    const w = rateWindow.current;
    if (w.length < 2) return null;
    const dt = (w[w.length - 1].t - w[0].t) / 1000;
    const df = w[w.length - 1].files - w[0].files;
    if (dt <= 0 || df <= 0) return null;
    const remaining = Math.max(0, total - progress!.filesRecorded);
    return fmtElapsed((remaining / (df / dt)) * 1000);
  })();

  const driveState = (d: ScanVolume): "ok" | "off" | "never" =>
    d.serial === selected?.serial ? "ok" : "off";

  return (
    <main className="view shown">
      <div className="wrap scan-shell">
        <h1 className="pagetitle">Scan</h1>
        <p className="subtitle">Backup drive scanner — a blueprint of what is inside your folders. Read-only; never renames or deletes.</p>

        <div className="scan-tabs">
          {(["new", "history", "reports"] as Tab[]).map((t) => (
            <button key={t} className={`scan-tab${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>
              {t === "new" ? "New scan" : t === "history" ? "History" : "Reports"}
            </button>
          ))}
        </div>

        {error && <div className="scan-card2 scan-note" style={{ marginBottom: 14 }}>{error}</div>}

        {tab === "new" && (
          <div className="scan-split">
            {/* LEFT — drives list (Option B), always visible */}
            <div className="scan-drives">
              <div className="scan-drives-head"><span className="scan-mlabel">Drives</span></div>
              {drives.length === 0 && <div className="scan-sub">No drives detected. Connect a source drive.</div>}
              {drives.map((d) => (
                <button key={d.serial} className={`scan-drv${selected?.serial === d.serial ? " on" : ""}`} onClick={() => { setSelected(d); setProbeRunId(null); setProgress(null); }}>
                  <span className={`scan-dot ${driveState(d)}`} />
                  <span>
                    <span style={{ display: "block" }}>{d.letter}\ {d.label || "(no label)"}</span>
                    <span className="sub">{d.serial} · {fmtBytes(d.totalBytes)}</span>
                  </span>
                </button>
              ))}
            </div>

            {/* RIGHT — stage, chosen by run state (a live run wins over any selection) */}
            <div className="scan-stage">
              {running && (
                <RunningConsole progress={progress!} pct={pct} elapsed={fmtElapsed(elapsedMs)} eta={eta} log={log}
                  onAbort={abortRun} onPause={pauseRun} onResume={resumeRun} />
              )}

              {!running && counting && (
                <div className="scan-card">
                  <div className="scan-mlabel" style={{ marginBottom: 9 }}>Step 1 of 2 · Counting</div>
                  <div className="scan-h">Counting the drive…</div>
                  <p className="scan-sub" style={{ marginBottom: 14 }}>
                    Walking every folder to get an exact count before scanning. This is not a percentage yet.
                  </p>
                  <div className="scan-grid4">
                    <div className="scan-card2"><div className="scan-mlabel">Folders found</div><div className="scan-stat">{progress!.foldersCommitted.toLocaleString()}</div></div>
                    <div className="scan-card2"><div className="scan-mlabel">Media files found</div><div className="scan-stat">{(progress!.estimatedFiles ?? 0).toLocaleString()}</div></div>
                  </div>
                  <div className="scan-mono scan-sub" style={{ marginTop: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{progress!.currentFolder ?? ""}</div>
                  <div className="scan-row" style={{ marginTop: 14 }}><button className="scan-btn ghost" onClick={abortRun}>Cancel</button></div>
                </div>
              )}

              {!running && !counting && estimating && (
                <EstimateCard drive={selected!} folders={progress!.foldersCommitted} mediaFiles={progress!.estimatedFiles ?? 0}
                  busy={busy} onStart={startRun} onAbort={() => { setProbeRunId(null); setProgress(null); }} />
              )}

              {!running && !counting && !estimating && !selected && <div className="scan-card scan-empty">Select a drive to scan or review.</div>}

              {selected && !running && !counting && !estimating && progress && isTerminal(progress.status) && progress.runId === probeRunId && (
                <CompletionCard status={progress.status} reportPath={progress.reportPath ?? lastRun?.report_path ?? null}
                  onView={() => viewReport(progress.runId)} onFolder={() => openReportsFolder(progress.runId)}
                  onRescan={() => { setProbeRunId(null); setProgress(null); void doProbe(); }} />
              )}

              {selected && !running && !counting && !estimating && !(progress && progress.runId === probeRunId && isTerminal(progress.status)) && lastRun?.status === "completed" && (
                <PopulatedDashboard drive={selected} run={lastRun} folders={folders}
                  onView={() => viewReport(lastRun.id)} onFolder={() => openReportsFolder(lastRun.id)} onRescan={doProbe} busy={busy} />
              )}

              {selected && !running && !counting && !estimating && !(progress && isTerminal(progress.status)) && (!lastRun || lastRun.status !== "completed") && (
                <div className="scan-card">
                  <div className="scan-h">{selected.letter}\ {selected.label || "(no label)"}</div>
                  <p className="scan-sub" style={{ marginBottom: 14 }}>
                    {lastRun ? `Last run ended '${lastRun.status}'.` : "Never scanned."} Serial {selected.serial} · {fmtBytes(selected.freeBytes)} free of {fmtBytes(selected.totalBytes)}.
                  </p>
                  <button className="scan-btn go" onClick={doProbe} disabled={busy}>{busy ? "Counting…" : "Count & estimate"}</button>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "history" && <HistoryTable runs={runs} onView={viewReport} />}
        {tab === "reports" && <ReportsList runs={runs} onView={viewReport} onFolder={openReportsFolder} />}
      </div>
    </main>
  );
}

function EstimateCard({ drive, folders, mediaFiles, busy, onStart, onAbort }: {
  drive: ScanVolume; folders: number; mediaFiles: number;
  busy: boolean; onStart: () => void; onAbort: () => void;
}) {
  return (
    <>
      <div className="scan-card">
        <div className="scan-mlabel" style={{ marginBottom: 9 }}>Step 2 of 2 · Ready</div>
        <div className="scan-h">Here is exactly what is on the drive.</div>
        <div className="scan-sub" style={{ marginBottom: 16 }}>
          Counted every folder on <span className="scan-mono" style={{ color: "var(--mc-text)" }}>{drive.letter}\ {drive.label}</span>. These are exact, not estimates.
        </div>
        <div className="scan-grid4" style={{ marginBottom: 16 }}>
          <div className="scan-card2"><div className="scan-mlabel">Media files</div><div className="scan-stat">{mediaFiles.toLocaleString()}</div></div>
          <div className="scan-card2"><div className="scan-mlabel">Folders</div><div className="scan-stat">{folders.toLocaleString()}</div></div>
          <div className="scan-card2"><div className="scan-mlabel">Used space</div><div className="scan-stat">{fmtBytes(drive.totalBytes - drive.freeBytes)}</div></div>
          <div className="scan-card2"><div className="scan-mlabel">Free space</div><div className="scan-stat">{fmtBytes(drive.freeBytes)}</div></div>
        </div>
        <p className="scan-sub" style={{ marginBottom: 18 }}>Leave it running and come back. Progress is written as it goes, so a crash or power cut never loses what was already scanned.</p>
        <div className="scan-row">
          <button className="scan-btn go" onClick={onStart} disabled={busy}>Start full scan</button>
          <button className="scan-btn ghost" onClick={onAbort}>Abort</button>
          <span className="scan-sub" style={{ marginLeft: 6 }}>Time to finish depends on drive speed — a running estimate appears once the scan starts.</span>
        </div>
      </div>
    </>
  );
}

function RunningConsole({ progress, pct, elapsed, eta, log, onAbort, onPause, onResume }: {
  progress: ScanProgress; pct: number | null; elapsed: string; eta: string | null; log: LogLine[];
  onAbort: () => void; onPause: () => void; onResume: () => void;
}) {
  const paused = progress.status === "paused";
  // Auto-scroll the fixed-height console to the newest line; the box height never changes, so the
  // page does not reflow (fixes the up/down jump on every progress tick).
  const termRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = termRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);
  return (
    <>
      <div className="scan-card" style={{ padding: "16px 20px" }}>
        <div className="scan-row">
          <div style={{ minWidth: 0 }}>
            <div className="scan-mlabel" style={{ marginBottom: 5 }}>Scanning</div>
            <div className="scan-mono" style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{progress.currentFolder ?? "…"}</div>
          </div>
          <div style={{ marginLeft: "auto", textAlign: "right" }}>
            <div className="scan-stat scan-mono" style={{ fontSize: 20 }}>{pct != null ? `${pct}%` : "—"}</div>
            <div className="scan-sub scan-mono" style={{ fontSize: 11 }}>{elapsed} elapsed{eta ? ` · ~${eta} left` : ""}</div>
          </div>
        </div>
        {/* Bar is ALWAYS rendered (fill 0 when unknown) so it never appears/disappears and jumps the layout. */}
        <div className="scan-bar" style={{ marginTop: 12 }}><div className="scan-fill" style={{ width: `${pct ?? 0}%` }} /></div>
        <div className="scan-row" style={{ marginTop: 12 }}>
          {paused
            ? <button className="scan-btn go" onClick={onResume}>Resume</button>
            : <button className="scan-btn ghost" onClick={onPause}>Pause</button>}
          <button className="scan-btn ghost" onClick={onAbort}>Stop</button>
          <span className="scan-sub" style={{ marginLeft: "auto" }}>{paused ? "Paused — resumes from the last committed folder" : `Writing as it goes — safe to close${eta ? " · time left is a rough guide" : ""}`}</span>
        </div>
      </div>
      <div className="scan-consolewrap">
        <div className="scan-term" ref={termRef}>
          {log.length === 0 && <div className="t">Waiting for the first folder…</div>}
          {log.map((l, i) => (
            <div key={i}><span className="t">{l.at}</span> <span className="w">{l.text}</span> <span className="t">→ committed</span></div>
          ))}
        </div>
        <div className="scan-side">
          <div className="scan-card2"><div className="scan-mlabel">Files so far</div><div className="scan-stat">{progress.filesRecorded.toLocaleString()}</div></div>
          <div className="scan-card2"><div className="scan-mlabel">Folders committed</div><div className="scan-stat">{progress.foldersCommitted.toLocaleString()}</div></div>
          <div className="scan-card2"><div className="scan-mlabel">Logged issues</div><div className="scan-stat warn">{progress.errorsLogged.toLocaleString()}</div></div>
        </div>
      </div>
    </>
  );
}

function CompletionCard({ status, reportPath, onView, onFolder, onRescan }: {
  status: string; reportPath: string | null; onView: () => void; onFolder: () => void; onRescan: () => void;
}) {
  const done = status === "completed";
  return (
    <div className="scan-card">
      <div className="scan-h">{done ? "Scan complete" : status === "aborted" ? "Scan stopped" : `Scan ended: ${status}`}</div>
      <p className="scan-sub" style={{ marginBottom: 14 }}>
        {done && reportPath ? "The report was written to the drive so it travels with the archive:" : done ? "The scan finished. The report could not be written — its data is still saved and queryable." : "Everything scanned so far is committed and safe."}
      </p>
      {reportPath && <div className="scan-card2 scan-mono" style={{ marginBottom: 14, fontSize: 12, wordBreak: "break-all" }}>{reportPath}</div>}
      <div className="scan-row">
        {reportPath && <button className="scan-btn blue" onClick={onView}>View report</button>}
        <button className="scan-btn" onClick={onFolder}>Open reports folder</button>
        <button className="scan-btn ghost" onClick={onRescan}>Rescan anyway</button>
      </div>
    </div>
  );
}

function PopulatedDashboard({ drive, run, folders, onView, onFolder, onRescan, busy }: {
  drive: ScanVolume; run: ScanRunRow; folders: ScanFolderSummary[];
  onView: () => void; onFolder: () => void; onRescan: () => void; busy: boolean;
}) {
  return (
    <>
      <div className="scan-card">
        <div className="scan-row" style={{ marginBottom: 14 }}>
          <div>
            <div className="scan-h" style={{ margin: 0 }}>{drive.letter}\ {drive.label || "(no label)"}</div>
            <div className="scan-sub">Last scanned {run.finished_at?.slice(0, 10) ?? "—"} · {run.files_recorded.toLocaleString()} files</div>
          </div>
          <span className="scan-pill ok" style={{ marginLeft: "auto" }}>Up to date</span>
          <button className="scan-btn blue" onClick={onRescan} disabled={busy}>Rescan</button>
        </div>
        <div className="scan-grid4">
          <div className="scan-card2"><div className="scan-mlabel">Files</div><div className="scan-stat">{run.files_recorded.toLocaleString()}</div></div>
          <div className="scan-card2"><div className="scan-mlabel">Folders</div><div className="scan-stat">{run.folders_committed.toLocaleString()}</div></div>
          <div className="scan-card2"><div className="scan-mlabel">Logged issues</div><div className="scan-stat warn">{run.errors_logged.toLocaleString()}</div></div>
          <div className="scan-card2"><div className="scan-mlabel">Report</div>
            <div className="scan-row" style={{ marginTop: 6 }}>
              {run.report_path ? <button className="scan-btn blue" onClick={onView}>View</button> : <span className="scan-sub">none</span>}
              <button className="scan-btn ghost" onClick={onFolder}>Folder</button>
            </div>
          </div>
        </div>
      </div>
      <div className="scan-card">
        <div className="scan-mlabel" style={{ marginBottom: 6 }}>Folders — top level</div>
        {folders.length === 0 ? <div className="scan-sub">No folder rollups recorded.</div> : (
          <table className="scan-tbl">
            <thead><tr><th>Folder</th><th>Files</th><th>Date range</th><th>Top camera</th><th>Size</th></tr></thead>
            <tbody>
              {folders.slice(0, 40).map((f) => (
                <tr key={f.path}>
                  <td className="w scan-mono" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.path}</td>
                  <td className="scan-mono">{f.file_count.toLocaleString()}</td>
                  <td className="scan-mono">{fmtDateRange(f.date_min, f.date_max)}</td>
                  <td>{f.top_camera ?? "—"}</td>
                  <td className="scan-mono">{fmtBytes(f.total_bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function HistoryTable({ runs, onView }: { runs: ScanRunRow[]; onView: (id: number) => void }) {
  if (runs.length === 0) return <div className="scan-card scan-empty">No scans yet.</div>;
  return (
    <div className="scan-card">
      <table className="scan-tbl">
        <thead><tr><th>Run</th><th>Root</th><th>Status</th><th>Files</th><th>Folders</th><th>Finished</th><th>Report</th></tr></thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td className="w scan-mono">#{r.id}</td>
              <td className="scan-mono" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.root_path}</td>
              <td>{r.status}</td>
              <td className="scan-mono">{r.files_recorded.toLocaleString()}</td>
              <td className="scan-mono">{r.folders_committed.toLocaleString()}</td>
              <td className="scan-mono">{r.finished_at?.slice(0, 16) ?? "—"}</td>
              <td>{r.report_path ? <button className="scan-btn ghost" onClick={() => onView(r.id)}>View</button> : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportsList({ runs, onView, onFolder }: { runs: ScanRunRow[]; onView: (id: number) => void; onFolder: (id: number) => void }) {
  const withReports = runs.filter((r) => r.report_path);
  if (withReports.length === 0) return <div className="scan-card scan-empty">No reports written yet. Completing a scan writes one to the drive.</div>;
  return (
    <div className="scan-stage">
      {withReports.map((r) => (
        <div key={r.id} className="scan-card">
          <div className="scan-row">
            <div style={{ minWidth: 0 }}>
              <div className="scan-h" style={{ margin: 0 }}>Run #{r.id}</div>
              <div className="scan-sub scan-mono" style={{ wordBreak: "break-all" }}>{r.report_path}</div>
            </div>
            <div className="scan-row" style={{ marginLeft: "auto" }}>
              <button className="scan-btn blue" onClick={() => onView(r.id)}>View</button>
              <button className="scan-btn ghost" onClick={() => onFolder(r.id)}>Folder</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
