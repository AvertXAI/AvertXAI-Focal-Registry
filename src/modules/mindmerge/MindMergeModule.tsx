// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: MindMerge renderer UI. TWO VIEW TABS (Jason 08-21-2026 — the authored-document shape
//              and the ingest shape are two different things and both must stand): "Documents"
//              mounts NotesView (what am I writing), "Brain" is the original ingest surface —
//              status strip + filter chips + list/detail split pane, layout per
//              docs/MindMerge/mindmerge-mockup.html — unchanged (what did I find). Reads
//              EXCLUSIVELY via api.mindmerge.* (never services/ nor the native driver —
//              main-process only). Types come from src/shared/types.ts; styling uses shell
//              tokens only (zero hex).
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: src/modules/mindmerge/MindMergeModule.tsx
//------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NoteRow, MindMergeProgress } from "../../shared/types";
import { defaultSettings, type MindMergeSettings } from "./config.manifest";
import { highlightText } from "./markdown";
import ImportDocsModal, { type ImportTarget } from "./ImportDocsModal";
import { mindmergeApi, type MindMergeDocMeta } from "./mindmergeApi";
import NoteFolderRail from "./NoteFolderRail";
import { NotesHelpModal } from "./NotesHelp";
import NotesView from "./NotesView";
import DocsSurface from "./DocsSurface";
import "./mindmerge.css";
import { bumpRender } from "../../diag";

// Injected by root ("Expose, Don't Connect", DECISIONS-37): the module renders its own controls but
// never owns persistence — settings arrive as props, writes go back through onChange. BOTH props are
// optional so a standalone-dev mount works: settings falls back to the defaultSettings() mock, and
// the HONESTY GATE keeps write controls .nb (orange, inert) unless a real onChange is present —
// a control is live iff its action can be made real. Never localStorage, never app_settings direct.
interface Props {
  settings?: MindMergeSettings;
  onChange?: (patch: Partial<MindMergeSettings>) => void;
}

// window.api is bridged by the root preload; src/global.d.ts types it globally.
// this module's own tsconfig — which doesn't include src ambient decls — checks clean standalone.
const api = window.api;

// THE TWO VIEW TABS, and this array is the ONE place their labels live — renaming a tab is editing
// one string here and nothing else. The stored ids are kept separate from the labels so a future
// rename never has to touch an app_settings row.
//
// NAMED BY JASON, 08-21-2026: "for now, just name the first one Documents and the other Brain - as
// in Jarvis's brain". BRAIN, not "Discovered" and not "Ingest": this shelf is the corpus the agent
// READS FROM — the markdown it has indexed off disk — so it is named for what it is to Jarvis, not
// for the mechanism that filled it. Documents is the other half: what you are writing.
// ORDER SWAPPED per BL-58 v3 (mockup approved 08-23-2026): Brain first, Documents second. The
// entitlement-correction effects below already re-route a tab the install cannot have, so the only
// cost of Brain-first is a brief blank frame on a Free install before that correction lands.
const VIEW_TABS = [
  { id: "brain", label: "Brain" },
  { id: "documents", label: "Documents" },
] as const;
type ViewTab = (typeof VIEW_TABS)[number]["id"];
const isViewTab = (v: unknown): v is ViewTab => VIEW_TABS.some((t) => t.id === v);

// SOP §5 — THE KEY RENAME HAPPENS HERE, AT THE SEAM.
// The ported NotesView hardcodes the vault-era key strings (`notes.style` NotesView.tsx:143,
// `notes.editor_mode` :150 / :535, `notes.list_collapsed` :167 / :168, `notes.style` writer :534).
// NotesView.tsx belongs to another lane and is not edited here, so the view keeps SAYING `notes.*`
// and this map translates every read and every write into the module namespace before it reaches
// app_settings. Nothing outside this map can reach the settings channel. localStorage is BANNED —
// these are app_settings rows through the sanctioned settings.get/set channel, and each renamed key
// is whitelisted in RENDERER_KEYS (electron/core/services/settings/index.ts) or the shell drops to
// Safe Mode.
const DOC_KEYS: Record<string, string> = {
  "notes.style": "mindmerge.docs_style",
  "notes.list_collapsed": "mindmerge.docs_list_collapsed",
  "notes.editor_mode": "mindmerge.docs_editor_mode",
  // Phase 4 (addendum 08-22-2026) — the Documents folder rail's two view-state rows. Unlike the
  // three above, NotesView never says these names: the MODULE reads and writes them itself (the
  // vault stores the same pair as notes.folder_selected / notes.folders_open, VaultModule.tsx:281
  // / :531). They ride the same seam so ONLY renamed, whitelisted keys ever reach app_settings.
  "notes.folder_selected": "mindmerge.docs_folder_selected",
  "notes.folders_open": "mindmerge.docs_folders_open",
};
// Which tab is open. Ours, not the view's, so it is not in DOC_KEYS.
const TAB_KEY = "mindmerge.docs_tab";


const fileName = (p: string): string => p.split(/[\\/]/).pop() ?? p;

// Modal result snippet: locate the typed term in the body (fallback: title / body head) and cut a
// tight window around it; highlightText() then marks it with the SAME highlighter styling.
function matchSnippet(r: NoteRow, term: string): string {
  const body = (r.body_md ?? "").replace(/\s+/g, " ");
  const i = term ? body.toLowerCase().indexOf(term.toLowerCase()) : -1;
  if (i < 0) return r.title ?? body.slice(0, 90);
  const start = Math.max(0, i - 34);
  return (start > 0 ? "…" : "") + body.slice(start, i + term.length + 56) + "…";
}



// "2m" / "3h" / "Fri" / a date - the recency stamps the v7 mockup shows beside Recently edited.
function fmtAgo(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return new Date(t).toLocaleDateString(undefined, { weekday: "short" });
  return new Date(t).toLocaleDateString();
}

/**
 * RECENTLY EDITED (BL-58 v5: "a place where i edit files... a list what files I edited, something
 * that stays for quick selection"). Five most recently touched documents, derived from rows the
 * list API already serves - no new channel, no new query shape. listNotes orders pinned-first, so
 * the sort is redone here by updated_at: a pin is not an edit.
 */
function RecentlyEdited({ reloadKey, onOpen }: { reloadKey: number; onOpen: (uuid: string) => void }) {
  const [rows, setRows] = useState<MindMergeDocMeta[]>([]);
  useEffect(() => {
    void mindmergeApi()
      .listNotes(undefined, false, undefined, 30)
      .then((r) =>
        setRows(
          r.rows
            .slice()
            .sort((a, b) => (b.updated_at ?? b.created_at).localeCompare(a.updated_at ?? a.created_at))
            .slice(0, 5)
        )
      )
      .catch(() => setRows([]));
  }, [reloadKey]);
  if (rows.length === 0) return null;
  return (
    <div className="mm-recent">
      <div className="mm-recent-h">Recently edited</div>
      {rows.map((r) => (
        <button key={r.uuid} className="mm-recent-row" onClick={() => onOpen(r.uuid)} title={r.title}>
          <span className="mm-recent-name">{r.title}</span>
          <span className="mm-recent-ago">{fmtAgo(r.updated_at ?? r.created_at)}</span>
        </button>
      ))}
    </div>
  );
}



// Persist the last DEFAULT-view list across MindMerge unmount/remount so re-entering the module shows
// the directory INSTANTLY (stale-while-revalidate) — no null→skeleton→list reload flash on every switch.
// NO QUARANTINE SHELF (Jason 08-22-2026: "remove [the 0 quarantined chip] — and its function in what
// it does. ive never used it"). The chip, the view it toggled, its counter and its list read are all
// gone from this module. The INGEST side is untouched on purpose: the engine still stamps
// parse_status, and mindmerge:listQuarantined still exists on the main process — a file that will not
// parse simply no longer has a shelf to sit on, and the list keeps filtering to parse_status='ok'
// exactly as it always did. Nothing was deleted from disk or from the database by this removal.
let listCache: { rows: NoteRow[]; ok: number } | null = null;

// Same stale-while-revalidate trick for the tab strip and the Documents view-state: a remount paints
// the tab you were on instead of flashing tab 1 while the settings round-trip lands.
let tabCache: ViewTab | null = null;

/**
 * DEEP-LINK MAILBOX — the shell's global search opens a result here. A module-level pending slot
 * (the same pattern as the caches above) because the shell may navigate to MindMerge and request an
 * open BEFORE this component exists; the mount consumes whatever is waiting, and the event covers
 * the already-mounted case. file → Documents tab, on-disk editor; doc → Brain tab, authored store.
 */
let pendingOpen: { file?: string; doc?: string } | null = null;
export function requestMindMergeOpen(req: { file?: string; doc?: string }): void {
  pendingOpen = req;
  window.dispatchEvent(new Event("mindmerge:open-request"));
}
// Entitlements, remembered for the session so re-entering the module does not re-ask and re-flicker.
// BOTH come from the SAME licensing.features() round-trip (it returns the whole feature map), so
// there is exactly one ask per session, never one per feature.
let entitledCache: boolean | null = null; // mindmergeDocs — the Documents tab
let brainEntitledCache: boolean | null = null; // mindmergeBrain — the Brain tab (Business/Root only)
let docCache: Record<string, string> | null = null;

export default function MindMergeModule({ settings, onChange }: Props) {
  bumpRender("mindmerge"); // DIAG-2
  const [rows, setRows] = useState<NoteRow[] | null>(() => listCache?.rows ?? null); // null = loading
  const [okCount, setOkCount] = useState(() => listCache?.ok ?? 0); // DB-wide ok total, drives the strip count
  // v7 DocsSurface plumbing: the file the search overlay asked to open, the root + Import just
  // stacked, and the import-you-are-inside context the tab-row strip displays (v5 ruling).
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  const [rootCtx, setRootCtx] = useState<{ path: string; count: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [ingest, setIngest] = useState<MindMergeProgress | null>(null); // latest {done,total} for the overlay %
  const [ingesting, setIngesting] = useState(false); // the loading overlay is up from module-open until 100%
  const revealAfterLoad = useRef(false); // when true, drop the overlay only after the next list load renders
  const firstLoad = useRef(true); // the initial mount load must NOT blank cached rows (stale-while-revalidate)
  // Collapsed-strip search modal — module-scoped overlay; queries the SAME FTS prefix engine.
  const [searchOpen, setSearchOpen] = useState(false);
  const [modalQuery, setModalQuery] = useState("");
  const [modalRows, setModalRows] = useState<NoteRow[] | null>(null); // null = nothing typed yet

  // ---------- view tabs + the Documents (authoring) surface ----------
  const [tab, setTab] = useState<ViewTab>(() => tabCache ?? VIEW_TABS[0].id);
  /**
   * ENTITLEMENT — the RENDERER half. The main side already refuses: enforceFeature() sits in
   * mindMergeCtx(), the one function all 26 authored-document handlers call, so an unentitled
   * install cannot read or write a document no matter what the screen shows. This hides the tab so
   * the refusal is never something the user has to walk into. Both halves are required — a hidden
   * control is not a control, and a control with no hiding is a dead end with a stack trace.
   *
   * THREE STATES, NOT TWO. null means "still asking". The tab is hidden only on an explicit false,
   * so an entitled user never watches Documents vanish and come back on the first frame.
   */
  const [docsEntitled, setDocsEntitled] = useState<boolean | null>(entitledCache);
  /**
   * SAME SHAPE for the Brain tab (mindmergeBrain — Business/Root only, ruled 08-22-2026). The main
   * side refuses the ingest channels for an unentitled install; this hides the tab so nobody walks
   * into that refusal. Three-state like docsEntitled: hidden only on explicit false.
   */
  const [brainEntitled, setBrainEntitled] = useState<boolean | null>(brainEntitledCache);
  // NotesView's settings bag is the vault shape — a flat Record keyed by the string the VIEW uses.
  // What lands in app_settings is the DOC_KEYS translation, never these keys.
  const [docSettings, setDocSettings] = useState<Record<string, string>>(() => docCache ?? {});
  // NotesView's own change counter. Deliberately NOT the ingest `reloadKey` above: a note edit must
  // never re-run the watch-folder query, and a re-scan must never reload the document list.
  const [docReloadKey, setDocReloadKey] = useState(0);
  // The markdown-help modal and the document importer — the vault's shape verbatim
  // (VaultModule.tsx:81 / :83): a boolean for help, the ImportTarget-or-null for the importer.
  const [helpModal, setHelpModal] = useState(false);
  const [importModal, setImportModal] = useState<ImportTarget | null>(null);

  // Hydrate the tab + the three renamed document keys from app_settings. Root's MindMergeMount only
  // loads the four watch/rail/font keys, so these are read here through the SAME sanctioned
  // settings channel VaultModule uses (services getter → IPC → preload). Never localStorage.
  useEffect(() => {
    const viewKeys = Object.keys(DOC_KEYS);
    void Promise.all([
      ...viewKeys.map((k) => window.api.settings.get(DOC_KEYS[k])),
      window.api.settings.get(TAB_KEY),
    ])
      .then((vals) => {
        const next: Record<string, string> = {};
        viewKeys.forEach((k, i) => {
          const v = vals[i];
          if (v != null) next[k] = v;
        });
        docCache = next;
        setDocSettings(next);
        const t = vals[viewKeys.length];
        if (isViewTab(t)) {
          tabCache = t;
          setTab(t);
        }
      })
      .catch(() => {});
  }, []);

  // NotesView writes with the key IT knows; the translation to the module namespace happens here.
  // An unmapped key is dropped rather than forwarded — RENDERER_KEYS would reject it anyway, and a
  // rejected write throws "Unknown setting key" and drops the shell into Safe Mode (SOP §5).
  const setDocSetting = useCallback((key: string, value: string): void => {
    const stored = DOC_KEYS[key];
    if (!stored) return;
    setDocSettings((s) => {
      const next = { ...s, [key]: value }; // optimistic — the app_settings row is the truth
      docCache = next;
      return next;
    });
    void window.api.settings.set(stored, value);
  }, []);

  /**
   * Documents folder selection — PERSISTED as a row like every other view state, the vault's shape
   * verbatim (VaultModule.tsx:277-281 reading its settings bag; here the bag is docSettings and the
   * write goes through the DOC_KEYS seam). Defaults to UNFILED (-1), not "everything" (Jason
   * 08-12-2026): with thousands of documents imported, opening on the whole corpus is the load the
   * windowing work exists to avoid. NotesView reads the number the vault's way (NotesView.tsx:214):
   * 0 = every document, -1 = Unfiled, any other number = that folder.
   */
  const noteFolder = useMemo(() => {
    const n = Number(docSettings["notes.folder_selected"]);
    return Number.isInteger(n) ? n : -1;
  }, [docSettings]);
  const setNoteFolder = useCallback((id: number): void => setDocSetting("notes.folder_selected", String(id)), [setDocSetting]);

  /** Expanded note folders. Parsed defensively, copied from VaultModule.tsx:178-185 — a stored
      value is untrusted input, and a malformed one must collapse the tree, never blank the module. */
  const openFolders = useMemo(() => {
    try {
      const v: unknown = JSON.parse(docSettings["notes.folders_open"] || "[]");
      return Array.isArray(v) ? v.filter((n): n is number => typeof n === "number" && Number.isFinite(n)) : [];
    } catch {
      return [];
    }
  }, [docSettings]);

  const chooseTab = (t: ViewTab): void => {
    setTab(t);
    tabCache = t;
    void window.api.settings.set(TAB_KEY, t);
  };

  /**
   * Ask once per session — ONE round-trip carries BOTH features (licensing.features() returns the
   * whole map; a second fetch would be a second chance to disagree). A FAILED lookup resolves to
   * false, not to true: if the licence cannot be read, the safe answer is the closed one — the main
   * side would refuse anyway, and showing a tab that throws on every click is worse than not
   * showing it.
   *
   * THE STRAND GUARDS are the second half, one per direction. mindmerge.docs_tab persists which tab
   * was open, so a user whose entitlement lapses would return to a stored tab that no longer
   * renders — a blank module with no way back. On an explicit false we move them to the other tab
   * and write that through chooseTab, so the stored row stops pointing at a tab they cannot have.
   *
   * TOTALITY, and the double-false case. mindmergeDocs is ✔ at every tier (FEATURES, licensing
   * index.ts) — Documents is ALWAYS available, which is the invariant that makes brain→documents
   * total: there is always a real surface to land on. Data can therefore never say docs=false; the
   * ONLY source of a false docsEntitled is the catch above, and that path sets BOTH false. Without
   * the `brainEntitled !== false` condition on the documents→brain guard, double-false would
   * ping-pong the two guards forever (documents→brain→documents…), each hop an IPC settings write.
   * With it, double-false is terminal: both guards stand down, the user stays put, neither panel
   * renders (both panel guards refuse), and the main side is refusing everything anyway — the
   * honest state when the licence itself cannot be read.
   */
  useEffect(() => {
    if (entitledCache !== null && brainEntitledCache !== null) return;
    void window.api.licensing
      .features()
      .then((st) => {
        entitledCache = st.features.mindmergeDocs;
        brainEntitledCache = st.features.mindmergeBrain;
        setDocsEntitled(entitledCache);
        setBrainEntitled(brainEntitledCache);
      })
      .catch(() => {
        entitledCache = false;
        brainEntitledCache = false;
        setDocsEntitled(false);
        setBrainEntitled(false);
      });
  }, []);
  useEffect(() => {
    if (docsEntitled === false && brainEntitled !== false && tab === "documents") chooseTab("brain");
  }, [docsEntitled, brainEntitled, tab]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (brainEntitled === false && tab === "brain") chooseTab("documents");
  }, [brainEntitled, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // STABLE on purpose: NotesView's openUuid effect carries onOpened in its dependency list, so an
  // inline arrow would re-run it on every render of this module.
  // A Recently-edited click lands here: NotesView's openUuid effect opens the document, then
  // onOpened clears the request so the same row can be clicked again later.
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const onDocOpened = useCallback((): void => setOpenDoc(null), []);

  // The global-search mailbox: consume on mount (the navigate-then-request gap) and on event.
  useEffect(() => {
    const consume = (): void => {
      if (!pendingOpen) return;
      const req = pendingOpen;
      pendingOpen = null;
      if (req.file) {
        chooseTab("documents");
        setOpenFile(req.file);
      } else if (req.doc) {
        chooseTab("brain");
        setOpenDoc(req.doc);
      }
    };
    consume();
    window.addEventListener("mindmerge:open-request", consume);
    return () => window.removeEventListener("mindmerge:open-request", consume);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Injected watch settings (persisted root-side; changes re-point the fs.watch engine).
  // Standalone dev (no props): display from the manifest mock, write controls stay .nb.
  const s = settings ?? defaultSettings();
  const watchPath = s["mindmerge.watch_path"];
  // watch_enabled is no longer read here: the toggle moved to Settings -> MindMerge (BL-58 final
  // form, 08-25-2026) and the engine reads the row main-side. The strip shows path and count only.
  const live = onChange != null; // honesty gate

  // The side rail's « collapse — ONE preference for BOTH tabs (the Brain folders sidebar and the
  // Documents rail), persisted as mindmerge.rail_collapsed. Ruled 08-25-2026: the collapse control
  // belongs on the RAIL, not the note list — the list's edgetab is retired (NotesView).
  const railCollapsed = s["mindmerge.rail_collapsed"];
  const toggleRail = (): void => onChange?.({ "mindmerge.rail_collapsed": !railCollapsed });


  // Live ingest ticker — a large watch folder streams done/total over mindmerge:progress so the strip
  // shows a percentage instead of appearing frozen. The final tick (done === total) clears it.
  // ENTITLEMENT: reads the DOCUMENTS cache since the swap — this ticker belongs to the ingest engine.
  // A session known to be refused never subscribes (the cache, not the state, so the entitled first
  // mount is not deferred behind the features() round-trip). The listener is harmless either way:
  // the engine is lazy, only ensure() starts it, and ensure carries the same guard — so with no
  // engine running there is no event to stream.
  useEffect(() => {
    if (entitledCache === false) return;
    const onIngest = (p: MindMergeProgress): void => {
      setIngest(p);
      if (p.total > 0 && p.done < p.total) {
        setIngesting(true); // keep the overlay up for the whole load
      } else {
        // Ingest finished — DON'T drop the overlay yet. Reload the list and keep the overlay up until
        // those fresh rows are actually rendered, so there is no ~0.5-1s blank gap between the spinner
        // leaving and the directory appearing.
        revealAfterLoad.current = true;
        setReloadKey((k) => k + 1);
      }
    };
    api.on<MindMergeProgress>("mindmerge:progress", onIngest);
    return () => api.off<MindMergeProgress>("mindmerge:progress", onIngest);
  }, []);

  // Lazy engine start on module open. If this open actually kicks off an ingest, raise the overlay
  // IMMEDIATELY (before the first progress tick) so the whole load — walk + parse — is covered, and no
  // half-loaded list or skeleton shimmer shows through. Same on a fresh app start into MindMerge.
  // ENTITLEMENT (rewired 08-22-2026 with the tab swap): the ingest engine now lives behind
  // `mindmergeDocs`, which is FREE at every tier — so this is the three-state HIDE-ON-FALSE shape,
  // not the wait-for-true shape the Brain tab needs. Firing during the "still asking" null window is
  // correct here: the call cannot be refused for any tier that exists, and waiting a licensing
  // round-trip would delay the ingest of every install to protect against a state that never occurs.
  // If Documents ever stops being free, this guard already refuses on the explicit false.
  useEffect(() => {
    if (docsEntitled === false) return;
    void api.mindmerge.ensure().then((r) => { if (r.ingesting) setIngesting(true); }).catch(() => {});
  }, [docsEntitled]);

  // ponytail: the loading overlay is content-area only (absolute inset:0 below the topbar) — the native
  // window buttons sit ABOVE it and are never covered, so we do NOT dim them. Dimming blends the strip
  // toward the dark modal scrim, which in light theme paints a dark block over the buttons (the bug).

  // The fs.watch ingest is async/debounced, so counts read immediately after a change are stale.
  // Rescan is the sanctioned refresh: its return drives BOTH count chips directly, and the same
  // pass re-pulls the list (reloadKey → load effect), so the strip and list never disagree.
  const rescanAndRefresh = async () => {
    setScanning(true);
    try {
      const counts = await api.mindmerge.rescan();
      setOkCount(counts.ingested);
      setReloadKey((k) => k + 1); // load effect re-pulls the list (and clears error)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  };

  // + Import — STACKS a new root (main-side dialog + persist + engine restart with full ingest).
  // Never a replacement: earlier imports stay listed, per the v2 ruling. The ingest overlay covers
  // the read; DocsSurface expands the fresh import when the new tree lands.
  const addImport = async () => {
    const dir = await api.mindmerge.addRoot();
    if (!dir) return;
    setLastAdded(dir);
    setReloadKey((k) => k + 1);
  };




  // Load list + quarantine on every filter/search change. Search takes precedence over chips;
  // The list keeps parse_status='ok' rows only; there is no second view to switch to since the
  // quarantine shelf came out (08-22-2026).
  // ENTITLEMENT: this is the INGEST list, which the tab swap moved onto the free Documents tab, so
  // it takes the same hide-on-explicit-false shape as the engine start above. The wait-for-true
  // guard that used to sit here existed to stop a cold mount on a stored "brain" tab from firing one
  // doomed read; that race cannot occur against a feature no tier refuses.
  useEffect(() => {
    if (docsEntitled === false) return;
    let alive = true;
    setError(null);
    if (!firstLoad.current) setRows(null); // blank → skeleton on a filter/search change; NOT on a remount with cached rows
    firstLoad.current = false;
    void (async () => {
      try {
        const list = await api.mindmerge.list({ parse_status: "ok" });
        if (!alive) return;
        setRows(list);
        if (revealAfterLoad.current) { revealAfterLoad.current = false; setIngesting(false); } // fresh rows are in → drop the overlay
        setOkCount(list.length);
        listCache = { rows: list, ok: list.length }; // warm the cache for an instant re-entry
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [reloadKey, docsEntitled]);

  // Modal search — debounced against the SAME mindmerge:search prefix engine as the rail box.
  useEffect(() => {
    if (!searchOpen) return;
    const q = modalQuery.trim();
    if (!q) {
      setModalRows(null);
      return;
    }
    let alive = true;
    const t = window.setTimeout(() => {
      void api.mindmerge.search(q).then(
        (rs) => {
          if (alive) setModalRows(rs.filter((r) => r.parse_status === "ok"));
        },
        (e) => {
          if (alive) setError(e instanceof Error ? e.message : String(e));
        }
      );
    }, 200);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [searchOpen, modalQuery]);

  // Modal click-through: close, then hand the FILE to DocsSurface — it walks the folder tree to
  // it and opens the document in the editor.
  const pickResult = (r: NoteRow) => {
    setSearchOpen(false);
    setOpenFile(r.file_path);
  };


  return (
    <div className="mm-module">
      {/* VIEW TAB STRIP — avertxai-module-tabs standard (boxed tab joined to the panel beneath it).
          These are VIEW tabs, not document tabs. Markup only: the rules live in mindmerge.css. */}
      <div className="mm-tabs" role="tablist" aria-label="MindMerge views">
        {/* Per-tab entitlement filter, three-state each: a tab drops only on its own explicit
            false. Never-purchased is HIDDEN (ruled: "its hidden.") — no teaser, no locked
            placeholder. A one-tab strip stays a strip: that is the honest state for a Free/Pro
            install (Documents only), and removing the chrome would be a design change nobody
            ruled. */}
        {VIEW_TABS.filter(
          (t) =>
            (t.id !== "documents" || docsEntitled !== false) &&
            (t.id !== "brain" || brainEntitled !== false)
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={"mm-tab-" + t.id}
            aria-selected={tab === t.id}
            aria-controls={"mm-panel-" + t.id}
            className={"mm-tab" + (tab === t.id ? " on" : "")}
            onClick={() => chooseTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        {/* RIGHT CLUSTER - BL-58 final form (ruled from Jason's marked-up screenshot, 08-25-2026).
            Documents: plain-text path + count (no dot, no "watching", no toggle - all three cut by
            ruling), re-scan, module search, divider, + Import. Brain: divider + Import only - the
            strip never appears on Brain ("Jarvis's store is its own database and nothing on disk is
            watched for it"). + Import on Documents picks the ingest folder - SINGLE ROOT until the
            imports-stack backend of BL-58 exists, so "import" means "re-point" today, and that
            limitation is named in the backlog rather than hidden here. */}
        <div className="mm-tabright">
          {tab === "documents" && docsEntitled !== false && (
            <>
              <span className="mm-watch" title={rootCtx?.path || watchPath || undefined}>
                <b>{rootCtx?.path || watchPath || "No folder imported"}</b>
                {rootCtx !== null && <> &middot; {rootCtx.count.toLocaleString()}</>}
                {rootCtx === null && rows !== null && <> &middot; {okCount.toLocaleString()}</>}
              </span>
              <button
                className={"mm-trbtn" + (live ? "" : " nb")}
                onClick={live ? rescanAndRefresh : undefined}
                disabled={live && scanning}
                title="Re-scan"
                aria-label="Re-scan the watched folder"
              >
                {scanning ? "…" : "⟳"}
              </button>
              <button
                className="mm-trbtn"
                onClick={() => setSearchOpen(true)}
                title="Search this module"
                aria-label="Search this module"
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="7" cy="7" r="4.3" /><path d="M10.3 10.3 13.6 13.6" /></svg>
              </button>
              <span className="mm-trdiv" aria-hidden="true" />
              <button className="mm-trbtn mm-import" onClick={() => void addImport()}>
                + Import
              </button>
            </>
          )}
          {tab === "brain" && brainEntitled === true && (
            <>
              <span className="mm-trdiv" aria-hidden="true" />
              <button className="mm-trbtn mm-import" onClick={() => setImportModal("notes")}>
                + Import
              </button>
            </>
          )}
        </div>
      </div>

      <div
        className="mm-tabpanel"
        role="tabpanel"
        id={"mm-panel-" + tab}
        aria-labelledby={"mm-tab-" + tab}
      >
        {/* THE TWO SURFACES SWAPPED TABS on 08-22-2026, by Jason's ruling: "that module you copied to
            mindmerge, you need to switch it to brain, and what brain has switch to Documents.
            remember documents is for me and my _source files. and brain was for Jarvis, context keep,
            claude mem, graphify, BASE, obsidian etc."
            So DOCUMENTS is now the INGEST shape (the markdown he keeps on disk) and BRAIN is the
            AUTHORING shape (what Jarvis writes and he edits). Only the two conditions below moved —
            the panel bodies are untouched, which is what keeps this reviewable.
            THE ENTITLEMENT FOLLOWS THE TAB NAME, NOT THE CODE (his answer, same day: "yes, docs are
            free"). `mindmergeDocs` therefore now gates the ingest engine and `mindmergeBrain` gates
            the authoring channels — the matching swap is in electron/core/ipc.ts and
            electron/core/services/mindmerge/ipc.ts. Getting this backwards would put the free tier
            inside Jarvis's corpus, which is the one outcome he ruled against. */}
        {tab === "brain" && brainEntitled === true ? (
          /* BRAIN — the AUTHORING shape. NotesView owns its own layout and its own list cache;
             everything it persists arrives as `settings` and leaves through `onSetting`, renamed
             into the module namespace by DOC_KEYS on the way past.
             onHelp / onImport are REAL from Phase 4: NotesHelp.tsx and ImportDocsModal.tsx are
             ported (Lane B) and mounted at the module root below, the vault's shape
             (VaultModule.tsx:540 wires the same two callbacks into its NotesView). */
          <>
            {/* The folder tree, in its own column beside the view — the vault mounts the SAME
                component inside .vault-side > .vault-sidescroll (Sidebar.tsx:217-224); mechanical
                rename vault- → mm- (mindmerge.css already carries .mm-side.collapsed from the
                port). ONE COUNTER, BOTH LISTENERS (VaultModule.tsx:537-539): docReloadKey reaches
                the tree AND the list, so a drag or an import updates counts and rows together. */}
            <div className={"mm-side" + (railCollapsed ? " collapsed" : "")}>
              <div className="mm-sidescroll">
                {/* v7: the history section sits ABOVE the folders, per the approved mockup -
                    "thats what i wanted originally." */}
                <RecentlyEdited reloadKey={docReloadKey} onOpen={setOpenDoc} />
                <NoteFolderRail
                  selected={noteFolder}
                  onSelect={setNoteFolder}
                  reloadKey={docReloadKey}
                  onChanged={() => setDocReloadKey((k) => k + 1)}
                  open={openFolders}
                  onOpen={(ids) => setDocSetting("notes.folders_open", JSON.stringify(ids))}
                />
              </div>
              {/* THE ONE COLLAPSE CONTROL — welded to the rail's right edge, the vault Sidebar
                  shape (Jason 08-25-2026: "it needs to be on [the rail]"). The pane's .collapsed
                  CSS has been waiting for this control since the port. */}
              <button
                className="edgetab"
                title={railCollapsed ? "Expand the sidebar" : "Collapse the sidebar"}
                aria-label={railCollapsed ? "Expand the sidebar" : "Collapse the sidebar"}
                aria-expanded={!railCollapsed}
                onClick={toggleRail}
              >
                {railCollapsed ? "»" : "«"}
              </button>
            </div>
            <NotesView
              settings={docSettings}
              onSetting={setDocSetting}
              onHelp={() => setHelpModal(true)}
              onImport={() => setImportModal("notes")}
              folderId={noteFolder}
              reloadKey={docReloadKey}
              onNotesChanged={() => setDocReloadKey((k) => k + 1)}
              openUuid={openDoc}
              onOpened={onDocOpened}
            />
          </>
        ) : tab === "documents" && docsEntitled !== false ? (
          /* DOCUMENTS — the INGEST shape, byte-for-byte what this module rendered before the tabs went
             in. `mm-tabbed` is the ONLY addition: .rbs-shell hard-sets
             height:calc(100vh - topbar - footer), which would overflow now that a tab strip sits
             above it, so the modifier hands the height back to the flex parent. CSS lane owns the
             rule; this file only emits the class.
             PANEL GUARD — hide-on-explicit-false, because `mindmergeDocs` is free at every tier and
             an entitled user must never watch this surface flicker while features() resolves. The
             Brain panel above takes the stricter wait-for-true shape instead: it is the one that can
             actually be refused. */
          <div className="rbs-shell mm-tabbed">
          {/* The status strip is GONE from this panel (BL-58 final form): path + count and Re-scan
              moved to the tab row's right cluster, the dot and the word "watching" were cut, and the
              watch toggle lives in Settings -> MindMerge. */}

          {error && (
            <div className="rbs-error" role="alert">
              <span>MindMerge read failed: {error}</span>
              <button className="rbs-btn" onClick={() => setReloadKey((k) => k + 1)}>
                Retry
              </button>
            </div>
          )}

          {/* THE v7 DOCUMENTS SURFACE (BL-58, mockup approved): rail with Recently edited and the
              stacked-import folder tree, the document list, and the on-disk editor. It replaces the
              old list/detail split wholesale — the mockup is the spec, this is the build. */}
          <DocsSurface
            rows={rows}
            reloadKey={reloadKey}
            lastAdded={lastAdded}
            onAddedHandled={() => setLastAdded(null)}
            openFile={openFile}
            onOpenHandled={() => setOpenFile(null)}
            onRootCtx={setRootCtx}
            onSaved={() => setReloadKey((k) => k + 1)}
            railCollapsed={railCollapsed}
            onRailToggle={toggleRail}
          />

          {/* module-scoped search modal — absolute inside .rbs-shell (position:relative), so the
              backdrop dims the MODULE area only, never the shell chrome. Esc / backdrop-click close. */}
          {searchOpen && (
            <div
              className="rbs-overlay"
              onClick={() => setSearchOpen(false)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setSearchOpen(false);
              }}
            >
              <div className="rbs-modal" role="dialog" aria-label="Search notes" onClick={(e) => e.stopPropagation()}>
                <input
                  className="rbs-search"
                  type="search"
                  placeholder="Search notes&hellip;"
                  autoFocus
                  value={modalQuery}
                  onChange={(e) => setModalQuery(e.target.value)}
                  aria-label="Search notes"
                />
                <div className="rbs-mcount">
                  {modalRows === null
                    ? "Type to search all notes"
                    : `${modalRows.length} match${modalRows.length === 1 ? "" : "es"}`}
                </div>
                <div className="rbs-mresults">
                  {modalRows !== null && modalRows.length === 0 && (
                    <div className="rbs-empty">No notes match.</div>
                  )}
                  {modalRows?.map((r) => (
                    <button key={r.uuid} className="rbs-mrow" onClick={() => pickResult(r)}>
                      <span className="rbs-mfile">{fileName(r.file_path)}</span>
                      <span className="rbs-msnip">
                        {highlightText(matchSnippet(r, modalQuery.trim()), modalQuery.trim() || undefined)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Ingest overlay — ONLY when the DB has nothing to show (true first run / empty install).
              THE SECURED NOTES DIRECTION (Jason 08-26-2026: "you have to takes secured notes in the
              vault, so understand what direction we went when loading files"): the DB is the truth
              and renders INSTANTLY; the engine's scan runs in the background and the counts refresh
              when it lands. Blocking a 2,000-row list that is already in the DB behind a file-read
              spinner was the defect. */}
          {ingesting && (rows === null || rows.length === 0) && (
            <div className="rbs-loadmodal">
              <div className="rbs-loadmodal-card">
                <span className="rbs-loadspin" />
                <div className="rbs-loadmodal-title">Loading your notes…</div>
                <div className="rbs-loadmodal-sub">
                  {ingest && ingest.total > 0
                    ? `Reading ${ingest.done.toLocaleString()} of ${ingest.total.toLocaleString()} files · ${Math.round((ingest.done / ingest.total) * 100)}%`
                    : "Starting…"}
                </div>
              </div>
            </div>
          )}
          </div>
        ) : null}
      </div>

      {/* Vault shape verbatim (VaultModule.tsx:562-565): both modals mount at the module root.
          .mm-module is position:relative, so .mm-modalback (absolute inset:0) covers the module,
          never the shell chrome. The vault's onDone also calls its loadData() — that reloads vault
          SECRETS/SERVERS, which have no MindMerge counterpart; the document-side refresh is the one
          shared counter, which reloads the notes list AND the folder rail's counts together. */}
      {helpModal && <NotesHelpModal onClose={() => setHelpModal(false)} />}
      {importModal && (
        <ImportDocsModal target={importModal} onClose={() => setImportModal(null)} onDone={() => setDocReloadKey((k) => k + 1)} />
      )}
    </div>
  );
}
