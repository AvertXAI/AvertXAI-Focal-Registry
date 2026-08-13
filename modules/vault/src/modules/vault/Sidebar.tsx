/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// The sidebar (MOCKUP-vault-full-v2) — user-composed shortcuts on top, then the groups that belong
// to whichever section is on screen, then Settings pinned to the bottom behind a gear.
//
// TWO WAYS TO PIN, deliberately (Jason 08-10-2026): "+ Add shortcut" here is the everyday quick-add
// — a pick-list, one click, where you already are. Arranging and removing lives in the Settings
// editor. One list either way; it persists as a row like every other preference, never localStorage.
import { useEffect, useMemo, useState } from "react";
import FolderRail from "./FolderRail";
import NoteFolderRail from "./NoteFolderRail";
import Resizer from "./Resizer";
import { vaultApi, type VaultFolder, type VaultNoteMeta, type VaultRepo, type VaultSecretMeta, type VaultServer } from "./vaultApi";

/** The Vault home tab was REMOVED 08-12-2026 (Jason: "lets just remove that tab altogether") — it
    showed five counts and a sentence, and every number on it already lives on the tab that owns it.
    "errors" replaced it as a reachable surface, but deliberately NOT as a tab: see ErrorsView. */
export type Section = "passwords" | "notes" | "infra" | "repos" | "errors" | "settings";

export interface Shortcut {
  type: "section" | "tool" | "folder" | "entry" | "note" | "server" | "repo";
  id: string;
  label: string;
}

export function parseShortcuts(raw: string | undefined): Shortcut[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as Shortcut[];
    return Array.isArray(v) ? v.filter((s) => s && typeof s.id === "string" && typeof s.label === "string") : [];
  } catch {
    return []; // a malformed row must never take the sidebar down with it
  }
}

const TOOLS: [string, string][] = [
  ["generator", "Generator"],
  ["health", "Health"],
  ["log", "Access log"],
  ["importexport", "Import / Export"],
];

const SECTION_LABELS: Record<Section, string> = {
  passwords: "Passwords", notes: "Secured Notes", infra: "Infrastructure", repos: "Repos", errors: "Activity & errors", settings: "Settings",
};

export interface SidebarProps {
  section: Section;
  secrets: VaultSecretMeta[];
  folders: VaultFolder[];
  filter: string;
  tool: string | null;
  collapsed: boolean;
  shortcuts: Shortcut[];
  onSearch: (v: string) => void;
  onFilter: (f: string) => void;
  onTool: (t: string | null) => void;
  onSection: (s: Section) => void;
  onCollapse: (v: boolean) => void;
  /** Secured Notes folder selection — 0 = All notes, -1 = Unfiled, else a folder id. */
  noteFolder: number;
  onNoteFolder: (id: number) => void;
  /** Bumped whenever notes change, so the tree's counts stay honest. */
  noteReloadKey: number;
  onNotesChanged: () => void;
  onShortcuts: (list: Shortcut[]) => void;
  onFoldersChanged: () => void;
  onAddShortcut: () => void;
  /** Persisted rail width in pixels, and the writer. Jason 08-12-2026 — a 232-pixel rail truncates
   *  an imported folder name to "AvertXAI-BuildersA…", which makes siblings indistinguishable. */
  width: number;
  onWidth: (w: number) => void;
  /** THE LOCK. False = no drag handle and no dial; the rail is a plain border at its saved width. */
  adjustable: boolean;
  /** Expanded note folders, owned by the module because this tree unmounts on every tab switch. */
  openFolders: number[];
  onOpenFolders: (ids: number[]) => void;
}

/**
 * The rail's floor, ceiling and reset.
 *
 * THE CEILING IS SET FROM THE JOB, NOT FROM THE WINDOW (Jason 08-12-2026, on the first pass at 460:
 * "this is waaaaaay too much room to give the user"). The rail exists to show a folder name; once the
 * longest one fits, every further pixel is taken from the editor for nothing.
 *
 * These three are HIS NUMBERS, read off the dial rather than estimated off a screenshot — which is
 * the entire reason the dial exists. Do not re-derive them.
 *
 * It is still only a backstop: the real limit is whatever slack .vault-body has, computed live.
 */
export const SIDE_MIN = 200;
export const SIDE_MAX = 320;
export const SIDE_DEFAULT = 270;

export default function Sidebar(p: SidebarProps) {
  /**
   * THE WIDTH WHILE YOU ARE DRAGGING IT. The prop is the persisted truth; this is what is on screen
   * between pointer-down and release. Local, because the alternative is a database round trip per
   * pointermove — hundreds of them for one drag — and the rail would lag a frame behind the cursor.
   */
  const [live, setLive] = useState(p.width);
  useEffect(() => { setLive(p.width); }, [p.width]);

  const counts = useMemo(() => {
    const active = p.secrets.filter((s) => !s.archived_at);
    return {
      all: active.length,
      favourites: active.filter((s) => s.favourite === 1).length,
      archived: p.secrets.filter((s) => s.archived_at).length,
      byKind: (k: string): number => active.filter((s) => s.kind === k).length,
    };
  }, [p.secrets]);

  const KINDS: [string, string, string][] = [
    ["kind:login", "Logins", "var(--vault-strong-color)"],
    ["kind:api_key", "API keys", "var(--mc-accent-primary)"],
    ["kind:financial", "Financial", "var(--vault-warn-color)"],
    ["kind:taxpayer_id", "Taxpayer IDs", "var(--vault-danger-color)"],
    ["kind:ssh_key", "SSH keys", "var(--vault-note-color)"],
  ];

  const go = (s: Shortcut): void => {
    if (s.type === "section") p.onSection(s.id as Section);
    else if (s.type === "tool") { p.onSection("passwords"); p.onTool(s.id); }
    else if (s.type === "folder") { p.onSection("passwords"); p.onTool(null); p.onFilter(`folder:${s.id}`); }
    else if (s.type === "note") p.onSection("notes");
    else if (s.type === "server") p.onSection("infra");
    else if (s.type === "repo") p.onSection("repos");
    else { p.onSection("passwords"); p.onTool(null); p.onSearch(s.label); }
  };

  return (
    <div
      className={`vault-side${p.collapsed ? " collapsed" : ""}`}
      // Collapsed keeps the CSS 46px; expanded is whatever the user dragged it to. Both width and
      // flex-basis, because the pane is a flex item and flex-basis wins over width where they differ.
      style={p.collapsed ? undefined : { width: live, flexBasis: live }}
    >
      {/* NO "+ New entry" HERE (Jason 08-11-2026: it truncated to a green sliver when the rail
          collapsed — "just remove it altogether"). Nothing is lost: every Passwords view carries its
          own + New entry (EntriesView, CollageView, PanesView), Notes has + New, Repos has + Add
          repo. This was the duplicate, and it was the one that broke. */}
      <div className="vault-sidetop">
        <button className="vault-collapse" title={p.collapsed ? "Expand" : "Collapse"} onClick={() => p.onCollapse(!p.collapsed)}>
          {p.collapsed ? "»" : "«"}
        </button>
      </div>

      <div className="vault-sidescroll">
        {/* The "Search secrets" box moved to the ONE global search at the top of the module
            (Jason 08-11-2026). Two boxes each covering a third of the vault meant you had to know
            where a thing was before you could look for it. */}

        <div className="vault-railhead">
          <span className="sbtxt">Shortcuts</span>
          <button className="vault-addsc sbtxt" onClick={p.onAddShortcut}>+ Add shortcut</button>
        </div>
        {p.shortcuts.length === 0 ? (
          <div className="vault-hint sbtxt" style={{ padding: "2px 9px 6px" }}>Nothing pinned yet.</div>
        ) : (
          p.shortcuts.map((s) => (
            <div key={`${s.type}:${s.id}`} className="vault-railrow shortcut" onClick={() => go(s)}>
              <span className="vault-sbadge">{s.label.slice(0, 1).toUpperCase()}</span>
              <span className="vault-railname">{s.label}</span>
              <button className="vault-scx" title="Remove this shortcut"
                onClick={(e) => { e.stopPropagation(); p.onShortcuts(p.shortcuts.filter((x) => !(x.type === s.type && x.id === s.id))); }}>✕</button>
            </div>
          ))
        )}

        {/* context groups — the sidebar is always about the section you are in */}
        {p.section === "passwords" && (
          <>
            <FolderRail folders={p.folders} secrets={p.secrets} selected={p.filter}
              onSelect={(f) => { p.onTool(null); p.onFilter(f); }} onChanged={p.onFoldersChanged} />
            <div className="vault-railhead"><span className="sbtxt">Vault</span></div>
            <Row on={p.filter === "all" && !p.tool} colour="var(--mc-accent-primary)" label="All items" n={counts.all} onClick={() => { p.onTool(null); p.onFilter("all"); }} />
            <Row on={p.filter === "favourites" && !p.tool} colour="var(--vault-warn-color)" label="Favourites" n={counts.favourites} onClick={() => { p.onTool(null); p.onFilter("favourites"); }} />
            <Row on={p.filter === "archived" && !p.tool} colour="var(--mc-dimmer)" label="Archived" n={counts.archived} onClick={() => { p.onTool(null); p.onFilter("archived"); }} />
            <div className="vault-railhead"><span className="sbtxt">Types</span></div>
            {KINDS.map(([k, label, colour]) => (
              <Row key={k} on={p.filter === k && !p.tool} colour={colour} label={label} n={counts.byKind(k.slice(5))} onClick={() => { p.onTool(null); p.onFilter(k); }} />
            ))}
            <div className="vault-railhead"><span className="sbtxt">Password tools</span></div>
            {TOOLS.map(([t, label]) => (
              <Row key={t} on={p.tool === t} colour="var(--vault-note-color)" label={label} onClick={() => p.onTool(t)} />
            ))}
          </>
        )}

        {p.section === "notes" && (
          <>
            {/* The folder tree lives HERE, under Shortcuts (Jason 08-11-2026) — same place the
                Passwords rail puts its folders, so the two surfaces read the same way. */}
            <NoteFolderRail
              selected={p.noteFolder}
              onSelect={p.onNoteFolder}
              reloadKey={p.noteReloadKey}
              onChanged={p.onNotesChanged}
              open={p.openFolders}
              onOpen={p.onOpenFolders}
            />
            <div className="vault-hint sbtxt" style={{ padding: "6px 9px" }}>
              Notes, Runbooks and Snippets switch inside the pane — the three buttons above the list.
              They share this one tree.
            </div>
          </>
        )}

        {p.section === "infra" && (
          <>
            <div className="vault-railhead"><span className="sbtxt">Infrastructure</span></div>
            <Row on colour="var(--vault-strong-color)" label="Servers & DNS" onClick={() => p.onSection("infra")} />
            <Row colour="var(--vault-note-color)" label="SSH keys" n={p.secrets.filter((s) => s.kind === "ssh_key" && !s.archived_at).length} onClick={() => p.onSection("infra")} />
            {/* Between SSH keys and Import records, matching the tab strip (Jason 08-11-2026). */}
            <Row colour="var(--vault-warn-color)" label="Package ledger" onClick={() => p.onSection("infra")} />
            <Row colour="var(--mc-muted)" label="Import records" onClick={() => p.onSection("infra")} />
          </>
        )}

        {p.section === "repos" && (
          <>
            <div className="vault-railhead"><span className="sbtxt">Repos</span></div>
            <Row on colour="var(--mc-text)" label="Repositories" onClick={() => p.onSection("repos")} />
          </>
        )}

        {p.section === "errors" && (
          <>
            <div className="vault-railhead"><span className="sbtxt">Diagnostics</span></div>
            <Row on colour="var(--vault-danger-color)" label="Activity & errors" onClick={() => p.onSection("errors")} />
            <div className="vault-hint sbtxt" style={{ padding: "6px 9px" }}>
              Every failure the vault records, newest first. It updates itself.
            </div>
          </>
        )}

        {p.section === "settings" && (
          <>
            <div className="vault-railhead"><span className="sbtxt">Diagnostics</span></div>
            <Row colour="var(--vault-danger-color)" label="Activity & errors" onClick={() => p.onSection("errors")} />
            <div className="vault-railhead"><span className="sbtxt">Settings</span></div>
            <Row on colour="var(--mc-accent-primary)" label="Sidebar editor" onClick={() => p.onSection("settings")} />
            <Row colour="var(--mc-dimmer)" label="Lock & data" onClick={() => p.onSection("settings")} />
          </>
        )}

      </div>

      <div className="vault-sidefoot">
        <button className={`vault-gear${p.section === "settings" ? " on" : ""}`} onClick={() => p.onSection("settings")}>
          <span className="vault-gearicon" aria-hidden="true">⚙</span>
          <span className="vault-railname sbtxt">Settings</span>
        </button>
      </div>

      {/* The neighbour is .vault-body — everything right of the rail — and its floor is 560, which is
          not a round number: it is the note list's own minimum (200) plus the editor's (320) plus the
          borders between them. Set lower and widening the rail at a 740-pixel window would squeeze
          the editor below its floor from the other side of the layout. At 740 the body is already
          508, so this correctly yields zero slack and the rail simply will not widen there. */}
      {!p.collapsed && p.adjustable && (
        <Resizer
          width={live}
          min={SIDE_MIN}
          max={SIDE_MAX}
          reset={SIDE_DEFAULT}
          neighbour={{ selector: ".vault-body", min: 560 }}
          onDrag={setLive}
          onDone={p.onWidth}
          label="Sidebar width"
        />
      )}
    </div>
  );
}

function Row({ on, colour, label, n, onClick }: { on?: boolean; colour: string; label: string; n?: number; onClick: () => void }) {
  return (
    <button className={`vault-railrow${on ? " on" : ""}`} onClick={onClick} title={label}>
      <span className="vault-raildot" style={{ background: colour }} />
      <span className="vault-railname">{label}</span>
      {n !== undefined && <span className="vault-railcount">{n}</span>}
    </button>
  );
}

/** The quick-add pick list. Everything pinnable, grouped, with what is already pinned marked. */
export function ShortcutModal({
  secrets, folders, shortcuts, onClose, onChange,
}: {
  secrets: VaultSecretMeta[];
  folders: VaultFolder[];
  shortcuts: Shortcut[];
  onClose: () => void;
  onChange: (list: Shortcut[]) => void;
}) {
  const api = vaultApi();
  const [q, setQ] = useState("");
  const [notes, setNotes] = useState<VaultNoteMeta[]>([]);
  const [servers, setServers] = useState<VaultServer[]>([]);
  const [repos, setRepos] = useState<VaultRepo[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    void api.listNotes(undefined, false, undefined, 60).then((r) => setNotes(r.rows)).catch(() => undefined);
    void api.listServers().then(setServers).catch(() => undefined);
    void api.listRepos().then(setRepos).catch(() => undefined);
    return () => window.removeEventListener("keydown", onKey);
  }, [api, onClose]);

  const has = (t: Shortcut["type"], id: string): boolean => shortcuts.some((s) => s.type === t && s.id === id);
  const add = (s: Shortcut): void => { if (!has(s.type, s.id)) onChange([...shortcuts, s]); };
  /** The other half of the toggle — unpin from here rather than making the user go hunting. */
  const drop = (s: Shortcut): void => onChange(shortcuts.filter((x) => !(x.type === s.type && x.id === s.id)));
  const match = (label: string): boolean => q.trim() === "" || label.toLowerCase().includes(q.trim().toLowerCase());

  const groups: [string, Shortcut[]][] = [
    ["Sections", (["passwords", "notes", "infra", "repos"] as Section[]).map((s) => ({ type: "section" as const, id: s, label: SECTION_LABELS[s] }))],
    ["Tools", TOOLS.map(([id, label]) => ({ type: "tool" as const, id, label }))],
    ["Folders", folders.map((f) => ({ type: "folder" as const, id: String(f.id), label: f.name }))],
    ["Notes & runbooks", notes.slice(0, 30).map((n) => ({ type: "note" as const, id: n.uuid, label: n.title }))],
    ["Servers", servers.map((s) => ({ type: "server" as const, id: s.uuid, label: s.host }))],
    ["Repos", repos.map((r) => ({ type: "repo" as const, id: r.uuid, label: r.name }))],
    ["Entries", secrets.filter((s) => !s.archived_at).slice(0, 40).map((s) => ({ type: "entry" as const, id: s.uuid, label: s.label }))],
  ];

  return (
    <div className="vault-modalback" onClick={onClose}>
      <div className="vault-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Add a shortcut</h3>
        <div className="vault-modalsub">Pin anything you jump to often — it appears at the top of the sidebar.</div>
        <input className="vault-sidesearch" style={{ marginBottom: 10 }} autoFocus placeholder="Search sections, tools, folders, entries, servers, repos"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="vault-picklist">
          {groups.map(([name, items]) => {
            const shown = items.filter((i) => match(i.label));
            if (shown.length === 0) return null;
            return (
              <div key={name}>
                <div className="vault-railhead" style={{ marginLeft: 2 }}>{name}</div>
                {shown.map((i) => {
                  const already = has(i.type, i.id);
                  return (
                    <div key={`${i.type}:${i.id}`} className={`vault-pick${already ? " added" : ""}`}>
                      <span className="vault-sbadge">{i.label.slice(0, 1).toUpperCase()}</span>
                      <span className="vault-pickname"><b>{i.label}</b><span className="s">{i.type}</span></span>
                      {/* A TOGGLE, not a dead "Added ✓" (Jason 08-12-2026). Pinning the wrong thing
                          used to mean closing this, finding it in the sidebar, and removing it
                          there — three moves to undo one mistaken click. */}
                      <button
                        className={`vault-btn sm${already ? " danger" : ""}`}
                        onClick={() => (already ? drop(i) : add(i))}
                      >
                        {already ? "Remove" : "Add"}
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="vault-modalacts"><button className="vault-btn primary" onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}
