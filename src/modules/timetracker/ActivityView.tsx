/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// TimeTracker Activity — the append-only event log, newest first, filterable by project.
// READ-ONLY: events are written by the timer engine alone; this view never writes anything.
import { useCallback, useEffect, useState } from "react";
import type { TimeTrackerEventLogRow, TimeTrackerProjectListItem } from "../../shared/types";

interface Props {
  projects: TimeTrackerProjectListItem[];
}

const fmtTs = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
};

export default function ActivityView({ projects }: Props) {
  const api = window.api;
  const [rows, setRows] = useState<TimeTrackerEventLogRow[] | null>(null);
  const [filter, setFilter] = useState<number | "all">("all");

  const reload = useCallback((): void => {
    void api.timetracker.activity
      .list(filter === "all" ? {} : { projectId: filter })
      .then(setRows)
      .catch(() => setRows([]));
  }, [api, filter]);
  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <div className="tt-panel">
      <div className="tt-toolrow" style={{ marginBottom: 8 }}>
        <select className="tt-input tt-select" value={filter === "all" ? "all" : String(filter)} aria-label="Filter by project"
          onChange={(e) => setFilter(e.target.value === "all" ? "all" : Number(e.target.value))}>
          <option value="all">All projects</option>
          {projects.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
        </select>
        <button className="tt-iconbtn" onClick={reload}>Refresh</button>
      </div>
      {rows === null && <div className="tt-emptyrow">Loading…</div>}
      {rows !== null && rows.length === 0 && <div className="tt-emptyrow">No activity yet — start a timer and it lands here.</div>}
      {rows?.map((e) => (
        <div key={e.id} className="tt-event">
          <span className="tt-eventts">{fmtTs(e.ts)}</span>
          <span className={`tt-eventtype ${e.event_type}`}>{e.event_type}</span>
          <span className="tt-eventbody">
            {e.project_name}
            {e.detail && <span className="tt-eventdetail"> — {e.detail}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
