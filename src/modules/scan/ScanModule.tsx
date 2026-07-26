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
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ScanCategoryDef, ScanErrorList, ScanProgress, ScanRunExtension, ScanRunRow, ScanVolume } from "../../shared/types";
import { formatStamp } from "../../shared/datetime";
import { PRINT_STYLESHEET, renderReportPrintHtml } from "./reportPrint";
import Tip from "../../components/Tip";
import { bumpRender } from "../../diag";
import "./scan.css";

// Wizard/job tabs (Phase B3/B4) — a tab is a wizard until Start binds a runId; the ENGINE stays
// single-slot and drains a queue (Migrate's pattern), so extra tabs show Queued.
type MainView = "history" | "reports" | string; // string = a job tab id
interface ScanJobTab {
  id: string;
  label: string;
  cats: string[]; // selected category keys
  exts: string[]; // selected extensions (lowercase, no dot)
  targetKind: "drive" | "folders";
  driveSerial: string | null;
  folders: string[];
  optFolderNames: boolean;
  optSubfolders: boolean;
  optHidden: boolean;
  runId: number | null;
  runStatus: string | null;
  decision?: { kind: "already-scanned" | "offer-resume"; runId: number } | null; // double-scan guard, in-tab
  seeded?: boolean; // defaults applied (Photos+Video+Audio all-on, Documents off) — once, never re-forced
  filterCats?: string[] | null; // results-view DISPLAY filter — never touches stored rows
  filterFmts?: string[] | null; // "catKey:formatLabel" entries; null = all
}
const newScanTab = (): ScanJobTab => ({
  id: `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`,
  label: "New scan",
  cats: [], exts: [], targetKind: "drive", driveSerial: null, folders: [],
  optFolderNames: true, optSubfolders: true, optHidden: false,
  runId: null, runStatus: null, decision: null,
  seeded: false, filterCats: null, filterFmts: null,
});
// The DEFAULT selection — Photos+Video+Audio with EVERY format (equivalent to the pre-wizard
// always-everything media behaviour, so default reports stay comparable); Documents opt-in
// (thousands of .xmp sidecars are row bloat a media-drive scan doesn't want).
const defaultCats = ["photos", "video", "audio"];
const defaultExts = (registry: ScanCategoryDef[]): string[] =>
  registry.filter((c) => defaultCats.includes(c.key)).flatMap((c) => c.formats.flatMap((x) => x.extensions));
// Module-level caches — instant re-entry; tabs ALSO persist to app_settings ("scan.tabs"), never localStorage.
let scanTabsCache: ScanJobTab[] | null = null;
let scanRegistryCache: ScanCategoryDef[] | null = null;
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
  const [tabs, setTabs] = useState<ScanJobTab[]>(() => scanTabsCache ?? [newScanTab()]);
  const [view, setView] = useState<MainView>(() => (scanTabsCache ?? [])[0]?.id ?? tabs[0].id);
  const [registry, setRegistry] = useState<ScanCategoryDef[]>(() => scanRegistryCache ?? []);
  const [drives, setDrives] = useState<ScanVolume[]>([]);
  const [refreshing, setRefreshing] = useState(false); // manual drive re-enumeration in flight (spinner)
  const [runs, setRuns] = useState<ScanRunRow[]>([]);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [runExts, setRunExts] = useState<Record<number, ScanRunExtension[]>>({}); // results-filter source (read-only)
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportModal, setReportModal] = useState<{ runId: number; path: string; content: string } | null>(null);
  const [reportView, setReportView] = useState<"read" | "source">("read");
  const [exportMsg, setExportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [exporting, setExporting] = useState<"pdf" | "csv" | null>(null);
  const [errorsModal, setErrorsModal] = useState<ScanErrorList | null>(null);
  const startedAt = useRef<number | null>(null);
  const rateWindow = useRef<Array<{ t: number; files: number }>>([]); // trailing window for ETA
  const prevErrors = useRef(0); // last errorsLogged seen — to emit a warn line on increase
  const prevCheckpoint = useRef(0); // last checkpoint bucket emitted
  const [, forceTick] = useState(0);

  // ---- tab model (Phase B4) — persisted via the sanctioned settings path ("scan.tabs") ----
  const tabsLoaded = useRef(false);
  const mutateTabs = useCallback((fn: (prev: ScanJobTab[]) => ScanJobTab[]): void => {
    setTabs((prev) => {
      const next = fn(prev);
      scanTabsCache = next;
      void window.api.settings.set("scan.tabs", JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);
  const patchTab = useCallback((id: string, patch: Partial<ScanJobTab>): void => {
    mutateTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, [mutateTabs]);
  useEffect(() => {
    void window.api.scan.registry().then((r) => { scanRegistryCache = r; setRegistry(r); }).catch(() => {});
    if (!tabsLoaded.current && scanTabsCache === null) {
      tabsLoaded.current = true;
      void window.api.settings.get("scan.tabs").then((raw) => {
        if (!raw) return;
        try {
          const saved = JSON.parse(raw) as ScanJobTab[];
          if (Array.isArray(saved) && saved.length > 0) {
            scanTabsCache = saved;
            setTabs(saved);
            setView(saved[0].id);
          }
        } catch { /* corrupt tab state — the fresh tab stands */ }
      }).catch(() => {});
    }
  }, []);

  // Seed defaults into pristine wizard tabs the moment the registry is known (once per tab).
  useEffect(() => {
    if (registry.length === 0) return;
    const needs = (t: ScanJobTab): boolean => !t.seeded && t.runId === null && t.cats.length === 0 && t.exts.length === 0;
    if (!tabs.some(needs)) return;
    mutateTabs((prev) => prev.map((t) => (needs(t) ? { ...t, seeded: true, cats: [...defaultCats], exts: defaultExts(registry) } : t)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registry, tabs]);

  // Results-filter source: per-extension counts for the ACTIVE completed run — queried once, cached.
  useEffect(() => {
    const rid = tabs.find((t) => t.id === view)?.runId;
    const status = tabs.find((t) => t.id === view)?.runStatus;
    if (rid == null || status !== "completed" || runExts[rid]) return;
    void window.api.scan.runExtensions(rid).then((rows) => setRunExts((m) => ({ ...m, [rid]: rows }))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, tabs]);

  const addTab = useCallback((): void => {
    const t = newScanTab();
    if ((scanRegistryCache ?? []).length > 0) {
      t.seeded = true;
      t.cats = [...defaultCats];
      t.exts = defaultExts(scanRegistryCache!);
    }
    mutateTabs((prev) => [...prev, t]);
    setView(t.id);
  }, [mutateTabs]);
  const closeTab = useCallback((id: string): void => {
    mutateTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      return next.length > 0 ? next : [newScanTab()];
    });
    setView((v) => (v === id ? (scanTabsCache?.[0]?.id ?? "history") : v));
  }, [mutateTabs]);

  // Elapsed ticker while a run is live.
  useEffect(() => {
    if (activeRunId === null) return;
    const id = window.setInterval(() => forceTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [activeRunId]);

  const refreshRuns = useCallback(async () => {
    try {
      // A completed run changes both the run list AND the scanned-drive set (a freshly scanned drive
      // becomes reviewable-while-unplugged), so refresh both together.
      setRuns(await window.api.scan.listRuns());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Manual re-enumeration — the fallback if the live watcher ever misses an event. Refreshes the
  // attached drives AND the scanned-drive set, with a brief spinner on the button.
  const refreshDrives = useCallback(async () => {
    setRefreshing(true);
    try {
      setDrives(await window.api.scan.listDrives());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Mount: enumerate drives, load run history, and REJOIN any run still in flight (survives
  // navigating away — the engine kept running; we reattach to its progress).
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [dv, rs] = await Promise.all([
          window.api.scan.listDrives(),
          window.api.scan.listRuns(),
        ]);
        if (!alive) return;
        setDrives(dv);
        setRuns(rs);
        // Rejoin in-flight AND queued runs (the engine + queue kept going in the main process): a
        // persisted tab that owns the runId gets its live status; an orphan live run ADOPTS a tab.
        const liveish = rs.filter((r) => IN_FLIGHT.has(r.status) || r.status === "queued");
        const live = liveish.find((r) => IN_FLIGHT.has(r.status));
        if (liveish.length > 0) {
          mutateTabs((prev) => {
            let next = prev.map((t) => {
              const owned = liveish.find((r) => r.id === t.runId);
              return owned ? { ...t, runStatus: owned.status } : t;
            });
            for (const r of liveish) {
              if (!next.some((t) => t.runId === r.id)) {
                const d = dv.find((x) => x.serial === r.volume_serial);
                next = [...next, { ...newScanTab(), label: d?.label || r.root_path, runId: r.id, runStatus: r.status }];
              }
            }
            return next;
          });
        }
        if (live) {
          setActiveRunId(live.id);
          startedAt.current = live.started_at ? Date.parse(live.started_at) : Date.now();
          setProgress({
            runId: live.id,
            volumeSerial: live.volume_serial ?? null,
            status: live.status,
            currentFolder: null,
            foldersCommitted: live.folders_committed,
            filesRecorded: live.files_recorded,
            errorsLogged: live.errors_logged,
            estimatedFiles: live.total_files_expected ?? live.estimated_files ?? null,
          });
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
      setActiveRunId(live ? p.runId : null); // which drive is busy — drives-list indicator
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
      // Route every push into the tab that owns the runId (queued/counting/running/paused/terminal).
      mutateTabs((prev) => prev.map((t) => (t.runId === p.runId ? { ...t, runStatus: p.status } : t)));
      if (isTerminal(p.status)) {
        void refreshRuns();
        if (p.reportError) setError(`Report could not be written: ${p.reportError}. The scan is complete and its data is saved.`);
      }
    };
    window.api.on<ScanProgress>("scan:progress", onProgress);
    return () => window.api.off<ScanProgress>("scan:progress", onProgress);
  }, [refreshRuns]);

  // Live drive detection — the main process pushes a fresh attached-drive list the instant a drive is
  // connected or removed (WMI volume event), so a newly plugged drive appears without Ctrl+R.
  useEffect(() => {
    const onDrives = (vols: ScanVolume[]): void => setDrives(vols);
    window.api.on<ScanVolume[]>("scan:drives", onDrives);
    return () => window.api.off<ScanVolume[]>("scan:drives", onDrives);
  }, []);

  // ---- wizard start (Phase B3) — double-scan guard first, then ENQUEUE (the engine drains) ----
  const startScan = async (t: ScanJobTab): Promise<void> => {
    setError(null);
    const drive = t.targetKind === "drive" ? drives.find((d) => d.serial === t.driveSerial) : null;
    const root = t.targetKind === "drive" ? (drive ? `${drive.letter}\\` : null) : (t.folders[0] ?? null);
    if (!root || t.exts.length === 0) return;
    setBusy(true);
    try {
      // The double-scan guard still answers first (drive scans) — its decision renders IN the tab.
      if (t.targetKind === "drive") {
        const d = await window.api.scan.selectSource(root, "drive");
        if (d.decision === "already-scanned" && d.completedRun) {
          patchTab(t.id, { decision: { kind: "already-scanned", runId: d.completedRun.id } });
          return;
        }
        if (d.decision === "offer-resume" && d.crashedRun) {
          patchTab(t.id, { decision: { kind: "offer-resume", runId: d.crashedRun.id } });
          return;
        }
      }
      await enqueueTab(t, root);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };
  const enqueueTab = async (t: ScanJobTab, root: string): Promise<void> => {
    const r = await window.api.scan.enqueue(root, t.targetKind === "drive" ? "drive" : "folder", t.exts, {
      followSubfolders: t.optSubfolders, includeHidden: t.optHidden, folderNames: t.optFolderNames,
    });
    setLog([]); rateWindow.current = []; prevErrors.current = 0; prevCheckpoint.current = 0;
    patchTab(t.id, { runId: r.runId, runStatus: "queued", decision: null });
  };

  const abortRun = async (runId: number | null): Promise<void> => {
    if (runId === null) return;
    try { await window.api.scan.abort(runId); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const pauseRun = async (runId: number | null): Promise<void> => {
    if (runId === null) return;
    try { await window.api.scan.pause(runId); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const resumeRun = async (runId: number | null): Promise<void> => {
    if (runId == null) return;
    try { await window.api.scan.resume(runId); startedAt.current = startedAt.current ?? Date.now(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  // View report → read the markdown and show it in a modal (MindMerge ingestion is the later path).
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
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const openIssues = async (runId: number): Promise<void> => {
    try { setErrorsModal(await window.api.scan.listErrors(runId)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const elapsedMs = startedAt.current ? Date.now() - startedAt.current : 0;
  // The ACTIVE job tab drives the body; its bound run's progress renders when the push matches.
  const activeTab = tabs.find((t) => t.id === view) ?? null;
  const tabProgress = activeTab && progress && progress.runId === activeTab.runId ? progress : null;
  const st = tabProgress?.status ?? activeTab?.runStatus ?? undefined;
  const counting = st === "counting" || st === "probing";
  const running = SCANNING.has(st ?? "") && tabProgress != null;
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

        {/* Job tabs (B4): + New scan FIRST (Jason's Migrate ruling), jobs grow rightward, History/
            Reports pinned right. Tabs are renderer state; the ENGINE stays single-slot + queued. */}
        <div className="scan-jtabs">
          <button className="scan-jtab add" onClick={addTab}>＋ New scan</button>
          {tabs.map((t) => (
            <div key={t.id} className={`scan-jtab${t.id === view ? " on" : ""}`} onClick={() => setView(t.id)}>
              {t.runStatus && <span className={`scan-jpip ${jpip(t.runStatus)}`} />}
              <span>{t.label}</span>
              {t.runStatus === "queued" && <span className="scan-jstate">Queued</span>}
              {t.runStatus === "paused" && <span className="scan-jstate">Paused</span>}
              <button className="scan-jtabx" aria-label="Close tab" onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}>✕</button>
            </div>
          ))}
          <span className="scan-jspacer" />
          <button className={`scan-jtab pin${view === "history" ? " on" : ""}`} onClick={() => setView("history")}>History</button>
          <button className={`scan-jtab pin${view === "reports" ? " on" : ""}`} onClick={() => setView("reports")}>Reports</button>
        </div>

        {error && <div className="scan-card2 scan-note" style={{ marginBottom: 14 }}>{error}</div>}

        {activeTab && view !== "history" && view !== "reports" && (
          <div className="scan-stagewrap">
            {/* WIZARD — three steps (mockup V1 minus the search step, which is Phase C) */}
            {activeTab.runId === null && !activeTab.decision && (
              <ScanWizard tab={activeTab} registry={registry} drives={drives} patchTab={patchTab}
                busy={busy} refreshing={refreshing} onRefreshDrives={() => void refreshDrives()}
                onStart={() => void startScan(activeTab)} />
            )}

            {/* Double-scan guard decision, in-tab */}
            {activeTab.runId === null && activeTab.decision && (
              <div className="scan-card">
                <div className="scan-h">{activeTab.decision.kind === "already-scanned" ? "This drive was already scanned" : "A previous scan of this drive crashed"}</div>
                <p className="scan-sub" style={{ marginBottom: 14 }}>
                  {activeTab.decision.kind === "already-scanned"
                    ? "You can open the existing report, or scan it again — a rescan records a brand-new run."
                    : "You can resume it from where it stopped, or start over with your new selection."}
                </p>
                <div className="scan-row">
                  {activeTab.decision.kind === "already-scanned" && (
                    <button className="scan-btn" onClick={() => void viewReport(activeTab.decision!.runId)}>Open existing report</button>
                  )}
                  {activeTab.decision.kind === "offer-resume" && (
                    <button className="scan-btn go" onClick={() => {
                      const rid = activeTab.decision!.runId;
                      patchTab(activeTab.id, { runId: rid, runStatus: "running", decision: null });
                      void resumeRun(rid);
                    }}>Resume previous scan</button>
                  )}
                  <button className="scan-btn go" onClick={() => {
                    const drive = drives.find((d) => d.serial === activeTab.driveSerial);
                    if (drive) void enqueueTab(activeTab, `${drive.letter}\\`);
                  }}>{activeTab.decision.kind === "already-scanned" ? "Rescan anyway" : "Start over"}</button>
                  <button className="scan-btn ghost" onClick={() => patchTab(activeTab.id, { decision: null })}>Back</button>
                </div>
              </div>
            )}

            {activeTab.runId !== null && activeTab.runStatus === "queued" && (
              <div className="scan-card">
                <div className="scan-h">Queued</div>
                <p className="scan-sub" style={{ marginBottom: 14 }}>Another scan is running — this one starts automatically when the engine is free. One scan runs at a time so the drives never fight for the disk.</p>
                <button className="scan-btn ghost" onClick={() => void abortRun(activeTab.runId)}>Cancel</button>
              </div>
            )}

            {activeTab.runId !== null && counting && tabProgress && (
              <div className="scan-card">
                <div className="scan-mlabel" style={{ marginBottom: 9 }}>Counting</div>
                <div className="scan-h">Counting…</div>
                <p className="scan-sub" style={{ marginBottom: 14 }}>
                  Walking every folder to get an exact count before scanning. This is not a percentage yet.
                </p>
                <div className="scan-grid4">
                  <div className="scan-card2"><div className="scan-mlabel">Folders found</div><div className="scan-stat">{tabProgress.foldersCommitted.toLocaleString()}</div></div>
                  <div className="scan-card2"><div className="scan-mlabel">Covered files found</div><div className="scan-stat">{(tabProgress.estimatedFiles ?? 0).toLocaleString()}</div></div>
                </div>
                <div className="scan-mono scan-sub" style={{ marginTop: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tabProgress.currentFolder ?? ""}</div>
                <div className="scan-row" style={{ marginTop: 14 }}><button className="scan-btn ghost" onClick={() => void abortRun(activeTab.runId)}>Cancel</button></div>
              </div>
            )}

            {running && tabProgress && (
              <RunningConsole progress={tabProgress} pct={pct} elapsed={fmtElapsed(elapsedMs)} eta={eta} log={log}
                onAbort={() => void abortRun(activeTab.runId)} onPause={() => void pauseRun(activeTab.runId)}
                onResume={() => void resumeRun(activeTab.runId)} onIssues={() => openIssues(activeTab.runId!)} />
            )}

            {activeTab.runId !== null && activeTab.runStatus != null && isTerminal(activeTab.runStatus) && (
              activeTab.runStatus === "completed" ? (
                <>
                  <CompletionCard status="completed"
                    reportPath={(tabProgress?.reportPath ?? runs.find((r) => r.id === activeTab.runId)?.report_path) ?? null}
                    onView={() => void viewReport(activeTab.runId!)} onFolder={() => openReportsFolder(activeTab.runId!)}
                    onRescan={() => patchTab(activeTab.id, { runId: null, runStatus: null, decision: null })} />
                  <ResultsPanel tab={activeTab} registry={registry} rows={runExts[activeTab.runId!] ?? null} patchTab={patchTab} />
                </>
              ) : (
                <div className="scan-card">
                  <div className="scan-h">Scan {activeTab.runStatus}</div>
                  <p className="scan-sub" style={{ marginBottom: 14 }}>
                    {activeTab.runStatus === "crashed" ? "The run stopped unexpectedly — it can resume from the last committed folder." : "The run ended before completing."}
                  </p>
                  <div className="scan-row">
                    {activeTab.runStatus === "crashed" && (
                      <button className="scan-btn go" onClick={() => { patchTab(activeTab.id, { runStatus: "running" }); void resumeRun(activeTab.runId); }}>Resume</button>
                    )}
                    <button className="scan-btn ghost" onClick={() => patchTab(activeTab.id, { runId: null, runStatus: null, decision: null })}>Edit and retry</button>
                  </div>
                </div>
              )
            )}
          </div>
        )}

        {view === "history" && <HistoryTable runs={runs} onView={viewReport} onNuke={nukeHistory} />}
        {view === "reports" && <ReportsList runs={runs} onView={viewReport} onFolder={openReportsFolder} />}
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

function jpip(status: string): string {
  if (status === "completed") return "ok";
  if (status === "crashed" || status === "error" || status === "aborted") return "bad";
  if (status === "queued") return "wait";
  if (status === "paused") return "pause";
  return "run";
}

// ---- the wizard, revised (mockup "cards tight" tab B): one pill row + one shared panel ----
function ScanWizard({ tab, registry, drives, patchTab, busy, refreshing, onRefreshDrives, onStart }: {
  tab: ScanJobTab; registry: ScanCategoryDef[]; drives: ScanVolume[];
  patchTab: (id: string, patch: Partial<ScanJobTab>) => void;
  busy: boolean; refreshing: boolean; onRefreshDrives: () => void; onStart: () => void;
}) {
  const [panelCat, setPanelCat] = useState<string | null>(null);
  const selectedCats = registry.filter((c) => tab.cats.includes(c.key));
  const active = selectedCats.find((c) => c.key === panelCat) ?? selectedCats[0] ?? null;

  const fullySelected = (fmt: { extensions: string[] }): boolean => fmt.extensions.every((e) => tab.exts.includes(e));
  const catStats = (c: ScanCategoryDef): { total: number; sel: number } => ({
    total: c.formats.length,
    sel: c.formats.filter(fullySelected).length,
  });
  const label = (cats: string[], serial: string | null, folders: string[]): string => {
    const cat = registry.find((c) => cats.includes(c.key));
    const drive = drives.find((d) => d.serial === serial);
    const target = drive ? (drive.label || drive.letter) : folders.length > 0 ? `${folders.length} folder${folders.length === 1 ? "" : "s"}` : "";
    return [cat?.label, target].filter(Boolean).join(" — ") || "New scan";
  };
  const toggleCat = (key: string): void => {
    const cat = registry.find((c) => c.key === key)!;
    const catExts = cat.formats.flatMap((x) => x.extensions);
    const on = tab.cats.includes(key);
    const cats = on ? tab.cats.filter((k) => k !== key) : [...tab.cats, key];
    const exts = on ? tab.exts.filter((e) => !catExts.includes(e)) : [...new Set([...tab.exts, ...catExts])];
    patchTab(tab.id, { cats, exts, label: label(cats, tab.driveSerial, tab.folders) });
    if (!on) setPanelCat(key);
    else if (panelCat === key) setPanelCat(null);
  };
  const toggleFormat = (fmt: { extensions: string[] }): void => {
    const on = fullySelected(fmt);
    patchTab(tab.id, { exts: on ? tab.exts.filter((e) => !fmt.extensions.includes(e)) : [...new Set([...tab.exts, ...fmt.extensions])] });
  };
  const selectAllCat = (c: ScanCategoryDef): void =>
    patchTab(tab.id, { exts: [...new Set([...tab.exts, ...c.formats.flatMap((x) => x.extensions)])] });
  const clearCat = (c: ScanCategoryDef): void => {
    const catExts = c.formats.flatMap((x) => x.extensions);
    patchTab(tab.id, { exts: tab.exts.filter((e) => !catExts.includes(e)) });
  };

  const formatCount = selectedCats.reduce((a, c) => a + catStats(c).sel, 0);
  const canStart = tab.exts.length > 0 && (tab.targetKind === "drive" ? tab.driveSerial !== null : tab.folders.length > 0);
  const isFlat = (c: ScanCategoryDef): boolean => c.formats.every((x) => x.group === x.label);
  const groupsOf = (c: ScanCategoryDef): Array<[string, typeof c.formats]> => {
    const m = new Map<string, typeof c.formats>();
    for (const x of c.formats) {
      if (!m.has(x.group)) m.set(x.group, []);
      m.get(x.group)!.push(x);
    }
    return [...m.entries()];
  };
  const chip = (fmt: { label: string; extensions: string[] }): ReactNode => {
    const on = fullySelected(fmt);
    return (
      <button key={fmt.label + fmt.extensions[0]} className={`scan-wchip${on ? " on" : ""}`}
        title={fmt.extensions.map((e) => `.${e}`).join(" ")} onClick={() => toggleFormat(fmt)}>
        <span className={`scan-wck${on ? " on" : ""}`}>{on ? "✓" : ""}</span>{fmt.label}
      </button>
    );
  };

  return (
    <div>
      {/* STEP 1 — one pill row + one shared panel */}
      <div className="scan-wstep">
        <div className="scan-wsteph"><span className="scan-wnum">1</span><span className="scan-wt">What are you looking for?</span>
          <span className="scan-sub">everything is included by default — open a category only if you want to narrow it</span></div>
        <div className="scan-wpills">
          {registry.map((c) => {
            const on = tab.cats.includes(c.key);
            const { total, sel } = catStats(c);
            const half = on && sel > 0 && sel < total;
            const count = !on ? "off" : sel === total ? String(total) : `${sel}/${total}`;
            return (
              <button key={c.key} className={`scan-wpill${on ? " on" : ""}`} onClick={() => toggleCat(c.key)}>
                <span className={`scan-wck${on ? (half ? " half" : " on") : ""}`}>{on && !half ? "✓" : half ? "–" : ""}</span>
                <span aria-hidden="true">{c.icon}</span> {c.label}
                <span className="scan-wcount scan-mono">{count}</span>
              </button>
            );
          })}
        </div>
        <div className="scan-wpanel" style={{ marginTop: 11 }}>
          {selectedCats.length === 0 && <p className="scan-sub" style={{ margin: 0 }}>Tick a category above to scan for it.</p>}
          {selectedCats.length > 0 && (
            <>
              <div className="scan-wptabs">
                <span className="scan-wphead">Narrow the search — optional</span>
                {selectedCats.map((c) => {
                  const { total, sel } = catStats(c);
                  return (
                    <button key={c.key} className={`scan-wptab${c.key === active?.key ? " on" : ""}`} onClick={() => setPanelCat(c.key)}>
                      {c.label} <span className="scan-mono">{sel === total ? total : `${sel}/${total}`}</span>
                    </button>
                  );
                })}
                <span className="scan-wgact" style={{ marginLeft: "auto" }}>
                  <button className="scan-link" onClick={() => active && selectAllCat(active)}>Select all</button>
                  {" · "}
                  <button className="scan-link" onClick={() => active && clearCat(active)}>Clear</button>
                </span>
              </div>
              {active && (
                <>
                  {isFlat(active) ? (
                    <div className="scan-wchips">{active.formats.map(chip)}</div>
                  ) : (
                    <div className="scan-wcols">
                      {groupsOf(active).map(([g, fmts]) => (
                        <div className="scan-wcol" key={g}>
                          <div className="scan-wglabel">{g}</div>
                          <div className="scan-wchips">{fmts.map(chip)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="scan-sub" style={{ marginTop: 12, marginBottom: 0 }}>Also recorded: {active.records ?? "—"}</p>
                  <Tip id="TIP-SCN-001" />
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* STEP 2 — where to look (was step 3; renumbered when the separate narrow step was deleted) */}
      <div className="scan-wstep">
        <div className="scan-wsteph"><span className="scan-wnum">2</span><span className="scan-wt">Where should we look?</span>
          <span className="scan-sub">a whole drive, or just the folders you choose</span></div>
        <div className="scan-wsplit">
          <div className="scan-wpanel">
            <div className="scan-wghead"><span>Whole drive</span>
              <span className="scan-wgact"><button className="scan-link" onClick={onRefreshDrives} disabled={refreshing}>{refreshing ? "Checking…" : "Re-check drives"}</button></span></div>
            {drives.map((d) => {
              const on = tab.targetKind === "drive" && tab.driveSerial === d.serial;
              return (
                <div key={d.serial} className={`scan-wdrive${on ? " on" : ""}`}
                  onClick={() => patchTab(tab.id, { targetKind: "drive", driveSerial: d.serial, label: label(tab.cats, d.serial, tab.folders) })}>
                  <span className="scan-wico" aria-hidden="true">{d.removable ? "🔌" : "💽"}</span>
                  <span>
                    <span style={{ display: "block" }}>{d.label || "Local Disk"} ({d.letter}){d.removable && <span className="scan-wremov">Removable</span>}</span>
                    <span className="sub">{d.filesystem} · serial {d.serial} · {fmtBytes(d.freeBytes)} free</span>
                  </span>
                  <span className="scan-wsize scan-mono">{fmtBytes(d.totalBytes)}</span>
                </div>
              );
            })}
          </div>
          <div className="scan-wpanel">
            <div className="scan-wghead"><span>Specific folders</span>
              <span className="scan-wgact"><button className="scan-link" onClick={() => {
                void window.api.scan.pickFolders().then((paths) => {
                  if (paths.length > 0) patchTab(tab.id, { targetKind: "folders", folders: [...new Set([...tab.folders, ...paths])] });
                });
              }}>＋ Add folder</button></span></div>
            {tab.folders.map((p) => (
              <div key={p} className={`scan-wdrive${tab.targetKind === "folders" ? " on" : ""}`} onClick={() => patchTab(tab.id, { targetKind: "folders" })}>
                <span className="scan-wico" aria-hidden="true">🗀</span>
                <span><span className="scan-mono" style={{ display: "block" }}>{p}</span><span className="sub">including subfolders</span></span>
                <button className="scan-jtabx" aria-label="Remove folder"
                  onClick={(e) => { e.stopPropagation(); patchTab(tab.id, { folders: tab.folders.filter((x) => x !== p) }); }}>✕</button>
              </div>
            ))}
            <div className="scan-mlabel" style={{ margin: "14px 0 4px" }}>Options</div>
            {([
              ["optFolderNames", "Search folder names as well as file names"],
              ["optSubfolders", "Follow subfolders"],
              ["optHidden", "Include hidden and system folders"],
            ] as const).map(([k, text]) => (
              <div key={k} className="scan-wopt" onClick={() => patchTab(tab.id, { [k]: !tab[k] } as Partial<ScanJobTab>)}>
                <span className={`scan-wsw${tab[k] ? " on" : ""}`}><i /></span> {text}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="scan-row" style={{ marginTop: 6 }}>
        <span className="scan-sub">Metadata and file details are recorded on every run.</span>
        <span className="scan-sub scan-mono" style={{ marginLeft: "auto" }}>{tab.cats.length} categor{tab.cats.length === 1 ? "y" : "ies"} · {formatCount} formats selected</span>
        <button className="scan-btn go" disabled={!canStart || busy} onClick={onStart}>Start scan</button>
      </div>
    </div>
  );
}

// ---- results-view filter (read-only DISPLAY narrowing over recorded rows — never rescans) ----
function ResultsPanel({ tab, registry, rows, patchTab }: {
  tab: ScanJobTab; registry: ScanCategoryDef[]; rows: ScanRunExtension[] | null;
  patchTab: (id: string, patch: Partial<ScanJobTab>) => void;
}) {
  if (rows === null) return null;
  // ext → (category, format) from the SAME shared registry the wizard uses, so labels always agree.
  const extMap = new Map<string, { catKey: string; catLabel: string; fmtLabel: string }>();
  for (const c of registry) for (const x of c.formats) for (const e of x.extensions) extMap.set(e, { catKey: c.key, catLabel: c.label, fmtLabel: x.label });
  interface Agg { catKey: string; catLabel: string; fmtLabel: string; n: number; bytes: number; exts: string[] }
  const byFormat = new Map<string, Agg>();
  for (const r of rows) {
    const e = (r.extension ?? "").toLowerCase();
    const hit = extMap.get(e) ?? { catKey: "other", catLabel: "Other", fmtLabel: "Other" };
    const key = `${hit.catKey}:${hit.fmtLabel}`;
    const agg = byFormat.get(key) ?? { ...hit, n: 0, bytes: 0, exts: [] };
    agg.n += r.n;
    agg.bytes += r.bytes;
    if (e && !agg.exts.includes(e)) agg.exts.push(e);
    byFormat.set(key, agg);
  }
  const formats = [...byFormat.entries()].sort((a, b) => b[1].n - a[1].n);
  const catsPresent = [...new Map(formats.map(([, a]) => [a.catKey, a.catLabel])).entries()];
  const catOn = (k: string): boolean => tab.filterCats == null || tab.filterCats.includes(k);
  const fmtOn = (key: string): boolean => tab.filterFmts == null || tab.filterFmts.includes(key);
  const shown = formats.filter(([key, a]) => catOn(a.catKey) && fmtOn(key));
  const totalN = formats.reduce((s, [, a]) => s + a.n, 0);
  const shownN = shown.reduce((s, [, a]) => s + a.n, 0);
  const filtered = tab.filterCats != null || tab.filterFmts != null;
  const toggleCatF = (k: string): void => {
    const all = catsPresent.map(([c]) => c);
    const cur = tab.filterCats ?? all;
    const next = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k];
    patchTab(tab.id, { filterCats: next.length === all.length ? null : next });
  };
  const toggleFmtF = (key: string): void => {
    const all = formats.map(([x]) => x);
    const cur = tab.filterFmts ?? all;
    const next = cur.includes(key) ? cur.filter((x) => x !== key) : [...cur, key];
    patchTab(tab.id, { filterFmts: next.length === all.length ? null : next });
  };
  return (
    <div className="scan-card" style={{ marginTop: 14 }}>
      <div className="scan-row" style={{ marginBottom: 10 }}>
        <div className="scan-h" style={{ margin: 0 }}>Recorded results</div>
        <span className="scan-sub scan-mono" style={{ marginLeft: "auto" }}>Showing {shownN.toLocaleString()} of {totalN.toLocaleString()} files</span>
        {filtered && <button className="scan-btn ghost" onClick={() => patchTab(tab.id, { filterCats: null, filterFmts: null })}>Reset</button>}
      </div>
      <div className="scan-wchips" style={{ marginBottom: 8 }}>
        {catsPresent.map(([k, lbl]) => (
          <button key={k} className={`scan-wchip${catOn(k) ? " on" : ""}`} onClick={() => toggleCatF(k)}>
            <span className={`scan-wck${catOn(k) ? " on" : ""}`}>{catOn(k) ? "✓" : ""}</span>{lbl}
          </button>
        ))}
      </div>
      <div className="scan-wchips" style={{ marginBottom: 12 }}>
        {formats.filter(([, a]) => catOn(a.catKey)).map(([key, a]) => (
          <button key={key} className={`scan-wchip${fmtOn(key) ? " on" : ""}`} title={a.exts.map((e) => `.${e}`).join(" ")} onClick={() => toggleFmtF(key)}>
            <span className={`scan-wck${fmtOn(key) ? " on" : ""}`}>{fmtOn(key) ? "✓" : ""}</span>{a.fmtLabel} <span className="scan-mono">{a.n.toLocaleString()}</span>
          </button>
        ))}
      </div>
      <table className="scan-tbl">
        <thead><tr><th>Format</th><th>Category</th><th>Files</th><th>Size</th></tr></thead>
        <tbody>
          {shown.map(([key, a]) => (
            <tr key={key}>
              <td title={a.exts.map((e) => `.${e}`).join(" ")}>{a.fmtLabel}</td>
              <td className="scan-sub">{a.catLabel}</td>
              <td className="scan-mono">{a.n.toLocaleString()}</td>
              <td className="scan-mono">{fmtBytes(a.bytes)}</td>
            </tr>
          ))}
          {shown.length === 0 && <tr><td colSpan={4} className="scan-sub">Nothing matches this filter.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// Coverage labels (wizard, Phase B): a pre-wizard run has NO selected set — it covered everything
// Scan understood, and must say so rather than error.
function coverageLabel(r: ScanRunRow): string {
  if (!r.selected_extensions) return "All formats";
  try {
    return `${(JSON.parse(r.selected_extensions) as string[]).length} formats`;
  } catch {
    return "All formats";
  }
}
function coverageTitle(r: ScanRunRow): string {
  if (!r.selected_extensions) return "This run covered every format Scan understood at the time.";
  try {
    return (JSON.parse(r.selected_extensions) as string[]).map((e) => `.${e}`).join(" ");
  } catch {
    return "";
  }
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
        <thead><tr><th>Run</th><th>Root</th><th>Status</th><th>Coverage</th><th>Files</th><th>Folders</th><th>Finished</th><th>Report</th></tr></thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td className="w scan-mono">#{r.id}</td>
              <td className="scan-mono" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.root_path}</td>
              <td>{r.status}</td>
              <td title={coverageTitle(r)}>{coverageLabel(r)}</td>
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
