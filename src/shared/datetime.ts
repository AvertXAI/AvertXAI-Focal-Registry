// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: THE single date/time formatter for the whole product. No surface formats a stored
//              timestamp on its own — every renderer view and the report/CSV writers call in here.
//              Two stored shapes exist, BOTH UTC:
//                • CURRENT_TIMESTAMP  "2026-07-20 03:05:52"       (space, NO zone marker)
//                • toISOString()      "2024-12-01T03:23:21.167Z"  (T … Z)
//              The first has no Z; parsing it with `new Date()` reads it as LOCAL — that was the bug
//              (History "03:05" shown for an event that happened 10:05pm the day before, in Central).
//              parseUtc() forces UTC, then Intl renders in the viewer's LOCAL zone. Intl is built in
//              — no dependency.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: src/shared/datetime.ts
//------------------------------------------------------------

export type DateMode = "iso" | "eventTime" | "dateOnly" | "titleDate";

/** Normalize either stored shape to a Date, ALWAYS treating the stored value as UTC. */
function parseUtc(value: string): Date | null {
  const s = value.trim();
  if (s === "") return null;
  let norm = s;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) norm = s.replace(" ", "T") + "Z"; // CURRENT_TIMESTAMP → explicit UTC (the fix)
  else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) norm = s + "T00:00:00Z"; // bare date → UTC midnight
  const d = new Date(norm);
  return Number.isNaN(d.getTime()) ? null : d;
}

const partsOf = (d: Date, opts: Intl.DateTimeFormatOptions): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-US", opts).formatToParts(d)) out[p.type] = p.value;
  return out;
};

// LOCAL "July 19, 2026 10:05pm" — 12-hour, no leading zero on the hour, lowercase meridiem, month spelled out.
function eventTime(d: Date): string {
  const p = partsOf(d, { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
  return `${p.month} ${p.day}, ${p.year} ${p.hour}:${p.minute}${(p.dayPeriod ?? "").toLowerCase()}`;
}

// LOCAL "07/19/2026".
function dateOnly(d: Date): string {
  const p = partsOf(d, { month: "2-digit", day: "2-digit", year: "numeric" });
  return `${p.month}/${p.day}/${p.year}`;
}

/**
 * Format ONE stored timestamp. Callers pick a mode; they never pass a format string.
 *  - iso       → normalized UTC ISO-8601 with Z. Report .md frontmatter and CSV ONLY (machine-ingestible).
 *  - eventTime → LOCAL "July 19, 2026 10:05pm". Run finished, error logged, last scanned.
 *  - dateOnly  → LOCAL "07/19/2026". Capture-derived ranges and dense table cells.
 *  - titleDate → same as eventTime. Document titles / PDF header.
 * Returns "" for null/empty; echoes the raw value if it cannot be parsed (never silently drops data).
 */
export function formatStamp(value: string | null | undefined, mode: DateMode): string {
  if (value === null || value === undefined || value === "") return "";
  const d = parseUtc(value);
  if (d === null) return String(value);
  switch (mode) {
    case "iso": return d.toISOString();
    case "dateOnly": return dateOnly(d);
    case "eventTime":
    case "titleDate": return eventTime(d);
  }
}

/** Format an A → B range in one mode. "—" when both ends are empty. */
export function formatRange(a: string | null | undefined, b: string | null | undefined, mode: DateMode): string {
  if (!a && !b) return "—";
  return `${formatStamp(a, mode)} → ${formatStamp(b, mode)}`;
}
