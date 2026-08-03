// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Employees READ-ONLY derivations — SELECT-only, never mutates a table
//              (timetracker/reports.ts doctrine). Two things live here and nothing else:
//              (1) THE ANALYTICS SEAM — employee hours and employee cost per TimeTracker project,
//                  built now and deliberately wired to NOTHING this phase;
//              (2) the outstanding balance, which canon says is DERIVED and carries across
//                  periods — so it is computed here every time and stored nowhere, and there is no
//                  period boundary in the query at all.
//              ONE money formula, ENTRY_COST_SQL below, is the single source of truth for both.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/employees/reports.ts
//------------------------------------------------------------
import type { Db } from "./db";
import type { EmployeeBalance, ProjectEmployeeCost } from "./types";
import { vId } from "./validate";

/**
 * What one entry costs. The ONE definition — every read in this file uses this fragment so a
 * balance and a chart can never disagree.
 *   donated → 0, always. Donated work is tracked in HOURS and never charged (canon; TimeTracker
 *             values donated contracts at 0 for the same reason).
 *   hourly  → hours × rate_at_entry, the rate captured when the work was logged.
 *   job/task→ the agreed flat amount (the DB guarantees it is present for these two types).
 *             Hours are still recorded, which is what makes "effective rate = amount ÷ hours" real.
 */
export const ENTRY_COST_SQL = `
  CASE e.pay_type
    WHEN 'donated' THEN 0
    WHEN 'hourly'  THEN e.hours_worked * e.rate_at_entry
    ELSE COALESCE(e.flat_amount, 0)
  END`;

/**
 * THE SEAM a later phase joins to TimeTracker's analytics: per project, the employee hours logged
 * against it and what those hours cost. Three sources are unioned — entries, valued hours
 * corrections, and project-scoped amount corrections — so a correction moves the chart exactly as
 * the original entry did. Soft-deleted corrections are excluded; entries have no delete path.
 *
 * project_name is the DENORMALIZED name carried on each row (MAX() picks deterministically when a
 * project has since been renamed). A consumer that wants the live name joins timetracker_projects
 * on project_id — this read deliberately does not, so it keeps working after a project is purged.
 */
export function employeeCostByProject(db: Db, orgId: string): ProjectEmployeeCost[] {
  return db
    .prepare(
      `SELECT project_id,
              MAX(project_name) AS project_name,
              SUM(hours) AS employee_hours,
              SUM(cost)  AS employee_cost
       FROM (
         SELECT e.project_id AS project_id,
                e.project_name AS project_name,
                e.hours_worked AS hours,
                ${ENTRY_COST_SQL} AS cost
         FROM employee_entries e
         WHERE e.org_id = ? AND e.project_id IS NOT NULL

         UNION ALL

         SELECT a.project_id,
                COALESCE(a.project_name, ''),
                a.delta_minutes / 60.0,
                (a.delta_minutes / 60.0) * a.rate_at_entry
         FROM employee_adjustments a
         WHERE a.org_id = ? AND a.kind = 'hours' AND a.deleted_at IS NULL AND a.project_id IS NOT NULL

         UNION ALL

         SELECT a.project_id,
                COALESCE(a.project_name, ''),
                0,
                a.delta_amount
         FROM employee_adjustments a
         WHERE a.org_id = ? AND a.kind = 'amount' AND a.deleted_at IS NULL AND a.project_id IS NOT NULL
       )
       GROUP BY project_id
       ORDER BY employee_cost DESC, project_id ASC`
    )
    .all(orgId, orgId, orgId) as ProjectEmployeeCost[];
}

/** The same seam for ONE project — the detail read behind a project's employee cost line. */
export function employeeCostForProject(db: Db, orgId: string, projectId: number): ProjectEmployeeCost {
  const id = vId(projectId, "project id");
  const found = employeeCostByProject(db, orgId).find((row) => row.project_id === id);
  return found ?? { project_id: id, project_name: "", employee_hours: 0, employee_cost: 0 };
}

/**
 * Outstanding payroll position for one person: everything earned minus everything paid, across all
 * time. Payments are append-only, so a reversal is simply a negative row that this SUM picks up —
 * there is nothing to special-case. Never stored: canon rules the balance derived and carrying
 * across periods, and a stored copy is a second truth that drifts.
 */
export function balanceFor(db: Db, employeeId: number): EmployeeBalance {
  const id = vId(employeeId, "person id");

  const entries = db
    .prepare(
      `SELECT COALESCE(SUM(e.hours_worked), 0) AS hours, COALESCE(SUM(${ENTRY_COST_SQL}), 0) AS cost
       FROM employee_entries e WHERE e.employee_id = ?`
    )
    .get(id) as { hours: number; cost: number };

  const hoursAdj = db
    .prepare(
      `SELECT COALESCE(SUM(a.delta_minutes / 60.0), 0) AS hours,
              COALESCE(SUM((a.delta_minutes / 60.0) * a.rate_at_entry), 0) AS cost
       FROM employee_adjustments a
       WHERE a.employee_id = ? AND a.kind = 'hours' AND a.deleted_at IS NULL`
    )
    .get(id) as { hours: number; cost: number };

  const amountAdj = db
    .prepare(
      `SELECT COALESCE(SUM(a.delta_amount), 0) AS amount
       FROM employee_adjustments a
       WHERE a.employee_id = ? AND a.kind = 'amount' AND a.deleted_at IS NULL`
    )
    .get(id) as { amount: number };

  const payments = db
    .prepare(`SELECT COALESCE(SUM(p.amount), 0) AS paid FROM employee_payments p WHERE p.employee_id = ?`)
    .get(id) as { paid: number };

  const earned = entries.cost + hoursAdj.cost + amountAdj.amount;
  return {
    employee_id: id,
    earned,
    paid: payments.paid,
    outstanding: earned - payments.paid,
    hours: entries.hours + hoursAdj.hours,
  };
}
