/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Settings — 2-pane (left nav list / right content pane). Live sections: General (Skip Fast Boot) and
// Appearance (3-state theme toggle). The theme STATE + persistence live in App ("Expose, Don't
// Connect"); this pane only renders the control. "Coming surfaces" stay .nb.
import { useEffect, useState } from "react";
import { Book, DoorBrand, DoorRoles, DoorTheme, DoorTiers, Gear, Mail, People, Vault, Webhook } from "../icons";
import { bumpRender } from "../diag";
import { signalUpdateToast, type ThemeMode } from "../App";

interface Props {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

export default function Settings({ themeMode, onThemeChange }: Props) {
  bumpRender("settings"); // DIAG-2
  const [skipBoot, setSkipBoot] = useState(false);
  const [activeSection, setActiveSection] = useState("General");
  const [appVersion, setAppVersion] = useState("");
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    void window.api.settings.get("skip_fast_boot").then((v) => setSkipBoot(v === "1"));
    void window.api.updater.version().then(setAppVersion).catch(() => {}); // never hardcoded
  }, []);

  // Manual check — unlike the silent automatic cycle, the user asked, so every outcome toasts:
  // checking → latest-version / available (pushed from main) / couldn't-check.
  const checkForUpdates = async () => {
    setChecking(true);
    signalUpdateToast({ stage: "checking" });
    try {
      const r = await window.api.updater.check();
      if (r.status === "none") signalUpdateToast({ stage: "none", version: r.version ?? appVersion });
      else if (r.status === "error") signalUpdateToast({ stage: "error" });
      // "available": the main-process updater:available push already drove the toast
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
            <div className="setsec">Access</div>
            <button className="navitem nb">
              <People />
              Members and roles
            </button>
            <div className="setsec">Modules</div>
            <button className="navitem nb">
              <Book />
              AvertXAI Focal Registry
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
                  Mapped but not built — reserved studs on the baseplate. Each glows orange until wired.
                </p>
                <div className="door nb">
                  <div className="di">
                    <DoorRoles />
                  </div>
                  <div>
                    <div className="dt">Accounts &amp; Roles (RBAC)</div>
                    <div className="dd">
                      Create/edit/delete roles — AvertXAI admin, business admin, HR, employee — each with scoped access.
                      Owner-only today.
                    </div>
                  </div>
                  <span className="dtag">Not built</span>
                </div>
                <div className="door nb">
                  <div className="di">
                    <DoorTiers />
                  </div>
                  <div>
                    <div className="dt">Tiers &amp; Editions</div>
                    <div className="dd">
                      Free · Pro · Max (individual) — Business · Enterprise (org). Feature flags gate what each build
                      includes.
                    </div>
                  </div>
                  <span className="dtag">Not built</span>
                </div>
                <div className="door nb">
                  <div className="di">
                    <DoorBrand />
                  </div>
                  <div>
                    <div className="dt">Branding / White-label</div>
                    <div className="dd">Logo, name, palette per org — hand each client their own-branded instance.</div>
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
