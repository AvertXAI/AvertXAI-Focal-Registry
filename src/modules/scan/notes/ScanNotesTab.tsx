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
  ScanHistoryRow,
  ScanNote,
  ScanNoteMeta,
  ScanNotesDriveNode,
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
}

export default function ScanNotesTab({ refreshKey, mediaMode, onFolderChange, mediaPane }: ScanNotesTabProps) {
  const [tree, setTree] = useState<ScanNotesDriveNode[]>([]);
  const [closed, setClosed] = useState<Set<number>>(new Set());
  const [folder, setFolder] = useState<string | null>(null);
  const [driveId, setDriveId] = useState<number | null>(null);
  const [card, setCard] = useState<ScanFolderCard | null>(null);
  const [history, setHistory] = useState<ScanHistoryRow[]>([]);
  const [notes, setNotes] = useState<ScanNoteMeta[]>([]);
  const [openUuid, setOpenUuid] = useState<string | null>(null); // null = the report card is showing
  const [note, setNote] = useState<ScanNote | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [renaming, setRenaming] = useState<{ path: string; name: string } | null>(null);
  const [renameErr, setRenameErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ed = useRef<MilkdownHandle>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draft = useRef<{ title: string; body: string } | null>(null);

  // ---- the tree ----
  useEffect(() => {
    void window.api.scan.notes
      .tree()
      .then(setTree)
      .catch((e: unknown) => signalAppToast(e instanceof Error ? e.message : String(e), "err"));
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
      .catch((e: unknown) => signalAppToast(e instanceof Error ? e.message : String(e), "err"));
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

  const selectedDrive = useMemo(() => tree.find((d) => d.drive_id === driveId) ?? null, [tree, driveId]);
  const latestApplied = history.find((h) => h.status === "applied") ?? null;

  return (
    <div className={`scannotes-grid${mediaMode ? " media" : ""}`}>
      {/* ---- pane 1: the drive / folder tree ---- */}
      <div className="scannotes-pane">
        <h3>Drives</h3>
        {tree.length === 0 && <div className="scannotes-empty">No scanned drives yet. Run a scan and the folders appear here.</div>}
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
                {d.folders.map((f) => (
                  <button
                    key={f.path}
                    type="button"
                    className={`scannotes-folder${folder === f.path ? " sel" : ""}`}
                    onClick={() => { setFolder(f.path); setDriveId(d.drive_id); }}
                    title={f.path}
                  >
                    <span aria-hidden="true">📁</span>
                    <span className="nm">
                      {f.name}
                      {f.renamedFrom && <span className="old">{f.renamedFrom}</span>}
                    </span>
                    <span
                      className="scannotes-pencil"
                      role="button"
                      tabIndex={0}
                      aria-label={`Rename ${f.name}`}
                      title="Rename this folder"
                      onClick={(e) => { e.stopPropagation(); setRenameErr(null); setRenaming({ path: f.path, name: f.name }); }}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setRenameErr(null); setRenaming({ path: f.path, name: f.name }); } }}
                    >
                      ✏️
                    </span>
                  </button>
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
          {folder === null && <div className="scannotes-empty">Pick a folder on the left.</div>}
          {folder !== null && (
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
          {folder === null ? (
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
      {renaming && (
        <div className="scannotes-overlay" role="dialog" aria-modal="true" aria-label="Rename folder">
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
