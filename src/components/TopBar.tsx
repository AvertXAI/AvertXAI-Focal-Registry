/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Top bar — application menu (▤), nav-dock toggle (◫), module back/forward, breadcrumb, alerts.
// The native min/□/✕ strip is OS-drawn: the .topbar keeps its padding-right reserve from
// globals.css and nothing is rendered for those buttons here.
//
// Changed from the previous shell:
//   · the three theme pills are GONE from the header — the control lives in View → Theme
//   · ▤ opens the cascading application menu (ShellMenu)
//   · ◫ toggles the nav dock; hovering it peeks the panel, leaving peeks it back
//   · ← → step the module order, which is read from the Config-as-Data rows, and STOP at both ends
//
// STRIPPED 08-19-2026 (Jason): the search magnifier, the inline search box, the create-new (+) and
// the Data Viewer (database) buttons, and the account avatar are all GONE from this bar. The alert
// bell is the only thing that stays on the right. Nothing was lost with them — the Data Viewer and
// Settings are both reachable from the ▤ menu, and search was never wired to an engine.
import { useCallback, useRef, useState } from "react";
import { Bell, Lock } from "../icons";
import type { ModuleRow } from "../shared/types";
import type { ThemeMode, View } from "../App";
import ShellMenu from "./ShellMenu";

interface Props {
  leaf: string;
  /** Active org display name — Config-as-Data 'org_name', drives the brand crumb. */
  orgName: string;
  /** Active view, so the arrows and the Go menu know where they are. */
  view: View;
  /** Enabled, display_order-sorted module rows — the arrows and Go read this, never a hardcode. */
  modules: ModuleRow[];
  onSelect: (v: View) => void;
  /** Opens the Data Viewer — a REAL handler (button omits `nb`, so App's .nb interceptor lets it through). */
  onOpenDataViewer: () => void;
  /** Settings is a pure overlay: it never changes the active module, so it is not a `select`. */
  onOpenSettings: () => void;
  /** Nav dock — click pins/unpins, hover peeks. */
  navDocked: boolean;
  onToggleNavDock: () => void;
  onPeekChange: (peek: boolean) => void;
  /** Still owned + persisted by App; surfaced through View → Theme instead of header pills. */
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

export default function TopBar({
  leaf,
  orgName,
  view,
  modules,
  onSelect,
  onOpenDataViewer,
  onOpenSettings,
  navDocked,
  onToggleNavDock,
  onPeekChange,
  themeMode,
  onThemeChange,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);

  /**
   * THE HEADER MEASURES ITSELF into --mc-topbar-height, which the docked nav panel and all ten
   * module panes size themselves against.
   *
   * A CALLBACK REF, not an effect, and that is the whole point. App.tsx used to do this with
   * `document.querySelector(".topbar")` inside a useEffect — but App returns <BootTerminal> for the
   * entire shell while booting, so this header did not exist when that effect ran; it took the
   * `if (!el) return` branch and never re-attached. The token kept its 58px seed, which was
   * invisible against a 57px header and became a 13px gap when the header came down to 45.
   * React calls a ref callback exactly when the node mounts and again with null when it unmounts,
   * so this cannot be out-raced by a render gate.
   */
  const roRef = useRef<ResizeObserver | null>(null);
  const measureRef = useCallback((el: HTMLElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!el) return;
    const write = (): void => {
      document.documentElement.style.setProperty(
        "--mc-topbar-height",
        `${el.getBoundingClientRect().height}px`
      );
    };
    write(); // first paint, before the observer's own initial callback lands
    const ro = new ResizeObserver(write);
    ro.observe(el);
    roRef.current = ro;
  }, []);

  // MODULE ORDER — data-driven (§6.3). Home first, then the enabled rows in display_order.
  // Settings is absent on purpose: it is a pure overlay and never a destination.
  const order: View[] = ["home", ...modules.map((m) => m.slug as View)];
  const idx = order.indexOf(view);
  // An off-order view (the Data Viewer) parks the arrows rather than jumping somewhere arbitrary.
  const atStart = idx <= 0;
  const atEnd = idx < 0 || idx >= order.length - 1;
  const labelFor = (v: View): string =>
    v === "home" ? "Home" : (modules.find((m) => m.slug === v)?.name ?? v);

  return (
    <header className="topbar" ref={measureRef}>
      <div className="topbar-in">
        <button
          className="iconbtn"
          onClick={() => setMenuOpen((v) => !v)}
          title="Application menu"
          aria-label="Application menu"
          aria-expanded={menuOpen}
        >
          <MenuIcon />
        </button>
        <button
          className={"iconbtn" + (navDocked ? " on" : "")}
          onClick={onToggleNavDock}
          onMouseEnter={() => onPeekChange(true)}
          onMouseLeave={() => onPeekChange(false)}
          title={navDocked ? "Let the module menu hide again" : "Hover to peek · click to keep it open"}
          aria-label="Toggle module menu"
          aria-pressed={navDocked}
        >
          <PanelIcon />
        </button>
        <span className="topbar-div" aria-hidden="true" />

        <button
          className="iconbtn navarrow"
          disabled={atStart}
          onClick={() => onSelect(order[idx - 1])}
          title={atStart ? "First module" : `Back to ${labelFor(order[idx - 1])}`}
          aria-label="Previous module"
        >
          ←
        </button>
        <button
          className="iconbtn navarrow"
          disabled={atEnd}
          onClick={() => onSelect(order[idx + 1])}
          title={atEnd ? "Last module" : `Forward to ${labelFor(order[idx + 1])}`}
          aria-label="Next module"
        >
          →
        </button>

        <div className="crumbs">
          {/* one inline run so the chain can text-overflow:ellipsis as a unit (a flex row can't) */}
          <span className="crumbtext">
            {/* prefix collapses away below the container tier — leaf + lock always remain */}
            <span className="crumb-prefix">
              <span>{orgName}</span>
              <span className="sep">-</span>
              <span>Focal Registry</span>
              <span className="sep">/</span>
            </span>
            <span className="leaf">{leaf}</span>
          </span>
          <Lock className="lock" size={15} />
        </div>

        {/* The bell is the ONLY act left on this bar. `.acts` keeps margin-left:auto, which is what
            pushes it right — without a search box between them the crumb would otherwise stretch. */}
        <div className="acts">
          <button className="iconbtn nb" aria-label="Notifications">
            <Bell />
          </button>
        </div>
      </div>

      {menuOpen && (
        <ShellMenu
          view={view}
          modules={modules}
          onSelect={onSelect}
          onClose={() => setMenuOpen(false)}
          onOpenSettings={onOpenSettings}
          onOpenDataViewer={onOpenDataViewer}
          themeMode={themeMode}
          onThemeChange={onThemeChange}
        />
      )}
    </header>
  );
}

// Hand-rolled OUTLINE glyphs, 16px viewBox — @fluentui/react-icons stays BANNED (RULES-24).
function MenuIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="currentColor">
      <path d="M1 2.75h14v1.5H1zm0 4.5h14v1.5H1zm0 4.5h14v1.5H1z" />
    </svg>
  );
}
function PanelIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round">
      <rect x="1.8" y="2.6" width="12.4" height="10.8" rx="1.4" />
      <path d="M6.2 2.6v10.8" />
    </svg>
  );
}
