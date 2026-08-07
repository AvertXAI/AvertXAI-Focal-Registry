/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// The LEDGER tab — one person's work entries, per the approved mockup's "Time ledger" surface:
// four accumulated-hours cards, then the entry table. Reads ONLY through the Phase 1 services wired
// in Phase 2 (employees.entries.listForPerson + employees.reports.balance); it writes nothing.
//
// THREE DISTINCT STATES, deliberately. An empty list rendered over a failed read is the exact
// confusion that made the notes editor look like data loss this session: "nothing here" and
// "we couldn't ask" must never look alike.
import { useEffect, useState } from "react";
import type { EmployeeAdjustment, EmployeeBalance, EmployeeEntry, EmployeePerson } from "../../shared/types";
import { avatarColor, initials } from "./PeopleRail";
// ONE expression of the money rule, shared with the Add Time preview (Jason 08-03-2026). The
// authority is still ENTRY_COST_SQL in the reports service — see the comment in ./entryCost.
import { adjustmentValue, entryCost } from "./entryCost";

interface Props {
  person: EmployeePerson;
  /** Bumped by the module to force a refetch without remounting. */
  refreshKey: number;
  /** Lets the module keep the rail's hours in step with what this tab actually read. */
  onHours: (employeeId: number, hours: number) => void;
  onEdit: () => void;
  onArchive: () => void;
  onAddTime: () => void;
}

const fmtMoney = (n: number): string =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtHours = (h: number): string => {
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  return `${whole}h ${String(mins).padStart(2, "0")}m`;
};
/** worked_on is a plain YYYY-MM-DD — parsed as LOCAL, never through Date's UTC-shifting path. */
const fmtDate = (ymd: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : ymd;
};
const daysAgo = (ymd: string): number => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return Number.POSITIVE_INFINITY;
  const then = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  return (Date.now() - then) / 86_400_000;
};

export default function LedgerView({ person, refreshKey, onHours, onEdit, onArchive, onAddTime }: Props) {
  const api = window.api;
  const [entries, setEntries] = useState<EmployeeEntry[] | null>(null);
  const [balance, setBalance] = useState<EmployeeBalance | null>(null);
  /** id → title, so the Task column can show a NAME. An entry stores task_id and no title, and
      listEntriesForPerson does no join — so this map is the whole mechanism (ruled 08-03-2026:
      renderer map, no service change). A task that was soft-deleted drops out of tasks.list, so its
      id resolves to nothing and the cell falls back to the em dash rather than inventing a name. */
  const [taskNames, setTaskNames] = useState<Record<number, string>>({});
  const [error, setError] = useState(false);
  /** The person's LIVE adjustments, mapped per entry — the "it took longer" mechanic (08-06):
      the entry's agreed rate and hours are never rewritten; Net = amount + its adjustments. */
  const [adjustments, setAdjustments] = useState<EmployeeAdjustment[]>([]);
  const [adjModal, setAdjModal] = useState<EmployeeEntry | null | false>(false); // false=closed, null=unlinked, entry=linked

  useEffect(() => {
    let live = true;
    setEntries(null);
    setError(false);
    Promise.all([
      api.employees.entries.listForPerson(person.id),
      api.employees.reports.balance(person.id),
      api.employees.tasks.list(),
      api.employees.adjustments.list(person.id),
    ])
      .then(([rows, bal, tasks, adjs]) => {
        if (!live) return;
        setEntries(rows);
        setBalance(bal);
        setTaskNames(Object.fromEntries(tasks.map((t) => [t.id, t.title])));
        setAdjustments(adjs.filter((a) => a.deleted_at === null));
        onHours(person.id, rows.reduce((s, e) => s + e.hours_worked, 0));
      })
      .catch((e: unknown) => {
        if (!live) return;
        // NEVER fall through to an empty table — say the read failed, and say it in plain words.
        console.error("[employees] ledger read failed:", e);
        setError(true);
      });
    return () => {
      live = false; // a fast person-switch must not let a stale response overwrite the new one
    };
  }, [api, person.id, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const week = (entries ?? []).filter((e) => daysAgo(e.worked_on) <= 7);
  const month = (entries ?? []).filter((e) => daysAgo(e.worked_on) <= 30);
  const year = (entries ?? []).filter((e) => new Date(e.worked_on).getFullYear() === new Date().getFullYear());
  const hoursOf = (list: EmployeeEntry[]): number => list.reduce((s, e) => s + e.hours_worked, 0);
  /** Signed dollar sum of this entry's live adjustments; null when it has none ("—", not $0.00). */
  const adjFor = (entryId: number): number | null => {
    const mine = adjustments.filter((a) => a.entry_id === entryId);
    return mine.length === 0 ? null : mine.reduce((s, a) => s + adjustmentValue(a), 0);
  };
  const reload = (): void => {
    // Same fetch the mount effect runs — the module's refreshKey path also lands here.
    void api.employees.adjustments.list(person.id).then((adjs) => setAdjustments(adjs.filter((a) => a.deleted_at === null))).catch(() => {});
    void api.employees.reports.balance(person.id).then(setBalance).catch(() => {});
  };

  return (
    <>
      <div className="emp-personhead">
        <span className="emp-avatar lg" style={{ background: avatarColor(person.id) }} aria-hidden="true">
          {initials(person.name)}
        </span>
        <div>
          <h2>{person.name}</h2>
          <div className="emp-personrole">
            {[person.role, person.default_rate != null ? `${fmtMoney(person.default_rate)} / hour` : null]
              .filter(Boolean)
              .join(" · ") || "No role set"}
          </div>
        </div>
        {/* The mockup's right-aligned actions cluster — Phase 3A had none, by design. */}
        <div className="emp-headacts">
          <button className="emp-btn" onClick={onEdit}>Edit</button>
          <button className="emp-btn" onClick={onArchive}>Archive</button>
          <button className="emp-btn primary" onClick={onAddTime}>+ Add Time</button>
          <button className="emp-btn primary soft" onClick={() => setAdjModal(null)}>+ Add Adjustment</button>
        </div>
      </div>

      {error ? (
        <div className="emp-state error" role="alert">
          <b>Couldn&apos;t load this ledger.</b>
          The entries could not be read, so nothing is shown rather than an empty list. Reopen the
          module to try again — nothing has been changed.
        </div>
      ) : entries === null ? (
        <div className="emp-state">Loading…</div>
      ) : (
        <>
          <div className="emp-cards">
            <div className="emp-card">
              <span className="emp-cardlabel">This week</span>
              <span className="emp-cardvalue">{fmtHours(hoursOf(week))}</span>
              <span className="emp-cardsub">{week.length} {week.length === 1 ? "entry" : "entries"}</span>
            </div>
            <div className="emp-card">
              <span className="emp-cardlabel">Last 30 days</span>
              <span className="emp-cardvalue">{fmtHours(hoursOf(month))}</span>
              <span className="emp-cardsub">{month.length} {month.length === 1 ? "entry" : "entries"}</span>
            </div>
            <div className="emp-card">
              <span className="emp-cardlabel">Year to date</span>
              <span className="emp-cardvalue">{fmtHours(hoursOf(year))}</span>
              <span className="emp-cardsub">{year.length} {year.length === 1 ? "entry" : "entries"}</span>
            </div>
            <div className="emp-card">
              <span className="emp-cardlabel">Outstanding</span>
              <span className="emp-cardvalue owed">{fmtMoney(balance?.outstanding ?? 0)}</span>
              <span className="emp-cardsub">earned {fmtMoney(balance?.earned ?? 0)} · paid {fmtMoney(balance?.paid ?? 0)}</span>
            </div>
          </div>

          <div className="emp-sectlabel">
            Time ledger
            <button className="emp-linkbtn" onClick={onAddTime}>+ Add Time</button>
          </div>
          {entries.length === 0 ? (
            <div className="emp-state">
              No time logged for {person.name} yet. Use <b>+ Add Time</b> above to record some.
            </div>
          ) : (
            <table className="emp-table">
              <thead>
                <tr>
                  <th>Date</th><th>Project</th><th>Task</th><th>Note</th><th>Pay type</th><th>Hours</th><th>Amount</th><th>Adjustment</th><th>Net</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const adj = adjFor(e.id);
                  const base = entryCost(e);
                  return (
                    <tr key={e.id}>
                      <td className="num">{fmtDate(e.worked_on)}</td>
                      <td>{e.project_name}</td>
                      <td className="dim">{(e.task_id != null ? taskNames[e.task_id] : null) ?? "—"}</td>
                      <td className="dim">{e.note ?? "—"}</td>
                      <td>
                        <span className="emp-pill">{e.pay_type}</span>
                        <button className="emp-linkbtn sm" title="Adjust this entry — the agreed rate and hours stay untouched"
                          onClick={() => setAdjModal(e)}>±</button>
                      </td>
                      <td className="num">{e.hours_worked.toFixed(2)}</td>
                      <td className="money">{fmtMoney(base)}</td>
                      {/* The "it took longer" mechanic: the adjustment is its OWN row against the
                          entry — signed, reasoned — and Net is what actually gets paid. */}
                      <td className={"money" + (adj == null ? " dim" : adj < 0 ? " emp-adjneg" : " emp-adjpos")}>
                        {adj == null ? "—" : `${adj < 0 ? "−" : "+"}${fmtMoney(Math.abs(adj))}`}
                      </td>
                      <td className="money"><b>{fmtMoney(base + (adj ?? 0))}</b></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
      {adjModal !== false && (
        <AddAdjustmentModal person={person} entry={adjModal} entries={entries ?? []}
          onClose={() => setAdjModal(false)}
          onSaved={() => { setAdjModal(false); reload(); }} />
      )}
    </>
  );
}

/**
 * ADD ADJUSTMENT (08-06, mockup scene 5) — a signed correction with a REQUIRED reason, optionally
 * AGAINST one entry (the "it took longer" mechanic). Writes through the EXISTING adjustment
 * services — amount kind against the entry's project; the entry link is the new nullable column.
 * The entry itself is never rewritten.
 */
function AddAdjustmentModal({
  person,
  entry,
  entries,
  onClose,
  onSaved,
}: {
  person: EmployeePerson;
  entry: EmployeeEntry | null;
  entries: EmployeeEntry[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const api = window.api;
  const [entrySel, setEntrySel] = useState<string>(entry ? String(entry.id) : "");
  const [amount, setAmount] = useState("");
  const [sign, setSign] = useState<"+" | "-">("-");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const linked = entries.find((e) => String(e.id) === entrySel) ?? null;

  const save = (): void => {
    if (saving) return;
    const n = Number(amount.replace(/,/g, ""));
    if (!Number.isFinite(n) || n <= 0) { setError("The adjustment amount must be more than zero — pick + or − for its direction."); return; }
    if (reason.trim() === "") { setError("A reason is required — it is the whole record of why the pay moved."); return; }
    setSaving(true);
    setError(null);
    void api.employees.adjustments
      .createAmount({
        employeeId: person.id,
        projectId: linked?.project_id ?? null,
        projectName: linked?.project_name ?? null,
        deltaAmount: sign === "-" ? -n : n,
        note: reason.trim(),
        entryId: linked?.id ?? null,
      })
      .then(onSaved)
      .catch((e: unknown) => { setSaving(false); setError(e instanceof Error ? e.message : String(e)); });
  };

  return (
    <div className="emp-modalback" onClick={onClose}>
      <div className="emp-modal" role="dialog" aria-label="Add adjustment" onClick={(ev) => ev.stopPropagation()}>
        <h2>Add adjustment</h2>
        <p className="emp-hint" style={{ marginBottom: 12 }}>
          {person.name} — a signed correction, its own row. The entry&apos;s agreed rate and hours are never rewritten.
        </p>
        <label className="emp-field">
          <span>Against entry (optional)</span>
          <select className="emp-input" value={entrySel} onChange={(e) => setEntrySel(e.target.value)}>
            <option value="">— none (general correction) —</option>
            {entries.map((e) => (
              <option key={e.id} value={String(e.id)}>
                {fmtDate(e.worked_on)} · {e.project_name} · {fmtMoney(entryCost(e))}
              </option>
            ))}
          </select>
        </label>
        <div className="emp-fieldrow">
          <label className="emp-field narrow">
            <span>Direction</span>
            <div className="emp-pillset" role="radiogroup" aria-label="Direction">
              <button type="button" role="radio" aria-checked={sign === "-"}
                className={"emp-pillbtn" + (sign === "-" ? " on" : "")} onClick={() => setSign("-")}>− less</button>
              <button type="button" role="radio" aria-checked={sign === "+"}
                className={"emp-pillbtn" + (sign === "+" ? " on" : "")} onClick={() => setSign("+")}>+ more</button>
            </div>
          </label>
          <label className="emp-field">
            <span>Amount ($)</span>
            <input className="emp-input mono" inputMode="decimal" autoFocus value={amount}
              onChange={(e) => setAmount(e.target.value)} />
          </label>
        </div>
        <label className="emp-field">
          <span>Reason (required)</span>
          <input className="emp-input" placeholder="editing ran three days over…" value={reason}
            onChange={(e) => setReason(e.target.value)} />
        </label>
        {error && (
          <div className="emp-error" role="alert"><span className="emp-error-plain">{error}</span></div>
        )}
        <div className="emp-modalacts">
          <button className="emp-btn ghost" onClick={onClose}>Cancel</button>
          <button className="emp-btn primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save adjustment"}</button>
        </div>
      </div>
    </div>
  );
}
