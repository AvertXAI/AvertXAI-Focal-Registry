/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// TimeTracker Analytics (Phase 5) — controls row (range + granularity + Export PDF), SIX all-time
// summary cards (they mirror the grand-total bar; range/granularity drive the CHARTS only — the
// service's reportTotals is all-time by construction), the two wasted cards, and four hand-rolled
// SVG charts. Export PDF rides Electron's built-in printToPDF main-side (no dependency), lands in
// Downloads with a MONTH-FIRST filename, and the success line reveals the file.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { TimeTrackerProjectListItem, TimeTrackerReportData, TimeTrackerReportGranularity, TimeTrackerReportRange } from "../../shared/types";
import { ChartModal, HBarChart, TimeSeriesChart, type SeriesPoint } from "./charts";
import Tip from "../../components/Tip";

const RANGES: Array<{ key: TimeTrackerReportRange; label: string }> = [
  { key: "all", label: "All" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
];
const GRANS: Array<{ key: TimeTrackerReportGranularity; label: string }> = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];

const fmtHM = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
};
const fmtMoney = (n: number): string =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoneyAxis = (n: number): string =>
  n >= 1000 ? `$${(n / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k` : `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const fmtHoursAxis = (n: number): string => `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })}h`;
const pct = (num: number, den: number): number => (den > 0 ? Math.round((num / den) * 100) : 0);

/** Bucket keys arrive sortable (day YYYY-MM-DD · week YYYY-Www · month YYYY-MM); labels follow the
    granularity: 06/11 for Day, W23 for Week, the month name for Month — MONTH-FIRST throughout. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const bucketLabel = (bucket: string, g: TimeTrackerReportGranularity): string => {
  if (g === "day") {
    const [, m, d] = bucket.split("-");
    return m && d ? `${m}/${d}` : bucket;
  }
  if (g === "week") {
    const w = bucket.split("-W")[1];
    return w ? `W${w}` : bucket;
  }
  const [y, m] = bucket.split("-");
  const mi = Number(m) - 1;
  return mi >= 0 && mi < 12 ? `${MONTHS[mi]} ${y?.slice(2) ?? ""}`.trim() : bucket;
};

interface Props {
  /** C10 (08-06): the rail selection. One project filters everything here to it; null shows all. */
  project: TimeTrackerProjectListItem | null;
  onClearSelection: () => void;
}

export default function AnalyticsView({ project, onClearSelection }: Props) {
  const api = window.api;
  const [range, setRange] = useState<TimeTrackerReportRange>("all");
  const [gran, setGran] = useState<TimeTrackerReportGranularity>("day");
  const [data, setData] = useState<TimeTrackerReportData | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const reload = useCallback((): void => {
    void api.timetracker.reports
      .get(range, gran, project?.id ?? null)
      .then(setData)
      .catch((e: unknown) => {
        console.error("[timetracker] report read failed:", e);
        setData(null);
      });
  }, [api, range, gran, project?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    reload();
  }, [reload]);

  const exportPdf = (): void => {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    void api.timetracker.reports.exportPdf()
      .then((p) => { setExporting(false); setExportedPath(p); })
      .catch((e: unknown) => { setExporting(false); setExportedPath(null); setExportError(e instanceof Error ? e.message : String(e)); });
  };
  const reveal = (): void => {
    if (exportedPath) void api.timetracker.reports.revealExportedPdf(exportedPath).catch(() => {});
  };

  const t = data?.totals ?? null;
  const w = data?.wasted ?? null;

  const seriesHours: SeriesPoint[] = (data?.timeSeries ?? [])
    .filter((p) => p.hours > 0)
    .map((p) => ({ label: bucketLabel(p.bucket, gran), a: p.hours }));
  const seriesMoney: SeriesPoint[] = (data?.timeSeries ?? [])
    .filter((p) => p.value > 0 || p.costs > 0)
    .map((p) => ({ label: bucketLabel(p.bucket, gran), a: p.value, b: p.costs }));
  // PROFIT per bucket = revenue − spend, straight off the same series (no fourth money rule):
  // value already carries revenue on its ruled dates, costs carries every spend source.
  const seriesProfit: SeriesPoint[] = (data?.timeSeries ?? [])
    .filter((p) => p.value !== 0 || p.costs !== 0)
    .map((p) => ({ label: bucketLabel(p.bucket, gran), a: p.value - p.costs }));
  const barsProjects = (data?.hoursByProject ?? []).map((r) => ({ label: r.name, value: r.hours }));
  const barsCosts = (data?.costsByCategory ?? []).map((r) => ({ label: r.category, value: r.amount }));
  const barsProfit = (data?.profitByProject ?? []).map((r) => ({ label: r.name, value: r.profit }));
  const barsMargin = (data?.marginByProject ?? []).map((r) => ({ label: r.name, value: r.margin }));
  const excluded = data?.timelineExcluded ?? 0;

  // ONE modal for every chart (ruled): the card click stores a key; the modal re-renders the SAME
  // chart component at modal width (the charts measure their container, so nothing is duplicated).
  const [expanded, setExpanded] = useState<string | null>(null);
  const fmtPctAxis = (n: number): string => `${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}%`;
  const excludedNote =
    excluded > 0
      ? ` ${excluded} contract project${excluded === 1 ? " has" : "s have"} no contract date and ${excluded === 1 ? "is" : "are"} not on the timeline.`
      : "";
  const CHARTS: Array<{ key: string; title: string; caption?: string; node: ReactNode }> = [
    { key: "hours", title: "Hours over time", node: <TimeSeriesChart points={seriesHours} mode="area" emptyText="No hours in this range" fmtY={fmtHoursAxis} /> },
    {
      key: "money",
      title: "Revenue vs spent over time",
      node: (
        <>
          <TimeSeriesChart points={seriesMoney} mode="dual" emptyText={`No revenue or spend in this range.${excludedNote}`} fmtY={fmtMoneyAxis} />
          <div className="tt-legend">
            <span className="tt-legenditem"><span className="tt-legendmark costs" />Spent</span>
            <span className="tt-legenditem"><span className="tt-legendmark value" />Revenue</span>
          </div>
        </>
      ),
    },
    {
      key: "profit",
      title: "Profit over time",
      caption: `Revenue lands on the contract date; spend on the day it happened.${excludedNote}`,
      node: <TimeSeriesChart points={seriesProfit} mode="area" emptyText={`No profit to draw in this range.${excludedNote}`} fmtY={fmtMoneyAxis} />,
    },
    { key: "hoursby", title: "Hours by project", node: <HBarChart rows={barsProjects} emptyText="No hours in this range" fmtV={fmtHoursAxis} /> },
    { key: "profitby", title: "Profit by project", node: <HBarChart rows={barsProfit} emptyText="No projects with revenue or spend yet" fmtV={fmtMoneyAxis} /> },
    { key: "marginby", title: "Margin by project", caption: "Projects with no revenue are excluded — no margin is not 0%.", node: <HBarChart rows={barsMargin} emptyText="No projects with revenue yet" fmtV={fmtPctAxis} /> },
    { key: "costs", title: "Spend by category", node: <HBarChart rows={barsCosts} emptyText="No spend in this range" fmtV={fmtMoneyAxis} /> },
  ];
  const expandedChart = CHARTS.find((c) => c.key === expanded) ?? null;

  return (
    <div className="tt-analytics">
      {(exportedPath || exportError) && (
        <div className={"tt-exportline" + (exportError ? " err" : "")} role="status">
          {exportError ? (
            <>Export failed — {exportError}</>
          ) : (
            <>
              ✓ Analytics saved:{" "}
              <button className="tt-pathlink" onClick={reveal} title="Reveal in File Explorer">{exportedPath}</button>
            </>
          )}
        </div>
      )}

      {/* C10: the active filter is NAMED, with its own way out — a silent filter reads as wrong data. */}
      {project && (
        <div className="tt-filterchip" role="status">
          Filtered to <b>{project.name}</b> — cards and charts show this project only; wasted-time
          reads zero here because an active selection cannot be archived.
          <button className="tt-filterclear" onClick={onClearSelection} title="Show every project">✕ Show all</button>
        </div>
      )}

      {/* controls — range + granularity drive the CHARTS only */}
      <div className="tt-toolrow">
        <span className="tt-seg" role="group" aria-label="Range">
          {RANGES.map((r) => (
            <button key={r.key} className={"tt-segbtn" + (range === r.key ? " on" : "")} onClick={() => setRange(r.key)}>{r.label}</button>
          ))}
        </span>
        <span className="tt-seg" role="group" aria-label="Granularity">
          {GRANS.map((g) => (
            <button key={g.key} className={"tt-segbtn" + (gran === g.key ? " on" : "")} onClick={() => setGran(g.key)}>{g.label}</button>
          ))}
        </span>
        <button className="tt-btn ghost tt-exportbtn" disabled={exporting} onClick={exportPdf}>
          {exporting ? "Exporting…" : "Export PDF"}
        </button>
      </div>

      {/* ALL-TIME summary cards — the RULED vocabulary: Revenue · Spent · Profit · Margin.
          "Total invested" (revenue ADDED to costs) is gone — it was the naming collision. */}
      <div className="tt-cards tt-cards6">
        <div className="tt-card"><span className="tt-cardlabel">Total hours</span><span className="tt-cardvalue">{t ? fmtHM(t.total_seconds) : "—"}</span>
          <span className="tt-cardsub">incl. {t ? fmtHM(t.donated_seconds) : "—"} donated</span></div>
        <div className="tt-card"><span className="tt-cardlabel">Revenue</span><span className="tt-cardvalue">{t ? fmtMoney(t.revenue) : "—"}</span>
          <span className="tt-cardsub">contracted + hourly earnings</span></div>
        <div className="tt-card"><span className="tt-cardlabel">Spent</span><span className="tt-cardvalue">{t ? fmtMoney(t.spent) : "—"}</span>
          <span className="tt-cardsub">crew + purchases + costs</span></div>
        <div className={"tt-card" + (t && t.profit < 0 ? " tt-cardloss" : " tt-cardprofit")}>
          <span className="tt-cardlabel">Profit</span>
          <span className="tt-cardvalue">{t ? fmtMoney(t.profit) : "—"}</span>
          <span className="tt-cardsub">revenue − spent</span>
        </div>
        <div className={"tt-card" + (t && t.margin != null && t.margin < 0 ? " tt-cardloss" : " tt-cardprofit")}>
          <span className="tt-cardlabel">Margin</span>
          <span className="tt-cardvalue">{t && t.margin != null ? `${t.margin.toFixed(1)}%` : "—"}</span>
          <span className="tt-cardsub">profit ÷ revenue</span>
        </div>
        <div className="tt-card"><span className="tt-cardlabel">Projects</span><span className="tt-cardvalue">{t ? t.project_count : "—"}</span></div>
        <div className="tt-card"><span className="tt-cardlabel">Groups</span><span className="tt-cardvalue">{t ? t.group_count : "—"}</span></div>
      </div>
      <div className="tt-crmseed">{project ? "Summary cards are all-time for the selected project." : "Summary cards are all-time and match the grand-total bar."} Range &amp; granularity drive the charts below.</div>

      {/* wasted cards */}
      <div className="tt-wastedrow">
        <div className="tt-card">
          <span className="tt-cardlabel">For-profit wasted</span>
          <span className="tt-cardvalue">{w ? fmtHM(w.forProfitMinutes * 60) : "—"}</span>
          <span className="tt-cardsub">
            {w ? `${pct(w.forProfitMinutes, w.allTrackedMinutes)}% of all tracked time · ${pct(w.forProfitMinutes, w.forProfitTrackedMinutes)}% of for-profit work` : ""}
          </span>
        </div>
        <div className="tt-card">
          <span className="tt-cardlabel">Non-profit wasted</span>
          <span className="tt-cardvalue">{w ? fmtHM(w.nonProfitMinutes * 60) : "—"}</span>
          <span className="tt-cardsub">
            {w ? `${pct(w.nonProfitMinutes, w.allTrackedMinutes)}% of all tracked time · ${pct(w.nonProfitMinutes, w.nonProfitTrackedMinutes)}% of non-profit work` : ""}
          </span>
        </div>
      </div>
      <div className="tt-crmseed">
        "Wasted" = time on archived or purged projects (hourly + paid = for-profit; donated + unpaid =
        non-profit). Archiving wastes a project's hours; restoring un-wastes them.
      </div>

      {/* Charts — hand-rolled SVG, two per row. Every card opens the SAME chart full-size in the
          one ChartModal (ruled 08-06); the ⤢ affordance names the click. */}
      <div className="tt-chartsgrid">
        {CHARTS.map((c) => (
          <div key={c.key} className="tt-chartcard tt-chartclick" role="button" tabIndex={0}
            title={`Open ${c.title} full-size`}
            onClick={() => setExpanded(c.key)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(c.key); } }}>
            <span className="tt-chartexpand" aria-hidden="true">⤢</span>
            <div className="tt-secttitle">{c.title}</div>
            {c.node}
            {c.caption && <div className="tt-crmseed">{c.caption}</div>}
          </div>
        ))}
      </div>

      {expandedChart && (
        <ChartModal title={expandedChart.title} onClose={() => setExpanded(null)} onExport={exportPdf} exporting={exporting}>
          {expandedChart.node}
          {expandedChart.caption && <div className="tt-crmseed">{expandedChart.caption}</div>}
        </ChartModal>
      )}

      <Tip id="TIP-TT-004" />
    </div>
  );
}
