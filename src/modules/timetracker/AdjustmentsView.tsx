/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// TimeTracker Adjustments — a MONEY SURFACE. Project filter, ＋ Add Adjustment, and the list:
// signed delta (+10h 00m, green positive / red negative), project dot + name, reason, timestamp,
// and the three row actions (history · edit · delete). Deletes are SOFT and keep the audit trail;
// sessions are never modified. Every write goes through the validated timetracker:* channels
// (vDeltaMinutes/vAdjustmentUuid guard main-side) — never a generic channel.
import { useCallback, useEffect, useState } from "react";
import type { TimeTrackerAdjustmentListItem, TimeTrackerProjectListItem } from "../../shared/types";
import Tip from "../../components/Tip";
import EmployeesCard from "../employees/EmployeesCard";

interface Props {
  projects: TimeTrackerProjectListItem[];
  /** Totals change everywhere an adjustment lands — the module reloads projects/totals. */
  onDataChanged: () => void;
}

const fmtDelta = (deltaMinutes: number): string => {
  const sign = deltaMinutes >= 0 ? "+" : "−";
  const abs = Math.abs(deltaMinutes);
  return `${sign}${Math.floor(abs / 60)}h ${String(abs % 60).padStart(2, "0")}m`;
};
const fmtTs = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

interface EditorState {
  adj: TimeTrackerAdjustmentListItem | null; // null = creating
  projectId: number | null;
  direction: 1 | -1;
  hours: string;
  minutes: string;
  note: string;
}

export default function AdjustmentsView({ projects, onDataChanged }: Props) {
  const api = window.api;
  const [rows, setRows] = useState<TimeTrackerAdjustmentListItem[] | null>(null);
  const [filter, setFilter] = useState<number | "all">("all");
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback((): void => {
    const op = filter === "all" ? api.timetracker.adjustments.listAll() : api.timetracker.adjustments.list(filter);
    void op.then(setRows).catch(() => setRows([]));
  }, [api, filter]);
  useEffect(() => {
    reload();
  }, [reload]);

  const openNew = (): void => {
    setError(null);
    setEditor({
      adj: null,
      projectId: filter === "all" ? projects[0]?.id ?? null : filter,
      direction: 1,
      hours: "0",
      minutes: "0",
      note: "",
    });
  };
  const openEdit = (adj: TimeTrackerAdjustmentListItem): void => {
    setError(null);
    setEditor({
      adj,
      projectId: adj.project_id,
      direction: adj.delta_minutes >= 0 ? 1 : -1,
      hours: String(Math.floor(Math.abs(adj.delta_minutes) / 60)),
      minutes: String(Math.abs(adj.delta_minutes) % 60),
      note: adj.note,
    });
  };

  const save = (): void => {
    if (!editor) return;
    const h = Number(editor.hours) || 0;
    const m = Number(editor.minutes) || 0;
    const delta = editor.direction * (h * 60 + m);
    // The service validates too (vDeltaMinutes: non-zero, bounded; note required) — these local
    // checks only give a friendlier message before the round-trip.
    if (delta === 0) { setError("The adjustment must be more than zero minutes."); return; }
    if (editor.note.trim() === "") { setError("A note explaining the adjustment is required."); return; }
    const done = (): void => { setEditor(null); reload(); onDataChanged(); };
    const fail = (e: unknown): void => setError(e instanceof Error ? e.message : String(e));
    if (editor.adj) {
      void api.timetracker.adjustments.update(editor.adj.uuid, delta, editor.note).then(done).catch(fail);
    } else {
      if (editor.projectId == null) { setError("Pick a project."); return; }
      void api.timetracker.adjustments.create(editor.projectId, delta, editor.note).then(done).catch(fail);
    }
  };

  const softDelete = (adj: TimeTrackerAdjustmentListItem): void => {
    void api.timetracker.adjustments.softDelete(adj.uuid).then(() => { reload(); onDataChanged(); }).catch(() => {});
  };

  return (
    <div className="tt-panel">
      {/* EMPLOYEES leads the tab (approved placement). Its Adjust button navigates to Employees'
          OWN Adjustments tab — never this form, which writes timetracker_adjustments, a different
          table with no employee column. */}
      <EmployeesCard />
      <div className="tt-toolrow" style={{ marginBottom: 8 }}>
        <select className="tt-input tt-select" value={filter === "all" ? "all" : String(filter)} aria-label="Filter by project"
          onChange={(e) => setFilter(e.target.value === "all" ? "all" : Number(e.target.value))}>
          <option value="all">All projects</option>
          {projects.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
        </select>
        <button className="tt-btn start" onClick={openNew} disabled={projects.length === 0}>＋ Add Adjustment</button>
      </div>

      {rows === null && <div className="tt-emptyrow">Loading…</div>}
      {rows !== null && rows.length === 0 && <div className="tt-emptyrow">No adjustments{filter !== "all" ? " for this project" : ""} yet.</div>}
      {rows?.map((a) => (
        <div key={a.uuid} className={"tt-adj" + (a.deleted_at ? " deleted" : "")}>
          <span className={"tt-delta " + (a.delta_minutes >= 0 ? "pos" : "neg")}>{fmtDelta(a.delta_minutes)}</span>
          <div className="tt-adjmain">
            <span className="tt-namecell"><span className="tt-dot" style={{ background: a.project_color }} />{a.project_name}</span>
            <div className="tt-adjreason">{a.note}</div>
            <div className="tt-adjts">{fmtTs(a.created_at)}{a.deleted_at ? ` · deleted ${fmtTs(a.deleted_at)}` : ""}</div>
          </div>
          <div className="tt-adjacts">
            <button className="tt-iconbtn" onClick={() => setHistoryFor(historyFor === a.uuid ? null : a.uuid)}>History</button>
            {!a.deleted_at && <button className="tt-iconbtn" onClick={() => openEdit(a)}>Edit</button>}
            {!a.deleted_at && <button className="tt-iconbtn danger" onClick={() => softDelete(a)}>Delete</button>}
          </div>
          {historyFor === a.uuid && (
            <div className="tt-audit">
              {a.audit_log.map((e, i) => (
                <div key={i}>
                  <b>{e.action}</b> · {fmtTs(e.at)}
                  {e.action === "created" && e.delta_minutes != null ? ` — ${fmtDelta(e.delta_minutes)} · “${e.note ?? ""}”` : ""}
                  {e.action === "edited" && e.from && e.to
                    ? ` — ${fmtDelta(e.from.delta_minutes)} “${e.from.note}” → ${fmtDelta(e.to.delta_minutes)} “${e.to.note}”`
                    : ""}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      <Tip id="TIP-TT-002" />

      {editor && (
        <div className="tt-modalback" onClick={() => setEditor(null)}>
          <div className="tt-modal" role="dialog" aria-label={editor.adj ? "Edit adjustment" : "Add adjustment"} onClick={(e) => e.stopPropagation()}>
            <div className="tt-modalhead">{editor.adj ? "Edit adjustment" : "Add adjustment"}</div>
            {!editor.adj && (
              <label className="tt-field">
                <span>Project</span>
                <select className="tt-input" value={editor.projectId != null ? String(editor.projectId) : ""}
                  onChange={(e) => setEditor({ ...editor, projectId: e.target.value === "" ? null : Number(e.target.value) })}>
                  <option value="">Pick a project…</option>
                  {projects.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
                </select>
              </label>
            )}
            <div className="tt-fieldrow">
              <label className="tt-field">
                <span>Direction</span>
                <select className="tt-input" value={editor.direction === 1 ? "add" : "subtract"}
                  onChange={(e) => setEditor({ ...editor, direction: e.target.value === "add" ? 1 : -1 })}>
                  <option value="add">＋ Add time</option>
                  <option value="subtract">− Subtract time</option>
                </select>
              </label>
              <label className="tt-field">
                <span>Hours</span>
                <input className="tt-input" inputMode="numeric" value={editor.hours} onChange={(e) => setEditor({ ...editor, hours: e.target.value })} />
              </label>
              <label className="tt-field">
                <span>Minutes</span>
                <input className="tt-input" inputMode="numeric" value={editor.minutes} onChange={(e) => setEditor({ ...editor, minutes: e.target.value })} />
              </label>
            </div>
            <label className="tt-field">
              <span>Why? (required — this is the audit trail)</span>
              <textarea className="tt-input tt-textarea" value={editor.note} onChange={(e) => setEditor({ ...editor, note: e.target.value })} />
            </label>
            {error && <div className="tt-error">{error}</div>}
            <div className="tt-modalacts">
              <button className="tt-btn ghost" onClick={() => setEditor(null)}>Cancel</button>
              <button className="tt-btn start" onClick={save}>{editor.adj ? "Save changes" : "Add adjustment"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
