/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// COMPLETED tab (08-06, per the approved mockup): one dropdown row per completed job — caret,
// icon + name, "$value · hours" figure, completion date, and TWO row controls (Export PDF, the
// primary Activate). The expanded body is a DOCUMENT: lock chip, four stat cards (with Net),
// client block, employees-with-pay-and-cost table, itemized rows, notes — NO controls inside it.
// Rows expand in place (the employees AdjustmentsView precedent: one expanded id, toggled).
// Every read already existed; this file is only the composer the recon said was missing.
import { useEffect, useState } from "react";
import type {
  EmployeeEntry,
  EmployeePerson,
  TimeTrackerProjectItem,
  TimeTrackerProjectListItem,
  TimeTrackerProjectMember,
  TimeTrackerProjectSpend,
} from "../../shared/types";
import { INVOICE_CSS, renderInvoiceHtml } from "./invoicePrint";

interface Props {
  /** The module's already-loaded ACTIVE list — completed projects still ride it (read paths are
      untouched by the lock); this view just filters. Archived-and-completed rows live in Archive. */
  projects: TimeTrackerProjectListItem[];
  onDataChanged: () => void;
}

interface DocData {
  spend: TimeTrackerProjectSpend | null;
  members: TimeTrackerProjectMember[];
  entries: EmployeeEntry[];
  items: TimeTrackerProjectItem[];
  note: string;
  people: EmployeePerson[];
  failed: boolean;
}

const fmtDuration = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
};
const fmtMoney = (n: number): string =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
};

/** One entry's pay — the ENTRY_COST_SQL rule, applied renderer-side for the per-person rollup:
    donated 0, hourly h × rate, else the flat amount. */
const entryCost = (e: EmployeeEntry): number =>
  e.pay_type === "donated" ? 0 : e.pay_type === "hourly" ? e.hours_worked * e.rate_at_entry : (e.flat_amount ?? 0);

export default function CompletedView({ projects, onDataChanged }: Props) {
  const api = window.api;
  const completed = projects.filter((p) => p.completed_at != null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [doc, setDoc] = useState<DocData | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [exportLine, setExportLine] = useState<{ text: string; path: string | null; err: boolean } | null>(null);

  // The expanded row's document data — five existing reads, composed here (recon B5).
  useEffect(() => {
    setDoc(null);
    if (openId == null) return;
    let dead = false;
    void Promise.all([
      api.timetracker.financials.spend(openId),
      api.timetracker.financials.members(openId),
      api.employees.entries.listForProject(openId),
      api.timetracker.financials.items(openId),
      api.timetracker.notes.get(openId),
      api.employees.people.list(),
    ])
      .then(([spend, members, entries, items, note, people]) => {
        if (!dead) setDoc({ spend, members, entries, items, note, people, failed: false });
      })
      .catch(() => {
        if (!dead) setDoc({ spend: null, members: [], entries: [], items: [], note: "", people: [], failed: true });
      });
    return () => {
      dead = true;
    };
  }, [openId, api]);

  const activate = (p: TimeTrackerProjectListItem): void => {
    setBusy(p.id);
    void api.timetracker.projects
      .reactivate(p.id)
      .then(() => onDataChanged())
      .catch(() => {})
      .finally(() => setBusy(null));
  };

  const exportPdf = (p: TimeTrackerProjectListItem): void => {
    setBusy(p.id);
    setExportLine(null);
    void api.timetracker.invoice
      .data(p.id)
      .then((inv) => api.timetracker.invoice.exportPdf(p.id, renderInvoiceHtml(inv), INVOICE_CSS))
      .then((path) => setExportLine({ text: `Invoice saved: ${path}`, path, err: false }))
      .catch((e: unknown) =>
        setExportLine({ text: e instanceof Error ? e.message : String(e), path: null, err: true })
      )
      .finally(() => setBusy(null));
  };

  if (completed.length === 0) {
    return (
      <div className="tt-panel">
        <div className="tt-emptyrow">
          Nothing completed yet. The green <b>Complete job</b> button on a project locks it and files it here.
        </div>
      </div>
    );
  }

  return (
    <div className="tt-panel">
      {exportLine && (
        <div className={"tt-exportline" + (exportLine.err ? " err" : "")} role="status">
          {exportLine.text}
          {exportLine.path && (
            <button className="tt-iconbtn" onClick={() => void api.timetracker.reports.revealExportedPdf(exportLine.path as string).catch(() => {})}>
              Show in folder
            </button>
          )}
        </div>
      )}
      {completed.map((p) => {
        const open = openId === p.id;
        return (
          <div key={p.id} className={"tt-crow" + (open ? " open" : "")}>
            {/* A div-with-role, NOT a button: the row carries its own buttons and nested buttons
                are invalid HTML (the AdjustmentsView rows use td-scoped buttons for the same reason). */}
            <div className="tt-chead" role="button" tabIndex={0} aria-expanded={open}
              onClick={() => setOpenId(open ? null : p.id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenId(open ? null : p.id); } }}>
              <span className="tt-caret">{open ? "▾" : "▸"}</span>
              <span className="tt-cname">
                {p.group_icon && <span aria-hidden="true">{p.group_icon} </span>}
                {p.name}
              </span>
              <span className="tt-cfig">{fmtMoney(p.total_value)} · {fmtDuration(p.total_seconds)}</span>
              <span className="tt-cwhen">completed {fmtDate(p.completed_at)}</span>
              <span className="tt-crowacts" onClick={(e) => e.stopPropagation()}>
                <button className="tt-btn ghost sm" disabled={busy === p.id} onClick={() => exportPdf(p)}>
                  {busy === p.id ? "…" : "Export PDF"}
                </button>
                <button className="tt-btn start sm" disabled={busy === p.id} onClick={() => activate(p)}
                  title="Reopen this job for editing">
                  Activate
                </button>
              </span>
            </div>
            {open && (
              <div className="tt-cbody">
                <span className="tt-lockchip">🔒 View only — completed {fmtDate(p.completed_at)}</span>
                {doc === null ? (
                  <div className="tt-emptyrow">Loading…</div>
                ) : doc.failed ? (
                  <div className="tt-error" role="alert">Couldn&apos;t load this job&apos;s document. Reopen the row to try again.</div>
                ) : (
                  <>
                    <div className="tt-completefigs">
                      <div className="tt-card"><span className="tt-cardlabel">Total hours</span><span className="tt-cardvalue">{fmtDuration(p.total_seconds)}</span></div>
                      <div className="tt-card"><span className="tt-cardlabel">Contracted</span><span className="tt-cardvalue">{p.contract_amount != null ? fmtMoney(p.contract_amount) : "—"}</span></div>
                      <div className="tt-card"><span className="tt-cardlabel">Spent</span><span className="tt-cardvalue">{fmtMoney(doc.spend?.spent ?? 0)}</span></div>
                      {/* Net = what the client pays minus what was spent — the mockup's green figure. */}
                      <div className="tt-card"><span className="tt-cardlabel">Net</span><span className="tt-cardvalue tt-net">{fmtMoney((p.contract_amount ?? p.total_value) - (doc.spend?.spent ?? 0))}</span></div>
                    </div>

                    <div className="tt-docsect">Client</div>
                    <div className="tt-inforow">
                      <div className="tt-info"><span className="tt-infolabel">Client</span><b>{p.client_name}</b></div>
                      <div className="tt-info"><span className="tt-infolabel">Contact</span><b>{p.contact_phone || "—"}</b></div>
                      <div className="tt-info"><span className="tt-infolabel">Email</span><b>{p.email || "—"}</b></div>
                      <div className="tt-info"><span className="tt-infolabel">Group</span><b>{p.group_name ?? "Ungrouped"}</b></div>
                    </div>

                    <div className="tt-docsect">Employees on this project</div>
                    {(() => {
                      // Roster ∪ everyone with logged entries; hours + cost aggregate per person.
                      const byId = new Map<number, { name: string; role: string; pay: string; hours: number; cost: number; hasHours: boolean }>();
                      const nameOf = (id: number): { name: string; role: string } => {
                        const person = doc.people.find((x) => x.id === id);
                        return { name: person?.name ?? `Person ${id}`, role: person?.role ?? "—" };
                      };
                      for (const m of doc.members) {
                        byId.set(m.person_id, {
                          name: m.person_name ?? nameOf(m.person_id).name,
                          role: m.person_role ?? "—",
                          pay: m.default_rate != null ? `${fmtMoney(m.default_rate)} / ${m.default_pay_type ?? "hourly"}` : "—",
                          hours: 0,
                          cost: 0,
                          hasHours: false,
                        });
                      }
                      for (const e of doc.entries) {
                        const cur = byId.get(e.employee_id) ?? { ...nameOf(e.employee_id), pay: `${fmtMoney(e.rate_at_entry)} / ${e.pay_type}`, hours: 0, cost: 0, hasHours: false };
                        cur.hours += e.hours_worked;
                        cur.cost += entryCost(e);
                        cur.hasHours = cur.hasHours || e.pay_type === "hourly" || e.pay_type === "donated" || e.hours_worked > 0;
                        byId.set(e.employee_id, cur);
                      }
                      const rows = [...byId.values()];
                      return rows.length === 0 ? (
                        <div className="tt-emptyrow">Nobody was assigned or logged time.</div>
                      ) : (
                        <table className="tt-table">
                          <thead><tr><th>Name</th><th>Role</th><th>Pay</th><th>Hours</th><th>Cost</th></tr></thead>
                          <tbody>
                            {rows.map((r, i) => (
                              <tr key={i}>
                                <td>{r.name}</td>
                                <td className="dim">{r.role}</td>
                                <td className="mono dim">{r.pay}</td>
                                <td className="mono">{r.hasHours ? r.hours.toFixed(1) : "—"}</td>
                                <td className="mono">{fmtMoney(r.cost)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      );
                    })()}

                    <div className="tt-docsect">Itemized</div>
                    {doc.items.length === 0 ? (
                      <div className="tt-emptyrow">No itemized rows.</div>
                    ) : (
                      <table className="tt-table">
                        <thead><tr><th>Qty</th><th>Description</th><th>Amount</th></tr></thead>
                        <tbody>
                          {doc.items.map((it) => (
                            <tr key={it.id}>
                              <td className="mono">{it.qty}</td>
                              <td>{it.description}</td>
                              <td className="mono">{fmtMoney(it.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    <div className="tt-docsect">Notes</div>
                    {doc.note.trim() === "" ? (
                      <div className="tt-emptyrow">No notes.</div>
                    ) : (
                      <p className="tt-docnotes">{doc.note}</p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
