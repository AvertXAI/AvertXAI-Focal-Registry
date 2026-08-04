/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// THE renderer-side expression of what one entry is worth — extracted from LedgerView so the ledger
// table and the Add Time amount preview compute it from ONE place (Jason 08-03-2026: "do NOT write a
// third expression of the money rule").
//
// This mirrors ENTRY_COST_SQL in electron/core/services/employees/reports.ts — THAT SQL IS THE
// AUTHORITY. This is a renderer-side echo of the same rule, kept only because no per-entry cost read
// is exposed over IPC. If the two ever disagree the SQL wins, because it is what the payroll
// balance, the project cost roll-up and every chart are computed from.
//   donated → 0 always · hourly → hours × rate_at_entry · job/task → the agreed flat amount.
import type { EmployeePayType } from "../../shared/types";

/** The four fields the rule actually reads. A stored EmployeeEntry satisfies this structurally, so
    the ledger passes rows straight in; the Add Time form passes what it has mid-edit. */
export interface CostInput {
  pay_type: EmployeePayType;
  hours_worked: number;
  rate_at_entry: number;
  flat_amount: number | null;
}

export function entryCost(e: CostInput): number {
  if (e.pay_type === "donated") return 0;
  if (e.pay_type === "hourly") return e.hours_worked * e.rate_at_entry;
  return e.flat_amount ?? 0;
}
