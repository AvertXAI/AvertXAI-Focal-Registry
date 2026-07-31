/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// TimeTracker Logbook — READ-ONLY mirror of the database: group header rows (folder), then that
// folder's projects with name, type badge, total time, last-worked date, and group. Search filters
// the visible rows locally. NO Export CSV, NO Import CSV — canon defers CSV; the buttons do not
// exist here on purpose.
import { useState } from "react";
import type { TimeTrackerGroup, TimeTrackerProjectListItem } from "../../shared/types";

interface Props {
  projects: TimeTrackerProjectListItem[];
  groups: TimeTrackerGroup[];
}

const fmtDuration = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const fmtDate = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
};

function TypeBadge({ p }: { p: TimeTrackerProjectListItem }) {
  if (p.rate_type === "hourly") return <span className="tt-badge hourly">Hourly</span>;
  if (p.contract_kind === "donated") return <span className="tt-badge donated">Donated</span>;
  return <span className="tt-badge">Contract</span>;
}

export default function LogbookView({ projects, groups }: Props) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visible = q === ""
    ? projects
    : projects.filter((p) => p.name.toLowerCase().includes(q) || p.client_name.toLowerCase().includes(q) || (p.group_name ?? "").toLowerCase().includes(q));

  const sections: Array<{ label: string; members: TimeTrackerProjectListItem[] }> = [
    ...groups.map((g) => ({ label: g.name, members: visible.filter((p) => p.group_id === g.id) })),
    { label: "Ungrouped", members: visible.filter((p) => p.group_id == null) },
  ].filter((s) => s.members.length > 0);

  return (
    <div className="tt-panel">
      <div className="tt-toolrow" style={{ marginBottom: 10 }}>
        <input className="tt-input" placeholder="Search the logbook…" value={query} aria-label="Search logbook"
          onChange={(e) => setQuery(e.target.value)} />
      </div>
      <table className="tt-table">
        <thead>
          <tr><th>Project</th><th>Client</th><th>Type</th><th>Total time</th><th>Last worked</th><th>Group</th></tr>
        </thead>
        <tbody>
          {sections.map((s) => (
            [
              <tr key={`g:${s.label}`} className="tt-grouprow"><td colSpan={6}>{s.label}</td></tr>,
              ...s.members.map((p) => (
                <tr key={p.id}>
                  <td><span className="tt-namecell"><span className="tt-dot" style={{ background: p.color }} />{p.name}</span></td>
                  <td className="dim">{p.client_name}</td>
                  <td><TypeBadge p={p} /></td>
                  <td className="mono">{fmtDuration(p.total_seconds)}</td>
                  <td className="mono dim">{fmtDate(p.last_worked)}</td>
                  <td className="dim">{p.group_name ?? "—"}</td>
                </tr>
              )),
            ]
          ))}
        </tbody>
      </table>
      {sections.length === 0 && <div className="tt-emptyrow">{projects.length === 0 ? "Nothing logged yet." : `Nothing matches “${query.trim()}”.`}</div>}
    </div>
  );
}
