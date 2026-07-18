/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Activity Log — append-only dist_log view, newest first, colored by action, before-id pagination.
// "Nuke logs" is THE sanctioned purge (native confirm names the real row count; brain records a
// NUKE row after, so the log is never silently empty).
import { useEffect, useState } from "react";
import type { DistLogRow } from "../../shared/types";
import { bumpRender } from "../../diag";

const PAGE = 50;

const ACTION_CLS: Record<string, string> = { COPY: "ok", REPLACE: "rp", ERROR: "er", NUKE: "nk" };

export default function ActivityLogModule({ onBack }: { onBack: () => void }) {
  bumpRender("Activity Log"); // DIAG-2
  const [rows, setRows] = useState<DistLogRow[]>([]);
  const [done, setDone] = useState(false); // no more pages

  const loadFirst = () =>
    void window.api.dist.listLog(PAGE).then((r) => {
      setRows(r);
      setDone(r.length < PAGE);
    });

  useEffect(() => {
    loadFirst();
    const onSynced = () => loadFirst(); // fresh rows land at the top — reload page 1
    window.api.on("dist:synced", onSynced);
    return () => window.api.off("dist:synced", onSynced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMore = () => {
    const last = rows[rows.length - 1];
    if (!last) return;
    void window.api.dist.listLog(PAGE, last.id).then((r) => {
      setRows((prev) => [...prev, ...r]);
      if (r.length < PAGE) setDone(true);
    });
  };

  const nuke = () => {
    void window.api.dist.countLog().then((n) => {
      if (!window.confirm(`☢ Permanently delete all ${n} activity log rows? This cannot be undone.`)) return;
      void window.api.dist.nukeLog().then(loadFirst);
    });
  };

  return (
    <main className="view shown">
      <div className="wrap">
        <button className="btn ghost" onClick={onBack} style={{ marginBottom: 10 }}>
          ← Back
        </button>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h1 className="pagetitle">Activity Log</h1>
          <button className="btn stop" onClick={nuke}>
            ☢ Nuke logs
          </button>
        </div>
        <p className="subtitle">Append-only distribution history — every copy, replace, and error.</p>

        <div className="log">
          {rows.map((r) => (
            <div key={r.id}>
              <span className="t">{r.created_at}</span>
              <span className={ACTION_CLS[r.action] ?? "t"}>{r.action}</span>
              {r.detail}
            </div>
          ))}
          {rows.length === 0 && <div className="t">No activity yet.</div>}
        </div>
        {!done && rows.length > 0 && (
          <button className="btn" style={{ marginTop: 12 }} onClick={loadMore}>
            Load more
          </button>
        )}
      </div>
    </main>
  );
}
