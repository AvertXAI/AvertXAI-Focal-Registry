/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Secured Vault — the module shell. Rail + house tab strip + the lock screen, built to the approved
// mockup MOCKUP-vault-v3-8-options-08-02-2026.
//
// Three states are three visibly different things (loading / empty / error) and an empty list is
// NEVER rendered over a failed read. A failed settings read degrades to the locked shell with a
// retry that refetches without a restart — it never routes to setup or first-run.
//
// Layout note: `view shown vault-shell` needs the three-class CSS rule in vault.css to beat
// globals.css's `.view.shown{display:block}` — without it the rail stacks above the content, and
// the compiler cannot see it.
import { useCallback, useEffect, useMemo, useState } from "react";
import SecretsView, { EntryModal } from "./SecretsView";
import CollageView, { type CollageSort } from "./CollageView";
import { FoldersView, PanesView } from "./PanesView";
import { AccessLogView, GeneratorView, HealthView } from "./ToolsViews";
import VaultSettingsView from "./VaultSettingsView";
import { vaultApi, type VaultFolder, type VaultLockState, type VaultSecretMeta } from "./vaultApi";
import "./vault.css";

/** How the Vault tab shows its entries. Grid is the main page (Jason 08-06-2026); the choice
    persists to the vault's own settings, never localStorage. */
type ViewMode = "grid" | "list" | "panes" | "folders";

const VIEW_MODES: [ViewMode, string][] = [
  ["grid", "▦ Grid"],
  ["list", "☰ List"],
  ["panes", "◫ Panes"],
  ["folders", "🗀 Folders"],
];

type Tab = "vault" | "generator" | "health" | "log" | "settings";

const TABS: [Tab, string][] = [
  ["vault", "Vault"],
  ["generator", "Generator"],
  ["health", "Health"],
  ["log", "Access log"],
  ["settings", "Vault settings"],
];

const KIND_DOTS: [string, string, string][] = [
  ["kind:login", "Logins", "var(--vault-strong-color)"],
  ["kind:api_key", "API keys", "var(--mc-accent-primary)"],
  ["kind:financial", "Financial", "var(--vault-warn-color)"],
  ["kind:taxpayer_id", "Taxpayer IDs", "var(--vault-danger-color)"],
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
  const [tab, setTab] = useState<Tab>("vault");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<VaultSecretMeta | null | "new">(null);
  // Seeded from the persisted rows once they arrive; grid until then, because grid is the main page.
  const viewMode = (settings["view.mode"] as ViewMode) ?? "grid";
  const sort = (settings["view.sort"] as CollageSort) ?? "popular";

  // ---- the lock is the first question the module asks, before any data read.
  const readLock = useCallback((): void => {
    setLockError(false);
    void api
      .lockState()
      .then(setLock)
      .catch(() => setLockError(true));
  }, [api]);

  useEffect(() => {
    readLock();
  }, [readLock]);

  const open = lock !== null && !lock.locked;

  const loadData = useCallback((): void => {
    if (!open) return;
    setListError(false);
    void api
      .list(true)
      .then((rows) => {
        setSecrets(rows);
        setLoading(false);
      })
      .catch(() => {
        // Never let an empty list stand in for a failed read.
        setListError(true);
        setLoading(false);
      });
    void api.getSettings().then(setSettings).catch(() => setSettings({}));
    void api.listFolders().then(setFolders).catch(() => setFolders([]));
  }, [api, open]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const setSetting = useCallback(
    (key: string, value: string): void => {
      setSettings((s) => ({ ...s, [key]: value })); // optimistic — the row write is the truth
      void api
        .setSetting(key, value)
        .then(setSettings)
        .catch(() => loadData());
    },
    [api, loadData]
  );

  const submitUnlock = (): void => {
    setUnlockError(null);
    setUnlocking(true);
    void api
      .unlock(password)
      .then((s) => {
        setLock(s);
        if (s.locked) setUnlockError("That is not the master password.");
        else {
          setPassword("");
          setLoading(true);
        }
      })
      .catch((e: unknown) => setUnlockError(e instanceof Error ? e.message : String(e)))
      .finally(() => setUnlocking(false));
  };

  // What the rail's filter and the search box leave standing — the grid, panes and folder views all
  // read the same filtered set, so the rail means the same thing whichever view is on screen.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return secrets.filter((s) => {
      if (filter === "favourites" && s.favourite !== 1) return false;
      if (filter === "archived" && !s.archived_at) return false;
      if (filter !== "archived" && s.archived_at) return false;
      if (filter.startsWith("kind:") && s.kind !== filter.slice(5)) return false;
      if (!q) return true;
      return [s.label, s.username, s.url, s.full_name].some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [secrets, filter, search]);

  const counts = useMemo(() => {
    const active = secrets.filter((s) => !s.archived_at);
    return {
      all: active.length,
      favourites: active.filter((s) => s.favourite === 1).length,
      archived: secrets.filter((s) => s.archived_at).length,
      byKind: (kind: string): number => active.filter((s) => s.kind === kind).length,
    };
  }, [secrets]);

  // ---- locked, or the lock could not be read: the SAME shell either way, with a retry.
  if (lockError || !lock || lock.locked) {
    return (
      <div className="view shown vault-shell">
        <div className="vault-lock">
          <div className="vault-lockcard">
            <div className="vault-lockglyph">🔒</div>
            <h2>Secured Vault</h2>
            {lockError ? (
              <>
                <div className="vault-locksub">The vault did not answer. Nothing has been changed.</div>
                <button className="vault-btn primary" onClick={readLock}>
                  Try again
                </button>
              </>
            ) : (
              <>
                <div className="vault-locksub">Enter the master password to open your vault.</div>
                <input
                  type="password"
                  value={password}
                  autoFocus
                  placeholder="Master password"
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && password && !unlocking) submitUnlock();
                  }}
                />
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

  return (
    <div className="view shown vault-shell">
      <div className="vault-rail">
        <div className="vault-railsearch">
          <input placeholder="Search secrets" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="vault-raillist">
          <div className="vault-railhead">Vault</div>
          <button className={`vault-railrow${filter === "all" ? " on" : ""}`} onClick={() => { setFilter("all"); setTab("vault"); }}>
            <span className="vault-raildot" style={{ background: "var(--mc-accent-primary)" }} />
            <span className="vault-railname">All items</span>
            <span className="vault-railcount">{counts.all}</span>
          </button>
          <button className={`vault-railrow${filter === "favourites" ? " on" : ""}`} onClick={() => { setFilter("favourites"); setTab("vault"); }}>
            <span className="vault-raildot" style={{ background: "var(--vault-warn-color)" }} />
            <span className="vault-railname">Favourites</span>
            <span className="vault-railcount">{counts.favourites}</span>
          </button>
          <button className={`vault-railrow${filter === "archived" ? " on" : ""}`} onClick={() => { setFilter("archived"); setTab("vault"); }}>
            <span className="vault-raildot" style={{ background: "var(--mc-dimmer)" }} />
            <span className="vault-railname">Archived</span>
            <span className="vault-railcount">{counts.archived}</span>
          </button>

          <div className="vault-railhead">Types</div>
          {KIND_DOTS.map(([key, label, colour]) => (
            <button key={key} className={`vault-railrow${filter === key ? " on" : ""}`} onClick={() => { setFilter(key); setTab("vault"); }}>
              <span className="vault-raildot" style={{ background: colour }} />
              <span className="vault-railname">{label}</span>
              <span className="vault-railcount">{counts.byKind(key.slice(5))}</span>
            </button>
          ))}

          <div className="vault-railhead">Tools</div>
          {TABS.filter(([t]) => t !== "vault").map(([t, label]) => (
            <button key={t} className={`vault-railrow${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>
              <span className="vault-railname">{label}</span>
            </button>
          ))}
          <button className="vault-railrow" onClick={() => void api.lock().then(setLock)}>
            <span className="vault-railname">Lock the vault</span>
          </button>
        </div>
      </div>

      <div className="vault-main">
        <div className="vault-tabs">
          {TABS.map(([t, label]) => (
            <button key={t} className={`vault-tab${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>
              {label}
            </button>
          ))}
        </div>
        <div className="vault-body">
          {tab === "vault" && (
            <>
              <div className="vault-modeswitch">
                {VIEW_MODES.map(([m, label]) => (
                  <button
                    key={m}
                    className={`vault-swbtn${viewMode === m ? " on" : ""}`}
                    onClick={() => setSetting("view.mode", m)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {loading ? (
                <div className="vault-state">Opening the vault…</div>
              ) : listError ? (
                <div className="vault-state error">
                  The vault could not be read.
                  <div>
                    <button className="vault-btn" onClick={loadData}>
                      Try again
                    </button>
                  </div>
                </div>
              ) : viewMode === "grid" ? (
                <CollageView
                  secrets={visible}
                  sort={sort}
                  onSort={(s) => setSetting("view.sort", s)}
                  onReload={loadData}
                  onNew={() => setEditing("new")}
                  onEdit={setEditing}
                />
              ) : viewMode === "panes" ? (
                <PanesView secrets={secrets} folders={folders} onReload={loadData} onNew={() => setEditing("new")} onEdit={setEditing} />
              ) : viewMode === "folders" ? (
                <FoldersView
                  secrets={secrets}
                  folders={folders}
                  onReload={loadData}
                  onFoldersChanged={() => void api.listFolders().then(setFolders)}
                  onEdit={setEditing}
                />
              ) : (
                <SecretsView secrets={secrets} loading={false} error={false} filter={filter} search={search} onReload={loadData} />
              )}
            </>
          )}
          {tab === "generator" && <GeneratorView settings={settings} onSetting={setSetting} />}
          {tab === "health" && <HealthView settings={settings} onSetting={setSetting} />}
          {tab === "log" && <AccessLogView />}
          {tab === "settings" && (
            <VaultSettingsView
              settings={settings}
              lockState={lock}
              onSetting={setSetting}
              onLockChanged={setLock}
              onDataChanged={loadData}
            />
          )}
        </div>
      </div>

      {editing !== null && (
        <EntryModal
          secret={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            loadData();
          }}
        />
      )}
    </div>
  );
}
