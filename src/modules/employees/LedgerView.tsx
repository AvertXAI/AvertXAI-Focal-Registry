/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// The LEDGER tab — one person's work entries, per the approved mockup's "Time ledger" surface:
// four accumulated-hours cards, then the entry table. Reads ONLY through the Phase 1 services wired
// in Phase 2 (employees.entries.listForPerson + employees.reports.balance); it writes nothing.
//
// THREE DISTINCT STATES, deliberately. An empty list rendered over a failed read is the exact
// confusion that made the notes editor look like data loss this session: "nothing here" and
// "we couldn't ask" must never look alike.
import { useEffect, useState } from "react";
import type { EmployeeBalance, EmployeeEntry, EmployeePerson } from "../../shared/types";
import { avatarColor, initials } from "./PeopleRail";

interface Props {
  person: EmployeePerson;
  /** Bumped by the module to force a refetch without remounting. */
  refreshKey: number;
  /** Lets the module keep the rail's hours in step with what this tab actually read. */
  onHours: (employeeId: number, hours: number) => void;
}

/**
 * What ONE entry is worth. This mirrors ENTRY_COST_SQL in
 * electron/core/services/employees/reports.ts — that SQL is the authority; this is a renderer-side
 * echo of the same rule because no per-entry cost read is exposed yet. Kept in one place here, and
 * flagged in the phase report so a later phase can serve the figure from main instead of echoing it.
 *   donated → 0 always · hourly → hours × rate_at_entry · job/task → the agreed flat amount.
 */
export function entryCost(e: EmployeeEntry): number {
  if (e.pay_type === "donated") return 0;
  if (e.pay_type === "hourly") return e.hours_worked * e.rate_at_entry;
  return e.flat_amount ?? 0;
}

const fmtMoney = (n: number): string =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtHours = (h: number): string => {
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  return `${whole}h ${String(mins).padStart(2, "0")}m`;
};
/** worked_on is a plain YYYY-MM-DD — parsed as LOCAL, never through Date's UTC-shifting path. */
const fmtDate = (ymd: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : ymd;
};
const daysAgo = (ymd: string): number => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return Number.POSITIVE_INFINITY;
  const then = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  return (Date.now() - then) / 86_400_000;
};

export default function LedgerView({ person, refreshKey, onHours }: Props) {
  const api = window.api;
  const [entries, setEntries] = useState<EmployeeEntry[] | null>(null);
  const [balance, setBalance] = useState<EmployeeBalance | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    setEntries(null);
    setError(false);
    Promise.all([api.employees.entries.listForPerson(person.id), api.employees.reports.balance(person.id)])
      .then(([rows, bal]) => {
        if (!live) return;
        setEntries(rows);
        setBalance(bal);
        onHours(person.id, rows.reduce((s, e) => s + e.hours_worked, 0));
      })
      .catch((e: unknown) => {
        if (!live) return;
        // NEVER fall through to an empty table — say the read failed, and say it in plain words.
        console.error("[employees] ledger read failed:", e);
        setError(true);
      });
    return () => {
      live = false; // a fast person-switch must not let a stale response overwrite the new one
    };
  }, [api, person.id, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const week = (entries ?? []).filter((e) => daysAgo(e.worked_on) <= 7);
  const month = (entries ?? []).filter((e) => daysAgo(e.worked_on) <= 30);
  const year = (entries ?? []).filter((e) => new Date(e.worked_on).getFullYear() === new Date().getFullYear());
  const hoursOf = (list: EmployeeEntry[]): number => list.reduce((s, e) => s + e.hours_worked, 0);

  return (
    <>
      <div className="emp-personhead">
        <span className="emp-avatar lg" style={{ background: avatarColor(person.id) }} aria-hidden="true">
          {initials(person.name)}
        </span>
        <div>
          <h2>{person.name}</h2>
          <div className="emp-personrole">
            {[person.role, person.default_rate != null ? `${fmtMoney(person.default_rate)} / hour` : null]
              .filter(Boolean)
              .join(" · ") || "No role set"}
          </div>
        </div>
      </div>

      {error ? (
        <div className="emp-state error" role="alert">
          <b>Couldn&apos;t load this ledger.</b>
          The entries could not be read, so nothing is shown rather than an empty list. Reopen the
          module to try again — nothing has been changed.
        </div>
      ) : entries === null ? (
        <div className="emp-state">Loading…</div>
      ) : (
        <>
          <div className="emp-cards">
            <div className="emp-card">
              <span className="emp-cardlabel">This week</span>
              <span className="emp-cardvalue">{fmtHours(hoursOf(week))}</span>
              <span className="emp-cardsub">{week.length} {week.length === 1 ? "entry" : "entries"}</span>
            </div>
            <div className="emp-card">
              <span className="emp-cardlabel">Last 30 days</span>
              <span className="emp-cardvalue">{fmtHours(hoursOf(month))}</span>
              <span className="emp-cardsub">{month.length} {month.length === 1 ? "entry" : "entries"}</span>
            </div>
            <div className="emp-card">
              <span className="emp-cardlabel">Year to date</span>
              <span className="emp-cardvalue">{fmtHours(hoursOf(year))}</span>
              <span className="emp-cardsub">{year.length} {year.length === 1 ? "entry" : "entries"}</span>
            </div>
            <div className="emp-card">
              <span className="emp-cardlabel">Outstanding</span>
              <span className="emp-cardvalue owed">{fmtMoney(balance?.outstanding ?? 0)}</span>
              <span className="emp-cardsub">earned {fmtMoney(balance?.earned ?? 0)} · paid {fmtMoney(balance?.paid ?? 0)}</span>
            </div>
          </div>

          <div className="emp-sectlabel">Time ledger</div>
          {entries.length === 0 ? (
            <div className="emp-state">
              No time logged for {person.name} yet. Entries appear here as they are recorded.
            </div>
          ) : (
            <table className="emp-table">
              <thead>
                <tr>
                  <th>Date</th><th>Project</th><th>Note</th><th>Pay type</th><th>Hours</th><th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="num">{fmtDate(e.worked_on)}</td>
                    <td>{e.project_name}</td>
                    <td className="dim">{e.note ?? "—"}</td>
                    <td><span className="emp-pill">{e.pay_type}</span></td>
                    <td className="num">{e.hours_worked.toFixed(2)}</td>
                    <td className="money">{fmtMoney(entryCost(e))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </>
  );
}
