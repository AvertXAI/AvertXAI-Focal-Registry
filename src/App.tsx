/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// AvertXAI Focal Registry shell — top bar + flyout nav + view routing.
// Live surfaces: Home / Settings / Data Viewer, plus the generated module slots below.
import { useEffect, useRef, useState, type ComponentType } from "react";
import TopBar from "./components/TopBar";
import GlobalSearch from "./components/GlobalSearch";
import Flyout from "./components/Flyout";
import FirstRunWizard from "./components/FirstRunWizard";
import VaultSetupWizard from "./components/VaultSetupWizard";
import BootTerminal from "./components/BootTerminal";
import NotBuilt from "./components/NotBuilt";
import AppFooter from "./components/AppFooter";
import SettingsModal from "./components/SettingsModal";
import ReportProblem from "./components/ReportProblem";
import SuggestSomething from "./components/SuggestSomething";
import AboutDialog from "./components/AboutDialog";
import CrashDialog from "./components/CrashDialog";

/** See the crash-net effect below. False = errors log to the console and no prompt ever shows. */
export const CRASH_DIALOG_VISIBLE = false;
import ScanModule from "./modules/scan/ScanModule";
import RenameModule from "./modules/rename/RenameModule";
import MigrateModule from "./modules/migrate/MigrateModule";
import TimeTrackerModule from "./modules/timetracker/TimeTrackerModule";
import AttentionToast from "./modules/timetracker/AttentionToast";
import type { FeedbackBegin, ModuleRow } from "./shared/types";
import Home from "./views/Home";
import { warmToggleCache } from "./views/Settings";
import { Spark } from "./icons";
import DataViewerModule from "./modules/data-viewer/DataViewerModule";
import VaultModule from "./modules/vault/VaultModule";
import MindMergeModule, { requestMindMergeOpen } from "./modules/mindmerge/MindMergeModule";
import ScoutViewerModule from "./modules/scout-viewer/ScoutViewerModule";
import MarketplaceModule from "./modules/marketplace/MarketplaceModule";
import EmployeesModule from "./modules/employees/EmployeesModule";
import { NAVIGATE_EVENT } from "./shared/navigate";
import { entitlementsReady, moduleHidden, useEntitlements } from "./entitlements";
import { defaultSettings, type MindMergeSettings } from "./modules/mindmerge/config.manifest";
import { startDiagReporter, bumpRender } from "./diag";
import AppLoading from "./components/AppLoading";

// Core shell surfaces stay literal; module views are DB rows, so any slug is a valid View.
// `string & {}` keeps literal autocomplete without collapsing the union to plain string.
export type View = "home" | "settings" | "data-viewer" | (string & {});

// 3-state theme toggle (System = Hybrid navy default; Light/Dark = the annotated palettes).
export type ThemeMode = "system" | "light" | "dark";

// Retired 08-19: the nav panel is a FIXED --mc-flyout-width (212px, re-valued in shell.css).
// hidden / peek / docked replaced expanded <-> 58px-icons <-> drag-resize. `flyout_width` stays on
// the RENDERER_KEYS whitelist (harmless, no whitelist diff) and is simply no longer read.
// Below 900px the dock auto-releases; rail_collapsed is NOT rewritten by the auto-release, so the
// dock returns when the window widens back out.
const NAV_DOCK_MIN_WIDTH = 900;

// Labels for the core surfaces only — module labels come from their DB rows.
/* The Secured Vault's slug, seeded at electron/core/services/firstrun/index.ts:71. The boot hold
   matches on THIS, never on a position in the boot script — that script is ordered by the database
   column `display_order`, and its real order has already surprised once. */
const VAULT_SLUG = "vault";

const LEAF: Record<string, string> = {
  home: "Home",
  // `settings` REMOVED 08-19-2026. Settings is a pure OVERLAY now — `view` never becomes "settings",
  // so nothing renders it. Leaving the entry here let the boot-routing guard below (the LEAF[lastMod]
  // branch) restore a stored last_active_module of "settings" into a view with no renderer: working
  // chrome, empty content area, no error. Removing it makes that guard reject the stale value and
  // fall through to the default view.
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
/**
 * Turns a bundle URL into something a person can read.
 *
 * The crash prompt says "The app hit an error in <where>". `<where>` has to be a place the user
 * recognises — "Scan", "the Secured Vault" — never a chunk filename. When the path carries no module
 * name the honest answer is "this screen"; guessing a module wrong is worse than not naming one.
 */
function shortWhere(url: string): string {
  const m = /\/modules\/([a-z-]+)\//.exec(url) ?? /([A-Za-z-]+)Module/.exec(url);
  if (!m) return "this screen";
  const slug = m[1].toLowerCase();
  const NAMES: Record<string, string> = {
    scan: "Scan", rename: "Rename", migrate: "Migrate", employees: "Employees",
    timetracker: "TimeTracker", mindmerge: "MindMerge", "scout-viewer": "Scout Viewer",
    vault: "the Secured Vault", "data-viewer": "the Data Viewer",
  };
  return NAMES[slug] ?? "this screen";
}

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
  /** Does the vault still hold the password the app itself seeded? Resolved in the SAME Promise.all
      as the module rows, which is what closes the race: the boot script cannot type past the vault
      line before this lands, because the existing orgName gate already holds it until that Promise
      settles. Resolving it later would mean sometimes missing the line entirely. */
  const [vaultSetupNeeded, setVaultSetupNeeded] = useState(false);
  /** Separate from the flag above ON PURPOSE. `vaultSetupNeeded` is known as soon as the vault
      answers — near-instantly — but the wizard must not appear until the boot script has typed its
      way down to the vault line and stopped there. The terminal says when that happened; rendering
      off the answer instead of off the event buries the whole boot behind a modal. */
  const [vaultWizardOpen, setVaultWizardOpen] = useState(false);
  // Nav dock — persisted app_settings 'rail_collapsed', RE-MEANT: "1" = docked, "0" = hidden.
  // Reused rather than replaced so an existing install reads straight across (Jason 08-19).
  const [navDocked, setNavDocked] = useState(false);
  // Transient hover peek — never persisted. Owned here so the dock button, the edge gutter and the
  // panel itself all share ONE flag instead of three that can disagree.
  const [navPeek, setNavPeek] = useState(false);
  // Settings is a PURE OVERLAY: it is not a View, so `view` never becomes "settings" and the
  // arrows and last_active_module never see it.
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Feedback surfaces — all PURE OVERLAYS, same contract as Settings: `view` is untouched, so
  // closing any of them returns the user exactly where they were.
  // `reportOpen` carries the reference and screenshot when the crash prompt handed off, and is
  // `true` when the Help menu opened it cold (that path begins its own capture).
  const [reportOpen, setReportOpen] = useState<true | FeedbackBegin | null>(null);
  // Global search - the top-rail magnifier (BL-58 v4). Pure overlay, Ctrl+K opens it.
  const [gsOpen, setGsOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  // The crash prompt. Null until something actually breaks — this is the only feedback surface a
  // user ever sees without going looking for it.
  const [crash, setCrash] = useState<{ where: string; begun: FeedbackBegin } | null>(null);
  // Narrow-window auto-release (see NAV_DOCK_MIN_WIDTH).
  const [tooNarrowToDock, setTooNarrowToDock] = useState(false);
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
      const [rows, skip, themeM, org, railC, lastMod, nss, vaultNeedsSetup] = await Promise.all([
        window.api.getModules(),
        window.api.settings.get("skip_fast_boot"),
        window.api.settings.get("theme_mode"),
        window.api.settings.get("org_name"),
        window.api.settings.get("rail_collapsed"),
        window.api.settings.get("last_active_module"),
        window.api.settings.get("nav_section_state"),
        // .catch, NOT part of the rejection: a vault that cannot answer must not take the whole
        // Config-as-Data read down with it and drop the shell into Safe Mode. Unanswerable reads
        // as "no setup needed", which is exactly how the app behaved before this existed.
        window.api.vault.setupRequired().catch(() => false),
        // Entitlements ride the SAME boot read (never rejects; fail = every grant false), so the
        // boot-routing guard below and the first shell paint both see the resolved grant set —
        // a hidden module can neither be booted into nor flicker in the nav (SOP §2 three-state).
        entitlementsReady(),
      ]);
      setModules(rows);
      // Gated on the ROW as well as the check — a slug the boot script never prints could never be
      // held on, and the wizard would flash over a boot that had already finished.
      setVaultSetupNeeded(vaultNeedsSetup === true && rows.some((m) => m.slug === VAULT_SLUG && m.is_enabled === 1));
      if (themeM === "light" || themeM === "dark") setThemeMode(themeM); // else system (default)
      setOrgName(org || "AvertXAI"); // resolved — fallback applied here, never a blank name
      setNavDocked(railC === "1"); // "1" = docked (re-meant 08-19)
      if (nss) {
        try {
          setNavSections(JSON.parse(nss)); // restore per-section collapse; corrupt → all default expanded
        } catch {
          /* malformed JSON — leave {} so every section defaults to expanded */
        }
      }
      // Boot routing: reopen the last screen if it's still a valid core view or an enabled module.
      // An entitlement-HIDDEN slug is rejected exactly like a disabled row (entitlementsReady()
      // resolved in the Promise.all above), so a stored last_active_module of "employees" on a
      // Free/Pro install falls through to the default view instead of booting into a hidden module.
      if (lastMod && (LEAF[lastMod] || (rows.some((m) => m.slug === lastMod && m.is_enabled === 1) && !moduleHidden(lastMod)))) {
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

  // --mc-topbar-height is measured by TopBar itself now, off a callback ref. It used to be this
  // component's job via `document.querySelector(".topbar")` in an effect — and that effect NEVER
  // ONCE ATTACHED. The boot branch above returns <BootTerminal> for the whole shell, TopBar
  // included, so at the moment the effect ran the header did not exist, `if (!el) return` fired,
  // and nothing re-ran it. The token sat on its 58px seed forever. That hid as a 1px gap while the
  // real header was 57; at 45 it became a visible 13px band under the top bar. A callback ref
  // cannot miss the mount, whatever gates the render.

  /**
   * Scout Viewer's guest is a native WebContentsView that paints above all web content, so shell
   * chrome cannot be z-indexed over it — it has to be told to stand down.
   *
   * TWO CASES, and only two. A PEEKING nav panel floats over the module and reflows nothing, so the
   * guest kept covering it. The Settings modal is the same story. A DOCKED panel is deliberately
   * absent: docking reflows the layout, which resizes Scout's viewport hole, which fires the
   * module's own ResizeObserver and moves the guest out of the way — no help needed.
   *
   * Sent unconditionally rather than only on the Scout view: main no-ops when no guest exists, and
   * a conditional here would need this component to track which module owns a native view.
   */
  useEffect(() => {
    // The feedback overlays join this list for the same reason Settings is on it: they float over
    // the module and reflow nothing, so without this the Scout guest view paints straight over the
    // top of them. A crash dialog hidden behind a native browser view is the worst possible one.
    const anyFeedback = reportOpen !== null || suggestOpen || aboutOpen || crash !== null || gsOpen;
    window.api.scout.setShellOverlay(settingsOpen || anyFeedback || (navPeek && !navDocked));
  }, [settingsOpen, reportOpen, suggestOpen, aboutOpen, crash, navPeek, navDocked]);

  // Ctrl+K opens the global search anywhere in the shell (the sheet's own Escape closes it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setGsOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /**
   * THE CRASH NET. Before this the application had none: no window.onerror, no unhandledrejection
   * listener, and exactly one React error boundary — inside the Vault. Every crash any user has ever
   * had went to a console nobody reads and vanished.
   *
   * One prompt at a time. A failure cascade fires these listeners repeatedly, and stacking dialogs on
   * a person whose app just broke is its own insult; the first one wins and the rest are swallowed.
   */
  useEffect(() => {
    // HIDDEN, NOT REMOVED (Jason 08-24-2026): "the crash dialog, hide it, and wait till we need it."
    // With the net disarmed a renderer error goes back to the console, exactly as before the
    // feature existed. The dialog, the handoff into ReportProblem and the one-prompt-per-session
    // guard are all still here — flip CRASH_DIALOG_VISIBLE to arm them again.
    if (!CRASH_DIALOG_VISIBLE) return;
    let raising = false;
    const raise = (where: string): void => {
      // Already showing, or already asked and dismissed — say nothing further this session.
      if (raising) return;
      raising = true;
      void window.api.feedback
        .begin("report")
        .then((begun) => setCrash({ where, begun }))
        .catch(() => { raising = false; });
    };
    const onError = (e: ErrorEvent): void => raise(e.filename ? shortWhere(e.filename) : "this screen");
    const onRejection = (): void => raise("this screen");
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  // DIAG-1: start the dev-gated render reporter once (no-op unless DIAG=1).
  useEffect(() => { startDiagReporter(); }, []);

  // ONE class drives the content offset: body.nav-docked { padding-left: var(--mc-flyout-width) }.
  // A PEEKING panel deliberately does NOT set it — peek floats over the content so nothing reflows
  // on hover. Auto-released at narrow widths, so the body keeps full width below 900px.
  useEffect(() => {
    document.body.classList.toggle("nav-docked", navDocked && !tooNarrowToDock);
  }, [navDocked, tooNarrowToDock]);

  // Narrow-width auto-release. matchMedia, not a resize listener — it fires only on the crossing.
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${NAV_DOCK_MIN_WIDTH - 1}px)`);
    const sync = () => setTooNarrowToDock(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

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
    // false | true | "viewer" — see setModalDim. A modal that declares itself a viewer paints its own
    // chrome onto the strip instead of dimming the theme, because the media viewer's header is the
    // same near-black in every theme and the buttons have to recede INTO it, not into a blend of a
    // theme it is not showing. Expanded, that strip IS the viewer's header.
    let dimmed: boolean | "viewer" = false;
    const sync = (): void => {
      const el = document.querySelector(SELECTOR);
      const open: boolean | "viewer" =
        el === null ? false : el.getAttribute("data-modal-backdrop") === "viewer" ? "viewer" : true;
      if (open === dimmed) return; // only cross the IPC when the state actually flips
      dimmed = open;
      void window.api.theme.setModalDim(open);
    };
    const obs = new MutationObserver(sync);
    // ATTRIBUTES TOO, AND THE ATTRIBUTE THIS VERY EFFECT DOCUMENTS. childList alone catches a modal
    // opening and closing, but NOT a mounted modal changing which dim it wants — and the comment
    // above tells new modals to "opt in with data-modal-backdrop", which is an attribute. The media
    // viewer flips that value between "" and "viewer" when it expands, because what sits under the
    // caption strip changes from the scrimmed topbar to its own header. Without this the flip was
    // invisible here and the strip kept the wrong colour until the modal was closed and reopened.
    obs.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-modal-backdrop"],
    });
    sync();
    // EDGE-LOSS RECONCILIATION (Jason 08-25-2026, the boot-dark-strip session — SOP §10): every
    // write in this funnel is edge-triggered and fire-and-forget (void'd invoke, swallowed
    // rejection), so ONE lost edge poisons the native strip for the whole session with nothing to
    // heal it. On window focus, re-send the CURRENT truth unconditionally — idempotent in main, no
    // feedback loop, and any divergence heals at the next click into the window.
    const resync = (): void => {
      const el = document.querySelector(SELECTOR);
      dimmed = el === null ? false : el.getAttribute("data-modal-backdrop") === "viewer" ? "viewer" : true;
      void window.api.theme.setModalDim(dimmed);
    };
    window.addEventListener("focus", resync);
    return () => {
      window.removeEventListener("focus", resync);
      obs.disconnect();
      if (dimmed) void window.api.theme.setModalDim(false);
    };
  }, []);

  // Boot edges → main (boot-dark frame + resize lock). ONE effect covers every flip: skip-fast-boot,
  // terminal complete/fail, AND Safe-Mode Retry re-entering boot. Optional-chained: harmless if the
  // bridge is absent (e.g. web preview).
  useEffect(() => {
    if (isBooting) {
      window.shell?.bootStart?.();
      return;
    }
    window.shell?.bootDone?.();
    // EDGE-LOSS RECONCILIATION (SOP §10): boot:done is a single fire-and-forget edge behind an
    // optional chain — lose it once and the strip/frame stay boot-dark with resize locked for the
    // whole session. Re-send on focus: setBooting(false) is idempotent and notifyUpdaterBootDone
    // self-guards its first-only behavior (updater.ts:130). Gated by [isBooting] so a focus during
    // a real boot (or Safe-Mode Retry re-entry) can never clear the boot frame early.
    const heal = (): void => window.shell?.bootDone?.();
    window.addEventListener("focus", heal);
    return () => window.removeEventListener("focus", heal);
  }, [isBooting]);

  // Theme toggle — set + persist through the settings IPC bridge (DB app_settings, never localStorage).
  const onThemeChange = (mode: ThemeMode) => {
    setThemeMode(mode);
    void window.api.settings.set("theme_mode", mode);
  };

  // Click pins or unpins. Unpinning also drops the peek, or the panel would stay visible under the
  // pointer and the click would read as doing nothing.
  const toggleNavDock = () => {
    // At narrow widths the dock is auto-released and the button changes NOTHING on screen — but it
    // used to still flip and persist rail_collapsed, so invisible clicks below 900px decided where
    // the panel sat the next time the window was widened. Refuse instead.
    if (tooNarrowToDock) return;
    setNavDocked((d) => {
      const next = !d;
      setNavPeek(next);
      void window.api.settings.set("rail_collapsed", next ? "1" : "0");
      return next;
    });
  };

  /**
   * HOVER-PEEK NEEDS A GRACE PERIOD ON THE WAY OUT, and without it the feature is unusable.
   * The dock button spans roughly y 12-44; the panel starts at y 58. Moving the pointer from one to
   * the other crosses ~14 pixels of bare top bar, which fires `mouseleave` and unmounts the panel
   * before the pointer ever arrives — so the tooltip's promise of "hover to peek" only ever worked
   * via the left-edge gutter, which is now gone. Opening stays instant; only closing waits.
   */
  const peekTimer = useRef<number | null>(null);
  const setPeek = (on: boolean): void => {
    if (peekTimer.current !== null) {
      window.clearTimeout(peekTimer.current);
      peekTimer.current = null;
    }
    if (on) {
      setNavPeek(true);
      return;
    }
    peekTimer.current = window.setTimeout(() => setNavPeek(false), 220);
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

  // ENTITLEMENTS — the app-level three-state snapshot (null until the one licensing:features read
  // lands; primed during fetchModules, so the shell's first paint already has it).
  const ents = useEntitlements();

  // STRAND GUARD (Entitlements SOP §2; MindMergeModule.tsx:290-292's shape at app level): if the
  // ACTIVE view is a module the resolved grant hides — a navigate event from a stale surface, or
  // any path the boot-routing guard didn't cover — route Home through select(), which also
  // rewrites last_active_module so the strand cannot recur on the next launch. Hidden means
  // GONE, never a blank screen with no way out.
  useEffect(() => {
    if (moduleHidden(view, ents)) select("home");
  }, [ents, view]); // eslint-disable-line react-hooks/exhaustive-deps

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
      <>
        <BootTerminal
          // Filtered HERE too, not just in the shell: a UI-hidden module (Scout, 08-24-2026) must
          // not print a boot line on the Jarvis screen either. ents may still be null this early —
          // UI_HIDDEN_MODULES drops rows regardless, entitlement rows only on an explicit false.
          modules={modules && modules.filter((m) => !moduleHidden(m.slug, ents))}
          orgName={orgName}
          error={bootError}
          // A failed Config-as-Data read prints the FATAL script and must not be held: Safe Mode has
          // no vault row to set up, and holding there would strand the user with no Retry banner.
          holdSlug={vaultSetupNeeded && !bootError ? VAULT_SLUG : null}
          onHold={() => setVaultWizardOpen(true)} // the script has stopped ON the vault line
          onComplete={() => setIsBooting(false)}
          onFail={() => setIsBooting(false)} // Safe Mode: land in the chrome (banner below), modules empty
        />
        {vaultWizardOpen && (
          <VaultSetupWizard
            onComplete={() => {
              // setView, NOT select() — select() writes last_active_module on every call
              // (see below), so routing the user here would also rewrite where they land on the
              // NEXT launch. A vault new to setup opens on the vault; every other boot keeps the
              // destination fetchModules already restored, defaulting to Home.
              setView(VAULT_SLUG);
              setVaultWizardOpen(false);
              // Releasing the hold LAST: the terminal re-runs its gate, repaints the held line as
              // "loaded.", types the rest of the script, and boot:done fires through the untouched
              // path. The user watches the boot finish — it does not cut straight to the shell.
              setVaultSetupNeeded(false);
            }}
          />
        )}
      </>
    );
  }

  // Safe Mode never dereferences a failed/absent module list.
  const activeModules = bootError ? [] : (modules ?? []);
  // ENTITLEMENT-HIDDEN rows drop out HERE, at the one source that feeds every nav surface —
  // TopBar's switcher, the Flyout, Home's card grid — the chokepoint pattern applied renderer-side,
  // so no surface can forget the filter (Jason 08-22-2026: never-purchased is HIDDEN, "its hidden."
  // — no teaser, no locked placeholder). Three-state: a row drops only on an EXPLICIT false; while
  // the grant is still resolving (ents === null) nothing is hidden and nothing flickers.
  const visibleModules = activeModules.filter((m) => !moduleHidden(m.slug, ents));
  const activeRow = visibleModules.find((m) => m.slug === view);
  // The render-side half of the strand guard (the VIEW_TABS-filter twin): a hidden module never
  // mounts, not even for the one frame before the effect above routes Home.
  const ActiveModule = moduleHidden(view, ents) ? undefined : MODULE_COMPONENTS[view];
  const leaf = LEAF[view] ?? activeRow?.name ?? view;

  return (
    <>
      <TopBar
        leaf={leaf}
        orgName={orgName ?? "AvertXAI"}
        view={view}
        modules={visibleModules.filter((m) => m.is_enabled === 1)}
        onSelect={select}
        onOpenDataViewer={() => select("data-viewer")}
        onOpenSettings={() => { setNavPeek(false); setSettingsOpen(true); }}
        onOpenSearch={() => { setNavPeek(false); setGsOpen(true); }}
        onReportProblem={() => { setNavPeek(false); setReportOpen(true); }}
        onSuggest={() => { setNavPeek(false); setSuggestOpen(true); }}
        onAbout={() => { setNavPeek(false); setAboutOpen(true); }}
        navDocked={navDocked && !tooNarrowToDock}
        onToggleNavDock={toggleNavDock}
        onPeekChange={setPeek}
        themeMode={themeMode}
        onThemeChange={onThemeChange}
      />
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
      <Flyout
        view={view}
        modules={visibleModules}
        onSelect={select}
        docked={navDocked && !tooNarrowToDock}
        peek={navPeek}
        onPeekChange={setPeek}
        sections={navSections}
        onToggleSection={toggleNavSection}
      />
      <UpdateToast />
      {/* Mounted at the shell root so the scrim covers the rail and the topbar too — a spinner that
          stops at the edge of a pane does not answer "is this application alive". */}
      <AppLoadingHost />
      {/* Break/idle prompts must outlive the TimeTracker module's mount — App-level, like UpdateToast. */}
      <AttentionToast />

      {view === "home" && <Home onNavigate={select} modules={visibleModules} />}
      {view === "data-viewer" && <DataViewerModule />}
      {ActiveModule && <ActiveModule />}
      {!ActiveModule && activeRow && <NotBuilt name={activeRow.name} />}

      {/* Standing AvertXAI footer — one instance, below the module content on every page (root-lane). */}
      <AppFooter />

      {/* PURE OVERLAY — `view` is untouched, so closing returns you exactly where you were.
          Mounted outside the bootError guard on purpose: available in Safe Mode. */}
      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          themeMode={themeMode}
          onThemeChange={onThemeChange}
        />
      )}

      {/* FEEDBACK OVERLAYS — same contract as Settings above: pure overlays, `view` untouched, and
          mounted outside the bootError guard so a person can still report the thing that stopped the
          app from booting. That is the case where a report matters most. */}
      {crash && (
        <CrashDialog
          where={crash.where}
          begun={crash.begun}
          onReport={() => { setReportOpen(crash.begun); setCrash(null); }}
          onDismiss={() => {
            // Declining DESTROYS the screenshot. It is never parked "in case they change their mind".
            void window.api.feedback.discard(crash.begun.reference).catch(() => undefined);
            setCrash(null);
          }}
        />
      )}
      {gsOpen && (
        <GlobalSearch
          // The SAME entitlement-filtered enabled rows TopBar's switcher gets — config-as-data,
          // and a module hidden from nav is equally hidden from search (Jason 08-25).
          modules={visibleModules.filter((m) => m.is_enabled === 1)}
          onClose={() => setGsOpen(false)}
          onGo={(req) => {
            setGsOpen(false);
            select("mindmerge");
            requestMindMergeOpen(req);
          }}
        />
      )}
      {reportOpen !== null && (
        <ReportProblem
          onClose={() => setReportOpen(null)}
          crash={reportOpen !== true}
          begun={reportOpen === true ? undefined : reportOpen}
        />
      )}
      {suggestOpen && (
        // visibleModules, not `modules` — the entitlement-filtered list every nav surface reads, so
        // the dropdown can never name a module this person was not sold.
        <SuggestSomething onClose={() => setSuggestOpen(false)} modules={visibleModules} />
      )}
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}

      {/* AI spark — present in v7 chrome; not-built stub (wiring is a later phase). */}
      <button className="spark nb" aria-label="AI assistant">
        <Spark size={22} />
      </button>
    </>
  );
}
