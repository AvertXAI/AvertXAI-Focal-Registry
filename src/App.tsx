/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// AvertXAI Focal Registry shell — top bar + flyout nav + view routing.
// Live surfaces: Home / Settings / Data Viewer, plus the generated module slots below.
import { useEffect, useState, type ComponentType } from "react";
import TopBar from "./components/TopBar";
import Flyout from "./components/Flyout";
import FirstRunWizard from "./components/FirstRunWizard";
import BootTerminal from "./components/BootTerminal";
import NotBuilt from "./components/NotBuilt";
import AppFooter from "./components/AppFooter";
import ScanModule from "./modules/scan/ScanModule";
import RenameModule from "./modules/rename/RenameModule";
import MigrateModule from "./modules/migrate/MigrateModule";
import TimeTrackerModule from "./modules/timetracker/TimeTrackerModule";
import AttentionToast from "./modules/timetracker/AttentionToast";
import type { ModuleRow } from "./shared/types";
import Home from "./views/Home";
import Settings, { warmToggleCache } from "./views/Settings";
import { Spark } from "./icons";
import DataViewerModule from "./modules/data-viewer/DataViewerModule";
import VaultModule from "./modules/vault/VaultModule";
import MindMergeModule from "./modules/mindmerge/MindMergeModule";
import ScoutViewerModule from "./modules/scout-viewer/ScoutViewerModule";
import MarketplaceModule from "./modules/marketplace/MarketplaceModule";
import EmployeesModule from "./modules/employees/EmployeesModule";
import { NAVIGATE_EVENT } from "./shared/navigate";
import { defaultSettings, type MindMergeSettings } from "./modules/mindmerge/config.manifest";
import { startDiagReporter, bumpRender } from "./diag";
import AppLoading from "./components/AppLoading";

// Core shell surfaces stay literal; module views are DB rows, so any slug is a valid View.
// `string & {}` keeps literal autocomplete without collapsing the union to plain string.
export type View = "home" | "settings" | "data-viewer" | (string & {});

// 3-state theme toggle (System = Hybrid navy default; Light/Dark = the annotated palettes).
export type ThemeMode = "system" | "light" | "dark";

// Shell sidebar drag-resize bounds. MAX = the historical fixed width — the user can drag SMALLER,
// never wider than today's rail; raise this one constant to allow more.
const FLYOUT_MAX_WIDTH = 300;
const FLYOUT_MIN_WIDTH = 200;
// A NEW organization starts at the NARROW end (Jason 08-01-2026): the rail opens at the minimum and
// the user drags it OUT toward 300, rather than opening wide and only ever dragging in. The range is
// unchanged — this switches which end is the default. Keep in sync with --mc-flyout-width in
// globals.css, which governs the very first paint before this state reaches the DOM.
const FLYOUT_DEFAULT_WIDTH = FLYOUT_MIN_WIDTH;
const clampFlyoutWidth = (px: number): number =>
  Math.min(FLYOUT_MAX_WIDTH, Math.max(FLYOUT_MIN_WIDTH, Math.round(px)));

// Labels for the core surfaces only — module labels come from their DB rows.
const LEAF: Record<string, string> = {
  home: "Home",
  settings: "Settings",
  "data-viewer": "Data Viewer",
};

// Root-side settings injection for the MindMerge ("Expose, Don't Connect", DECISIONS-37):
// root owns persistence, so it loads the module's namespaced app_settings and hands the module its
// settings + an onChange that writes back through the sanctioned settings path (which re-points the
// engine). Targeted to the mindmerge for now; a generic manifest-driven injector is a later refinement.
// Module-level so a re-entry mount renders the real watch path on the FIRST paint instead of
// flashing "No folder set" while the async settings.get round-trips. Warmed by the first load below.
let mindmergeSettingsCache: MindMergeSettings | null = null;

function MindMergeMount() {
  const [settings, setSettings] = useState<MindMergeSettings>(() => mindmergeSettingsCache ?? defaultSettings());
  useEffect(() => {
    void Promise.all([
      window.api.settings.get("mindmerge.watch_path"),
      window.api.settings.get("mindmerge.watch_enabled"),
      window.api.settings.get("mindmerge.rail_collapsed"),
      window.api.settings.get("mindmerge.font_size"),
    ]).then(([wp, we, rc, fs]) =>
      setSettings((s) => {
        const n = Number(fs);
        const next = {
          ...s,
          "mindmerge.watch_path": wp ?? s["mindmerge.watch_path"],
          "mindmerge.watch_enabled": we === null ? s["mindmerge.watch_enabled"] : we === "1",
          "mindmerge.rail_collapsed": rc === null ? s["mindmerge.rail_collapsed"] : rc === "1",
          // Number()-parse the persisted px; fall back to the default (13) on null/undefined/NaN.
          "mindmerge.font_size": fs == null || Number.isNaN(n) ? s["mindmerge.font_size"] : n,
        };
        mindmergeSettingsCache = next;
        return next;
      })
    );
  }, []);
  const onChange = (patch: Partial<MindMergeSettings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      mindmergeSettingsCache = next;
      return next;
    });
    for (const [k, v] of Object.entries(patch)) {
      void window.api.settings.set(k, typeof v === "boolean" ? (v ? "1" : "0") : String(v));
    }
  };
  return <MindMergeModule settings={settings} onChange={onChange} />;
}

// slug → renderer component. A DB row makes a module NAVIGABLE; an entry here makes it REAL.
// A row with no entry renders the not-built placeholder instead of a dead view.
const MODULE_COMPONENTS: Record<string, ComponentType> = {
  scan: ScanModule,
  rename: RenameModule,
  migrate: MigrateModule,
  timetracker: TimeTrackerModule,
  vault: VaultModule,
  "mindmerge": MindMergeMount,
  "scout-viewer": ScoutViewerModule,
  marketplace: MarketplaceModule,
  employees: EmployeesModule,
};

// Manual-check status toast. The update OFFER itself (available → download → install) lives in the
// dedicated Software Update window (main-side update-window.ts) — a separate BrowserWindow, because
// the app hides to tray where an in-app toast would never be seen. This toast only answers the
// Settings "Check for updates" button: checking / you're-on-latest / couldn't-check.
export type UpdateToastSignal =
  | { stage: "checking" }
  | { stage: "none"; version: string }
  | { stage: "error" }
  // Generic app notice (A2, 08-06) — the SAME toast, event and styling carry non-updater messages
  // (the seed's refusals and summaries) instead of a second mechanism growing beside this one.
  // ok-toned notices auto-dismiss like "you're on the latest"; err-toned ones stay until closed.
  // `ms` overrides the ok-tone auto-dismiss for the rare notice that has to outlive a glance. Scan
  // Notes' drive-connect summary is the case that introduced it: it reports how many folder renames
  // were applied and how many files were written, and six seconds is not long enough to read a
  // sentence you did not know was coming. Omitted = the standard 6000.
  | { stage: "notice"; text: string; tone: "ok" | "err"; ms?: number }
  // A QUESTION toast (08-06 profit build — "did you actually get paid?"). Same one mechanism,
  // extended: a title, a body, and buttons whose callbacks ride the same-window event detail.
  // Sticky until answered or dismissed — an unanswered question must not fade away.
  | { stage: "ask"; title: string; text: string; actions: Array<{ label: string; primary?: boolean; onClick: () => void }> };
export const UPDATE_TOAST_EVENT = "focal:update-toast";

// ---- THE FULL-WINDOW LOADING SCRIM (shell-lane, Jason 08-17-2026) ----------------------------
export const APP_LOADING_EVENT = "focal:app-loading";
/**
 * A scrim that outlives its operation locks the user out of their own application, so nothing is
 * allowed to hold one indefinitely. Callers lower it in a `finally`; this is the second, independent
 * guarantee for the case where the caller itself never returns.
 */
const LOADING_CEILING_MS = 30_000;

/** Raise the scrim with a caption; pass null to lower it. ALWAYS lower in a `finally`. */
export function signalAppLoading(caption: string | null): void {
  window.dispatchEvent(new CustomEvent<string | null>(APP_LOADING_EVENT, { detail: caption }));
}

/** Run something under the scrim. The `finally` is the point — an error must never strand a scrim. */
export async function withAppLoading<T>(caption: string, work: () => Promise<T>): Promise<T> {
  signalAppLoading(caption);
  try {
    return await work();
  } finally {
    signalAppLoading(null);
  }
}

/** Show a plain app message in the shell toast. Long refusal sentences belong here, not squeezed
    into a header strip where they truncate (the device-gate finding that created this). */
export function signalAppToast(text: string, tone: "ok" | "err", ms?: number): void {
  window.dispatchEvent(
    new CustomEvent<UpdateToastSignal | null>(UPDATE_TOAST_EVENT, { detail: { stage: "notice", text, tone, ms } })
  );
}

/** Ask a question through the SAME shell toast — buttons run their callback and dismiss. */
export function signalAppAsk(
  title: string,
  text: string,
  actions: Array<{ label: string; primary?: boolean; onClick: () => void }>
): void {
  window.dispatchEvent(
    new CustomEvent<UpdateToastSignal | null>(UPDATE_TOAST_EVENT, { detail: { stage: "ask", title, text, actions } })
  );
}
export function signalUpdateToast(detail: UpdateToastSignal | null): void {
  // null clears the toast — used when a manual check finds an update and the dedicated Software
  // Update window takes over (the "Checking…" line must not linger under it).
  window.dispatchEvent(new CustomEvent<UpdateToastSignal | null>(UPDATE_TOAST_EVENT, { detail }));
}

function AppLoadingHost() {
  const [caption, setCaption] = useState<string | null>(null);
  useEffect(() => {
    const on = (e: Event): void => setCaption((e as CustomEvent<string | null>).detail);
    window.addEventListener(APP_LOADING_EVENT, on);
    return () => window.removeEventListener(APP_LOADING_EVENT, on);
  }, []);
  // The ceiling. It lowers the scrim regardless of what the caller did or failed to do, and says so
  // in plain language rather than leaving the user wondering what they just watched disappear.
  useEffect(() => {
    if (caption === null) return;
    const t = setTimeout(() => {
      setCaption(null);
      signalAppToast("That is taking longer than expected — it may still be working in the background.", "err");
    }, LOADING_CEILING_MS);
    return () => clearTimeout(t);
  }, [caption]);
  return caption === null ? null : <AppLoading caption={caption} />;
}

function UpdateToast() {
  const [state, setState] = useState<UpdateToastSignal | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Manual states from the Settings button (the user asked — always answer, even after a dismiss).
    const onManual = (e: Event) => { setDismissed(false); setState((e as CustomEvent<UpdateToastSignal | null>).detail); };
    window.addEventListener(UPDATE_TOAST_EVENT, onManual);
    return () => window.removeEventListener(UPDATE_TOAST_EVENT, onManual);
  }, []);

  // "You're on the latest" and ok-notices leave on their own; errors stay until dismissed.
  useEffect(() => {
    if (!(state?.stage === "none" || (state?.stage === "notice" && state.tone === "ok"))) return;
    const t = setTimeout(() => setState(null), state.stage === "notice" && state.ms ? state.ms : 6000);
    return () => clearTimeout(t);
  }, [state]);

  if (!state || dismissed) return null;
  if (state.stage === "ask") {
    return (
      <div className="updatetoast ask" role="alertdialog" aria-label={state.title}>
        <div className="updatetoast-ask">
          <b>{state.title}</b>
          <span className="updatetoast-line">{state.text}</span>
          <div className="updatetoast-actions">
            {state.actions.map((a) => (
              <button key={a.label} className={"btn" + (a.primary ? " updatetoast-primary" : "")}
                onClick={() => { setState(null); a.onClick(); }}>
                {a.label}
              </button>
            ))}
          </div>
        </div>
        <button className="updatetoast-close" aria-label="Dismiss" onClick={() => setDismissed(true)}>×</button>
      </div>
    );
  }
  return (
    <div className="updatetoast" role="status">
      <span className="updatetoast-line">
        {state.stage === "checking" && "Checking for updates…"}
        {state.stage === "none" && `You're on the latest version (${state.version})`}
        {state.stage === "error" && "Couldn't check for updates. Check your connection."}
        {state.stage === "notice" && state.text}
      </span>
      <button className="updatetoast-close" aria-label="Dismiss" onClick={() => setDismissed(true)}>×</button>
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
  const [flyoutWidth, setFlyoutWidth] = useState(FLYOUT_DEFAULT_WIDTH);
  // Nav section expand/collapse — persisted app_settings 'nav_section_state' (JSON). Absent group = expanded.
  const [navSections, setNavSections] = useState<Record<string, "expanded" | "collapsed">>({});
  // Theme mode — persisted app_settings 'theme_mode'; applied as <html data-theme>. Seeded from
  // the ?theme= boot param (main resolved it pre-window) so the first render + first overlay flip
  // already match the persisted mode — without this seed, mount would clobber the pre-paint theme
  // back to hybrid until the settings fetch returned (the recon-3b flash). Default: system.
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const t = new URLSearchParams(window.location.search).get("theme");
    // An explicit "system" from main is honoured; only a MISSING param falls to the default, which
    // is light (Jason 08-01-2026) so a new organization's first paint is already light — matching
    // main's readBootTheme, or the window would flash hybrid for a frame.
    return t === "light" || t === "dark" || t === "system" ? t : "light";
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
    // Warm the Settings toggle cache at boot (fire-and-forget) — a renderer reload (Ctrl+R) wipes
    // the module-level cache, and warming it only on Settings mount meant the first visit after a
    // reload painted default knobs before flipping. Warm here = correct on frame one by nav time.
    void warmToggleCache().catch(() => {});
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
      if (fw) setFlyoutWidth(clampFlyoutWidth(parseInt(fw, 10) || FLYOUT_DEFAULT_WIDTH)); // clamped to [200, 300]
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
      // Skip Fast Boot: bypass the terminal, straight to shell. TWO sources on purpose — the URL
      // param (stamped at launch) decides whether a terminal EXISTS this page-load; the stored
      // setting decides the next launch. When the param skipped, NO terminal is mounted and nothing
      // else can end the boot, so that path must exit here even when the stored setting has since
      // been flipped off — otherwise a Ctrl+Shift+R after flipping the toggle blanks forever
      // (found on-device at the 08-14 mount gate).
      const skippedThisLoad = new URLSearchParams(window.location.search).get("skipBoot") === "1";
      if (skip === "1" || skippedThisLoad) setIsBooting(false);
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
    if (isBooting) window.shell?.bootStart?.();
    else window.shell?.bootDone?.();
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

  // Cross-module navigation. A module cannot reach `select` — it is mounted as <ActiveModule /> with
  // no props — so it asks through a window event, the same shape UPDATE_TOAST_EVENT already uses.
  // The intent it carries is read by the DESTINATION on mount (src/shared/navigate.ts).
  useEffect(() => {
    const onNavigate = (e: Event) => select((e as CustomEvent<string>).detail as View);
    window.addEventListener(NAVIGATE_EVENT, onNavigate);
    return () => window.removeEventListener(NAVIGATE_EVENT, onNavigate);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
  // Skip Fast Boot (from ?skipBoot=, known before first paint): render a themed BLANK during boot
  // instead of the dark JARVIS terminal — the module list still loads underneath and the shell appears
  // with no dark-blue flash. Without this the terminal renders for a frame before the async skip read.
  if (isBooting) {
    if (new URLSearchParams(window.location.search).get("skipBoot") === "1") return null;
    return (
      <BootTerminal
        modules={modules}
        orgName={orgName}
        error={bootError}
        onComplete={() => setIsBooting(false)}
        onFail={() => setIsBooting(false)} // Safe Mode: land in the chrome (banner below), modules empty
      />
    );
  }

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
      {/* Mounted at the shell root so the scrim covers the rail and the topbar too — a spinner that
          stops at the edge of a pane does not answer "is this application alive". */}
      <AppLoadingHost />
      {/* Break/idle prompts must outlive the TimeTracker module's mount — App-level, like UpdateToast. */}
      <AttentionToast />

      {view === "home" && <Home onNavigate={select} modules={activeModules} />}
      {view === "settings" && <Settings themeMode={themeMode} onThemeChange={onThemeChange} />}
      {view === "data-viewer" && <DataViewerModule />}
      {ActiveModule && <ActiveModule />}
      {!ActiveModule && activeRow && <NotBuilt name={activeRow.name} />}

      {/* Standing AvertXAI footer — one instance, below the module content on every page (root-lane). */}
      <AppFooter />

      {/* AI spark — present in v7 chrome; not-built stub (wiring is a later phase). */}
      <button className="spark nb" aria-label="AI assistant">
        <Spark size={22} />
      </button>
    </>
  );
}
