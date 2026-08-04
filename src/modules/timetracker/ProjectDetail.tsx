/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// TimeTracker project detail (Phase 4.5 — full standalone parity). CLIENT/PROJECT INFO
// (Client · Contact · Email · Group · Rate + Edit), the CRM-seed line, colour picker, stat cards
// (TOTAL HOURS · INVESTED VALUE · COSTS · LAST WORKED), then the four sections: VALUE LEDGER
// (append-only — the UI offers NO edit and NO delete on ledger rows, by canon), COSTS, TIME
// SESSIONS, and NOTES (autosave on blur). Data arrives in ONE round trip via timetracker:projectDetail,
// re-fetched when the module bumps refreshKey. Money writes ride the validating channels only.
import { useEffect, useRef, useState } from "react";
import type {
  TimeTrackerActiveSessionInfo,
  TimeTrackerProjectDetail,
  TimeTrackerProjectListItem,
} from "../../shared/types";
import Tip from "../../components/Tip";
import NotesEditor from "./NotesEditor";
import { formatBlockHeader, packSessionNotes, parseSessionNotes } from "../../shared/ttNotes";

interface Props {
  project: TimeTrackerProjectListItem | null;
  refreshKey: number;
  onEdit: () => void;
  onColor: (color: string) => void;
  onNew: () => void;
  onArchive: (reason: string) => void;
  archiveBlocked: boolean;
  /** Ledger/cost writes move totals everywhere — the module reloads lists + grand total. */
  onDataChanged: () => void;
  /** The live session for THIS project, or null. Drives the Session notes block's presence. */
  session: TimeTrackerActiveSessionInfo | null;
  /** Blur-save for the Session notes editor — hands over an already-packed value. */
  onSessionNotes: (packed: string | null) => void;
  /** Set by the module when a stop filed notes; cleared through onFiledSeen after it is shown. */
  filed: { count: number; at: string } | null;
  onFiledSeen: () => void;
  /** False until the module's first timer.status() settles. Lets the Session notes block say
      "Loading…" instead of rendering nothing — absence and emptiness must never look alike. */
  statusReady: boolean;
}

/** Sticky view preference — app_settings via the sanctioned path, never localStorage. */
const SORT_KEY = "timetracker.notes_sort";
/** Module-level so the choice survives an unmount/remount inside one session (the rail precedent). */
let notesSortCache: "newest" | "oldest" | null = null;

const PALETTE = ["#2f6df6", "#3b82f6", "#38bdf8", "#16a34a", "#84cc16", "#eab308", "#f97316", "#ef4444", "#a855f7", "#8b9bb4"];

const fmtDuration = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const fmtMoney = (n: number): string =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
};
const fmtTime12 = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  let h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, "0")} ${ampm}`;
};

export default function ProjectDetail({
  project,
  refreshKey,
  onEdit,
  onColor,
  onNew,
  onArchive,
  archiveBlocked,
  onDataChanged,
  session,
  onSessionNotes,
  filed,
  onFiledSeen,
  statusReady,
}: Props) {
  const api = window.api;
  const [detail, setDetail] = useState<TimeTrackerProjectDetail | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [reason, setReason] = useState("");
  const [ledgerModal, setLedgerModal] = useState(false);
  const [ledgerAmount, setLedgerAmount] = useState("");
  const [ledgerNote, setLedgerNote] = useState("");
  const [costModal, setCostModal] = useState(false);
  const [costLabel, setCostLabel] = useState("");
  const [costCategory, setCostCategory] = useState("");
  const [costAmount, setCostAmount] = useState("");
  const [costRecurrence, setCostRecurrence] = useState<"once" | "monthly" | "yearly">("once");
  const [modalError, setModalError] = useState<string | null>(null);
  // Notes autosave on BLUR (never per keystroke). Uncontrolled-ish: track the draft, save if changed.
  const noteDraft = useRef<string | null>(null);
  // Notes block order. Cache first so a remount paints the right order on frame one, then the
  // persisted value confirms it.
  const [notesSort, setNotesSort] = useState<"newest" | "oldest">(() => notesSortCache ?? "newest");
  // Which face of the Notes section is showing. NULL means "follow the clock" and is DERIVED on every
  // render (see `activeTab`), never assigned by an effect. That distinction is the fix for the
  // reload bug: a transition-driven default can only be applied if the transition is observed, and on
  // a cold renderer the data arrives asynchronously AFTER mount — so the section could sit on the
  // History face while the running session's notes existed, which reads to a user as "my notes are
  // gone". A derived default cannot be missed because there is no moment to miss.
  const [notesTab, setNotesTab] = useState<"notes" | "history" | null>(null);
  // Distinguishes "still loading" from "genuinely empty" — an empty editor is what made the bug
  // look like data loss. Set on success AND on failure, so nothing says "Loading…" forever.
  const [detailError, setDetailError] = useState(false);

  useEffect(() => {
    setDetail(null);
    setDetailError(false);
    noteDraft.current = null;
    if (project === null) return;
    void api.timetracker.projects
      .detail(project.id)
      .then(setDetail)
      .catch((e: unknown) => {
        // SCOPED failure path (the wider swallowed-catch pattern is reported, not refactored here):
        // this read feeds the notes pad, so a silent failure would render an empty editor over
        // existing text — indistinguishable from the notes having been erased.
        console.error("[timetracker] project detail failed:", e);
        setDetailError(true);
      });
  }, [api, project?.id, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (notesSortCache !== null) return; // already resolved this session
    void api.settings
      .get(SORT_KEY)
      .then((v) => {
        const next = v === "oldest" ? "oldest" : "newest";
        notesSortCache = next;
        setNotesSort(next);
      })
      .catch(() => {});
  }, [api]);

  // Starting a timer opens the writing surface; stopping one shows what was just filed. DERIVED, so
  // it is right on whatever frame the session data happens to land on — including a cold reload.
  const isLive = session !== null;
  const activeTab = notesTab ?? (isLive ? "notes" : "history");
  // A manual choice is dropped the moment the clock changes state, handing the default back.
  useEffect(() => {
    setNotesTab(null);
  }, [isLive]);

  // The filed banner is transient: 3 seconds from the moment it appears, then gone. It is rendered
  // ABOVE the tab split, so switching Notes ⇄ History does not hide it — and because onFiledSeen is
  // now a stable callback, a switch no longer restarts this countdown either. One `filed` value gets
  // exactly one 3-second life, whatever else the panel is doing.
  useEffect(() => {
    if (!filed) return;
    const t = window.setTimeout(onFiledSeen, 3000);
    return () => window.clearTimeout(t);
  }, [filed, onFiledSeen]);

  if (!project) {
    return (
      <div className="tt-detail tt-detailempty">
        <div className="tt-emptytitle">No project selected</div>
        <p className="tt-emptysub">Pick a project in the rail, or create the first one.</p>
        <button className="tt-btn start" onClick={onNew}>＋ New project</button>
        <Tip id="TIP-TT-001" />
      </div>
    );
  }

  const rateLine =
    project.rate_type === "hourly"
      ? project.hourly_rate
        ? `Hourly · ${fmtMoney(project.hourly_rate)}/h`
        : "Hourly · no rate set"
      : project.contract_kind === "donated"
        ? `Contract · donated${project.target_hours != null ? ` · ${project.target_hours}h goal` : ""}`
        : `Contract · paid${project.contract_amount != null ? ` · ${fmtMoney(project.contract_amount)}` : ""}`;
  const invested = project.total_value + project.total_costs;
  // The live session's packed quick notes, split for display. firstAt drives the block's stamp.
  const sessionNotes = parseSessionNotes(session?.note ?? null);
  // HISTORY — every stopped session that carried notes, straight from time_entries. Sorting keys on
  // started_at, so it is a pure view: nothing is rewritten to change the order.
  const history = (detail?.entries ?? [])
    .filter((e) => (e.note ?? "").trim() !== "")
    .map((e) => ({ id: e.id, started_at: e.started_at, lines: (e.note ?? "").split("\n") }))
    .sort((a, b) =>
      notesSort === "newest"
        ? Date.parse(b.started_at) - Date.parse(a.started_at)
        : Date.parse(a.started_at) - Date.parse(b.started_at)
    );

  const addLedger = (): void => {
    const n = Number(ledgerAmount);
    if (!Number.isFinite(n) || n < 0) { setModalError("Amount must be a non-negative number."); return; }
    void api.timetracker.ledger.add(project.id, n, ledgerNote.trim() || null)
      .then(() => { setLedgerModal(false); setLedgerAmount(""); setLedgerNote(""); setModalError(null); onDataChanged(); })
      .catch((e: unknown) => setModalError(e instanceof Error ? e.message : String(e)));
  };
  const addCost = (): void => {
    const n = Number(costAmount);
    if (costLabel.trim() === "") { setModalError("A label is required."); return; }
    if (!Number.isFinite(n) || n < 0) { setModalError("Amount must be a non-negative number."); return; }
    void api.timetracker.costs.add(project.id, { label: costLabel, category: costCategory, amount: n, recurrence: costRecurrence, url: "" })
      .then(() => { setCostModal(false); setCostLabel(""); setCostCategory(""); setCostAmount(""); setCostRecurrence("once"); setModalError(null); onDataChanged(); })
      .catch((e: unknown) => setModalError(e instanceof Error ? e.message : String(e)));
  };
  const saveNote = (value: string): void => {
    if (detail && value === detail.note) return; // unchanged — no write
    void api.timetracker.notes.save(project.id, value).catch(() => {});
  };

  return (
    <div className="tt-detail">
      <div className="tt-detailhead">
        <span className="tt-dot big" style={{ background: project.color }} />
        {project.group_icon && <span className="tt-groupicon big" aria-hidden="true">{project.group_icon}</span>}
        <div className="tt-detailtitle">
          <div className="tt-detailname">{project.name}</div>
          <div className="tt-detailsub">Client / project info</div>
        </div>
        <button className="tt-btn ghost" onClick={onEdit}>Edit</button>
        <button className="tt-btn ghost" disabled={archiveBlocked}
          title={archiveBlocked ? "Stop the running timer on this project first" : "Archive this project (recoverable)"}
          onClick={() => { setReason(""); setArchiving(true); }}>Archive</button>
      </div>

      <div className="tt-inforow">
        <div className="tt-info"><span className="tt-infolabel">Client</span><b>{project.client_name}</b></div>
        <div className="tt-info"><span className="tt-infolabel">Contact</span><b>{project.contact_phone || "—"}</b></div>
        <div className="tt-info"><span className="tt-infolabel">Email</span><b>{project.email || "—"}</b></div>
        <div className="tt-info"><span className="tt-infolabel">Group</span><b>{project.group_name ?? "Ungrouped"}</b></div>
        <div className="tt-info"><span className="tt-infolabel">Rate</span><b>{rateLine}</b></div>
        <div className="tt-info"><span className="tt-infolabel">Status</span><b className="tt-cap">{project.status}</b></div>
      </div>
      <div className="tt-crmseed">↳ This block is the seed of the CRM — same fields runbooks.systems will read later.</div>

      <div className="tt-colorrow" role="radiogroup" aria-label="Project color">
        <span className="tt-infolabel">Color</span>
        {PALETTE.map((c) => (
          <button key={c} className={"tt-swatch" + (c.toLowerCase() === project.color.toLowerCase() ? " on" : "")}
            style={{ background: c }} role="radio" aria-checked={c.toLowerCase() === project.color.toLowerCase()}
            aria-label={`Color ${c}`} onClick={() => onColor(c)} />
        ))}
      </div>

      <div className="tt-cards">
        <div className="tt-card"><span className="tt-cardlabel">Total hours</span><span className="tt-cardvalue">{fmtDuration(project.total_seconds)}</span></div>
        <div className="tt-card"><span className="tt-cardlabel">Invested value</span><span className="tt-cardvalue">{project.rate_type === "contract" && project.contract_kind === "donated" ? "Donated" : fmtMoney(project.total_value)}</span></div>
        <div className="tt-card">
          <span className="tt-cardlabel">Costs</span><span className="tt-cardvalue">{fmtMoney(project.total_costs)}</span>
          <span className="tt-cardsub">invested + costs = {fmtMoney(invested)}</span>
        </div>
        <div className="tt-card"><span className="tt-cardlabel">Last worked</span><span className="tt-cardvalue">{fmtDate(project.last_worked)}</span></div>
      </div>

      {/* ---- 1. VALUE LEDGER — APPEND-ONLY (canon): no edit, no delete, ever ---- */}
      <div className="tt-sect">
        <div className="tt-secthead">
          <span className="tt-secttitle">Value ledger — append-only</span>
          <button className="tt-iconbtn" onClick={() => { setModalError(null); setLedgerModal(true); }}>＋ Set amount</button>
        </div>
        {detail && detail.ledger.length > 0 ? (
          <table className="tt-table">
            <thead><tr><th>Date</th><th>Action</th><th>Amount</th><th>Previous</th><th>Note</th></tr></thead>
            <tbody>
              {detail.ledger.map((l) => (
                <tr key={l.id}>
                  <td className="mono dim">{fmtDate(l.created_at)}</td>
                  <td className="tt-cap">{l.action}</td>
                  <td className="mono">{fmtMoney(l.amount)}</td>
                  <td className="mono dim">{l.previous_amount != null ? fmtMoney(l.previous_amount) : "—"}</td>
                  <td className="dim">{l.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="tt-emptyrow">{detail ? "No value entries yet." : "Loading…"}</div>
        )}
        <div className="tt-footnote">Updating an amount never erases the prior value — the full history stays so you can track how the investment grew.</div>
        <Tip id="TIP-TT-003" />
      </div>

      {/* ---- 2. COSTS — hard line items ---- */}
      <div className="tt-sect">
        <div className="tt-secthead">
          <span className="tt-secttitle">Costs — hard line items</span>
          <button className="tt-iconbtn" onClick={() => { setModalError(null); setCostModal(true); }}>＋ Add cost</button>
        </div>
        {detail && detail.costs.length > 0 ? (
          <table className="tt-table">
            <thead><tr><th>Label</th><th>Category</th><th>Amount</th><th>Recurrence</th></tr></thead>
            <tbody>
              {detail.costs.map((c) => (
                <tr key={c.id}>
                  <td>{c.label}</td>
                  <td className="dim">{c.category || "—"}</td>
                  <td className="mono">{fmtMoney(c.amount)}</td>
                  <td className="dim tt-cap">{c.recurrence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="tt-emptyrow">{detail ? "No cost line items yet." : "Loading…"}</div>
        )}
        <div className="tt-footnote">Face-value amounts — recurrence is informational in this phase (no annualization).</div>
      </div>

      {/* ---- 3. TIME SESSIONS ---- */}
      <div className="tt-sect">
        <div className="tt-secthead"><span className="tt-secttitle">Time sessions</span></div>
        {detail && detail.entries.length > 0 ? (
          <table className="tt-table">
            <thead><tr><th>Date</th><th>Start</th><th>Stop</th><th>Duration</th><th>Note</th></tr></thead>
            <tbody>
              {detail.entries.map((e) => (
                <tr key={e.id}>
                  <td className="mono dim">{fmtDate(e.started_at)}</td>
                  <td className="mono">{fmtTime12(e.started_at)}</td>
                  <td className="mono">{fmtTime12(e.ended_at)}</td>
                  <td className="mono">{fmtDuration(e.duration_seconds)}</td>
                  <td className="dim">{e.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="tt-emptyrow">{detail ? "No sessions yet — select this project in the timer bar and hit Start." : "Loading…"}</div>
        )}
      </div>

      {/* ---- 4. NOTES — two TABS (Jason 08-02-2026). "Notes" is the working surface: a staging pad
           plus, while a timer runs, the live Session notes block. "History" is the permanent record,
           rendered READ-ONLY from time_entries — which has one INSERT path and no UPDATE anywhere,
           so a filed block is immutable by construction, not by a UI that declines to edit it.
           The default follows the clock: writing surface while a timer runs, record when it isn't. ---- */}
      <div className="tt-sect">
        <div className="tt-secthead">
          <span className="tt-secttitle">Notes</span>
          <div className="tt-notestabs" role="tablist" aria-label="Notes view">
            <button
              className={"tt-notestab" + (activeTab === "notes" ? " on" : "")}
              role="tab"
              aria-selected={activeTab === "notes"}
              onClick={() => setNotesTab("notes")}
            >
              Notes
            </button>
            <button
              className={"tt-notestab" + (activeTab === "history" ? " on" : "")}
              role="tab"
              aria-selected={activeTab === "history"}
              onClick={() => setNotesTab("history")}
            >
              History{history.length > 0 ? ` (${history.length})` : ""}
            </button>
          </div>
          <div className="tt-notesctl">
            {activeTab === "history" ? (
              <button
                className="tt-sortctl"
                title="Flip the order of the saved blocks"
                aria-label={`Sort history: ${notesSort === "newest" ? "newest first" : "oldest first"}`}
                onClick={() => {
                  const next = notesSort === "newest" ? "oldest" : "newest";
                  notesSortCache = next;
                  setNotesSort(next);
                  void api.settings.set(SORT_KEY, next).catch(() => {}); // sticky, app_settings
                }}
              >
                <span aria-hidden="true">⇅</span>
                {notesSort === "newest" ? "Newest first" : "Oldest first"}
                <b aria-hidden="true">{notesSort === "newest" ? "▾" : "▴"}</b>
              </button>
            ) : (
              <span className="tt-notesautosave">Autosaves when you click away</span>
            )}
          </div>
        </div>

        {filed && (
          <div className="tt-filed" role="status">
            <span aria-hidden="true">✔</span>
            <span>
              <b>{filed.count === 1 ? "1 note saved" : `${filed.count} notes saved`}</b> to history under{" "}
              <span className="mono">{formatBlockHeader(filed.at)}</span> — the time the timer started.
            </span>
          </div>
        )}

        {activeTab === "notes" ? (
          <>
            {/* The pad's life IS the session's life (Jason 08-02-2026): it exists only while a timer
                runs. No editor is rendered when idle, so nothing can be staged that would never be
                filed — which, with the clear at start and the clear at stop, makes "the pad is empty
                whenever no timer is running" true by construction rather than by tidying up after. */}
            {!detail ? (
              detailError ? (
                // NEVER an empty editor on a failed read — that is what looked like erased notes.
                <div className="tt-emptyrow">Couldn&apos;t load these notes. Reopen the project to try again.</div>
              ) : (
                <div className="tt-emptyrow">Loading…</div>
              )
            ) : !statusReady ? (
              <div className="tt-emptyrow">Loading…</div>
            ) : session ? (
              <NotesEditor
                key={`${project.id}:${refreshKey}`}
                className="tt-input tt-textarea tt-notes"
                placeholder="Notes for this session — saved into History when you stop the timer..."
                defaultValue={detail.note}
                ariaLabel="Project notes"
                onCommit={saveNote}
              />
            ) : (
              <div className="tt-emptyrow">
                No timer running — start one to take notes for a session. They are saved into History
                when you stop it.
              </div>
            )}

            {/* SESSION NOTES — present only while this project's timer runs. Second editor, own store.
                While the status read is still in flight we say so rather than rendering nothing: on a
                cold reload the session arrives a round trip late, and silence looked like loss. */}
            {!statusReady && !session ? (
              <div className="tt-emptyrow">Loading session notes…</div>
            ) : session ? (
              <>
                <div className="tt-notesdivider">
                  <span className="tt-notesdividerlabel">Session notes</span>
                  <i aria-hidden="true" />
                  <span className="tt-pillbadge">Not saved yet</span>
                </div>
                {sessionNotes.firstAt && (
                  <div className="tt-sessionstamp mono">{formatBlockHeader(sessionNotes.firstAt)}</div>
                )}
                <NotesEditor
                  key={`sess:${session.id}:${sessionNotes.lines.length}`}
                  className="tt-input tt-textarea tt-sessionnotes"
                  placeholder="Quick notes land here — or type straight into this block."
                  defaultValue={sessionNotes.lines.join("\n")}
                  ariaLabel="Session notes"
                  onCommit={(value) =>
                    onSessionNotes(
                      packSessionNotes({
                        firstAt: sessionNotes.firstAt ?? new Date().toISOString(),
                        lines: value.split("\n"),
                      })
                    )
                  }
                />
              </>
            ) : null}
          </>
        ) : (
          // HISTORY — read-only by construction: plain elements, no editable control anywhere.
          <div className="tt-history">
            {history.length === 0 ? (
              <div className="tt-emptyrow">
                {detail
                  ? "Nothing saved yet — notes are filed here when you stop a timer."
                  : "Loading…"}
              </div>
            ) : (
              history.map((h) => (
                <div className="tt-histblock" key={h.id}>
                  <div className="tt-histhead mono">{formatBlockHeader(h.started_at)}</div>
                  <div className="tt-histbody">
                    {h.lines.map((line, i) => (
                      <div className="tt-histline" key={i}>{line}</div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        <Tip id="TIP-TT-007" />
        <Tip id="TIP-TT-008" />
      </div>

      {/* ---- modals ---- */}
      {archiving && (
        <div className="tt-modalback" onClick={() => setArchiving(false)}>
          <div className="tt-modal" role="dialog" aria-label="Archive project" onClick={(e) => e.stopPropagation()}>
            <div className="tt-modalhead">Archive “{project.name}”</div>
            <p className="tt-emptysub" style={{ marginBottom: 10 }}>
              Archiving hides the project from every active surface. Its sessions, ledger, and costs stay
              intact, and it can be restored from the Archive tab at any time.
            </p>
            <label className="tt-field">
              <span>Why? (required)</span>
              <textarea className="tt-input tt-textarea" value={reason} autoFocus onChange={(e) => setReason(e.target.value)} />
            </label>
            <div className="tt-modalacts">
              <button className="tt-btn ghost" onClick={() => setArchiving(false)}>Cancel</button>
              <button className="tt-btn start" disabled={reason.trim() === ""} onClick={() => { setArchiving(false); onArchive(reason); }}>
                Archive project
              </button>
            </div>
          </div>
        </div>
      )}
      {ledgerModal && (
        <div className="tt-modalback" onClick={() => setLedgerModal(false)}>
          <div className="tt-modal" role="dialog" aria-label="Set value amount" onClick={(e) => e.stopPropagation()}>
            <div className="tt-modalhead">Set value amount</div>
            <div className="tt-fieldrow">
              <label className="tt-field"><span>Amount ($)</span>
                <input className="tt-input" inputMode="decimal" autoFocus value={ledgerAmount} onChange={(e) => setLedgerAmount(e.target.value)} /></label>
            </div>
            <label className="tt-field"><span>Note (optional)</span>
              <input className="tt-input" value={ledgerNote} onChange={(e) => setLedgerNote(e.target.value)} /></label>
            {modalError && <div className="tt-error">{modalError}</div>}
            <div className="tt-modalacts">
              <button className="tt-btn ghost" onClick={() => setLedgerModal(false)}>Cancel</button>
              <button className="tt-btn start" onClick={addLedger}>Append entry</button>
            </div>
          </div>
        </div>
      )}
      {costModal && (
        <div className="tt-modalback" onClick={() => setCostModal(false)}>
          <div className="tt-modal" role="dialog" aria-label="Add cost" onClick={(e) => e.stopPropagation()}>
            <div className="tt-modalhead">Add cost</div>
            <div className="tt-fieldrow">
              <label className="tt-field"><span>Label</span>
                <input className="tt-input" autoFocus value={costLabel} onChange={(e) => setCostLabel(e.target.value)} /></label>
              <label className="tt-field"><span>Category</span>
                <input className="tt-input" placeholder="domains, server…" value={costCategory} onChange={(e) => setCostCategory(e.target.value)} /></label>
            </div>
            <div className="tt-fieldrow">
              <label className="tt-field"><span>Amount ($)</span>
                <input className="tt-input" inputMode="decimal" value={costAmount} onChange={(e) => setCostAmount(e.target.value)} /></label>
              <label className="tt-field"><span>Recurrence</span>
                <select className="tt-input" value={costRecurrence} onChange={(e) => setCostRecurrence(e.target.value as "once" | "monthly" | "yearly")}>
                  <option value="once">Once</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select></label>
            </div>
            {modalError && <div className="tt-error">{modalError}</div>}
            <div className="tt-modalacts">
              <button className="tt-btn ghost" onClick={() => setCostModal(false)}>Cancel</button>
              <button className="tt-btn start" onClick={addCost}>Add cost</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
