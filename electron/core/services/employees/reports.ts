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
import type { EmployeeBalance, EmployeePeriod, PersonHours, ProjectEmployeeCost } from "./types";
import { vId } from "./validate";
import { cents, netTotals } from "./netHours";

/**
 * What one entry costs. The ONE definition — every read in this file uses this fragment so a
 * balance and a chart can never disagree.
 *   donated → 0, always. Donated work is tracked in HOURS and never charged (canon; TimeTracker
 *             values donated contracts at 0 for the same reason).
 *   hourly  → hours × rate_at_entry, the rate captured when the work was logged.
 *   job/task→ the agreed flat amount (the DB guarantees it is present for these two types).
 *             Hours are still recorded, which is what makes "effective rate = amount ÷ hours" real.
 */
export { ENTRY_COST_SQL } from "./netHours";

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
  // Reads the one net sum instead of keeping its own copy of the union, so a project's employee
  // cost and a person's balance are the same arithmetic and cannot drift apart.
  return netTotals(db, { orgId, projectsOnly: true }, "project")
    .map((t) => ({
      project_id: t.bucket as number,
      project_name: t.project_name,
      employee_hours: t.hours,
      employee_cost: t.cost,
    }))
    .sort((a, b) => b.employee_cost - a.employee_cost || a.project_id - b.project_id);
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
export function balanceFor(db: Db, employeeId: number, today = new Date()): EmployeeBalance {
  const id = vId(employeeId, "person id");
  const net = netTotals(db, { employeeId: id })[0];
  const payments = db
    .prepare(`SELECT COALESCE(SUM(p.amount), 0) AS paid FROM employee_payments p WHERE p.employee_id = ?`)
    .get(id) as { paid: number };
  const period = (since: string): EmployeePeriod => {
    const t = netTotals(db, { employeeId: id, since })[0];
    return { hours: t.hours, entries: t.entries };
  };
  // The Ledger cards' windows, counted on the day the work happened. Local dates on purpose:
  // worked_on is a local calendar day, and a UTC date would shift the window at night.
  const daysBack = (n: number): string => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  return {
    employee_id: id,
    earned: net.cost,
    paid: payments.paid,
    outstanding: cents(net.cost - payments.paid),
    hours: net.hours,
    // Today and the six days before it: the same seven days this card has always counted.
    week: period(daysBack(6)),
    month: period(daysBack(29)),
    year: period(`${today.getFullYear()}-01-01`),
  };
}

/** Net hours for every person in the org, for the people list. Someone with nothing logged is
    simply absent, and the list shows them as zero. */
export function hoursByPerson(db: Db, orgId: string): PersonHours[] {
  return netTotals(db, { orgId }, "employee").map((t) => ({ employee_id: t.bucket as number, hours: t.hours }));
}
