/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Employees module shell — Phase 3A. Its OWN module with its OWN People rail (canon reversed the
// earlier "inside TimeTracker with a rail toggle" shape; the toggle is DEAD). Five tabs per canon —
// Ledger · Tasks · Payroll · Adjustments · Details — of which ONLY Ledger is implemented in this
// phase; the other four render the plain not-built panel, never the orange glow (§3.6).
//
// Layout mirrors TimeTracker's module shell: `view shown emp-shell` with the three-class CSS rule
// that beats globals.css's `.view.shown{display:block}` — see employees.css for why that matters.
import { useCallback, useEffect, useState } from "react";
import type { EmployeePerson, TimeTrackerGroup, TimeTrackerProjectListItem } from "../../shared/types";
import PeopleRail from "./PeopleRail";
import LedgerView from "./LedgerView";
import PersonModal, { ArchiveModal, type PersonModalState } from "./PersonModal";
import AddTimeModal from "./AddTimeModal";
import AdjustmentsView from "./AdjustmentsView";
import { ProjectChooser, ProjectModalHost } from "./NewEmployeeWizard";
import { bumpRender } from "../../diag";
import "./employees.css";

type Tab = "ledger" | "tasks" | "payroll" | "adjustments" | "details";

const TABS: [Tab, string][] = [
  ["ledger", "Ledger"],
  ["tasks", "Tasks"],
  ["payroll", "Payroll"],
  ["adjustments", "Adjustments"],
  ["details", "Details"],
];

/** What each unbuilt tab says. Plain statement of fact, in the customer's language. */
const NOT_BUILT: Record<Exclude<Tab, "ledger" | "adjustments">, string> = {
  tasks: "Assignable tasks with a done state — what someone is meant to do, and whether it is finished.",
  payroll: "What each person has earned, what has been paid, and what is still outstanding.",
  details: "The person's own record — contact details, pay rate, and when they started.",
};

// Module-level caches — instant re-entry paint, the same pattern the other modules use. Never
// localStorage. A stale cache can only ever affect what paints first; every read still runs.
let peopleCache: EmployeePerson[] | null = null;
let selectedCache: number | null = null;

export default function EmployeesModule() {
  bumpRender("employees"); // DIAG-2
  const api = window.api;
  const [people, setPeople] = useState<EmployeePerson[]>(() => peopleCache ?? []);
  const [selectedId, setSelectedId] = useState<number | null>(() => selectedCache);
  const [tab, setTab] = useState<Tab>("ledger");
  // Loading and error are SEPARATE from "empty" — an empty rail must never mean a failed read.
  const [loading, setLoading] = useState(peopleCache === null);
  const [error, setError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [hoursById, setHoursById] = useState<Record<number, number>>({});
  // ---- write surfaces. One modal at a time; each closes by returning its state to null.
  const [personModal, setPersonModal] = useState<PersonModalState>(null);
  const [archiving, setArchiving] = useState<EmployeePerson | null>(null);
  const [addingTime, setAddingTime] = useState<EmployeePerson | null>(null);
  // ---- the New Employee wizard: chooser → (optional) project modal → person form.
  const [wizard, setWizard] = useState<"chooser" | "project" | null>(null);
  const [projects, setProjects] = useState<TimeTrackerProjectListItem[]>([]);
  const [groups, setGroups] = useState<TimeTrackerGroup[]>([]);
  // ---- Adjustments tab (pulled forward from 3C so Part 2's Adjust button has a destination).
  const [adjPerson, setAdjPerson] = useState<number | null>(null);
  // ---- archived view. `null` means "not read yet"; [] is the real answer "nobody is archived".
  const [showArchived, setShowArchived] = useState(false);
  const [archived, setArchived] = useState<EmployeePerson[] | null>(null);
  const [archivedError, setArchivedError] = useState(false);
  const [restoringId, setRestoringId] = useState<number | null>(null);

  const load = useCallback((): void => {
    setError(false);
    void api.employees.people
      .list()
      .then((rows) => {
        peopleCache = rows;
        setPeople(rows);
        setLoading(false);
      })
      .catch((e: unknown) => {
        // Never leave an empty list standing in for a failed read (the defect this session taught).
        console.error("[employees] people list failed:", e);
        setError(true);
        setLoading(false);
      });
  }, [api]);

  /** The archived roster. Re-read on every open and after any archive/restore, so the two lists
      can never disagree about where someone is. */
  const loadArchived = useCallback((): void => {
    setArchivedError(false);
    setArchived(null);
    void api.employees.people
      .listArchived()
      .then(setArchived)
      .catch((e: unknown) => {
        console.error("[employees] archived list failed:", e);
        setArchivedError(true);
      });
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  /** TimeTracker's projects and groups — Employees has neither of its own. The person form needs
      projects for its Project select, and the hosted ProjectModal needs groups. Reloaded after the
      wizard creates one so the new project is selectable immediately. */
  const loadProjectData = useCallback((): void => {
    void api.timetracker.projects.list().then(setProjects).catch(() => setProjects([]));
    void api.timetracker.groups.list().then(setGroups).catch(() => setGroups([]));
  }, [api]);

  useEffect(() => {
    loadProjectData();
  }, [loadProjectData]);

  // Only fetch the archived list when it is actually on screen.
  useEffect(() => {
    if (showArchived) loadArchived();
  }, [showArchived, loadArchived]);

  // Selection heals when it is unset or points at someone no longer listed.
  useEffect(() => {
    if (people.length === 0) return;
    if (selectedId === null || !people.some((p) => p.id === selectedId)) {
      selectedCache = people[0].id;
      setSelectedId(people[0].id);
    }
  }, [people]); // eslint-disable-line react-hooks/exhaustive-deps

  const select = (id: number): void => {
    selectedCache = id;
    setSelectedId(id);
  };
  const onHours = useCallback((employeeId: number, hours: number): void => {
    setHoursById((prev) => (prev[employeeId] === hours ? prev : { ...prev, [employeeId]: hours }));
  }, []);

  const selected = people.find((p) => p.id === selectedId) ?? null;

  /** ONE refresh knob for a write that changed entries. Bumping refreshKey re-runs the ledger's
      effect, which refetches the entries, the balance AND the task names in one Promise.all — so
      the table, all four cards and (through onHours) the rail total all land from a single read. */
  const refreshLedger = (): void => setRefreshKey((k) => k + 1);

  const onPersonSaved = (p: EmployeePerson, addTime: boolean): void => {
    setPersonModal(null);
    load(); // the roster changed — name, rate or a brand-new row
    select(p.id);
    refreshLedger();
    // "Add Employee + Add Time" flows straight on, prefilled from the person just created.
    if (addTime) setAddingTime(p);
  };

  const onArchived = (): void => {
    setArchiving(null);
    load();
    // Selection heals itself in the effect above once the archived person leaves `people`.
    if (showArchived) loadArchived();
  };

  const restore = (id: number): void => {
    setRestoringId(id);
    void api.employees.people
      .restore(id)
      .then((p) => {
        load();
        loadArchived();
        select(p.id);
      })
      .catch((e: unknown) => {
        // A failed restore must not look like it worked: the row stays in the archived list.
        console.error("[employees] restore failed:", e);
        setArchivedError(true);
      })
      .finally(() => setRestoringId(null));
  };

  return (
    <main className="view shown emp-shell">
      <PeopleRail
        people={people}
        hoursById={hoursById}
        selectedId={selectedId}
        onSelect={select}
        loading={loading}
        error={error}
        onNew={() => setWizard("chooser")}
        showArchived={showArchived}
        onToggleArchived={() => setShowArchived((v) => !v)}
        archived={archived}
        archivedError={archivedError}
        onRestore={restore}
        restoringId={restoringId}
      />
      <div className="emp-main">
        <div className="emp-tabs" role="tablist" aria-label="Employees views">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              className={"emp-tab" + (tab === key ? " on" : "")}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="emp-tabbody">
          {error ? (
            <div className="emp-state error" role="alert">
              <b>Couldn&apos;t load the people list.</b>
              Nothing is shown rather than an empty roster. Reopen the module to try again — nothing
              has been changed.
              <div style={{ marginTop: 10 }}>
                <button
                  className="emp-tab on"
                  onClick={() => {
                    setLoading(true);
                    load();
                    setRefreshKey((k) => k + 1);
                  }}
                >
                  Try again
                </button>
              </div>
            </div>
          ) : loading ? (
            <div className="emp-state">Loading…</div>
          ) : tab === "adjustments" ? (
            <AdjustmentsView
              people={people}
              personFilter={adjPerson}
              onPersonFilter={setAdjPerson}
              onDataChanged={refreshLedger}
            />
          ) : tab !== "ledger" ? (
            <div className="emp-notbuilt">
              <h3>{TABS.find(([k]) => k === tab)?.[1]}</h3>
              <p>
                {NOT_BUILT[tab as Exclude<Tab, "ledger" | "adjustments">]} This tab has not been
                built yet — it will appear here once it is.
              </p>
            </div>
          ) : selected === null ? (
            <div className="emp-state">
              No people yet. Use <b>+ New Employee</b> in the rail to add the first one — their time
              ledger will show here.
            </div>
          ) : (
            <LedgerView
              person={selected}
              refreshKey={refreshKey}
              onHours={onHours}
              onEdit={() => setPersonModal({ mode: "edit", person: selected })}
              onArchive={() => setArchiving(selected)}
              onAddTime={() => setAddingTime(selected)}
            />
          )}
        </div>
      </div>

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
            loadProjectData();
          }}
          onSavedGoToEmployee={(p) => {
            setWizard(null);
            loadProjectData();
            setPersonModal({ mode: "new", project: p });
          }}
        />
      )}
      {personModal && (
        <PersonModal
          state={personModal}
          projects={projects}
          onClose={() => setPersonModal(null)}
          onSaved={onPersonSaved}
        />
      )}
      {archiving && (
        <ArchiveModal person={archiving} onClose={() => setArchiving(null)} onArchived={onArchived} />
      )}
      {addingTime && (
        <AddTimeModal
          person={addingTime}
          onClose={() => setAddingTime(null)}
          // Fires on EVERY save, "add another" included, so the ledger behind the modal is already
          // current when it closes — no navigation, no remount.
          onSaved={refreshLedger}
        />
      )}
    </main>
  );
}
