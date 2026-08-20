/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Cascading application menu behind the ▤ button — File / Edit / View / Go / Help, with a Theme
// submenu under View and a Troubleshooting submenu under Help.
//
// Go is the point of it: every module is reachable from the menu, and the list is built from the
// SAME Config-as-Data rows the rail renders (§6.3) — never a hardcoded nav entry.
//
// PORTALLED TO document.body, AND THAT IS STRUCTURAL, NOT COSMETIC. Rendered inside <header
// class="topbar"> this menu was unreachable: `.topbar` builds a stacking context TWICE over — once
// from `position:sticky; z-index:30` (globals.css:286) and again from `container-type:inline-size`
// (globals.css:84, whose layout containment also makes it the containing block for fixed children).
// Sealed inside it, this menu's z-index 130 never entered the root comparison, so the whole header
// painted atomically at 30 and the nav panel (40 docked, 60 peeking) covered half the menu. The same
// containment shrank the full-window dismiss scrim to the header's own box, and `.topbar`'s
// -webkit-app-region:drag made what was left of it a window-drag surface that swallowed the click.
// One portal fixes all three. Do NOT move this back inside the header.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ModuleRow } from "../shared/types";
import type { ThemeMode, View } from "../App";

type Section = "File" | "Edit" | "View" | "Go" | "Help";
const SECTIONS: Section[] = ["File", "Edit", "View", "Go", "Help"];

interface Props {
  view: View;
  /** Enabled, display_order-sorted rows — the same list the rail draws from. */
  modules: ModuleRow[];
  onSelect: (v: View) => void;
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenDataViewer: () => void;
  /** Nav dock state — View carries the same toggle the ◫ button and the edge tab drive. */
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

export default function ShellMenu({
  view,
  modules,
  onSelect,
  onClose,
  onOpenSettings,
  onOpenDataViewer,
  themeMode,
  onThemeChange,
}: Props) {
  const [section, setSection] = useState<Section>("File");
  const [sub, setSub] = useState(false);

  // Escape closes. Outside-click is handled by the scrim below, which sits under the panels but
  // over everything else — keydown is the half a scrim cannot do.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (sub) setSub(false);
      else onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sub, onClose]);

  const go = (v: View) => {
    onSelect(v);
    onClose();
  };

  // Home and the Data Viewer are core views; the rest is whatever the modules table says.
  const goRows: Array<{ slug: View; label: string }> = [
    { slug: "home", label: "Home" },
    { slug: "data-viewer", label: "Data Viewer" },
    ...modules.map((m) => ({ slug: m.slug as View, label: m.name })),
  ];

  return createPortal(
    <>
      <div className="shellmenu-scrim" onClick={onClose} />
      {/* NO role="menu" (removed 08-19). ARIA's menu role contracts that every child is a
          `menuitem` and that arrow keys move between them; these are plain buttons in nested divs
          with no roving-tabindex, so the role promised a keyboard model that does not exist and
          made screen readers announce a broken item count. Plain buttons are read correctly. */}
      <div className="shellmenu-wrap">
        <div className="shellmenu shellmenu-sections">
          {SECTIONS.map((s) => (
            <button
              key={s}
              className={section === s ? "on" : ""}
              onClick={() => { setSection(s); setSub(false); }}
              onMouseEnter={() => { setSection(s); setSub(false); }}
            >
              {s}
              <span className="menu-caret" aria-hidden="true">›</span>
            </button>
          ))}
        </div>

        {section === "File" && (
          <div className="shellmenu shellmenu-panel">
            <button className="nb">New scan<span className="menu-key">Ctrl+N</span></button>
            <button className="nb">New rename batch<span className="menu-key">Ctrl+Shift+N</span></button>
            <button className="nb">New project…<span className="menu-key">Ctrl+P</span></button>
            <hr />
            <button onClick={() => { onOpenDataViewer(); onClose(); }}>
              Open Data Viewer<span className="menu-key">Ctrl+D</span>
            </button>
            <button className="nb">Import…</button>
            <button className="nb">Export…</button>
            <hr />
            <button onClick={() => { onOpenSettings(); onClose(); }}>
              Settings<span className="menu-key">Ctrl+,</span>
            </button>
            <hr />
            <button className="nb">Close Window<span className="menu-key">Ctrl+W</span></button>
            <button className="nb">Exit</button>
          </div>
        )}

        {section === "Edit" && (
          <div className="shellmenu shellmenu-panel">
            <button className="nb">Undo<span className="menu-key">Ctrl+Z</span></button>
            <button className="nb">Redo<span className="menu-key">Ctrl+Shift+Z</span></button>
            <hr />
            <button className="nb">Cut<span className="menu-key">Ctrl+X</span></button>
            <button className="nb">Copy<span className="menu-key">Ctrl+C</span></button>
            <button className="nb">Paste<span className="menu-key">Ctrl+V</span></button>
            <button className="nb">Select All<span className="menu-key">Ctrl+A</span></button>
            <hr />
            <button className="nb">Find in page<span className="menu-key">Ctrl+F</span></button>
          </div>
        )}

        {section === "View" && (
          <div className="shellmenu shellmenu-panel">
            <button onClick={() => window.location.reload()}>Reload<span className="menu-key">F5</span></button>
            {/* NO module-menu toggle here (Jason, 08-19-2026). The shell panel has EXACTLY ONE
                open/close control — the dock button in the top bar. Its Ctrl+B hint was decorative:
                no keyboard handler for it exists anywhere in the shell. Do not reintroduce it. */}
            <button className="nb">Full Screen<span className="menu-key">F11</span></button>
            <hr />
            <button disabled>Actual Size<span className="menu-key">Ctrl+0</span></button>
            <button className="nb">Zoom In<span className="menu-key">Ctrl++</span></button>
            <button className="nb">Zoom Out<span className="menu-key">Ctrl+-</span></button>
            <hr />
            {/* The submenu is a CHILD of its trigger row, so CSS anchors it to that row. It used
                to be a flex sibling of the whole panel with a hand-counted `marginTop: 266`, which
                stopped matching the moment a row was added or removed above it. */}
            <div className="shellmenu-item">
              <button
                className={sub ? "on" : ""}
                onClick={() => setSub((v) => !v)}
                onMouseEnter={() => setSub(true)}
              >
                Theme<span className="menu-caret" aria-hidden="true">›</span>
              </button>
              {sub && (
                <div className="shellmenu shellmenu-sub">
                  {(["system", "light", "dark"] as ThemeMode[]).map((m) => (
                    <button key={m} onClick={() => { onThemeChange(m); onClose(); }}>
                      <span className="menu-check" aria-hidden="true">{themeMode === m ? "•" : ""}</span>
                      {m === "system" ? "System" : m === "light" ? "Light" : "Dark"}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {section === "Go" && (
          <div className="shellmenu shellmenu-panel">
            {goRows.map((r, i) => (
              <button key={r.slug} className={view === r.slug ? "on" : ""} onClick={() => go(r.slug)}>
                <span className="menu-check" aria-hidden="true">{view === r.slug ? "•" : ""}</span>
                {r.label}
                {i < 9 && <span className="menu-key">Ctrl+{i + 1}</span>}
              </button>
            ))}
          </div>
        )}

        {section === "Help" && (
          <div className="shellmenu shellmenu-panel">
            <button className="nb">Open Documentation</button>
            <button className="nb">Check for Updates</button>
            <hr />
            <div className="shellmenu-item">
              <button
                className={sub ? "on" : ""}
                onClick={() => setSub((v) => !v)}
                onMouseEnter={() => setSub(true)}
              >
                Troubleshooting<span className="menu-caret" aria-hidden="true">›</span>
              </button>
              {sub && (
                <div className="shellmenu shellmenu-sub" style={{ width: 220 }}>
                  <button className="nb">Show Logs in Explorer</button>
                  <button className="nb">Copy Installation ID</button>
                  <button className="nb">Generate Diagnostic Report</button>
                  <hr />
                  <button className="nb">Enable Developer Mode</button>
                  <button className="nb">Safe Mode Restart</button>
                  <hr />
                  <button className="nb">Clear Cache and Restart</button>
                  <button className="nb">Reset App Data…</button>
                </div>
              )}
            </div>
            <hr />
            <button className="nb">Get Support</button>
            <button className="nb">About…</button>
          </div>
        )}
      </div>
    </>,
    document.body
  );
}
