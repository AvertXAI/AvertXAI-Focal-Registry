/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// The Scan Notes tab — built to MOCKUP-scan-notes-v4-08-17-2026.html.
//
// THREE PANES: the drive/folder tree, the file list for the selected folder, and the pane that shows
// either the RENDERED folder report (read-only) or the editable note. "View media" collapses the
// middle pane and hands the third one to the media grid (Phase 5).
//
// THE REPORT CARD IS RENDERED, NEVER STORED (ruled 08-17-2026). It is drawn live from scan_folders
// every time it is opened, so a re-scan updates it with no migration, no stale row, and no second
// copy of the truth. The only rows this feature writes are the user's own notes.
//
// EVERY WRITE GOES THROUGH window.api.scan.notes — no localStorage, no direct database reach. The
// two sticky view preferences (which tab, media on/off) persist through app_settings like every
// other view state in this shell (§3.8).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ScanFolderCard,
  ScanFolderNode,
  ScanHistoryRow,
  ScanNote,
  ScanNoteMeta,
  ScanNotesDriveNode,
  ScanRecentFolder,
} from "../../../shared/types";
import { signalAppToast } from "../../../App";
import MilkdownEditor, { type EditorAction, type MilkdownHandle } from "./MilkdownEditor";
import { Markdown } from "./markdown";
import "./scannotes.css";

const AUTOSAVE_MS = 900; // one pause in typing, not one keystroke

/** m-d-yyyy | h:mmam — the Folder History line format, fixed by the mockup. */
function stampParts(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "—", time: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: iso.slice(0, 10), time: "" };
  const h = d.getHours();
  const min = String(d.getMinutes()).padStart(2, "0");
  return {
    date: `${d.getMonth() + 1}-${d.getDate()}-${d.getFullYear()}`,
    time: `${h % 12 === 0 ? 12 : h % 12}:${min}${h < 12 ? "am" : "pm"}`,
  };
}
const shortDay = (v: string | null): string => {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? v.slice(0, 10)
    : `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
};
function longStamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const h = d.getHours();
  return `${d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })} ${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
}
function fmtBytes(n: number): string {
  if (!n || n <= 0) return "—";
  if (n >= 1024 ** 4) return `${(n / 1024 ** 4).toFixed(2)} TB`;
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024).toFixed(0)} KB`;
}

/** One history line, in the locked format:
 *  `8-17-2026 | 12:15am | [Capture range 10/26/1985 → 08/15/2026] | [Folder Name change: OLD -> NEW]` */
function HistoryLine({ row, card }: { row: ScanHistoryRow; card: ScanFolderCard | null }) {
  const { date, time } = stampParts(row.applied_at ?? row.changed_at);
  return (
    <div className={`line${row.status === "applied" ? "" : " pending"}`}>
      {date} | {time} | [Capture range {shortDay(card?.date_min ?? null)} → {shortDay(card?.date_max ?? null)}] |{" "}
      [Folder Name change: {row.name_old} <span className="arrow">-&gt;</span> {row.name_new}]
      {row.status === "pending" && " (queued — waiting for the drive)"}
      {row.status === "stale" && ` (not applied — ${row.stale_reason ?? "the folder had moved"})`}
    </div>
  );
}

/** The rendered report card. Everything here comes from scan_folders at read time. */
function ReportCard({ card }: { card: ScanFolderCard }) {
  return (
    <div className="scannotes-report">
      <h2>{card.name}</h2>
      <div className="sub">{card.path}</div>
      <div className="scannotes-stats">
        <div className="scannotes-stat">
          <div className="k">Capture range</div>
          <div className="v mono">{shortDay(card.date_min)} → {shortDay(card.date_max)}</div>
        </div>
        <div className="scannotes-stat"><div className="k">Size</div><div className="v">{fmtBytes(card.total_bytes)}</div></div>
        <div className="scannotes-stat">
          <div className="k">Media files</div>
          <div className="v">{card.media_files.toLocaleString()}<span className="k"> of {card.total_files.toLocaleString()} seen</span></div>
        </div>
        <div className="scannotes-stat"><div className="k">Stills</div><div className="v">{card.image_count.toLocaleString()}</div></div>
        <div className="scannotes-stat"><div className="k">Video</div><div className="v">{card.video_count.toLocaleString()}</div></div>
        <div className="scannotes-stat"><div className="k">Audio</div><div className="v">{card.audio_count.toLocaleString()}</div></div>
        {card.unreadable_count > 0 && (
          <div className="scannotes-stat"><div className="k">Unreadable</div><div className="v">{card.unreadable_count.toLocaleString()}</div></div>
        )}
        {card.top_camera && (
          <div className="scannotes-stat"><div className="k">Top camera</div><div className="v mono">{card.top_camera}</div></div>
        )}
      </div>
      <p className="scannotes-empty">
        This report is drawn from the scan record each time you open it — re-scan the folder and it
        updates itself. Your own notes live beside it and are never overwritten.
      </p>
    </div>
  );
}

const TOOLBAR: Array<[EditorAction, string, string]> = [
  ["undo", "↺", "Undo"],
  ["redo", "↻", "Redo"],
  ["bold", "B", "Bold"],
  ["italic", "I", "Italic"],
  ["strike", "S", "Strikethrough"],
  ["code", "</>", "Inline code"],
  ["link", "🔗", "Link"],
  ["table", "▦", "Table"],
  ["bullet", "•≡", "Bullet list"],
  ["ordered", "1≡", "Numbered list"],
  ["task", "☑", "Checklist"],
];

export interface ScanNotesTabProps {
  /** Bumped by the parent on every scan:notes:changed push — a re-read trigger, not a payload. */
  refreshKey: number;
  mediaMode: boolean;
  /** Opened when a folder is selected, so the parent's "View media" button knows what to browse. */
  onFolderChange: (folder: { path: string; driveId: number; letter: string | null } | null) => void;
  /** Rendered into the third pane in place of the editor when mediaMode is on (Phase 5). */
  mediaPane?: React.ReactNode;
  /** A folder the header search asked to open. `at` is what makes a repeat click on the SAME result
   *  still re-open it — an identical object would otherwise look like no change at all. */
  jumpTo?: { path: string; driveId: number | null; at: number } | null;
  /** Recent Work's footer link — the parent owns which tab is showing, so it owns the switch. */
  onSeeAll?: () => void;
}

// ---------------------------------------------------------------- the folder tree
//
// A TREE, NOT A LIST (Jason, on device 08-17-2026: "every folder is individually placed in the
// directory and i cant find anything"). The same flattening the mirror directories had: the service
// returns every scanned folder's full path, and the first cut drew each one's BASENAME as a sibling
// of every other — so `D:\dev\project\img` sat beside `D:\Downloads` with nothing to say where it
// came from, and a drive with eight hundred folders became eight hundred unplaceable names.
//
// The nesting is rebuilt here rather than asked of the database, because the paths already carry it
// and one pass over a few hundred strings is nothing. Only EXPANDED branches render, so the pane
// holds a dozen rows however deep the drive goes.

interface TreeNode {
  name: string;
  path: string;
  /** false for a folder that only exists as somebody's parent — it holds no media of its own, so it
   *  has no scan record and no report. It still has to appear, or the tree has holes in it. */
  scanned: boolean;
  renamedFrom: string | null;
  children: TreeNode[];
}

/** "D:\" out of any absolute path on it. */
const driveRootOf = (p: string): string => (/^[A-Za-z]:[\\/]/.test(p) ? `${p.slice(0, 2)}\\` : "");

function buildTree(folders: ScanFolderNode[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const byPath = new Map<string, TreeNode>();
  for (const f of folders) {
    const root = driveRootOf(f.path);
    const segs = f.path.slice(root.length).split(/[\\/]+/).filter(Boolean);
    // The drive root itself, scanned directly — it has media of its own and needs a row.
    if (segs.length === 0) {
      const key = f.path.toLowerCase();
      if (!byPath.has(key)) {
        const node: TreeNode = { name: f.path, path: f.path, scanned: true, renamedFrom: f.renamedFrom, children: [] };
        byPath.set(key, node);
        roots.push(node);
      }
      continue;
    }
    let prefix = root;
    let siblings = roots;
    segs.forEach((seg, i) => {
      const full = prefix + seg;
      const key = full.toLowerCase();
      let node = byPath.get(key);
      if (!node) {
        node = { name: seg, path: full, scanned: false, renamedFrom: null, children: [] };
        byPath.set(key, node);
        siblings.push(node);
      }
      if (i === segs.length - 1) {
        node.scanned = true;
        node.renamedFrom = f.renamedFrom;
      }
      prefix = `${full}\\`;
      siblings = node.children;
    });
  }
  const sort = (list: TreeNode[]): void => {
    list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    for (const n of list) sort(n.children);
  };
  sort(roots);
  return roots;
}

/** Every ancestor of a path, so selecting something deep opens the branches down to it. */
function ancestorsOf(p: string): string[] {
  const root = driveRootOf(p);
  const segs = p.slice(root.length).split(/[\\/]+/).filter(Boolean);
  const out: string[] = [];
  let prefix = root;
  for (const s of segs.slice(0, -1)) {
    prefix = `${prefix}${s}`;
    out.push(prefix.toLowerCase());
    prefix = `${prefix}\\`;
  }
  return out;
}

function Branch({
  node, depth, selected, expanded, onToggle, onSelect, onRename,
}: {
  node: TreeNode;
  depth: number;
  selected: string | null;
  expanded: Set<string>;
  onToggle: (p: string) => void;
  onSelect: (n: TreeNode) => void;
  onRename: (n: TreeNode) => void;
}) {
  const kids = node.children.length > 0;
  const open = expanded.has(node.path.toLowerCase());
  return (
    <>
      <div
        className={`scannotes-folder${selected === node.path ? " sel" : ""}${node.scanned ? "" : " ghost"}`}
        style={{ paddingLeft: 6 + depth * 14 }}
      >
        <button
          type="button"
          className="scannotes-twist"
          onClick={() => kids && onToggle(node.path)}
          aria-label={kids ? (open ? `Collapse ${node.name}` : `Expand ${node.name}`) : undefined}
          aria-hidden={!kids}
          tabIndex={kids ? 0 : -1}
        >
          {kids ? (open ? "▾" : "▸") : ""}
        </button>
        <button type="button" className="scannotes-fname" onClick={() => onSelect(node)} title={node.path}>
          <span aria-hidden="true">📁</span>
          <span className="nm">
            {node.name}
            {node.renamedFrom && <span className="old">{node.renamedFrom}</span>}
          </span>
        </button>
        <button
          type="button"
          className="scannotes-pencil"
          aria-label={`Rename ${node.name}`}
          title="Rename this folder"
          onClick={() => onRename(node)}
        >
          ✏️
        </button>
      </div>
      {open && node.children.map((c) => (
        <Branch key={c.path} node={c} depth={depth + 1} selected={selected}
          expanded={expanded} onToggle={onToggle} onSelect={onSelect} onRename={onRename} />
      ))}
    </>
  );
}

/**
 * RECENT WORK — every folder you have touched, one click away.
 *
 * NAME AND ICON AND NOTHING ELSE (Jason, 08-18-2026), which supersedes the mockup's richer row. The
 * mockup drew a drive path, a relative timestamp and a pin on every line; three pieces of furniture
 * on a list whose entire job is "get me back to where I was". The name is the thing you recognise.
 *
 * FIXED HEIGHT, SCROLLS INTERNALLY. The tree below it must never move because this list grew — a
 * panel that pushes the thing you were aiming at off the bottom of the pane is worse than no panel.
 * The height is in the stylesheet, not here.
 */
function RecentWork({ rows, selected, onPick, onSeeAll }: {
  rows: ScanRecentFolder[];
  selected: string | null;
  onPick: (r: ScanRecentFolder) => void;
  onSeeAll: () => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className={`scannotes-recent${open ? "" : " closed"}`}>
      <button type="button" className="scannotes-rhead" onClick={() => setOpen((v) => !v)}>
        <span className="scannotes-caret">▾</span>
        <h3>Recent Work</h3>
        {rows.length > 0 && <span className="count">{rows.length}</span>}
      </button>
      {open && (
        rows.length === 0 ? (
          /* The designed empty state, and it is also the honest one for an archive whose feed
             predates the folder column — nothing is missing, there is simply nothing recorded yet. */
          <div className="scannotes-rempty">
            Nothing yet. Add a note or rename a folder and it will appear here so you can get back to it.
          </div>
        ) : (
          <>
            <div className="scannotes-rlist">
              {rows.map((r) => (
                <button
                  key={r.path}
                  type="button"
                  className={`scannotes-ritem${selected === r.path ? " sel" : ""}`}
                  onClick={() => onPick(r)}
                  title={r.path}
                >
                  <span className="ic" aria-hidden="true">{r.kind === "rename" ? "✏️" : r.kind === "note" ? "📝" : "📁"}</span>
                  <span className="nm">{r.name}</span>
                </button>
              ))}
            </div>
            <div className="scannotes-rfoot">
              <button type="button" className="scannotes-rlink" onClick={onSeeAll}>See all in Updated Notes →</button>
            </div>
          </>
        )
      )}
    </div>
  );
}

/** SILENCE READS AS A HANG. Every pane that can be waiting says so — a click that lands on a blank
 *  box is indistinguishable from a crash, which is exactly how this felt on device. */
function Waiting({ what }: { what: string }) {
  return (
    <div className="scannotes-waiting" role="status" aria-live="polite">
      <span className="pip" aria-hidden="true" />
      {what}
    </div>
  );
}

/** Survives leaving and re-entering the tab, so the second visit paints instantly and re-reads
 *  behind the paint. Module-level on purpose — the same shape as the Vault list's cache. */
let treeCache: ScanNotesDriveNode[] = [];

export default function ScanNotesTab({ refreshKey, mediaMode, onFolderChange, mediaPane, jumpTo, onSeeAll }: ScanNotesTabProps) {
  const [tree, setTree] = useState<ScanNotesDriveNode[]>(treeCache);
  const [loading, setLoading] = useState(treeCache.length === 0);
  const [folderBusy, setFolderBusy] = useState(false);
  const [closed, setClosed] = useState<Set<number>>(new Set());
  /** Which branches are open, by lowercased path. Everything starts collapsed — a tree that opens
   *  fully is the flat list this replaced. */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [folder, setFolder] = useState<string | null>(null);
  const [driveId, setDriveId] = useState<number | null>(null);
  const [card, setCard] = useState<ScanFolderCard | null>(null);
  const [history, setHistory] = useState<ScanHistoryRow[]>([]);
  const [notes, setNotes] = useState<ScanNoteMeta[]>([]);
  const [openUuid, setOpenUuid] = useState<string | null>(null); // null = the report card is showing
  const [note, setNote] = useState<ScanNote | null>(null);
  const [saved, setSaved] = useState<string>("");
  /** Recent Work rows — the same feed the Updated Notes tab reads, never a second source. */
  const [recent, setRecent] = useState<ScanRecentFolder[]>([]);
  const [renaming, setRenaming] = useState<{ path: string; name: string } | null>(null);
  const [renameErr, setRenameErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ed = useRef<MilkdownHandle>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draft = useRef<{ title: string; body: string } | null>(null);

  // ---- the tree ----
  //
  // WINDOWED, THE WAY THE VAULT'S NOTE LIST IS (Jason 08-17-2026, on device: opening this tab hung
  // the app). The first page is what a pane can actually show and it paints at once; the rest is
  // fetched per drive straight after, and swapped in without the user waiting on it. A module-level
  // cache means coming BACK to the tab paints instantly from what was already loaded and re-reads
  // behind it — the same "paint what we have first" the Vault's list does.
  useEffect(() => {
    let live = true;
    if (treeCache.length === 0) setLoading(true);
    void window.api.scan.notes
      .tree()
      .then((t) => {
        if (!live) return;
        setTree(t);
        treeCache = t;
        setLoading(false);
        // Backfill each drive that has more than the first page, one at a time so a drive with
        // hundreds of folders never blocks the others from filling in.
        for (const d of t) {
          if (d.folder_total <= d.folders.length) continue;
          void window.api.scan.notes
            .folders(d.drive_id, d.folders.length, 2000)
            .then((rest) => {
              if (!live || rest.length === 0) return;
              setTree((prev) => {
                const next = prev.map((x) =>
                  x.drive_id === d.drive_id ? { ...x, folders: [...x.folders, ...rest] } : x
                );
                treeCache = next;
                return next;
              });
            })
            .catch(() => undefined); // a failed backfill leaves the first page standing
        }
      })
      .catch((e: unknown) => {
        if (!live) return;
        setLoading(false);
        signalAppToast(e instanceof Error ? e.message : String(e), "err");
      });
    return () => { live = false; };
  }, [refreshKey]);

  // Recent Work rides the same refreshKey as the tree: adding a note or renaming a folder already
  // bumps it, so the panel updates on the same beat as everything else rather than polling.
  useEffect(() => {
    let live = true;
    void window.api.scan.notes
      .recent(12)
      .then((r) => { if (live) setRecent(r); })
      .catch(() => undefined); // a panel that cannot load must never take the tree down with it
    return () => { live = false; };
  }, [refreshKey]);

  // First real folder becomes the selection so the pane is never blank on arrival.
  useEffect(() => {
    if (folder !== null) return;
    for (const d of tree) {
      if (d.folders.length > 0) {
        setFolder(d.folders[0].path);
        setDriveId(d.drive_id);
        return;
      }
    }
  }, [tree, folder]);

  useEffect(() => {
    const d = tree.find((x) => x.drive_id === driveId);
    onFolderChange(folder && driveId != null ? { path: folder, driveId, letter: d?.letter ?? null } : null);
  }, [folder, driveId, tree, onFolderChange]);

  // ---- the selected folder's card, history and notes ----
  const loadFolder = useCallback((p: string, dId: number | null) => {
    setFolderBusy(true);
    void Promise.all([
      window.api.scan.notes.card(p),
      window.api.scan.notes.history(p),
      window.api.scan.notes.list(dId, p),
    ])
      .then(([c, h, n]) => {
        setCard(c);
        setHistory(h);
        setNotes(n);
      })
      .catch((e: unknown) => signalAppToast(e instanceof Error ? e.message : String(e), "err"))
      .finally(() => setFolderBusy(false));
  }, []);

  useEffect(() => {
    if (folder === null) return;
    loadFolder(folder, driveId);
    setOpenUuid(null); // a new folder opens on its report, never on the last folder's note
    setNote(null);
  }, [folder, driveId, refreshKey, loadFolder]);

  // ---- the open note ----
  useEffect(() => {
    if (openUuid === null) { setNote(null); draft.current = null; return; }
    void window.api.scan.notes
      .get(openUuid)
      .then((n) => { setNote(n); draft.current = { title: n.title, body: n.body }; setSaved(""); })
      .catch((e: unknown) => { setOpenUuid(null); signalAppToast(e instanceof Error ? e.message : String(e), "err"); });
  }, [openUuid]);

  // AUTOSAVE ON A PAUSE, not on a keystroke. The timer is cleared on unmount AND flushed — walking
  // away from the screen mid-sentence must not cost the sentence.
  const scheduleSave = useCallback((next: { title?: string; body?: string }) => {
    if (!draft.current || !openUuid) return;
    draft.current = { ...draft.current, ...next };
    setSaved("Saving…");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const d = draft.current;
      if (!d) return;
      void window.api.scan.notes
        .save(openUuid, d.title, d.body)
        .then(() => setSaved("Saved."))
        .catch((e: unknown) => setSaved(e instanceof Error ? e.message : String(e)));
    }, AUTOSAVE_MS);
  }, [openUuid]);

  useEffect(
    () => () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      // The pending edit is flushed rather than dropped — this fires on unmount and on note switch.
      const d = draft.current;
      if (d && openUuid) void window.api.scan.notes.save(openUuid, d.title, d.body).catch(() => undefined);
    },
    [openUuid]
  );

  // ---- rename ----
  const applyRename = useCallback(() => {
    if (!renaming) return;
    setBusy(true);
    setRenameErr(null);
    void window.api.scan.notes
      .rename(renaming.path, renaming.name)
      .then((r) => {
        if (!r.ok) { setRenameErr(r.message); return; }
        setRenaming(null);
        if (r.newPath && folder === renaming.path) setFolder(r.newPath);
        signalAppToast(r.message, "ok");
      })
      .catch((e: unknown) => setRenameErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  }, [renaming, folder]);

  // The nesting is rebuilt only when the flat list actually changes, not on every keystroke.
  const trees = useMemo(() => new Map(tree.map((d) => [d.drive_id, buildTree(d.folders)])), [tree]);

  const toggleBranch = useCallback((p: string) => {
    setExpanded((s) => {
      const n = new Set(s);
      const k = p.toLowerCase();
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  }, []);

  /** Open every branch down to a path and select it — used by the search and after a rename. */
  const revealFolder = useCallback((p: string, dId: number | null) => {
    setExpanded((s) => { const n = new Set(s); for (const a of ancestorsOf(p)) n.add(a); return n; });
    if (dId != null) { setClosed((c) => { const n = new Set(c); n.delete(dId); return n; }); setDriveId(dId); }
    setFolder(p);
  }, []);

  useEffect(() => {
    if (jumpTo) revealFolder(jumpTo.path, jumpTo.driveId);
  }, [jumpTo, revealFolder]);

  const selectedDrive = useMemo(() => tree.find((d) => d.drive_id === driveId) ?? null, [tree, driveId]);
  const latestApplied = history.find((h) => h.status === "applied") ?? null;

  return (
    <div className={`scannotes-grid${mediaMode ? " media" : ""}`}>
      {/* ---- pane 1: the drive / folder tree ---- */}
      <div className="scannotes-pane">
        <RecentWork
          rows={recent}
          selected={folder}
          onPick={(r) => { setFolder(r.path); if (r.drive_id !== null) setDriveId(r.drive_id); }}
          onSeeAll={onSeeAll ?? (() => undefined)}
        />
        <h3>Drives</h3>
        {loading && <Waiting what="Loading drives…" />}
        {!loading && tree.length === 0 && (
          <div className="scannotes-empty">No scanned drives yet. Run a scan and the folders appear here.</div>
        )}
        {tree.map((d) => (
          <div key={d.drive_id} className={`scannotes-drive${closed.has(d.drive_id) ? " closed" : ""}`}>
            <button
              type="button"
              className="scannotes-drivehead"
              onClick={() => setClosed((s) => { const n = new Set(s); if (n.has(d.drive_id)) n.delete(d.drive_id); else n.add(d.drive_id); return n; })}
            >
              <span className="scannotes-caret">▾</span>
              <span
                className={`scannotes-dot ${d.connected ? "on" : "off"}`}
                title={d.connected ? "Connected" : "Not connected — renames are queued until it is"}
              />
              {d.letter ? `${d.letter}\\ ` : ""}{d.volume_label ?? d.volume_serial}
              <span className="scannotes-serial">{d.volume_serial}</span>
            </button>
            {!closed.has(d.drive_id) && (
              <div>
                {d.folders.length === 0 && <div className="scannotes-empty">No folders with media on this drive.</div>}
                {/* The count is known from the first page, so the pane can say what is still coming
                    rather than looking finished when it is not. */}
                {d.folder_total > d.folders.length && (
                  <Waiting what={`${d.folders.length} of ${d.folder_total.toLocaleString()} folders — loading the rest…`} />
                )}
                {(trees.get(d.drive_id) ?? []).map((n) => (
                  <Branch
                    key={n.path}
                    node={n}
                    depth={0}
                    selected={folder}
                    expanded={expanded}
                    onToggle={toggleBranch}
                    onSelect={(node) => { setFolder(node.path); setDriveId(d.drive_id); }}
                    onRename={(node) => { setRenameErr(null); setRenaming({ path: node.path, name: node.name }); }}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ---- pane 2: the file list. Hidden in media mode. ---- */}
      {!mediaMode && (
        <div className="scannotes-pane">
          <h3>Files</h3>
          {folder === null && !loading && <div className="scannotes-empty">Pick a folder on the left.</div>}
          {folderBusy && <Waiting what="Reading this folder…" />}
          {folder !== null && !folderBusy && (
            <>
              <button type="button" className={`scannotes-card${openUuid === null ? " sel" : ""}`} onClick={() => setOpenUuid(null)}>
                <div className="t">📄 Folder report <span className="scannotes-badge-ro">Read-only</span></div>
                <div className="d">{card?.committed_at ? `Scanned ${longStamp(card.committed_at)}` : "Not scanned yet"}</div>
                <p>
                  {card
                    ? `${card.media_files.toLocaleString()} media files · ${card.image_count.toLocaleString()} stills · ${card.video_count.toLocaleString()} video`
                    : "No scan record for this folder yet."}
                </p>
              </button>
              {notes.map((n) => (
                <button key={n.uuid} type="button" className={`scannotes-card${openUuid === n.uuid ? " sel" : ""}`} onClick={() => setOpenUuid(n.uuid)}>
                  <div className="t">📝 {n.title} <span className="scannotes-badge-user">Editable</span></div>
                  <div className="d">{n.updated_at ? `Edited ${longStamp(n.updated_at)}` : `Created ${longStamp(n.created_at)}`}</div>
                  <p>{n.excerpt.trim() || "Empty note."}</p>
                </button>
              ))}
              {notes.length === 0 && <div className="scannotes-empty">No notes on this folder yet — "+ Add Note" starts one.</div>}
            </>
          )}
        </div>
      )}

      {/* ---- pane 3: media grid, or the editor / rendered report ---- */}
      {mediaMode ? (
        <div className="scannotes-pane">
          <h3>{selectedDrive ? `${selectedDrive.letter ?? selectedDrive.volume_label ?? ""} / ` : ""}{folder ? folder.split("\\").pop() : "No folder"}</h3>
          {mediaPane ?? <div className="scannotes-empty">Media browsing is not wired yet.</div>}
        </div>
      ) : (
        <div className="scannotes-pane">
          {folderBusy || (loading && folder === null) ? (
            <Waiting what={folderBusy ? "Reading this folder…" : "Loading drives…"} />
          ) : folder === null ? (
            <div className="scannotes-empty">Pick a folder on the left.</div>
          ) : (
            <>
              {note !== null && (
                <div className="scannotes-edtitle">
                  <input
                    value={note.title}
                    aria-label="Note title"
                    onChange={(e) => { setNote({ ...note, title: e.target.value }); scheduleSave({ title: e.target.value }); }}
                  />
                </div>
              )}

              {history.length > 0 && (
                <div className="scannotes-history">
                  <div className="hh"><span aria-hidden="true">🔒</span> Folder History</div>
                  {history.map((h) => <HistoryLine key={h.uuid} row={h} card={card} />)}
                </div>
              )}

              {note === null ? (
                card ? <ReportCard card={card} /> : <div className="scannotes-empty">This folder has no scan record yet.</div>
              ) : (
                <>
                  <div className="scannotes-toolbar">
                    {TOOLBAR.map(([action, glyph, label]) => (
                      <button key={label} type="button" title={label} aria-label={label} onClick={() => ed.current?.run(action)}>
                        {glyph}
                      </button>
                    ))}
                  </div>
                  <div className="scannotes-edbody">
                    <MilkdownEditor
                      ref={ed}
                      docId={note.uuid}
                      initial={note.body}
                      onChange={(md) => scheduleSave({ body: md })}
                    />
                  </div>
                  <div className={`scannotes-saved${saved && saved !== "Saved." && saved !== "Saving…" ? " err" : ""}`}>{saved}</div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* ---- the rename modal ---- */}
      {/* data-modal-backdrop dims the OS-drawn window buttons — see MediaGrid for why. */}
      {renaming && (
        <div className="scannotes-overlay" data-modal-backdrop="" role="dialog" aria-modal="true" aria-label="Rename folder">
          <div className="scannotes-modal">
            <h2>Rename folder</h2>
            <div className="sub2">
              Renames the folder on the drive when it is connected, and queues it when it is not.
              Every change is recorded — you can always see what it was called before.
            </div>
            <div className="fl">New folder name</div>
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <input
              type="text"
              autoFocus
              value={renaming.name}
              onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") applyRename(); if (e.key === "Escape") setRenaming(null); }}
            />
            <div className="scannotes-chainprev">
              {latestApplied ? `${latestApplied.name_old} -> ` : ""}
              {renaming.path.split("\\").pop()} -&gt; {renaming.name}
            </div>
            {renameErr && <div className="scannotes-modalerr">{renameErr}</div>}
            <div className="scannotes-btnrow">
              <button type="button" className="scannotes-btn" onClick={() => setRenaming(null)}>Cancel</button>
              <button type="button" className="scannotes-btn pri" disabled={busy} onClick={applyRename}>Rename</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Re-exported so the parent can render the read-only side without importing the renderer twice. */
export { Markdown };
