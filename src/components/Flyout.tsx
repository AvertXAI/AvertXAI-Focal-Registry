/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Module menu — the left nav panel. THREE states, one panel (was: expanded ↔ 58px icons + drag):
//   hidden  — nothing but the edge tab
//   peek    — hover the ◫ button or the left edge; the panel FLOATS, nothing reflows
//   docked  — click pins it into the layout; body.nav-docked carries the padding-left
//
// Retired with this pass: the 58px icon rail, the drag-resize handle, flyout_width. The panel is a
// fixed --mc-flyout-width (212px). Persisted state is the EXISTING app_settings 'rail_collapsed',
// re-meaning "1" = docked, so an install reads straight across with no whitelist edit.
//
// Rows are Config-as-Data throughout (§6.3): enabled `modules` rows, grouped by nav_group, sections
// at the MIN display_order of their members, standalone rows at their own. Nothing is hardcoded.
import type { View } from "../App";
import type { ModuleRow } from "../shared/types";
import { ChevronDown, Database } from "../icons";

interface Props {
  view: View;
  modules: ModuleRow[];
  onSelect: (v: View) => void;
  /** Docked = pinned into the layout. Persisted app_settings 'rail_collapsed' ("1" = docked). */
  docked: boolean;
  /** Transient hover state, owned by App so the ◫ button and the panel share one flag. */
  peek: boolean;
  onPeekChange: (peek: boolean) => void;
  /** Per-section expand/collapse (persisted app_settings 'nav_section_state'). Absent = expanded. */
  sections: Record<string, "expanded" | "collapsed">;
  onToggleSection: (group: string) => void;
}

export default function Flyout({
  view,
  modules,
  onSelect,
  docked,
  peek,
  onPeekChange,
  sections,
  onToggleSection,
}: Props) {
  const shown = docked || peek;
  const cls = (v: View) => `navitem${view === v ? " active" : ""}`;

  // Enabled modules, already display_order-sorted upstream (listModules ORDER BY display_order ASC).
  const enabled = modules.filter((m) => m.is_enabled === 1);
  const moduleBtn = (m: ModuleRow) => (
    <button key={m.slug} className={cls(m.slug)} onClick={() => onSelect(m.slug)}>
      {moduleIcon(m.slug)}
      <span className="navlbl">{m.name}</span>
    </button>
  );

  // Nav model: two entry kinds, ONE ordered list. A row with nav_standalone=1 is a TOP-LEVEL
  // clickable link (Secured Vault, Marketplace) — section-header level, navigates on click, no
  // children, no caret. Everything else groups by nav_group (transiently-NULL row → "Applications").
  type NavEntry =
    | { kind: "section"; group: string; mods: ModuleRow[]; order: number }
    | { kind: "standalone"; mod: ModuleRow; order: number };
  const entries: NavEntry[] = [];
  const groups = new Map<string, Extract<NavEntry, { kind: "section" }>>();
  for (const m of enabled) {
    if (m.nav_standalone === 1) {
      entries.push({ kind: "standalone", mod: m, order: m.display_order });
      continue;
    }
    const g = m.nav_group ?? "Applications";
    let section = groups.get(g);
    if (!section) {
      section = { kind: "section", group: g, mods: [], order: m.display_order };
      groups.set(g, section);
      entries.push(section);
    }
    section.mods.push(m);
    section.order = Math.min(section.order, m.display_order);
  }
  entries.sort((a, b) => a.order - b.order);
  const isExpanded = (g: string): boolean => sections[g] !== "collapsed"; // unknown → expanded

  const standaloneBtn = (m: ModuleRow) => (
    <button
      key={m.slug}
      className={"navsection-head navlink-standalone" + (view === m.slug ? " active" : "")}
      onClick={() => onSelect(m.slug)}
    >
      {moduleIcon(m.slug)}
      <span className="navsection-label">{m.name}</span>
    </button>
  );

  return (
    <>
      {/* NO HOVER GUTTER (Jason, 08-19-2026). There was a transparent 16px-wide fixed strip down
          the ENTIRE left edge of the window here, at z-index 39, that peeked the panel open on
          hover. Two things were wrong with it. It was a second open/close control for a panel that
          is ruled to have exactly one — the dock button in the top bar. And because the panel is
          hidden by DEFAULT, that invisible strip covered the leftmost 16 pixels of every module
          page and ate every click there: Scan's panel edge, MindMerge's rail, Vault's sidebar,
          Scout Viewer's tool rail. `aria-hidden` does not disable hit-testing. Do not restore it —
          the hover-peek it provided now works from the dock button, which has a close delay so the
          pointer can cross the bar between the button and the panel. */}

      {/* NO EDGE TAB ON THE SHELL RAIL (ruled 08-19-2026). The top bar's dock icon is this
          panel's ONLY open/close control. The edge tab belongs to a MODULE's own secondary
          sidebar — Vault, TimeTracker, Employees — welded to that sidebar's right edge.
          Use the shared "edgetab" class in shell.css; do not reintroduce a tab here. */}

      {shown && (
        <aside
          className={"navdock" + (peek && !docked ? " peek" : "")}
          aria-label="Main navigation"
          onMouseEnter={() => onPeekChange(true)}
          onMouseLeave={() => onPeekChange(false)}
        >
          {/* Home | Database — two destinations, one control. Database opens the REAL Data Viewer
              view (a core view, not a modules row), which also persists last_active_module. */}
          <div className="navsplit">
            <button className={view === "home" ? "on" : ""} onClick={() => onSelect("home")}>
              <HomeIcon />
              Home
            </button>
            <button className={view === "data-viewer" ? "on" : ""} onClick={() => onSelect("data-viewer")}>
              <Database />
              Database
            </button>
          </div>
          <hr className="navdiv" />

          <nav>
            {entries.map((e) =>
              e.kind === "standalone" ? (
                standaloneBtn(e.mod)
              ) : (
                <div className="navsection" key={e.group}>
                  <button
                    className="navsection-head"
                    onClick={() => onToggleSection(e.group)}
                    aria-expanded={isExpanded(e.group)}
                  >
                    <ChevronDown className={"navsection-chev" + (isExpanded(e.group) ? "" : " collapsed")} />
                    <span className="navsection-label">{e.group}</span>
                  </button>
                  {isExpanded(e.group) && e.mods.map(moduleBtn)}
                </div>
              )
            )}

            {/* NO Settings row here (Jason, 08-19-2026). Settings is reached from the application
                menu — ▤ → File → Settings — and from nowhere else in the shell chrome. */}
          </nav>
        </aside>
      )}
    </>
  );
}

// Home glyph — house outline.
function HomeIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.6 7.2 8 2.8l5.4 4.4" />
      <path d="M4 6.6v6.4a.7.7 0 0 0 .7.7h6.6a.7.7 0 0 0 .7-.7V6.6M6.7 13.7v-3.5h2.6v3.5" />
    </svg>
  );
}

// slug → nav glyph. Module rows are DB-driven; an unknown slug falls back to the document glyph.
// All hand-rolled OUTLINE SVGs — NO @fluentui/react-icons (canon RULES-24 bloat rule).
function moduleIcon(slug: string) {
  switch (slug) {
    case "scan":
      return <ScanIcon />;
    case "rename":
      return <RenameIcon />;
    case "migrate":
      return <MigrateIcon />;
    case "timetracker":
      return <ClockIcon />;
    case "employees":
      return <PeopleIcon />;
    case "scout-viewer":
      return <SearchIcon />;
    case "vault":
      return <LockIcon />;
    case "marketplace":
      return <MarketIcon />;
    case "mindmerge":
    default:
      return <DocIcon />;
  }
}

function ScanIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 5V3.2A1.2 1.2 0 0 1 3.2 2H5M11 2h1.8A1.2 1.2 0 0 1 14 3.2V5M14 11v1.8a1.2 1.2 0 0 1-1.2 1.2H11M5 14H3.2A1.2 1.2 0 0 1 2 12.8V11" />
      <path d="M4.2 8h7.6" />
    </svg>
  );
}
function RenameIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="m9.6 3.4 3 3L6 13l-3.4.4L3 10l6.6-6.6Z" />
      <path d="m8.4 4.6 3 3M9 14h5" />
    </svg>
  );
}
function MigrateIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 6.5v6.3a.7.7 0 0 0 .7.7h6.3M2.5 6.5h7M2.5 6.5 4 3.6a.7.7 0 0 1 .6-.4h4.8" />
      <path d="M10.5 10.5 14 7m0 0h-3m3 0v3" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 4.6V8l2.4 1.6" />
    </svg>
  );
}
function PeopleIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6.2" cy="5.4" r="2.6" />
      <path d="M1.8 13.6c0-2.4 2-4 4.4-4s4.4 1.6 4.4 4" />
      <path d="M11 3.2a2.4 2.4 0 0 1 0 4.6M12.4 9.9c1.2.5 1.8 1.9 1.8 3.7" />
    </svg>
  );
}
function DocIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 1.8h4.5L12 5.3V14a.7.7 0 0 1-.7.7H4a.7.7 0 0 1-.7-.7V2.5A.7.7 0 0 1 4 1.8Z" />
      <path d="M8.3 1.8v3.2h3.2M5.6 8.3h4.8M5.6 10.8h4.8" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="7" r="4.3" />
      <path d="M10.3 10.3 13.6 13.6" />
    </svg>
  );
}
function MarketIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.4 5.2h7.2l.7 8a.7.7 0 0 1-.7.8H4.4a.7.7 0 0 1-.7-.8l.7-8Z" />
      <path d="M5.8 7V4.6a2.2 2.2 0 0 1 4.4 0V7" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.3" y="7" width="9.4" height="7" rx="1.2" />
      <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" />
    </svg>
  );
}
