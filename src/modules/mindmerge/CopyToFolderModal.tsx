/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary — File: src/modules/mindmerge/CopyToFolderModal.tsx */
// "Where do you want to copy this note to?" (Jason 09-09-2026: "a copy icon button on the sidebar
// where notes are… show the list of folders/subfolders, user clicks to open folders/subfolders,
// selects which folder, then hits submit, it then saves a copy of the selected note to the new
// folder as it is in its current written phase"). No mockup — waived by Jason for this one.
//
// A folder picker inside the house confirm dialog. The tree is the rail's tree — same rows, same
// glyphs, same inclusive counts — read fresh on open, with its OWN transient expand state (the
// rail's persisted notes.folders_open belongs to the rail). Submit is HELD, not disabled, until a
// folder is picked, so the button can say why (ConfirmModal's `blocked` contract). Folders only:
// Unfiled is not a destination — a copy goes INTO somewhere. The write itself lives in the caller;
// this component only answers "which folder".
import { useEffect, useMemo, useState } from "react";
import ConfirmModal from "./ConfirmModal";
import { mindmergeApi, type MindMergeDocFolder } from "./mindmergeApi";

export interface CopyToFolderModalProps {
  noteTitle: string;
  /** Where the note already is. That row can be picked, but Submit says it would be a duplicate. */
  currentFolderId: number | null;
  /** The chosen folder and its breadcrumb ("docs › canon › vicky") — two folders can share a name. */
  onCopy: (folder: MindMergeDocFolder, path: string) => void;
  onClose: () => void;
}

export default function CopyToFolderModal({ noteTitle, currentFolderId, onCopy, onClose }: CopyToFolderModalProps) {
  const api = mindmergeApi();
  const [folders, setFolders] = useState<MindMergeDocFolder[] | null>(null);
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [picked, setPicked] = useState<MindMergeDocFolder | null>(null);

  useEffect(() => {
    void api.listNoteFolders()
      .then((r) => { setFolders(r.folders); setCounts(r.counts); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [api]);

  /** Children indexed by parent — the rail's walk, not a filter per row. */
  const kids = useMemo(() => {
    const m = new Map<number | null, MindMergeDocFolder[]>();
    for (const f of folders ?? []) { const l = m.get(f.parent_id) ?? []; l.push(f); m.set(f.parent_id, l); }
    return m;
  }, [folders]);

  const toggle = (id: number): void =>
    setOpen((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const pathOf = (f: MindMergeDocFolder): string => {
    const byId = new Map((folders ?? []).map((x) => [x.id, x]));
    const names: string[] = [];
    for (let cur: MindMergeDocFolder | undefined = f; cur; cur = cur.parent_id == null ? undefined : byId.get(cur.parent_id)) names.unshift(cur.name);
    return names.join(" › ");
  };

  const row = (f: MindMergeDocFolder, depth: number): React.ReactNode => {
    const children = kids.get(f.id) ?? [];
    const isOpen = open.has(f.id);
    return (
      <div key={f.id}>
        <div
          className={`mm-frow${picked?.id === f.id ? " on" : ""}`}
          style={{ paddingLeft: 10 + depth * 14 }}
          // The rail's gesture: clicking the row selects it AND opens it; the caret is what collapses.
          onClick={() => { setPicked(f); if (children.length && !isOpen) toggle(f.id); }}
        >
          <button
            type="button"
            className="mm-fcar"
            title={children.length === 0 ? "" : isOpen ? "Collapse" : "Expand"}
            onClick={(e) => { e.stopPropagation(); if (children.length) toggle(f.id); }}
          >
            {children.length === 0 ? "" : isOpen ? "▾" : "▸"}
          </button>
          <span className="mm-fic" aria-hidden="true">📁</span>
          <span className="mm-fname">{f.name}</span>
          <span className="mm-fn">{counts[f.id] ?? 0}</span>
        </div>
        {isOpen && children.map((c) => row(c, depth + 1))}
      </div>
    );
  };

  const roots = kids.get(null) ?? [];
  const blocked = picked === null
    ? "Pick a folder first."
    : picked.id === currentFolderId ? "This note is already in that folder — pick a different one." : null;

  return (
    <ConfirmModal
      title="Where do you want to copy this note to?"
      confirmLabel="Submit"
      blocked={blocked}
      onConfirm={() => { if (picked) onCopy(picked, pathOf(picked)); }}
      onClose={onClose}
      body={
        <>
          <p>
            A copy of <b>{noteTitle || "Untitled"}</b>, exactly as it reads right now, is saved into the folder you
            pick. The original stays where it is.
          </p>
          {error && <div className="mm-state error">{error}</div>}
          <div className="mm-pickertree">
            {folders === null ? (
              <div className="mm-hint" style={{ padding: 8 }}>Loading folders…</div>
            ) : roots.length === 0 ? (
              <div className="mm-hint" style={{ padding: 8 }}>No folders yet — make one in the sidebar first.</div>
            ) : (
              roots.map((f) => row(f, 0))
            )}
          </div>
          {picked && <p className="mm-hint" style={{ marginTop: 8 }}>Copy to: <b>{pathOf(picked)}</b></p>}
        </>
      }
    />
  );
}
