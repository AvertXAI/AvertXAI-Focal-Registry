/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// AvertXAI Focal Registry shell — top bar + flyout nav + view routing.
// Live surfaces: Home / Settings / Data Viewer, plus the generated module slots below.
import { useEffect, useState, type ComponentType } from "react";
import TopBar from "./components/TopBar";
import Flyout from "./components/Flyout";
import FirstRunWizard from "./components/FirstRunWizard";
import BootTerminal from "./components/BootTerminal";
import NotBuilt from "./components/NotBuilt";
import ScanModule from "./modules/scan/ScanModule";
import type { ModuleRow, UpdateAvailableInfo, UpdateProgressInfo } from "./shared/types";
import Home from "./views/Home";
import Settings from "./views/Settings";
import { Spark } from "./icons";
import DataViewerModule from "./modules/data-viewer/DataViewerModule";
import VaultModule from "./modules/vault/VaultModule";
import RunbookShredderModule from "./modules/runbook-shredder/RunbookShredderModule";
import ScoutViewerModule from "./modules/scout-viewer/ScoutViewerModule";
import { defaultSettings, type ShredderSettings } from "./modules/runbook-shredder/config.manifest";
import { startDiagReporter, bumpRender } from "./diag";

// Core shell surfaces stay literal; module views are DB rows, so any slug is a valid View.
// `string & {}` keeps literal autocomplete without collapsing the union to plain string.
export type View = "home" | "settings" | "data-viewer" | (string & {});

// 3-state theme toggle (System = Hybrid navy default; Light/Dark = the annotated palettes).
export type ThemeMode = "system" | "light" | "dark";

// Shell sidebar drag-resize bounds. MAX = the historical fixed width — the user can drag SMALLER,
// never wider than today's rail; raise this one constant to allow more.
const FLYOUT_MAX_WIDTH = 300;
const FLYOUT_MIN_WIDTH = 200;
const clampFlyoutWidth = (px: number): number =>
  Math.min(FLYOUT_MAX_WIDTH, Math.max(FLYOUT_MIN_WIDTH, Math.round(px)));

// Labels for the core surfaces only — module labels come from their DB rows.
const LEAF: Record<string, string> = {
  home: "Home",
  settings: "Settings",
  "data-viewer": "Data Viewer",
};

// Root-side settings injection for the Runbook Shredder ("Expose, Don't Connect", DECISIONS-37):
// root owns persistence, so it loads the module's namespaced app_settings and hands the module its
// settings + an onChange that writes back through the sanctioned settings path (which re-points the
// engine). Targeted to the shredder for now; a generic manifest-driven injector is a later refinement.
function RunbookShredderMount() {
  const [settings, setSettings] = useState<ShredderSettings>(defaultSettings);
  useEffect(() => {
    void Promise.all([
      window.api.settings.get("runbook-shredder.watch_path"),
      window.api.settings.get("runbook-shredder.watch_enabled"),
      window.api.settings.get("runbook-shredder.rail_collapsed"),
      window.api.settings.get("runbook-shredder.font_size"),
    ]).then(([wp, we, rc, fs]) =>
      setSettings((s) => {
        const n = Number(fs);
        return {
          ...s,
          "runbook-shredder.watch_path": wp ?? s["runbook-shredder.watch_path"],
          "runbook-shredder.watch_enabled": we === null ? s["runbook-shredder.watch_enabled"] : we === "1",
          "runbook-shredder.rail_collapsed": rc === null ? s["runbook-shredder.rail_collapsed"] : rc === "1",
          // Number()-parse the persisted px; fall back to the default (13) on null/undefined/NaN.
          "runbook-shredder.font_size": fs == null || Number.isNaN(n) ? s["runbook-shredder.font_size"] : n,
        };
      })
    );
  }, []);
  const onChange = (patch: Partial<ShredderSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    for (const [k, v] of Object.entries(patch)) {
      void window.api.settings.set(k, typeof v === "boolean" ? (v ? "1" : "0") : String(v));
    }
  };
  return <RunbookShredderModule settings={settings} onChange={onChange} />;
}

// slug → renderer component. A DB row makes a module NAVIGABLE; an entry here makes it REAL.
// A row with no entry renders the not-built placeholder instead of a dead view.
const MODULE_COMPONENTS: Record<string, ComponentType> = {
  scan: ScanModule,
  rename: NotBuilt, // seeded, not built — plain not-built page (§3.6)
  vault: VaultModule,
  "runbook-shredder": RunbookShredderMount,
  "scout-viewer": ScoutViewerModule,
};

// Auto-update notice (§3.12) — non-blocking toast, never modal. Subscribes to the whitelisted
// updater pushes for the automatic flow (Download → percent → Restart), and to a window-level
// CustomEvent so the Settings "Check for updates" button can drive the manual states
// (checking / latest-version / failed) without prop-drilling through the shell.
export type UpdateToastSignal = { stage: "checking" } | { stage: "none"; version: string } | { stage: "error" };
export const UPDATE_TOAST_EVENT = "focal:update-toast";
export function signalUpdateToast(detail: UpdateToastSignal): void {
  window.dispatchEvent(new CustomEvent<UpdateToastSignal>(UPDATE_TOAST_EVENT, { detail }));
}

type UpdateToastState =
  | UpdateToastSignal
  | { stage: "available"; version: string }
  | { stage: "downloading"; percent: number }
  | { stage: "ready" };

function UpdateToast() {
  const [state, setState] = useState<UpdateToastState | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const onAvailable = (p: UpdateAvailableInfo) => {
      setDismissed(false); // a new version un-dismisses — one nudge per update, still closable
      setState({ stage: "available", version: p.version });
    };
    const onProgress = (p: UpdateProgressInfo) => setState({ stage: "downloading", percent: p.percent });
    const onDownloaded = () => setState({ stage: "ready" });
    const onManual = (e: Event) => {
      setDismissed(false); // the user asked — always answer, even if a prior toast was dismissed
      setState((e as CustomEvent<UpdateToastSignal>).detail);
    };
    window.api.on("updater:available", onAvailable);
    window.api.on("updater:progress", onProgress);
    window.api.on("updater:downloaded", onDownloaded);
    window.addEventListener(UPDATE_TOAST_EVENT, onManual);
    return () => {
      window.api.off("updater:available", onAvailable);
      window.api.off("updater:progress", onProgress);
      window.api.off("updater:downloaded", onDownloaded);
      window.removeEventListener(UPDATE_TOAST_EVENT, onManual);
    };
  }, []);

  // "You're on the latest version" answers and leaves — ~4s, no interaction needed.
  useEffect(() => {
    if (state?.stage !== "none") return;
    const t = setTimeout(() => setState(null), 4000);
    return () => clearTimeout(t);
  }, [state]);

  if (!state || dismissed) return null;
  const startDownload = () => {
    setState({ stage: "downloading", percent: 0 });
    void window.api.updater.download().catch(() => {}); // errors stay silent (main logs them)
  };
  return (
    <div className="updatetoast" role="status">
      {state.stage === "checking" && <span>Checking for updates…</span>}
      {state.stage === "none" && <span>You&apos;re on the latest version ({state.version})</span>}
      {state.stage === "error" && <span>Couldn&apos;t check for updates. Check your connection.</span>}
      {state.stage === "available" && (
        <>
          <span className="updatetoast-click" onClick={startDownload}>
            Version {state.version} is available
          </span>
          <button className="btn" onClick={startDownload}>
            Download
          </button>
        </>
      )}
      {state.stage === "downloading" && <span>Downloading update… {state.percent}%</span>}
      {state.stage === "ready" && (
        <>
          <span>Update downloaded — restart to install</span>
          <button className="btn" onClick={() => void window.api.updater.install()}>
            Restart
          </button>
        </>
      )}
      <button className="updatetoast-close" aria-label="Dismiss" onClick={() => setDismissed(true)}>
        ×
      </button>
    </div>
  );
}

export default function App() {
  bumpRender("shell"); // DIAG-2: count shell re-renders (should stay ~0 per tick)
  const [view, setView] = useState<View>("home");
  // First-run gate: null = flag not loaded yet, true = show the wizard, false = normal shell.
  const [isFirstRun, setIsFirstRun] = useState<boolean | null>(null);
  // Config-as-Data module rows (drive nav + routing), boot failure, and the terminal mask.
  const [modules, setModules] = useState<ModuleRow[] | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [isBooting, setIsBooting] = useState(true);
  // Sidebar collapse — persisted in app_settings (key 'rail_collapsed'), NOT localStorage (canon).
  const [railCollapsed, setRailCollapsed] = useState(false);
  // Sidebar width — persisted app_settings 'flyout_width'; live while dragging, written on drag-end.
  const [flyoutWidth, setFlyoutWidth] = useState(FLYOUT_MAX_WIDTH);
  // Nav section expand/collapse — persisted app_settings 'nav_section_state' (JSON). Absent group = expanded.
  const [navSections, setNavSections] = useState<Record<string, "expanded" | "collapsed">>({});
  // Theme mode — persisted app_settings 'theme_mode'; applied as <html data-theme>. Seeded from
  // the ?theme= boot param (main resolved it pre-window) so the first render + first overlay flip
  // already match the persisted mode — without this seed, mount would clobber the pre-paint theme
  // back to hybrid until the settings fetch returned (the recon-3b flash). Default: system.
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const t = new URLSearchParams(window.location.search).get("theme");
    return t === "light" || t === "dark" ? t : "system";
  });
  // Org display name — app_settings 'org_name' (Config-as-Data); drives the TopBar brand and the
  // boot terminal's lead line. null = not yet resolved (the terminal gates on this); the 'AvertXAI'
  // fallback is applied AT resolution so consumers never see a blank name.
  const [orgName, setOrgName] = useState<string | null>(null);

  // getFirstRunStatus() returns true when setup is COMPLETE — invert into "needs wizard".
  useEffect(() => {
    window.api
      .getFirstRunStatus()
      .then((done) => setIsFirstRun(!done))
      .catch(() => setIsFirstRun(false)); // ponytail: flag unreadable → fall through to the shell
  }, []);

  // Config-as-Data fetch — runs at boot and again from the Safe Mode "Retry Connection" button.
  // bootError resets first so a retry gets a clean read instead of replaying the stale failure.
  const fetchModules = async () => {
    setBootError(null);
    try {
      const [rows, skip, themeM, org, railC, lastMod, fw, nss] = await Promise.all([
        window.api.getModules(),
        window.api.settings.get("skip_fast_boot"),
        window.api.settings.get("theme_mode"),
        window.api.settings.get("org_name"),
        window.api.settings.get("rail_collapsed"),
        window.api.settings.get("last_active_module"),
        window.api.settings.get("flyout_width"),
        window.api.settings.get("nav_section_state"),
      ]);
      setModules(rows);
      if (themeM === "light" || themeM === "dark") setThemeMode(themeM); // else system (default)
      setOrgName(org || "AvertXAI"); // resolved — fallback applied here, never a blank name
      setRailCollapsed(railC === "1"); // restore the persisted sidebar collapse state
      if (fw) setFlyoutWidth(clampFlyoutWidth(parseInt(fw, 10) || FLYOUT_MAX_WIDTH)); // clamped ≤ MAX
      if (nss) {
        try {
          setNavSections(JSON.parse(nss)); // restore per-section collapse; corrupt → all default expanded
        } catch {
          /* malformed JSON — leave {} so every section defaults to expanded */
        }
      }
      // Boot routing: reopen the last screen if it's still a valid core view or an enabled module.
      if (lastMod && (LEAF[lastMod] || rows.some((m) => m.slug === lastMod && m.is_enabled === 1))) {
        setView(lastMod);
      }
      if (skip === "1") setIsBooting(false); // Skip Fast Boot: bypass the terminal, straight to shell
    } catch (err) {
      setBootError(err instanceof Error ? err.message : String(err));
    }
  };

  // Once setup is settled — normal boot OR just-finished wizard — pull the module registry.
  useEffect(() => {
    if (isFirstRun === false) void fetchModules();
  }, [isFirstRun]);

  // Not-built (.nb) controls: clicks are swallowed and nothing else happens — no orange glow in
  // this product (§3.6). Capture-phase so it runs before React's routed handlers; non-.nb clicks
  // pass through untouched.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.(".nb") as HTMLElement | null;
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // DIAG-1: start the dev-gated render reporter once (no-op unless DIAG=1).
  useEffect(() => { startDiagReporter(); }, []);

  // Reflect sidebar collapse on <body> so the fixed rail's padding-left compensation follows it.
  useEffect(() => {
    document.body.classList.toggle("rail-collapsed", railCollapsed);
  }, [railCollapsed]);

  // Sidebar width: ONE custom property drives both .flyout{width} and body{padding-left}, so the
  // rail and the content offset can never disagree. Collapsed rules (58px) still override it.
  useEffect(() => {
    document.body.style.setProperty("--mc-flyout-width", `${flyoutWidth}px`);
  }, [flyoutWidth]);

  // Apply the theme as <html data-theme> — 'system' clears it (falls back to :root Hybrid navy).
  useEffect(() => {
    document.documentElement.dataset.theme = themeMode === "system" ? "" : themeMode;
  }, [themeMode]);

  // Native min/max/close overlay: born in the persisted theme (main.ts reads it pre-window).
  // UN-GATED (recon 3c): fires as soon as the theme is known — themeMode is seeded from the boot
  // param, so even the mount-time call matches the window's creation colors. Safe Mode / a long
  // boot terminal can no longer hold a stale overlay; runtime theme switches re-fire it.
  useEffect(() => {
    void window.api.theme.applyOverlay(themeMode);
  }, [themeMode]);

  // ONE constant that dims the native min/max/close buttons for EVERY modal. Those buttons are
  // OS-drawn ABOVE all web content, so no DOM backdrop can cover them (§3.3/§3.4) — they must be
  // dimmed via the overlay funnel while a modal is open. This used to be left to each modal to call
  // and so kept regressing; instead a single body observer toggles the dim whenever ANY modal
  // backdrop is in the DOM. New modals need only use the shell's .overlay class (or opt in with
  // data-modal-backdrop) — no per-modal wiring to forget.
  useEffect(() => {
    const SELECTOR = ".overlay, .scan-modal-back, [data-modal-backdrop]";
    let dimmed = false;
    const sync = (): void => {
      const open = document.querySelector(SELECTOR) !== null;
      if (open === dimmed) return; // only cross the IPC when the state actually flips
      dimmed = open;
      void window.api.theme.setModalDim(open);
    };
    const obs = new MutationObserver(sync);
    obs.observe(document.body, { childList: true, subtree: true });
    sync();
    return () => { obs.disconnect(); if (dimmed) void window.api.theme.setModalDim(false); };
  }, []);

  // Boot edges → main (boot-dark frame + resize lock). ONE effect covers every flip: skip-fast-boot,
  // terminal complete/fail, AND Safe-Mode Retry re-entering boot. Optional-chained: harmless if the
  // bridge is absent (e.g. web preview).
  useEffect(() => {
    if (isBooting) window.runbooks?.bootStart?.();
    else window.runbooks?.bootDone?.();
  }, [isBooting]);

  // Theme toggle — set + persist through the settings IPC bridge (DB app_settings, never localStorage).
  const onThemeChange = (mode: ThemeMode) => {
    setThemeMode(mode);
    void window.api.settings.set("theme_mode", mode);
  };

  // Drag-resize: live width while dragging; persist once on drag-end (same bridge as rail_collapsed).
  const onFlyoutResize = (px: number) => setFlyoutWidth(clampFlyoutWidth(px));
  const onFlyoutResizeEnd = (px: number) => {
    const w = clampFlyoutWidth(px);
    setFlyoutWidth(w);
    void window.api.settings.set("flyout_width", String(w));
  };

  // Toggle + persist through the settings IPC bridge (DB app_settings, never localStorage).
  const toggleRail = () => {
    setRailCollapsed((c) => {
      const next = !c;
      void window.api.settings.set("rail_collapsed", next ? "1" : "0");
      return next;
    });
  };

  const select = (v: View) => {
    setView(v);
    window.scrollTo(0, 0);
    void window.api.settings.set("last_active_module", v); // boot restores the last screen
  };

  // Section expand/collapse — flip one group, persist the whole map as JSON via the settings path
  // (app_settings, never localStorage). An absent group is expanded, so the first click collapses it.
  const toggleNavSection = (group: string) => {
    setNavSections((prev) => {
      const next: Record<string, "expanded" | "collapsed"> = {
        ...prev,
        [group]: prev[group] === "collapsed" ? "expanded" : "collapsed",
      };
      void window.api.settings.set("nav_section_state", JSON.stringify(next));
      return next;
    });
  };

  // Boot intercept — before any shell chrome. Blank while the flag loads (body bg matches --mc-base,
  // so no flash), then wizard until setup completes, then the terminal mask over the shell mount.
  if (isFirstRun === null) return null;
  if (isFirstRun) return <FirstRunWizard onComplete={() => setIsFirstRun(false)} />;
  if (isBooting)
    return (
      <BootTerminal
        modules={modules}
        orgName={orgName}
        error={bootError}
        onComplete={() => setIsBooting(false)}
        onFail={() => setIsBooting(false)} // Safe Mode: land in the chrome (banner below), modules empty
      />
    );

  // Safe Mode never dereferences a failed/absent module list.
  const activeModules = bootError ? [] : (modules ?? []);
  const activeRow = activeModules.find((m) => m.slug === view);
  const ActiveModule = MODULE_COMPONENTS[view];
  const leaf = LEAF[view] ?? activeRow?.name ?? view;

  return (
    <>
      <TopBar leaf={leaf} orgName={orgName ?? "AvertXAI"} onOpenDataViewer={() => select("data-viewer")} themeMode={themeMode} onThemeChange={onThemeChange} />
      {bootError && (
        <div className="safemode" role="alert">
          <span>Safe Mode: Database connection failed. Modules unavailable.</span>
          <button
            className="btn"
            onClick={() => {
              setIsBooting(true); // re-mount the terminal for the retry pass
              void fetchModules(); // clears bootError, then re-reads the registry
            }}
          >
            Retry Connection
          </button>
        </div>
      )}
      <Flyout view={view} modules={activeModules} onSelect={select} collapsed={railCollapsed} onToggle={toggleRail} onResize={onFlyoutResize} onResizeEnd={onFlyoutResizeEnd} sections={navSections} onToggleSection={toggleNavSection} />
      <UpdateToast />

      {view === "home" && <Home onNavigate={select} modules={activeModules} />}
      {view === "settings" && <Settings themeMode={themeMode} onThemeChange={onThemeChange} />}
      {view === "data-viewer" && <DataViewerModule />}
      {ActiveModule && <ActiveModule />}
      {!ActiveModule && activeRow && <NotBuilt name={activeRow.name} />}

      {/* AI spark — present in v7 chrome; not-built stub (wiring is a later phase). */}
      <button className="spark nb" aria-label="AI assistant">
        <Spark size={22} />
      </button>
    </>
  );
}
