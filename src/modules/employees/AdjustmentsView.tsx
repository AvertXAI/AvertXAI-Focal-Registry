/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// The Employees ADJUSTMENTS tab — pulled forward from 3C into 3B.2-A so Part 2's Adjust button has
// a real destination to land on.
//
// A MONEY SURFACE, and the invariants are the point of the whole feature:
//   · Entries and sessions are NEVER modified. employee_entries has no update path anywhere in the
//     service layer (entries.ts is INSERT-and-read only) — a correction is its own row here.
//   · Deletes are SOFT. The row stays, struck through, and can be restored; the audit trail keeps
//     both the deletion and the restore.
//   · HOURS and AMOUNT are two different operations, and the database enforces the split with CHECK
//     constraints (db.ts). An hours correction REQUIRES a project and carries its own mandatory
//     rate; an amount correction takes no project and no rate. This form never blurs them.
//
// These corrections DO move the balance: reports.balanceFor folds both kinds in — verified against
// the service this phase, see the report.
import { useCallback, useEffect, useState } from "react";
import type {
  EmployeeAdjustment,
  EmployeePerson,
  TimeTrackerProjectListItem,
} from "../../shared/types";
import { explainEmployeesError, type EmployeesErrorExplanation } from "./empErrors";
import { fmtMoney, normalizeMoney } from "./format";

interface Props {
  people: EmployeePerson[];
  /** null = "everyone"; a person id scopes the list. Part 2's Adjust button drives this. */
  personFilter: number | null;
  onPersonFilter: (id: number | null) => void;
  /** Bumped when a correction lands so the ledger and the balance cards refresh behind this tab. */
  onDataChanged: () => void;
  /** The module bumps this on every timetracker:changed push — the tab re-reads while OPEN, so a
      seed, a purge or a write on another surface shows here without switching tabs (08-06). */
  refreshKey: number;
}

type Editor =
  | { mode: "new"; kind: "hours" | "amount" }
  | { mode: "edit"; adj: EmployeeAdjustment }
  | null;

/** +10h 00m / −2h 30m. Minutes are the stored unit; hours are only how a person reads them. */
function fmtDelta(deltaMinutes: number): string {
  const sign = deltaMinutes >= 0 ? "+" : "−";
  const abs = Math.abs(deltaMinutes);
  return `${sign}${Math.floor(abs / 60)}h ${String(abs % 60).padStart(2, "0")}m`;
}
const fmtTs = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
};

export default function AdjustmentsView({ people, personFilter, onPersonFilter, onDataChanged, refreshKey }: Props) {
  const api = window.api;
  const [rows, setRows] = useState<EmployeeAdjustment[] | null>(null);
  const [error, setError] = useState(false);
  const [editor, setEditor] = useState<Editor>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [projects, setProjects] = useState<TimeTrackerProjectListItem[]>([]);

  const load = useCallback((): void => {
    setError(false);
    setRows(null);
    const op =
      personFilter === null ? api.employees.adjustments.listAll() : api.employees.adjustments.list(personFilter);
    void op.then(setRows).catch((e: unknown) => {
      // An empty table must never stand in for a failed read.
      console.error("[employees] adjustments read failed:", e);
      setError(true);
    });
  }, [api, personFilter, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    void api.timetracker.projects.list().then(setProjects).catch(() => setProjects([]));
  }, [api]);

  const afterWrite = (): void => {
    setEditor(null);
    load();
    onDataChanged();
  };

  const softDelete = (uuid: string): void => {
    setBusy(uuid);
    void api.employees.adjustments
      .softDelete(uuid)
      .then(afterWrite)
      .catch((e: unknown) => console.error("[employees] adjustment delete failed:", e))
      .finally(() => setBusy(null));
  };
  const restore = (uuid: string): void => {
    setBusy(uuid);
    void api.employees.adjustments
      .restore(uuid)
      .then(afterWrite)
      .catch((e: unknown) => console.error("[employees] adjustment restore failed:", e))
      .finally(() => setBusy(null));
  };

  const nameOf = (id: number): string => people.find((p) => p.id === id)?.name ?? "—";

  return (
    <>
      <div className="emp-toolrow">
        <select
          className="emp-input"
          aria-label="Filter by person"
          value={personFilter === null ? "all" : String(personFilter)}
          onChange={(e) => onPersonFilter(e.target.value === "all" ? null : Number(e.target.value))}
        >
          <option value="all">Everyone</option>
          {people.map((p) => (
            <option key={p.id} value={String(p.id)}>
              {p.name}
            </option>
          ))}
        </select>
        <button className="emp-btn" disabled={people.length === 0} onClick={() => setEditor({ mode: "new", kind: "hours" })}>
          ＋ Adjust hours
        </button>
        <button
          className="emp-btn primary"
          disabled={people.length === 0}
          onClick={() => setEditor({ mode: "new", kind: "amount" })}
        >
          ＋ Adjust amount
        </button>
      </div>

      <div className="emp-note">
        Corrections never touch a logged entry. Each one is its own record, and deleting it hides it
        without removing the history.
      </div>

      {error ? (
        <div className="emp-state error" role="alert">
          <b>Couldn&apos;t load the corrections.</b>
          Nothing is shown rather than an empty list. Reopen the tab to try again — nothing has been
          changed.
        </div>
      ) : rows === null ? (
        <div className="emp-state">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="emp-state">
          No corrections{personFilter !== null ? " for this person" : ""} yet. Use the buttons above
          when hours or an amount needs fixing after the fact.
        </div>
      ) : (
        <div className="emp-tablewrap">
          <table className="emp-table">
            <thead>
              <tr>
                <th>Change</th><th>Person</th><th>Project</th><th>Reason</th><th>Date</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const deleted = a.deleted_at !== null;
                const isHours = a.kind === "hours";
                const value = isHours ? (a.delta_minutes ?? 0) : (a.delta_amount ?? 0);
                return (
                  <tr key={a.uuid} className={deleted ? "deleted" : undefined}>
                    <td className={"num " + (value >= 0 ? "pos" : "neg")}>
                      {isHours ? fmtDelta(a.delta_minutes ?? 0) : `${value >= 0 ? "+" : "−"}${fmtMoney(Math.abs(value))}`}
                      <span className="emp-pill">{a.kind}</span>
                    </td>
                    <td>{nameOf(a.employee_id)}</td>
                    <td className="dim">{a.project_name ?? "—"}</td>
                    <td className="dim">{a.note}</td>
                    <td className="num dim">{fmtTs(a.created_at)}</td>
                    <td className="emp-rowacts">
                      <button
                        className="emp-iconbtn"
                        title="History"
                        onClick={() => setExpanded(expanded === a.uuid ? null : a.uuid)}
                      >
                        ⓘ
                      </button>
                      {!deleted && (
                        <button className="emp-iconbtn" title="Edit" onClick={() => setEditor({ mode: "edit", adj: a })}>
                          ✎
                        </button>
                      )}
                      {deleted ? (
                        <button className="emp-iconbtn" disabled={busy === a.uuid} onClick={() => restore(a.uuid)}>
                          Restore
                        </button>
                      ) : (
                        <button
                          className="emp-iconbtn danger"
                          title="Delete"
                          disabled={busy === a.uuid}
                          onClick={() => softDelete(a.uuid)}
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.map(
                (a) =>
                  expanded === a.uuid && (
                    <tr key={`${a.uuid}-audit`}>
                      <td colSpan={6} className="emp-audit">
                        {a.audit_log.map((entry, i) => (
                          <div key={i}>
                            {entry.action} · {fmtTs(entry.at)}
                            {entry.action === "created" ? ` · ${entry.note}` : ""}
                            {entry.action === "edited" ? ` · "${entry.from.note}" → "${entry.to.note}"` : ""}
                          </div>
                        ))}
                      </td>
                    </tr>
                  )
              )}
            </tbody>
          </table>
        </div>
      )}

      {editor && (
        <AdjustmentEditor
          editor={editor}
          people={people}
          projects={projects}
          defaultPersonId={personFilter}
          onClose={() => setEditor(null)}
          onSaved={afterWrite}
        />
      )}
    </>
  );
}

/**
 * Add / edit a correction. HOURS and AMOUNT are deliberately two different forms behind one shell —
 * an hours correction needs a project and a rate, an amount correction needs neither, and the
 * database will refuse the mix (CHECK constraints in db.ts). Editing changes the value and the
 * reason only; kind, person and project are fixed at creation because the service's update path
 * takes exactly a value and a note (adjustments.ts updateAdjustment).
 */
function AdjustmentEditor({
  editor,
  people,
  projects,
  defaultPersonId,
  onClose,
  onSaved,
}: {
  editor: Exclude<Editor, null>;
  people: EmployeePerson[];
  projects: TimeTrackerProjectListItem[];
  defaultPersonId: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const api = window.api;
  const editing = editor.mode === "edit" ? editor.adj : null;
  // Narrowed off `editor` directly — `editing` is a derived value TypeScript cannot use to narrow
  // the union it came from.
  const kind = editor.mode === "edit" ? editor.adj.kind : editor.kind;
  const isHours = kind === "hours";

  const [personId, setPersonId] = useState(String(editing?.employee_id ?? defaultPersonId ?? people[0]?.id ?? ""));
  const [projectSel, setProjectSel] = useState(String(editing?.project_id ?? ""));
  // Hours are entered as hours and stored as MINUTES — the service takes signed integer minutes.
  const [hoursText, setHoursText] = useState(
    editing?.delta_minutes != null ? String(editing.delta_minutes / 60) : ""
  );
  const [amountText, setAmountText] = useState(editing?.delta_amount != null ? String(editing.delta_amount) : "");
  const [rateText, setRateText] = useState(editing?.rate_at_entry != null ? String(editing.rate_at_entry) : "");
  const [note, setNote] = useState(editing?.note ?? "");
  const [error, setError] = useState<EmployeesErrorExplanation | null>(null);
  const [saving, setSaving] = useState(false);

  const numOf = (s: string): number | null => {
    const n = Number(s);
    return s.trim() !== "" && Number.isFinite(n) ? n : null;
  };
  const hoursValue = numOf(hoursText);
  const amountValue = numOf(amountText);
  const rateValue = numOf(rateText);
  const project = projects.find((p) => String(p.id) === projectSel) ?? null;

  // A correction of nothing is not a correction — the validators refuse zero, so the form does too.
  const blocked =
    saving ||
    note.trim() === "" ||
    (isHours
      ? hoursValue === null || hoursValue === 0 || rateValue === null || rateValue < 0 || (!editing && project === null)
      : amountValue === null || amountValue === 0) ||
    (!editing && personId === "");

  const submit = (): void => {
    if (blocked) return;
    setSaving(true);
    setError(null);
    const op = editing
      ? api.employees.adjustments.update(
          editing.uuid,
          isHours ? Math.round((hoursValue ?? 0) * 60) : (amountValue ?? 0),
          note.trim()
        )
      : isHours
        ? api.employees.adjustments.createHours({
            employeeId: Number(personId),
            projectId: project?.id ?? 0,
            projectName: project?.name ?? "",
            deltaMinutes: Math.round((hoursValue ?? 0) * 60),
            rateAtEntry: rateValue ?? 0,
            note: note.trim(),
          })
        : api.employees.adjustments.createAmount({
            employeeId: Number(personId),
            projectId: project?.id ?? null,
            projectName: project?.name ?? null,
            deltaAmount: amountValue ?? 0,
            note: note.trim(),
          });
    void op.then(onSaved).catch((e: unknown) => {
      setSaving(false);
      const raw = e instanceof Error ? e.message : String(e);
      console.error("[employees] adjustment save failed:", raw);
      setError(explainEmployeesError(raw, "this correction"));
    });
  };

  return (
    <div className="emp-modalback" onClick={onClose}>
      <div className="emp-modal narrow" role="dialog" aria-label="Adjustment" onClick={(e) => e.stopPropagation()}>
        <div className="emp-modalhead">
          {editing ? "Edit correction" : isHours ? "Adjust hours" : "Adjust amount"}
        </div>
        <p className="emp-modaldesc">
          {isHours
            ? "Changes hours worked and what those hours are worth. The rate is stored on the correction, so it is never re-derived later."
            : "Changes money only — no hours, no rate. Use this for a bonus, a deduction, or a figure agreed after the fact."}
        </p>

        {!editing && (
          <label className="emp-field">
            <span>Person</span>
            <select className="emp-input" value={personId} onChange={(e) => setPersonId(e.target.value)}>
              {people.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {!editing && (
          <label className="emp-field">
            <span>
              Project {isHours ? <b className="emp-req">· required</b> : <span className="emp-hint">· optional</span>}
            </span>
            <select className="emp-input" value={projectSel} onChange={(e) => setProjectSel(e.target.value)}>
              <option value="">{isHours ? "Choose a project…" : "No project"}</option>
              {projects.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name}
                </option>
              ))}
            </select>
            {isHours && <em className="emp-hint">Corrected hours belong to a project or they cannot be costed.</em>}
          </label>
        )}

        {isHours ? (
          <div className="emp-fieldrow">
            <label className="emp-field">
              <span>Hours (+ or −)</span>
              <input
                className="emp-input mono"
                inputMode="decimal"
                value={hoursText}
                placeholder="-1.5"
                onChange={(e) => setHoursText(e.target.value)}
              />
            </label>
            {!editing && (
              <label className="emp-field">
                <span>Rate ($ / hour)</span>
                <input
                  className="emp-input mono"
                  inputMode="decimal"
                  value={rateText}
                  onChange={(e) => setRateText(e.target.value)}
                  onBlur={() => setRateText(normalizeMoney(rateText))}
                />
              </label>
            )}
          </div>
        ) : (
          <label className="emp-field">
            <span>Amount ($, + or −)</span>
            <input
              className="emp-input mono"
              inputMode="decimal"
              value={amountText}
              placeholder="-25.00"
              onChange={(e) => setAmountText(e.target.value)}
            />
          </label>
        )}

        <label className="emp-field">
          <span>
            Reason <b className="emp-req">· required</b>
          </span>
          <input
            className="emp-input"
            value={note}
            placeholder="Why this correction exists"
            onChange={(e) => setNote(e.target.value)}
          />
          <em className="emp-hint">This is the whole record of why the numbers changed.</em>
        </label>

        {error && (
          <div className="emp-error" role="alert">
            <span className="emp-error-plain">{error.plain}</span>
            {error.hint && <span className="emp-error-hint">{error.hint}</span>}
          </div>
        )}

        <div className="emp-modalacts">
          <button className="emp-btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="emp-btn primary" disabled={blocked} onClick={submit}>
            {saving ? "Saving…" : editing ? "Save changes" : "Add correction"}
          </button>
        </div>
      </div>
    </div>
  );
}
