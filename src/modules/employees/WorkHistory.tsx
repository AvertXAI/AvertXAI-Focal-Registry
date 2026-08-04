/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// The Work History tab inside Edit Employee — mockup v5 scene 6, tab 2.
//
// Every column and every chip is reachable from reads that already exist (08-04 recon §E12):
//   entries.listForPerson → date · project · task_id · hours · type · note
//   tasks.list            → the id→title map, because an entry stores task_id and NO title
//   reports.balance       → all THREE chips; balanceFor already folds both adjustment kinds in,
//                           so no separate adjustments read is needed for the totals.
// No new service call was added for this surface.
import { useEffect, useState } from "react";
import type { EmployeeBalance, EmployeeEntry, EmployeePerson } from "../../shared/types";
import { entryCost } from "./entryCost";
import { fmtDate, fmtMoney } from "./format";

export default function WorkHistory({ person }: { person: EmployeePerson }) {
  const api = window.api;
  const [entries, setEntries] = useState<EmployeeEntry[] | null>(null);
  const [balance, setBalance] = useState<EmployeeBalance | null>(null);
  const [taskNames, setTaskNames] = useState<Record<number, string>>({});
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    setEntries(null);
    setError(false);
    Promise.all([
      api.employees.entries.listForPerson(person.id),
      api.employees.reports.balance(person.id),
      api.employees.tasks.list(),
    ])
      .then(([rows, bal, tasks]) => {
        if (!live) return;
        setEntries(rows);
        setBalance(bal);
        setTaskNames(Object.fromEntries(tasks.map((t) => [t.id, t.title])));
      })
      .catch((e: unknown) => {
        if (!live) return;
        // NEVER fall through to an empty table — say the read failed, in plain words.
        console.error("[employees] work history read failed:", e);
        setError(true);
      });
    return () => {
      live = false;
    };
  }, [api, person.id]);

  if (error) {
    return (
      <div className="emp-state error" role="alert">
        <b>Couldn&apos;t load this work history.</b>
        Nothing is shown rather than an empty list. Close and reopen to try again — nothing has been
        changed.
      </div>
    );
  }
  if (entries === null) return <div className="emp-state">Loading…</div>;

  return (
    <>
      <div className="emp-cards three">
        <div className="emp-card">
          <span className="emp-cardlabel">Total hours</span>
          <span className="emp-cardvalue">{(balance?.hours ?? 0).toFixed(2)}</span>
        </div>
        <div className="emp-card">
          <span className="emp-cardlabel">Total earned</span>
          <span className="emp-cardvalue money">{fmtMoney(balance?.earned ?? 0)}</span>
        </div>
        <div className="emp-card">
          <span className="emp-cardlabel">Outstanding</span>
          <span className="emp-cardvalue owed">{fmtMoney(balance?.outstanding ?? 0)}</span>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="emp-state">No time logged for {person.name} yet.</div>
      ) : (
        <div className="emp-tablewrap">
          <table className="emp-table">
            <thead>
              <tr>
                <th>Date</th><th>Project</th><th>Task</th><th>Hours</th><th>Type</th><th>Amount</th><th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="num">{fmtDate(e.worked_on)}</td>
                  <td>{e.project_name}</td>
                  {/* A soft-deleted task drops out of tasks.list, so its id resolves to nothing and
                      the cell falls back to the dash rather than inventing a name. */}
                  <td className="dim">{(e.task_id != null ? taskNames[e.task_id] : null) ?? "—"}</td>
                  {/* DASH vs ZERO, per the 08-04 recon: hours_worked is NOT NULL DEFAULT 0, so it
                      always holds a real number — 0 is a value, not a gap, and canon records hours
                      for every pay type. The mockup draws "—" here on job/donated rows; that would
                      hide the number the effective-rate reading depends on, so the figure is shown. */}
                  <td className="num">{e.hours_worked.toFixed(2)}</td>
                  <td><span className="emp-pill">{e.pay_type}</span></td>
                  <td className="money">{fmtMoney(entryCost(e))}</td>
                  <td className="dim">{e.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
