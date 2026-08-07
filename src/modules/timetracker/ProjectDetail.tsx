/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// TimeTracker project detail (Phase 4.5 — full standalone parity). CLIENT/PROJECT INFO
// (Client · Contact · Email · Group · Rate + Edit), the CRM-seed line, colour picker, stat cards
// (TOTAL HOURS · INVESTED VALUE · COSTS · LAST WORKED), then the four sections: VALUE LEDGER
// (append-only — the UI offers NO edit and NO delete on ledger rows, by canon), COSTS, TIME
// SESSIONS, and NOTES (autosave on blur). Data arrives in ONE round trip via timetracker:projectDetail,
// re-fetched when the module bumps refreshKey. Money writes ride the validating channels only.
import { useEffect, useRef, useState } from "react";
import type {
  TimeTrackerPaymentMethod,
  TimeTrackerProjectItem,
  TimeTrackerActiveSessionInfo,
  TimeTrackerProjectDetail,
  TimeTrackerProjectListItem,
  TimeTrackerProjectPayment,
} from "../../shared/types";
import Tip from "../../components/Tip";
import NotesEditor from "./NotesEditor";
import { signalAppAsk } from "../../App";
import { formatBlockHeader, packSessionNotes, parseSessionNotes } from "../../shared/ttNotes";

/** MM/DD/YYYY (the house month-first display) ⇄ the service's YYYY-MM-DD. Exported for the
    ProjectModal's contract-date field (two doors, one format). */
export const mdyToYmd = (s: string): string | null => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
};
export const ymdToMdy = (s: string | null): string => {
  const m = s ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) : null;
  return m ? `${m[2]}/${m[3]}/${m[1]}` : "";
};
export const todayYmd = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const PAYMENT_METHOD_LABELS: Array<[TimeTrackerPaymentMethod, string]> = [
  ["check", "Check"], ["cash", "Cash"], ["wire", "Wire transfer"], ["bank_transfer", "Bank transfer / ACH"],
  ["zelle", "Zelle"], ["venmo", "Venmo"], ["card", "Card"], ["other", "Other"],
];
const TERMS_PRESETS = ["Net 30", "Due on receipt", "50% deposit, balance on delivery"];

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
  // Complete Job (08-06) — the confirm shows the FINAL figures, so opening it fetches spend + roster.
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [completeFigures, setCompleteFigures] = useState<{ spent: number; people: number } | null>(null);
  // Contract details + payments (08-06 profit build) — the two new doors on the project.
  const [contractModal, setContractModal] = useState(false);
  const [payModal, setPayModal] = useState(false);
  const [ledgerModal, setLedgerModal] = useState(false);
  const [ledgerAmount, setLedgerAmount] = useState("");
  const [ledgerNote, setLedgerNote] = useState("");
  const [costModal, setCostModal] = useState(false);
  /** The project modal's Itemize rows — a different table from `costs`, shown in the same list. */
  const [items, setItems] = useState<TimeTrackerProjectItem[]>([]);
  /** A failed note save, shown at the pad — never silent (08-06). */
  const [noteError, setNoteError] = useState<string | null>(null);
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
    void api.timetracker.financials
      .items(project.id)
      .then(setItems)
      .catch((e: unknown) => {
        // Named, not swallowed — an empty costs list over a failed read is the exact confusion the
        // three-state discipline exists to prevent. detailError already covers the visible state.
        console.error("[timetracker] project items failed:", e);
        setItems([]);
      });
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

  // HISTORY — every stopped session that carried notes, straight from time_entries. Sorting keys on
  // started_at, so it is a pure view: nothing is rewritten to change the order. Derived HERE, above
  // the tab default, because the default now depends on it (B7).
  const history = (detail?.entries ?? [])
    .filter((e) => (e.note ?? "").trim() !== "")
    .map((e) => ({ id: e.id, started_at: e.started_at, lines: (e.note ?? "").split("\n") }))
    .sort((a, b) =>
      notesSort === "newest"
        ? Date.parse(b.started_at) - Date.parse(a.started_at)
        : Date.parse(a.started_at) - Date.parse(b.started_at)
    );

  // B7 (08-06): the default follows the RECORD, not the clock — History whenever any saved notes
  // exist (so the user always sees that notes are there), Notes when there are none. Still DERIVED
  // on every render, never assigned by an effect — the cold-reload lesson stands.
  const isLive = session !== null;
  const activeTab = notesTab ?? (history.length > 0 ? "history" : "notes");
  // A manual choice is dropped when the clock changes state, handing the default back.
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
  // RULED vocabulary (08-06): the `invested = value + costs` composite is DELETED — it added
  // revenue to costs on a client-visible card, the exact collision the recon named.
  // The live session's packed quick notes, split for display. firstAt drives the block's stamp.
  const sessionNotes = parseSessionNotes(session?.note ?? null);

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
    // NOT SILENT ANY MORE (08-06). This catch used to be empty — a failed save let the user type,
    // see their text, and lose it with no sign anything went wrong. It was the leading candidate
    // for the "can't add notes in Tracker" report: the failure now has a face and a console line,
    // so if the save IS throwing, the reason surfaces instead of vanishing.
    void api.timetracker.notes
      .save(project.id, value)
      .then(() => setNoteError(null))
      .catch((e: unknown) => {
        console.error("[timetracker] note save failed:", e);
        setNoteError("This note could not be saved — your text is still in the box. Details are in the developer console.");
      });
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
        <button className="tt-btn ghost" onClick={() => setContractModal(true)} disabled={project.completed_at != null}
          title={project.completed_at ? "Completed — view-only" : "Contract date, signed-by, terms — the facts the profit timeline reads"}>Contract</button>
        <button className="tt-btn ghost" onClick={() => setPayModal(true)}
          title="Record and review money received on this project">Payments</button>
        <button className="tt-btn ghost" onClick={onEdit} disabled={project.completed_at != null}
          title={project.completed_at ? "Completed — reactivate from the Completed tab to edit" : undefined}>Edit</button>
        <button className="tt-btn ghost" disabled={archiveBlocked}
          title={archiveBlocked ? "Stop the running timer on this project first" : "Archive this project (recoverable)"}
          onClick={() => { setReason(""); setArchiving(true); }}>Archive</button>
        {project.completed_at ? (
          <span className="tt-completedchip" title="View-only. Reactivate from the Completed tab.">
            ✓ Completed {fmtDate(project.completed_at)}
          </span>
        ) : (
          <button className="tt-btn done" disabled={archiveBlocked}
            title={archiveBlocked ? "Stop the running timer on this project first" : "Complete this job — locks it view-only"}
            onClick={() => {
              setCompleteError(null);
              setCompleteFigures(null);
              setCompleting(true);
              // The confirm's four figures: hours + contracted ride the project row; spent + people
              // are fetched fresh so the modal never shows a stale number.
              void Promise.all([api.timetracker.financials.spend(project.id), api.timetracker.financials.members(project.id)])
                .then(([spend, members]) => setCompleteFigures({ spent: spend.spent, people: members.length }))
                .catch(() => setCompleteFigures({ spent: project.total_costs, people: 0 }));
            }}>Complete job</button>
        )}
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
        {/* RULED vocabulary (08-06): "Invested value" → CONTRACTED (it is revenue, not money put
            in), "Costs" → SPENT (which since 08-06 is the FULL composition — crew + purchases +
            hard lines), and the invested+costs composite line is gone. Profit deliberately does
            NOT print here — Analytics only; this card row is client-facing. */}
        <div className="tt-card">
          <span className="tt-cardlabel">Contracted</span>
          <span className="tt-cardvalue">{project.rate_type === "contract" && project.contract_kind === "donated" ? "Donated" : fmtMoney(project.total_value)}</span>
          <span className="tt-cardsub">{fmtDuration(project.total_seconds)} worked</span>
        </div>
        <div className="tt-card">
          <span className="tt-cardlabel">Spent</span><span className="tt-cardvalue">{fmtMoney(project.total_costs)}</span>
          <span className="tt-cardsub">crew + purchases + costs</span>
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
        {/* TWO SOURCES, one list. `costs` are the ad-hoc line items added here; `items` are the
            Itemize rows entered on the project modal. They live in different tables but they are
            the same thing to a user looking at what a project cost, so both are shown — with the
            origin named so an itemized row can be traced back to where it is edited. */}
        {detail && (detail.costs.length > 0 || items.length > 0) ? (
          <table className="tt-table">
            <thead><tr><th>Label</th><th>Category</th><th>Amount</th><th>Recurrence</th></tr></thead>
            <tbody>
              {detail.costs.map((c) => (
                <tr key={`cost-${c.id}`}>
                  <td>{c.label}</td>
                  <td className="dim">{c.category || "—"}</td>
                  <td className="mono">{fmtMoney(c.amount)}</td>
                  <td className="dim tt-cap">{c.recurrence}</td>
                </tr>
              ))}
              {items.map((it) => (
                <tr key={`item-${it.id}`}>
                  <td>{it.qty > 1 ? `${it.qty} × ` : ""}{it.description}</td>
                  <td className="dim">Itemized</td>
                  <td className="mono">{fmtMoney(it.amount)}</td>
                  <td className="dim">edit on the project</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="tt-emptyrow">{detail ? "No cost line items yet." : "Loading…"}</div>
        )}
        <div className="tt-footnote">Face-value amounts — recurrence is informational in this phase (no annualization).</div>
      </div>

      {/* ---- 3. NOTES — two TABS (Jason 08-02-2026). "Notes" is the working surface: a staging pad
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
          {noteError && (
            <div className="tt-reloaderror" role="alert" style={{ margin: "8px 0 0" }}>{noteError}</div>
          )}
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
            ) : null}
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
            {/* SESSION NOTES FIRST (B6, 08-06) — present only while this project's timer runs; the
                "autosaves" hint lives HERE now. While the status read is in flight we say so rather
                than rendering nothing: on a cold reload the session arrives a round trip late, and
                silence looked like loss. */}
            {!statusReady ? (
              <div className="tt-emptyrow">Loading session notes…</div>
            ) : session ? (
              <>
                <div className="tt-notesdivider">
                  <span className="tt-notesdividerlabel">Session notes</span>
                  <i aria-hidden="true" />
                  <span className="tt-notesautosave">Autosaves when you click away</span>
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

            {/* NOTES — the project's own pad, and ALWAYS editable once loaded (B6). It was gated on
                a running session, which is exactly why the box could not be clicked into with no
                timer going — the gate is gone; only a failed or in-flight read blocks it. */}
            <div className="tt-notesdivider">
              <span className="tt-notesdividerlabel">Notes</span>
              <i aria-hidden="true" />
            </div>
            {!detail ? (
              detailError ? (
                // NEVER an empty editor on a failed read — that is what looked like erased notes.
                <div className="tt-emptyrow">Couldn&apos;t load these notes. Reopen the project to try again.</div>
              ) : (
                <div className="tt-emptyrow">Loading…</div>
              )
            ) : (
              <NotesEditor
                key={`${project.id}:${refreshKey}`}
                className="tt-input tt-textarea tt-notes"
                placeholder="Notes for this project..."
                defaultValue={detail.note}
                ariaLabel="Project notes"
                onCommit={saveNote}
              />
            )}
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
      {contractModal && (
        <ContractDetailsModal project={project} onClose={() => setContractModal(false)}
          onSaved={() => { setContractModal(false); onDataChanged(); }} />
      )}
      {payModal && (
        <RecordPaymentModal project={project} onClose={() => setPayModal(false)} onChanged={onDataChanged} />
      )}
      {completing && (
        <div className="tt-modalback" onClick={() => setCompleting(false)}>
          <div className="tt-modal" role="dialog" aria-label="Complete this job" onClick={(e) => e.stopPropagation()}>
            <div className="tt-modalhead">Complete this job?</div>
            <p className="tt-emptysub" style={{ marginBottom: 10 }}>
              <b>{project.name}</b> — {project.client_name}
            </p>
            {/* The mockup's amber warning block: what completing MEANS, stated plainly. */}
            <div className="tt-completewarn">
              <b>This locks the project</b>
              <p>
                Once completed, the project becomes view-only. Nothing can be edited — no time, no costs,
                no itemized rows, no employees, no notes. It moves to the <b>Completed</b> tab, where you
                can open it, export it, or reactivate it if you need to work on it again.
              </p>
            </div>
            <div className="tt-completefigs">
              <div className="tt-card"><span className="tt-cardlabel">Hours</span><span className="tt-cardvalue">{fmtDuration(project.total_seconds)}</span></div>
              <div className="tt-card"><span className="tt-cardlabel">Contracted</span><span className="tt-cardvalue">{project.contract_amount != null ? fmtMoney(project.contract_amount) : "—"}</span></div>
              <div className="tt-card"><span className="tt-cardlabel">Spent</span><span className="tt-cardvalue">{completeFigures ? fmtMoney(completeFigures.spent) : "…"}</span></div>
              <div className="tt-card"><span className="tt-cardlabel">People</span><span className="tt-cardvalue">{completeFigures ? completeFigures.people : "…"}</span></div>
            </div>
            {completeError && <div className="tt-error">{completeError}</div>}
            <div className="tt-modalacts">
              <button className="tt-btn ghost" onClick={() => setCompleting(false)}>Cancel</button>
              <button className="tt-btn done" onClick={() => {
                void api.timetracker.projects.complete(project.id)
                  .then(() => {
                    setCompleting(false);
                    onDataChanged();
                    // THE PAYMENT QUESTION (ruled 08-06, mockup scene 3) — the shell's ONE toast,
                    // extended, never a second mechanism. "Not yet" is a real answer: the project
                    // derives Awaiting payment until rows say otherwise; nothing needs storing.
                    signalAppAsk(
                      `✓ ${project.name} is complete`,
                      "Did you actually get paid? A job isn't really finished until the money landed. Mark it now, or leave it and it will show as awaiting payment.",
                      [
                        { label: "Yes — record payment", primary: true, onClick: () => setPayModal(true) },
                        { label: "Not yet", onClick: () => {} },
                      ]
                    );
                  })
                  .catch((e: unknown) => setCompleteError(e instanceof Error ? e.message : String(e)));
              }}>Yes, complete it</button>
            </div>
          </div>
        </div>
      )}
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

/**
 * CONTRACT DETAILS (08-06, mockup scene 1) — one of the TWO DOORS onto the same project columns
 * (the New-project block is the other; both pre-fill from the row, so the project only ever holds
 * one answer). The contract date is what puts revenue on the profit timeline.
 */
function ContractDetailsModal({
  project,
  onClose,
  onSaved,
}: {
  project: TimeTrackerProjectListItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const api = window.api;
  const [date, setDate] = useState(ymdToMdy(project.contract_date));
  const [amount, setAmount] = useState(project.contract_amount != null ? String(project.contract_amount) : "");
  const [signedBy, setSignedBy] = useState(project.signed_by ?? "");
  const isPreset = project.payment_terms == null || TERMS_PRESETS.includes(project.payment_terms);
  const [termsSel, setTermsSel] = useState(isPreset ? (project.payment_terms ?? "") : "custom");
  const [termsCustom, setTermsCustom] = useState(isPreset ? "" : (project.payment_terms ?? ""));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fileName = project.contract_file_path ? project.contract_file_path.split(/[\\/]/).pop() ?? "" : "";
  const contractPaid = project.rate_type === "contract" && project.contract_kind === "paid";

  const save = (): void => {
    if (saving) return;
    const ymd = date.trim() === "" ? null : mdyToYmd(date);
    if (date.trim() !== "" && ymd === null) { setError("Contract date reads month-first — MM/DD/YYYY."); return; }
    const amt = amount.trim() === "" ? null : Number(amount.replace(/,/g, ""));
    if (amt !== null && (!Number.isFinite(amt) || amt < 0)) { setError("Contracted amount must be a number of zero or more."); return; }
    setSaving(true);
    setError(null);
    void api.timetracker.projects
      .setContractDetails(project.id, {
        contractDate: ymd,
        signedBy: signedBy.trim() || null,
        paymentTerms: termsSel === "custom" ? termsCustom.trim() || null : termsSel || null,
        contractAmount: amt,
      })
      .then(onSaved)
      .catch((e: unknown) => { setSaving(false); setError(e instanceof Error ? e.message : String(e)); });
  };

  return (
    <div className="tt-modalback" onClick={onClose}>
      <div className="tt-modal" role="dialog" aria-label="Contract details" onClick={(e) => e.stopPropagation()}>
        <div className="tt-modalhead">Contract details</div>
        <div className="tt-fieldrow">
          <label className="tt-field"><span>Contract date — the date the client signed</span>
            <input className="tt-input mono" placeholder="MM/DD/YYYY" value={date} onChange={(e) => setDate(e.target.value)} autoFocus /></label>
          <label className="tt-field"><span>Contracted amount</span>
            <div className="tt-prefixed"><span className="tt-prefix">$</span>
              <input className="tt-input mono" inputMode="decimal" value={amount} disabled={!contractPaid}
                title={contractPaid ? undefined : "Only a paid contract carries a contracted amount"}
                onChange={(e) => setAmount(e.target.value)} /></div></label>
        </div>
        <div className="tt-fieldrow">
          <label className="tt-field"><span>Signed by</span>
            <input className="tt-input" value={signedBy} onChange={(e) => setSignedBy(e.target.value)} /></label>
          <label className="tt-field"><span>Payment terms</span>
            <select className="tt-input" value={termsSel} onChange={(e) => setTermsSel(e.target.value)}>
              <option value="">— none —</option>
              {TERMS_PRESETS.map((t) => <option key={t} value={t}>{t}</option>)}
              <option value="custom">Custom…</option>
            </select></label>
        </div>
        {termsSel === "custom" && (
          <label className="tt-field"><span>Custom terms</span>
            <input className="tt-input" value={termsCustom} onChange={(e) => setTermsCustom(e.target.value)} /></label>
        )}
        <label className="tt-field"><span>Contract file</span>
          <input className="tt-input" value={fileName || "— none attached (attach from Edit) —"} readOnly /></label>
        <p className="tt-hint">
          The contract date is when the money became real — it is the date profit lands on in
          Analytics. Without it, this project&apos;s revenue has no place on the timeline.
        </p>
        {error && <div className="tt-error">{error}</div>}
        <div className="tt-modalacts">
          <button className="tt-btn ghost" onClick={onClose}>Cancel</button>
          <button className="tt-btn start" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save contract details"}</button>
        </div>
      </div>
    </div>
  );
}

/**
 * RECORD PAYMENT (08-06, mockup scene 4) — money received, append-only in spirit; the list and the
 * paid-in-full line live in the same modal. Awaiting vs Paid is DERIVED from these rows against the
 * contracted amount — partials are normal. Deliberately available on a COMPLETED project (the
 * completion lock's one sanctioned exception: receiving money is not editing the work).
 */
function RecordPaymentModal({
  project,
  onClose,
  onChanged,
}: {
  project: TimeTrackerProjectListItem;
  onClose: () => void;
  onChanged: () => void;
}) {
  const api = window.api;
  const [rows, setRows] = useState<TimeTrackerProjectPayment[] | null>(null);
  const [readError, setReadError] = useState(false);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(ymdToMdy(todayYmd()));
  const [method, setMethod] = useState<TimeTrackerPaymentMethod>("check");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = (): void => {
    setReadError(false);
    void api.timetracker.payments.list(project.id).then(setRows).catch(() => setReadError(true));
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const total = (rows ?? []).reduce((s, r) => s + r.amount, 0);
  const contracted = project.contract_amount;
  const paidInFull = contracted != null && total >= contracted;
  const remaining = contracted != null ? Math.max(0, contracted - total) : null;

  const save = (): void => {
    if (saving) return;
    const amt = Number(amount.replace(/,/g, ""));
    if (!Number.isFinite(amt) || amt <= 0) { setError("Amount received must be more than zero."); return; }
    const ymd = mdyToYmd(date);
    if (!ymd) { setError("Date received reads month-first — MM/DD/YYYY."); return; }
    setSaving(true);
    setError(null);
    void api.timetracker.payments
      .add({ projectId: project.id, amount: amt, receivedOn: ymd, method, reference: reference.trim() || null, note: note.trim() || null })
      .then(() => { setSaving(false); setAmount(""); setReference(""); setNote(""); load(); onChanged(); })
      .catch((e: unknown) => { setSaving(false); setError(e instanceof Error ? e.message : String(e)); });
  };

  const voidRow = (id: number): void => {
    void api.timetracker.payments.void(id).then(() => { load(); onChanged(); }).catch(() => {});
  };

  return (
    <div className="tt-modalback" onClick={onClose}>
      <div className="tt-modal" role="dialog" aria-label="Record payment" onClick={(e) => e.stopPropagation()}>
        <div className="tt-modalhead">Record payment</div>
        <p className="tt-emptysub" style={{ marginBottom: 10 }}>
          {project.name}{contracted != null ? ` — contracted ${fmtMoney(contracted)}` : ""}
        </p>
        <div className="tt-fieldrow">
          <label className="tt-field"><span>Amount received</span>
            <div className="tt-prefixed"><span className="tt-prefix">$</span>
              <input className="tt-input mono" inputMode="decimal" autoFocus value={amount}
                placeholder={remaining != null && remaining > 0 ? remaining.toFixed(2) : ""}
                onChange={(e) => setAmount(e.target.value)} /></div></label>
          <label className="tt-field"><span>Date received</span>
            <input className="tt-input mono" placeholder="MM/DD/YYYY" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        <div className="tt-fieldrow">
          <label className="tt-field"><span>How were you paid</span>
            <select className="tt-input" value={method} onChange={(e) => setMethod(e.target.value as TimeTrackerPaymentMethod)}>
              {PAYMENT_METHOD_LABELS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select></label>
          <label className="tt-field"><span>Reference / transaction number</span>
            <input className="tt-input mono" placeholder="check #, confirmation, last 4…" value={reference}
              onChange={(e) => setReference(e.target.value)} /></label>
        </div>
        <label className="tt-field"><span>Note</span>
          <input className="tt-input" placeholder="optional…" value={note} onChange={(e) => setNote(e.target.value)} /></label>

        <div className="tt-blocksub" style={{ marginTop: 12 }}>Payments on this project</div>
        {readError ? (
          <div className="tt-error" role="alert">Couldn&apos;t load the payments — nothing is shown rather than an empty list.</div>
        ) : rows === null ? (
          <p className="tt-hint">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="tt-hint">No payments recorded yet.</p>
        ) : (
          <table className="tt-table">
            <thead><tr><th>Date</th><th>Method</th><th>Reference</th><th>Amount</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="mono dim">{ymdToMdy(r.received_on)}</td>
                  <td><span className="tt-badge">{PAYMENT_METHOD_LABELS.find(([k]) => k === r.method)?.[1] ?? r.method}</span></td>
                  <td className="mono dim">{r.reference ?? "—"}</td>
                  <td className="mono">{fmtMoney(r.amount)}</td>
                  <td><button className="tt-itemx" title="Void this payment (kept on record, no longer counted)"
                    aria-label="Void payment" onClick={() => voidRow(r.id)}>✕</button></td>
                </tr>
              ))}
              <tr>
                <td colSpan={3}><b>{paidInFull ? "Paid in full" : "Received to date"}</b>
                  {!paidInFull && remaining != null && <span className="dim"> · {fmtMoney(remaining)} still due</span>}</td>
                <td className={"mono" + (paidInFull ? " tt-paid" : "")}><b>{fmtMoney(total)}</b></td>
                <td />
              </tr>
            </tbody>
          </table>
        )}
        <p className="tt-hint">
          Partial payments are normal — a deposit now and the balance later both land here. The
          project reads <b>Awaiting payment</b> until the total matches the contract, then flips to <b>Paid</b>.
        </p>
        {error && <div className="tt-error">{error}</div>}
        <div className="tt-modalacts">
          <button className="tt-btn ghost" onClick={onClose}>Close</button>
          <button className="tt-btn done" disabled={saving || amount.trim() === ""} onClick={save}>{saving ? "Saving…" : "Save payment"}</button>
        </div>
      </div>
    </div>
  );
}
