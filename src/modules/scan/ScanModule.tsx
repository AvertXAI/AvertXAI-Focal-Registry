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
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ScanCameraCount, ScanErrorList, ScanFolderSummary, ScanProgress, ScanRunRow, ScanVolume } from "../../shared/types";
import { formatRange, formatStamp } from "../../shared/datetime";
import { PRINT_STYLESHEET, renderReportPrintHtml } from "./reportPrint";
import { bumpRender } from "../../diag";
import "./scan.css";

type Tab = "new" | "history" | "reports";
type LogLine =
  | { kind: "folder"; at: string; path: string; files: number; bytes: number }
  | { kind: "warn"; at: string; count: number }
  | { kind: "check"; at: string; folders: number };
const MAX_LOG_LINES = 200; // console keeps the tail only — a multi-hour run must not grow the heap
const CHECKPOINT_EVERY = 25; // emit a "checkpoint" console line every N committed folders

function fmtGB(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(0)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

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
function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

// ---- report viewers (no dependency) --------------------------------------------------------
// The report is our OWN generated markdown (§4.3) — a fixed shape: YAML frontmatter, a couple of
// headings, pipe tables, italic notes, inline `code`. Two views off one small parser: a colored
// SOURCE view and a rendered READING view (the Secure-Note-style look). No editor, no markdown lib
// — canon keeps generated artifacts read-only (§3.1/§4.3). ponytail: single-palette, no theme matrix.
const RE_TOKEN = /("[^"]*")|(`[^`]*`)|(\b\d[\d,]*(?:\.\d+)?\b)/g;
function inlineTokens(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0, i = 0, m: RegExpExecArray | null;
  RE_TOKEN.lastIndex = 0;
  while ((m = RE_TOKEN.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<span key={i++} className={m[1] ? "rs" : m[2] ? "rc" : "rn"}>{m[0]}</span>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
function highlightReport(content: string): ReactNode[] {
  let inFm = false;
  return content.split("\n").map((line, i) => {
    const t = line.trim();
    let body: ReactNode;
    if (t === "---") { inFm = !inFm; body = <span className="rp">{line}</span>; }
    else if (/^#{1,6}\s/.test(t)) body = <span className="rh">{line}</span>;
    else if (/^_.*_$/.test(t)) body = <span className="ri">{line}</span>;
    else if (inFm && /^[a-z_]+:/i.test(line)) {
      const idx = line.indexOf(":");
      body = <><span className="rk">{line.slice(0, idx)}</span><span className="rp">:</span>{inlineTokens(line.slice(idx + 1))}</>;
    } else body = <>{inlineTokens(line)}</>;
    return <div key={i}>{body}</div>;
  });
}
// The PDF's HTML + stylesheet live in reportPrint.ts — a DEDICATED print renderer, separate from the
// on-screen Reading view (renderReport) so changing one never silently changes the other (§3.7).
function inlineMd(text: string): ReactNode[] {
  return text.split(/(`[^`]*`)/g).map((seg, j) =>
    seg.length > 1 && seg.startsWith("`") && seg.endsWith("`")
      ? <code key={j} className="rr-code">{seg.slice(1, -1)}</code> : seg);
}
// Render a frontmatter value for reading: JSON objects → "png 11,037 · jpg 6,837 · …"; quotes stripped.
function fmtMetaVal(raw: string): string {
  if (raw.startsWith("{")) {
    try {
      const o = JSON.parse(raw) as Record<string, unknown>;
      const parts = Object.entries(o).map(([k, v]) => `${k} (${typeof v === "number" ? v.toLocaleString() : String(v)})`);
      return parts.length ? parts.join(" · ") : "—";
    } catch { return raw; }
  }
  return raw.replace(/^"|"$/g, "");
}
const splitRow = (line: string): string[] => line.replace(/^\s*\||\|\s*$/g, "").split("|").map((c) => c.trim());
const isSep = (line: string): boolean => /^\s*\|[\s:|-]+\|?\s*$/.test(line) && line.includes("-");
function renderReport(content: string): ReactNode[] {
  const lines = content.split("\n");
  const out: ReactNode[] = [];
  let i = 0, key = 0, inFm = false;
  while (i < lines.length) {
    const line = lines[i], t = line.trim();
    if (t === "---") { inFm = !inFm; i++; continue; }
    if (inFm) {
      // Reading view shows only the rich rollups the body table lacks — non-empty object values
      // (formats, cameras, codecs). Scalar frontmatter (files, stills, dates…) is already in the
      // summary table below, so skip it here to avoid a redundant YAML wall. Source view shows all.
      const idx = line.indexOf(":");
      if (idx > 0) {
        const raw = line.slice(idx + 1).trim();
        if (raw.startsWith("{") && raw !== "{}") {
          out.push(<div className="rr-meta" key={key++}><span className="rr-mk">{line.slice(0, idx).replace(/_/g, " ")}</span><span className="rr-mv">{fmtMetaVal(raw)}</span></div>);
        }
      }
      i++; continue;
    }
    if (/^#{1,6}\s/.test(t)) {
      const level = (t.match(/^#+/) as RegExpMatchArray)[0].length;
      const text = t.replace(/^#+\s*/, "");
      out.push(level <= 1 ? <h2 className="rr-h1" key={key++}>{text}</h2> : <h3 className="rr-h2" key={key++}>{text}</h3>);
      i++; continue;
    }
    if (t.startsWith("|")) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) { rows.push(lines[i]); i++; }
      const header = splitRow(rows[0]);
      const hasHeader = rows[1] != null && isSep(rows[1]) && header.some(Boolean);
      const bodyStart = rows[1] != null && isSep(rows[1]) ? 2 : 1;
      out.push(
        <table className="rr-tbl" key={key++}>
          {hasHeader && <thead><tr>{header.map((c, j) => <th key={j}>{inlineMd(c)}</th>)}</tr></thead>}
          <tbody>{rows.slice(bodyStart).map((r, ri) => <tr key={ri}>{splitRow(r).map((c, j) => <td key={j}>{inlineMd(c)}</td>)}</tr>)}</tbody>
        </table>
      );
      continue;
    }
    if (t === "") { i++; continue; }
    if (/^_.*_$/.test(t)) { out.push(<p className="rr-note" key={key++}>{t.replace(/^_|_$/g, "")}</p>); i++; continue; }
    out.push(<p className="rr-p" key={key++}>{inlineMd(line)}</p>); i++;
  }
  return out;
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
  const [scanningSerial, setScanningSerial] = useState<string | null>(null); // volume serial of the in-flight run
  const [log, setLog] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportModal, setReportModal] = useState<{ runId: number; path: string; content: string } | null>(null);
  const [reportView, setReportView] = useState<"read" | "source">("read");
  const [exportMsg, setExportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [exporting, setExporting] = useState<"pdf" | "csv" | null>(null);
  const [reloadTick, setReloadTick] = useState(0); // bump to re-pull the selected drive's card after a nuke
  const [errorsModal, setErrorsModal] = useState<ScanErrorList | null>(null);
  const startedAt = useRef<number | null>(null);
  const rateWindow = useRef<Array<{ t: number; files: number }>>([]); // trailing window for ETA
  const prevErrors = useRef(0); // last errorsLogged seen — to emit a warn line on increase
  const prevCheckpoint = useRef(0); // last checkpoint bucket emitted
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
      const live = IN_FLIGHT.has(p.status);
      setActiveRunId(live ? p.runId : null);
      setScanningSerial(live ? p.volumeSerial : null); // which drive is busy — drives-list indicator
      if (SCANNING.has(p.status)) {
        // Trailing window for a measured throughput ETA (never a fixed assumption).
        const w = rateWindow.current;
        w.push({ t: Date.now(), files: p.filesRecorded });
        while (w.length > 8) w.shift();
      }
      if (p.currentFolder && SCANNING.has(p.status)) {
        const at = new Date().toLocaleTimeString();
        const add: LogLine[] = [{ kind: "folder", at, path: p.currentFolder, files: p.lastFolderFiles ?? 0, bytes: p.lastFolderBytes ?? 0 }];
        // warn line when new issues were logged since the last tick; checkpoint line every N folders.
        if (p.errorsLogged > prevErrors.current) add.push({ kind: "warn", at, count: p.errorsLogged - prevErrors.current });
        const chk = Math.floor(p.foldersCommitted / CHECKPOINT_EVERY);
        if (chk > prevCheckpoint.current) { prevCheckpoint.current = chk; add.push({ kind: "check", at, folders: p.foldersCommitted }); }
        prevErrors.current = p.errorsLogged;
        setLog((prev) => [...prev, ...add].slice(-MAX_LOG_LINES));
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
  }, [selected, reloadTick]);

  const doProbe = async (): Promise<void> => {
    if (!selected) return;
    setBusy(true); setError(null); setProgress(null); setLog([]);
    setScanningSerial(selected.serial); // mark this drive busy immediately (other drives disable)
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
    setBusy(true); setError(null); setLog([]); rateWindow.current = []; prevErrors.current = 0; prevCheckpoint.current = 0;
    setActiveRunId(probeRunId);
    startedAt.current = Date.now();
    // Optimistically flip to the running console the instant Start is pressed — the real 'running'
    // pushes replace this. Without it the estimate card lingers until the first throttled push.
    setProgress((p) => (p ? { ...p, status: "running", currentFolder: null } : p));
    try {
      await window.api.scan.start(probeRunId);
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

  // View report → read the markdown and show it in a modal (Secure Note ingestion is the later path).
  const viewReport = async (runId: number): Promise<void> => {
    const r = await window.api.scan.readReport(runId);
    if (r.ok && typeof r.content === "string") { setExportMsg(null); setReportModal({ runId, path: r.path ?? "", content: r.content }); }
    else setError(r.error ?? "No report to open.");
  };
  // Export the open report. PDF prints the Reading view (rendered to a static HTML string here, so it
  // exports regardless of which view tab is showing); CSV streams the folder rows in the main process.
  const exportReport = async (kind: "pdf" | "csv"): Promise<void> => {
    if (!reportModal) return;
    setExporting(kind); setExportMsg(null);
    try {
      const res = kind === "pdf"
        ? await window.api.scan.exportReportPdf(reportModal.runId, renderReportPrintHtml(reportModal.content), PRINT_STYLESHEET)
        : await window.api.scan.exportReportCsv(reportModal.runId);
      setExportMsg(res.ok ? { ok: true, text: `Saved ${res.path}` } : { ok: false, text: res.error ?? "Export failed." });
    } catch (e) {
      setExportMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally { setExporting(null); }
  };
  const openReportsFolder = (runId: number): void => { void window.api.scan.openReportsFolder(runId); };
  // History Nuke — one press, no confirm: it's a soft-clear (kept 30 days, restorable in Settings).
  // Refresh the run list AND the selected drive's card (which now reads never-scanned).
  const nukeHistory = async (): Promise<void> => {
    try {
      await window.api.scan.clearHistory();
      await refreshRuns();
      setReloadTick((n) => n + 1);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const openIssues = async (runId: number): Promise<void> => {
    try { setErrorsModal(await window.api.scan.listErrors(runId)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const elapsedMs = startedAt.current ? Date.now() - startedAt.current : 0;
  // A run's UI shows ONLY on the drive it belongs to. `mine` = the current progress is for the
  // selected drive; clicking a different drive shows THAT drive's own stage, never this run's.
  const mine = progress != null && selected != null && progress.volumeSerial === selected.serial;
  const st = mine ? progress!.status : undefined;
  const counting = st === "counting";
  const estimating = st === "estimating";
  const running = mine && SCANNING.has(st ?? "");
  const otherScanning = scanningSerial != null && scanningSerial !== selected?.serial; // a different drive is busy
  // Serials with at least one completed run — a persistent green dot on every scanned drive, whether
  // selected or not, sourced from the runs table (§4.3), not from selection state.
  const scannedSerials = new Set(runs.filter((r) => r.status === "completed").map((r) => r.volume_serial));
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
              {drives.map((d) => {
                const isScanning = d.serial === scanningSerial;
                return (
                  <button key={d.serial} className={`scan-drv${selected?.serial === d.serial ? " on" : ""}`}
                    onClick={() => { setSelected(d); if (d.serial !== scanningSerial) { setProbeRunId(null); setProgress(null); } }}>
                    <span className={`scan-dot ${isScanning ? "scanning" : scannedSerials.has(d.serial) ? "ok" : "off"}`} />
                    <span>
                      <span style={{ display: "block" }}>{d.letter}\ {d.label || "(no label)"}{isScanning ? " · scanning" : ""}</span>
                      <span className="sub">{d.serial} · {fmtBytes(d.totalBytes)}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {/* RIGHT — stage, chosen by run state (a live run wins over any selection) */}
            <div className="scan-stage">
              {running && (
                <RunningConsole progress={progress!} pct={pct} elapsed={fmtElapsed(elapsedMs)} eta={eta} log={log}
                  onAbort={abortRun} onPause={pauseRun} onResume={resumeRun} onIssues={() => openIssues(progress!.runId)} />
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

              {/* Completion card ONLY for the selected drive's own just-finished run (mine). */}
              {selected && !running && !counting && !estimating && mine && progress && isTerminal(progress.status) && progress.runId === probeRunId && (
                <CompletionCard status={progress.status} reportPath={progress.reportPath ?? lastRun?.report_path ?? null}
                  onView={() => viewReport(progress.runId)} onFolder={() => openReportsFolder(progress.runId)}
                  onRescan={() => { setProbeRunId(null); setProgress(null); void doProbe(); }} />
              )}

              {selected && !running && !counting && !estimating && !(mine && progress && progress.runId === probeRunId && isTerminal(progress.status)) && lastRun?.status === "completed" && (
                <PopulatedDashboard drive={selected} run={lastRun} folders={folders}
                  onView={() => viewReport(lastRun.id)} onFolder={() => openReportsFolder(lastRun.id)}
                  onIssues={() => openIssues(lastRun.id)} onRescan={doProbe} busy={busy || otherScanning} />
              )}

              {selected && !running && !counting && !estimating && !(mine && progress && isTerminal(progress.status)) && (!lastRun || lastRun.status !== "completed") && (
                <div className="scan-card">
                  <div className="scan-h">{selected.letter}\ {selected.label || "(no label)"}</div>
                  <p className="scan-sub" style={{ marginBottom: 14 }}>
                    {lastRun ? `Last run ended '${lastRun.status}'.` : "Never scanned."} Serial {selected.serial} · {fmtBytes(selected.freeBytes)} free of {fmtBytes(selected.totalBytes)}.
                  </p>
                  <button className="scan-btn go" onClick={doProbe} disabled={busy || otherScanning}>{busy ? "Counting…" : "Count & estimate"}</button>
                  {otherScanning && <p className="scan-sub" style={{ marginTop: 8 }}>Another drive is scanning — one scan runs at a time.</p>}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "history" && <HistoryTable runs={runs} onView={viewReport} onNuke={nukeHistory} />}
        {tab === "reports" && <ReportsList runs={runs} onView={viewReport} onFolder={openReportsFolder} />}
      </div>

      {reportModal && (
        <div className="scan-modal-back" onClick={() => setReportModal(null)}>
          <div className="scan-modal" onClick={(e) => e.stopPropagation()}>
            <div className="scan-modal-head">
              <div className="scan-h">Scan report</div>
              <div className="scan-modal-actions">
                <div className="scan-seg" role="group" aria-label="Report view">
                  <button className={`scan-seg-btn${reportView === "read" ? " on" : ""}`} onClick={() => setReportView("read")}>Reading</button>
                  <button className={`scan-seg-btn${reportView === "source" ? " on" : ""}`} onClick={() => setReportView("source")}>Source</button>
                </div>
                <div className="scan-export">
                  <span className="scan-export-label">Export:</span>
                  <button className="scan-btn" disabled={exporting !== null} onClick={() => void exportReport("pdf")}>{exporting === "pdf" ? "…" : "PDF"}</button>
                  <button className="scan-btn" disabled={exporting !== null} onClick={() => void exportReport("csv")}>{exporting === "csv" ? "…" : "CSV"}</button>
                </div>
              </div>
              <button className="scan-modal-close" aria-label="Close" style={{ marginLeft: 10 }} onClick={() => setReportModal(null)}>×</button>
            </div>
            {exportMsg && <div className={`scan-export-rail${exportMsg.ok ? " ok" : " err"}`}>{exportMsg.text}</div>}
            <div className="scan-modal-body">
              <div className="scan-sub scan-mono" style={{ marginBottom: 12, wordBreak: "break-all" }}>{reportModal.path}</div>
              {reportView === "read"
                ? <div className="scan-report-read">{renderReport(reportModal.content)}</div>
                : <div className="scan-report-md">{highlightReport(reportModal.content)}</div>}
            </div>
          </div>
        </div>
      )}

      {errorsModal && (
        <div className="scan-modal-back" onClick={() => setErrorsModal(null)}>
          <div className="scan-modal" onClick={(e) => e.stopPropagation()}>
            <div className="scan-modal-head">
              <div className="scan-h">Logged issues ({errorsModal.total.toLocaleString()})</div>
              <button className="scan-modal-close" aria-label="Close" onClick={() => setErrorsModal(null)}>×</button>
            </div>
            <div className="scan-modal-body">
              {errorsModal.total === 0 && <div className="scan-sub">No issues logged for this run.</div>}
              {errorsModal.rows.map((r, i) => (
                <div key={i} className="scan-err-row">
                  <span className="stage">{r.stage ?? "—"}</span>
                  <span>
                    <span className="epath">{r.path ?? "(no path)"}</span>
                    <span className="etext" style={{ display: "block" }}>{r.error_text ?? ""}</span>
                  </span>
                </div>
              ))}
              {errorsModal.total > errorsModal.rows.length && (
                <div className="scan-sub" style={{ marginTop: 14 }}>
                  Showing the first {errorsModal.rows.length.toLocaleString()} of {errorsModal.total.toLocaleString()} issues. The full list stays in the database.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
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

function RunningConsole({ progress, pct, elapsed, eta, log, onAbort, onPause, onResume, onIssues }: {
  progress: ScanProgress; pct: number | null; elapsed: string; eta: string | null; log: LogLine[];
  onAbort: () => void; onPause: () => void; onResume: () => void; onIssues: () => void;
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
        <div className="scan-row" style={{ flexWrap: "nowrap" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="scan-mlabel" style={{ marginBottom: 5, display: "flex", gap: 10, alignItems: "center" }}>
              <span>Scanning</span>
              {/* Always-animating heartbeat — a frozen % (big folder mid-extraction) never reads as hung. */}
              <span className={`scan-live${paused ? " paused" : ""}`}><span className="pip" />{paused ? "paused" : "working"}</span>
            </div>
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
          {log.map((l, i) => {
            if (l.kind === "warn") return (
              <div key={i}><span className="ts">{l.at}</span> <span className="warn">warn</span> <span className="w">{l.count} file{l.count === 1 ? "" : "s"} unreadable</span> <span className="t">— logged, continuing</span></div>
            );
            if (l.kind === "check") return (
              <div key={i}><span className="ts">{l.at}</span> <span className="b">checkpoint</span> <span className="t">— {l.folders.toLocaleString()} folders committed</span></div>
            );
            return (
              <div key={i}><span className="ts">{l.at}</span> <span className="w">{l.path}</span> <span className="t">→</span> <span className="ok">{l.files.toLocaleString()} files{l.bytes > 0 ? ` · ${fmtGB(l.bytes)}` : ""} · ok</span></div>
            );
          })}
        </div>
        <div className="scan-side">
          <div className="scan-card2"><div className="scan-mlabel">Files so far</div><div className="scan-stat">{progress.filesRecorded.toLocaleString()}</div></div>
          <div className="scan-card2"><div className="scan-mlabel">Folders committed</div><div className="scan-stat">{progress.foldersCommitted.toLocaleString()}</div></div>
          <div className="scan-card2"><div className="scan-mlabel">Logged issues</div><div className="scan-stat warn scan-issues-link" onClick={onIssues} title="Show the logged issues">{progress.errorsLogged.toLocaleString()}</div></div>
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

function PopulatedDashboard({ drive, run, folders, onView, onFolder, onRescan, onIssues, busy }: {
  drive: ScanVolume; run: ScanRunRow; folders: ScanFolderSummary[];
  onView: () => void; onFolder: () => void; onRescan: () => void; onIssues: () => void; busy: boolean;
}) {
  // Top-camera click-through: fetch the folder's distinct cameras and expand a detail row beneath it.
  // Toggling the same folder closes it. Inline row = no popover-positioning math (ponytail).
  const [cams, setCams] = useState<{ id: number; rows: ScanCameraCount[] } | null>(null);
  const showCameras = async (folderId: number): Promise<void> => {
    if (cams?.id === folderId) { setCams(null); return; }
    try { setCams({ id: folderId, rows: await window.api.scan.folderCameras(folderId) }); }
    catch { setCams({ id: folderId, rows: [] }); }
  };
  return (
    <>
      <div className="scan-card">
        <div className="scan-row" style={{ marginBottom: 14 }}>
          <div>
            <div className="scan-h" style={{ margin: 0 }}>{drive.letter}\ {drive.label || "(no label)"}</div>
            <div className="scan-sub">Last scanned {formatStamp(run.finished_at, "eventTime") || "—"} · {run.files_recorded.toLocaleString()} files</div>
          </div>
          <span className="scan-pill ok" style={{ marginLeft: "auto" }}>Up to date</span>
          <button className="scan-btn blue" onClick={onRescan} disabled={busy}>Rescan</button>
        </div>
        <div className="scan-grid4">
          <div className="scan-card2"><div className="scan-mlabel">Files</div><div className="scan-stat">{run.files_recorded.toLocaleString()}</div></div>
          <div className="scan-card2"><div className="scan-mlabel">Folders</div><div className="scan-stat">{run.folders_committed.toLocaleString()}</div></div>
          <div className="scan-card2"><div className="scan-mlabel">Logged issues</div><div className="scan-stat warn scan-issues-link" onClick={onIssues} title="Show the logged issues">{run.errors_logged.toLocaleString()}</div></div>
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
          <table className="scan-tbl folders">
            <colgroup><col /><col className="c-files" /><col className="c-date" /><col className="c-cam" /><col className="c-size" /></colgroup>
            <thead><tr><th>Folder</th><th>Files</th><th>Date range</th><th>Top camera</th><th>Size</th></tr></thead>
            <tbody>
              {folders.slice(0, 40).map((f) => (
                <Fragment key={f.path}>
                  <tr>
                    <td className="w scan-mono cell-link" title={`Open ${f.path}`} onClick={() => void window.api.scan.openPath(f.path)}>{f.path}</td>
                    <td className="scan-mono">{f.file_count.toLocaleString()}</td>
                    <td className="scan-mono">{formatRange(f.date_min, f.date_max, "dateOnly")}
                      {f.date_source && <span className="scan-datesrc"> ({f.date_source === "capture" ? "capture dates" : "file dates"})</span>}
                    </td>
                    <td className={f.top_camera ? "cell-link" : undefined} title={f.top_camera ? "Show all cameras in this folder" : undefined}
                        onClick={f.top_camera ? () => void showCameras(f.id) : undefined}>{f.top_camera ?? "—"}</td>
                    <td className="scan-mono">{fmtBytes(f.total_bytes)}</td>
                  </tr>
                  {cams?.id === f.id && (
                    <tr className="scan-cam-row"><td colSpan={5}>
                      {cams.rows.length === 0
                        ? <span className="scan-sub">No camera metadata recorded for this folder.</span>
                        : <div className="scan-cam-list">{cams.rows.map((c) => (
                            <span className="scan-cam-chip" key={c.camera}>{c.camera} <b>{c.count.toLocaleString()}</b></span>
                          ))}</div>}
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function HistoryTable({ runs, onView, onNuke }: { runs: ScanRunRow[]; onView: (id: number) => void; onNuke: () => void }) {
  return (
    <div className="scan-card">
      <div className="scan-row" style={{ marginBottom: 12 }}>
        <div className="scan-h" style={{ margin: 0 }}>Scan history</div>
        <button className="scan-btn danger" style={{ marginLeft: "auto" }} disabled={runs.length === 0}
          onClick={onNuke} title="Clear the history viewer — records are kept 30 days and can be restored in Settings">
          Nuke history
        </button>
      </div>
      {runs.length === 0 ? <div className="scan-empty">No scans in the viewer.</div> : (
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
              <td className="scan-mono">{formatStamp(r.finished_at, "eventTime") || "—"}</td>
              <td>{r.report_path ? <button className="scan-btn ghost" onClick={() => onView(r.id)}>View</button> : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      )}
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
