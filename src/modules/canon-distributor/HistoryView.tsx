/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// History — internal Distributor view. dist_log grouped into per-project blocks (one block per
// target project, parsed from the \<project>\CANON path in each row) so you can see where every
// canon .md landed, and when. Header: "{Project} - Wednesday 7/15/2026 - 10:28am" (Central time,
// latest activity). Per-block Nuke purges that project's LOG ROWS ONLY — never files.
import { useEffect, useState } from "react";
import type { DistLogRow } from "../../shared/types";
import { bumpRender } from "../../diag";

const ACTION_CLS: Record<string, string> = { COPY: "ok", REPLACE: "rp", ERROR: "er", NUKE: "nk", PRUNE: "t" };

// detail carries "…\<project>\CANON…" on COPY/REPLACE arrows and PRUNE "removed from" lines.
const PROJECT_RE = /[\\/]([^\\/]+)[\\/]CANON(?:[\\/]|$|[\s)])/;

// SQLite CURRENT_TIMESTAMP is UTC "YYYY-MM-DD HH:MM:SS" → Date.
function utc(created_at: string): Date {
  return new Date(created_at.replace(" ", "T") + "Z");
}

// Central time, per spec: Wednesday 7/15/2026 - 10:28am (no military time, slashes not dashes).
const FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  weekday: "long",
  month: "numeric",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
function fmtParts(d: Date): { day: string; date: string; time: string } {
  const p = Object.fromEntries(FMT.formatToParts(d).map((x) => [x.type, x.value]));
  return {
    day: p.weekday,
    date: `${p.month}/${p.day}/${p.year}`,
    time: `${p.hour}:${p.minute}${p.dayPeriod.toLowerCase().replace(/\s|\./g, "")}`,
  };
}
const fmtLong = (d: Date) => {
  const { day, date, time } = fmtParts(d);
  return `${day} ${date} - ${time}`;
};
const fmtShort = (d: Date) => {
  const { date, time } = fmtParts(d);
  return `${date} ${time}`;
};

export default function HistoryView({ onBack }: { onBack: () => void }) {
  bumpRender("History"); // DIAG-2
  const [rows, setRows] = useState<DistLogRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = () => void window.api.dist.history().then(setRows);
  useEffect(() => {
    load();
  }, []);

  const nuke = (project: string, count: number) => {
    if (!window.confirm(`☢ Purge all ${count} history log rows for "${project}"? Files are NOT touched. This cannot be undone.`)) return;
    window.api.dist
      .nukeHistory(project)
      .then(load)
      .catch((e: unknown) => setErr(String(e)));
  };

  // project -> rows (input is newest-first, so each block's first row is its latest activity)
  const blocks = new Map<string, DistLogRow[]>();
  for (const r of rows) {
    const m = PROJECT_RE.exec(r.detail);
    if (!m) continue; // SYNC summaries / NUKE / pathless errors stay in the Activity Log only
    const g = blocks.get(m[1]);
    if (g) g.push(r);
    else blocks.set(m[1], [r]);
  }

  return (
    <main className="view shown">
      <div className="wrap">
        <button className="btn ghost" onClick={onBack} style={{ marginBottom: 10 }}>
          ← Back
        </button>
        <h1 className="pagetitle">History</h1>
        <p className="subtitle">Where every canon file landed, by project — and when (Central time).</p>

        {err !== null && (
          <p className="hint" style={{ color: "var(--canon-distributor-error)", marginBottom: 10 }}>
            {err}
          </p>
        )}

        {[...blocks.entries()].map(([project, logRows]) => (
          <div className="modcard" key={project} style={{ marginBottom: 14 }}>
            <div className="row1" style={{ justifyContent: "space-between" }}>
              <span className="name">
                {project} - {fmtLong(utc(logRows[0].created_at))}
              </span>
              <button className="btn stop" onClick={() => nuke(project, logRows.length)}>
                ☢ Nuke
              </button>
            </div>
            <div className="log">
              {logRows.map((r) => (
                <div key={r.id}>
                  <span className="t">{fmtShort(utc(r.created_at))}</span>
                  <span className={ACTION_CLS[r.action] ?? "t"}>{r.action}</span>
                  {r.detail}
                </div>
              ))}
            </div>
          </div>
        ))}

        {blocks.size === 0 && <p className="hint">No history yet — run a sync from the Distributor first.</p>}
      </div>
    </main>
  );
}
