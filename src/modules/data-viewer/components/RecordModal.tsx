// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Record-detail modal — every column as key→value with a type badge, full (untruncated)
//              values, null shown explicitly. VIEW MODE IS UNCHANGED and stays read-only.
//              DEVELOPER MODE went live 08-06 (A3): fields edit in place, Save writes the row by
//              primary key, and a red Delete requires a confirm that names the table and key and
//              says plainly what this is — a raw write that bypasses every validator and money rule
//              and cannot be undone. Both go through the Data Viewer's own service path (whitelist
//              + bound parameters, the read path's pattern). There is no Data Viewer action log in
//              this build — verified before building, reported, not invented.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: CRM/src/modules/data-viewer/components/RecordModal.tsx
//------------------------------------------------------------
import { useMemo, useState } from "react";
import type { DbColumn, DbForeignKey } from "../../../shared/types";

interface Props {
  table: string;
  row: Record<string, unknown>;
  columns: DbColumn[];
  fks: DbForeignKey[];
  devMode: boolean;
  onClose: () => void;
  /** Fired after a successful write so the grid behind refreshes without a manual page turn. */
  onWrote?: () => void;
}

/** Editable draft: every value as a string, null tracked apart — "(empty string)" and null are two
    different answers (the D12 lesson, applied here from the start). */
type Draft = Record<string, { text: string; isNull: boolean }>;

export default function RecordModal({ table, row, columns, fks, devMode, onClose, onWrote }: Props) {
  const pk = useMemo(() => columns.find((c) => c.pk) ?? null, [columns]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = (): void => {
    const d: Draft = {};
    for (const c of columns) {
      if (c.pk) continue;
      const v = row[c.name];
      d[c.name] = v === null || v === undefined
        ? { text: "", isNull: true }
        : { text: typeof v === "object" ? JSON.stringify(v) : String(v), isNull: false };
    }
    setDraft(d);
    setError(null);
    setEditing(true);
  };

  const save = (): void => {
    if (!pk || busy) return;
    // Only what actually changed travels — an untouched field is not rewritten, and an EMPTIED one
    // is: empty string and null are both real values here, sent deliberately.
    const changes: Record<string, unknown> = {};
    for (const c of columns) {
      if (c.pk) continue;
      const d = draft[c.name];
      if (!d) continue;
      const original = row[c.name];
      const next = d.isNull ? null : d.text;
      const origComparable =
        original === null || original === undefined
          ? null
          : typeof original === "object"
            ? JSON.stringify(original)
            : String(original);
      if (next !== origComparable) changes[c.name] = next;
    }
    if (Object.keys(changes).length === 0) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setError(null);
    void window.api.dataviewer
      .updateRow(table, row[pk.name], changes)
      .then(() => {
        setEditing(false);
        onWrote?.();
        onClose();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const doDelete = (): void => {
    if (!pk || busy) return;
    setBusy(true);
    setError(null);
    void window.api.dataviewer
      .deleteRow(table, row[pk.name])
      .then(() => {
        onWrote?.();
        onClose();
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setConfirmDelete(false);
      })
      .finally(() => setBusy(false));
  };

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
              {editing && !c.pk ? (
                <div className="dv-field-edit">
                  <input
                    className="dv-editinput"
                    value={draft[c.name]?.isNull ? "" : draft[c.name]?.text ?? ""}
                    placeholder={draft[c.name]?.isNull ? "null" : ""}
                    disabled={draft[c.name]?.isNull}
                    onChange={(e) => setDraft((d) => ({ ...d, [c.name]: { text: e.target.value, isNull: false } }))}
                  />
                  {/* null is a different answer from "" — a toggle keeps both reachable. */}
                  {!c.notnull && (
                    <button
                      className={"dv-nullbtn" + (draft[c.name]?.isNull ? " on" : "")}
                      title={draft[c.name]?.isNull ? "Currently null — click to type a value" : "Set this field to null"}
                      onClick={() => setDraft((d) => ({ ...d, [c.name]: { text: "", isNull: !d[c.name]?.isNull } }))}
                    >
                      null
                    </button>
                  )}
                </div>
              ) : (
                <div className="dv-field-val">{fmt(row[c.name])}</div>
              )}
            </div>
          ))}
        </div>

        <div className="dv-record-foot">
          {devMode ? (
            confirmDelete ? (
              // Destructive-action discipline: the confirm names the table and the primary key and
              // states plainly what this bypasses.
              <div className="dv-confirm" role="alertdialog">
                <span className="dv-confirmtext">
                  Delete the row <b>{pk?.name} = {String(pk ? row[pk.name] : "?")}</b> from <b>{table}</b>?
                  This is a raw delete — it bypasses every validator and money rule, and it cannot be undone.
                </span>
                <button className="btn" disabled={busy} onClick={() => setConfirmDelete(false)}>Cancel</button>
                <button className="btn stop" disabled={busy} onClick={doDelete}>{busy ? "…" : "Delete row"}</button>
              </div>
            ) : (
              <>
                <div className="dv-guard">{guardText(table, fks)}</div>
                {error && <div className="dv-editerror" role="alert">{error}</div>}
                <div className="dv-record-actions">
                  {editing ? (
                    <>
                      <button className="btn" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
                      <button className="btn" disabled={busy || !pk} title="Raw write — no validator or money rule runs" onClick={save}>
                        {busy ? "…" : "Save"}
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="btn" disabled={!pk} title={pk ? "Edit this row in place (raw write)" : "No primary key — not editable"} onClick={startEdit}>
                        Edit
                      </button>
                      <button className="btn stop" disabled={!pk} title={pk ? "Delete this row" : "No primary key — not deletable"} onClick={() => setConfirmDelete(true)}>
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </>
            )
          ) : (
            <span className="dv-readonly">Read-only · switch to Developer mode to edit or delete this row.</span>
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
function guardText(table: string, fks: DbForeignKey[]): string {
  if (fks.length === 0) {
    return `${table} has no outgoing foreign keys — deleting this row would affect only this row.`;
  }
  const refs = fks.map((f) => `${f.from} → ${f.table}.${f.to}`).join(", ");
  return `⚠ This row holds ${fks.length} foreign-key reference${fks.length === 1 ? "" : "s"} (${refs}). Nothing cascades — a delete leaves the rows pointing here behind.`;
}
