/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Secured Vault — the module shell, rebuilt to MOCKUP-vault-full-v2-08-10-2026.
//
// WHAT CHANGED AND WHY (Jason, 08-10-2026):
//   • ONE ROW of tabs: Vault · Passwords · Secured Notes · Infrastructure · Repos. The old strip had
//     six tabs needing ~498 of the 508 pixels available at the 740 floor — it was full before a
//     single new surface existed. The tools that used to be tabs (Generator, Health, Access log,
//     Import/Export) moved into the sidebar under Passwords, where they belong to the thing they act on.
//   • Vault settings left the tab strip for a gear pinned to the SIDEBAR BOTTOM.
//   • The sidebar collapses, and carries user-composed shortcuts above the section groups.
//
// Three states stay three visibly different things (loading / empty / error) and an empty list is
// NEVER rendered over a failed read. A failed settings read degrades to the locked shell with a
// retry that refetches without a restart — it never routes to setup or first-run.
//
// Layout note: `view shown vault-shell` needs the three-class CSS rule in vault.css to beat
// globals.css's `.view.shown{display:block}` — without it the sidebar stacks above the content, and
// the compiler cannot see it.
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { readTheme } from "./codeTheme";
import EntriesView, { EntryModal } from "./EntriesView";
import CollageView, { type CollageSort } from "./CollageView";
import { PanesView } from "./PanesView";
import ImportDocsModal, { type ImportTarget } from "./ImportDocsModal";
import GlobalSearch, { SCOPE_SECTION } from "./GlobalSearch";
import Toast from "./Toast";
import ErrorBoundary from "./ErrorBoundary";
import ErrorsView from "./ErrorsView";
import ImportExportView from "./ImportExportView";
import InfraView from "./InfraView";
import NotesView, { NotesHelpModal } from "./NotesView";
import ReposView from "./ReposView";
import { clampWidth } from "./Resizer";
import Sidebar, { SIDE_DEFAULT, SIDE_MAX, SIDE_MIN, ShortcutModal, parseShortcuts, type Section, type Shortcut } from "./Sidebar";
import { AccessLogView, GeneratorView, HealthView } from "./ToolsViews";
import VaultSettingsView from "./VaultSettingsView";
import { vaultApi, type VaultFolder, type VaultLockState, type VaultRepo, type VaultSecretMeta, type VaultServer } from "./vaultApi";
import "./vault.css";

/** How Passwords shows its entries. Grid is the main page (Jason 08-06-2026); persisted, never localStorage. */
type ViewMode = "grid" | "list" | "panes";
const VIEW_MODES: [ViewMode, string][] = [["grid", "▦ Grid"], ["list", "☰ List"], ["panes", "◫ Panes"]];

// The one-row navbar. "Vault" is home/overview; the four that follow are the sections.
const NAV: [Section, string][] = [
  ["passwords", "Passwords"],
  ["notes", "Secured Notes"],
  ["infra", "Infrastructure"],
  ["repos", "Repos"],
];

export default function VaultModule() {
  const api = vaultApi();
  const [lock, setLock] = useState<VaultLockState | null>(null);
  const [lockError, setLockError] = useState(false);
  const [password, setPassword] = useState("");
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  const [secrets, setSecrets] = useState<VaultSecretMeta[]>([]);
  const [folders, setFolders] = useState<VaultFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState(false);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [tool, setTool] = useState<string | null>(null);
  const [editing, setEditing] = useState<VaultSecretMeta | null | "new">(null);
  /** Which kind a NEW entry opens on. Set by "Add SSH key" so the form arrives already showing the
   *  public-key and passphrase fields; cleared back to undefined for the ordinary + New entry. */
  const [newKind, setNewKind] = useState<string | undefined>(undefined);
  const [shortcutModal, setShortcutModal] = useState(false);
  const [helpModal, setHelpModal] = useState(false);
  /** One importer per tab (Jason 08-11-2026) — which one is open, or null. */
  const [importModal, setImportModal] = useState<ImportTarget | null>(null);
  // The other three corpora, loaded once so ONE search can cover the whole vault (Jason
  // 08-11-2026). Metadata only — no note body, and never a credential value.
  const [servers, setServers] = useState<VaultServer[]>([]);
  const [repos, setRepos] = useState<VaultRepo[]>([]);
  /** Secured Notes folder selection and a counter the tree watches so counts re-read after a write. */
  // Defaults to UNFILED, not "everything" (Jason 08-12-2026). With 4,000 notes imported, opening on
  // the whole corpus is the load this work exists to avoid; Unfiled is also the pile worth seeing.
  const [noteFolder, setNoteFolder] = useState(-1);
  const [noteReloadKey, setNoteReloadKey] = useState(0);
  /** A note the global search asked for. Consumed by NotesView, then cleared so re-selecting the
      same note later fires again rather than being swallowed as "already open". */
  const [pendingNote, setPendingNote] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [errorCount, setErrorCount] = useState(0);

  // Persisted view state — a row, never localStorage (§3.8).
  const section = (settings["view.section"] as Section) ?? "passwords";
  const sidebarCollapsed = settings["view.sidebar_collapsed"] === "1";
  const viewMode = (settings["view.mode"] as ViewMode) ?? "grid";
  const sort = (settings["view.sort"] as CollageSort) ?? "popular";
  const shortcuts = useMemo(() => parseShortcuts(settings["sidebar.shortcuts"]), [settings]);
  /**
   * SIDEBAR WIDTH PER SECTION (Jason 08-12-2026: "all dividers are different depending on tabs").
   *
   * One shared number was wrong because the tabs are not the same shape — Passwords' rail lists
   * folders and kinds, Secured Notes' holds a 500-folder tree, Infrastructure's is four short words.
   * Sizing one sized all three, so widening the notes tree stretched Infrastructure's four words
   * across 320 pixels of nothing.
   *
   * The LOCK stays global on purpose: "can I drag my panels" is one preference about the app, not
   * six about six tabs.
   */
  const railWidths = useMemo(() => {
    try {
      const v: unknown = JSON.parse(settings["sidebar.widths"] || "{}");
      if (!v || typeof v !== "object" || Array.isArray(v)) return {} as Record<string, number>;
      const out: Record<string, number> = {};
      for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
        if (typeof n === "number" && Number.isFinite(n)) out[k] = n;
      }
      return out;
    } catch {
      return {} as Record<string, number>;
    }
  }, [settings]);
  /**
   * THE CODE PALETTE, as CSS custom properties on the shell (MOCKUP-vault-code-appearance-v1).
   *
   * Which of the two stored themes applies is decided by the SHELL's mode, not by a vault setting —
   * `data-theme` on <html>, with no attribute meaning "system", exactly as §3.3 defines it. A code
   * block that stays dark when the app goes light is the bug this avoids, and it is why there are
   * two stored themes rather than one.
   *
   * Delivered as variables rather than props because Markdoc constructs CodeBlock itself: threading
   * a theme through the renderer's component map would rebuild the whole config on every mode flip,
   * where an ancestor variable costs one repaint.
   */
  /**
   * LIGHT is the only light one. §3.3: there are three modes, and `system` CLEARS the attribute so
   * it falls through to the `:root` Hybrid block — which is the deep navy #0d1320, a dark surface.
   * Hybrid does not follow the operating system, so consulting prefers-color-scheme here (as the
   * first cut did) would hand a light palette to a dark page on any machine set to light.
   */
  const isDarkNow = (): boolean => document.documentElement.getAttribute("data-theme") !== "light";
  const [shellDark, setShellDark] = useState(isDarkNow);
  useEffect(() => {
    // The shell writes data-theme at runtime; an observer is the only honest way to follow it from
    // inside a module that does not own the attribute.
    const el = document.documentElement;
    const read = (): void => setShellDark(isDarkNow());
    const mo = new MutationObserver(read);
    mo.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);

  const codeVars = useMemo(() => {
    const t = readTheme(settings[shellDark ? "code.theme_dark" : "code.theme_light"], shellDark ? "dark" : "light");
    const font = (settings["code.font"] ?? "").trim();
    return {
      "--vault-code-background": t.background,
      "--vault-code-plain": t.colors.plain,
      "--vault-code-comment": t.colors.comment,
      "--vault-code-string": t.colors.string,
      "--vault-code-keyword": t.colors.keyword,
      "--vault-code-number": t.colors.number,
      "--vault-code-function": t.colors.function,
      "--vault-code-variable": t.colors.variable,
      "--vault-code-type": t.colors.type,
      "--vault-code-punct": t.colors.punct,
      "--vault-code-comment-style": t.commentItalic ? "italic" : "normal",
      ...(font ? { "--vault-code-font": `${font}, ${"monospace"}` } : {}),
    } as React.CSSProperties;
  }, [settings, shellDark]);

  /** Expanded note folders. Parsed defensively, same as the shortcuts row above — a stored value is
      untrusted input, and a malformed one must collapse the tree, never blank the module. */
  const openFolders = useMemo(() => {
    try {
      const v: unknown = JSON.parse(settings["notes.folders_open"] || "[]");
      return Array.isArray(v) ? v.filter((n): n is number => typeof n === "number" && Number.isFinite(n)) : [];
    } catch {
      return [];
    }
  }, [settings]);

  const readLock = useCallback((): void => {
    setLockError(false);
    void api.lockState().then(setLock).catch(() => setLockError(true));
  }, [api]);
  useEffect(() => { readLock(); }, [readLock]);

  const open = lock !== null && !lock.locked;

  const loadData = useCallback((): void => {
    if (!open) return;
    setListError(false);
    void api.list(true)
      .then((rows) => { setSecrets(rows); setLoading(false); })
      .catch(() => { setListError(true); setLoading(false); }); // never let an empty list stand in for a failed read
    void api.getSettings().then(setSettings).catch(() => setSettings({}));
    void api.listFolders().then(setFolders).catch(() => setFolders([]));
    // NOTES ARE NOT LOADED HERE ANY MORE (08-12-2026). This used to call listNotes() with no filter
    // purely to feed the search box — 4,089 rows with excerpts, roughly 1.4 MB across the bridge, on
    // every reload, and NotesView then loaded them again. That was the 1.5-second hang on switching
    // to Secured Notes. The search queries main-side on demand instead; see GlobalSearch.
    // Servers and repos stay: they are tens of rows, not thousands.
    void api.listServers().then(setServers).catch((e: unknown) => { setServers([]); void api.logClient("warn", "Search: servers could not be read", String(e)); });
    void api.listRepos().then(setRepos).catch((e: unknown) => { setRepos([]); void api.logClient("warn", "Search: repos could not be read", String(e)); });
  }, [api, open]);
  useEffect(() => { loadData(); }, [loadData]);

  /**
   * How many errors the log is holding. Polled on open and every two minutes — the log is written
   * main-side by safeHandle, so the renderer has no other way to know something failed behind it.
   * Deliberately cheap: an indexed SELECT with a small cap, not the whole log.
   */
  useEffect(() => {
    if (!open) return;
    const count = (): void => {
      void api.listEvents({ level: "error", limit: 100 })
        .then((rows) => setErrorCount(rows.length))
        .catch(() => undefined);
    };
    count();
    const t = setInterval(count, 2 * 60 * 1000);
    return () => clearInterval(t);
  }, [api, open]);

  /**
   * SCHEDULED COMPACTION HEARTBEAT (Jason 08-12-2026). Asked on open and then hourly; main-side
   * decides whether anything should happen — it refuses when the schedule is off, when it is not
   * due, and above all when there is nothing worth reclaiming, so the usual answer is an instant no.
   * Polled rather than pushed on purpose: a once-a-week event does not justify a push channel and
   * the whitelist that comes with it.
   */
  useEffect(() => {
    if (!open) return;
    const tick = (): void => {
      void api.compactIfDue()
        .then((r) => {
          if (r.ran && r.freed > 0) {
            // Name the trigger. "It just happened" is unsettling; "it was 31% dead space" is not.
            const why = r.why === "proportional" ? `${Math.round(r.ratio * 100)}% of the file was dead space`
              : r.why === "absolute" ? "enough dead space had built up"
              : "the scheduled tidy was due";
            setToast(`Focal Registry memory compacted — ${(r.freed / 1048576).toFixed(1)} MB reclaimed, ${why}.`);
          }
        })
        .catch(() => undefined); // housekeeping never interrupts the user with a failure
    };
    const first = setTimeout(tick, 4000); // let the vault finish opening first
    const every = setInterval(tick, 60 * 60 * 1000);
    return () => { clearTimeout(first); clearInterval(every); };
  }, [api, open]);

  const setSetting = useCallback(
    (key: string, value: string): void => {
      setSettings((s) => ({ ...s, [key]: value })); // optimistic — the row write is the truth
      void api.setSetting(key, value).then(setSettings).catch(() => loadData());
    },
    [api, loadData]
  );

  const setSection = useCallback((s: Section): void => { setSetting("view.section", s); setTool(null); }, [setSetting]);

  /**
   * The host's search slot, if it offers one. Looked up after mount (the node exists in the host
   * document, outside React's tree) and held in state so the first paint after it is found
   * re-renders into it.
   */
  const [searchSlot, setSearchSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { setSearchSlot(document.getElementById("vault-topbar-search")); }, []);

  const searchBar = (
    <GlobalSearch
      secrets={secrets}
      servers={servers}
      repos={repos}
      onGo={(scope, q, id) => {
        setSection(SCOPE_SECTION[scope]);
        if (scope === "passwords") { setFilter("all"); setSearch(q); setTool(null); return; }
        if (scope !== "notes") return; // infra and repos still navigate only — see the note below
        /**
         * OPEN THE ACTUAL NOTE, and move the list to where it lives.
         *
         * Landing on the Secured Notes tab is not the same as opening the file, and the reason it is
         * more than one line is that a searched note is frequently NOT in the list you are looking
         * at: it can be a runbook while the list shows Notes, filed in a folder you have not
         * selected, or on the Archived shelf. So the note itself decides all three — its `kind`
         * picks the style, its `folder_id` picks the tree selection, its `archived_at` picks the
         * shelf — and only then is it opened. Otherwise the editor shows your note above a list that
         * does not contain it, which looks like a different bug.
         */
        void api.getNote(id)
          .then((n) => {
            if (n.kind === "note" || n.kind === "runbook" || n.kind === "snippet") setSetting("notes.style", n.kind);
            setNoteFolder(n.folder_id ?? -1);
            setPendingNote(n.uuid);
          })
          .catch(() => undefined); // a note deleted between the search and the click — just navigate
      }}
    />
  );
  const setShortcuts = useCallback((list: Shortcut[]): void => setSetting("sidebar.shortcuts", JSON.stringify(list.slice(0, 40))), [setSetting]);

  const submitUnlock = (): void => {
    setUnlockError(null);
    setUnlocking(true);
    void api.unlock(password)
      .then((s) => {
        setLock(s);
        if (s.locked) setUnlockError("That is not the master password.");
        else { setPassword(""); setLoading(true); }
      })
      .catch((e: unknown) => setUnlockError(e instanceof Error ? e.message : String(e)))
      .finally(() => setUnlocking(false));
  };

  // What the sidebar's filter and the search box leave standing — every Passwords view reads this
  // same set, so the sidebar means the same thing whichever view is on screen.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return secrets.filter((s) => {
      if (filter === "favourites" && s.favourite !== 1) return false;
      if (filter === "archived" && !s.archived_at) return false;
      if (filter !== "archived" && s.archived_at) return false;
      if (filter.startsWith("kind:") && s.kind !== filter.slice(5)) return false;
      if (filter === "unfiled" && s.folder_id != null) return false;
      if (filter.startsWith("folder:") && s.folder_id !== Number(filter.slice(7))) return false;
      if (!q) return true;
      return [s.label, s.username, s.url, s.full_name].some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [secrets, filter, search]);

  // ---- locked, or the lock could not be read: the SAME shell either way, with a retry.
  if (lockError || !lock || lock.locked) {
    return (
      <div className="view shown vault-shell" style={codeVars}>
        <div className="vault-lock">
          <div className="vault-lockcard">
            <div className="vault-lockglyph">🔒</div>
            <h2>Secured Vault</h2>
            {lockError ? (
              <>
                <div className="vault-locksub">The vault did not answer. Nothing has been changed.</div>
                <button className="vault-btn primary" onClick={readLock}>Try again</button>
              </>
            ) : (
              <>
                <div className="vault-locksub">Enter the master password to open your vault.</div>
                <input type="password" value={password} autoFocus placeholder="Master password"
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && password && !unlocking) submitUnlock(); }} />
                {unlockError && <div className="vault-lockerror">{unlockError}</div>}
                {lock && lock.failedAttempts > 0 && !unlockError && (
                  <div className="vault-lockerror">
                    {lock.failedAttempts} failed {lock.failedAttempts === 1 ? "attempt" : "attempts"} — every one is recorded.
                  </div>
                )}
                <div className="vault-btnrow" style={{ marginTop: 12, justifyContent: "center" }}>
                  <button className="vault-btn primary" disabled={!password || unlocking} onClick={submitUnlock}>
                    {unlocking ? "Opening…" : "Unlock"}
                  </button>
                </div>
                <div className="vault-lockplaceholder">
                  This lock protects the screen, not the file. The vault is already encrypted and still opens from this
                  computer's own credential store — tying the master password to that encryption is the next step.
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  const passwordsBody = (): React.ReactNode => {
    if (tool === "generator") return <GeneratorView settings={settings} onSetting={setSetting} />;
    if (tool === "health") return <HealthView settings={settings} onSetting={setSetting} />;
    if (tool === "log") return <AccessLogView />;
    if (tool === "importexport") return <ImportExportView onImported={loadData} />;
    if (loading) return <div className="vault-state">Opening the vault…</div>;
    if (listError) {
      return (
        <div className="vault-state error">The vault could not be read.
          <div><button className="vault-btn" onClick={loadData}>Try again</button></div>
        </div>
      );
    }
    return (
      <>
        <div className="vault-modeswitch">
          {VIEW_MODES.map(([m, label]) => (
            <button key={m} className={`vault-swbtn${viewMode === m ? " on" : ""}`} onClick={() => setSetting("view.mode", m)}>{label}</button>
          ))}
        </div>
        {viewMode === "grid" ? (
          <CollageView secrets={visible} sort={sort} onSort={(s) => setSetting("view.sort", s)} onReload={loadData}
            onNew={() => setEditing("new")} onEdit={setEditing} />
        ) : viewMode === "panes" ? (
          <PanesView secrets={secrets} folders={folders} onReload={loadData} onNew={() => setEditing("new")} onEdit={setEditing} />
        ) : (
          <EntriesView secrets={visible} folders={folders} loading={false} error={false} filter={filter} search={search}
            onReload={loadData} onNew={() => setEditing("new")} onEdit={setEditing} />
        )}
      </>
    );
  };

  return (
    <div className="view shown vault-shell" style={codeVars}>
      <div className="vault-main-col">
        {/* ONE SEARCH FOR THE WHOLE VAULT (Jason 08-11-2026), replacing the sidebar box and the
            notes-list box. It renders INTO THE TITLE BAR when the host provides a slot, which is
            the layout Jason asked for — and falls back to its own row when it does not, so the
            module is never dependent on a host it might not have. The component is module-owned
            either way; only its mount point moves on copy-back. */}
        {searchSlot
          ? createPortal(searchBar, searchSlot)
          : <div className="vault-topsearch">{searchBar}</div>}

        {/* ONE ROW — "Vault" is home; the four sections follow it. */}
        <div className="vault-navbar">
          {NAV.map(([s, label]) => (
            <button key={s} className={`vault-navtab${section === s ? " on" : ""}`} onClick={() => setSection(s)}>{label}</button>
          ))}
          {/* THE ERROR INDICATOR. The log was built on 08-11 and then buried in Settings, which is
              the same mistake the notes import button made — a thing you cannot find does not
              exist. It is NOT a sixth tab: the strip is one row by design and already needs ~498 of
              the 508 pixels available at the 740 floor. Instead it appears only when something has
              actually failed, and disappears when the log is clean, so it costs nothing until it
              matters and cannot be missed when it does. */}
          {errorCount > 0 && (
            <button
              className="vault-naverr"
              title={`${errorCount} error${errorCount === 1 ? "" : "s"} recorded — open the log`}
              onClick={() => setSection("errors")}
            >
              ⚠ {errorCount > 99 ? "99+" : errorCount}
            </button>
          )}
        </div>

        <div className="vault-shellbody">
          <Sidebar
            section={section}
            secrets={secrets}
            folders={folders}
            filter={filter}
            tool={tool}
            collapsed={sidebarCollapsed}
            shortcuts={shortcuts}
            onSearch={setSearch}
            onFilter={(f) => { setFilter(f); setSection("passwords"); }}
            onTool={setTool}
            onSection={setSection}
            onCollapse={(v) => setSetting("view.sidebar_collapsed", v ? "1" : "0")}
            noteFolder={noteFolder}
            onNoteFolder={setNoteFolder}
            noteReloadKey={noteReloadKey}
            onNotesChanged={() => setNoteReloadKey((k) => k + 1)}
            onShortcuts={setShortcuts}
            onFoldersChanged={() => { void api.listFolders().then(setFolders); loadData(); }}
            onAddShortcut={() => setShortcutModal(true)}
            width={clampWidth(railWidths[section], SIDE_MIN, SIDE_MAX, SIDE_DEFAULT)}
            onWidth={(w) => setSetting("sidebar.widths", JSON.stringify({ ...railWidths, [section]: w }))}
            adjustable={settings["sidebar.width_adjustable"] !== "0"}
            openFolders={openFolders}
            onOpenFolders={(ids) => setSetting("notes.folders_open", JSON.stringify(ids))}
          />

          <div className="vault-body">
            {section === "errors" && <ErrorBoundary surface="Activity & errors"><ErrorsView settings={settings} onSetting={setSetting} /></ErrorBoundary>}
            {section === "passwords" && <ErrorBoundary surface="Passwords">{passwordsBody()}</ErrorBoundary>}
            {/* reloadKey goes to BOTH the tree and the list. It used to reach the Sidebar only, so a
                note dragged into a folder updated the counts and not the list it was sitting in
                (Jason 08-12-2026). One counter, both listeners — that is the whole fix. */}
            {section === "notes" && <ErrorBoundary surface="Secured Notes"><NotesView secrets={secrets} settings={settings} onSetting={setSetting} onHelp={() => setHelpModal(true)} onImport={() => setImportModal("notes")} folderId={noteFolder} reloadKey={noteReloadKey} onNotesChanged={() => setNoteReloadKey((k) => k + 1)} openUuid={pendingNote} onOpened={() => setPendingNote(null)} /></ErrorBoundary>}
            {section === "infra" && <ErrorBoundary surface="Infrastructure"><InfraView secrets={secrets} onReload={loadData} onImport={() => setImportModal("infra")} onAddKey={() => { setNewKind("ssh_key"); setEditing("new"); }} reloadKey={noteReloadKey} /></ErrorBoundary>}
            {section === "repos" && <ErrorBoundary surface="Repos"><ReposView secrets={secrets} /></ErrorBoundary>}
            {section === "settings" && (
              <ErrorBoundary surface="Settings"><VaultSettingsView settings={settings} lockState={lock} onSetting={setSetting} onLockChanged={setLock}
                onDataChanged={loadData} shortcuts={shortcuts} onShortcuts={setShortcuts} secrets={secrets} folders={folders} /></ErrorBoundary>
            )}
          </div>
        </div>
      </div>

      {editing !== null && (
        <EntryModal secret={editing === "new" ? null : editing} settings={settings} onSetting={setSetting}
          initialKind={editing === "new" ? newKind : undefined}
          onClose={() => { setEditing(null); setNewKind(undefined); }}
          onSaved={() => { setEditing(null); setNewKind(undefined); loadData(); }} />
      )}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
      {shortcutModal && (
        <ShortcutModal secrets={secrets} folders={folders} shortcuts={shortcuts}
          onClose={() => setShortcutModal(false)} onChange={setShortcuts} />
      )}
      {helpModal && <NotesHelpModal onClose={() => setHelpModal(false)} />}
      {importModal && (
        <ImportDocsModal target={importModal} onClose={() => setImportModal(null)} onDone={() => { loadData(); setNoteReloadKey((k) => k + 1); }} />
      )}
    </div>
  );
}

/** Vault home — what is in here, and the way in. Counts only; no credential is on this screen. */
