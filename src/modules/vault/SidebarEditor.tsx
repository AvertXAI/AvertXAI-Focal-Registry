/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Settings › Sidebar editor (MOCKUP-vault-full-v2). Two panes: what you CAN pin on the left, what
// you HAVE pinned on the right. Drag a ⠿ handle to reorder, ✕ to remove, + to pin.
//
// WHY BOTH THIS AND THE SIDEBAR'S "+ Add shortcut" (Jason asked which was better, 08-10-2026):
// pinning happens where you are — a pick-list on the sidebar, one click, mid-task. ARRANGING is a
// sit-down job and needs both lists visible at once, which a popover cannot give you. Same stored
// list, two doors; that is how bookmarks have always worked and why the habit sticks.
import { useState } from "react";
// The width constants come from the components that OWN them — quoting 216 or 320 as a literal here
// is how the topbar's 58px ended up duplicated in three stylesheets and drifting.
import { LIST_WIDTH } from "./NotesView";
import { SHORTCUTS_VISIBLE, SIDE_MAX, SIDE_MIN, sideDefault, type Shortcut } from "./Sidebar";
import type { VaultFolder, VaultSecretMeta } from "./vaultApi";

const SECTIONS: Shortcut[] = [
  { type: "section", id: "passwords", label: "Passwords" },
  { type: "section", id: "notes", label: "Secured Notes" },
  { type: "section", id: "infra", label: "Infrastructure" },
  { type: "section", id: "repos", label: "Repos" },
];
const TOOLS: Shortcut[] = [
  { type: "tool", id: "generator", label: "Generator" },
  { type: "tool", id: "health", label: "Health" },
  { type: "tool", id: "log", label: "Access log" },
  { type: "tool", id: "importexport", label: "Import / Export" },
];

export default function SidebarEditor({
  shortcuts, onChange, secrets, folders, adjustable, onAdjustable,
}: {
  shortcuts: Shortcut[];
  onChange: (list: Shortcut[]) => void;
  secrets: VaultSecretMeta[];
  folders: VaultFolder[];
  /** The divider lock — see the control at the foot of this card. */
  adjustable: boolean;
  onAdjustable: (v: boolean) => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const has = (s: Shortcut): boolean => shortcuts.some((x) => x.type === s.type && x.id === s.id);
  const add = (s: Shortcut): void => { if (!has(s)) onChange([...shortcuts, s]); };
  const remove = (i: number): void => onChange(shortcuts.filter((_, j) => j !== i));

  /** Reorder by dropping one row onto another — the list is short, so a splice is the whole feature. */
  const drop = (to: number): void => {
    if (dragIndex === null || dragIndex === to) return setDragIndex(null);
    const next = [...shortcuts];
    const [moved] = next.splice(dragIndex, 1);
    if (moved) next.splice(to, 0, moved);
    onChange(next);
    setDragIndex(null);
    setOverIndex(null);
  };

  const available: [string, Shortcut[]][] = [
    ["Sections", SECTIONS],
    ["Tools", TOOLS],
    ["Folders", folders.map((f) => ({ type: "folder" as const, id: String(f.id), label: f.name }))],
    ["Entries", secrets.filter((s) => !s.archived_at).slice(0, 25).map((s) => ({ type: "entry" as const, id: s.uuid, label: s.label }))],
  ];

  return (
    <div className="vault-card">
      <div className="vault-cardhead">
        <span className="vault-cardtitle">Sidebar</span>
        {SHORTCUTS_VISIBLE && (
          <span className="vault-hint">What you pin here appears at the top of the sidebar, in this order</span>
        )}
      </div>
      {/* Only the pinning half is hidden (Jason 08-23-2026). The divider lock at the foot of this card
          governs the sidebar handle, has nothing to do with shortcuts, and stays — which is why this
          guard wraps the edit pane rather than the whole card. */}
      {/* PREVIEW LEFT, EDITOR RIGHT (Jason 08-12-2026) — and the preview is drawn as the SIDEBAR
          rather than as a second list panel. It sat on the right looking like a form field, so what
          you were arranging and what you would get looked nothing like each other. Now the left
          column IS the rail: same width, same background, same row treatment, same "Shortcuts"
          heading, so pinning something shows you exactly the thing that will appear. */}
      {SHORTCUTS_VISIBLE && (
      <div className="vault-editwrap">
        <div className="vault-editpreview">
          <div className="vault-editpvh">Preview — this is your sidebar</div>
          <div className="vault-side" style={{ position: "static", height: "auto" }}>
            <div className="vault-sidescroll">
              <div className="vault-railhead">
                {/* "drag to reorder" truncated in a 300px rail (Jason 08-12-2026) — the heading now
                    carries the whole instruction instead of a label plus a hint that gets cut. */}
                <span className="sbtxt">Adjust your shortcuts</span>
              </div>
              {shortcuts.length === 0 ? (
                <div className="vault-hint sbtxt" style={{ padding: "2px 9px 8px" }}>Nothing pinned yet.</div>
              ) : (
                shortcuts.map((s, i) => (
                  <div
                    key={`${s.type}:${s.id}`}
                    className={`vault-railrow shortcut${overIndex === i ? " over" : ""}${dragIndex === i ? " dragging" : ""}`}
                    draggable
                    onDragStart={() => setDragIndex(i)}
                    onDragOver={(e) => { e.preventDefault(); setOverIndex(i); }}
                    onDragLeave={() => setOverIndex(null)}
                    onDrop={() => drop(i)}
                    onDragEnd={() => { setDragIndex(null); setOverIndex(null); }}
                  >
                    <span className="vault-sbadge">{s.label.slice(0, 1).toUpperCase()}</span>
                    <span className="vault-railname">{s.label}</span>
                    <button className="vault-scx" title="Remove" onClick={() => remove(i)}>✕</button>
                  </div>
                ))
              )}
              {/* The groups beneath are drawn dimmed and inert — they are what the real rail shows
                  under your shortcuts, and seeing them is the difference between a preview and a list. */}
              <div className="vault-editghost">
                <div className="vault-railhead"><span className="sbtxt">Vault</span></div>
                <div className="vault-railrow"><span className="vault-dot" style={{ background: "var(--mc-accent-primary)" }} /><span className="vault-railname">All items</span></div>
                <div className="vault-railrow"><span className="vault-dot" style={{ background: "var(--vault-warn-color)" }} /><span className="vault-railname">Favourites</span></div>
              </div>
            </div>
          </div>
        </div>

        <div className="vault-editpane">
          <div className="vault-editpaneh"><b>Available</b><span className="vault-hint">— press + to pin</span></div>
          <div className="vault-editbody">
            {available.map(([name, items]) =>
              items.length === 0 ? null : (
                <div key={name}>
                  <div className="vault-railhead" style={{ marginLeft: 2 }}>{name}</div>
                  {items.map((s) => (
                    <div key={`${s.type}:${s.id}`} className="vault-edititem">
                      <span className="vault-editnm">{s.label}</span>
                      <span className="vault-editct">{s.type}</span>
                      <button className="vault-btn sm" disabled={has(s)} onClick={() => add(s)}>{has(s) ? "✓" : "+"}</button>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        </div>
      </div>
      )}

      {/* THE DIVIDER LOCK, at the foot of the sidebar card because that is the thing it governs
          (Jason 08-12-2026: "add a toggle on/off in settings, anywhere around or near the sidebar
          editor… make sure it removes the dial when locked").
          ONE control for the handle AND the dial — see the note on sidebar.width_adjustable in
          settings.ts for why this is a persisted toggle rather than the hold-Ctrl-to-unlock he
          floated. */}
      <div className="vault-opts" style={{ borderTop: "1px solid var(--mc-border)", marginTop: 14, paddingTop: 12 }}>
        <label className="vault-opt">
          <input type="checkbox" checked={adjustable} onChange={(e) => onAdjustable(e.target.checked)} />
          Let me drag the sidebar edge to resize it
        </label>
        <div className="vault-hint" style={{ paddingLeft: 2 }}>
          {adjustable
            ? `On — the sidebar's right edge is a handle, and dragging it shows a live pixel readout. Each tab keeps its own width; double-click resets that tab to its calibrated default (Passwords ${sideDefault("passwords")}, Secured Notes ${sideDefault("notes")}, Infrastructure ${sideDefault("infra")}, Repos ${sideDefault("repos")}). Arrow keys step 16. Range ${SIDE_MIN}–${SIDE_MAX}.`
            : `Off, and this is the default — each tab sits at its calibrated width and the edge is just a border. No handle, no readout. Turn it on only to re-measure.`}
          {" "}The note list beside your notes is a fixed {LIST_WIDTH} pixels either way.
        </div>
      </div>
    </div>
  );
}
