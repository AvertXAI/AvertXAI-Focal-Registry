/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Vault section for the SHARED Settings surface — the second DOOR to the vault's settings, ruled by
// Jason 08-14-2026 ("whatever settings the vault had, we need to add them to the shells settings,
// cause right now, i cant access them at all"). Supersedes the older "no vault controls in the
// application's Settings page, ever" line — recorded in CANON-UPDATES.md. What did NOT change: the
// settings still LIVE inside the encrypted vault file and open only with it, so this component is a
// host, not a copy — same rows, same lock-gated IPC, same VaultSettingsView the in-vault gear
// shows. While the vault is locked there is nothing readable to render and it says so — and per
// Jason's same-day follow-up ruling ("a modal should appear, maybe the same page the vault uses"),
// clicking the locked card opens a modal that asks for the master password over the SAME
// vault:unlock channel the module uses. Nothing new is stored; the dev-reveal chip stays
// module-only. No module-scope session cache on purpose (the
// TimeTracker warm-cache pattern is wrong for this one component): cached vault state outliving a
// lock would paint secrets metadata after the door closed. Every mount re-reads.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Vault } from "../../icons";
import ErrorBoundary from "./ErrorBoundary";
import { parseShortcuts, type Shortcut } from "./Sidebar";
import VaultSettingsView from "./VaultSettingsView";
import { vaultApi, type VaultFolder, type VaultLockState, type VaultSecretMeta } from "./vaultApi";

export default function VaultSettings() {
  const api = vaultApi();
  const [lock, setLock] = useState<VaultLockState | null>(null);
  const [lockError, setLockError] = useState(false);
  const [secrets, setSecrets] = useState<VaultSecretMeta[]>([]);
  const [folders, setFolders] = useState<VaultFolder[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);

  useEffect(() => {
    void api.lockState().then(setLock).catch(() => setLockError(true));
  }, [api]);

  const open = lock !== null && !lock.locked;

  // Mirrors VaultModule's loaders — same calls, same defensive catches, so the two doors can never
  // disagree about what the settings surface is looking at.
  const loadData = useCallback((): void => {
    if (!open) return;
    void api.list(true).then(setSecrets).catch(() => setSecrets([]));
    void api.getSettings().then(setSettings).catch(() => setSettings({}));
    void api.listFolders().then(setFolders).catch(() => setFolders([]));
  }, [api, open]);
  useEffect(() => { loadData(); }, [loadData]);

  const setSetting = useCallback(
    (key: string, value: string): void => {
      setSettings((s) => ({ ...s, [key]: value })); // optimistic — the row write is the truth
      void api.setSetting(key, value).then(setSettings).catch(() => loadData());
    },
    [api, loadData]
  );
  const shortcuts = useMemo(() => parseShortcuts(settings["sidebar.shortcuts"]), [settings]);
  const setShortcuts = useCallback(
    (list: Shortcut[]): void => setSetting("sidebar.shortcuts", JSON.stringify(list.slice(0, 40))),
    [setSetting]
  );

  const closeUnlock = useCallback((): void => {
    setUnlockOpen(false);
    setPassword("");
    setUnlockError(null);
  }, []);
  // The module's submitUnlock, mirrored — same channel, same wording, so the two doors cannot drift.
  const submitUnlock = (): void => {
    setUnlockError(null);
    setUnlocking(true);
    void api.unlock(password)
      .then((s) => {
        setLock(s);
        if (s.locked) setUnlockError("That is not the master password.");
        else closeUnlock();
      })
      .catch((e: unknown) => setUnlockError(e instanceof Error ? e.message : String(e)))
      .finally(() => setUnlocking(false));
  };

  return (
    <>
      <h2>Vault</h2>
      {lockError && (
        <p className="hint">
          The vault could not be reached. Open the Secured Vault module — if something is wrong it will show a
          reference code there.
        </p>
      )}
      {!lockError && lock !== null && !open && (
        <>
          <div className="door" role="button" tabIndex={0} style={{ cursor: "pointer" }}
            onClick={() => setUnlockOpen(true)}
            onKeyDown={(e) => { if (e.key === "Enter") setUnlockOpen(true); }}>
            <div className="di">
              <Vault />
            </div>
            <div>
              <div className="dt">The vault is locked</div>
              <div className="dd">
                Its settings live inside the encrypted vault file. Click here to enter the master password — or
                unlock the Secured Vault module — and this page fills in.
              </div>
            </div>
          </div>
          {unlockOpen && (
            /* The unlock modal Jason ruled 08-14 ("a modal should appear, maybe the same page the
               vault uses") — the module's lock card, floated. vault-shell on the scrim carries the
               --vault-* tokens; its viewport layout is replaced by the fixed overlay inline. */
            <div className="vault-shell"
              style={{ position: "fixed", inset: 0, zIndex: 1000, height: "auto", overflow: "visible", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--vault-modal-scrim)" }}
              onClick={() => { if (!unlocking) closeUnlock(); }}>
              <div className="vault-lockcard" onClick={(e) => e.stopPropagation()}>
                <div className="vault-lockglyph">🔒</div>
                <h2>Secured Vault</h2>
                <div className="vault-locksub">Enter the master password to open your vault.</div>
                <input type="password" value={password} autoFocus placeholder="Master password"
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && password && !unlocking) submitUnlock();
                    if (e.key === "Escape" && !unlocking) closeUnlock();
                  }} />
                {unlockError && <div className="vault-lockerror">{unlockError}</div>}
                {lock.failedAttempts > 0 && !unlockError && (
                  <div className="vault-lockerror">
                    {lock.failedAttempts} failed {lock.failedAttempts === 1 ? "attempt" : "attempts"} — every one is recorded.
                  </div>
                )}
                <div className="vault-btnrow" style={{ marginTop: 12, justifyContent: "center" }}>
                  <button className="vault-btn" onClick={closeUnlock} disabled={unlocking}>Cancel</button>
                  <button className="vault-btn primary" disabled={!password || unlocking} onClick={submitUnlock}>
                    {unlocking ? "Opening…" : "Unlock"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
      {open && (
        /* --vault-* tokens are declared on .vault-shell, never :root — the host carries the class
           for token scope and neutralizes its viewport layout inline, because the Settings pane owns
           layout here. position:relative stays so a vault modal scrim anchors to this block. */
        <div className="vault-shell" style={{ display: "block", height: "auto", overflow: "visible", background: "transparent" }}>
          <ErrorBoundary surface="Settings">
            <VaultSettingsView
              settings={settings}
              lockState={lock}
              onSetting={setSetting}
              onLockChanged={setLock}
              onDataChanged={loadData}
              shortcuts={shortcuts}
              onShortcuts={setShortcuts}
              secrets={secrets}
              folders={folders}
            />
          </ErrorBoundary>
        </div>
      )}
    </>
  );
}
