/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Add Time — manual entry of someone else's hours. No timer involved.
//
// Built to MOCKUP-employees-addtime-adjustments-07-31-2026.html §1, with two rulings from
// Jason 08-03-2026 applied on top:
//   · PAY TYPE IS A FIELD HERE. The mockup drew it as a property of the person ("Hourly · $28.00/h")
//     but canon puts pay type on the ENTRY (DECISIONS-51) and EmployeePerson carries no such column,
//     so the form as drawn could not build a valid EmployeeEntryInput. Four options, default Hourly;
//     Job and Task reveal a required Flat amount; Donated always previews $0.00.
//   · NO DATE-RANGE TOGGLE. Deferred: spreading hours across days would mean a renderer loop of
//     non-atomic creates, where a failure midway leaves half the days committed. It lands later as
//     an atomic main-side batch. One date field here.
//
// The money preview imports entryCost from ./entryCost — the SAME function the ledger table uses,
// which in turn echoes ENTRY_COST_SQL (the authority). Three surfaces, one rule, one place.
import { useEffect, useState } from "react";
import type {
  EmployeeEntry,
  EmployeeEntryInput,
  EmployeePayType,
  EmployeePerson,
  EmployeeTask,
  TimeTrackerProjectListItem,
} from "../../shared/types";
import { explainEmployeesError, type EmployeesErrorExplanation } from "./empErrors";
import { entryCost } from "./entryCost";

interface Props {
  person: EmployeePerson;
  onClose: () => void;
  /** Fired after every successful save, including "Save & add another" — the ledger refreshes live. */
  onSaved: (e: EmployeeEntry) => void;
}

/** The four canon pay types, in the canon order (validate.ts PAY_TYPES). Hourly is the default. */
const PAY_TYPES: [EmployeePayType, string][] = [
  ["hourly", "Hourly"],
  ["job", "Per job"],
  ["task", "Per task"],
  ["donated", "Donated"],
];
/** These two carry an agreed amount instead of hours × rate — entries.ts throws without one. */
const FLAT: EmployeePayType[] = ["job", "task"];

const NEW_TASK = "__new__";

const fmtMoney = (n: number): string =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Local YYYY-MM-DD for today — never toISOString(), which shifts to UTC and can hand back yesterday. */
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function AddTimeModal({ person, onClose, onSaved }: Props) {
  const api = window.api;

  const [payType, setPayType] = useState<EmployeePayType>("hourly");
  const [workedOn, setWorkedOn] = useState(todayLocal());
  const [hours, setHours] = useState("");
  const [flatAmount, setFlatAmount] = useState("");
  const [projectSel, setProjectSel] = useState("");
  const [taskSel, setTaskSel] = useState("");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [overrideRate, setOverrideRate] = useState(false);
  const [rateText, setRateText] = useState(person.default_rate != null ? String(person.default_rate) : "");
  const [note, setNote] = useState("");

  const [projects, setProjects] = useState<TimeTrackerProjectListItem[] | null>(null);
  const [tasks, setTasks] = useState<EmployeeTask[] | null>(null);
  const [listError, setListError] = useState(false);
  const [error, setError] = useState<EmployeesErrorExplanation | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);

  // Projects come from TIMETRACKER — Employees has no project table of its own, and an entry stores
  // both the id and the name (types.ts:774-775). Tasks are open-first from the Employees service.
  useEffect(() => {
    let live = true;
    Promise.all([api.timetracker.projects.list(), api.employees.tasks.list()])
      .then(([p, t]) => {
        if (!live) return;
        setProjects(p);
        setTasks(t);
      })
      .catch((e: unknown) => {
        if (!live) return;
        // A failed list must not read as "you have no projects" — that would look like data loss.
        console.error("[employees] add-time lists failed:", e);
        setListError(true);
      });
    return () => {
      live = false;
    };
  }, [api]);

  const isFlat = FLAT.includes(payType);
  const num = (s: string): number | null => {
    const n = Number(s);
    return s.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : null;
  };
  const hoursValue = hours.trim() === "" ? 0 : num(hours); // zero hours is legal for every pay type
  const flatValue = num(flatAmount);
  const rateValue = num(rateText);
  const project = projects?.find((p) => String(p.id) === projectSel) ?? null;

  // Live "= 6h 15m" beside the decimal box. Decimal is what gets STORED; this is display only.
  const humanHours =
    hoursValue === null ? "" : `= ${Math.floor(hoursValue)}h ${String(Math.round((hoursValue % 1) * 60)).padStart(2, "0")}m`;

  const preview = entryCost({
    pay_type: payType,
    hours_worked: hoursValue ?? 0,
    rate_at_entry: rateValue ?? 0,
    flat_amount: isFlat ? flatValue : null,
  });

  // Project is required at the FORM level: the service allows a null project_id (entries.ts:45), so
  // this is the only place it is enforced. Hours with no project cannot be billed to anyone or
  // counted anywhere in Analytics — the mockup's own reasoning.
  const blocked =
    saving ||
    project === null ||
    hoursValue === null ||
    rateValue === null ||
    (isFlat && flatValue === null) ||
    (taskSel === NEW_TASK && newTaskTitle.trim() === "");

  const reset = (): void => {
    setHours("");
    setFlatAmount("");
    setNote("");
    setTaskSel("");
    setNewTaskTitle("");
  };

  const save = (andAnother: boolean): void => {
    if (blocked || project === null) return;
    setSaving(true);
    setError(null);

    // Inline task create is TWO CALLS and they are not atomic (ruled 08-03-2026). If the entry then
    // fails, the task stays — and the message below says so, because a task with zero hours is a
    // legitimate backlog item, not litter to clean up.
    const taskStep: Promise<{ id: number | null; created: boolean }> =
      taskSel === NEW_TASK
        ? api.employees.tasks
            .create({
              title: newTaskTitle.trim(),
              detail: null,
              employeeId: person.id,
              projectId: project.id,
              projectName: project.name,
            })
            .then((t) => ({ id: t.id, created: true }))
        : Promise.resolve({ id: taskSel === "" ? null : Number(taskSel), created: false });

    let taskCreated = false;
    void taskStep
      .then(({ id, created }) => {
        taskCreated = created;
        const input: EmployeeEntryInput = {
          employeeId: person.id,
          projectId: project.id,
          projectName: project.name,
          taskId: id,
          payType,
          hoursWorked: hoursValue ?? 0,
          rateAtEntry: rateValue ?? 0,
          flatAmount: isFlat ? flatValue : null, // null for hourly/donated — entries.ts throws otherwise
          workedOn,
          note: note.trim() === "" ? null : note,
        };
        return api.employees.entries.create(input);
      })
      .then((entry) => {
        onSaved(entry);
        setSaving(false);
        setSavedCount((n) => n + 1);
        if (andAnother) {
          reset();
          if (taskCreated) void api.employees.tasks.list().then(setTasks).catch(() => setListError(true));
        } else {
          onClose();
        }
      })
      .catch((e: unknown) => {
        setSaving(false);
        const raw = e instanceof Error ? e.message : String(e);
        console.error("[employees] add time failed:", raw);
        const ex = explainEmployeesError(raw, "this entry");
        setError(
          taskCreated
            ? {
                plain: ex.plain,
                hint: `The task "${newTaskTitle.trim()}" WAS created and is still in the task list — it just has no hours on it yet. ${ex.hint}`.trim(),
              }
            : ex
        );
      });
  };

  return (
    <div className="emp-modalback" onClick={onClose}>
      <div className="emp-modal" role="dialog" aria-label="Add time" onClick={(e) => e.stopPropagation()}>
        <div className="emp-modalhead">Add time — {person.name}</div>
        {/* Only what EmployeePerson actually carries. The mockup's "Hourly ·" prefix is dead: pay
            type is a property of the ENTRY, and it is the first field below. */}
        <div className="emp-modalsub">
          {[person.role, person.default_rate != null ? `${fmtMoney(person.default_rate)} / hour` : null]
            .filter(Boolean)
            .join(" · ") || "No role or default rate set"}
        </div>

        {listError && (
          <div className="emp-error" role="alert">
            <span className="emp-error-plain">Couldn&apos;t load the project and task lists.</span>
            <span className="emp-error-hint">
              Nothing is shown rather than an empty list. Close this and reopen it to try again.
            </span>
          </div>
        )}

        <div className="emp-field">
          <span>Pay type</span>
          <div className="emp-seg" role="radiogroup" aria-label="Pay type">
            {PAY_TYPES.map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={payType === key}
                className={"emp-segbtn" + (payType === key ? " on" : "")}
                onClick={() => setPayType(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <em className="emp-hint">
            Pay type belongs to this entry, not to {person.name} — the same person can be hourly on
            one project and per-job on another.
          </em>
        </div>

        <div className="emp-fieldrow">
          <label className="emp-field">
            <span>Date</span>
            <input className="emp-input" type="date" value={workedOn} onChange={(e) => setWorkedOn(e.target.value)} />
          </label>
          <label className="emp-field">
            <span>Hours worked</span>
            <div className="emp-inputpair">
              <input
                className="emp-input mono"
                inputMode="decimal"
                value={hours}
                placeholder="6.25"
                onChange={(e) => setHours(e.target.value)}
              />
              <span className="emp-readout">{humanHours || "—"}</span>
            </div>
            <em className="emp-hint">Decimal in, readable beside it. The decimal is what is stored.</em>
          </label>
        </div>

        {isFlat && (
          <label className="emp-field">
            <span>
              Agreed amount ($) <b className="emp-req">· required</b>
            </span>
            <input
              className="emp-input mono"
              inputMode="decimal"
              value={flatAmount}
              placeholder="450.00"
              onChange={(e) => setFlatAmount(e.target.value)}
            />
            <em className="emp-hint">
              A per-{payType === "job" ? "job" : "task"} entry is worth the agreed amount, not hours ×
              rate. Hours are still recorded, so the effective rate can be read back later.
            </em>
          </label>
        )}

        <label className="emp-field">
          <span>
            Project <b className="emp-req">· required</b>
          </span>
          <select className="emp-input" value={projectSel} onChange={(e) => setProjectSel(e.target.value)}>
            <option value="">{projects === null ? "Loading…" : "Choose a project…"}</option>
            {(projects ?? []).map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.name}
              </option>
            ))}
          </select>
          <em className="emp-hint">
            Without a project these hours cannot be billed to anyone or counted anywhere in Analytics.
          </em>
        </label>

        <label className="emp-field">
          <span>Task</span>
          <select className="emp-input" value={taskSel} onChange={(e) => setTaskSel(e.target.value)}>
            <option value="">No task</option>
            {(tasks ?? []).map((t) => (
              <option key={t.id} value={String(t.id)}>
                {t.title}
                {t.done_at ? " (done)" : ""}
              </option>
            ))}
            <option value={NEW_TASK}>— New task…</option>
          </select>
        </label>
        {taskSel === NEW_TASK && (
          <label className="emp-field">
            <span>New task name</span>
            <input
              className="emp-input"
              value={newTaskTitle}
              placeholder="Culling — wedding set 3"
              onChange={(e) => setNewTaskTitle(e.target.value)}
            />
            <em className="emp-hint">
              Created as its own record and assigned to {person.name}, then attached to this entry.
            </em>
          </label>
        )}

        <div className="emp-field">
          <span>Rate</span>
          <div className="emp-inputpair">
            <input
              className="emp-input mono"
              inputMode="decimal"
              value={rateText}
              disabled={!overrideRate}
              placeholder="0.00"
              onChange={(e) => setRateText(e.target.value)}
            />
            <label className="emp-check">
              <input type="checkbox" checked={overrideRate} onChange={(e) => setOverrideRate(e.target.checked)} />
              Use a different rate for this entry
            </label>
          </div>
          <em className="emp-hint">
            The rate is stored <b>on the entry</b>, not read back from {person.name}&apos;s record. A
            future raise never rewrites this.
          </em>
        </div>

        <label className="emp-field">
          <span>Note</span>
          <input className="emp-input" value={note} placeholder="optional…" onChange={(e) => setNote(e.target.value)} />
        </label>

        <div className="emp-calc">
          <span className="emp-calclabel">Amount</span>
          <span className="emp-calcmath">
            {payType === "donated"
              ? "donated — no charge"
              : isFlat
                ? "agreed amount"
                : `${hoursValue ?? 0} h × ${fmtMoney(rateValue ?? 0)}`}
          </span>
          <span className="emp-calcvalue">{fmtMoney(preview)}</span>
        </div>

        {error && (
          <div className="emp-error" role="alert">
            <span className="emp-error-plain">{error.plain}</span>
            {error.hint && <span className="emp-error-hint">{error.hint}</span>}
          </div>
        )}

        <div className="emp-modalacts">
          {savedCount > 0 && (
            <span className="emp-savedcount">
              {savedCount} {savedCount === 1 ? "entry" : "entries"} saved
            </span>
          )}
          <button className="emp-btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="emp-btn" disabled={blocked} onClick={() => save(true)}>
            Save &amp; add another
          </button>
          <button className="emp-btn primary" disabled={blocked} onClick={() => save(false)}>
            {saving ? "Saving…" : "Save entry"}
          </button>
        </div>
      </div>
    </div>
  );
}
