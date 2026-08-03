// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Employees service-layer domain types. Renderer-safe copies land in
//              src/shared/types.ts in a LATER phase, per the house rule that the renderer never
//              imports from services/ (timetracker/types.ts precedent). Money is REAL throughout,
//              matching TimeTracker's storage exactly — see the report's convention section.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/employees/types.ts
//------------------------------------------------------------

/** Pay type lives on the ENTRY, never on the person. Hours are recorded for all four. */
export type PayType = "hourly" | "job" | "task" | "donated";
/** Hours and amount adjustments are different operations — the DB enforces the split. */
export type AdjustmentKind = "hours" | "amount";
export type EmployeeEventType =
  | "person_added"
  | "person_archived"
  | "person_restored"
  | "entry_logged"
  | "task_created"
  | "task_assigned"
  | "task_done"
  | "task_reopened"
  | "payment_recorded"
  | "payment_reversed"
  | "adjusted"
  | "adjustment_removed";

export interface Person {
  id: number;
  uuid: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  /** Prefill only — never the money of record. That is rate_at_entry on each entry. */
  default_rate: number | null;
  notes: string | null;
  archived_at: string | null;
  archive_reason: string | null;
  created_at: string;
}

export interface PersonInput {
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  defaultRate: number | null;
  notes: string | null;
}

export interface Entry {
  id: number;
  uuid: string;
  employee_id: number;
  project_id: number | null;
  project_name: string;
  task_id: number | null;
  pay_type: PayType;
  hours_worked: number;
  rate_at_entry: number;
  /** Agreed amount for the per-job / per-task types; NULL for hourly and donated. */
  flat_amount: number | null;
  worked_on: string;
  note: string | null;
  created_at: string;
}

export interface EntryInput {
  employeeId: number;
  projectId: number | null;
  projectName: string;
  taskId: number | null;
  payType: PayType;
  hoursWorked: number;
  rateAtEntry: number;
  flatAmount: number | null;
  workedOn: string;
  note: string | null;
}

/** An entry with its derived cost attached (never stored — see reports.ENTRY_COST_SQL). */
export interface EntryWithCost extends Entry {
  cost: number;
}

export interface Task {
  id: number;
  uuid: string;
  title: string;
  detail: string | null;
  employee_id: number | null;
  project_id: number | null;
  project_name: string | null;
  done_at: string | null;
  /** Soft delete — a hidden task still holds the title a paid per-task entry refers to. */
  deleted_at: string | null;
  created_at: string;
}

export interface TaskInput {
  title: string;
  detail: string | null;
  employeeId: number | null;
  projectId: number | null;
  projectName: string | null;
}

export interface Payment {
  id: number;
  uuid: string;
  employee_id: number;
  /** Negative on a reversing row. Never zero. */
  amount: number;
  paid_on: string;
  method: string | null;
  reference: string | null;
  note: string | null;
  reverses_uuid: string | null;
  created_at: string;
}

export interface PaymentInput {
  employeeId: number;
  amount: number;
  paidOn: string;
  method: string | null;
  reference: string | null;
  note: string | null;
}

/** Append-only audit entries on an adjustment — the shape TimeTracker uses, kind-aware. */
export type EmployeeAuditEntry =
  | { action: "created"; at: string; kind: AdjustmentKind; delta_minutes?: number; delta_amount?: number; note: string }
  | {
      action: "edited";
      at: string;
      from: { delta_minutes: number | null; delta_amount: number | null; note: string };
      to: { delta_minutes: number | null; delta_amount: number | null; note: string };
    }
  | { action: "deleted"; at: string };

export interface Adjustment {
  id: number;
  uuid: string;
  employee_id: number;
  kind: AdjustmentKind;
  /** Required on an hours adjustment, optional on an amount adjustment (DB-enforced). */
  project_id: number | null;
  project_name: string | null;
  delta_minutes: number | null;
  /** Mandatory on an hours adjustment so corrected hours carry their own rate; NULL on amount. */
  rate_at_entry: number | null;
  delta_amount: number | null;
  note: string;
  deleted_at: string | null;
  audit_log: EmployeeAuditEntry[];
  created_at: string;
}

export interface EventLogRow {
  id: number;
  uuid: string;
  ts: string;
  event_type: EmployeeEventType;
  employee_id: number | null;
  employee_name: string;
  detail: string | null;
  created_at: string;
}

export interface ActivityQuery {
  limit?: number;
  employeeId?: number;
}

/** THE ANALYTICS SEAM (built, deliberately wired to nothing this phase): per TimeTracker project,
    the employee hours logged against it and what those hours cost. */
export interface ProjectEmployeeCost {
  project_id: number;
  project_name: string;
  employee_hours: number;
  employee_cost: number;
}

/** Derived payroll position for one person. Never stored — canon: balance is derived and carries
    across periods, so there is no period boundary in this shape at all. */
export interface EmployeeBalance {
  employee_id: number;
  /** Entry cost + valued hours adjustments + amount adjustments. */
  earned: number;
  /** Sum of every payment row, reversals included (they are negative). */
  paid: number;
  /** earned − paid. Positive = owed to the person. */
  outstanding: number;
  hours: number;
}
