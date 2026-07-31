/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// TimeTracker Archive — archived projects (newest archive first, service-ordered) with Restore.
// Restore returns the project to the tree with its data intact; archiving happens from the
// project detail panel. Permanent purge is deliberately NOT here — this phase's scope is restore.
import { useCallback, useEffect, useState } from "react";
import type { TimeTrackerProjectListItem } from "../../shared/types";

interface Props {
  /** Archive/restore moves projects between the tree and here — the module reloads both. */
  onDataChanged: () => void;
}

const fmtDuration = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const fmtTs = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
};

export default function ArchiveView({ onDataChanged }: Props) {
  const api = window.api;
  const [rows, setRows] = useState<TimeTrackerProjectListItem[] | null>(null);

  const reload = useCallback((): void => {
    void api.timetracker.projects.listArchived().then(setRows).catch(() => setRows([]));
  }, [api]);
  useEffect(() => {
    reload();
  }, [reload]);

  const restore = (id: number): void => {
    void api.timetracker.projects.restore(id).then(() => { reload(); onDataChanged(); }).catch(() => {});
  };

  return (
    <div className="tt-panel">
      {rows === null && <div className="tt-emptyrow">Loading…</div>}
      {rows !== null && rows.length === 0 && <div className="tt-emptyrow">Nothing archived. Archiving lives on the project detail panel.</div>}
      {rows?.map((p) => (
        <div key={p.id} className="tt-archrow">
          <span className="tt-namecell">
            <span className="tt-dot" style={{ background: p.color }} />
            <span className="tt-projname">{p.name}</span>
            <span className="tt-badge">{p.client_name}</span>
          </span>
          <span className="tt-adjts">{fmtDuration(p.total_seconds)} · archived {fmtTs(p.archived_at)}</span>
          <button className="tt-iconbtn" onClick={() => restore(p.id)}>Restore</button>
          {p.archive_reason && <div className="tt-archreason">“{p.archive_reason}”</div>}
        </div>
      ))}
    </div>
  );
}
