/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
/* File: src/modules/mindmerge/NoteFolderRail.tsx */
// The authored-document folder tree — copied from the Secured Vault's Secured Notes stack — in the
// SIDEBAR under Shortcuts (Jason 08-11-2026: "move the folders under the shortcuts sidebar"). The
// first mockup drew it as a third column beside the note list — wrong twice over: the vault's
// Passwords rail already puts its tree in the sidebar, and a third column would have left the
// editor about 200 pixels wide at the 740 floor.
//
// COUNTS ARE INCLUSIVE OF DESCENDANTS, computed main-side. A parent reading 0 while its children
// hold a thousand notes is the number that makes people stop trusting the tree.
//
// UNFILED IS SHOWN ONLY WHEN IT HOLDS SOMETHING. It was permanent while deleting a folder dumped
// notes there; nothing arrives silently any more, so an empty row was clutter (Jason 08-12-2026).
//
// A FOLDER OFFERS THE SAME THREE CHOICES A NOTE DOES — cancel, archive, delete — plus Empty as its
// own row action. The confirm says the counts out loud first, and says how many are already archived,
// because that number is why the tree's count and the confirm's count legitimately differ.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ConfirmModal from "./ConfirmModal";
import { mindmergeApi, type MindMergeDocFolder } from "./mindmergeApi";

export interface NoteFolderRailProps {
  /** Selected folder id: -1 = Unfiled (the default), else a folder id. 0 means "no filter" and
   *  no longer has a row — "All notes" was removed 08-12-2026. */
  selected: number;
  onSelect: (id: number) => void;
  /** Bumped by the parent whenever notes change, so counts stay honest. */
  reloadKey: number;
  onChanged: () => void;
  /**
   * WHICH FOLDERS ARE EXPANDED, owned by the module and persisted (Jason 08-12-2026: "the folders i
   * expanded previously didnt stay un-collapsed").
   *
   * This cannot be local state. The tree renders only while the notes section is on screen
   * (Sidebar.tsx), so every tab switch unmounts it and takes a `useState` Set with it — you come
   * back to a fully collapsed tree and re-open four levels to get where you were. A row in the
   * database is the sanctioned home for view state that has to outlive a mount.
   */
  open: number[];
  onOpen: (ids: number[]) => void;
}

export default function NoteFolderRail({ selected, onSelect, reloadKey, onChanged, open: openIds, onOpen }: NoteFolderRailProps) {
  const api = mindmergeApi();
  const [folders, setFolders] = useState<MindMergeDocFolder[]>([]);
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [unfiled, setUnfiled] = useState(0);
  const open = useMemo(() => new Set(openIds), [openIds]);
  const [adding, setAdding] = useState<number | null | "root">(null);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<MindMergeDocFolder | null>(null);
  const [ask, setAsk] = useState<MindMergeDocFolder | null>(null);
  /** What the pending delete would take. Fetched BEFORE the modal can be confirmed, so the warning
      states real numbers rather than a generic "are you sure". */
  const [askCount, setAskCount] = useState<{ folders: number; notes: number; directNotes: number; archived: number } | null>(null);
  /** What the last delete actually did — stated out loud, because an invisible outcome is how a
      correct operation gets reported as a bug. */
  const [outcome, setOutcome] = useState<string | null>(null);
  const [askEmpty, setAskEmpty] = useState<MindMergeDocFolder | null>(null);
  const [askEmptyCount, setAskEmptyCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((): void => {
    void api.listNoteFolders()
      .then((r) => { setFolders(r.folders); setCounts(r.counts); setUnfiled(r.unfiled); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [api]);
  useEffect(() => { load(); }, [load, reloadKey]);

  /** Children indexed by parent, so rendering is a walk rather than a filter per row. */
  const kids = useMemo(() => {
    const m = new Map<number | null, MindMergeDocFolder[]>();
    for (const f of folders) {
      const list = m.get(f.parent_id) ?? [];
      list.push(f);
      m.set(f.parent_id, list);
    }
    return m;
  }, [folders]);

  /** Expand or collapse, and write it. PRUNED against the folders that actually exist as it goes —
      a deleted folder's id would otherwise sit in the list forever, growing by one per delete. */
  const toggle = (id: number): void => {
    const live = new Set(folders.map((f) => f.id));
    const next = new Set([...openIds].filter((x) => live.has(x)));
    if (next.has(id)) next.delete(id); else next.add(id);
    onOpen([...next]);
  };

  const submitAdd = (): void => {
    const parent = adding === "root" ? null : adding;
    if (!name.trim()) return setAdding(null);
    void api.createNoteFolder(name.trim(), parent)
      // Making a folder inside another expands the parent — otherwise the thing you just created is
      // hidden behind a collapsed caret.
      .then(() => { setName(""); setAdding(null); if (parent != null && !open.has(parent)) onOpen([...openIds, parent]); load(); })
      .catch((e: unknown) => { setError(e instanceof Error ? e.message : String(e)); setAdding(null); });
  };

  const submitRename = (): void => {
    if (!renaming || !name.trim()) return setRenaming(null);
    void api.renameNoteFolder(renaming.id, name.trim())
      .then(() => { setName(""); setRenaming(null); load(); })
      .catch((e: unknown) => { setError(e instanceof Error ? e.message : String(e)); setRenaming(null); });
  };

  /**
   * DRAG AND DROP, and why it needed three lines it did not have (Jason 08-12-2026: "even if i wanted
   * to create a new folder (to test) i cant drag the notes inside the new folder that are unfiled").
   *
   * The drop handler was correct all along — the FEEDBACK was missing entirely. Without a dragOver
   * that sets `dropEffect`, Windows shows the 🚫 no-entry cursor over every row, and no row lit up to
   * say it was a target. The gesture worked and looked forbidden, which is the same thing as broken.
   * The vault's Passwords rail has had both since it shipped (its FolderMenu.tsx sets effectAllowed
   * and dropEffect; its .vault-railrow.drop lights the row); this tree simply never got them.
   */
  const [over, setOver] = useState<number | null | "none">("none");

  const dragOver = (folderId: number | null, e: React.DragEvent): void => {
    if (!e.dataTransfer.types.includes("text/mindmerge-doc")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move"; // WITHOUT THIS the cursor says "you cannot drop here"
    setOver(folderId);
  };

  /** Drop a dragged note onto a folder. One folder per note, by ruling — this MOVES, never copies. */
  const dropNote = (folderId: number | null, e: React.DragEvent): void => {
    e.preventDefault();
    setOver("none");
    const uuid = e.dataTransfer.getData("text/mindmerge-doc");
    if (!uuid) return;
    void api.setNoteFolder(uuid, folderId)
      .then(() => {
        // onChanged() is what makes the note leave the list it was in. The rail already reloaded
        // itself here; the LIST did not, because the reload key never reached NotesView — which is
        // why a moved note sat in Unfiled until Ctrl+R (08-12-2026). Fixed in the module/list pair
        // (MindMergeModule/NotesView).
        load();
        onChanged();
      })
      .catch((e2: unknown) => setError(e2 instanceof Error ? e2.message : String(e2)));
  };

  /**
   * REVEAL A FOLDER THAT WAS SELECTED FROM SOMEWHERE ELSE (Jason 08-12-2026: "it should open that
   * note, but direct it from the folder, so i see the folder selected").
   *
   * Opening a note out of the global search sets `selected` to the folder that note lives in. That
   * highlighted a row you frequently could not see — three levels inside collapsed parents, or a
   * long way down a tree with hundreds of folders. A selection you have to go hunting for is not a
   * selection, and the tab looked like it had ignored you.
   *
   * TWO STEPS, and they must be two renders. Expanding the ancestors is what CREATES the row; only
   * once React has drawn it can it be scrolled to. So the effect runs again on every change that
   * could have mounted it, and `revealed` stops it re-scrolling once the job is done — otherwise
   * expanding some unrelated folder later would yank the rail back to this one.
   *
   * Ancestors are ADDED to the persisted open set, never substituted for it: revealing one folder
   * must not collapse the four you already had open.
   */
  const selRow = useRef<HTMLDivElement | null>(null);
  const revealed = useRef(0);
  const expandFor = useRef(0);
  useEffect(() => {
    if (selected <= 0) { revealed.current = 0; return; }
    if (selected === revealed.current) return;
    if (folders.length === 0) return; // the tree has not loaded yet; this re-runs when it does

    const parentOf = new Map(folders.map((f) => [f.id, f.parent_id]));
    const need: number[] = [];
    // Bounded walk. A cycle should be impossible — the service refuses a parent inside its own
    // subtree — but a render loop is not the place to find out it was.
    let p = parentOf.get(selected) ?? null;
    for (let hop = 0; hop < 64 && p != null; hop++) { need.push(p); p = parentOf.get(p) ?? null; }

    const missing = need.filter((id) => !open.has(id));
    if (missing.length > 0) {
      // ASK ONCE. onOpen writes through to the database and the parent hands the list back down; if
      // that write ever fails the set never changes, and without this the effect would re-fire on
      // every render forever. A folder that stays shut is a wart — a write loop is a hang.
      if (expandFor.current === selected) return;
      expandFor.current = selected;
      onOpen([...openIds, ...missing]);
      return; // draw first, scroll on the next pass
    }

    if (!selRow.current) return; // still not mounted — try again on the next render
    revealed.current = selected;
    selRow.current.scrollIntoView({ block: "center" });
  }, [selected, folders, open, openIds, onOpen]);

  const row = (f: MindMergeDocFolder, depth: number): React.ReactNode => {
    const children = kids.get(f.id) ?? [];
    const isOpen = open.has(f.id);
    return (
      <div key={f.id}>
        <div
          ref={selected === f.id ? selRow : undefined}
          className={`mm-frow${selected === f.id ? " on" : ""}${over === f.id ? " drop" : ""}`}
          style={{ paddingLeft: 10 + depth * 14 }}
          // Clicking the ROW opens the folder as well as selecting it (Jason 08-25-2026: "anytime i
          // click on these folders, it opens it"). Open only — the caret is what collapses.
          onClick={() => { onSelect(f.id); if (children.length && !isOpen) toggle(f.id); }}
          onDragOver={(e) => dragOver(f.id, e)}
          onDragLeave={() => setOver((p) => (p === f.id ? "none" : p))}
          onDrop={(e) => dropNote(f.id, e)}
        >
          <button
            className="mm-fcar"
            title={children.length === 0 ? "" : isOpen ? "Collapse" : "Expand"}
            onClick={(e) => { e.stopPropagation(); if (children.length) toggle(f.id); }}
          >
            {children.length === 0 ? "" : isOpen ? "▾" : "▸"}
          </button>
          <span className="mm-fic" aria-hidden="true">📁</span>
          <span className="mm-fname">{f.name}</span>
          <span className="mm-fn">{counts[f.id] ?? 0}</span>
          <span className="mm-facts">
            <button title="New folder inside" onClick={(e) => { e.stopPropagation(); setName(""); setAdding(f.id); }}>+</button>
            <button title="Rename" onClick={(e) => { e.stopPropagation(); setName(f.name); setRenaming(f); }}>✎</button>
            <button title="Empty it — keep the notes, unfile them" onClick={(e) => {
              e.stopPropagation();
              setAskEmptyCount(null);
              setAskEmpty(f);
              void api.noteFolderSubtree(f.id).then((r) => setAskEmptyCount(r.notes)).catch(() => setAskEmptyCount(null));
            }}>⇤</button>
            <button title="Delete this folder and everything in it" onClick={(e) => {
              e.stopPropagation();
              setAskCount(null);
              setAsk(f);
              void api.noteFolderSubtree(f.id).then(setAskCount).catch(() => setAskCount(null));
            }}>✕</button>
          </span>
        </div>
        {adding === f.id && (
          <input
            className="mm-fnew" autoFocus value={name} placeholder="Folder name"
            style={{ marginLeft: 24 + depth * 14 }}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitAdd(); if (e.key === "Escape") setAdding(null); }}
            onBlur={submitAdd}
          />
        )}
        {renaming?.id === f.id && (
          <input
            className="mm-fnew" autoFocus value={name}
            style={{ marginLeft: 24 + depth * 14 }}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitRename(); if (e.key === "Escape") setRenaming(null); }}
            onBlur={submitRename}
          />
        )}
        {isOpen && children.map((c) => row(c, depth + 1))}
      </div>
    );
  };

  return (
    <>
      <div className="mm-railhead">
        <span className="sbtxt">Folders</span>
        <button className="mm-addsc sbtxt" title="New top-level folder" onClick={() => { setName(""); setAdding("root"); }}>+ New folder</button>
      </div>

      {error && <div className="mm-hint sbtxt" style={{ padding: "2px 9px 6px", color: "var(--mm-danger-color)" }}>{error}</div>}
      {outcome && (
        <div className="mm-hint sbtxt" style={{ padding: "4px 9px 8px", color: "var(--mm-strong-color)" }}>
          {outcome}{" "}
          <button className="mm-addsc" style={{ padding: 0 }} onClick={() => setOutcome(null)}>dismiss</button>
        </div>
      )}


      {/* UNFILED FIRST (Jason 08-12-2026). "All notes" is gone — with 4,000 imported it was a
          button that loads everything, which is the one thing the windowing work exists to avoid.
          Unfiled leads because it is the pile that actually needs your attention. */}
      {/* SHOWN ONLY WHEN IT HOLDS SOMETHING (Jason 08-12-2026: "why does unfiled even exist if im not
          really needing it"). It was permanent because deleting a folder used to dump notes here —
          that path is gone, so nothing arrives silently and an empty row is just clutter. It still
          EXISTS because folder_id is nullable: a note created with no folder selected has to be
          reachable, and a note you cannot see is worse than a row you rarely need. */}
      {unfiled > 0 && (
      <div
        className={`mm-frow${selected === -1 ? " on" : ""}${over === null ? " drop" : ""}`}
        onClick={() => onSelect(-1)}
        onDragOver={(e) => dragOver(null, e)}
        onDragLeave={() => setOver((p) => (p === null ? "none" : p))}
        onDrop={(e) => dropNote(null, e)}
      >
        <span className="mm-fcar" />
        <span className="mm-fic" aria-hidden="true">📥</span>
        <span className="mm-fname sbtxt" style={{ color: "var(--mc-muted)" }}>Unfiled</span>
        <span className="mm-fn">{unfiled}</span>
      </div>
      )}

      {adding === "root" && (
        <input
          className="mm-fnew" autoFocus value={name} placeholder="Folder name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submitAdd(); if (e.key === "Escape") setAdding(null); }}
          onBlur={submitAdd}
        />
      )}

      {(kids.get(null) ?? []).map((f) => row(f, 0))}


      {askEmpty && (
        <ConfirmModal
          title={`Empty "${askEmpty.name}"?`}
          body={
            askEmptyCount === null ? <p>Counting…</p> : (
              <>
                <p>
                  <b>{askEmptyCount.toLocaleString()} note{askEmptyCount === 1 ? "" : "s"}</b> move to
                  <b> Unfiled</b> — including everything in its subfolders.
                </p>
                <p><b>Nothing is deleted.</b> The folders stay where they are, empty, and the notes are all still here.</p>
              </>
            )
          }
          confirmLabel={askEmptyCount === null ? "Counting…" : `Move ${askEmptyCount.toLocaleString()} to Unfiled`}
          onConfirm={() => {
            if (askEmptyCount === null) return;
            void api.emptyNoteFolder(askEmpty.id)
              .then((r) => {
                setOutcome(`${r.movedNotes} note${r.movedNotes === 1 ? "" : "s"} moved to Unfiled. Nothing was deleted.`);
                load(); onChanged();
              })
              .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
          }}
          onClose={() => { setAskEmpty(null); setAskEmptyCount(null); }}
        />
      )}

      {/* THREE WAYS OUT, the same three the note trashbin offers (Jason 08-12-2026: "if i wanted to
          delete a note, and i hit the trashbin, i get 3 options, cancel, delete or archive. I should
          get that option for the folder"). ARCHIVE takes the primary button and the focus because it
          is the recoverable one; delete sits beside it as the harsher choice, so choosing it is
          deliberate and a stray Enter cannot erase a subtree. */}
      {ask && (
        <ConfirmModal
          title={`Archive or delete "${ask.name}"?`}
          body={
            askCount === null ? (
              <p>Counting what is inside…</p>
            ) : (
              <>
                <p>
                  This deletes <b>{askCount.notes.toLocaleString()} note{askCount.notes === 1 ? "" : "s"}</b>
                  {askCount.folders > 1 && <> and <b>{askCount.folders} folders</b> (this one and everything beneath it)</>}.
                </p>
                <p>
                  <b>Archive</b> keeps every one of them — they move to the <b>Archived</b> shelf and can be
                  restored. <b>Delete for good</b> erases them. <b>That cannot be undone.</b>
                </p>
                {askCount.folders > 1 && (
                  <p className="mm-hint">
                    That includes <b>{askCount.notes - askCount.directNotes}</b> inside its subfolders. Everything
                    beneath this folder goes either way.
                  </p>
                )}
                {/* WHY THIS NUMBER CAN EXCEED THE ONE IN THE TREE. The tree count hides archived notes;
                    this one does not. Jason archived a note, deleted its folder, and watched the parent
                    drop by two for one delete (08-12-2026) — both counts were right and neither said
                    what it was counting. */}
                {askCount.archived > 0 && (
                  <p className="mm-hint">
                    <b>{askCount.archived.toLocaleString()}</b> of those {askCount.archived === 1 ? "is" : "are"} already
                    archived, so the number beside this folder in the tree reads{" "}
                    <b>{(askCount.notes - askCount.archived).toLocaleString()}</b> — the tree does not count archived
                    notes, this does.
                  </p>
                )}
                <p className="mm-hint">
                  Nothing on your disk is touched — anything imported here is a copy, and the original file is
                  exactly where it was.
                </p>
              </>
            )
          }
          confirmLabel={askCount === null ? "Counting…" : `Archive ${askCount.notes.toLocaleString()}`}
          secondary={{
            label: askCount === null ? "Counting…" : `Delete ${askCount.notes.toLocaleString()} for good`,
            danger: true,
            onPick: () => {
              if (askCount === null) return; // never destroy on a number we have not read
              void api.deleteNoteFolder(ask.id)
                .then((r) => {
                  setOutcome(`Deleted ${r.deletedNotes} note${r.deletedNotes === 1 ? "" : "s"} and ${r.deletedFolders} folder${r.deletedFolders === 1 ? "" : "s"} for good.`);
                  if (selected === ask.id) onSelect(-1);
                  load(); onChanged();
                })
                .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
            },
          }}
          onConfirm={() => {
            if (askCount === null) return;
            void api.archiveNoteFolder(ask.id)
              .then((r) => {
                setOutcome(`Archived ${r.archivedNotes} note${r.archivedNotes === 1 ? "" : "s"} and removed ${r.deletedFolders} folder${r.deletedFolders === 1 ? "" : "s"}. Nothing was erased — they are on the Archived shelf.`);
                if (selected === ask.id) onSelect(-1);
                load(); onChanged();
              })
              .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
          }}
          onClose={() => { setAsk(null); setAskCount(null); }}
        />
      )}
    </>
  );
}
