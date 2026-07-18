// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI RunBooks.Systems — CRM (Data Viewer module)
// Description: Record-detail modal — every column as key→value with a type badge, full (untruncated)
//              values, null shown explicitly. View mode = read-only footer; Developer mode shows
//              Edit/Delete STUBBED (disabled) + a destruction-guard line built from the table's FKs.
//              No write path exists in this build.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: CRM/src/modules/data-viewer/components/RecordModal.tsx
//------------------------------------------------------------
import type { DbColumn, DbForeignKey } from "../../../shared/types";

interface Props {
  table: string;
  row: Record<string, unknown>;
  columns: DbColumn[];
  fks: DbForeignKey[];
  devMode: boolean;
  onClose: () => void;
}

export default function RecordModal({ table, row, columns, fks, devMode, onClose }: Props) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal dv-record" onClick={(e) => e.stopPropagation()}>
        <div className="dv-record-head">
          <h3>
            <b>{table}</b> — record
          </h3>
          <button className="iconbtn" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="dv-record-body">
          {columns.map((c) => (
            <div className="dv-field" key={c.name}>
              <div className="dv-field-key">
                <span className="dv-field-name">{c.name}</span>
                <span className="dv-badge">{c.type || "?"}</span>
                {c.pk && <span className="dv-badge pk">PK</span>}
                {c.notnull && <span className="dv-badge nn">NOT NULL</span>}
              </div>
              <div className="dv-field-val">{fmt(row[c.name])}</div>
            </div>
          ))}
        </div>

        <div className="dv-record-foot">
          {devMode ? (
            <>
              <div className="dv-guard">{guardText(table, fks)}</div>
              <div className="dv-record-actions">
                <button className="btn" disabled title="Editing is stubbed in this build">
                  Edit
                </button>
                <button className="btn stop" disabled title="Deleting is stubbed in this build">
                  Delete
                </button>
              </div>
            </>
          ) : (
            <span className="dv-readonly">Read-only · switch to Developer mode to preview edit/delete (stubbed).</span>
          )}
        </div>
      </div>
    </div>
  );
}

// Full value: null explicit, objects pretty-ish, everything else as-is (no truncation here).
function fmt(v: unknown) {
  if (v === null || v === undefined) return <span className="dv-null">null</span>;
  if (typeof v === "object") return <code className="dv-json">{JSON.stringify(v, null, 2)}</code>;
  const s = String(v);
  return s === "" ? <span className="dv-null">(empty string)</span> : s;
}

// Destruction-guard text from this table's OUTGOING foreign keys (per recon: PRAGMA foreign_key_list).
// Informational only this build — no delete is wired.
function guardText(table: string, fks: DbForeignKey[]): string {
  if (fks.length === 0) {
    return `${table} has no outgoing foreign keys — deleting this row would affect only this row.`;
  }
  const refs = fks.map((f) => `${f.from} → ${f.table}.${f.to}`).join(", ");
  return `⚠ This row holds ${fks.length} foreign-key reference${fks.length === 1 ? "" : "s"} (${refs}). A real delete would need cascade/orphan handling — disabled in this build.`;
}
