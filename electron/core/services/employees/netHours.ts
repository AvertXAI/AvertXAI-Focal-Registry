// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Net employee hours and pay, in ONE place. An entry is never rewritten, so what a
//              person really worked is the entry plus every live correction made against it.
//              Each total used to add that up its own way, and some read the entries alone, which
//              is how one corrected entry could show 14.95 hours on a card and 1,114.95 beside it.
//              Every total now reads the same lines: through netTotals(), or, for the two project
//              rollups that are single SQL statements, by joining EMPLOYEE_BY_PROJECT_SQL, which
//              is built from the same text. SELECT-only and Electron-free.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/employees/netHours.ts
//------------------------------------------------------------
import type { Db } from "./db";

/**
 * What one entry costs. Moved here unchanged from reports.ts (which still exports it) so the lines
 * below and every older reader share one copy.
 *   donated  -> 0, always: donated work is tracked in hours and never charged.
 *   hourly   -> hours x the rate captured when the work was logged.
 *   job/task -> the agreed flat amount.
 */
export const ENTRY_COST_SQL = `
  CASE e.pay_type
    WHEN 'donated' THEN 0
    WHEN 'hourly'  THEN e.hours_worked * e.rate_at_entry
    ELSE COALESCE(e.flat_amount, 0)
  END`;

/**
 * Every employee hour and dollar, one line per stored row: each entry as it was logged, and each
 * LIVE correction as its own signed line. Adding lines up gives the net figure, and nothing is
 * ever written back to an entry.
 *   on_date  a correction made against an entry counts on the day that work happened, so a period
 *            card and a chart move where the entry sits. A correction that names no entry has no
 *            work date of its own, so it counts on the local day it was made.
 *   hours    only an hours correction moves hours.
 *   cost     an hours correction is worth its hours at the rate stored on it; an amount
 *            correction is worth what it says.
 * Keep SQL comments out of this text: it is embedded inside other statements, where a line
 * comment would swallow whatever follows it.
 */
// ponytail: every read walks all of the org's employee lines once. Fine into the tens of thousands
// of rows; past that, narrow each half by person or project before the UNION.
export const EMPLOYEE_LINES_SQL = `
  SELECT 'entry' AS kind, e.org_id AS org_id, e.employee_id AS employee_id, e.project_id AS project_id,
         e.project_name AS project_name, e.id AS entry_id, e.worked_on AS on_date,
         e.hours_worked AS hours, ${ENTRY_COST_SQL} AS cost
  FROM employee_entries e
  UNION ALL
  SELECT a.kind, a.org_id, a.employee_id, a.project_id, COALESCE(a.project_name, ''), a.entry_id,
         COALESCE(le.worked_on, date(a.created_at, 'localtime')),
         CASE a.kind WHEN 'hours' THEN a.delta_minutes / 60.0 ELSE 0 END,
         CASE a.kind WHEN 'hours' THEN (a.delta_minutes / 60.0) * a.rate_at_entry ELSE a.delta_amount END
  FROM employee_adjustments a
  LEFT JOIN employee_entries le ON le.id = a.entry_id
  WHERE a.deleted_at IS NULL`;

/**
 * The same lines added up per project, for a statement that already lists projects and joins this
 * once. Seconds are rounded to the whole second because project time is shown by flooring, and
 * minutes turned into hours and back can land a hair under the next minute.
 */
export const EMPLOYEE_BY_PROJECT_SQL = `
  SELECT project_id, SUM(cost) AS cost, ROUND(SUM(hours) * 3600) AS seconds
  FROM (${EMPLOYEE_LINES_SQL})
  WHERE project_id IS NOT NULL
  GROUP BY project_id`;

/** Money to the cent. Applied ONCE, to a finished sum, never line by line. */
export const cents = (amount: number): number => Math.round(amount * 100) / 100;

/** Which lines a total counts. Every field narrows it; null or missing means "do not narrow". */
export interface NetScope {
  orgId?: string | null;
  employeeId?: number | null;
  projectId?: number | null;
  /** One entry together with the corrections made against it. */
  entryId?: number | null;
  /** Only lines tied to a project, which is all a project chart can place. */
  projectsOnly?: boolean;
  /** Inclusive YYYY-MM-DD lower bound on the work date. */
  since?: string | null;
}

/** What a total can be split by. Fixed text, never caller input, so it is safe inside the SQL. */
const GROUP_SQL = {
  employee: "employee_id",
  project: "project_id",
  // The same bucket keys the TimeTracker charts use for their own sessions, so the series line up.
  day: "strftime('%Y-%m-%d', on_date)",
  week: "strftime('%Y-W%W', on_date)",
  month: "strftime('%Y-%m', on_date)",
} as const;
export type NetGroup = keyof typeof GROUP_SQL;

export interface NetTotal {
  /** The group this row is for (a person id, a project id, a date bucket); null for one total. */
  bucket: string | number | null;
  hours: number;
  cost: number;
  /** Entries in the group. A correction is not an entry and is not counted. */
  entries: number;
  project_name: string;
}

/**
 * THE net sum every employee total reads. Without `by` it returns exactly one row (zeros when
 * nothing matches); with `by`, one row per group that has lines.
 */
export function netTotals(db: Db, scope: NetScope, by?: NetGroup): NetTotal[] {
  const where: string[] = [];
  const params: Record<string, string | number> = {};
  if (scope.orgId != null) {
    where.push("org_id = @orgId");
    params.orgId = scope.orgId;
  }
  if (scope.employeeId != null) {
    where.push("employee_id = @employeeId");
    params.employeeId = scope.employeeId;
  }
  if (scope.projectId != null) {
    where.push("project_id = @projectId");
    params.projectId = scope.projectId;
  }
  if (scope.entryId != null) {
    where.push("entry_id = @entryId");
    params.entryId = scope.entryId;
  }
  if (scope.projectsOnly) where.push("project_id IS NOT NULL");
  if (scope.since) {
    where.push("on_date >= @since");
    params.since = scope.since;
  }
  const rows = db
    .prepare(
      `SELECT ${by ? GROUP_SQL[by] : "NULL"} AS bucket,
              COALESCE(SUM(hours), 0) AS hours,
              COALESCE(SUM(cost), 0) AS cost,
              COALESCE(SUM(kind = 'entry'), 0) AS entries,
              COALESCE(MAX(project_name), '') AS project_name
       FROM (${EMPLOYEE_LINES_SQL})
       ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
       ${by ? "GROUP BY bucket" : ""}`
    )
    .all(params) as NetTotal[];
  // Rounded here, after the sum, and nowhere earlier. Hours only shed float dust (a millionth of
  // an hour), so 14.95 reads as 14.95 and no minute ever moves.
  return rows.map((r) => ({ ...r, hours: Math.round(r.hours * 1e6) / 1e6, cost: cents(r.cost) }));
}
