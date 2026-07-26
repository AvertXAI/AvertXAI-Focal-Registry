/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Persistent left rail — always open, zero menu-diving (DevOps-operator requirement).
// Live: Home / Config-as-Data module rows / Settings; module buttons come from the DB
// `modules` table (enabled rows only) — not a hardcoded list.
import type { View } from "../App";
import type { ModuleRow } from "../shared/types";
import { ChevronDown } from "../icons";

interface Props {
  view: View;
  modules: ModuleRow[];
  onSelect: (v: View) => void;
  /** 1-click collapse state (persisted app_settings 'rail_collapsed', driven by App). */
  collapsed: boolean;
  onToggle: () => void;
  /** Drag-resize (persisted app_settings 'flyout_width'): live width during drag / commit on release.
      App owns the clamp ([200px, FLYOUT_MAX_WIDTH]); the rail is fixed at left:0 so clientX = width. */
  onResize: (px: number) => void;
  onResizeEnd: (px: number) => void;
  /** Per-section expand/collapse (persisted app_settings 'nav_section_state', driven by App). A group
      absent from the map defaults to expanded. */
  sections: Record<string, "expanded" | "collapsed">;
  onToggleSection: (group: string) => void;
}

export default function Flyout({
  view,
  modules,
  onSelect,
  collapsed,
  onToggle,
  onResize,
  onResizeEnd,
  sections,
  onToggleSection,
}: Props) {
  const cls = (v: View) => `navitem${view === v ? " active" : ""}`;

  // Enabled modules, already display_order-sorted upstream (listModules ORDER BY display_order ASC).
  const enabled = modules.filter((m) => m.is_enabled === 1);
  // Module button — IDENTICAL markup in both the flat (collapsed-rail) and grouped (expanded) modes.
  const moduleBtn = (m: ModuleRow) => (
    <button key={m.slug} className={cls(m.slug)} onClick={() => onSelect(m.slug)}>
      {moduleIcon(m.slug)}
      <span className="navlbl">{m.name}</span>
    </button>
  );
  // Group by nav_group (transiently-NULL row → "Applications"). Sections ordered by the MIN
  // display_order of their members (data-driven, no hardcoded order); within-section order is
  // display_order, preserved from `enabled`.
  const groups = new Map<string, ModuleRow[]>();
  for (const m of enabled) {
    const g = m.nav_group ?? "Applications";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(m);
  }
  const orderedGroups = [...groups.entries()].sort(
    (a, b) =>
      Math.min(...a[1].map((m) => m.display_order)) - Math.min(...b[1].map((m) => m.display_order))
  );
  const isExpanded = (g: string): boolean => sections[g] !== "collapsed"; // unknown → expanded
  return (
    <aside className={`flyout${collapsed ? " collapsed" : ""}`} aria-label="Main navigation">
        <div className="flyout-head">
          <div className="brandmark">A</div>
          <button
            className="iconbtn"
            onClick={onToggle}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={collapsed}
          >
            <span className="chev" aria-hidden="true">{collapsed ? "»" : "«"}</span>
          </button>
        </div>
        <nav>
          <button className={cls("home")} onClick={() => onSelect("home")}>
            <HomeIcon />
            <span className="navlbl">Home</span>
          </button>
          <hr className="navdiv" />
          {/* MIDDLE — grouped collapsible sections when expanded; flat icon list when the whole rail
              is collapsed (headers skipped at 58px, exactly as the rail rendered before grouping). */}
          {collapsed
            ? enabled.map(moduleBtn)
            : orderedGroups.map(([group, mods]) => (
                <div className="navsection" key={group}>
                  <button
                    className="navsection-head"
                    onClick={() => onToggleSection(group)}
                    aria-expanded={isExpanded(group)}
                  >
                    <ChevronDown
                      className={"navsection-chev" + (isExpanded(group) ? "" : " collapsed")}
                    />
                    <span className="navsection-label">{group}</span>
                  </button>
                  {isExpanded(group) && mods.map(moduleBtn)}
                </div>
              ))}
          <hr className="navdiv" />
          <button className={cls("settings")} onClick={() => onSelect("settings")}>
            <GearIcon />
            <span className="navlbl">Settings</span>
          </button>
        </nav>
        {/* right-edge drag handle — expanded only; pointer capture keeps the drag on this element */}
        {!collapsed && (
          <div
            className="flyout-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            title="Drag to resize"
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (e.buttons === 1) onResize(e.clientX);
            }}
            onPointerUp={(e) => onResizeEnd(e.clientX)}
          />
        )}
      </aside>
  );
}

// Home glyph — house outline (converted from v7's solid path, Phase 1.b).
function HomeIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
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
    case "scout-viewer":
      return <SearchIcon />;
    case "vault":
      return <LockIcon />;
    case "mindmerge":
    default:
      return <DocIcon />;
  }
}

// scan — viewfinder corners + scan line outline
function ScanIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 5V3.2A1.2 1.2 0 0 1 3.2 2H5M11 2h1.8A1.2 1.2 0 0 1 14 3.2V5M14 11v1.8a1.2 1.2 0 0 1-1.2 1.2H11M5 14H3.2A1.2 1.2 0 0 1 2 12.8V11" />
      <path d="M4.2 8h7.6" />
    </svg>
  );
}

// rename — pencil-over-line outline
function RenameIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="m9.6 3.4 3 3L6 13l-3.4.4L3 10l6.6-6.6Z" />
      <path d="m8.4 4.6 3 3M9 14h5" />
    </svg>
  );
}

// migrate — box-with-outbound-arrow outline (assets leaving for a new machine)
function MigrateIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 6.5v6.3a.7.7 0 0 0 .7.7h6.3M2.5 6.5h7M2.5 6.5 4 3.6a.7.7 0 0 1 .6-.4h4.8" />
      <path d="M10.5 10.5 14 7m0 0h-3m3 0v3" />
    </svg>
  );
}

// mindmerge — document outline
function DocIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 1.8h4.5L12 5.3V14a.7.7 0 0 1-.7.7H4a.7.7 0 0 1-.7-.7V2.5A.7.7 0 0 1 4 1.8Z" />
      <path d="M8.3 1.8v3.2h3.2M5.6 8.3h4.8M5.6 10.8h4.8" />
    </svg>
  );
}

// scout-viewer — magnifying glass outline
function SearchIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="7" r="4.3" />
      <path d="M10.3 10.3 13.6 13.6" />
    </svg>
  );
}

// vault (Secure Vault) — lock outline
function LockIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.3" y="7" width="9.4" height="7" rx="1.2" />
      <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" />
    </svg>
  );
}

// Settings — gear outline
function GearIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.6v1.8M8 12.6v1.8M14.4 8h-1.8M3.4 8H1.6M12.5 3.5l-1.3 1.3M4.8 11.2l-1.3 1.3M12.5 12.5l-1.3-1.3M4.8 4.8 3.5 3.5" />
    </svg>
  );
}
