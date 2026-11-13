/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// THE EMPLOYEES CARD — one component, both approved placements (MOCKUP-timetracker-employees-
// placement-08-03-2026.html): under the timer on the Tracker tab, and leading the Adjustments tab.
// The mockup's dashed outline was a marker for "this is the new piece"; the real card uses the
// normal card border.
//
// IT LIVES IN src/modules/employees/ ON PURPOSE. TimeTracker imports it, not the reverse, so the
// Add Time modal and the new-employee wizard are reused rather than duplicated across the boundary.
// No cycle results: this file and everything it pulls in (AddTimeModal, NewEmployeeWizard's chooser,
// format, empErrors, entryCost) import nothing from src/modules/timetracker/ except ProjectModal,
// which is itself a leaf — verified with the module graph, see the phase report.
//
// The clock ticks HERE, in the renderer, off the session's stored stamps. There is no tick channel
// for employee sessions. The arithmetic is src/shared/employeeTimer.ts, the same one that files
// the hours, so a paused clock holds still here exactly as it does in the ledger.
import { useCallback, useEffect, useState } from "react";
import type { EmployeePerson, EmployeeSession, TimeTrackerProjectListItem } from "../../shared/types";
import { navigateToModule } from "../../shared/navigate";
import { workedMs } from "../../shared/employeeTimer";
import AddTimeModal from "./AddTimeModal";
import PersonModal, { type PersonModalState } from "./PersonModal";
import { ProjectChooser, ProjectModalHost } from "./NewEmployeeWizard";
import { fmtMoney } from "./format";
import { explainEmployeesError, type EmployeesErrorExplanation } from "./empErrors";
import type { TimeTrackerGroup } from "../../shared/types";
import "./employees.css";

const NEW_PERSON = "__new__";

/** hh:mm:ss on the Stop button. Pauses are taken out, and a paused clock holds still. */
function elapsedClock(session: EmployeeSession, now: number): string {
  const s = Math.floor(workedMs(session, now) / 1000);
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

export default function EmployeesCard() {
  const api = window.api;
  const [people, setPeople] = useState<EmployeePerson[] | null>(null);
  const [readError, setReadError] = useState(false);
  const [selected, setSelected] = useState("");
  const [sessions, setSessions] = useState<EmployeeSession[]>([]);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<EmployeesErrorExplanation | null>(null);
  const [filed, setFiled] = useState<string | null>(null);
  // Modals this card can open — all of them are the Part-1 components, reused as-is.
  const [addingTime, setAddingTime] = useState<EmployeePerson | null>(null);
  const [wizard, setWizard] = useState<"chooser" | "project" | null>(null);
  const [personModal, setPersonModal] = useState<PersonModalState>(null);
  const [projects, setProjects] = useState<TimeTrackerProjectListItem[]>([]);
  const [groups, setGroups] = useState<TimeTrackerGroup[]>([]);
  // The person the project picker is open for. Held as an id so that landing on anyone else
  // (the new-employee wizard selects its own person) closes it without extra wiring.
  const [pickFor, setPickFor] = useState<number | null>(null);
  const [pickSel, setPickSel] = useState("");
  const [saveDefault, setSaveDefault] = useState(false);

  const load = useCallback((): void => {
    setReadError(false);
    void api.employees.people
      .list()
      .then(setPeople)
      .catch((e: unknown) => {
        // Loading, empty and error stay three different things — an empty select must never mean
        // "the read failed", which would read as "you have no staff".
        console.error("[employees-card] people read failed:", e);
        setReadError(true);
      });
    void api.employees.sessions.active().then(setSessions).catch(() => setSessions([]));
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  // Projects are made and completed elsewhere while this card stays mounted. A list read once at
  // mount handed the person form a project it did not contain, and the form saved that as none.
  const loadProjects = useCallback((): void => {
    void api.timetracker.projects
      .list()
      .then(setProjects)
      // A failed re-read keeps the last good list: an emptied picker would read as "no projects".
      .catch((e: unknown) => console.error("[employees-card] projects read failed:", e));
  }, [api]);

  // Re-read on any employee/timer write from anywhere. Without this the card kept whatever it read
  // at mount — which is why a person created on one tab did not appear in the picker on another.
  useEffect(() => {
    const onChanged = (): void => {
      load();
      loadProjects();
    };
    return api.on<void>("timetracker:changed", onChanged);
  }, [api, load, loadProjects]);

  useEffect(() => {
    loadProjects();
    void api.timetracker.groups.list().then(setGroups).catch(() => setGroups([]));
  }, [api, loadProjects]);

  // One interval, and ONLY while something is running — an idle card does no work at all.
  useEffect(() => {
    if (sessions.length === 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [sessions.length]);

  // The filed confirmation clears itself. useCallback-free because the timer keys off the message.
  useEffect(() => {
    if (filed === null) return;
    const t = setTimeout(() => setFiled(null), 6000);
    return () => clearTimeout(t);
  }, [filed]);

  const person = (people ?? []).find((p) => String(p.id) === selected) ?? null;
  const running = person ? sessions.find((s) => s.employee_id === person.id) ?? null : null;
  // Completed jobs refuse new time, so the picker never offers one.
  const openProjects = projects.filter((p) => p.completed_at == null);
  const pickedProject = openProjects.find((p) => String(p.id) === pickSel) ?? null;
  const picking = person !== null && pickFor === person.id && !running;

  const onPick = (value: string): void => {
    if (value === NEW_PERSON) {
      setWizard("chooser");
      return;
    }
    setSelected(value);
    setPickFor(null);
    setError(null);
  };

  const start = (): void => {
    if (!person || busy) return;
    // A timer needs a project and a rate. Both come from the person's defaults. The one thing the
    // card asks for itself is a project when there is no default: sending the user to the editor
    // for it left no way to start the clock from here. Anything more belongs in Add Time.
    const picked = picking ? pickedProject : null;
    const projectId = picked?.id ?? person.default_project_id;
    const projectName = picked?.name ?? person.default_project_name;
    const payType = person.default_pay_type ?? "hourly";
    if (payType === "job" || payType === "task") {
      setError({
        plain: `${person.name} is paid per ${payType}, which has an agreed amount rather than an hourly rate.`,
        hint: "Use + Add time to record that work with its amount.",
      });
      return;
    }
    if (projectId == null || projectName == null) {
      setError(null);
      // Already open: leave the user's choice and tick alone.
      if (pickFor !== person.id) {
        setPickSel("");
        setSaveDefault(false);
        setPickFor(person.id);
        loadProjects();
      }
      return;
    }
    const asDefault = picked !== null && saveDefault;
    setBusy(true);
    setError(null);
    void api.employees.sessions
      .start({
        employeeId: person.id,
        projectId,
        projectName,
        taskId: null,
        payType,
        rateAtStart: person.default_rate ?? 0,
        note: null,
      })
      .then((s) => {
        setSessions((prev) => [...prev, s]);
        setPickFor(null);
        if (!asDefault) return;
        // The clock is already running, so a failed save must not read as a failed start.
        void api.employees.people.setDefaultProject(person.id, projectId, projectName).catch((e: unknown) => {
          const raw = e instanceof Error ? e.message : String(e);
          console.error("[employees-card] default project save failed:", raw);
          setError({
            plain: `The timer is running, but ${projectName} was not saved as ${person.name}'s default project.`,
            hint: "Open Employees and edit them to set it.",
          });
        });
      })
      .catch((e: unknown) => {
        const raw = e instanceof Error ? e.message : String(e);
        console.error("[employees-card] start failed:", raw);
        setError(explainEmployeesError(raw, "this timer"));
      })
      .finally(() => setBusy(false));
  };

  const stop = (): void => {
    if (!running || busy) return;
    setBusy(true);
    setError(null);
    void api.employees.sessions
      .stop(running.id)
      .then(({ entry }) => {
        setSessions((prev) => prev.filter((s) => s.id !== running.id));
        // Say what happened, in the customer's terms — the whole point of stopping is that the work
        // got recorded, and silence would leave them wondering.
        setFiled(
          `Filed ${entry.hours_worked.toFixed(2)} h for ${person?.name ?? "them"} on ${entry.project_name} — ${fmtMoney(
            entry.pay_type === "donated" ? 0 : entry.hours_worked * entry.rate_at_entry
          )}.`
        );
      })
      .catch((e: unknown) => {
        const raw = e instanceof Error ? e.message : String(e);
        // THE SESSION STAYS OPEN on a failed stop — the service files the entry before it closes the
        // session, so nothing was lost and the clock is still running. Say exactly that.
        console.error("[employees-card] stop failed:", raw);
        const ex = explainEmployeesError(raw, "this time");
        setError({
          plain: ex.plain,
          hint: `The timer is STILL RUNNING and no time has been lost — try stopping it again. ${ex.hint}`.trim(),
        });
      })
      .finally(() => setBusy(false));
  };

  const togglePause = (): void => {
    if (!running || busy) return;
    const change = running.paused_at ? api.employees.sessions.resume : api.employees.sessions.pause;
    setBusy(true);
    setError(null);
    void change(running.id)
      .then((s) => setSessions((prev) => prev.map((x) => (x.id === s.id ? s : x))))
      .catch((e: unknown) => {
        const raw = e instanceof Error ? e.message : String(e);
        console.error("[employees-card] pause or resume failed:", raw);
        setError(explainEmployeesError(raw, "this timer"));
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="emp-card-embed">
      <div className="emp-embedlabel">Employees</div>

      {readError ? (
        <div className="emp-state error" role="alert">
          <b>Couldn&apos;t load the people list.</b>
          Nothing is shown rather than an empty one. Reopen this tab to try again.
        </div>
      ) : people === null ? (
        <div className="emp-state">Loading…</div>
      ) : (
        <>
          <div className="emp-embedrow">
            <select className="emp-input" aria-label="Employee" value={selected} onChange={(e) => onPick(e.target.value)}>
              <option value="">{people.length === 0 ? "No employees yet…" : "Choose someone…"}</option>
              {people.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name}
                  {p.role ? ` — ${p.role}` : ""}
                </option>
              ))}
              <option value={NEW_PERSON}>＋ New employee…</option>
            </select>

            {running ? (
              <>
                <button className="emp-btn stop" disabled={busy} onClick={stop}>
                  ■ Stop · {elapsedClock(running, now)}
                </button>
                <button
                  className={running.paused_at ? "emp-btn primary" : "emp-btn"}
                  disabled={busy}
                  onClick={togglePause}
                >
                  {running.paused_at ? "▶ Resume" : "Pause"}
                </button>
              </>
            ) : (
              <button className="emp-btn primary" disabled={!person || busy} onClick={start}>
                ▶ Start time
              </button>
            )}
            <button className="emp-btn" disabled={!person} onClick={() => person && setAddingTime(person)}>
              ＋ Add time
            </button>
            <button
              className="emp-btn"
              disabled={!person}
              onClick={() =>
                person && navigateToModule({ slug: "employees", tab: "adjustments", id: person.id })
              }
            >
              Adjust
            </button>
          </div>

          {running?.paused_at && person && (
            <p className="emp-embedhint ask">
              {person.name}&apos;s timer is paused. Resume it to keep counting, or stop it to file the
              time so far.
            </p>
          )}

          {picking && person && (
            <>
              <p className="emp-embedhint ask">
                {openProjects.length === 0
                  ? `${person.name} has no default project, and there are no open projects to choose from. Add a project first.`
                  : `${person.name} has no default project yet. Choose one to start their time.`}
              </p>
              <div className="emp-embedrow">
                <select
                  className="emp-input"
                  aria-label="Project"
                  value={pickSel}
                  onChange={(e) => setPickSel(e.target.value)}
                >
                  <option value="">{openProjects.length === 0 ? "No open projects…" : "Choose a project…"}</option>
                  {openProjects.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <label className="emp-check">
                  <input type="checkbox" checked={saveDefault} onChange={(e) => setSaveDefault(e.target.checked)} />
                  Save as {person.name}&apos;s default project
                </label>
                <button className="emp-btn primary" disabled={!pickedProject || busy} onClick={start}>
                  Start
                </button>
              </div>
            </>
          )}

          <p className="emp-embedhint">
            Find an employee, start their time, add time, or make adjustments — without leaving
            TimeTracker.
          </p>

          {filed && (
            <div className="emp-filed" role="status">
              {filed}
            </div>
          )}
          {error && (
            <div className="emp-error" role="alert">
              <span className="emp-error-plain">{error.plain}</span>
              {error.hint && <span className="emp-error-hint">{error.hint}</span>}
            </div>
          )}
        </>
      )}

      {/* Every modal below is the Part-1 component, reused unchanged. */}
      {wizard === "chooser" && (
        <ProjectChooser
          hasProjects={projects.length > 0}
          onAddProject={() => setWizard("project")}
          onAssign={() => {
            setWizard(null);
            setPersonModal({ mode: "new", project: null });
          }}
          onClose={() => setWizard(null)}
        />
      )}
      {wizard === "project" && (
        <ProjectModalHost
          groups={groups}
          onClose={() => setWizard(null)}
          onSavedStop={() => {
            setWizard(null);
            loadProjects();
          }}
          onSavedGoToEmployee={(p) => {
            setWizard(null);
            loadProjects();
            setPersonModal({ mode: "new", project: p });
          }}
        />
      )}
      {personModal && (
        <PersonModal
          state={personModal}
          projects={projects}
          onClose={() => setPersonModal(null)}
          onSaved={(p, addTime) => {
            setPersonModal(null);
            load();
            setSelected(String(p.id));
            if (addTime) setAddingTime(p);
          }}
        />
      )}
      {addingTime && (
        <AddTimeModal person={addingTime} onClose={() => setAddingTime(null)} onSaved={() => load()} />
      )}
    </div>
  );
}
