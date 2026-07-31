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

/**
 * Totals mirror the grand-total bar exactly (same listProjects/grandTotals rollup),
 * plus donated hours (counted in time, excluded from $ value) and the group count.
 */
function reportTotals(db: Db, orgId: string): ReportTotals {
  const gt = grandTotals(db, orgId);
  const projects = listProjects(db, orgId);
  const donated_seconds = projects
    .filter((p) => p.rate_type === "contract" && p.contract_kind === "donated")
    .reduce((s, p) => s + p.total_seconds, 0);
  const group_count = (db.prepare(`SELECT COUNT(*) AS c FROM timetracker_groups WHERE org_id = ?`).get(orgId) as { c: number }).c;
  return {
    total_seconds: gt.total_seconds,
    total_value: gt.total_value,
    total_costs: gt.total_costs,
    total_invested: gt.total_value + gt.total_costs,
    donated_seconds,
    project_count: gt.project_count,
    group_count,
  };
}

/**
 * Per-bucket hours, $ value, and $ costs.
 * - hours: all sessions (incl. donated) bucketed by started_at.
 * - value: hourly = rate x hours per bucket (by session); paid contract = contract_amount
 *   attributed to the project's created_at bucket. Donated excluded. Summed over "all",
 *   this equals the grand-total bar's total_value.
 * - costs: costs.amount bucketed by created_at.
 */
function timeSeries(db: Db, orgId: string, range: ReportRange, granularity: ReportGranularity): TimeSeriesPoint[] {
  const since = cutoffIso(range);
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
    WHERE p.org_id = @orgId AND p.archived_at IS NULL ${since ? `AND te.started_at >= @since` : ``}
    GROUP BY k`;
  for (const r of db.prepare(sessionSql).all(since ? { orgId, since } : { orgId }) as {
    k: string;
    secs: number;
    hourly_value: number;
  }[]) {
    if (!r.k) continue;
    const p = at(r.k);
    p.hours += (r.secs ?? 0) / 3600;
    p.value += r.hourly_value ?? 0;
  }

  // paid-contract $ value attributed to the project's created_at bucket
  const paidSql = `
    SELECT ${bucket("created_at")} AS k, SUM(contract_amount) AS amt
    FROM timetracker_projects
    WHERE org_id = @orgId AND rate_type = 'contract' AND contract_kind = 'paid' AND contract_amount IS NOT NULL AND archived_at IS NULL
    ${since ? `AND created_at >= @since` : ``}
    GROUP BY k`;
  for (const r of db.prepare(paidSql).all(since ? { orgId, since } : { orgId }) as { k: string; amt: number }[]) {
    if (!r.k) continue;
    at(r.k).value += r.amt ?? 0;
  }

  // costs by created_at bucket
  const costSql = `
    SELECT ${bucket("c.created_at")} AS k, SUM(c.amount) AS amt
    FROM timetracker_costs c JOIN timetracker_projects p ON p.id = c.project_id
    WHERE p.org_id = @orgId AND p.archived_at IS NULL ${since ? `AND c.created_at >= @since` : ``}
    GROUP BY k`;
  for (const r of db.prepare(costSql).all(since ? { orgId, since } : { orgId }) as { k: string; amt: number }[]) {
    if (!r.k) continue;
    at(r.k).costs += r.amt ?? 0;
  }

  return [...points.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
}

/** Hours per project (descending), top N with the remainder collapsed into "Others". */
function hoursByProject(db: Db, orgId: string, range: ReportRange): HoursByProjectPoint[] {
  const since = cutoffIso(range);
  const rows = db
    .prepare(
      `SELECT p.name AS name, SUM(te.duration_seconds) AS secs
       FROM timetracker_time_entries te JOIN timetracker_projects p ON p.id = te.project_id
       WHERE p.org_id = @orgId AND p.archived_at IS NULL ${since ? `AND te.started_at >= @since` : ``}
       GROUP BY p.id ORDER BY secs DESC`
    )
    .all(since ? { orgId, since } : { orgId }) as { name: string; secs: number }[];
  const ranked = rows.map((r) => ({ name: r.name, hours: (r.secs ?? 0) / 3600 })).filter((r) => r.hours > 0);
  if (ranked.length <= TOP_PROJECTS) return ranked;
  const top = ranked.slice(0, TOP_PROJECTS);
  const others = ranked.slice(TOP_PROJECTS).reduce((s, r) => s + r.hours, 0);
  if (others > 0) top.push({ name: "Others", hours: others });
  return top;
}

/** Costs grouped by category (empty category labelled "Uncategorized"), descending. */
function costsByCategory(db: Db, orgId: string, range: ReportRange): CostsByCategoryPoint[] {
  const since = cutoffIso(range);
  const rows = db
    .prepare(
      `SELECT CASE WHEN TRIM(COALESCE(category, '')) = '' THEN 'Uncategorized' ELSE category END AS category,
              SUM(amount) AS amount
       FROM timetracker_costs
       WHERE org_id = @orgId ${since ? `AND created_at >= @since` : ``}
       GROUP BY category ORDER BY amount DESC`
    )
    .all(since ? { orgId, since } : { orgId }) as CostsByCategoryPoint[];
  return rows.filter((r) => r.amount > 0);
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

export function getReport(db: Db, orgId: string, range: ReportRange, granularity: ReportGranularity): ReportData {
  return {
    totals: reportTotals(db, orgId),
    timeSeries: timeSeries(db, orgId, range, granularity),
    hoursByProject: hoursByProject(db, orgId, range),
    costsByCategory: costsByCategory(db, orgId, range),
    wasted: wastedMetric(db, orgId),
  };
}
