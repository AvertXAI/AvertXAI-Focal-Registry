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
import type { ScanCameraCount, ScanErrorList, ScanErrorRow, ScanFolderSummary, ScanNotesDriveSync, ScanProgress, ScanRunRow, ScannedDrive, ScanVolume } from "../../shared/types";
import { explainScanError, CATEGORY_META, type ScanErrorCategory } from "../../shared/scanErrors";
import { formatRange, formatStamp } from "../../shared/datetime";
import { PRINT_STYLESHEET, renderReportPrintHtml } from "./reportPrint";
import ScanNotesTab from "./notes/ScanNotesTab";
import UpdatesTab from "./notes/UpdatesTab";
import MediaGrid, { WarmChips, type WarmProgress } from "./notes/MediaGrid";
import { signalAppToast, withAppLoading } from "../../App";
import { bumpRender } from "../../diag";
import "./scan.css";
import "./notes/scannotes.css";

// FIVE TABS (ruled 08-17-2026). The strip is data, not markup: adding a sixth is one row here, and
// the label can never drift from the key the way two parallel literals did.
type Tab = "new" | "history" | "reports" | "notes" | "updates";
const TABS: Array<[Tab, string]> = [
  ["new", "New scan"],
  ["history", "History"],
  ["reports", "Reports"],
  ["notes", "Scan Notes"],
  ["updates", "Updated Notes"],
];
const NOTES_TABS = new Set<Tab>(["notes", "updates"]);
type LogLine =
  | { kind: "folder"; at: string; path: string; files: number; bytes: number }
  | { kind: "warn"; at: string; count: number }
  | { kind: "check"; at: string; folders: number };
// A search result carries the KIND that produced it, so the panel can group by kind instead of
// relying on a build order that reads as a flat list to the user.
type HitKind = "folder" | "note";
type SearchHit = { kind: HitKind; key: string; title: string; sub: string; path: string; driveId: number | null };
// Folders first: the box sits on a folder tree, and a folder is what people look for on it.
const HIT_GROUPS: Array<[HitKind, string]> = [["folder", "Folders"], ["note", "Notes"]];
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
  // ---- Scan Notes state. Both view preferences persist to app_settings, never localStorage (§3.8). ----
  const [mediaMode, setMediaMode] = useState(false);
  /** "Show RAW files" on the media wall. DEFAULT OFF, and the default is the feature: a
   *  RAW-plus-JPEG shoot puts every photograph on the wall twice, and the second copy is the one
   *  that costs a preview extraction. Owned here rather than in ScanNotesTab because MediaGrid is
   *  built here and both need it — exactly how mediaMode is already shared. */
  const [showRaw, setShowRaw] = useState(false);
  /** Preview progress, reported up by MediaGrid and drawn by ScanNotesTab's media pane header.
   *  It transits through here for the same reason showRaw does: MediaGrid is built here and the
   *  header that draws it lives in the sibling. */
  const [mediaProgress, setMediaProgress] = useState<{ done: number; total: number } | null>(null);
  const [hiddenRaw, setHiddenRaw] = useState(0);
  /** THE WALL'S MOUNT POINT, handed over by ScanNotesTab. MediaGrid is mounted permanently below so
   *  a folder warms while its report is being read, and it portals the wall into this node when the
   *  user is actually in media mode. Null whenever the media pane is not on screen. */
  const [mediaHost, setMediaHost] = useState<HTMLDivElement | null>(null);
  /** The two background warm-up chips, reported up by MediaGrid on a timer. Null = nothing to say. */
  const [warm, setWarm] = useState<WarmProgress | null>(null);
  const [notesRefresh, setNotesRefresh] = useState(0); // bumped by the push; every surface re-reads
  const [unseen, setUnseen] = useState(0);
  const [pendingRenames, setPendingRenames] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [notesFolder, setNotesFolder] = useState<{ path: string; driveId: number; letter: string | null } | null>(null);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [scope, setScope] = useState<"all" | "folders" | "notes">("all");
  const [hits, setHits] = useState<SearchHit[]>([]);
  /** A folder the search asked to open — handed to the tab, which selects it and expands to it. */
  const [jumpTo, setJumpTo] = useState<{ path: string; driveId: number | null; at: number } | null>(null);
  const searchBox = useRef<HTMLDivElement | null>(null);
  const [drives, setDrives] = useState<ScanVolume[]>([]);
  const [scannedDrives, setScannedDrives] = useState<ScannedDrive[]>([]); // completed-scan drives (may be unplugged)
  const [selected, setSelected] = useState<ScanVolume | null>(null);
  const [refreshing, setRefreshing] = useState(false); // manual drive re-enumeration in flight (spinner)
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
  const [exportMsg, setExportMsg] = useState<{ ok: boolean; text: string; path?: string } | null>(null);
  const [exporting, setExporting] = useState<"pdf" | "csv" | "xlsx" | null>(null);
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
      // A completed run changes both the run list AND the scanned-drive set (a freshly scanned drive
      // becomes reviewable-while-unplugged), so refresh both together.
      const [rs, sd] = await Promise.all([window.api.scan.listRuns(), window.api.scan.listScannedDrives()]);
      setRuns(rs);
      setScannedDrives(sd);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Manual re-enumeration — the fallback if the live watcher ever misses an event. Refreshes the
  // attached drives AND the scanned-drive set, with a brief spinner on the button.
  const refreshDrives = useCallback(async () => {
    setRefreshing(true);
    try {
      const [dv, sd] = await Promise.all([window.api.scan.listDrives(), window.api.scan.listScannedDrives()]);
      setDrives(dv);
      setScannedDrives(sd);
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
        const [dv, rs, sd] = await Promise.all([
          window.api.scan.listDrives(),
          window.api.scan.listRuns(),
          window.api.scan.listScannedDrives(),
        ]);
        if (!alive) return;
        setDrives(dv);
        setRuns(rs);
        setScannedDrives(sd);
        const live = rs.find((r) => IN_FLIGHT.has(r.status));
        if (live) {
          // Rejoin the in-flight run. The engine kept running in the main process; on remount we lost
          // the React state, so we must RESTORE it: the running console renders only when the run's
          // drive is SELECTED (`mine`), so auto-select that drive AND seed progress from the DB row —
          // otherwise the scan looks like it vanished until the next throttled push. The next real
          // push refreshes these values seamlessly.
          setActiveRunId(live.id);
          setProbeRunId(live.id);
          setScanningSerial(live.volume_serial ?? null);
          startedAt.current = live.started_at ? Date.parse(live.started_at) : Date.now();
          const liveDrive = dv.find((d) => d.serial === live.volume_serial);
          if (liveDrive) setSelected(liveDrive);
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

  // Live drive detection — the main process pushes a fresh attached-drive list the instant a drive is
  // connected or removed (WMI volume event), so a newly plugged drive appears without Ctrl+R.
  useEffect(() => {
    const onDrives = (vols: ScanVolume[]): void => setDrives(vols);
    window.api.on<ScanVolume[]>("scan:drives", onDrives);
    return () => window.api.off<ScanVolume[]>("scan:drives", onDrives);
  }, []);

  // ---- Scan Notes: one push, everything re-reads. The payload is deliberately empty — a surface
  // that trusts a pushed payload is a surface that drifts from the database it claims to show. ----
  useEffect(() => {
    const onChanged = (): void => setNotesRefresh((n) => n + 1);
    window.api.on("scan:notes:changed", onChanged);
    return () => window.api.off("scan:notes:changed", onChanged);
  }, []);

  // A drive came back and its queued work ran. TWELVE SECONDS, not the standard six: this arrives
  // unannounced while the user is doing something else, and it reports work that already happened to
  // their files — long enough to finish reading a sentence you were not expecting.
  useEffect(() => {
    const onSynced = (p: { drives: ScanNotesDriveSync[] }): void => {
      for (const d of p.drives) {
        signalAppToast(
          `${d.letter}\\${d.label} (serial ${d.serial}) connected — ${d.applied} pending folder rename${d.applied === 1 ? "" : "s"}, ${d.filesWritten} file${d.filesWritten === 1 ? "" : "s"} written to drive.${d.stale > 0 ? ` ${d.stale} could not be applied — see Updated Notes.` : ""}`,
          d.stale > 0 ? "err" : "ok",
          12_000
        );
      }
    };
    window.api.on<{ drives: ScanNotesDriveSync[] }>("scan:notes:synced", onSynced);
    return () => window.api.off<{ drives: ScanNotesDriveSync[] }>("scan:notes:synced", onSynced);
  }, []);

  // Restore the two sticky preferences. A missing row is the default, never an error.
  useEffect(() => {
    void window.api.settings.get("scan.notes_tab").then((v) => {
      if (v && TABS.some(([k]) => k === v)) setTab(v as Tab);
    }).catch(() => undefined);
    // A missing row is "off", never an error — the first run of this feature has no row.
    void window.api.settings.get("scan.notes_show_raw").then((v) => setShowRaw(v === "1")).catch(() => undefined);
  }, []);

  // The badge and the pending-rename count. Re-read on every push AND on every tab change, because
  // opening Updated Notes is what clears the badge.
  useEffect(() => {
    void window.api.scan.notes.unseen().then(setUnseen).catch(() => undefined);
    void window.api.scan.notes.pendingRenames().then(setPendingRenames).catch(() => undefined);
  }, [notesRefresh, tab]);

  const chooseTab = useCallback((t: Tab) => {
    setTab(t);
    void window.api.settings.set("scan.notes_tab", t).catch(() => undefined);
  }, []);
  const toggleRaw = useCallback(() => {
    setShowRaw((on) => {
      void window.api.settings.set("scan.notes_show_raw", on ? "0" : "1").catch(() => undefined);
      return !on;
    });
  }, []);
  // MEDIA MODE IS DELIBERATELY NOT STICKY. It was persisted to `scan.notes_media_mode` and restored
  // at boot; Jason ruled that out on 08-18-2026. The app now always opens on the folder report, so
  // the start state is the same every launch instead of depending on how the last session ended.
  const toggleMedia = useCallback(() => {
    setMediaMode((m) => !m);
  }, []);

  /** Picking a DIFFERENT folder returns to the report, even from the media wall — the report is the
   *  answer to "what is in here", and it is what you want first about a folder you just opened.
   *  Deliberately NOT wired to every folder change: the wall's own Back button and the container
   *  empty-state's "the media is one level down" link both move the folder too, and bouncing those
   *  out of media mode would make the wall impossible to browse. */
  const leaveMedia = useCallback(() => setMediaMode(false), []);

  // Manual sync — the same work the reconnect consumer does. It is also the fallback if the WMI
  // watcher ever misses an event, which is why the button exists at all.
  const manualSync = useCallback(() => {
    setSyncing(true);
    void window.api.scan.notes
      .sync()
      .then((r) => {
        setNotesRefresh((n) => n + 1);
        signalAppToast(
          r.applied === 0 && r.filesWritten === 0
            ? "Everything is already up to date — nothing pending."
            : `${r.applied} folder rename${r.applied === 1 ? "" : "s"} applied, ${r.filesWritten} file${r.filesWritten === 1 ? "" : "s"} written.`,
          r.stale > 0 ? "err" : "ok"
        );
      })
      .catch((e: unknown) => signalAppToast(e instanceof Error ? e.message : String(e), "err"))
      .finally(() => setSyncing(false));
  }, []);

  const addNote = useCallback(() => {
    if (!notesFolder) { signalAppToast("Pick a folder first — a note is saved inside one.", "err"); return; }
    void window.api.scan.notes
      .create(notesFolder.driveId, notesFolder.path)
      .then((n) => { setNotesRefresh((x) => x + 1); signalAppToast(`Saved inside ${n.folder_path}.`, "ok"); })
      .catch((e: unknown) => signalAppToast(e instanceof Error ? e.message : String(e), "err"));
  }, [notesFolder]);

  const makeShortcut = useCallback(() => {
    void window.api.scan.notes
      .shortcut()
      .then((r) => signalAppToast(r.message, r.ok ? "ok" : "err"))
      .catch((e: unknown) => signalAppToast(e instanceof Error ? e.message : String(e), "err"));
  }, []);

  // Search runs on a pause, over BOTH note bodies and folder-name history — old and new names alike,
  // which is the whole reason the history keeps both (ruled).
  useEffect(() => {
    if (!searchOpen || query.trim() === "") { setHits([]); return; }
    const t = setTimeout(() => {
      const wantNotes = scope === "all" || scope === "notes";
      const wantFolders = scope === "all" || scope === "folders";
      void Promise.all([
        wantNotes ? window.api.scan.notes.search(query) : Promise.resolve([]),
        wantFolders ? window.api.scan.notes.searchFolders(query) : Promise.resolve([]),
      ])
        .then(([ns, fs]) => {
          setHits([
            // Folders first: the box is on a folder tree, and a folder is what people look for on it.
            // The `kind` rides along so the panel groups them under labelled headings.
            ...fs.map((f): SearchHit => ({
              kind: "folder",
              key: `f:${f.path}`,
              title: f.name,
              sub: f.renamedFrom ? `Renamed from ${f.renamedFrom}` : "Folder",
              path: f.path,
              driveId: f.drive_id,
            })),
            ...ns.map((n): SearchHit => ({
              kind: "note",
              key: `n:${n.uuid}`,
              title: n.title,
              sub: n.excerpt.trim() || "Note",
              path: n.folder_path,
              driveId: n.drive_id,
            })),
          ]);
        })
        .catch(() => setHits([]));
    }, 220);
    return () => clearTimeout(t);
  }, [query, scope, searchOpen, notesRefresh]);

  // CLICK AWAY CLOSES IT, and so does Escape from anywhere — not only from inside the input, which
  // was the whole of it before and left the panel stuck open the moment focus moved (Jason, on
  // device 08-17-2026). Both listeners exist only while the panel is open.
  useEffect(() => {
    if (!searchOpen) return;
    const onDown = (e: MouseEvent): void => {
      if (!searchBox.current?.contains(e.target as Node)) setSearchOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") setSearchOpen(false); };
    // `mousedown`, not `click`: a result's own click must land before the panel goes away, and
    // capture so a stopPropagation anywhere below cannot swallow the dismissal.
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [searchOpen]);

  // Keep `selected` pointing at the LIVE volume object as presence changes — a drive plugged back in
  // refreshes its letter/sizes; a removed drive stays selected but now reads "not connected".
  useEffect(() => {
    if (!selected) return;
    const live = drives.find((d) => d.serial === selected.serial);
    if (live && live !== selected) setSelected(live);
  }, [drives, selected]);

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
    // Resolve the LIVE volume by serial (authoritative letter) — `selected` may be a synthesized
    // "not connected" entry with no letter. Can't count/scan a drive that isn't attached.
    const vol = drives.find((d) => d.serial === selected.serial);
    if (!vol) { setError("That drive isn't connected — reconnect it to scan."); return; }
    setBusy(true); setError(null); setProgress(null); setLog([]);
    setScanningSerial(vol.serial); // mark this drive busy immediately (other drives disable)
    try {
      // Kicks off the EXACT counting walk; returns immediately. Counts arrive over scan:progress.
      const r = await window.api.scan.probe(`${vol.letter}\\`, "drive");
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

  // View report → read the markdown and show it in a modal (MindMerge ingestion is the later path).
  // Reading a large report's markdown off a drive is seconds of work with nothing on screen to say
  // so, which read as a frozen application (Jason, on device 08-17-2026). withAppLoading raises the
  // full-window scrim and lowers it in a `finally`, so a read that throws can never strand it.
  const viewReport = async (runId: number): Promise<void> => {
    const r = await withAppLoading("Loading scan report…", () => window.api.scan.readReport(runId));
    if (r.ok && typeof r.content === "string") { setExportMsg(null); setReportModal({ runId, path: r.path ?? "", content: r.content }); }
    else setError(r.error ?? "No report to open.");
  };
  // Export the open report. PDF prints the Reading view (rendered to a static HTML string here, so it
  // exports regardless of which view tab is showing); CSV streams the folder rows in the main process.
  const exportReport = async (kind: "pdf" | "csv" | "xlsx"): Promise<void> => {
    if (!reportModal) return;
    setExporting(kind); setExportMsg(null);
    try {
      const res = kind === "pdf"
        ? await window.api.scan.exportReportPdf(reportModal.runId, renderReportPrintHtml(reportModal.content), PRINT_STYLESHEET)
        : kind === "xlsx"
          ? await window.api.scan.exportReportXlsx(reportModal.runId)
          : await window.api.scan.exportReportCsv(reportModal.runId);
      // The PATH is kept, not just the sentence — the bar is clickable and needs somewhere to go.
      setExportMsg(res.ok
        ? { ok: true, text: `Saved ${res.path}`, path: res.path }
        : { ok: false, text: res.error ?? "Export failed." });
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
  // Merge attached drives with scanned-but-UNPLUGGED drives so the latter still appear ("not
  // connected"). Absent entries are synthesized ScanVolumes with no letter (identity is the serial);
  // their report/folders/issues all resolve from the DB + local copy, so they stay reviewable.
  const presentSerials = new Set(drives.map((d) => d.serial));
  const absentDrives: ScanVolume[] = scannedDrives
    .filter((s) => !presentSerials.has(s.serial))
    .map((s) => ({ letter: "", label: s.label ?? "", filesystem: "", totalBytes: s.total_bytes ?? 0, freeBytes: 0, serial: s.serial }));
  const driveList: ScanVolume[] = [...drives, ...absentDrives];
  const selectedPresent = selected != null && presentSerials.has(selected.serial); // false = unplugged
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
        {/* The header row carries the module's OWN search — this is not the shell topbar's field,
            and nothing here reaches outside src/modules/scan/ (§2.8). It only renders on the two
            tabs that have something to search; a live-looking control with nothing behind it is
            worse than no control. */}
        <div className="scannotes-headrow scannotes">
          <div className="scannotes-headleft">
            <h1 className="pagetitle">Scan</h1>
            <p className="subtitle">
              Backup drive scanner — a blueprint of what is inside your folders. Renames folders only
              when you ask; never renames files, never deletes.
            </p>
          </div>
          {NOTES_TABS.has(tab) && (
            <div className="scannotes-headright">
              <div className={`scannotes-searchwrap${searchOpen ? " open" : ""}`} ref={searchBox}>
                <div className="scannotes-search">
                  <span aria-hidden="true">🔍</span>
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onFocus={() => setSearchOpen(true)}
                    onKeyDown={(e) => { if (e.key === "Escape") { setSearchOpen(false); (e.target as HTMLInputElement).blur(); } }}
                    placeholder="Search folder names (old and new), notes, reports"
                    aria-label="Search Scan Notes"
                  />
                  <span className="kbd">Esc</span>
                </div>
                {searchOpen && (
                  <div className="scannotes-filterpanel">
                    <div className="scannotes-ft">Filters</div>
                    <div className="scannotes-chips">
                      {(["all", "folders", "notes"] as const).map((s) => (
                        <button key={s} type="button" className={`scannotes-chip${scope === s ? " on" : ""}`} onClick={() => setScope(s)}>
                          {s === "all" ? "All" : s === "folders" ? "Folders" : "Notes"}
                        </button>
                      ))}
                    </div>
                    {hits.length > 0 && (
                      <div className="scannotes-results">
                        {/* GROUPED BY KIND, folders first. A group with nothing in it renders
                            nothing at all — an empty heading is worse than no heading. */}
                        {HIT_GROUPS.map(([kind, label]) => {
                          const group = hits.filter((h) => h.kind === kind);
                          if (group.length === 0) return null;
                          return (
                            <div key={kind} className="scannotes-rgroup">
                              <div className="scan-mlabel scannotes-rlabel">{label}</div>
                              {group.map((h) => (
                                <button
                                  key={h.key}
                                  type="button"
                                  className="scannotes-result"
                                  onClick={() => {
                                    // A result that only closed the panel was the other half of
                                    // "search isn't working": it found the folder and then did
                                    // nothing with it.
                                    setSearchOpen(false);
                                    chooseTab("notes");
                                    setJumpTo({ path: h.path, driveId: h.driveId, at: Date.now() });
                                  }}
                                >
                                  <span className="rt">{h.title}</span>
                                  {/* A folder that matched an OLD name still says so — that is the
                                      headline capability of this search. */}
                                  {h.sub && <span className="rx">{h.sub}</span>}
                                  <span className="rp">{h.path}</span>
                                </button>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div className="scannotes-hintline">
                      {query.trim() === ""
                        ? "Old and new folder names are both searchable. Esc to close."
                        : hits.length === 0
                          ? "Nothing matched. Every word has to appear somewhere in the title or the body."
                          : `${hits.length} match${hits.length === 1 ? "" : "es"}. Esc to close.`}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className={`scan-tabs${NOTES_TABS.has(tab) ? " scannotes-tabrow scannotes" : ""}`}>
          <div className="scannotes-tablist">
            {TABS.map(([key, label]) => (
              <button key={key} className={`scan-tab${tab === key ? " on" : ""}`} onClick={() => chooseTab(key)}>
                {label}
                {key === "updates" && unseen > 0 && <span className="scannotes-tbadge">{unseen}</span>}
              </button>
            ))}
          </div>
          {tab === "notes" && (
            <div className="scannotes-tabactions">
              {/* THE WARM-UP CHIPS, leftmost on the row so the two actions keep the position the
                  user already reaches for. They draw nothing at all when there is nothing warming. */}
              <WarmChips warm={warm} />
              <button type="button" className="scannotes-btn pri" onClick={addNote}>+ Add Note</button>
              <button type="button" className="scannotes-btn pri" onClick={toggleMedia}>{mediaMode ? "Scan Notes" : "View media"}</button>
              {/* The ring only pulses when there is queued work — a control that breathes all day is
                  a control nobody looks at. */}
              <button
                type="button"
                className={`scannotes-iconbtn${pendingRenames > 0 ? " alert" : ""}${syncing ? " spin" : ""}`}
                disabled={syncing}
                title="Sync folders to drive"
                aria-label="Sync folders to drive"
                onClick={manualSync}
              >
                ⟳
                {pendingRenames > 0 && <span className="badge">{pendingRenames}</span>}
              </button>
              {/* THE DESKTOP SHORTCUT, an icon since 08-18-2026 (Jason: top-right of the module
                  surface, on the same line as the tab strip's action row, to the right of the
                  existing actions). It was a full-width text button competing with "+ Add Note" and
                  "View media" for the eye, and it is a once-per-machine action — those two are used
                  constantly. Behaviour and the duplicate guard are UNCHANGED: same makeShortcut, same
                  handler, same toast. The tooltip carries the label the button no longer spells out,
                  and aria-label carries it for anything that cannot see a tooltip. */}
              <button
                type="button"
                className="scannotes-iconbtn"
                title="Create desktop shortcut"
                aria-label="Create desktop shortcut"
                onClick={makeShortcut}
              >
                🔗
              </button>
            </div>
          )}
        </div>

        {error && <div className="scan-card2 scan-note" style={{ marginBottom: 14 }}>{error}</div>}

        {tab === "new" && (
          <div className="scan-split">
            {/* LEFT — drives list (Option B), always visible */}
            <div className="scan-drives">
              <div className="scan-drives-head">
                <span className="scan-mlabel">Drives</span>
                {/* Manual re-check — the fallback if the live watcher ever misses an event. The dot
                    spins green while re-enumerating. */}
                <button className="scan-refresh" onClick={() => void refreshDrives()} disabled={refreshing}
                  title="Re-check connected drives" aria-label="Refresh drives">
                  <svg className={`scan-refresh-ico${refreshing ? " spin" : ""}`} viewBox="0 0 24 24" width="15" height="15"
                    fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="23 4 23 10 17 10" />
                    <polyline points="1 20 1 14 7 14" />
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                  </svg>
                </button>
              </div>
              {driveList.length === 0 && <div className="scan-sub">No drives detected. Connect a source drive.</div>}
              {driveList.map((d) => {
                const isScanning = d.serial === scanningSerial;
                const present = presentSerials.has(d.serial);
                const dot = isScanning ? "scanning" : !present ? "notconn" : scannedSerials.has(d.serial) ? "ok" : "off";
                return (
                  <button key={d.serial} className={`scan-drv${selected?.serial === d.serial ? " on" : ""}`}
                    onClick={() => { setSelected(d); if (d.serial !== scanningSerial) { setProbeRunId(null); setProgress(null); } }}>
                    <span className={`scan-dot ${dot}`} />
                    <span>
                      <span style={{ display: "block" }}>{present ? `${d.letter}\\ ` : ""}{d.label || "(no label)"}{isScanning ? " · scanning" : !present ? " · not connected" : ""}</span>
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
                  <div className="scan-mono scan-sub" style={{ marginTop: 12, overflowWrap: "anywhere", wordBreak: "break-word" }}>{progress!.currentFolder ?? ""}</div>
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
                <PopulatedDashboard drive={selected} run={lastRun} folders={folders} present={selectedPresent}
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
        {/* The two Scan Notes surfaces share one panel that the selected tab joins onto. */}
        {NOTES_TABS.has(tab) && (
          <div className="scannotes-tabbody scannotes">
            {tab === "notes" ? (
              <>
                <ScanNotesTab
                  refreshKey={notesRefresh}
                  mediaMode={mediaMode}
                  onFolderChange={setNotesFolder}
                  onLeaveMedia={leaveMedia}
                  jumpTo={jumpTo}
                  onSeeAll={() => chooseTab("updates")}
                  showRaw={showRaw}
                  onToggleRaw={toggleRaw}
                  mediaProgress={mediaProgress}
                  hiddenRaw={hiddenRaw}
                  onMediaHost={setMediaHost}
                />
                {/* MOUNTED WHETHER OR NOT MEDIA MODE IS ON, and that is the whole of the background
                    warm-up: selecting a folder starts its thumbnails immediately, so by the time
                    "View media" is pressed the wall is already there. It draws nothing here — the
                    wall is portalled into the pane's scroller, and the decoders sit on an off-screen
                    bench. Unmounting it on every mode toggle would restart the folder each time. */}
                <MediaGrid
                  folderPath={notesFolder?.path ?? null}
                  showRaw={showRaw}
                  active={mediaMode}
                  host={mediaHost}
                  onProgress={setMediaProgress}
                  onHiddenRaw={setHiddenRaw}
                  onWarm={setWarm}
                />
              </>
            ) : (
              <UpdatesTab refreshKey={notesRefresh} />
            )}
          </div>
        )}
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
                  <button className="scan-btn" disabled={exporting !== null} onClick={() => void exportReport("xlsx")}>{exporting === "xlsx" ? "…" : "XLSX"}</button>
                  
                </div>
              </div>
              <button className="scan-modal-close" aria-label="Close" style={{ marginLeft: 10 }} onClick={() => setReportModal(null)}>×</button>
            </div>
            {exportMsg && (
              exportMsg.path ? (
                /* Clicking re-opens the file's folder with it selected. The main side refuses any
                   path outside the exports directory, so this stays a reveal and never an "open". */
                <button
                  className="scan-export-rail ok link"
                  title="Show this file in its folder"
                  onClick={() => void window.api.scan.revealExport(exportMsg.path as string)}
                >
                  {exportMsg.text}
                </button>
              ) : (
                <div className={`scan-export-rail${exportMsg.ok ? " ok" : " err"}`}>{exportMsg.text}</div>
              )
            )}
            <div className="scan-modal-body">
              <div className="scan-sub scan-mono" style={{ marginBottom: 12, wordBreak: "break-all" }}>{reportModal.path}</div>
              {reportView === "read"
                ? <div className="scan-report-read">{renderReport(reportModal.content)}</div>
                : <div className="scan-report-md">{highlightReport(reportModal.content)}</div>}
            </div>
          </div>
        </div>
      )}

      {errorsModal && (() => {
        // Group the shown page by classified category. disk-read floats to the top (the only alarming
        // one); the rest sort by count. Grouping the bounded page is honest for the common case —
        // ponytail: past the 200-row cap the "showing first N" line already flags truncation, and the
        // failing-drive total (diskReadCount) is counted over the WHOLE run in SQL, so it never lies.
        const groups = new Map<ScanErrorCategory, Array<{ r: ScanErrorRow; exp: ReturnType<typeof explainScanError> }>>();
        for (const r of errorsModal.rows) {
          const exp = explainScanError(r.stage, r.code, r.error_text);
          const g = groups.get(exp.category);
          if (g) g.push({ r, exp }); else groups.set(exp.category, [{ r, exp }]);
        }
        const ordered = [...groups.entries()].sort(
          (a, b) => (b[0] === "disk-read" ? 1 : 0) - (a[0] === "disk-read" ? 1 : 0) || b[1].length - a[1].length
        );
        const summary = ordered.map(([cat, rs]) => `${rs.length} × ${CATEGORY_META[cat].label}`).join("  ·  ");
        return (
        <div className="scan-modal-back" onClick={() => setErrorsModal(null)}>
          <div className="scan-modal" onClick={(e) => e.stopPropagation()}>
            <div className="scan-modal-head">
              <div className="scan-h">Logged issues ({errorsModal.total.toLocaleString()})</div>
              <button className="scan-modal-close" aria-label="Close" onClick={() => setErrorsModal(null)}>×</button>
            </div>
            <div className="scan-modal-body">
              {errorsModal.total === 0 && <div className="scan-sub">No issues logged for this run.</div>}
              {errorsModal.diskReadCount > 0 && (
                <div className="scan-err-alarm">
                  ⚠ {errorsModal.diskReadCount.toLocaleString()} {errorsModal.diskReadCount === 1 ? "file" : "files"} could not be read from disk — this often indicates physical damage to the drive. Back up anything important now and check the drive's health.
                </div>
              )}
              {summary !== "" && <div className="scan-err-summary">{summary}</div>}
              {ordered.map(([cat, rs]) => (
                <div key={cat} className="scan-err-group">
                  <div className={`scan-err-cat${CATEGORY_META[cat].diskFailure ? " danger" : ""}`}>
                    {CATEGORY_META[cat].label} <span className="n">· {rs.length}</span>
                  </div>
                  {rs.map(({ r, exp }, i) => (
                    <div key={i} className="scan-err-row">
                      <span className="stage">{r.stage ?? "—"}</span>
                      <span>
                        <span className="eplain">{exp.plain}</span>
                        <span className="epath">{r.path ?? "(no path)"}</span>
                        <span className="ehint">{exp.hint}</span>
                        <span className="etext">{r.error_text ?? ""}{r.code ? `  (${r.code})` : ""}</span>
                      </span>
                    </div>
                  ))}
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
        );
      })()}
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
            <div className="scan-mono" style={{ fontSize: 13, overflowWrap: "anywhere", wordBreak: "break-word" }}>{progress.currentFolder ?? "…"}</div>
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
              <div key={i}><span className="ts">{l.at}</span> <span className="b">saved</span> <span className="t">— {l.folders.toLocaleString()} folders scanned, metadata saved to database</span></div>
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

function PopulatedDashboard({ drive, run, folders, present, onView, onFolder, onRescan, onIssues, busy }: {
  drive: ScanVolume; run: ScanRunRow; folders: ScanFolderSummary[]; present: boolean;
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
            <div className="scan-h" style={{ margin: 0 }}>{present ? `${drive.letter}\\ ` : ""}{drive.label || "(no label)"}</div>
            <div className="scan-sub">Last scanned {formatStamp(run.finished_at, "eventTime") || "—"} · {run.files_recorded.toLocaleString()} files</div>
          </div>
          {present
            ? <span className="scan-pill ok" style={{ marginLeft: "auto" }}>Up to date</span>
            : <span className="scan-pill notconn" style={{ marginLeft: "auto" }}>Not connected</span>}
          <button className="scan-btn blue" onClick={onRescan} disabled={busy || !present}
            title={present ? undefined : "Reconnect the drive to scan"}>Rescan</button>
        </div>
        {!present && (
          <div className="scan-card2 scan-sub" style={{ marginBottom: 14 }}>
            This drive isn't connected — showing its last scan from your local copy. Reconnect it to rescan or open folders.
          </div>
        )}
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
          <div className="scan-folders-scroll">
          <table className="scan-tbl folders">
            <colgroup><col /><col className="c-files" /><col className="c-date" /><col className="c-cam" /><col className="c-size" /></colgroup>
            <thead><tr><th>Folder</th><th>Files</th><th>Date range</th><th>Top camera</th><th>Size</th></tr></thead>
            <tbody>
              {folders.slice(0, 40).map((f) => (
                <Fragment key={f.path}>
                  <tr>
                    <td className={`w scan-mono${present ? " cell-link" : ""}`}
                        title={present ? `Open ${f.path}` : "Reconnect the drive to open this folder"}
                        onClick={present ? () => void window.api.scan.openPath(f.path) : undefined}>{f.path}</td>
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
          </div>
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
