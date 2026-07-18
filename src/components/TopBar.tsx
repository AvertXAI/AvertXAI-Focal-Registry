/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Top bar — breadcrumb, search + acts (mostly orange-not-built). No hamburger: the nav rail is
// persistent (always open), so there is nothing to toggle. Brandmark lives in the rail head.
// Narrow tiers (SOP): <1200px the inline searchbox collapses to the magnifier, which opens a
// popup search bar; <950px the acts cluster wraps under the native min/□/✕ strip (CSS tiers).
import { useEffect, useState } from "react";
import { Bell, Database, Lock, Plus, Search } from "../icons";
import type { ThemeMode } from "../App";

// Dev readout (gated OFF): flip to true for a live .topbar width badge when tuning the tier.
const SHOW_WIDTH_BADGE = false;

interface Props {
  leaf: string;
  /** Active org display name — Config-as-Data 'org_name', drives the brand crumb. */
  orgName: string;
  /** Opens the Data Viewer — a REAL handler (button omits `nb`, so App's .nb interceptor lets it through). */
  onOpenDataViewer: () => void;
  /** 3-state theme toggle (System/Light/Dark), driven + persisted by App. */
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

export default function TopBar({ leaf, orgName, onOpenDataViewer, themeMode, onThemeChange }: Props) {
  const [searchOpen, setSearchOpen] = useState(false);
  // Native min/□/✕ can't sit under a DOM backdrop (OS-drawn above the page) — dim them via the
  // shell's modal-dim path while the search popup is open; restore follows the ACTIVE theme
  // (main reads currentOverlayMode at call time). Same pattern as the Distributor modals.
  useEffect(() => {
    void window.api.theme.setModalDim(searchOpen);
    return () => void window.api.theme.setModalDim(false);
  }, [searchOpen]);
  const [barWidth, setBarWidth] = useState(0);
  // Throwaway width badge — ResizeObserver catches window resizes AND rail expand/collapse.
  useEffect(() => {
    if (!SHOW_WIDTH_BADGE) return;
    const bar = document.querySelector(".topbar");
    if (!bar) return;
    const ro = new ResizeObserver(() => setBarWidth((bar as HTMLElement).clientWidth));
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);
  return (
    <header className="topbar">
      {/* container-query wrapper — the header is the container; this inner row is what wraps */}
      <div className="topbar-in">
      <div className="crumbs">
        {/* one inline run so the chain can text-overflow:ellipsis as a unit (a flex row can't) */}
        <span className="crumbtext">
          {/* prefix collapses away below the ~700px container tier — leaf + lock always remain */}
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
      <button className="searchbox nb">
        <Search size={14} />
        <span>Type</span>
        <kbd>/</kbd>
        <span>to search</span>
      </button>
      <div className="acts">
        <button className="iconbtn search-sm" aria-label="Search" onClick={() => setSearchOpen(true)}>
          <Search />
        </button>
        <button className="iconbtn nb" aria-label="Create new">
          <Plus />
        </button>
        <button className="iconbtn" aria-label="Data Viewer" onClick={onOpenDataViewer}>
          <Database />
        </button>
        <button className="iconbtn nb" aria-label="Notifications">
          <Bell />
        </button>
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
        <button className="avatar nb" aria-label="Account">
          JC
        </button>
      </div>
      </div>

      {/* Popup search — magnifier tier. Outside click / Esc closes; the search ENGINE itself is
          still not built (same as the inline box), so the input is a UI shell for now. */}
      {searchOpen && (
        <div className="overlay" onClick={() => setSearchOpen(false)}>
          <div className="search-pop" role="search" onClick={(e) => e.stopPropagation()}>
            <Search size={14} />
            <input
              placeholder="Type to search (coming soon)"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Escape") setSearchOpen(false);
              }}
            />
            <kbd>esc</kbd>
          </div>
        </div>
      )}

      {/* THROWAWAY width badge — delete next pass */}
      {SHOW_WIDTH_BADGE && (
        <div
          style={{ position: "fixed", bottom: 8, left: 8, zIndex: 99, font: "11px var(--mc-mono)", color: "var(--mc-muted)", background: "var(--mc-panels)", border: "1px solid var(--mc-border)", borderRadius: 4, padding: "2px 6px", pointerEvents: "none" }}
        >
          topbar {barWidth}px · container {Math.max(0, barWidth - 166)}px
        </div>
      )}
    </header>
  );
}

// Hand-rolled OUTLINE theme glyphs (no @fluentui), 16px viewBox.
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
