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
// The one shell toast (Settings.tsx precedent) — long seed messages truncated in the header strip.
import { signalAppToast } from "../../App";
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
  const [demo, setDemo] = useState<{ present: boolean } | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);
  /** The licence prompt (ruling 4): the seed never activates silently — the user pastes their key,
      it goes through the supported setLicenseKey path in main, and a wrong key refuses plainly. */
  const [keyPrompt, setKeyPrompt] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  /** F1 dry run: purge asks first — counts per table, seeded vs attached, then a real confirm. */
  const [purgePreview, setPurgePreview] = useState<{ total: number; attachedTotal: number; unassignedTasks: number } | null>(null);
  /** F6: the typed-confirmation reset dialog. */
  const [resetOpen, setResetOpen] = useState(false);

  // Config-as-Data: the width lives in app_settings, never localStorage, and is read back at mount
  // so a set width survives a restart. Key is whitelisted in RENDERER_KEYS.
  useEffect(() => {
    void window.api.settings
      .get("dv_rail_width")
      .then((v) => {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) setRailWidth(Math.min(RAIL_MAX, Math.max(RAIL_MIN, n)));
      })
      .catch(() => {});
    void window.api.devseed.status().then(setDemo).catch(() => setDemo(null));
  }, []);

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
      // Commit on RELEASE, not per pixel — one settings write per drag, not two hundred.
      setRailWidth((w) => {
        void window.api.settings.set("dv_rail_width", String(w)).catch(() => {});
        return w;
      });
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

  // THE REFRESH CONTRACT (08-06). This module had no listener at all, which is why loading seed
  // data left the table list stale until the view was revisited. Any write anywhere — a timer
  // stop, an employee entry, the seed, the purge — re-reads the list, the open page's rows, and
  // the seed status, with no click required.
  useEffect(() => {
    const onChanged = (): void => {
      void window.api.db.tables().then(setTables).catch((e: unknown) => console.error("[data-viewer] tables re-read failed:", e));
      void window.api.devseed.status().then(setDemo).catch(() => {});
      fetchPage();
    };
    window.api.on<void>("timetracker:changed", onChanged);
    return () => window.api.off<void>("timetracker:changed", onChanged);
  }, [fetchPage]);


  const goToPage = () => {
    const n = parseInt(jump, 10);
    if (Number.isFinite(n)) setPageIndex(Math.min(Math.max(1, n), totalPages) - 1);
    setJump("");
  };
  useEffect(() => fetchPage(), [fetchPage]);

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
          {/* B6 (08-06): the plain toggle is GONE — developer mode unlocks through the Settings-page
              easter egg only, and re-locks on app update. This badge just SHOWS the current state. */}
          <span className={`dv-mode ${devMode ? "dev" : ""}`} title={devMode ? "Developer mode (unlocked)" : "Read-only"}>
            {devMode ? "● Developer" : "View · read-only"}
          </span>
          {/* DEMO DATA — DEVELOPER MODE ONLY (F3, 08-10; the leaf in Settings unlocks it).
              Generate writes ten projects, twenty people, their time, corrections, itemized rows
              and costs through the REAL services. The Load button no longer disables into
              invisibility when seed is present — it refuses out loud with the reason (Jason read
              the grayed button as "not offered"). */}
          {devMode && (
          <button
            className="dv-btn"
            disabled={demoBusy || keyPrompt}
            title="Load 10 projects and 20 employees (needs your licence key)"
            onClick={() => {
              if (demo?.present === true) {
                signalAppToast("Seed data is already loaded — purge it first. Loading twice would double every figure the seed exists to test.", "err");
                return;
              }
              setKeyDraft("");
              setKeyPrompt(true);
            }}
          >
            {demoBusy ? "…" : "Load seed data"}
          </button>
          )}
          {keyPrompt && (
            <span className="dv-keyrow">
              <input
                className="dv-keyinput"
                value={keyDraft}
                autoFocus
                spellCheck={false}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                aria-label="Licence key"
                onChange={(e) => setKeyDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.currentTarget.nextSibling as HTMLButtonElement | null)?.click();
                  if (e.key === "Escape") setKeyPrompt(false);
                }}
              />
              <button
                className="dv-btn"
                disabled={demoBusy || keyDraft.trim() === ""}
                onClick={() => {
                  setDemoBusy(true);
                  void window.api.devseed
                    .generate(keyDraft)
                    .then((r) => {
                      // A2: refusals are full sentences — they go to the toast, never the header.
                      if (r.ok) {
                        signalAppToast(`Loaded ${r.projects} projects, ${r.people} people, ${r.entries} entries.`, "ok");
                        setKeyPrompt(false);
                      } else {
                        signalAppToast(r.error ?? "The seed failed.", "err");
                      }
                      return window.api.devseed.status().then(setDemo);
                    })
                    .catch((e: unknown) => signalAppToast(e instanceof Error ? e.message : String(e), "err"))
                    .finally(() => setDemoBusy(false));
                }}
              >
                Activate &amp; load
              </button>
              <button className="dv-btn" onClick={() => setKeyPrompt(false)}>Cancel</button>
            </span>
          )}
          {devMode && purgePreview === null && (
          <button
            className="dv-btn danger"
            disabled={demoBusy}
            title="Counts what would be deleted first — nothing is removed until you confirm"
            onClick={() => {
              if (demo?.present !== true) {
                signalAppToast("There is no seed data recorded to remove.", "err");
                return;
              }
              // F1: the DRY RUN comes first — the delete never runs unannounced.
              void window.api.devseed.previewPurge().then((p) => {
                if (!p.ok) { signalAppToast(p.error ?? "Could not count the seed data.", "err"); return; }
                setPurgePreview({ total: p.total ?? 0, attachedTotal: p.attachedTotal ?? 0, unassignedTasks: p.unassignedTasks ?? 0 });
              }).catch((e: unknown) => signalAppToast(e instanceof Error ? e.message : String(e), "err"));
            }}
          >
            Purge demo
          </button>
          )}
          {devMode && purgePreview !== null && (
            <span className="dv-keyrow" role="alertdialog" aria-label="Confirm purge">
              <span className="dv-purgecount">
                {purgePreview.total} rows will be deleted
                {purgePreview.attachedTotal > 0 && <> — {purgePreview.attachedTotal} of them are YOURS, attached to seeded projects or people (payments, notes, time), and cannot outlive their parents</>}
                {purgePreview.unassignedTasks > 0 && <>; {purgePreview.unassignedTasks} of your tasks will be unassigned, not deleted</>}.
              </span>
              <button className="dv-btn danger" disabled={demoBusy} onClick={() => {
                setDemoBusy(true);
                setPurgePreview(null);
                void window.api.devseed
                  .purge()
                  .then((r) => {
                    signalAppToast(r.ok ? `Removed ${r.removed} rows and restored the licence.` : r.error ?? "The purge failed — nothing was changed (it runs in one transaction).", r.ok ? "ok" : "err");
                    return window.api.devseed.status().then(setDemo);
                  })
                  .catch((e: unknown) => signalAppToast(e instanceof Error ? e.message : String(e), "err"))
                  .finally(() => setDemoBusy(false));
              }}>Delete them</button>
              <button className="dv-btn" onClick={() => setPurgePreview(null)}>Cancel</button>
            </span>
          )}
          {/* F6: reset — developer mode only, typed confirmation, warning first. */}
          {devMode && (
            <button className="dv-btn danger" title="Wipe every TimeTracker and Employees row in this organisation"
              onClick={() => setResetOpen(true)}>
              Reset organisation…
            </button>
          )}
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
          onWrote={() => {
            fetchPage();
            void window.api.db.tables().then(setTables).catch(() => {});
          }}
        />
      )}
      {resetOpen && (
        <ResetOrgModal
          onClose={() => setResetOpen(false)}
          onDone={() => {
            setResetOpen(false);
            fetchPage();
            void window.api.db.tables().then(setTables).catch(() => {});
            void window.api.devseed.status().then(setDemo).catch(() => {});
          }}
        />
      )}
    </div>
  );
}

/**
 * F6 (08-10) — RESET THIS ORGANISATION'S DATA. Developer mode only (the button that opens this is
 * dev-gated AND the service re-checks the flag), typed confirmation, the warning FIRST. Names
 * exactly what is destroyed and what is kept, and tells Jason to back up before pulling.
 */
function ResetOrgModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (): void => {
    if (busy || typed !== "RESET") return;
    setBusy(true);
    setError(null);
    void window.api.devseed
      .resetOrg()
      .then((r) => {
        if (r.ok) {
          signalAppToast(`Organisation data reset — ${r.removed} rows removed. Scan history, settings and the Vault were kept.`, "ok");
          onDone();
        } else {
          setBusy(false);
          setError(r.error ?? "The reset failed — nothing was changed.");
        }
      })
      .catch((e: unknown) => { setBusy(false); setError(e instanceof Error ? e.message : String(e)); });
  };
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal dv-reset" role="alertdialog" aria-label="Reset this organisation's data" onClick={(e) => e.stopPropagation()}>
        {/* Destructive-action warning FIRST, before anything else — house rule. */}
        <div className="dv-resetwarn" role="alert">
          <b>⚠ This deletes real data and cannot be undone.</b>
          Take a backup of <code>%APPDATA%\Focal Registry</code> first — copy the whole folder while the app is closed.
        </div>
        <h3>Reset this organisation&apos;s data</h3>
        <p className="dv-resetbody">
          <b>Destroyed:</b> every TimeTracker project, client, group, timer session, time entry,
          cost, itemized row, value-ledger row, payment, adjustment and note — and every Employees
          person, entry, task, payment, adjustment and their activity log. The seed ledger goes with them.
        </p>
        <p className="dv-resetbody">
          <b>Kept:</b> Scan, Rename and Migrate history, MindMerge, the Vault, your licence key,
          the Business Profile, and every setting.
        </p>
        <label className="dv-resetconfirm">
          Type <b>RESET</b> to confirm
          <input className="dv-keyinput" value={typed} autoFocus spellCheck={false}
            onChange={(e) => setTyped(e.target.value.toUpperCase())} />
        </label>
        {error && <div className="dv-editerror" role="alert">{error}</div>}
        <div className="dv-record-actions">
          <button className="btn" disabled={busy} onClick={onClose}>Cancel</button>
          <button className="btn stop" disabled={busy || typed !== "RESET"} onClick={run}>
            {busy ? "…" : "Reset everything named above"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Compact grid cell: null shown explicitly; objects serialized; long values truncated (full value in the modal).
function cell(v: unknown) {
  if (v === null || v === undefined) return <span className="dv-null">null</span>;
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return s.length > 80 ? s.slice(0, 80) + "…" : s;
}
