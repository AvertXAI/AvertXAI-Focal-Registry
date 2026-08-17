/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// The Updated Notes feed — one table of everything that changed, in the mockup's three columns:
// When | What was updated | Drive.
//
// IT IS ALSO THE MODULE'S EVENT LOG. Notes created, folders renamed, scans completed, syncs run —
// and the warnings and errors from all four — land in the same table, because "what changed" and
// "what went wrong" are the same question to the user. A level of warn or error paints the row's
// left edge; nothing else about the row shouts.
//
// OPENING THIS TAB MARKS EVERYTHING SEEN — that is what clears the badge. The rows themselves are
// never deleted; seen_at is a stamp, not a purge.
import { useEffect, useState } from "react";
import type { ScanUpdateRow } from "../../../shared/types";
import { signalAppToast } from "../../../App";
import "./scannotes.css";

const TAG_LABEL: Record<string, string> = { note: "Note", rename: "Rename", scan: "Scan", sync: "Sync" };

function longStamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const h = d.getHours();
  return `${d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })} ${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
}

/** The detail line carries `old -> new` for renames; the arrow is tinted without parsing markup. */
function Detail({ text }: { text: string }) {
  const i = text.indexOf("->");
  if (i < 0) return <div className="detail">{text}</div>;
  return (
    <div className="detail">
      {text.slice(0, i)}
      <span className="arrow">-&gt;</span>
      {text.slice(i + 2)}
    </div>
  );
}

export default function UpdatesTab({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<ScanUpdateRow[]>([]);

  useEffect(() => {
    void window.api.scan.notes
      .updates(200)
      .then((r) => {
        setRows(r);
        // Mark seen AFTER the rows are in hand, so the unseen tint on this render still shows the
        // user what is new — the badge clears, the highlight survives until the next visit.
        return window.api.scan.notes.markSeen();
      })
      .catch((e: unknown) => signalAppToast(e instanceof Error ? e.message : String(e), "err"));
  }, [refreshKey]);

  return (
    <>
      <div className="scannotes-feedhead">
        <div className="fh">Updated Notes</div>
        <div className="fs">
          Everything that changed — notes created or edited, folders renamed, scans and syncs.
          Persists across every drive connection and scan.
        </div>
      </div>
      <div className="scannotes-feed">
        <table>
          <thead>
            <tr>
              <th style={{ width: 190 }}>When</th>
              <th>What was updated</th>
              <th style={{ width: 170 }}>Drive</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={3} className="scannotes-empty">Nothing has changed yet. Notes, renames, scans and syncs all land here.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.uuid} className={`${r.seen_at === null ? "new " : ""}${r.level === "warn" || r.level === "error" ? r.level : ""}`.trim()}>
                <td className="dt">{longStamp(r.ts)}</td>
                <td>
                  <span className={`tag ${r.kind}`}>{TAG_LABEL[r.kind] ?? r.kind}</span>
                  <span className="what">{r.message}</span>
                  {r.request_id && <span className="scannotes-req">{r.request_id}</span>}
                  {r.detail && <Detail text={r.detail} />}
                </td>
                <td>{r.drive_label ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
