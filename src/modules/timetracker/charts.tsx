/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// TimeTracker hand-rolled SVG charts (Phase 5) — NO chart dependency, by canon ruling.
// Sizing: a MEASURED CONTAINER (ResizeObserver) feeds a pixel-space viewBox at fixed height, so
// text never distorts (preserveAspectRatio tricks warp glyphs; measuring does not). Colours come
// from CSS classes → --timetracker-chart-* tokens; zero hex values in this markup.
// Scales: Y ceiling = niceCeil(max) — 1/2/5×10^k, never hardcoded. Edge cases (per spec):
//   zero points  → the muted empty-state line, no SVG at all
//   one point    → a dot at centre-x (a 1-point line has no extent; the dot says "one sample")
//   all equal    → flat line below the ceiling (niceCeil(v) ≥ v keeps it off the top edge)
//   one dominant → linear scale by design; small values hug the baseline honestly (no log axis)
import { useEffect, useRef, useState, type ReactNode } from "react";

/** Container width via ResizeObserver — charts resize with their card, no aspect distortion. */
function useMeasuredWidth(): { ref: React.RefObject<HTMLDivElement | null>; width: number } {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(Math.floor(e.contentRect.width));
    });
    ro.observe(el);
    setWidth(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

/** Smallest "nice" ceiling ≥ v from {1,2,5}×10^k. v ≤ 0 → 1 so a flat-zero series still has an axis. */
export function niceCeil(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) {
    if (m * pow >= v) return m * pow;
  }
  return 10 * pow;
}

const truncate = (s: string, n = 16): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export interface SeriesPoint {
  label: string; // pre-formatted x label (granularity decides the format upstream)
  a: number;
  b?: number;
}

interface TimeSeriesProps {
  points: SeriesPoint[];
  /** "area" = filled area under line a. "dual" = two plain lines (a + b). */
  mode: "area" | "dual";
  emptyText: string;
  fmtY: (v: number) => string;
}

const H = 190;
const M = { top: 12, right: 12, bottom: 24, left: 48 };

export function TimeSeriesChart({ points, mode, emptyText, fmtY }: TimeSeriesProps) {
  const { ref, width } = useMeasuredWidth();
  const hasData = points.length > 0;

  let body: ReactNode = null;
  if (hasData && width > 0) {
    const iw = Math.max(10, width - M.left - M.right);
    const ih = H - M.top - M.bottom;
    const maxVal = Math.max(...points.map((p) => Math.max(p.a, p.b ?? 0)));
    const yMax = niceCeil(maxVal);
    const x = (i: number): number =>
      points.length === 1 ? M.left + iw / 2 : M.left + (i * iw) / (points.length - 1);
    const y = (v: number): number => M.top + ih - (Math.max(0, v) / yMax) * ih;

    const linePath = (pick: (p: SeriesPoint) => number): string =>
      points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(pick(p)).toFixed(1)}`).join(" ");
    const areaPath = `${linePath((p) => p.a)} L${x(points.length - 1).toFixed(1)},${(M.top + ih).toFixed(1)} L${x(0).toFixed(1)},${(M.top + ih).toFixed(1)} Z`;

    // ≤6 x labels, evenly stepped, always including the last point.
    const step = Math.max(1, Math.ceil(points.length / 6));
    const xTicks = points.map((p, i) => ({ p, i })).filter(({ i }) => i % step === 0 || i === points.length - 1);

    body = (
      <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="img" aria-label="chart">
        {[0, 1, 2, 3, 4].map((t) => {
          const v = (yMax * t) / 4;
          const gy = y(v);
          return (
            <g key={t}>
              <line className="tt-chartgrid" x1={M.left} y1={gy} x2={width - M.right} y2={gy} />
              <text className="tt-chartaxis" x={M.left - 6} y={gy + 3} textAnchor="end">{fmtY(v)}</text>
            </g>
          );
        })}
        {points.length === 1 ? (
          <>
            <circle className={`tt-chartdot ${mode === "area" ? "hours" : "value"}`} cx={x(0)} cy={y(points[0].a)} r={4} />
            {mode === "dual" && points[0].b !== undefined && (
              <circle className="tt-chartdot costs" cx={x(0)} cy={y(points[0].b)} r={4} />
            )}
          </>
        ) : (
          <>
            {mode === "area" && <path className="tt-chartarea hours" d={areaPath} />}
            <path className={`tt-chartline ${mode === "area" ? "hours" : "value"}`} d={linePath((p) => p.a)} />
            {mode === "dual" && <path className="tt-chartline costs" d={linePath((p) => p.b ?? 0)} />}
          </>
        )}
        {xTicks.map(({ p, i }) => (
          <text key={i} className="tt-chartaxis" x={x(i)} y={H - 8} textAnchor="middle">{p.label}</text>
        ))}
      </svg>
    );
  }

  return (
    <div ref={ref} className="tt-chartbox">
      {hasData ? body : <div className="tt-chartempty">{emptyText}</div>}
    </div>
  );
}

export interface BarRow {
  label: string;
  value: number;
}

interface HBarProps {
  rows: BarRow[];
  emptyText: string;
  fmtV: (v: number) => string;
}

/** Horizontal bars, descending order expected from the caller; shared by HOURS BY PROJECT and
    COSTS BY CATEGORY (the latter's chart type is a flagged reversible assumption). */
export function HBarChart({ rows, emptyText, fmtV }: HBarProps) {
  const { ref, width } = useMeasuredWidth();
  const ROW = 24;
  const LEFT = 120;
  const RIGHT = 56;
  const AXIS = 18;
  const height = rows.length * ROW + AXIS + 6;

  let body: ReactNode = null;
  if (rows.length > 0 && width > 0) {
    const iw = Math.max(10, width - LEFT - RIGHT);
    const barMax = niceCeil(Math.max(...rows.map((r) => r.value)));
    body = (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="bar chart">
        {rows.map((r, i) => {
          const w = r.value > 0 ? Math.max(2, (r.value / barMax) * iw) : 0;
          const cy = i * ROW;
          return (
            <g key={`${r.label}:${i}`}>
              <text className="tt-chartaxis" x={LEFT - 8} y={cy + ROW / 2 + 3} textAnchor="end">{truncate(r.label)}</text>
              <rect className="tt-chartbartrack" x={LEFT} y={cy + 5} width={iw} height={ROW - 10} rx={3} />
              {w > 0 && <rect className="tt-chartbar" x={LEFT} y={cy + 5} width={w} height={ROW - 10} rx={3} />}
              <text className="tt-chartaxis strong" x={LEFT + iw + 6} y={cy + ROW / 2 + 3}>{fmtV(r.value)}</text>
            </g>
          );
        })}
        <line className="tt-chartgrid" x1={LEFT} y1={rows.length * ROW + 2} x2={LEFT + iw} y2={rows.length * ROW + 2} />
        <text className="tt-chartaxis" x={LEFT} y={height - 4} textAnchor="start">0</text>
        <text className="tt-chartaxis" x={LEFT + iw} y={height - 4} textAnchor="end">{fmtV(barMax)}</text>
      </svg>
    );
  }

  return (
    <div ref={ref} className="tt-chartbox">
      {rows.length > 0 ? body : <div className="tt-chartempty">{emptyText}</div>}
    </div>
  );
}
