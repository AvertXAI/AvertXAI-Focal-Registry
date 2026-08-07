// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: TimeTracker READ-ONLY analytics aggregations — SELECT-only, reuses the grand-total
//              rollup; never mutates any table. Charts are drawn renderer-side as hand-rolled SVG
//              from this data (no chart dependency — FR-DECISIONS §TimeTracker).
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/timetracker/reports.ts
//------------------------------------------------------------
import type { Db } from "./db";
import { grandTotals, listArchivedProjects, listProjects } from "./projects";
import { classifyProjectType, isForProfit } from "./derive";
import type {
  CostsByCategoryPoint,
  HoursByProjectPoint,
  MarginByProjectPoint,
  ProfitByProjectPoint,
  ProjectType,
  ReportData,
  ReportGranularity,
  ReportRange,
  ReportTotals,
  TimeSeriesPoint,
  WastedMetric,
} from "./types";

const TOP_PROJECTS = 10;

// strftime bucket expressions over ISO-8601 timestamps. SELECT-only formatting; the DB is never written.
const BUCKET_EXPR: Record<ReportGranularity, (col: string) => string> = {
  day: (col) => `strftime('%Y-%m-%d', ${col})`,
  week: (col) => `strftime('%Y-W%W', ${col})`,
  month: (col) => `strftime('%Y-%m', ${col})`,
};

/** Inclusive lower-bound ISO for the range, or null for "all". */
function cutoffIso(range: ReportRange): string | null {
  if (range === "all") return null;
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/** The employee-pay expression the charts share — ENTRY_COST_SQL's rule, verbatim: donated is
    free, hourly is hours x rate, flat types are their agreed amount. Employee pay is a COST to the
    photographer, which is exactly how the project totals already count it (52a211b). */
const EMP_COST = `CASE e.pay_type WHEN 'donated' THEN 0 WHEN 'hourly' THEN e.hours_worked * e.rate_at_entry ELSE COALESCE(e.flat_amount, 0) END`;

/**
 * Totals mirror the grand-total bar exactly (same listProjects/grandTotals rollup),
 * plus donated hours (counted in time, excluded from $ value) and the group count.
 * With a PROJECT FILTER (C10) the same rollup values are read off that one project's row — the
 * numbers the rail itself shows — so a filtered card can never disagree with the rail.
 */
function reportTotals(db: Db, orgId: string, projectId?: number | null): ReportTotals {
  // PROFIT (ruled 08-06): three words, one meaning each. revenue = total_value (the contracted
  // amount for contract-paid; hourly earnings for hourly; 0 donated). spent = total_costs, which
  // since 08-06 IS the full composition (crew + itemized + hard lines). profit = revenue − spent;
  // margin = profit ÷ revenue, null when there is no revenue ("no margin" ≠ "0% margin").
  const withProfit = (seconds: number, value: number, costs: number, donated: number, projects: number, groups: number): ReportTotals => ({
    total_seconds: seconds,
    revenue: value,
    spent: costs,
    profit: value - costs,
    margin: value > 0 ? ((value - costs) / value) * 100 : null,
    donated_seconds: donated,
    project_count: projects,
    group_count: groups,
  });
  if (projectId != null) {
    const p = listProjects(db, orgId).find((x) => x.id === projectId);
    return withProfit(
      p?.total_seconds ?? 0,
      p?.total_value ?? 0,
      p?.total_costs ?? 0,
      p && p.rate_type === "contract" && p.contract_kind === "donated" ? p.total_seconds : 0,
      p ? 1 : 0,
      p?.group_id != null ? 1 : 0
    );
  }
  const gt = grandTotals(db, orgId);
  const projects = listProjects(db, orgId);
  const donated_seconds = projects
    .filter((p) => p.rate_type === "contract" && p.contract_kind === "donated")
    .reduce((s, p) => s + p.total_seconds, 0);
  const group_count = (db.prepare(`SELECT COUNT(*) AS c FROM timetracker_groups WHERE org_id = ?`).get(orgId) as { c: number }).c;
  return withProfit(gt.total_seconds, gt.total_value, gt.total_costs, donated_seconds, gt.project_count, group_count);
}

/**
 * Per-bucket hours, $ value, and $ costs.
 * - hours: all sessions (incl. donated) bucketed by started_at.
 * - value: hourly = rate x hours per bucket (by session); paid contract = contract_amount
 *   attributed to the project's created_at bucket. Donated excluded. Summed over "all",
 *   this equals the grand-total bar's total_value.
 * - costs: costs.amount bucketed by created_at.
 */
function timeSeries(db: Db, orgId: string, range: ReportRange, granularity: ReportGranularity, projectId?: number | null): TimeSeriesPoint[] {
  const since = cutoffIso(range);
  // worked_on is a plain YYYY-MM-DD; comparing it against a full ISO cutoff string-wise would drop
  // the cutoff day itself, so date-typed columns get the date-only form of the same bound.
  const sinceDate = since ? since.slice(0, 10) : null;
  const pid = projectId ?? null;
  const bucket = BUCKET_EXPR[granularity];
  const points = new Map<string, TimeSeriesPoint>();
  const at = (key: string): TimeSeriesPoint => {
    let p = points.get(key);
    if (!p) {
      p = { bucket: key, hours: 0, value: 0, costs: 0 };
      points.set(key, p);
    }
    return p;
  };

  // hours (all rate types) + hourly $ value, from sessions. Archived projects excluded from active analytics.
  const sessionSql = `
    SELECT ${bucket("te.started_at")} AS k,
           SUM(te.duration_seconds) AS secs,
           SUM(CASE WHEN p.rate_type = 'hourly' AND p.hourly_rate IS NOT NULL
                    THEN te.duration_seconds / 3600.0 * p.hourly_rate ELSE 0 END) AS hourly_value
    FROM timetracker_time_entries te
    JOIN timetracker_projects p ON p.id = te.project_id
    WHERE p.org_id = @orgId AND p.archived_at IS NULL ${since ? `AND te.started_at >= @since` : ``} ${pid != null ? `AND p.id = @pid` : ``}
    GROUP BY k`;
  const base: Record<string, unknown> = { orgId };
  if (since) { base.since = since; base.sinceDate = sinceDate; }
  if (pid != null) base.pid = pid;
  for (const r of db.prepare(sessionSql).all(base) as {
    k: string;
    secs: number;
    hourly_value: number;
  }[]) {
    if (!r.k) continue;
    const p = at(r.k);
    p.hours += (r.secs ?? 0) / 3600;
    p.value += r.hourly_value ?? 0;
  }

  // paid-contract revenue attributed to the CONTRACT DATE (ruled 08-06 — the day the client
  // signed is when the money became real). This replaces the old created_at attribution and its
  // documented one-dot distortion. A contract project with NO contract_date does not appear on the
  // timeline at all — the caller reads timelineExcludedCount and says why. Hourly revenue keeps its
  // session dates in the block above: money earned by the hour is dated by the work itself.
  const paidSql = `
    SELECT ${bucket("contract_date")} AS k, SUM(contract_amount) AS amt
    FROM timetracker_projects
    WHERE org_id = @orgId AND rate_type = 'contract' AND contract_kind = 'paid' AND contract_amount IS NOT NULL
      AND contract_date IS NOT NULL AND archived_at IS NULL
    ${since ? `AND contract_date >= @sinceDate` : ``} ${pid != null ? `AND id = @pid` : ``}
    GROUP BY k`;
  for (const r of db.prepare(paidSql).all(base) as { k: string; amt: number }[]) {
    if (!r.k) continue;
    at(r.k).value += r.amt ?? 0;
  }

  // ITEMIZED PURCHASES join the costs series (ruled 08-06 — the recon proved they were in no
  // analytics read; profit would have inherited the under-report).
  const itemSql = `
    SELECT ${bucket("i.created_at")} AS k, SUM(i.amount) AS amt
    FROM timetracker_project_items i JOIN timetracker_projects p ON p.id = i.project_id
    WHERE p.org_id = @orgId AND i.deleted_at IS NULL AND p.archived_at IS NULL
    ${since ? `AND i.created_at >= @since` : ``} ${pid != null ? `AND p.id = @pid` : ``}
    GROUP BY k`;
  for (const r of db.prepare(itemSql).all(base) as { k: string; amt: number }[]) {
    if (!r.k) continue;
    at(r.k).costs += r.amt ?? 0;
  }

  // costs by created_at bucket
  const costSql = `
    SELECT ${bucket("c.created_at")} AS k, SUM(c.amount) AS amt
    FROM timetracker_costs c JOIN timetracker_projects p ON p.id = c.project_id
    WHERE p.org_id = @orgId AND p.archived_at IS NULL ${since ? `AND c.created_at >= @since` : ``} ${pid != null ? `AND p.id = @pid` : ``}
    GROUP BY k`;
  for (const r of db.prepare(costSql).all(base) as { k: string; amt: number }[]) {
    if (!r.k) continue;
    at(r.k).costs += r.amt ?? 0;
  }

  // EMPLOYEE WORK (C8 root cause, 08-06): the charts read only the user's own tracked sessions, so
  // 88 seeded employee entries spread across the year rendered as nothing while the contract value
  // all sat in today's created_at bucket — one point, which the chart layer honestly draws as a
  // dot. Employee hours join the hours series and employee pay joins the costs series, bucketed by
  // the day the WORK happened (worked_on), which is also what makes the range controls bite.
  const empSql = `
    SELECT ${bucket("e.worked_on")} AS k,
           SUM(e.hours_worked) AS hrs,
           SUM(${EMP_COST}) AS pay
    FROM employee_entries e
    WHERE e.org_id = @orgId AND e.project_id IS NOT NULL ${sinceDate ? `AND e.worked_on >= @sinceDate` : ``} ${pid != null ? `AND e.project_id = @pid` : ``}
    GROUP BY k`;
  for (const r of db.prepare(empSql).all(base) as { k: string; hrs: number; pay: number }[]) {
    if (!r.k) continue;
    const p = at(r.k);
    p.hours += r.hrs ?? 0;
    p.costs += r.pay ?? 0;
  }

  return [...points.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
}

/** Hours per project (descending), top N with the remainder collapsed into "Others". */
function hoursByProject(db: Db, orgId: string, range: ReportRange, projectId?: number | null): HoursByProjectPoint[] {
  const since = cutoffIso(range);
  const sinceDate = since ? since.slice(0, 10) : null;
  const pid = projectId ?? null;
  const params: Record<string, unknown> = { orgId };
  if (since) { params.since = since; params.sinceDate = sinceDate; }
  if (pid != null) params.pid = pid;
  // Own sessions AND employee entries, per project — the bar chart shows everyone's hours on the
  // project, matching the rail totals (C8; canon: employee hours feed every chart).
  const rows = db
    .prepare(
      `SELECT p.name AS name,
              COALESCE((SELECT SUM(te.duration_seconds) FROM timetracker_time_entries te
                 WHERE te.project_id = p.id ${since ? `AND te.started_at >= @since` : ``}), 0) / 3600.0
            + COALESCE((SELECT SUM(e.hours_worked) FROM employee_entries e
                 WHERE e.project_id = p.id ${sinceDate ? `AND e.worked_on >= @sinceDate` : ``}), 0) AS hrs
       FROM timetracker_projects p
       WHERE p.org_id = @orgId AND p.archived_at IS NULL ${pid != null ? `AND p.id = @pid` : ``}
       ORDER BY hrs DESC`
    )
    .all(params) as { name: string; hrs: number }[];
  const ranked = rows.map((r) => ({ name: r.name, hours: r.hrs ?? 0 })).filter((r) => r.hours > 0);
  if (ranked.length <= TOP_PROJECTS) return ranked;
  const top = ranked.slice(0, TOP_PROJECTS);
  const others = ranked.slice(TOP_PROJECTS).reduce((s, r) => s + r.hours, 0);
  if (others > 0) top.push({ name: "Others", hours: others });
  return top;
}

/** Costs grouped by category (empty category labelled "Uncategorized"), descending. */
function costsByCategory(db: Db, orgId: string, range: ReportRange, projectId?: number | null): CostsByCategoryPoint[] {
  const since = cutoffIso(range);
  const sinceDate = since ? since.slice(0, 10) : null;
  const pid = projectId ?? null;
  const params: Record<string, unknown> = { orgId };
  if (since) { params.since = since; params.sinceDate = sinceDate; }
  if (pid != null) params.pid = pid;
  const rows = db
    .prepare(
      `SELECT CASE WHEN TRIM(COALESCE(category, '')) = '' THEN 'Uncategorized' ELSE category END AS category,
              SUM(amount) AS amount
       FROM timetracker_costs
       WHERE org_id = @orgId ${since ? `AND created_at >= @since` : ``} ${pid != null ? `AND project_id = @pid` : ``}
       GROUP BY category ORDER BY amount DESC`
    )
    .all(params) as CostsByCategoryPoint[];
  // Employee pay is a cost category of its own (C8) — same rule as the project totals, range by
  // the day the work happened.
  const emp = (
    db
      .prepare(
        `SELECT COALESCE(SUM(${EMP_COST}), 0) AS amount
         FROM employee_entries e
         WHERE e.org_id = @orgId AND e.project_id IS NOT NULL ${sinceDate ? `AND e.worked_on >= @sinceDate` : ``} ${pid != null ? `AND e.project_id = @pid` : ``}`
      )
      .get(params) as { amount: number }
  ).amount;
  if (emp > 0) rows.push({ category: "Employee pay", amount: emp });
  // Itemized purchases join here too (ruled 08-06) — same synthetic-category shape as Employee pay.
  const items = (
    db
      .prepare(
        `SELECT COALESCE(SUM(i.amount), 0) AS amount
         FROM timetracker_project_items i
         WHERE i.org_id = @orgId AND i.deleted_at IS NULL ${since ? `AND i.created_at >= @since` : ``} ${pid != null ? `AND i.project_id = @pid` : ``}`
      )
      .get(params) as { amount: number }
  ).amount;
  if (items > 0) rows.push({ category: "Itemized purchases", amount: items });
  return rows.filter((r) => r.amount > 0).sort((a, b) => b.amount - a.amount);
}

/** Profit per project (revenue − spent, both from the ONE rollup) — negatives included; top N by
    absolute contribution with the remainder in "Others" so a big loss can never hide in the tail. */
function profitByProject(db: Db, orgId: string, projectId?: number | null): ProfitByProjectPoint[] {
  const rows = listProjects(db, orgId)
    .filter((p) => (projectId == null ? true : p.id === projectId))
    .map((p) => ({ name: p.name, profit: p.total_value - p.total_costs, revenue: p.total_value }))
    .filter((r) => r.profit !== 0 || r.revenue > 0)
    .sort((a, b) => b.profit - a.profit);
  if (rows.length <= TOP_PROJECTS) return rows.map(({ name, profit }) => ({ name, profit }));
  const byAbs = [...rows].sort((a, b) => Math.abs(b.profit) - Math.abs(a.profit));
  const keep = new Set(byAbs.slice(0, TOP_PROJECTS).map((r) => r.name));
  const kept = rows.filter((r) => keep.has(r.name));
  const others = rows.filter((r) => !keep.has(r.name)).reduce((s, r) => s + r.profit, 0);
  const out = kept.map(({ name, profit }) => ({ name, profit }));
  if (others !== 0) out.push({ name: "Others", profit: others });
  return out;
}

/** Margin per project — profit ÷ revenue as a percent. Projects with no revenue are EXCLUDED
    (no margin is not 0% margin), and margins are never averaged into an "Others" row. */
function marginByProject(db: Db, orgId: string, projectId?: number | null): MarginByProjectPoint[] {
  return listProjects(db, orgId)
    .filter((p) => (projectId == null ? true : p.id === projectId))
    .filter((p) => p.total_value > 0)
    .map((p) => ({ name: p.name, margin: ((p.total_value - p.total_costs) / p.total_value) * 100 }))
    .sort((a, b) => b.margin - a.margin)
    .slice(0, 12);
}

/** Contract-paid projects that CANNOT sit on the profit timeline: no contract_date. The empty
    state and the caption both read this so the absence is explained, never silent. */
function timelineExcludedCount(db: Db, orgId: string, projectId?: number | null): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM timetracker_projects
         WHERE org_id = ? AND archived_at IS NULL AND rate_type = 'contract' AND contract_kind = 'paid'
           AND contract_amount IS NOT NULL AND contract_date IS NULL ${projectId != null ? `AND id = ${Number(projectId)}` : ``}`
      )
      .get(orgId) as { c: number }
  ).c;
}

/**
 * Wasted hours: time on archived-but-not-purged projects + purged tombstone minutes,
 * split into for-profit (hourly + contract-paid) and non-profit (donated + unpaid + other).
 * Denominators are ALL-TIME tracked minutes (active + archived + purged) so the headline ratio
 * (wasted vs all tracked) and the same-kind ratio are both derivable in the renderer. Read-only.
 */
function wastedMetric(db: Db, orgId: string): WastedMetric {
  const all = [...listProjects(db, orgId), ...listArchivedProjects(db, orgId)]; // every non-purged project
  const tombstones = db
    .prepare(`SELECT project_type, total_minutes FROM timetracker_deletion_log WHERE org_id = ?`)
    .all(orgId) as { project_type: ProjectType; total_minutes: number }[];

  let fpWasted = 0,
    npWasted = 0,
    fpTracked = 0,
    npTracked = 0;
  for (const p of all) {
    const mins = Math.floor(p.total_seconds / 60);
    const fp = isForProfit(classifyProjectType(p.rate_type, p.contract_kind));
    if (fp) fpTracked += mins;
    else npTracked += mins;
    if (p.archived_at) {
      if (fp) fpWasted += mins;
      else npWasted += mins;
    }
  }
  for (const t of tombstones) {
    const fp = isForProfit(t.project_type);
    if (fp) {
      fpWasted += t.total_minutes;
      fpTracked += t.total_minutes;
    } else {
      npWasted += t.total_minutes;
      npTracked += t.total_minutes;
    }
  }
  return {
    forProfitMinutes: fpWasted,
    nonProfitMinutes: npWasted,
    allTrackedMinutes: fpTracked + npTracked,
    forProfitTrackedMinutes: fpTracked,
    nonProfitTrackedMinutes: npTracked,
  };
}

export function getReport(db: Db, orgId: string, range: ReportRange, granularity: ReportGranularity, projectId?: number | null): ReportData {
  return {
    // C10: the rail selection filters EVERYTHING — cards read off the selected project's own rollup
    // row (the rail's numbers), charts filter in SQL. No selection = the org-wide view, unchanged.
    totals: reportTotals(db, orgId, projectId),
    timeSeries: timeSeries(db, orgId, range, granularity, projectId),
    hoursByProject: hoursByProject(db, orgId, range, projectId),
    costsByCategory: costsByCategory(db, orgId, range, projectId),
    profitByProject: profitByProject(db, orgId, projectId),
    marginByProject: marginByProject(db, orgId, projectId),
    timelineExcluded: timelineExcludedCount(db, orgId, projectId),
    // Wasted counts archived/purged work; a rail selection is an ACTIVE project, so under a filter
    // these read zero by construction — stated in the view's caption rather than silently blank.
    wasted: wastedMetric(db, orgId),
  };
}
