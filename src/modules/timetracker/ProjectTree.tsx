/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// TimeTracker grouped project tree — group rows (name, committed hours, project count) and
// project rows (colour dot, name, hours). Selection drives the detail panel. Drag a project row
// onto another project to reorder (same group) or onto a group header to regroup; the module
// resolves which channel that means. Group collapse is view-local (resets on remount) — persisting
// it would need a settings key, which is not in this phase's scope.
import { useState, type DragEvent } from "react";
import type { TimeTrackerGroup, TimeTrackerGroupTotalRow, TimeTrackerProjectListItem } from "../../shared/types";
import { fmtHours } from "./TimeTrackerModule";

interface Props {
  projects: TimeTrackerProjectListItem[];
  groups: TimeTrackerGroup[];
  totals: TimeTrackerGroupTotalRow[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onReorder: (dragId: number, targetId: number) => void;
  onRegroup: (dragId: number, groupId: number | null) => void;
}

const DRAG_MIME = "application/x-timetracker-project";

export default function ProjectTree({ projects, groups, totals, selectedId, onSelect, onReorder, onRegroup }: Props) {
  const [collapsed, setCollapsed] = useState<Set<number | null>>(() => new Set());
  const [dragOver, setDragOver] = useState<string | null>(null); // "g:<id>" | "p:<id>" — drop-target highlight

  const toggle = (gid: number | null): void =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(gid)) next.delete(gid);
      else next.add(gid);
      return next;
    });

  const totalFor = (gid: number | null): number => totals.find((t) => (t.group_id ?? null) === gid)?.total_seconds ?? 0;
  const membersOf = (gid: number | null): TimeTrackerProjectListItem[] =>
    projects.filter((p) => (p.group_id ?? null) === gid);

  const dragId = (e: DragEvent): number | null => {
    const raw = e.dataTransfer.getData(DRAG_MIME);
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  };

  // Sections: every group in sort order, then Ungrouped last (only when it has members —
  // rendering an empty Ungrouped header would be noise, and it still works as a drop target
  // via any group header when it exists).
  const sections: Array<{ gid: number | null; label: string }> = [
    ...groups.map((g) => ({ gid: g.id as number | null, label: g.name })),
    ...(membersOf(null).length > 0 ? [{ gid: null as number | null, label: "Ungrouped" }] : []),
  ];

  return (
    <div role="tree" aria-label="Projects by group">
      {sections.map(({ gid, label }) => {
        const members = membersOf(gid);
        const isCollapsed = collapsed.has(gid);
        const key = gid === null ? "null" : String(gid);
        return (
          <div key={key}>
            <div
              className={"tt-group" + (dragOver === `g:${key}` ? " dragover" : "")}
              role="treeitem"
              aria-expanded={!isCollapsed}
              onClick={() => toggle(gid)}
              onDragOver={(e) => { e.preventDefault(); setDragOver(`g:${key}`); }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                const id = dragId(e);
                if (id !== null) onRegroup(id, gid);
              }}
            >
              <span className="tt-caret">{isCollapsed ? "▸" : "▾"}</span>
              <span className="tt-groupname">{label}</span>
              <span className="tt-grouptotal">{fmtHours(totalFor(gid))}</span>
              <span className="tt-groupcount">{members.length}</span>
            </div>
            {!isCollapsed &&
              members.map((p) => (
                <div
                  key={p.id}
                  className={
                    "tt-project" + (p.id === selectedId ? " sel" : "") + (dragOver === `p:${p.id}` ? " dragover" : "")
                  }
                  role="treeitem"
                  aria-selected={p.id === selectedId}
                  draggable
                  onClick={() => onSelect(p.id)}
                  onDragStart={(e) => e.dataTransfer.setData(DRAG_MIME, String(p.id))}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(`p:${p.id}`); }}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(null);
                    const id = dragId(e);
                    if (id !== null) onReorder(id, p.id);
                  }}
                >
                  {/* the dot is user DATA colour, not theme — inline style is correct here */}
                  <span className="tt-dot" style={{ background: p.color }} />
                  <span className="tt-projname">{p.name}</span>
                  <span className="tt-projhours">{fmtHours(p.total_seconds)}</span>
                </div>
              ))}
          </div>
        );
      })}
    </div>
  );
}
