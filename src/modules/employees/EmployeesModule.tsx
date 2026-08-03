/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Employees module shell — Phase 3A. Its OWN module with its OWN People rail (canon reversed the
// earlier "inside TimeTracker with a rail toggle" shape; the toggle is DEAD). Five tabs per canon —
// Ledger · Tasks · Payroll · Adjustments · Details — of which ONLY Ledger is implemented in this
// phase; the other four render the plain not-built panel, never the orange glow (§3.6).
//
// Layout mirrors TimeTracker's module shell: `view shown emp-shell` with the three-class CSS rule
// that beats globals.css's `.view.shown{display:block}` — see employees.css for why that matters.
import { useCallback, useEffect, useState } from "react";
import type { EmployeePerson } from "../../shared/types";
import PeopleRail from "./PeopleRail";
import LedgerView from "./LedgerView";
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
const NOT_BUILT: Record<Exclude<Tab, "ledger">, string> = {
  tasks: "Assignable tasks with a done state — what someone is meant to do, and whether it is finished.",
  payroll: "What each person has earned, what has been paid, and what is still outstanding.",
  adjustments: "Corrections to hours and to amounts, kept as their own records so history is never rewritten.",
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

  useEffect(() => {
    load();
  }, [load]);

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

  return (
    <main className="view shown emp-shell">
      <PeopleRail
        people={people}
        hoursById={hoursById}
        selectedId={selectedId}
        onSelect={select}
        loading={loading}
        error={error}
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
          ) : tab !== "ledger" ? (
            <div className="emp-notbuilt">
              <h3>{TABS.find(([k]) => k === tab)?.[1]}</h3>
              <p>
                {NOT_BUILT[tab as Exclude<Tab, "ledger">]} This tab has not been built yet — it will
                appear here once it is.
              </p>
            </div>
          ) : selected === null ? (
            <div className="emp-state">
              No people yet. Once someone is added they will appear in the rail, and their time
              ledger will show here.
            </div>
          ) : (
            <LedgerView person={selected} refreshKey={refreshKey} onHours={onHours} />
          )}
        </div>
      </div>
    </main>
  );
}
