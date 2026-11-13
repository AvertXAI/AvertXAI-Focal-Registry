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
  // ---- added 2026-08-04 (3B.2-A). All nullable — every one is optional on the approved form.
  street_address: string | null;
  city: string | null;
  state: string | null; // 2-letter US code
  zip: string | null;
  /** PLAIN, in the shared org database, by the 2026-08-04 ruling. The Vault is not involved. */
  ssn: string | null;
  /** PREFILL only. Pay type still lives on the ENTRY — this just sets the form's starting pill. */
  default_pay_type: PayType | null;
  /** SOFT reference to a TimeTracker project — no FK; resolves to nothing if the project is purged. */
  default_project_id: number | null;
  default_project_name: string | null;
  // ---- Employee Profile (08-06). Both nullable; employment_type validated in the service.
  payment_method: string | null;
  employment_type: "employee" | "contractor" | null;
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
  streetAddress: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  ssn: string | null;
  defaultPayType: PayType | null;
  defaultProjectId: number | null;
  defaultProjectName: string | null;
  paymentMethod?: string | null;
  employmentType?: "employee" | "contractor" | null;
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
  /** The client payment this payroll payment was counted from (timetracker_project_payments.uuid).
      NULL on an ordinary payroll payment and on every reversal. */
  project_payment_uuid: string | null;
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
  | { action: "deleted"; at: string }
  /** A soft delete undone. Appended, never replacing the "deleted" entry it follows — the audit
      trail records that it WAS deleted and then restored, which is the point of an audit trail. */
  | { action: "restored"; at: string };

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
  /** 08-06: the ENTRY this corrects (soft reference), when it corrects one. */
  entry_id: number | null;
  deleted_at: string | null;
  audit_log: EmployeeAuditEntry[];
  created_at: string;
}

/** An open (or closed) work session — the employee timer. Holds NO money and NO duration: the
    money rule lives in entries/reports, and elapsed time is derived from started_at and the two
    pause columns (src/shared/employeeTimer.ts). */
export interface Session {
  id: number;
  uuid: string;
  employee_id: number;
  project_id: number;
  project_name: string;
  task_id: number | null;
  pay_type: PayType;
  /** Captured AT START — a mid-session raise must never retroactively reprice work under way. */
  rate_at_start: number;
  note: string | null;
  started_at: string;
  /** Set while the clock is held; NULL while it counts. */
  paused_at: string | null;
  /** Whole seconds of pauses that have already ended. */
  paused_seconds: number;
  /** When the app last saw this timer counting, stamped about once a minute. NULL until the first stamp. */
  last_seen_at: string | null;
  /** NULL = open (counting or paused). Set on stop or cancel; the row is never deleted. */
  ended_at: string | null;
  created_at: string;
}

export interface SessionInput {
  employeeId: number;
  projectId: number;
  projectName: string;
  taskId: number | null;
  payType: PayType;
  rateAtStart: number;
  note: string | null;
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
  /** All-time hours, net of every live hours correction. */
  hours: number;
  /** The same net hours inside each window the Ledger cards show. */
  week: EmployeePeriod;
  month: EmployeePeriod;
  year: EmployeePeriod;
}

/** One Ledger card: the net hours worked in a window and how many entries fall inside it. */
export interface EmployeePeriod {
  hours: number;
  entries: number;
}

/** One person's all-time net hours, the figure beside their name in the people list. */
export interface PersonHours {
  employee_id: number;
  hours: number;
}
