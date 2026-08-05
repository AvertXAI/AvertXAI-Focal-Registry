// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Generic READ-ONLY SQLite browser — table list + paginated grid + record modal, with a
//              persisted View(read-only)/Developer mode toggle. All reads go through window.api.db
//              (introspection only). Developer edit/delete is UI-stubbed this build (guard text only).
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: CRM/src/modules/data-viewer/DataViewerModule.tsx
//------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DbColumn, DbForeignKey, DbRowsPage, DbTable } from "../../shared/types";
import RecordModal from "./components/RecordModal";

const PAGE_SIZE = 50;

// RENDER-SIDE column pinning (no migration, query stays SELECT *): for these tables the listed
// columns lead in this order; every other column follows in received schema order. Pinned names
// missing from the actual schema are skipped (drop rule) — also immune to the fresh-vs-device
// ordinal drift from ALTER-appended columns.
const PIN_ORDER: Record<string, string[]> = {
  scout_targets: ["id", "name", "created_at"],
};
// 36-char uuid-shaped columns get a tighter width cap (dv-cap-uuid).
const UUID_CAP = new Set(["uuid", "tenant_id", "client_id"]);

/** Rail sizing. 180 is the shipped width; 280 is the ceiling — wide enough for the longest table
    name in the tree (timetracker_adjustments) without the picker crowding the grid it feeds. */
const RAIL_DEFAULT = 180;
const RAIL_MIN = 180;
const RAIL_MAX = 280;

export default function DataViewerModule() {
  const [tables, setTables] = useState<DbTable[]>([]);
  const [railWidth, setRailWidth] = useState(RAIL_DEFAULT);

  /** Pointer-driven resize. The rail is fixed at the module's left edge, so the pointer's clientX
      relative to the shell IS the width — no offset bookkeeping. Clamped hard at both ends. */
  const startDrag = (e: React.MouseEvent): void => {
    e.preventDefault();
    const shellLeft = (e.currentTarget as HTMLElement).closest(".dv-shell")?.getBoundingClientRect().left ?? 0;
    const onMove = (ev: MouseEvent): void =>
      setRailWidth(Math.min(RAIL_MAX, Math.max(RAIL_MIN, ev.clientX - shellLeft)));
    const onUp = (): void => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  const [selected, setSelected] = useState<string | null>(null);
  const [columns, setColumns] = useState<DbColumn[]>([]);
  const [page, setPage] = useState<DbRowsPage | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [devMode, setDevMode] = useState(false);
  const [fks, setFks] = useState<DbForeignKey[]>([]);
  const [record, setRecord] = useState<Record<string, unknown> | null>(null);
  const [changed, setChanged] = useState<Set<number>>(new Set()); // row indices flashing after a live update
  const prevRowsRef = useRef<string[]>([]); // serialized rows from the last fetch, for the flash diff
  const [sort, setSort] = useState<{ col: string; dir: "ASC" | "DESC" } | null>(null); // click-a-header sort
  const [jump, setJump] = useState(""); // page-jump input

  // initial load: table list + persisted mode
  useEffect(() => {
    void window.api.db.tables().then(setTables);
    void window.api.dataviewer.getDevMode().then(setDevMode);
  }, []);

  // select a table → load its columns + outgoing FKs (guard text) and jump to page 0
  const loadTable = useCallback((name: string) => {
    setSelected(name);
    setPageIndex(0);
    setSort(null); // sort is per-table
    setJump("");
    void window.api.db.columns(name).then(setColumns);
    void window.api.db.fks(name).then(setFks);
  }, []);

  // Click a header to sort; click the same header to flip direction. Resets to page 1.
  const toggleSort = useCallback((col: string) => {
    setPageIndex(0);
    setSort((s) => (s?.col === col ? { col, dir: s.dir === "ASC" ? "DESC" : "ASC" } : { col, dir: "ASC" }));
  }, []);

  // fetch the open table's current page; flash rows whose value changed in-place (same-size page only)
  const fetchPage = useCallback(() => {
    if (!selected) {
      setPage(null);
      return;
    }
    const table = selected;
    void window.api.db.rows(table, PAGE_SIZE, pageIndex * PAGE_SIZE, sort?.col, sort?.dir).then((p) => {
      const next = p.rows.map((r) => JSON.stringify(r));
      const prev = prevRowsRef.current;
      const flash = new Set<number>();
      if (prev.length === next.length) {
        next.forEach((s, i) => {
          if (prev[i] !== s) flash.add(i);
        });
      }
      prevRowsRef.current = next;
      setPage(p);
      if (flash.size) {
        setChanged(flash);
        window.setTimeout(() => setChanged(new Set()), 1200);
      }
    });
  }, [selected, pageIndex, sort]);

  useEffect(() => {
    prevRowsRef.current = []; // reset the flash baseline whenever the table, page, or sort changes
  }, [selected, pageIndex, sort]);

  const goToPage = () => {
    const n = parseInt(jump, 10);
    if (Number.isFinite(n)) setPageIndex(Math.min(Math.max(1, n), totalPages) - 1);
    setJump("");
  };
  useEffect(() => fetchPage(), [fetchPage]);

  const toggleDev = () => {
    const next = !devMode;
    setDevMode(next);
    void window.api.dataviewer.setDevMode(next); // persist to app_settings
  };

  const totalPages = page ? Math.max(1, Math.ceil(page.total / PAGE_SIZE)) : 1;

  // Display order = pinned-that-exist + the rest as received. Header AND body map this same
  // array, so cells can never misalign. RecordModal keeps the raw schema order (full record).
  const displayColumns = useMemo(() => {
    const pins = PIN_ORDER[selected ?? ""] ?? [];
    if (pins.length === 0) return columns;
    const byName = new Map(columns.map((c) => [c.name, c]));
    const pinned = pins.map((p) => byName.get(p)).filter((c): c is DbColumn => c !== undefined);
    const rest = columns.filter((c) => !pins.includes(c.name));
    return [...pinned, ...rest];
  }, [columns, selected]);

  return (
    <div className="dv-shell">
      <aside className="dv-rail" style={{ width: railWidth, flexBasis: railWidth }}>
        <div className="dv-rail-head">
          Tables <span className="dv-count">{tables.length}</span>
        </div>
        {/* Drag handle — table names like timetracker_adjustments truncate at the default width.
            Range is deliberately narrow (180-280): the rail is a picker, not a panel, and letting it
            eat the grid would trade one unreadable thing for another. Session-only by design —
            persisting it would mean a new app_settings key and its RENDERER_KEYS entry. */}
        <div
          className="dv-railgrip"
          role="separator"
          aria-label="Resize the table list"
          aria-orientation="vertical"
          onMouseDown={startDrag}
        />
        <div className="dv-tables">
          {tables.map((t) => (
            <button
              key={t.name}
              className={`dv-tbtn ${selected === t.name ? "active" : ""}`}
              onClick={() => loadTable(t.name)}
            >
              <span className="dv-tname">{t.name}</span>
              <span className="dv-trows">{t.rows}</span>
            </button>
          ))}
          {tables.length === 0 && <div className="dv-empty">No tables.</div>}
        </div>
      </aside>

      <div className="dv-main">
        <div className="dv-head">
          <div className="dv-title">
            {selected ? (
              <>
                <b>{selected}</b> · {columns.length} cols · {page?.total ?? 0} rows
              </>
            ) : (
              "Data Viewer"
            )}
          </div>
          <button
            className={`dv-mode ${devMode ? "dev" : ""}`}
            onClick={toggleDev}
            title="Toggle View (read-only) / Developer mode"
          >
            {devMode ? "● Developer" : "View · read-only"}
          </button>
        </div>

        {selected && page ? (
          <>
            <div className="dv-grid-wrap">
              <table className="dv-grid">
                <thead>
                  <tr>
                    {displayColumns.map((c) => (
                      <th
                        key={c.name}
                        className={`dv-sortable${UUID_CAP.has(c.name) ? " dv-cap-uuid" : ""}${sort?.col === c.name ? " dv-sorted" : ""}`}
                        onClick={() => toggleSort(c.name)}
                        title={`Sort by ${c.name}`}
                      >
                        <span className="dv-th-name">
                          {c.name}
                          {c.pk && <span className="dv-keymark" title="primary key">🔑</span>}
                          {sort?.col === c.name && <span className="dv-sortmark">{sort.dir === "ASC" ? "▲" : "▼"}</span>}
                        </span>
                        <span className="dv-coltype">{c.type || "—"}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {page.rows.map((row, i) => (
                    <tr
                      key={i}
                      className={changed.has(i) ? "flash" : ""}
                      onClick={() => setRecord(row)}
                    >
                      {displayColumns.map((c) => (
                        <td
                          key={c.name}
                          className={UUID_CAP.has(c.name) ? "dv-cap-uuid" : undefined}
                          title={row[c.name] == null ? undefined : String(row[c.name])}
                        >
                          {cell(row[c.name])}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {page.rows.length === 0 && (
                    <tr>
                      <td colSpan={displayColumns.length || 1} className="dv-empty">
                        No rows.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="dv-pager">
              <button className="btn" disabled={pageIndex === 0} onClick={() => setPageIndex((p) => Math.max(0, p - 1))}>
                Prev
              </button>
              <span className="dv-pageinfo">
                Page {pageIndex + 1} / {totalPages}
              </span>
              <input
                className="dv-jump"
                type="number"
                min={1}
                max={totalPages}
                value={jump}
                placeholder="Go to #"
                onChange={(e) => setJump(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") goToPage(); }}
              />
              <button className="btn" disabled={jump === ""} onClick={goToPage}>Go</button>
              <button
                className="btn"
                disabled={pageIndex + 1 >= totalPages}
                onClick={() => setPageIndex((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </>
        ) : (
          <div className="dv-placeholder">Pick a table on the left to browse its rows. Everything here is read-only.</div>
        )}
      </div>

      {record && selected && (
        <RecordModal
          table={selected}
          row={record}
          columns={columns}
          fks={fks}
          devMode={devMode}
          onClose={() => setRecord(null)}
        />
      )}
    </div>
  );
}

// Compact grid cell: null shown explicitly; objects serialized; long values truncated (full value in the modal).
function cell(v: unknown) {
  if (v === null || v === undefined) return <span className="dv-null">null</span>;
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return s.length > 80 ? s.slice(0, 80) + "…" : s;
}
