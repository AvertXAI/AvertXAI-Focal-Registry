// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: The Documents tab, built to MOCKUP-mindmerge-rework-v7-08-23-2026.html (BL-58,
//              approved). Three columns: rail (Recently edited + the stacked import FOLDERS tree),
//              document list, editor (Editor | Raw | Split | Preview). Edits go to the FILE ON
//              DISK through mindmerge:writeFile — the watcher and an immediate ingest keep the
//              database honest, which is the "editor auto-updates edits in real time" ruling.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: src/modules/mindmerge/DocsSurface.tsx
//------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MindMergeTreeNode, NoteRow } from "../../shared/types";
import { renderMarkdown } from "./markdown";
import MilkdownEditor from "./MilkdownEditor";

const api = window.api;

// "2m" / "3h" / "Fri" / a date — the recency stamps the v7 mockup shows in the rail and the list.
export function fmtAgo(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return new Date(t).toLocaleDateString(undefined, { weekday: "short" });
  return new Date(t).toLocaleDateString();
}

/**
 * EDIT MARKERS — the corner count from the mockup. There is no edit-event table (BL-51), so the
 * count is SESSION-SCOPED: saves made in this run of the app, expiring after the five-minute window
 * Jason named in the v2 feedback. Module-level so a tab switch never wipes it; an app restart does,
 * and the marker honestly means "edited just now", never "unsaved" — auto-save has no unsaved state.
 */
const editMarks = new Map<string, { count: number; last: number }>();
const MARK_WINDOW_MS = 5 * 60 * 1000;
function markOf(p: string): number | null {
  const m = editMarks.get(p);
  if (!m) return null;
  if (Date.now() - m.last > MARK_WINDOW_MS) {
    editMarks.delete(p);
    return null;
  }
  return m.count;
}

const SEP = "\\"; // rows arrive from main's path.join, so Windows separators — this app ships Windows-first
const within = (file: string, dir: string): boolean => file.startsWith(dir + "\\") || file.startsWith(dir + "/");
const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p;
const dirName = (p: string): string => p.slice(0, Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/")));

const docTitle = (r: NoteRow): string => r.title || baseName(r.file_path).replace(/\.md$/i, "");
function docExcerpt(r: NoteRow): string {
  for (const line of (r.body_md ?? "").split(/\r?\n/)) {
    const t = line.trim();
    if (t && !t.startsWith("#")) return t.slice(0, 110);
  }
  return "";
}

type EdMode = "editor" | "raw" | "split" | "preview";
const MODES: { id: EdMode; label: string }[] = [
  { id: "editor", label: "Editor" },
  { id: "raw", label: "Raw" },
  { id: "split", label: "Split" },
  { id: "preview", label: "Preview" },
];

interface Props {
  /** The ingest rows (parse ok), owned by the module — this surface never re-fetches the corpus. */
  rows: NoteRow[] | null;
  reloadKey: number;
  /** A root that + Import just stacked: it expands, its first folder expands, it becomes context. */
  lastAdded: string | null;
  onAddedHandled: () => void;
  /** A file the search overlay (or the rail) asked to open. */
  openFile: string | null;
  onOpenHandled: () => void;
  /** The import you are inside — the tab-row strip shows ITS path and count (v5 ruling). */
  onRootCtx: (ctx: { path: string; count: number } | null) => void;
  /** A save landed — the module re-pulls rows so counts and excerpts stay truthful. */
  onSaved: () => void;
  /** The rail's « collapse — ONE preference shared with the Brain sidebar (mindmerge.rail_collapsed,
      persisted by the module). Ruled 08-25-2026: the collapse control lives on the RAIL. */
  railCollapsed: boolean;
  onRailToggle: () => void;
}

export default function DocsSurface(p: Props) {
  const [tree, setTree] = useState<MindMergeTreeNode[] | null>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [selFolder, setSelFolder] = useState<string | null>(null);
  const [selFile, setSelFile] = useState<string | null>(null);
  const [mode, setMode] = useState<EdMode>("editor");
  const [body, setBody] = useState<string | null>(null);
  const [edErr, setEdErr] = useState<string | null>(null);
  const [, repaint] = useState(0);

  // Refs mirror the two selections so the debounced save can never write stale text to a stale path.
  const selFileRef = useRef<string | null>(null);
  const bodyRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const saveTimer = useRef<number | null>(null);

  // ---------- tree ----------
  useEffect(() => {
    void api.mindmerge
      .tree()
      .then((t) => {
        setTree(t);
        // First arrival: the first import opens with its first folder, per the v2 ruling.
        setOpen((prev) => {
          if (prev.size) return prev;
          const next = new Set<string>();
          if (t[0]) {
            next.add(t[0].path);
            if (t[0].children[0]) next.add(t[0].children[0].path);
          }
          return next;
        });
        setSelFolder((f) => f ?? t[0]?.path ?? null);
      })
      .catch(() => setTree([]));
  }, [p.reloadKey]);

  // A freshly stacked import expands, its first folder expands with it, and it takes the context —
  // WITHOUT folding what was open: "i wont want the first import to close to open the new one".
  useEffect(() => {
    if (!p.lastAdded || !tree) return;
    const root = tree.find((r) => r.path === p.lastAdded);
    if (!root) return;
    setOpen((prev) => {
      const next = new Set(prev);
      next.add(root.path);
      if (root.children[0]) next.add(root.children[0].path);
      return next;
    });
    setSelFolder(root.path);
    p.onAddedHandled();
  }, [tree, p.lastAdded]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- the import you are inside → the strip (subfolders report their IMPORT's path) ----------
  const ctxRoot = useMemo(() => {
    if (!tree) return null;
    if (!selFolder) return tree[0] ?? null;
    return tree.find((r) => r.path === selFolder || within(selFolder, r.path)) ?? tree[0] ?? null;
  }, [tree, selFolder]);
  useEffect(() => {
    p.onRootCtx(ctxRoot ? { path: ctxRoot.path, count: ctxRoot.count } : null);
  }, [ctxRoot]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- list ----------
  const files = useMemo(() => {
    if (!p.rows) return null;
    const list = selFolder ? p.rows.filter((r) => within(r.file_path, selFolder)) : p.rows;
    return list.slice().sort((a, b) => (b.updated_at ?? b.created_at).localeCompare(a.updated_at ?? a.created_at));
  }, [p.rows, selFolder]);

  const recent = useMemo(() => {
    if (!p.rows) return [];
    return p.rows
      .slice()
      .sort((a, b) => (b.updated_at ?? b.created_at).localeCompare(a.updated_at ?? a.created_at))
      .slice(0, 5);
  }, [p.rows]);

  // Markers age out on their own; a slow repaint keeps the badges honest without a per-second timer.
  useEffect(() => {
    const t = window.setInterval(() => repaint((x) => x + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);

  // ---------- open / save ----------
  const flushSave = useCallback((): void => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const f = selFileRef.current;
    const text = bodyRef.current;
    if (dirtyRef.current && f && text !== null) {
      dirtyRef.current = false;
      void api.mindmerge.writeFile(f, text).catch(() => {});
    }
  }, []);
  useEffect(() => flushSave, [flushSave]); // unmount: never drop keystrokes on a tab switch

  const openPath = useCallback(
    (f: string) => {
      flushSave();
      selFileRef.current = f;
      bodyRef.current = null;
      dirtyRef.current = false;
      setSelFile(f);
      setBody(null);
      setEdErr(null);
      void api.mindmerge
        .readFile(f)
        .then((text) => {
          if (selFileRef.current !== f) return; // user already moved on
          bodyRef.current = text;
          setBody(text);
        })
        .catch((e) => setEdErr(e instanceof Error ? e.message : String(e)));
    },
    [flushSave]
  );

  // The search overlay (or Recently edited) asked for a file: open it AND walk the tree there.
  useEffect(() => {
    if (!p.openFile) return;
    const f = p.openFile;
    const dir = dirName(f);
    setSelFolder(dir);
    setOpen((prev) => {
      const next = new Set(prev);
      // expand every ancestor between the file and its root, so the selection is visible
      const root = tree?.find((r) => within(f, r.path));
      if (root) {
        let walk = dir;
        while (walk.length >= root.path.length) {
          next.add(walk);
          const up = dirName(walk);
          if (up === walk) break;
          walk = up;
        }
      }
      return next;
    });
    openPath(f);
    p.onOpenHandled();
  }, [p.openFile]); // eslint-disable-line react-hooks/exhaustive-deps

  const doSave = useCallback(
    (f: string, text: string): void => {
      dirtyRef.current = false;
      void api.mindmerge
        .writeFile(f, text)
        .then(() => {
          const m = editMarks.get(f);
          const stillFresh = m && Date.now() - m.last <= MARK_WINDOW_MS;
          editMarks.set(f, { count: (stillFresh ? m.count : 0) + 1, last: Date.now() });
          p.onSaved();
        })
        .catch((e) => setEdErr(e instanceof Error ? e.message : String(e)));
    },
    [p]
  );

  const onEdit = useCallback(
    (text: string): void => {
      const f = selFileRef.current;
      if (!f) return;
      bodyRef.current = text;
      dirtyRef.current = true;
      setBody(text);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => doSave(f, text), 800);
    },
    [doSave]
  );

  // + New — a real markdown file in the selected folder, opened for writing immediately.
  const newFile = useCallback(async (): Promise<void> => {
    const dir = selFolder ?? tree?.[0]?.path;
    if (!dir) return;
    const taken = new Set((p.rows ?? []).map((r) => r.file_path.toLowerCase()));
    let name = "Untitled.md";
    for (let i = 2; taken.has((dir + SEP + name).toLowerCase()); i++) name = `Untitled-${i}.md`;
    const full = dir + SEP + name;
    try {
      await api.mindmerge.writeFile(full, "# " + name.replace(/\.md$/i, "") + "\n\n");
      p.onSaved();
      openPath(full);
    } catch (e) {
      setEdErr(e instanceof Error ? e.message : String(e));
    }
  }, [selFolder, tree, p, openPath]);

  const toggleOpen = (path: string): void =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const renderFolder = (n: MindMergeTreeNode, depth: number, isRoot: boolean): React.ReactNode => (
    <div key={n.path}>
      <button
        className={"mmd-frow" + (selFolder === n.path ? " on" : "") + (isRoot ? " root" : "")}
        style={{ paddingLeft: 8 + depth * 14 }}
        // Clicking the ROW opens the folder as well as selecting it (Jason 08-25-2026: "anytime i
        // click on these folders, it opens it"). Open only — the chevron is what closes.
        onClick={() => {
          setSelFolder(n.path);
          if (n.children.length && !open.has(n.path)) toggleOpen(n.path);
        }}
        title={n.path}
      >
        <span
          className="mmd-chev"
          onClick={(e) => {
            e.stopPropagation();
            if (n.children.length) toggleOpen(n.path);
          }}
        >
          {n.children.length ? (open.has(n.path) ? "▾" : "▸") : ""}
        </span>
        <span className="mmd-fname">{n.name}</span>
        <span className="mmd-fct">{n.count.toLocaleString()}</span>
      </button>
      {open.has(n.path) && n.children.map((c) => renderFolder(c, depth + 1, false))}
    </div>
  );

  const selRow = selFile && p.rows ? p.rows.find((r) => r.file_path === selFile) ?? null : null;

  return (
    <div className="mmd">
      {/* ---------- rail: Recently edited above Folders, per the approved mockup ---------- */}
      <div className={"mmd-rail" + (p.railCollapsed ? " collapsed" : "")}>
        <div className="mmd-railscroll">
        {recent.length > 0 && (
          <>
            <div className="mmd-rh">Recently edited</div>
            {recent.map((r) => {
              const c = markOf(r.file_path);
              return (
                <button key={r.uuid} className="mmd-rrow" onClick={() => openPath(r.file_path)} title={r.file_path}>
                  {c !== null && <span className="mm-count">{c}</span>}
                  <span className="mmd-rname">{docTitle(r)}</span>
                  <span className="mmd-rago">{fmtAgo(r.updated_at ?? r.created_at)}</span>
                </button>
              );
            })}
          </>
        )}
        <div className="mmd-rh">Folders</div>
        {tree === null && <div className="mmd-hint">Reading folders&hellip;</div>}
        {tree !== null && tree.length === 0 && (
          <div className="mmd-hint">Nothing imported yet &mdash; use + Import above.</div>
        )}
        {tree?.map((r) => renderFolder(r, 0, true))}
        </div>
        {/* THE ONE COLLAPSE CONTROL — welded to the rail's right edge, outside the pane's box so
            width:0 cannot take it with it (the vault Sidebar shape; Jason 08-25-2026). */}
        <button
          className="edgetab"
          title={p.railCollapsed ? "Expand the sidebar" : "Collapse the sidebar"}
          aria-label={p.railCollapsed ? "Expand the sidebar" : "Collapse the sidebar"}
          aria-expanded={!p.railCollapsed}
          onClick={p.onRailToggle}
        >
          {p.railCollapsed ? "»" : "«"}
        </button>
      </div>

      {/* ---------- document list ---------- */}
      <div className="mmd-list">
        <div className="mmd-lh">
          <span>Documents</span>
          <button className="mmd-new" onClick={() => void newFile()}>+ New</button>
        </div>
        <div className="mmd-lrows">
          {files?.map((r) => {
            const c = markOf(r.file_path);
            return (
              <button
                key={r.uuid}
                className={"mmd-doc" + (selFile === r.file_path ? " on" : "")}
                onClick={() => openPath(r.file_path)}
              >
                {c !== null && <span className="mm-count mmd-corner">{c}</span>}
                <span className="mmd-dt">{docTitle(r)}</span>
                <span className="mmd-dx">{docExcerpt(r)}</span>
                <span className="mmd-dd">Edited {fmtAgo(r.updated_at ?? r.created_at)}</span>
              </button>
            );
          })}
          {files !== null && files.length === 0 && <div className="mmd-hint">No documents in this folder.</div>}
        </div>
      </div>

      {/* ---------- editor ---------- */}
      <div className="mmd-ed">
        <div className="mmd-eh">
          <div className="mmd-modes">
            {MODES.map((m) => (
              <button key={m.id} className={"mmd-mode" + (mode === m.id ? " on" : "")} onClick={() => setMode(m.id)}>
                {m.label}
              </button>
            ))}
          </div>
          {selFile && (
            <span className="mmd-path" title={selFile}>
              {selFile}
            </span>
          )}
        </div>
        {edErr && <div className="mmd-err" role="alert">{edErr}</div>}
        {!selFile && <div className="mmd-blank">Pick a document, or press + New.</div>}
        {selFile && body === null && !edErr && <div className="mmd-blank">Opening&hellip;</div>}
        {selFile && body !== null && (
          <div className="mmd-ebody">
            {mode === "editor" && (
              <div className="mmd-milk">
                <MilkdownEditor docId={selFile} initial={body} onChange={onEdit} />
              </div>
            )}
            {mode === "raw" && (
              <textarea
                className="mmd-raw"
                value={body}
                onChange={(e) => onEdit(e.target.value)}
                spellCheck={false}
                aria-label="Raw markdown"
              />
            )}
            {mode === "split" && (
              <div className="mmd-split">
                <textarea
                  className="mmd-raw"
                  value={body}
                  onChange={(e) => onEdit(e.target.value)}
                  spellCheck={false}
                  aria-label="Raw markdown"
                />
                <div className="mmd-view rbs-md">{renderMarkdown(body)}</div>
              </div>
            )}
            {mode === "preview" && <div className="mmd-view rbs-md">{renderMarkdown(body)}</div>}
          </div>
        )}
        {selRow?.parse_status === "error" && (
          <div className="mmd-err">This file did not parse cleanly: {selRow.parse_error}</div>
        )}
      </div>
    </div>
  );
}
