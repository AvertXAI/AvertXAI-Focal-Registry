/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// The PAYROLL tab — the payments made to one person, read-only. Payments were
// being written (a client payment can be counted as paid to someone) and moved the Outstanding
// card, but no screen listed them, so "paid" could not be checked against anything.
//
// The ledger behind this is append-only, so nothing here edits or removes a row: a payment that
// was taken back stays in the list beside the line that reversed it. Loading, failed and empty are
// three separate states, as on the Ledger tab: a failed read must never look like "nothing paid".
import { useEffect, useState } from "react";
import type { EmployeePaymentLine, EmployeePerson } from "../../shared/types";
import { avatarColor, initials } from "./PeopleRail";
import { fmtDate, fmtMoney } from "./format";
import { paidTotal, reversedUuids } from "./payrollLines";

interface Props {
  person: EmployeePerson;
  /** The module bumps this on every timetracker:changed push, so a payment counted or reversed on
      another surface shows here while the tab is open. */
  refreshKey: number;
}

export default function PayrollView({ person, refreshKey }: Props) {
  const api = window.api;
  const [rows, setRows] = useState<EmployeePaymentLine[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    setRows(null);
    setError(false);
    api.employees.payments
      .list(person.id)
      .then((lines) => {
        if (live) setRows(lines);
      })
      .catch((e: unknown) => {
        if (!live) return;
        // Never an empty list or a zero total over a failed read: say the read failed.
        console.error("[employees] payments read failed:", e);
        setError(true);
      });
    return () => {
      live = false; // a fast person-switch must not let a stale response overwrite the new one
    };
  }, [api, person.id, refreshKey]);

  const reversed = reversedUuids(rows ?? []);

  return (
    <>
      <div className="emp-personhead">
        <span className="emp-avatar lg" style={{ background: avatarColor(person.id) }} aria-hidden="true">
          {initials(person.name)}
        </span>
        <div>
          <h2>{person.name}</h2>
          <div className="emp-personrole">{person.role || "No role set"}</div>
        </div>
      </div>

      {error ? (
        <div className="emp-state error" role="alert">
          <b>Couldn&apos;t load the payments.</b>
          The payments could not be read, so nothing is shown rather than an empty list or a wrong
          total. Reopen the tab to try again — nothing has been changed.
        </div>
      ) : rows === null ? (
        <div className="emp-state">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="emp-state">
          No payments recorded for {person.name} yet. A client payment that is also counted as paid
          to them shows here.
        </div>
      ) : (
        <>
          <div className="emp-sectlabel">Payments</div>
          <div className="emp-note">
            A record of what was paid. Nothing here is edited or deleted: a payment that was taken
            back stays in the list beside its reversal, and the two cancel out in the total.
          </div>
          <div className="emp-tablewrap">
            <table className="emp-table">
              <thead>
                <tr>
                  <th>Date</th><th>Amount</th><th>Method</th><th>Reference</th><th>Project</th><th>Note</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const isReversal = p.reverses_uuid !== null;
                  const wasReversed = reversed.has(p.uuid);
                  return (
                    <tr key={p.uuid} className={isReversal || wasReversed ? "reversed" : undefined}>
                      <td className="num">{fmtDate(p.paid_on)}</td>
                      <td className={"num " + (p.amount < 0 ? "neg" : "pos")}>
                        {p.amount < 0 ? "−" : ""}{fmtMoney(Math.abs(p.amount))}
                        {isReversal ? (
                          <span className="emp-pill">reversal</span>
                        ) : wasReversed ? (
                          <span className="emp-pill">reversed</span>
                        ) : null}
                      </td>
                      {/* A payment counted from a client payment carries that payment's stored
                          method key (bank_transfer), which reads better with its space back. */}
                      <td className="dim">{p.method ? p.method.replace(/_/g, " ") : "—"}</td>
                      <td className="dim">{p.reference ?? "—"}</td>
                      <td className={p.project_name === null ? "dim" : undefined}>{p.project_name ?? "—"}</td>
                      <td className="dim">{p.note ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total paid</td>
                  <td className="num">{fmtMoney(paidTotal(rows))}</td>
                  <td colSpan={4} />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </>
  );
}
