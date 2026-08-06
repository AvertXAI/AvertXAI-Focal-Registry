/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Add Time v2 — manual entry of someone else's hours. No timer involved.
//
// Restyled to MOCKUP-employees-3b2-wizard-v5-08-03-2026.html scene 4. What changed from 3B:
//   · Three-line header: "Add Time" / the person's name / role — $rate/pay-type.
//   · The separate pay-type SECTION at the top is GONE. The pill now lives on the same line as the
//     rate input, joined, sized to its words, always visible and always active — no checkbox.
//   · Task is a [+ Add Task] reveal instead of a "— New task…" select option.
//
// WHAT DID NOT CHANGE: the service contract. entries.create still takes the same
// EmployeeEntryInput (types.ts:772-783) and clean() still governs (entries.ts:33-58). The pill maps
// to the EXISTING payType field and the amount box to the EXISTING flatAmount — job/task send a
// value, hourly/donated send null, which is what satisfies both throws at entries.ts:37-42. The
// person's default_pay_type and default_project_id set STARTING STATE only and never travel as
// fields of their own.
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
import { PAY_TYPE_PILLS, fmtHoursHuman, fmtMoney, normalizeMoney, rateSuffix, todayLocal } from "./format";

interface Props {
  person: EmployeePerson;
  onClose: () => void;
  /** Fired after every successful save, "add another" included — the ledger refreshes live. */
  onSaved: (e: EmployeeEntry) => void;
  /** Supplied only when this modal was opened FROM another one — renders the Back control. */
  onBack?: () => void;
}

/** These two carry an agreed amount instead of hours × rate — entries.ts throws without one. */
const FLAT: EmployeePayType[] = ["job", "task"];

export default function AddTimeModal({ person, onClose, onSaved, onBack }: Props) {
  const api = window.api;

  // STARTING positions from the person's defaults — nothing more. Both are plain useState seeds.
  const [payType, setPayType] = useState<EmployeePayType>(person.default_pay_type ?? "hourly");
  const [projectSel, setProjectSel] = useState(String(person.default_project_id ?? ""));
  const [workedOn, setWorkedOn] = useState(todayLocal());
  const [hours, setHours] = useState("");
  const [flatAmount, setFlatAmount] = useState("");
  const [rateText, setRateText] = useState(person.default_rate != null ? String(person.default_rate) : "");
  const [note, setNote] = useState("");
  // STATE 3: which joined block is open. null = the two options are showing.
  const [mode, setMode] = useState<"task" | "hours" | null>(null);
  // Task — the two-call flow underneath is unchanged; taskAdded is the visible confirmation only.
  const [taskSel, setTaskSel] = useState("");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [taskAdded, setTaskAdded] = useState<string | null>(null);

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
        // Auto-select the person's project so it does not have to be picked every time. The seed
        // at mount can miss it (the list arrives after), so it is re-applied here once the projects
        // are actually known — and only if the user has not chosen something else meanwhile.
        if (projectSel === "" && person.default_project_id != null &&
            p.some((x) => x.id === person.default_project_id)) {
          setProjectSel(String(person.default_project_id));
        }
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

  /** The Enter button / Enter key. It does NOT call the service — the task is still created on save,
      inside the same two-call flow as before, so a typed-but-unsaved entry cannot strand a task.
      This only confirms the name is taken, which is what was missing. */
  const confirmTask = (): void => {
    const title = newTaskTitle.trim();
    if (title === "") return;
    setTaskSel(""); // a typed new task wins over a picked existing one
    setTaskAdded(title);
  };

  const backToOptions = (): void => {
    setMode(null);
    setNewTaskTitle("");
    setTaskAdded(null);
    setTaskSel("");
  };

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
    mode === null; // nothing to save until one of the two options is open

  const reset = (): void => {
    setHours("");
    setFlatAmount("");
    setNote("");
    setTaskSel("");
    setNewTaskTitle("");
    setTaskAdded(null);
    setMode(null);
  };

  const save = (andAnother: boolean): void => {
    if (blocked || project === null) return;
    setSaving(true);
    setError(null);

    // Inline task create is TWO CALLS and they are not atomic (ruled 08-03-2026). If the entry then
    // fails, the task stays — and the message below says so, because a task with zero hours is a
    // legitimate backlog item, not litter to clean up. UNCHANGED by the reveal restyle.
    const taskStep: Promise<{ id: number | null; created: boolean }> =
      mode === "task" && newTaskTitle.trim() !== ""
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

  // Reusable pieces — declared once so the joined blocks can order them differently without the
  // markup being written twice.
  const rateField = (
    <div className="emp-field">
      <span>Rate</span>
      <div className="emp-rateline">
        <div className="emp-prefixed">
          <span className="emp-prefix">$</span>
          <input className="emp-input mono" inputMode="decimal" value={rateText}
            onChange={(e) => setRateText(e.target.value)}
            onBlur={() => setRateText(normalizeMoney(rateText))} />
          <span className="emp-suffix">{rateSuffix(payType)}</span>
        </div>
        <div className="emp-perwrap">
          <b>per</b>
          <div className="emp-pillset" role="radiogroup" aria-label="Pay type">
            {PAY_TYPE_PILLS.map(([key, label]) => (
              <button key={key} type="button" role="radio" aria-checked={payType === key}
                className={"emp-pillbtn" + (payType === key ? " on" : "")}
                onClick={() => setPayType(key)}>{label}</button>
            ))}
          </div>
        </div>
      </div>
      <em className="emp-hint">
        Type 15, 20, or 12 — it always means dollars: $15.00. The rate is stored <b>on the entry</b>,
        so a future raise never rewrites this.
      </em>
    </div>
  );

  const hoursField = (
    <label className="emp-field">
      <span>Hours worked</span>
      <input className="emp-input mono" inputMode="decimal" value={hours} placeholder="6.25"
        onChange={(e) => setHours(e.target.value)} />
      <em className="emp-hint mono">{hoursValue === null ? "—" : `= ${fmtHoursHuman(hoursValue)}`}</em>
    </label>
  );

  const noteField = (
    <label className="emp-field">
      <span>Notes</span>
      <input className="emp-input" value={note} placeholder="optional…"
        onChange={(e) => setNote(e.target.value)} />
    </label>
  );

  return (
    <div className="emp-modalback" onClick={onClose}>
      <div className="emp-modal" role="dialog" aria-label="Add time" onClick={(e) => e.stopPropagation()}>
        {/* Back sits ABOVE the title, outlined and in the accent colour — this modal is reached
            mid-flow from the person form, and a control that blends in is a control nobody finds. */}
        {onBack && (
          <button className="emp-backtop" onClick={onBack}>← Back</button>
        )}
        {/* Three lines, as drawn. Only what EmployeePerson carries — role and rate. */}
        <div className="emp-modalhead">Add Time</div>
        <div className="emp-modalname">{person.name}</div>
        <div className="emp-modalsub">
          {person.role ?? "No role set"}
          {person.default_rate != null && (
            <>
              {" — "}
              <span className="mono">
                {fmtMoney(person.default_rate)}
                {rateSuffix(person.default_pay_type ?? "hourly")}
              </span>
            </>
          )}
        </div>

        {listError && (
          <div className="emp-error" role="alert">
            <span className="emp-error-plain">Couldn&apos;t load the project and task lists.</span>
            <span className="emp-error-hint">
              Nothing is shown rather than an empty list. Close this and reopen it to try again.
            </span>
          </div>
        )}

        <label className="emp-field">
          <span>Date</span>
          <input className="emp-input mono" type="date" value={workedOn} onChange={(e) => setWorkedOn(e.target.value)} />
        </label>

        <label className="emp-field">
          <span>
            Project {projectSel === "" && <b className="emp-req">· required</b>}
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
            {person.default_project_id != null && projectSel === String(person.default_project_id)
              ? "This person's default project is already selected."
              : "Without a project these hours cannot be billed to anyone or counted anywhere in Analytics."}
          </em>
        </label>

        {/* Task — the reveal. Picking an existing one and creating a new one are separate doors. */}
        {/* STATE 3 — two in-section options, each revealing its own JOINED block. The choice is
            about what the user is recording: a task at a rate, or a rate for a number of hours.
            Both write the SAME EmployeeEntryInput through the SAME entries.create — the chooser is
            presentation over one contract, not two code paths. */}
        {mode === null ? (
          <div className="emp-field">
            <span>What are you adding?</span>
            <div className="emp-choices">
              <button className="emp-btn" onClick={() => setMode("task")}>＋ Add Task &amp; Rate</button>
              <button className="emp-btn" onClick={() => setMode("hours")}>＋ Add Rate &amp; Hours</button>
            </div>
          </div>
        ) : (
          <div className="emp-joined">
            <div className="emp-joinedhead">
              <button className="emp-back" onClick={backToOptions} aria-label="Back to the options">←</button>
              <span>{mode === "task" ? "Task & Rate" : "Rate & Hours"}</span>
            </div>

            {mode === "task" && (
              <div className="emp-field">
                <span>Task</span>
                <select className="emp-input" value={taskSel} onChange={(e) => setTaskSel(e.target.value)}>
                  <option value="">No task</option>
                  {(tasks ?? []).map((t) => (
                    <option key={t.id} value={String(t.id)}>{t.title}{t.done_at ? " (done)" : ""}</option>
                  ))}
                </select>
                {/* The task line: type a name and press Enter (or the button). The confirmation is
                    the point — a task created inline used to vanish into the select with no sign
                    it had worked. The two-call flow underneath is UNCHANGED. */}
                <div className="emp-taskadd">
                  <input
                    className="emp-input"
                    value={newTaskTitle}
                    placeholder="New task name"
                    onChange={(e) => { setNewTaskTitle(e.target.value); setTaskAdded(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirmTask(); } }}
                  />
                  <button className="emp-btn ghost" disabled={newTaskTitle.trim() === ""} onClick={confirmTask}>
                    Enter
                  </button>
                </div>
                {taskAdded && <div className="emp-taskok" role="status">✓ Task added — “{taskAdded}”</div>}
                {taskAdded && (
                  <em className="emp-hint">
                    It is created as its own record and attached to this entry when you save.
                  </em>
                )}
              </div>
            )}

            {rateField}
            {/* HOURS SITS UNDER THE RATE (state 3). It was beside the date before. */}
            {hoursField}
            {noteField}
          </div>
        )}

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
