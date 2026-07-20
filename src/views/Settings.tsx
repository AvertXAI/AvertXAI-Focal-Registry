/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Settings — 2-pane (left nav list / right content pane). Live sections: General (Skip Fast Boot) and
// Appearance (3-state theme toggle). The theme STATE + persistence live in App ("Expose, Don't
// Connect"); this pane only renders the control. "Coming surfaces" stay .nb.
import { useEffect, useState } from "react";
import { DoorTheme, Gear, Mail, Vault, Webhook } from "../icons";
import { bumpRender } from "../diag";
import { signalUpdateToast, type ThemeMode } from "../App";
import type { StorageLocations } from "../shared/types";

interface Props {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

export default function Settings({ themeMode, onThemeChange }: Props) {
  bumpRender("settings"); // DIAG-2
  const [skipBoot, setSkipBoot] = useState(false);
  const [trayOn, setTrayOn] = useState(true); // tray-on-close — default ON (§3.11)
  const [activeSection, setActiveSection] = useState("General");
  const [appVersion, setAppVersion] = useState("");
  const [checking, setChecking] = useState(false);
  // Scan · history retention controls
  const [clearedCount, setClearedCount] = useState(0);
  const [confirmStep, setConfirmStep] = useState(0); // 0 idle → 1 first confirm → 2 second confirm (double-confirm delete-forever)
  const [scanMsg, setScanMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Storage · locations transparency + change-root
  const [storageLoc, setStorageLoc] = useState<StorageLocations | null>(null);
  const [storageMsg, setStorageMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pendingRoot, setPendingRoot] = useState<string | null>(null);

  useEffect(() => {
    void window.api.settings.get("skip_fast_boot").then((v) => setSkipBoot(v === "1"));
    void window.api.settings.get("tray_enabled").then((v) => setTrayOn(v !== "0")); // default ON
    void window.api.updater.version().then(setAppVersion).catch(() => {}); // never hardcoded
  }, []);

  const loadCleared = () => void window.api.scan.clearedHistoryCount().then(setClearedCount).catch(() => {});
  // Refresh the cleared-run count whenever the Scan section opens; reset any in-flight confirm/message.
  useEffect(() => {
    if (activeSection === "Scan") { loadCleared(); setConfirmStep(0); setScanMsg(null); }
    if (activeSection === "Storage") { setStorageMsg(null); setPendingRoot(null); void window.api.storage.locations().then(setStorageLoc).catch(() => {}); }
  }, [activeSection]);

  const pickNewRoot = async () => {
    const picked = await window.api.storage.pickRoot();
    if (picked) { setStorageMsg(null); setPendingRoot(picked); } // offer to copy before committing (2.6)
  };
  const confirmChangeRoot = async () => {
    if (!pendingRoot) return;
    const r = await window.api.storage.changeRoot(pendingRoot);
    setPendingRoot(null);
    if (r.ok) {
      setStorageMsg({ ok: true, text: "Location changed — your records were copied to the new folder. The old folder was left untouched." });
      void window.api.storage.locations().then(setStorageLoc);
    } else {
      setStorageMsg({ ok: false, text: `Could not change location: ${r.error ?? "unknown error"}. Nothing was moved or deleted.` });
    }
  };

  const restoreHistory = async () => {
    try {
      const r = await window.api.scan.restoreHistory();
      setScanMsg({ ok: true, text: `Restored ${r.restored} run${r.restored === 1 ? "" : "s"} to the history viewer.` });
      loadCleared();
    } catch (e) { setScanMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
  };
  const deleteForever = async () => {
    try {
      const r = await window.api.scan.deleteHistoryForever();
      setScanMsg({ ok: true, text: `Permanently deleted ${r.deleted} run${r.deleted === 1 ? "" : "s"}.` });
    } catch (e) { setScanMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setConfirmStep(0); loadCleared(); }
  };

  // Manual check — unlike the silent automatic cycle, the user asked, so every outcome toasts:
  // checking → latest-version / available (pushed from main) / couldn't-check.
  const checkForUpdates = async () => {
    setChecking(true);
    signalUpdateToast({ stage: "checking" });
    try {
      const r = await window.api.updater.check();
      if (r.status === "none") signalUpdateToast({ stage: "none", version: r.version ?? appVersion });
      else if (r.status === "error") signalUpdateToast({ stage: "error" });
      else if (r.status === "available") signalUpdateToast({ stage: "available", version: r.version ?? "" });
      // available → the toast shows a Download button (consent-first; autoDownload is OFF). Download →
      // progress → the "ready to restart" toast fires from updater:downloaded when it completes.
    } catch {
      signalUpdateToast({ stage: "error" });
    }
    setChecking(false);
  };

  const toggleSkipBoot = () => {
    const next = !skipBoot;
    setSkipBoot(next);
    void window.api.settings.set("skip_fast_boot", next ? "1" : "0");
  };
  const toggleTray = () => {
    const next = !trayOn;
    setTrayOn(next);
    void window.api.tray.setEnabled(next); // persists to app_settings AND rewires the ✕ behaviour live
  };

  // Left-nav class — active drives the right pane. Only real sections switch; .nb items are not-built
  // (App's capture-phase .nb interceptor swallows their clicks, so they never activate).
  const nav = (label: string) => `navitem${activeSection === label ? " active" : ""}`;

  return (
    <main className="view shown">
      <div className="wrap">
        <div className="settingsgrid">
          <nav className="setnav">
            <button className={nav("General")} onClick={() => setActiveSection("General")}>
              <Gear />
              General
            </button>
            <button className={nav("Appearance")} onClick={() => setActiveSection("Appearance")}>
              <DoorTheme />
              Appearance
            </button>
            <button className={nav("Storage")} onClick={() => setActiveSection("Storage")}>
              <FolderIcon />
              Storage
            </button>
            <div className="setsec">Access</div>
            <div className="setsec">Modules</div>
            <button className={nav("Scan")} onClick={() => setActiveSection("Scan")}>
              <ScanIcon />
              Scan
            </button>
            <button className="navitem nb">
              <Vault />
              Vault
            </button>
            <div className="setsec">Integrations</div>
            <button className="navitem nb">
              <Webhook />
              Webhooks
            </button>
            <button className="navitem nb">
              <Mail />
              Email notifications
            </button>
          </nav>

          <div className="setmain">
            {activeSection === "General" && (
              <>
                <h2>General</h2>
                <div className="field">
                  <label htmlFor="orgname">Workspace name</label>
                  <div className="fieldrow">
                    <input className="input" id="orgname" defaultValue="AvertXAI Focal Registry" />
                    <button className="btn nb">Rename</button>
                  </div>
                  <p className="hint">
                    White-label: rename to a client&apos;s brand (e.g. &quot;Acme ABC&quot;). Every module label follows
                    this.
                  </p>
                </div>
                <div className="field" style={{ marginTop: 26 }}>
                  <div className="setrow">
                    <label htmlFor="skipboot">Skip Fast Boot</label>
                    <button
                      id="skipboot"
                      role="switch"
                      aria-checked={skipBoot}
                      className={`switch${skipBoot ? " on" : ""}`}
                      onClick={toggleSkipBoot}
                    />
                  </div>
                  <p className="hint">
                    Bypass the JARVIS terminal sequence on startup and load directly into the dashboard.
                  </p>
                </div>
                <div className="field" style={{ marginTop: 26 }}>
                  <div className="setrow">
                    <label htmlFor="trayclose">Keep running in the tray on close</label>
                    <button
                      id="trayclose"
                      role="switch"
                      aria-checked={trayOn}
                      className={`switch${trayOn ? " on" : ""}`}
                      onClick={toggleTray}
                    />
                  </div>
                  <p className="hint">
                    On: closing the window (✕) keeps the app running in the system tray — reopen it from the
                    tray icon. Off: closing the window quits completely, with nothing left in the background.
                  </p>
                </div>
                <div className="field" style={{ marginTop: 26 }}>
                  <div className="setrow">
                    <label>Updates</label>
                    <button className="btn" onClick={() => void checkForUpdates()} disabled={checking}>
                      {checking ? "Checking…" : "Check for updates"}
                    </button>
                  </div>
                  <p className="hint">
                    Current version: {appVersion || "unknown"}. Updates download only with your consent and install
                    when the application closes.
                  </p>
                </div>
                <h2 className="mt">Coming surfaces</h2>
                <p className="hint" style={{ marginBottom: 14 }}>
                  Mapped but not built yet — these Vault surfaces arrive with the Secure Vault module.
                </p>
                <div className="door nb">
                  <div className="di">
                    <Vault />
                  </div>
                  <div>
                    <div className="dt">Vault Security</div>
                    <div className="dd">
                      Unlock policy for the encrypted vault — key handling, auto-lock timer, and re-lock on idle.
                    </div>
                  </div>
                  <span className="dtag">Not built</span>
                </div>
                <div className="door nb">
                  <div className="di">
                    <Vault />
                  </div>
                  <div>
                    <div className="dt">Vault Backup &amp; Export</div>
                    <div className="dd">Encrypted export of the vault database for offsite backup and migration.</div>
                  </div>
                  <span className="dtag">Not built</span>
                </div>
              </>
            )}

            {activeSection === "Appearance" && (
              <>
                <h2>Appearance</h2>
                <div className="field">
                  <label>Theme</label>
                  <div className="themeseg" role="group" aria-label="Theme">
                    <button
                      className={"segbtn" + (themeMode === "system" ? " on" : "")}
                      onClick={() => onThemeChange("system")}
                      title="System theme"
                      aria-label="System theme"
                      aria-pressed={themeMode === "system"}
                    >
                      <MonitorIcon />
                    </button>
                    <button
                      className={"segbtn" + (themeMode === "light" ? " on" : "")}
                      onClick={() => onThemeChange("light")}
                      title="Light theme"
                      aria-label="Light theme"
                      aria-pressed={themeMode === "light"}
                    >
                      <SunIcon />
                    </button>
                    <button
                      className={"segbtn" + (themeMode === "dark" ? " on" : "")}
                      onClick={() => onThemeChange("dark")}
                      title="Dark theme"
                      aria-label="Dark theme"
                      aria-pressed={themeMode === "dark"}
                    >
                      <MoonIcon />
                    </button>
                  </div>
                  <p className="hint">
                    System keeps the Hybrid navy default; Light and Dark apply the Claude crisp-white / charcoal palettes.
                  </p>
                </div>
              </>
            )}

            {activeSection === "Storage" && (
              <>
                <h2>Storage</h2>
                <p className="hint" style={{ marginBottom: 18 }}>
                  Where Focal Registry keeps your files. You choose the root folder for the Markdown records;
                  the app manages everything below it. Click a path to open that folder.
                </p>
                {storageLoc && !storageLoc.reachable && (
                  <p className="hint" style={{ color: "#e0574f", marginBottom: 14 }}>
                    This folder can’t be reached right now, so nothing is being written to it. Pick a reachable
                    location below — the app never creates a copy anywhere else.
                  </p>
                )}
                <div className="field">
                  <label>Markdown records (app-managed)</label>
                  <button className="pathrow" title="Open this folder" onClick={() => void window.api.storage.openFolder(storageLoc?.scanMarkdown ?? "")}>
                    {storageLoc?.scanMarkdown ?? "…"}
                  </button>
                  <p className="hint">Scan reports are saved here (and, for a scan, also onto the scanned drive so they travel with the archive).</p>
                </div>
                <div className="field" style={{ marginTop: 22 }}>
                  <label>Exports (PDF / CSV)</label>
                  <button className="pathrow" title="Open this folder" onClick={() => void window.api.storage.openFolder(storageLoc?.documentsExports ?? "")}>
                    {storageLoc?.documentsExports ?? "…"}
                  </button>
                  <p className="hint">Every PDF or CSV you export lands here, and the folder opens with the file selected.</p>
                </div>
                <div className="field" style={{ marginTop: 22 }}>
                  <div className="setrow">
                    <label>Change the records location</label>
                    {pendingRoot ? null : <button className="btn" onClick={() => void pickNewRoot()}>Choose folder…</button>}
                  </div>
                  {pendingRoot && (
                    <div style={{ marginTop: 8 }}>
                      <p className="hint" style={{ marginBottom: 8 }}>
                        Copy your records into <b>{pendingRoot}</b>? The current folder is <b>left untouched</b> — nothing is moved or deleted.
                      </p>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="btn" onClick={() => setPendingRoot(null)}>Cancel</button>
                        <button className="btn" onClick={() => void confirmChangeRoot()}>Copy &amp; switch</button>
                      </div>
                    </div>
                  )}
                  <p className="hint">Picks a new root; the app copies the existing tree there and then points at it. The old location is never removed.</p>
                  {storageMsg && (
                    <p className="hint" style={{ color: storageMsg.ok ? "var(--mc-green)" : "#e0574f", marginTop: 8 }}>{storageMsg.text}</p>
                  )}
                </div>
              </>
            )}

            {activeSection === "Scan" && (
              <>
                <h2>Scan</h2>
                <p className="hint" style={{ marginBottom: 20 }}>
                  Nuking scan history hides it from the viewer but keeps it in the database for 30 days. Restore it here
                  before then, or delete it permanently.
                </p>
                <div className="field">
                  <div className="setrow">
                    <label>Restore scanner history logs</label>
                    <button className="btn" onClick={() => void restoreHistory()} disabled={clearedCount === 0}>
                      Restore{clearedCount > 0 ? ` (${clearedCount})` : ""}
                    </button>
                  </div>
                  <p className="hint">Brings history nuked within the last 30 days back into the viewer, ordered by date.</p>
                </div>
                <div className="field" style={{ marginTop: 26 }}>
                  <div className="setrow">
                    <label>Delete cleared history forever</label>
                    {confirmStep === 0 ? (
                      <button
                        className="iconbtn"
                        style={{ color: "#e0574f", borderColor: "#e0574f" }}
                        title="Delete forever"
                        aria-label="Delete cleared history forever"
                        disabled={clearedCount === 0}
                        onClick={() => { setScanMsg(null); setConfirmStep(1); }}
                      >
                        <TrashIcon />
                      </button>
                    ) : (
                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="btn" onClick={() => setConfirmStep(0)}>Cancel</button>
                        <button
                          className="btn"
                          style={{ background: "#e0574f", borderColor: "#e0574f", color: "#fff", fontWeight: 600 }}
                          onClick={() => (confirmStep === 1 ? setConfirmStep(2) : void deleteForever())}
                        >
                          {confirmStep === 1 ? `Delete ${clearedCount} forever…` : "Yes — permanently delete"}
                        </button>
                      </div>
                    )}
                  </div>
                  <p className="hint">Permanently removes all nuked runs and their folder and file rows. This cannot be undone.</p>
                  {scanMsg && (
                    <p className="hint" style={{ color: scanMsg.ok ? "var(--mc-green)" : "#e0574f", marginTop: 8 }}>{scanMsg.text}</p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

// Hand-rolled OUTLINE theme glyphs (no @fluentui), 16px viewBox — same set as the TopBar seg.
function MonitorIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.8" y="2.5" width="12.4" height="8" rx="1.2" />
      <path d="M6 13.2h4M8 10.5v2.7" />
    </svg>
  );
}
function SunIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.4v1.6M8 13v1.6M14.6 8H13M3 8H1.4M12.7 3.3l-1.1 1.1M4.4 11.6l-1.1 1.1M12.7 12.7l-1.1-1.1M4.4 4.4 3.3 3.3" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M13.2 9.4A5.6 5.6 0 0 1 6.6 2.8a5.6 5.6 0 1 0 6.6 6.6Z" />
    </svg>
  );
}
function ScanIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 5.2V3.4A1.4 1.4 0 0 1 3.4 2h1.8M10.8 2h1.8A1.4 1.4 0 0 1 14 3.4v1.8M14 10.8v1.8a1.4 1.4 0 0 1-1.4 1.4h-1.8M5.2 14H3.4A1.4 1.4 0 0 1 2 12.6v-1.8" />
      <path d="M2 8h12" />
    </svg>
  );
}
function FolderIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.8 4.4c0-.7.5-1.3 1.3-1.3h2.7l1.4 1.6h5.7c.7 0 1.3.6 1.3 1.3v5.9c0 .7-.6 1.3-1.3 1.3H3.1c-.7 0-1.3-.6-1.3-1.3V4.4Z" />
    </svg>
  );
}
// Outline trash can — the delete-forever glyph. Rendered in red (#e0574f) by the button, never orange.
function TrashIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 4h11M6.2 4V2.9c0-.4.3-.7.7-.7h2.2c.4 0 .7.3.7.7V4M4 4l.6 8.4c0 .5.5.9 1 .9h4.8c.5 0 1-.4 1-.9L12 4" />
      <path d="M6.5 6.5v4.5M9.5 6.5v4.5" />
    </svg>
  );
}
