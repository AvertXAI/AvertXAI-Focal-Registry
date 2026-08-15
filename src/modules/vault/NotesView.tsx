/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Secured Notes. Three list styles — Notes · Runbooks · Ideas — over ONE stored shape, a
// collapsible list, and the Milkdown editor. The layout decisions, in the order Jason made them:
//   • EDITOR LEFT, source RIGHT (08-11-2026). It was preview-left until the placeholder renderer
//     made that pane read-only; with Milkdown the left pane IS the render and IS editable.
//   • Runbooks put RUN MODE in the right column — same space, different way of reading, because a
//     runbook is followed mid-task rather than skimmed.
//   • ARCHIVE IS A REAL SHELF (08-11-2026). Archiving with nowhere to look is deleting while
//     claiming otherwise; the list toggles between the working set and the archive.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ConfirmModal from "./ConfirmModal";
import Loading from "./Loading";
import { shortDate } from "./EntriesView";
// The READ-ONLY renderer, now on Markdoc. Milkdown is the editor; this draws the preview, Run mode
// and the repo READMEs.
import { Markdown, RunMode } from "./markdown";
import MilkdownEditor, { type MilkdownHandle } from "./MilkdownEditor";
import { vaultApi, type VaultNote, type VaultNoteMeta, type VaultSecretMeta } from "./vaultApi";

/**
 * THE LIST CACHE, and it lives OUTSIDE React on purpose (Jason 08-12-2026: "cycled through tabs or
 * features and back to notes, still shows a loading of files, and it shouldnt, as in ever! window
 * file explorer doesnt even do that").
 *
 * He is right, and the cause was structural: switching tabs UNMOUNTS NotesView, so its state died
 * and the next mount started from `rows === null`, which renders the loading panel. A module-scope
 * Map survives that — coming back paints the rows you were looking at instantly and re-reads in the
 * BACKGROUND, so the list updates without ever passing through a spinner.
 *
 * Keyed by the two things that change what the query returns. It is a render cache, never the truth:
 * every mount still asks the database, it just does not make you watch.
 */
const listCache = new Map<string, VaultNoteMeta[]>();
const cacheKey = (style: string, shelf: string, folder: number): string => `${style}:${shelf}:${folder}`;

/** Which note was open, so returning to the tab returns to where you were. */
let lastOpenUuid: string | null = null;

/** Idle autosave delay. Jason asked for 0.5–1.5 s (08-12-2026); one second is the middle of it and
    long enough that a fast typist is not writing a row between words. */
const AUTOSAVE_MS = 1000;

/**
 * WINDOWED LOADING (Jason's idea, 08-12-2026: "just load the 5-7 most active files… then everything
 * else loads on its own, but there wont be a hangup").
 *
 * FIRST_PAGE is what you can actually see — it paints immediately. BACKFILL then quietly tops the
 * list up to a full scroll buffer a moment later, and scrolling near the bottom fetches the next
 * page. That is deliberately not "load exactly what fits": at 8 rows every flick of the wheel would
 * need a round trip, and a list that stutters while you scroll is worse than one that took 1 ms
 * longer to appear.
 *
 * The measurements that set these numbers (4,089 notes, 21 KB bodies, after the deferred-id fix):
 *     8 rows ≈ 0.3 ms · 60 rows ≈ 1.5 ms · 400 rows ≈ 4.6 ms
 * So the backfill is free and the first paint is instant. Before that fix a LIMIT bought nothing —
 * the sort read every body regardless — which is why this was worth doing only once it was done.
 */
const FIRST_PAGE = 8;
const BACKFILL = 60;
const PAGE = 60;

/**
 * THE NOTE LIST IS A CONSTANT, NOT A DIVIDER (Jason 08-12-2026: "the 2nd divider, i want it locked
 * at 216px").
 *
 * It had a drag handle for exactly one build, which is how the number got found — and once a control
 * can only ever produce one value it is furniture, so the handle is gone rather than locked. The
 * setting row it used to write (`notes.list_width`) is deliberately left in VAULT_DEFAULTS: removing
 * a key that a stored database row still carries is a non-additive migration (§3.9), and an ignored
 * row costs nothing.
 *
 * 216 truncates a long filename, and that is the choice: Jason checked it on the dial and kept it —
 * "the truncation for this is actually ok, i like how it wordwraps everything as it should". The
 * editor is the pane you work in and it gets the space.
 */
export const LIST_WIDTH = 216;

/**
 * THE THIRD SHELF IS CALLED IDEAS (Jason 08-12-2026: "can we change snippets to Ideas").
 *
 * The STORED kind stays the string `snippet`, and that is deliberate, not laziness. Renaming a value
 * that 2,085 imported rows already carry is a non-additive migration, which §3.9 bans outright — and
 * it would buy nothing, because the label is the only part anyone reads. `Style` is the storage word;
 * STYLES and TITLES are the human ones, and they are the only place the rename belongs.
 */
type Style = "note" | "runbook" | "snippet";
const STYLES: [Style, string][] = [["note", "Notes"], ["runbook", "Runbooks"], ["snippet", "Ideas"]];
const TITLES: Record<Style, string> = { note: "Secured Notes", runbook: "Runbooks", snippet: "Ideas" };
const BADGE: Record<Style, [string, string]> = { note: ["N", "var(--vault-note-color)"], runbook: ["R", "var(--vault-strong-color)"], snippet: ["I", "var(--mc-accent-primary)"] };

/** The list badge for a stored kind, shared with the global search so a note cannot wear one letter
 *  in the list and a different one in the results. */
export function noteBadge(kind: string | null | undefined): string {
  return BADGE[(kind ?? "note") as Style]?.[0] ?? (kind ?? "n")[0]?.toUpperCase() ?? "N";
}

export interface NotesViewProps {
  secrets: VaultSecretMeta[];
  settings: Record<string, string>;
  onSetting: (k: string, v: string) => void;
  onHelp: () => void;
  /** One importer per tab (Jason 08-11-2026) — this is Secured Notes' own. */
  onImport: () => void;
  /** Folder filter from the sidebar tree: 0 = All notes, -1 = Unfiled, else a folder id. */
  folderId: number;
  /** Tell the sidebar the counts moved. */
  onNotesChanged: () => void;
  /**
   * THE SHARED CHANGE COUNTER, and the fix for a bug that read as "the app is not updating"
   * (Jason 08-12-2026: "the files i move dont get removed from the unfiled column in real time…
   * only when it removes it, is when i perform a control + R within the app").
   *
   * It was already being bumped and the folder TREE already listened to it — but VaultModule handed
   * it to the Sidebar only, so the note LIST never heard about a change made outside itself. Drag a
   * note into a folder and the tree's counts moved while the list still showed the note where it had
   * been. Ctrl+R "fixed" it because a reload remounts everything, which is precisely the tell.
   */
  reloadKey: number;
  /** A note the global search asked to open, or null. The module has already switched the style and
   *  the folder to match it — this is the last step, and it must win over "reopen what was open". */
  openUuid: string | null;
  onOpened: () => void;
}

export default function NotesView({ secrets, settings, onSetting, onHelp, onImport, folderId, onNotesChanged, reloadKey, openUuid, onOpened }: NotesViewProps) {
  const api = vaultApi();
  const style = (settings["notes.style"] as Style) ?? "note";
  const mode = (settings["notes.editor_mode"] as "edit" | "split" | "preview") ?? "split";
  // SEEDED FROM THE CACHE so returning to this tab paints instantly instead of showing a spinner.
  // The literal "active" is deliberate and NOT a shortcut: `shelf` is declared below, and reading it
  // here threw "Cannot access 'shelf' before initialization" — a temporal-dead-zone crash that TS
  // cannot see inside a lazy initializer, and which blanked the whole app because one component
  // throwing unmounts the entire tree. The shelf always starts "active", so this is the same value.
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [rows, setRows] = useState<VaultNoteMeta[] | null>(() => listCache.get(cacheKey(style, "active", 0)) ?? null);
  const [current, setCurrent] = useState<VaultNote | null>(null);
  const [draft, setDraft] = useState("");
  const [title, setTitle] = useState("");
  const [dirty, setDirty] = useState(false);
  // PERSISTED, not React state (Jason 08-12-2026: "make sure that sidebar remembers its location
  // when either closed or open"). A row, never localStorage — same rule as every other preference.
  const collapsed = settings["notes.list_collapsed"] === "1";
  const setCollapsed = (v: boolean): void => onSetting("notes.list_collapsed", v ? "1" : "0");
  const [error, setError] = useState<string | null>(null);
  /** What the last archive/delete/restore actually did — stated out loud. An operation whose only
      evidence is a row disappearing is one the user has to take on faith. */
  const [outcome, setOutcome] = useState<string | null>(null);
  // Tick-to-delete. The service has had archiveNote since the redesign landed and NO surface called
  // it — the list could create and edit but never remove, which Jason caught on device (08-11-2026).
  const [picked, setPicked] = useState<Set<string>>(new Set());
  /** Which shelf the list is showing — the working set, or the archive. */
  const [shelf, setShelf] = useState<"active" | "archived">("active");
  /** Whatever the confirm dialog is currently asking, or null. Replaces window.confirm(). */
  const [ask, setAsk] = useState<{
    title: string;
    body: React.ReactNode;
    label: string;
    run: () => void;
    secondary?: { label: string; onPick: () => void; danger?: boolean };
  } | null>(null);
  /** The live editor. THE toolbar seam — see the block comment on the toolbar below. */
  const editor = useRef<MilkdownHandle | null>(null);
  /** Set while a global-search open is in flight, so the list's own selection stands down. */
  const pendingOpen = useRef<string | null>(null);

  /**
   * THE DATA-LOSS FIX (Jason 08-12-2026: "sometimes when i save to db, and restart the app, the db
   * isnt saved, so i would be losing all that data").
   *
   * It was never a database problem. The TITLE input had onBlur={save}; the BODY editor had no blur
   * handler at all, so typing in the body only set `dirty` — the text reached the database only via
   * Ctrl+S, the Save now button, or blurring the title. Close the app after typing and the body had
   * never been sent anywhere. Switching notes was worse: openNote() overwrote the unsaved draft with
   * no save and no warning. The hint said "click away", and clicking away from the body did nothing.
   *
   * This ref mirrors what is on screen RIGHT NOW so flush() can write the note it belongs to, even
   * when the reason we are flushing is that we are about to load a different one.
   */
  const [justSaved, setJustSaved] = useState(0);
  const [showSaved, setShowSaved] = useState(false);
  const live = useRef<{ uuid: string; title: string; body: string; dirty: boolean } | null>(null);
  live.current = current ? { uuid: current.uuid, title, body: draft, dirty } : null;

  const loadList = useCallback(
    (s: Style, selectFirst = true, which: "active" | "archived" = shelf): void => {
      setError(null);
      // The FOLDER CUT IS NOW SQL. It used to load every note and filter in the renderer, which is
      // what made switching to this tab hang with 4,089 notes imported.
      const folderArg = folderId === 0 ? undefined : folderId === -1 ? null : folderId;
      void api.listNotes(s, which === "archived", folderArg, FIRST_PAGE, 0)
        .then((res) => {
          const r = res.rows;
          listCache.set(cacheKey(s, which, folderId), r);
          setRows(r);
          setTotal(res.total);
          setTruncated(res.truncated);
          // Reopen what was open if it is still in the list — coming back to the tab should land
          // where you left, not on row one.
          // A SEARCH OPEN OUTRANKS EVERY OTHER SELECTION. Both this and the openUuid effect run
          // async, and the module changes style and folder on the way in — so without this guard the
          // list's own "select the first row" can land after the searched note and quietly replace
          // it. The note you asked for is never the one the tool should overrule.
          const keep = lastOpenUuid && r.some((n) => n.uuid === lastOpenUuid) ? lastOpenUuid : null;
          if (pendingOpen.current) { /* leave the selection alone */ }
          else if (selectFirst && keep) openNote(keep);
          else if (selectFirst && r.length > 0) openNote(r[0].uuid);
          else if (r.length === 0) { setCurrent(null); setDraft(""); setTitle(""); }

          // BACKFILL. The screenful is already on screen; this fills the scroll buffer behind it so
          // the first wheel movement does not have to wait for anything.
          if (res.total > r.length) {
            void api.listNotes(s, which === "archived", folderArg, BACKFILL, 0)
              .then((more) => {
                listCache.set(cacheKey(s, which, folderId), more.rows);
                setRows(more.rows);
                setTruncated(more.truncated);
              })
              .catch(() => undefined); // the screenful is already usable; a failed top-up is silent
          }
        })
        .catch(() => setError("The notes could not be read."));
    },
    [api, shelf, folderId] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const openNote = useCallback(
    (uuid: string): void => {
      // FLUSH BEFORE SWITCHING. This used to drop whatever you had typed, silently.
      const l = live.current;
      const pending = l && l.dirty
        ? api.updateNote(l.uuid, { title: l.title, body: l.body }).catch(() => undefined)
        : Promise.resolve();
      void pending.then(() =>
        api.getNote(uuid).then((n) => { lastOpenUuid = n.uuid; setCurrent(n); setDraft(n.body); setTitle(n.title); setDirty(false); })
      ).catch(() => undefined);
    },
    [api]
  );

  useEffect(() => {
    // Paint what we already have for this style/shelf FIRST — the re-read then swaps it silently.
    const cached = listCache.get(cacheKey(style, shelf, folderId));
    if (cached) setRows(cached);
    loadList(style, true, shelf);
    setPicked(new Set());
  }, [style, shelf, folderId, loadList]);

  /**
   * SOMETHING CHANGED ELSEWHERE — a drop onto a folder, a folder emptied, archived or deleted, an
   * import. Re-read the list, WITHOUT re-selecting: you are still looking at the note you just moved,
   * and yanking the selection to row one would be its own bug.
   *
   * The cache is dropped for this key first. It is a render cache, and a render cache that survives a
   * write is how you paint a note into a folder it is no longer in.
   *
   * Skipped on the very first render: the effect above has already read the list, and firing both
   * would be two queries for one mount.
   */
  const seenKey = useRef(reloadKey);
  useEffect(() => {
    if (reloadKey === seenKey.current) return;
    seenKey.current = reloadKey;
    listCache.delete(cacheKey(style, shelf, folderId));
    loadList(style, false, shelf);
  }, [reloadKey, style, shelf, folderId, loadList]);

  /**
   * A NOTE PICKED OUT OF THE GLOBAL SEARCH. Opened by uuid rather than by finding it in the list,
   * because it may legitimately not be in the list yet — the style and folder the module just set
   * take a render to land, and the note may sit past the first page of a windowed list anyway.
   *
   * It also sets `lastOpenUuid`, so the effect above and the next mount reopen THIS note rather than
   * snapping back to whichever one was open before the search.
   *
   * The shelf is switched here rather than by the module: `shelf` is local state, and an archived
   * note opened while the list shows Active would sit in the editor above a list that excludes it.
   */
  useEffect(() => {
    if (!openUuid) return;
    // Claimed SYNCHRONOUSLY, before the fetch — the guard has to be up before any competing
    // loadList can resolve, and awaiting first would leave the window open.
    pendingOpen.current = openUuid;
    lastOpenUuid = openUuid;
    void api.getNote(openUuid)
      .then((n) => {
        lastOpenUuid = n.uuid;
        setShelf(n.archived_at ? "archived" : "active");
        setCurrent(n);
        setDraft(n.body);
        setTitle(n.title);
        setDirty(false);
      })
      .catch(() => setError("That note could not be opened."))
      // Cleared either way — a failed open must not leave the guard up, or the list would never
      // select anything again.
      .finally(() => { pendingOpen.current = null; onOpened(); });
  }, [openUuid, api, onOpened]);

  /**
   * TAKE THE TITLE THE VAULT ACTUALLY STORED (Jason 08-12-2026: "this md file auto saved, but the
   * file to the left, still says untitled").
   *
   * updateNote names an untouched "Untitled" note after its own leading heading — the same rule
   * import has always used. All three save paths threw the returned note away, so the write was
   * correct and every surface still said Untitled until something forced a re-read.
   *
   * It fires ONLY when the title we sent was the untouched placeholder and the vault came back with
   * something else. Any other case and this must not run: overwriting the title box while a user is
   * typing in it is a far worse bug than the one being fixed.
   */
  const adopted = useCallback((sent: string, got: { uuid: string; title: string }): boolean => {
    if (sent !== "Untitled" || got.title === sent) return false;
    if (live.current?.uuid !== got.uuid) return false; // they moved on; leave the new note alone
    setTitle(got.title);
    setCurrent((c) => (c && c.uuid === got.uuid ? { ...c, title: got.title } : c));
    return true;
  }, []);

  const save = useCallback((): void => {
    if (!current || !dirty) return;
    void api.updateNote(current.uuid, { title, body: draft })
      .then((n) => { adopted(title, n); setDirty(false); loadList(style, false); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [api, current, dirty, title, draft, style, loadList, adopted]);

  /**
   * Write whatever is on screen, for the note it belongs to. Reads the ref rather than the closure
   * so it is correct when called from a timer, an unmount, or just before a note switch.
   */
  const flush = useCallback((announce = false): Promise<void> => {
    const l = live.current;
    if (!l || !l.dirty) return Promise.resolve();
    return api.updateNote(l.uuid, { title: l.title, body: l.body })
      .then((n) => {
        // The list row is only re-read when the name actually changed — an autosave every few
        // seconds must not drag the whole list across the bridge with it.
        if (adopted(l.title, n)) loadList(style, false);
        if (live.current?.uuid !== l.uuid) return; // the user moved on; do not touch their new note
        setDirty(false);
        if (announce) setJustSaved((n2) => n2 + 1);
      })
      .catch((e: unknown) => { setError(e instanceof Error ? e.message : String(e)); });
  }, [api, adopted, loadList, style]);

  /** The flash. Keyed by a counter so a second save re-triggers the animation rather than being
      swallowed because the flag was already true. */
  useEffect(() => {
    if (justSaved === 0) return;
    const t = setTimeout(() => setShowSaved(false), 1900);
    setShowSaved(true);
    return () => clearTimeout(t);
  }, [justSaved]);

  /**
   * AUTOSAVE, debounced. Still not a write per keystroke — that would be noise in the shared write
   * path — but 1.2 seconds after you stop typing the text is in the database. Everything below is a
   * belt on top of it, because the one thing this must never do is lose what you typed.
   */
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => {
      // `true` = this is the IDLE save, and only the idle save flashes "Saved" (Jason 08-12-2026).
      // Ctrl+S, switching notes and closing the window all flush too, but those are moments where a
      // badge appearing is noise — you already know you saved, or you are already gone.
      void flush(true);
    }, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [draft, title, dirty, flush]);

  // Ctrl+S still saves immediately, and the window closing or the tab unmounting flushes first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); void flush().then(() => loadList(style, false)); }
    };
    // beforeunload cannot await, but the IPC call is already dispatched by the time it returns —
    // which is the difference between "usually saved" and "never sent".
    const onBye = (): void => { void flush(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onBye);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onBye);
      void flush(); // leaving the Notes tab entirely
    };
  }, [flush, loadList, style]);

  /** THE FOLDER CUT. 0 = everything, -1 = only notes with no folder, otherwise that folder exactly.
      Descendants are NOT rolled up here on purpose: clicking "AvertXAI" and getting 1,204 notes from
      forty subfolders is a search result, not a folder. The count in the tree is inclusive; the list
      is exact — and the breadcrumb says which folder you are actually in. */
  // The folder cut happens in SQL now (see loadList) — the renderer no longer filters 4,089 rows.
  const shown = rows ?? [];

  const noun = (n: number): string => {
    const one = TITLES[style].toLowerCase().replace(/^secured /, "").replace(/s$/, "");
    return `${n} ${n === 1 ? one : `${one}s`}`;
  };

  /**
   * SAY WHAT HAPPENED (Jason 08-12-2026: "if i delete a file, there isnt a notification saying i
   * deleted that 1 file, as the folder deletion").
   *
   * Deleting a folder announced its outcome; deleting a note announced nothing — the row simply
   * vanished, which is indistinguishable from a list that re-sorted. Same treatment as the tree, in
   * the same words, so a delete reads the same wherever it is done from.
   */
  const afterBulk = (say: string): void => {
    if (current && picked.has(current.uuid)) { setCurrent(null); setDraft(""); setTitle(""); }
    setPicked(new Set());
    setOutcome(say);
    loadList(style, false);
    onNotesChanged();
  };

  /** BOTH WAYS OUT, on one prompt (Jason 08-11-2026: "give me the option to delete or archive").
      Archive is the recommendation and keeps the text; delete is offered beside it so the harsher
      choice does not cost a cancel, a shelf switch, and a second tick. The prompt says plainly which
      is which, and the safe one is the focused button. */
  const askArchive = (): void => {
    if (picked.size === 0) return;
    const n = picked.size;
    setAsk({
      title: `Archive or delete ${noun(n)}?`,
      body: (
        <>
          <p><b>Archive</b> moves them to the <b>Archived</b> shelf — the text is kept in full and they can be restored.</p>
          <p><b>Delete for good</b> erases them from the vault. <b>That cannot be undone.</b></p>
        </>
      ),
      label: `Archive ${n}`,
      run: () => void Promise.all([...picked].map((u) => api.archiveNote(u).catch(() => undefined)))
        .then(() => afterBulk(`Archived ${noun(n)}. They are on the Archived shelf and can be restored.`)),
      secondary: {
        label: `Delete ${n} for good`,
        danger: true,
        // Archive THEN destroy. The service refuses a hard delete on a note that was never archived
        // — a deliberate two-step so nothing is erased by one slip — and that guard stays exactly as
        // it is. This walks the note through it rather than weakening it.
        onPick: () =>
          void Promise.all(
            [...picked].map((u) => api.archiveNote(u).then(() => api.destroyNote(u)).catch(() => undefined))
          ).then(() => afterBulk(`Deleted ${noun(n)} for good. Nothing on your disk was touched.`)),
      },
    });
  };

  const askRestore = (): void => {
    if (picked.size === 0) return;
    setAsk({
      title: `Restore ${noun(picked.size)}?`,
      body: <p>They go back to the working list exactly as they were.</p>,
      label: `Restore ${picked.size}`,
      run: () => void Promise.all([...picked].map((u) => api.restoreNote(u).catch(() => undefined)))
        .then(() => afterBulk(`Restored ${noun(picked.size)} to the working list.`)),
    });
  };

  /** The only hard delete, and it lives in the archive alone — you must archive before you can
      erase. Two deliberate steps, because this one really is gone. */
  const askDestroy = (): void => {
    if (picked.size === 0) return;
    setAsk({
      title: `Permanently delete ${noun(picked.size)}?`,
      body: (
        <>
          <p><b>This cannot be undone.</b> The text is erased from the vault for good.</p>
          <p className="vault-hint">If you only want it out of the way, restore it and archive it instead.</p>
        </>
      ),
      label: `Delete ${picked.size} for good`,
      run: () => void Promise.all([...picked].map((u) => api.destroyNote(u).catch(() => undefined)))
        .then(() => afterBulk(`Deleted ${noun(picked.size)} for good. Nothing on your disk was touched.`)),
    });
  };

  const togglePick = (uuid: string): void =>
    setPicked((p) => { const n = new Set(p); if (n.has(uuid)) n.delete(uuid); else n.add(uuid); return n; });

  const newNote = useCallback((): void => {
    // FLUSH BEFORE CREATING (Tier-1 fix 5). + New changes the current record exactly the way
    // clicking another row does, and it was the ONE such path that still skipped the flush — type,
    // hit + New, and the draft silently died. Same shape as openNote, for the same reason.
    const l = live.current;
    const pending = l && l.dirty
      ? api.updateNote(l.uuid, { title: l.title, body: l.body }).catch(() => undefined)
      : Promise.resolve();
    void pending
      .then(() => api.createNote({ kind: style, title: "Untitled", body: "" }))
      .then((n) => {
        // A new note is filed where you are standing — making one inside a folder and finding it in
        // Unfiled is the kind of small wrongness that stops people using folders at all.
        if (folderId > 0) return api.setNoteFolder(n.uuid, folderId).then(() => n).catch(() => n);
        return n;
      })
      .then((n) => { loadList(style, false); onNotesChanged(); setCurrent(n); setDraft(""); setTitle(n.title); setDirty(false); }).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [api, style, loadList, folderId, onNotesChanged]);

  const setStyle = (s: Style): void => onSetting("notes.style", s);
  const setMode = (m: "edit" | "split" | "preview"): void => onSetting("notes.editor_mode", m);

  const previewIsRun = style === "runbook";
  const [b, badgeColor] = BADGE[style];

  /** What an export would write: the title as an H1, then the body — unless the body already opens
      with one, in which case adding a second would be wrong. */
  const sourceText = useMemo(() => {
    const body = draft.trim();
    if (!title.trim()) return body;
    if (/^#\s/.test(body)) return body;
    return `# ${title.trim()}\n\n${body}`;
  }, [title, draft]);

  return (
    <div className="vault-notewrap">
      <div
        className={`vault-notelist${collapsed ? " collapsed" : ""}`}
        style={collapsed ? undefined : { width: LIST_WIDTH }}
      >
        {/* Import sits in the HEADER, immediately left of the collapse chevron (Jason 08-11-2026).
            Icon plus the single word — the accepted extensions are the file dialog's job to enforce
            and its filter already says so, which makes a ".md · .txt · .pdf" line beside the button
            a second statement of something nobody reads twice. */}
        <div className="vault-nltop">
          <b className="vault-nltitle">{TITLES[style]}</b>
          {shelf === "active" && (
            <button className="vault-collapse import" title={`Import ${TITLES[style].toLowerCase()}`} onClick={onImport}>
              <span aria-hidden="true">⭳</span> Import
            </button>
          )}
          <button className="vault-collapse" title="Collapse the list" onClick={() => setCollapsed(!collapsed)}>{collapsed ? "»" : "«"}</button>
        </div>
        <div className="vault-nlstyles">
          {STYLES.map(([s, label]) => (
            <button key={s} className={style === s ? "on" : ""} onClick={() => setStyle(s)}>{label}</button>
          ))}
        </div>
        {/* Search · import · delete — one row (Jason 08-11-2026). One importer per tab, and the bin
            beside it because deleting is a list job, not a per-row one. */}
        {/* Working set ⇄ archive. The archive is a place you can actually go, so "archived" stops
            being a euphemism for gone. */}
        <div className="vault-nlshelf">
          <button className={shelf === "active" ? "on" : ""} onClick={() => setShelf("active")}>Active</button>
          <button className={shelf === "archived" ? "on" : ""} onClick={() => setShelf("archived")}>Archived</button>
        </div>
        {/* IMPORT IS A LABELLED BUTTON, ON ITS OWN ROW (Jason 08-11-2026: "secured notes has NO
            import feature"). It DID have one — a bare ⭳ glyph wedged beside the search box. A
            control nobody can find is a control that does not exist, so it now reads the same as
            Infrastructure's and Repos': the word "Import", above the list, where you look for it. */}
        {/* Bin and + New sit RIGHT, on one row (Jason 08-12-2026) — they are both list actions and
            they were drifting left against an empty search slot that no longer exists. */}
        <div className="vault-nlsearch" style={{ justifyContent: "flex-end" }}>
          {/* Search moved to the ONE global bar at the top of the module (Jason 08-11-2026). */}
          {shelf === "active" ? (
            <>
              <button
                className={`vault-iconbtn trash${picked.size > 0 ? " armed" : ""}`}
                title={picked.size === 0 ? "Tick one or more first" : `Archive ${picked.size} selected`}
                disabled={picked.size === 0}
                onClick={askArchive}
              >
                🗑{picked.size > 0 ? ` ${picked.size}` : ""}
              </button>
              <button className="vault-btn primary sm" onClick={newNote}>+ New</button>
            </>
          ) : (
            <>
              <button className="vault-iconbtn" title={picked.size === 0 ? "Tick one or more first" : `Restore ${picked.size}`}
                disabled={picked.size === 0} onClick={askRestore}>↺</button>
              <button className={`vault-iconbtn trash${picked.size > 0 ? " armed" : ""}`}
                title={picked.size === 0 ? "Tick one or more first" : `Delete ${picked.size} for good`}
                disabled={picked.size === 0} onClick={askDestroy}>✕{picked.size > 0 ? ` ${picked.size}` : ""}</button>
            </>
          )}
        </div>
        {/* THE OUTCOME LINE, above the list where the rows just changed. Sticky-free and dismissible:
            it is a receipt, not an alert, so it waits rather than interrupting. */}
        {outcome && (
          <div className="vault-hint" style={{ padding: "4px 10px 8px", color: "var(--vault-strong-color)" }}>
            {outcome}{" "}
            <button className="vault-addsc" style={{ padding: 0 }} onClick={() => setOutcome(null)}>dismiss</button>
          </div>
        )}
        {/* NEXT PAGE ON SCROLL. Fires ~200px from the bottom so the rows are already there by the
            time you reach them — an "end of list" that pauses is the thing windowing is meant to
            avoid, not introduce. */}
        <div
          className="vault-nlbody"
          onScroll={(e) => {
            const el = e.currentTarget;
            if (loadingMore || !truncated) return;
            if (el.scrollHeight - el.scrollTop - el.clientHeight > 200) return;
            setLoadingMore(true);
            const folderArg = folderId === 0 ? undefined : folderId === -1 ? null : folderId;
            void api.listNotes(style, shelf === "archived", folderArg, PAGE, (rows ?? []).length)
              .then((res) => {
                setRows((prev) => {
                  const merged = [...(prev ?? []), ...res.rows];
                  listCache.set(cacheKey(style, shelf, folderId), merged);
                  setTruncated(res.total > merged.length);
                  return merged;
                });
              })
              .catch(() => undefined)
              .finally(() => setLoadingMore(false));
          }}
        >
          {rows === null ? (
            // No counter: this is one SQLite query, not a folder walk. See Loading.tsx.
            <Loading message="Loading your notes…" compact />
          ) : shown.length === 0 ? (
            folderId === -1 ? (
              // Unfiled is the default landing AND the 08-12 rule hides its rail row when empty —
              // so a fully-filed corpus (2,096 imported notes, 142 folders) greeted every fresh
              // mount with "Nothing here yet", which read as the vault losing the notes (Jason,
              // 08-14: "all my notes went missing"). Say where they actually are.
              <div className="vault-state">Unfiled is empty — your filed notes are in the folders on the left.<div><button className="vault-btn" onClick={newNote}>Write a new one</button></div></div>
            ) : (
              <div className="vault-state">Nothing here yet.<div><button className="vault-btn" onClick={newNote}>Write the first one</button></div></div>
            )
          ) : (
            shown.map((n) => (
              <div
                key={n.uuid}
                className={`vault-nrow${current?.uuid === n.uuid ? " on" : ""}${picked.has(n.uuid) ? " picked" : ""}`}
                onClick={() => openNote(n.uuid)}
                // Drag onto a folder in the sidebar tree to file it. One folder per note, so this
                // MOVES rather than copies — see NoteFolderRail.dropNote. effectAllowed is not
                // decoration: without it the drop target cannot answer "move", so Windows draws the
                // no-entry cursor over every folder and the gesture looks unsupported.
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/vault-note", n.uuid);
                  e.dataTransfer.effectAllowed = "move";
                }}
              >
                {/* The tick is a real control, so the click must not also open the note. */}
                <input
                  type="checkbox"
                  className="vault-nsel"
                  checked={picked.has(n.uuid)}
                  title="Select for delete"
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => togglePick(n.uuid)}
                />
                <span className="t"><span className="vault-ticon" style={{ background: badgeColor }}>{b}</span> {n.title}</span>
                <span className="s">{n.excerpt || "—"}</span>
                {/* BOTH DATES, SPELLED OUT (Jason 08-11-2026: "i want a created on: month/day/year
                    - edited on: month/day/year"). They come off the FILE, not the import run —
                    fs.stat's birthtime and mtime, with frontmatter created:/updated: winning when a
                    file carries them — so a 2023 runbook reads as 2023. A single ambiguous date was
                    the thing that made the list useless for finding the old half-remembered note. */}
                <span className="m">
                  <span className="d">Created {shortDate(n.created_at)}</span>
                  {n.updated_at && <span className="d">Edited {shortDate(n.updated_at)}</span>}
                  {n.folder ? <span className="d">{n.folder}</span> : null}
                  {n.pinned ? <span className="d">pinned</span> : null}
                </span>
              </div>
            ))
          )}
          {loadingMore && <div className="vault-hint" style={{ padding: "8px 12px" }}>Loading more…</div>}
          {!loadingMore && truncated && (
            <div className="vault-hint" style={{ padding: "8px 12px" }}>
              {shown.length.toLocaleString()} of {total.toLocaleString()} — scroll for more.
            </div>
          )}
        </div>
      </div>

      <div className="vault-noteedit">
        {/* THE TOOLBAR DRIVES THE DOCUMENT, NOT A SHADOW STRING (Jason 08-11-2026).
            Every button used to call setDraft(), which mutated the markdown string the RIGHT pane
            renders while the editor's real document sat untouched — so a click showed up in the
            preview, never in the editor, and could not be taken back. They now go through the
            editor's own commands: the change lands at the cursor, in the one document, and Ctrl+Z
            undoes it. Disabled with no note open, because there is nothing to act on. */}
        <div className="vault-edbar">
          <button className="vault-tbtn" title="Bold" disabled={!current} onClick={() => editor.current?.run("bold")}><b>B</b></button>
          <button className="vault-tbtn" title="Italic" disabled={!current} onClick={() => editor.current?.run("italic")}><i>I</i></button>
          <button className="vault-tbtn" title="Heading" disabled={!current} onClick={() => editor.current?.run("heading")}>H</button>
          <button className="vault-tbtn" title="Code" disabled={!current} onClick={() => editor.current?.run("code")}>{"</>"}</button>
          <button className="vault-tbtn hot" title="Code block" disabled={!current} onClick={() => editor.current?.run("codeblock")}>{"{;}"}</button>
          <button className="vault-tbtn" title="Checklist" disabled={!current} onClick={() => editor.current?.run("task")}>☑</button>
          <button className="vault-tbtn hot" title="Reference a vault entry" disabled={!current} onClick={() => editor.current?.run({ insert: "@[[vault:Label]]" })}>@ entry</button>
          <button className="vault-help" title="How do I use this editor?" onClick={onHelp}>?</button>
          <div className="vault-seg vault-modeseg">
            {(["edit", "split", "preview"] as const).map((m) => (
              <button key={m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>{m[0].toUpperCase() + m.slice(1)}</button>
            ))}
          </div>
        </div>

        {error && <div className="vault-state error">{error}</div>}

        {current === null ? (
          <div className="vault-state">Pick a {style} to open it, or start a new one.</div>
        ) : (
          <div className="vault-notesplit">
            {/* THE THREE MODES MEAN WHAT THEY SAY (Jason 08-11-2026):
                  Edit    → the editor, full width.
                  Split   → editor LEFT, the rendered document RIGHT.
                  Preview → the rendered document, full width.
                The right pane used to be a <pre> of the raw markdown, which is not a preview — it
                was the source with a preview's name on it. It is now the Markdoc render. */}
            {mode !== "preview" && (
              <div className="vault-pane left">
                <div className="vault-panehdr"><span className="vault-editdot" /> Editor — type here</div>
                <input className="vault-notetitle" value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} onBlur={save} placeholder="Title" />
                <MilkdownEditor
                  ref={editor}
                  docId={current.uuid}
                  initial={current.body}
                  onChange={(md) => { setDraft(md); setDirty(true); }}
                />
                <div className="vault-savebar">
                  <span className="vault-hint">{dirty ? "Editing…" : "Saved."}</span>
                  {/* Brief, and only after the idle save — a permanent "Saved" is wallpaper. */}
                  <span key={justSaved} className={`vault-savedflash${showSaved ? " on" : ""}`}>✓ Saved</span>
                </div>
                <div className="vault-btnrow" style={{ marginTop: 8 }}>
                  <button className="vault-btn" disabled={!dirty} onClick={save}>Save now</button>
                </div>
              </div>
            )}
            {/* RIGHT — a runbook shows Run mode (steps, copy buttons, ticks) because a runbook is
                FOLLOWED rather than read; anything else shows the document as it will look. */}
            {mode !== "edit" && (
              <div className="vault-pane prev">
                <div className="vault-panehdr">{previewIsRun ? "Run mode — tick as you go" : "Preview"}</div>
                {previewIsRun ? (
                  <RunMode body={draft} secrets={secrets} title={title} />
                ) : (
                  <div className="vault-preview">
                    {sourceText.trim() ? (
                      // sourceText, not draft: the title leads as "# Title" exactly as an export
                      // writes it, so the preview is what you would get, not an approximation.
                      <Markdown body={sourceText} secrets={secrets} />
                    ) : (
                      <div className="vault-state">Nothing written yet.</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {ask && (
        <ConfirmModal
          title={ask.title}
          body={ask.body}
          confirmLabel={ask.label}
          danger
          secondary={ask.secondary}
          onConfirm={ask.run}
          onClose={() => setAsk(null)}
        />
      )}
    </div>
  );
}

/** The Milkdown help modal (MOCKUP-vault-full-v2). Content is the cheat-sheet; it opens from the ?
    in the toolbar and closes on backdrop or Escape. */
export function NotesHelpModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const rows1: [string, string][] = [
    ["## Title", "a heading"],
    ["**bold**", "bold — or Ctrl+B on a selection"],
    ["*italic*", "italic — or Ctrl+I"],
    ["- item", "a bullet list"],
    ["- [ ] todo", "a checkbox"],
    ["> quote", "a block quote"],
    ["`code`", "inline code"],
    ["```", "a fenced code block"],
  ];
  const rows2: [string, string][] = [
    ["@[[vault:…]]", "reference a vault entry — it becomes a Reveal/Copy chip; the password never enters the note"],
    ["1. step", "number a line to make a runbook step; Run mode gives it a copy button and a tick"],
    ["Ctrl+S", "save (also saves when the box loses focus)"],
  ];
  return (
    <div className="vault-modalback" onClick={onClose}>
      <div className="vault-modal" style={{ maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
        <h3>Editing help</h3>
        <div className="vault-modalsub">Type markdown and it renders live. The menus are only how you type it — clean markdown is what gets stored.</div>
        <div className="vault-two">
          <div>
            <div className="vault-cardtitle" style={{ marginBottom: 9 }}>Formatting</div>
            {rows1.map(([k, d]) => (<div key={k} className="vault-helprow"><span className="vault-kbd">{k}</span><span>{d}</span></div>))}
          </div>
          <div>
            <div className="vault-cardtitle" style={{ marginBottom: 9 }}>Vault &amp; runbooks</div>
            {rows2.map(([k, d]) => (<div key={k} className="vault-helprow"><span className="vault-kbd">{k}</span><span>{d}</span></div>))}
          </div>
        </div>
        <div className="vault-modalacts"><button className="vault-btn primary" onClick={onClose}>Got it</button></div>
      </div>
    </div>
  );
}
