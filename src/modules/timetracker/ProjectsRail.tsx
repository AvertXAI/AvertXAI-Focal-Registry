/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// TimeTracker nested Projects rail — fixed 240px column (mockup option 1): header with active
// count, search, + New, the drag hint, SORT toggles, then the grouped tree. Search filters
// locally on name / client / note text; the tree itself lives in ProjectTree.
import { useState } from "react";
import type { TimeTrackerGroup, TimeTrackerGroupTotalRow, TimeTrackerProjectListItem, TimeTrackerSidebarSortDir } from "../../shared/types";
import ProjectTree from "./ProjectTree";

interface Props {
  projects: TimeTrackerProjectListItem[];
  groups: TimeTrackerGroup[];
  totals: TimeTrackerGroupTotalRow[];
  sortDir: TimeTrackerSidebarSortDir;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onNew: () => void;
  onSort: (dir: "asc" | "desc") => void;
  onReorder: (dragId: number, targetId: number) => void;
  onRegroup: (dragId: number, groupId: number | null) => void;
  /** Opens the Archive tab (the rail's box glyph beside the header). */
  onOpenArchive: () => void;
  /** Collapse state lives in the MODULE (cache + app_settings) — never here; local state dies on remount. */
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export default function ProjectsRail({ projects, groups, totals, sortDir, selectedId, onSelect, onNew, onSort, onReorder, onRegroup, onOpenArchive, collapsed, onToggleCollapse }: Props) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = q === ""
    ? projects
    : projects.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        p.client_name.toLowerCase().includes(q) ||
        (p.note_body ?? "").toLowerCase().includes(q)
      );

  // Collapsed: a narrow strip of project colour dots that still select on click, plus the expander.
  if (collapsed) {
    return (
      <aside className="tt-rail collapsed" aria-label="Projects (collapsed)">
        <button className="tt-railtoggle" title="Expand the projects rail" aria-label="Expand the projects rail" onClick={onToggleCollapse}>»</button>
        <div className="tt-raildots">
          {projects.map((p) => (
            <button
              key={p.id}
              className={"tt-raildot" + (p.id === selectedId ? " on" : "")}
              style={{ background: p.color }}
              title={p.name}
              aria-label={`Select ${p.name}`}
              onClick={() => onSelect(p.id)}
            />
          ))}
        </div>
      </aside>
    );
  }

  return (
    <aside className="tt-rail" aria-label="Projects">
      <div className="tt-railhead">
        <span className="tt-railtitle">Projects</span>
        <span className="tt-railcount">{projects.length}</span>
        <button className="tt-railtoggle" title="Collapse the projects rail" aria-label="Collapse the projects rail" onClick={onToggleCollapse}>«</button>
        <button className="tt-archbtn" title="Archived projects" aria-label="Open the archive" onClick={onOpenArchive}>
          <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 3h12v3H2zM3 6v6.3a.7.7 0 0 0 .7.7h8.6a.7.7 0 0 0 .7-.7V6M6.5 8.6h3" />
          </svg>
        </button>
      </div>
      <div className="tt-railsearch">
        <input
          className="tt-input"
          placeholder="Search projects or clients..."
          value={query}
          aria-label="Search projects or clients"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <button className="tt-newbtn" onClick={onNew}>＋ New project</button>
      <div className="tt-railhint">Drag to reorder, or onto a folder to regroup</div>
      <div className="tt-sorthead">
        <span>Sort</span>
        <span className="tt-sortacts">
          <button
            className={"tt-sortbtn" + (sortDir === "asc" ? " on" : "")}
            title="Sort A to Z"
            aria-label="Sort A to Z"
            onClick={() => onSort("asc")}
          >A→Z</button>
          <button
            className={"tt-sortbtn" + (sortDir === "desc" ? " on" : "")}
            title="Sort Z to A"
            aria-label="Sort Z to A"
            onClick={() => onSort("desc")}
          >Z→A</button>
        </span>
      </div>
      <div className="tt-tree">
        <ProjectTree
          projects={filtered}
          groups={groups}
          totals={totals}
          selectedId={selectedId}
          onSelect={onSelect}
          onReorder={onReorder}
          onRegroup={onRegroup}
        />
        {projects.length === 0 && (
          <div className="tt-railempty">No projects yet — create the first one above.</div>
        )}
        {projects.length > 0 && filtered.length === 0 && (
          <div className="tt-railempty">Nothing matches “{query.trim()}”.</div>
        )}
      </div>
    </aside>
  );
}
