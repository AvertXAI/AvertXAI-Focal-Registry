// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Runbook Shredder renderer UI — status strip + filter chips + list/detail split pane,
//              layout per docs/Runbook-Shedder/runbook-shredder-mockup.html. Reads EXCLUSIVELY via
//              api.shredder.* (never services/ nor the native driver — main-process only).
//              Types come from src/shared/types.ts; styling uses shell tokens only (zero hex).
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: src/modules/runbook-shredder/RunbookShredderModule.tsx
//------------------------------------------------------------
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { RunbookFilter, RunbookRow, ShredderProgress } from "../../shared/types";
import { defaultSettings, type ShredderSettings } from "./config.manifest";
import { formatStamp } from "../../shared/datetime";
import { highlightText, renderMarkdown } from "./markdown";
import "./runbook-shredder.css";

// Injected by root ("Expose, Don't Connect", DECISIONS-37): the module renders its own controls but
// never owns persistence — settings arrive as props, writes go back through onChange. BOTH props are
// optional so a standalone-dev mount works: settings falls back to the defaultSettings() mock, and
// the HONESTY GATE keeps write controls .nb (orange, inert) unless a real onChange is present —
// a control is live iff its action can be made real. Never localStorage, never app_settings direct.
interface Props {
  settings?: ShredderSettings;
  onChange?: (patch: Partial<ShredderSettings>) => void;
}

// window.api is bridged by the root preload; src/global.d.ts types it globally.
// this module's own tsconfig — which doesn't include src ambient decls — checks clean standalone.
const api = window.api;

// Filter chips → equality filters the service whitelists (RunbookFilter keys only).
const CHIPS: { label: string; filter: RunbookFilter }[] = [
  { label: "All", filter: {} },
  { label: "Critical", filter: { severity: "critical" } },
  { label: "Recovery", filter: { type: "recovery" } },
  { label: "Setup", filter: { type: "setup" } },
];

const fileName = (p: string): string => p.split(/[\\/]/).pop() ?? p;

// Modal result snippet: locate the typed term in the body (fallback: title / body head) and cut a
// tight window around it; highlightText() then marks it with the SAME highlighter styling.
function matchSnippet(r: RunbookRow, term: string): string {
  const body = (r.body_md ?? "").replace(/\s+/g, " ");
  const i = term ? body.toLowerCase().indexOf(term.toLowerCase()) : -1;
  if (i < 0) return r.title ?? body.slice(0, 90);
  const start = Math.max(0, i - 34);
  return (start > 0 ? "…" : "") + body.slice(start, i + term.length + 56) + "…";
}

const rowTags = (r: RunbookRow): string[] =>
  (r.tags_flat ?? "").split(/[\s,]+/).filter(Boolean).slice(0, 4);

// crit/high/med/low dot buckets; unknown severities fall to "low" (muted dot), never crash.
function sevClass(s: string | null): string {
  const v = (s ?? "").toLowerCase();
  if (v === "critical" || v === "crit") return "crit";
  if (v === "high") return "high";
  if (v === "medium" || v === "med") return "med";
  return "low";
}

// Split body_md on level-2/3 headings into sections. \x23 is the hash char — kept out of the
// source literally so the module-wide no-hex-color grep stays clean.
function splitSections(md: string): { heading: string | null; body: string }[] {
  const out: { heading: string | null; body: string }[] = [];
  let heading: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    const body = buf.join("\n").trim();
    if (body || heading) out.push({ heading, body });
    buf = [];
  };
  for (const line of md.split(/\r?\n/)) {
    const m = /^\s{0,3}\x23{2,3}\s+(.+?)\s*$/.exec(line);
    if (m) {
      flush();
      heading = m[1];
    } else {
      buf.push(line);
    }
  }
  flush();
  return out;
}

// Vault POINTERS mentioned in the body (locators like "vault: hetzner/host/ssh") — never values.
// ponytail: structured refs live in runbook_secret_refs, which no shredder.* read exposes yet;
// upgrade to a real getSecretRefs channel when root ships one.
const vaultPointers = (md: string): string[] =>
  Array.from(new Set(Array.from(md.matchAll(/\bvault:\s*([\w./-]+)/g), (m) => m[1])));

export default function RunbookShredderModule({ settings, onChange }: Props) {
  const [chipIdx, setChipIdx] = useState(0);
  const [client, setClient] = useState("");
  const [clients, setClients] = useState<string[]>([]);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<RunbookRow[] | null>(null); // null = loading
  const [quarantined, setQuarantined] = useState<RunbookRow[]>([]);
  const [okCount, setOkCount] = useState(0); // from the last unfiltered load (initial load qualifies)
  const [selected, setSelected] = useState<RunbookRow | null>(null);
  const [showQuar, setShowQuar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [quarCount, setQuarCount] = useState(0); // chip count — rescan return is authoritative
  const [ingest, setIngest] = useState<ShredderProgress | null>(null); // live folder-ingest ticker
  // Collapsed-strip search modal — module-scoped overlay; queries the SAME FTS prefix engine.
  const [searchOpen, setSearchOpen] = useState(false);
  const [modalQuery, setModalQuery] = useState("");
  const [modalRows, setModalRows] = useState<RunbookRow[] | null>(null); // null = nothing typed yet

  // Injected watch settings (persisted root-side; changes re-point the fs.watch engine).
  // Standalone dev (no props): display from the manifest mock, write controls stay .nb.
  const s = settings ?? defaultSettings();
  const watchPath = s["runbook-shredder.watch_path"];
  const watchEnabled = s["runbook-shredder.watch_enabled"];
  const railCollapsed = s["runbook-shredder.rail_collapsed"];
  const live = onChange != null; // honesty gate

  // Detail-pane font size: local state so the dropdown applies instantly; persisted through
  // onChange when present (root → app_settings, NEVER localStorage). This control is ALWAYS live —
  // unlike the watch controls it genuinely changes the display even without persistence (it just
  // won't survive a restart in standalone dev). Prop sync adopts root's async settings load.
  const propFontSize = s["runbook-shredder.font_size"];
  const [fontSize, setFontSize] = useState<number>(propFontSize || 13);
  useEffect(() => {
    if (propFontSize) setFontSize(propFontSize);
  }, [propFontSize]);

  // Live ingest ticker — a large watch folder streams done/total over shredder:progress so the strip
  // shows a percentage instead of appearing frozen. The final tick (done === total) clears it.
  useEffect(() => {
    const onIngest = (p: ShredderProgress): void => {
      const running = p.total > 0 && p.done < p.total;
      setIngest(running ? p : null);
      if (p.total > 0 && p.done >= p.total) setReloadKey((k) => k + 1); // ingest finished → pull the freshly-ingested rows
    };
    api.on<ShredderProgress>("shredder:progress", onIngest);
    return () => api.off<ShredderProgress>("shredder:progress", onIngest);
  }, []);
  const changeFontSize = (v: string) => {
    const n = Number(v) || 13;
    setFontSize(n);
    onChange?.({ "runbook-shredder.font_size": n });
  };

  // The fs.watch ingest is async/debounced, so counts read immediately after a change are stale.
  // Rescan is the sanctioned refresh: its return drives BOTH count chips directly, and the same
  // pass re-pulls the list (reloadKey → load effect), so the strip and list never disagree.
  const rescanAndRefresh = async () => {
    setScanning(true);
    try {
      const counts = await api.shredder.rescan();
      setOkCount(counts.ingested);
      setQuarCount(counts.quarantined);
      setReloadKey((k) => k + 1); // load effect re-pulls list + quarantine rows (and clears error)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  };

  // Native folder picker → persist through onChange (root writes app_settings + re-points the
  // engine), then an immediate rescan so counts/list reflect the new folder — no poll, no stale 0.
  const pickFolder = async () => {
    if (!onChange) return;
    const dir = await api.shredder.pickWatchFolder();
    if (!dir) return;
    onChange({ "runbook-shredder.watch_path": dir });
    await rescanAndRefresh();
  };

  const toggleWatch = async () => {
    if (!onChange) return;
    const next = !watchEnabled;
    onChange({ "runbook-shredder.watch_enabled": next });
    if (next) await rescanAndRefresh(); // ON = catch up on anything changed while unwatched
  };

  // Rail collapse (1.d.1) — pure UI state, persisted through the same onChange handshake.
  const toggleRail = () => {
    if (!onChange) return;
    onChange({ "runbook-shredder.rail_collapsed": !railCollapsed });
  };

  // Debounce the search box into the effective query.
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(queryInput.trim()), 250);
    return () => window.clearTimeout(t);
  }, [queryInput]);

  // Load list + quarantine on every filter/search change. Search takes precedence over chips;
  // both views keep parse_status='ok' rows only (broken files live in the quarantine view).
  useEffect(() => {
    let alive = true;
    setError(null);
    setRows(null);
    void (async () => {
      try {
        const listP = query
          ? api.shredder.search(query).then((rs) => rs.filter((r) => r.parse_status === "ok"))
          : api.shredder.list({
              ...CHIPS[chipIdx].filter,
              ...(client ? { client } : {}),
              parse_status: "ok",
            });
        const [list, quar] = await Promise.all([listP, api.shredder.listQuarantined()]);
        if (!alive) return;
        setRows(list);
        setQuarantined(quar);
        setQuarCount(quar.length);
        if (!query && chipIdx === 0 && !client) setOkCount(list.length);
        setClients((prev) => {
          const s = new Set(prev);
          for (const r of list) if (r.client) s.add(r.client);
          return s.size === prev.length ? prev : Array.from(s).sort();
        });
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [chipIdx, client, query, reloadKey]);

  // Modal search — debounced against the SAME shredder:search prefix engine as the rail box.
  useEffect(() => {
    if (!searchOpen) return;
    const q = modalQuery.trim();
    if (!q) {
      setModalRows(null);
      return;
    }
    let alive = true;
    const t = window.setTimeout(() => {
      void api.shredder.search(q).then(
        (rs) => {
          if (alive) setModalRows(rs.filter((r) => r.parse_status === "ok"));
        },
        (e) => {
          if (alive) setError(e instanceof Error ? e.message : String(e));
        }
      );
    }, 200);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [searchOpen, modalQuery]);

  // Row click: show what we have instantly, then refresh from the authoritative get() read.
  const openRow = (r: RunbookRow) => {
    setSelected(r);
    if (r.runbook_id && r.parse_status === "ok") {
      void api.shredder.get(r.runbook_id).then((fresh) => {
        if (fresh) setSelected((cur) => (cur?.uuid === r.uuid ? fresh : cur));
      });
    }
  };

  // Modal click-through: close → expand the rail (persisted) → seed the rail search box with the
  // typed term (its debounce re-lights the list + highlighter) → open the row; the jump-to-match
  // effect then scrolls the detail pane to the first <mark>.
  const pickResult = (r: RunbookRow) => {
    setSearchOpen(false);
    onChange?.({ "runbook-shredder.rail_collapsed": false });
    setShowQuar(false);
    setQueryInput(modalQuery.trim());
    openRow(r);
  };

  const sections = useMemo(
    () => (selected?.body_md ? splitSections(selected.body_md) : []),
    [selected]
  );
  const pointers = useMemo(
    () => (selected?.body_md ? vaultPointers(selected.body_md) : []),
    [selected]
  );

  // Jump-to-match: the renderer fires markRef on every <mark>; we keep the FIRST one per render
  // pass (reset here is a ref mutation, not state — safe during render) and scroll it into view
  // once the new detail is committed. Empty query → no marks, no scroll, normal top-of-pane.
  const firstMark = useRef<HTMLElement | null>(null);
  firstMark.current = null;
  const markRef = (el: HTMLElement | null) => {
    if (el && !firstMark.current) firstMark.current = el;
  };
  useEffect(() => {
    if (query && firstMark.current)
      firstMark.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selected, query]);
  const hl = query || undefined; // active highlight term ("" → none)

  const listRows = showQuar ? quarantined : rows;
  const isEmptyInstall = rows !== null && okCount === 0 && quarantined.length === 0;

  return (
    <div className="rbs-shell">
      {/* status strip — write controls live only behind the honesty gate (.nb when no onChange) */}
      <div className="rbs-strip">
        <button
          className={"rbs-path" + (live ? "" : " nb")}
          onClick={live ? pickFolder : undefined}
          title={live ? "Choose the folder of .md runbooks to watch" : undefined}
        >
          watching <b>{watchPath || "No folder set"}</b>
        </button>
        <span className="rbs-chip">
          <span className="rbs-dot ok" />
          {okCount} ingested
        </span>
        <button
          className={"rbs-chip rbs-chipbtn" + (showQuar ? " on" : "")}
          onClick={() => {
            setShowQuar((v) => !v);
            setSelected(null);
          }}
        >
          <span className="rbs-dot err" />
          {quarCount} quarantined
        </button>
        {ingest && (
          <span className="rbs-chip rbs-loading" title={`Reading ${ingest.done.toLocaleString()} of ${ingest.total.toLocaleString()} files`}>
            <span className="rbs-spin" />
            loading {Math.round((ingest.done / ingest.total) * 100)}%
          </span>
        )}
        <div className="rbs-sp">
          <button
            className={"rbs-tgl" + (watchEnabled ? " on" : "") + (live ? "" : " nb")}
            onClick={live ? toggleWatch : undefined}
            aria-pressed={watchEnabled}
          >
            watch <span className="rbs-sw" />
          </button>
          <button
            className={"rbs-btn" + (live ? "" : " nb")}
            onClick={live ? rescanAndRefresh : undefined}
            disabled={live && scanning}
          >
            {scanning ? "Scanning…" : "⟳ Re-scan"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rbs-error" role="alert">
          <span>Runbook Shredder read failed: {error}</span>
          <button className="rbs-btn" onClick={() => setReloadKey((k) => k + 1)}>
            Retry
          </button>
        </div>
      )}

      <div className="rbs-split">
        {/* LIST PANE */}
        <div className={"rbs-list" + (railCollapsed ? " collapsed" : "")}>
          <div className="rbs-lhead">
            {/* « on its own row above the search — mirrors the DECISIONS-37 rail pattern */}
            <button
              className={"rbs-railtgl" + (live ? "" : " nb")}
              onClick={live ? toggleRail : undefined}
              aria-expanded={!railCollapsed}
              aria-label={railCollapsed ? "Expand the runbook list" : "Collapse the runbook list"}
              title={railCollapsed ? "Expand the runbook list" : "Collapse the runbook list"}
            >
              {railCollapsed ? "»" : "«"}
            </button>
            {/* collapsed strip only: divider + magnifier → module-scoped search modal */}
            {railCollapsed && (
              <>
                <hr className="rbs-raildiv" />
                <button
                  className="rbs-railtgl"
                  onClick={() => {
                    setModalQuery("");
                    setModalRows(null);
                    setSearchOpen(true);
                  }}
                  aria-label="Search runbooks"
                  title="Search runbooks"
                >
                  <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="7" cy="7" r="4.3" />
                    <path d="M10.3 10.3 13.6 13.6" />
                  </svg>
                </button>
              </>
            )}
            {!railCollapsed && (
            <>
            <input
              className="rbs-search"
              type="search"
              placeholder="Search runbooks&hellip;"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              aria-label="Search runbooks"
            />
            <div className="rbs-lfilter">
              {CHIPS.map((c, i) => (
                <button
                  key={c.label}
                  className={"rbs-f" + (i === chipIdx && !showQuar ? " on" : "")}
                  onClick={() => {
                    setShowQuar(false);
                    setChipIdx(i);
                  }}
                >
                  {c.label}
                </button>
              ))}
              <select
                className="rbs-f rbs-clientsel"
                value={client}
                onChange={(e) => {
                  setShowQuar(false);
                  setClient(e.target.value);
                }}
                aria-label="Filter by client"
              >
                <option value="">By client</option>
                {clients.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            {showQuar && <div className="rbs-quarlab">Quarantined ({quarantined.length})</div>}
            </>
            )}
          </div>

          {!railCollapsed && (
          <div className="rbs-rows">
            {listRows === null &&
              !error &&
              [0, 1, 2, 3, 4].map((i) => (
                <div className="rbs-skel" key={i} aria-hidden="true">
                  <div className="rbs-skel-bar" />
                  <div className="rbs-skel-bar" />
                </div>
              ))}

            {listRows !== null && listRows.length === 0 && (
              <div className="rbs-empty">
                {isEmptyInstall
                  ? "No runbooks yet — point the watch folder at your runbooks."
                  : showQuar
                    ? "Nothing quarantined. All files parsed clean."
                    : "No runbooks match this filter."}
              </div>
            )}

            {listRows?.map((r) =>
              showQuar ? (
                <button
                  key={r.uuid}
                  className={"rbs-row" + (selected?.uuid === r.uuid ? " sel" : "")}
                  onClick={() => setSelected(r)}
                >
                  <div className="rbs-r1">
                    <span className="rbs-sev crit" />
                    <span className="rbs-title">{fileName(r.file_path)}</span>
                    <span className="rbs-tybadge">error</span>
                  </div>
                  <div className="rbs-r2 rbs-parseerr">{r.parse_error ?? "Unknown parse error"}</div>
                </button>
              ) : (
                <button
                  key={r.uuid}
                  className={"rbs-row" + (selected?.uuid === r.uuid ? " sel" : "")}
                  onClick={() => openRow(r)}
                >
                  <div className="rbs-r1">
                    <span className={"rbs-sev " + sevClass(r.severity)} />
                    <span className="rbs-title">
                      {highlightText(r.title ?? r.runbook_id ?? fileName(r.file_path), hl)}
                    </span>
                    {r.type && <span className="rbs-tybadge">{r.type}</span>}
                  </div>
                  <div className="rbs-r2">
                    {r.client && <span className="rbs-client">{r.client}</span>}
                    {rowTags(r).map((t) => (
                      <span key={t} className="rbs-tag">
                        {t}
                      </span>
                    ))}
                    {r.updated && <span>&middot; verified {r.updated}</span>}
                  </div>
                </button>
              )
            )}
          </div>
          )}
        </div>

        {/* DETAIL PANE — --rbs-fontsize drives .rbs-md base size; headings scale in em */}
        <div className="rbs-detail" style={{ "--rbs-fontsize": `${fontSize}px` } as CSSProperties}>
          <div className="rbs-dbar">
            <select
              className="rbs-f rbs-fontsel"
              value={fontSize}
              onChange={(e) => changeFontSize(e.target.value)}
              aria-label="Detail font size"
              title="Detail font size"
            >
              {[12, 13, 14, 15, 16, 18].map((n) => (
                <option key={n} value={n}>
                  {n}px
                </option>
              ))}
            </select>
          </div>
          {!selected && (
            <div className="rbs-placeholder">
              {showQuar ? "Select a quarantined file to see its parse error." : "Select a runbook."}
            </div>
          )}

          {selected && selected.parse_status === "error" && (
            <>
              <div className="rbs-dhead">
                <span className="rbs-sev crit rbs-dsev" />
                <h1>{fileName(selected.file_path)}</h1>
              </div>
              <div className="rbs-dmeta">
                <span className="rbs-mchip">
                  file <b>{selected.file_path}</b>
                </span>
              </div>
              <div className="rbs-sec">
                <h2>Parse error</h2>
                <div className="rbs-warn">{selected.parse_error ?? "Unknown parse error"}</div>
              </div>
            </>
          )}

          {selected && selected.parse_status === "ok" && (
            <>
              <div className="rbs-dhead">
                <span className={"rbs-sev rbs-dsev " + sevClass(selected.severity)} />
                <h1>{selected.title ?? selected.runbook_id ?? fileName(selected.file_path)}</h1>
              </div>
              <div className="rbs-dmeta">
                {selected.severity && (
                  <span className="rbs-mchip sev">
                    <b>{selected.severity.toUpperCase()}</b>
                  </span>
                )}
                {selected.type && (
                  <span className="rbs-mchip">
                    type <b>{selected.type}</b>
                  </span>
                )}
                {selected.owner && (
                  <span className="rbs-mchip">
                    owner <b>{selected.owner}</b>
                  </span>
                )}
                {selected.client && (
                  <span className="rbs-mchip">
                    client <b>{selected.client}</b>
                  </span>
                )}
                {(selected.updated ?? selected.updated_at) && (
                  <span className="rbs-mchip">
                    verified <b>{formatStamp(selected.updated ?? selected.updated_at, "eventTime")}</b>
                  </span>
                )}
                {selected.runbook_id && (
                  <span className="rbs-mchip">
                    id <b>{selected.runbook_id}</b>
                  </span>
                )}
              </div>

              {selected.description && <p className="rbs-desc">{selected.description}</p>}

              {selected.trigger && (
                <div className="rbs-sec">
                  <h2>Trigger</h2>
                  <div className="rbs-evt">{selected.trigger}</div>
                </div>
              )}

              {/* Preconditions / Steps / "In the event of…" / Refs arrive as body_md headings —
                  rendered generically so any runbook section shows without a per-name whitelist.
                  Bodies render through the hand-rolled markdown subset (React elements, no
                  innerHTML) with the active search term wrapped in <mark> at text-node level. */}
              {sections.map((s, i) => (
                <div className="rbs-sec" key={s.heading ?? i}>
                  <h2>{s.heading ?? "Notes"}</h2>
                  <div className="rbs-md">{renderMarkdown(s.body, hl, markRef)}</div>
                </div>
              ))}

              {pointers.length > 0 && (
                <div className="rbs-sec">
                  <h2>Secret reference</h2>
                  {pointers.map((p) => (
                    <div key={p} className="rbs-vault">
                      <span className="rbs-k">vault:</span> <code>{p}</code>
                      <button className="rbs-go nb">reveal &rarr;</button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* module-scoped search modal — absolute inside .rbs-shell (position:relative), so the
          backdrop dims the MODULE area only, never the shell chrome. Esc / backdrop-click close. */}
      {searchOpen && (
        <div
          className="rbs-overlay"
          onClick={() => setSearchOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setSearchOpen(false);
          }}
        >
          <div className="rbs-modal" role="dialog" aria-label="Search runbooks" onClick={(e) => e.stopPropagation()}>
            <input
              className="rbs-search"
              type="search"
              placeholder="Search runbooks&hellip;"
              autoFocus
              value={modalQuery}
              onChange={(e) => setModalQuery(e.target.value)}
              aria-label="Search runbooks"
            />
            <div className="rbs-mcount">
              {modalRows === null
                ? "Type to search all runbooks"
                : `${modalRows.length} match${modalRows.length === 1 ? "" : "es"}`}
            </div>
            <div className="rbs-mresults">
              {modalRows !== null && modalRows.length === 0 && (
                <div className="rbs-empty">No runbooks match.</div>
              )}
              {modalRows?.map((r) => (
                <button key={r.uuid} className="rbs-mrow" onClick={() => pickResult(r)}>
                  <span className="rbs-mfile">{fileName(r.file_path)}</span>
                  <span className="rbs-msnip">
                    {highlightText(matchSnippet(r, modalQuery.trim()), modalQuery.trim() || undefined)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Initial-ingest overlay — the engine is lazy (starts on module open), so the FIRST open of a
          large watch folder parses everything now. Opaque backdrop + spinner while there is nothing to
          show yet; background re-scans (with rows already loaded) use the lighter strip pill instead. */}
      {ingest && (!rows || rows.length === 0) && (
        <div className="rbs-loadmodal">
          <div className="rbs-loadmodal-card">
            <span className="rbs-loadspin" />
            <div className="rbs-loadmodal-title">Loading your notes…</div>
            <div className="rbs-loadmodal-sub">Reading {ingest.done.toLocaleString()} of {ingest.total.toLocaleString()} files · {Math.round((ingest.done / ingest.total) * 100)}%</div>
          </div>
        </div>
      )}
    </div>
  );
}
