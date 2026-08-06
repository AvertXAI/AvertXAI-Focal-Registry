/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// TimeTracker new/edit project modal — reworked to the approved MOCKUP-project-financials-paymodel
// -v5-08-04-2026.html, state 1. Three blocks across a responsive two-column grid: CLIENT, GROUP,
// and CONTRACT / ASSIGNMENT + EMPLOYEES ON THIS PROJECT.
//
// WHAT CHANGED, and the rulings behind each (08-04-2026):
//   · Rate type and Hourly rate are GONE from this modal. Rate editing stays where it already
//     lives — ProjectDetail's own controls — and is untouched.
//   · There is NO colour row here. Colour STAYS on the project and every dot keeps painting; it is
//     simply not edited from this modal. ProjectDetail's swatch row (its existing picker) remains
//     the place colour is chosen. The GROUP gains an ICON, added ALONGSIDE colour, never replacing.
//   · Status reads Active | Pause. Those are the EXISTING 'active' / 'parked' values — a wording
//     change, not a schema one. 'done' is untouched and still set from ProjectDetail.
//   · The three action buttons are rendered NATIVELY here. The Employees portal-wrapper seam from
//     3B.2 is retired: two mechanisms must never fight over one action row.
//
// Content-area modal: opaque theme surface, NO native-overlay dim (the recurring §3.4 defect).
// It is anchored to .tt-shell, which begins below the topbar, so it structurally cannot cover the
// native window buttons.
import { useCallback, useEffect, useState } from "react";
import { explainTimeTrackerError, type TimeTrackerErrorExplanation } from "./ttErrors";
// The Employees create form, reused rather than duplicated. Its stylesheet is imported explicitly
// for the same reason NewEmployeeWizard imports TimeTracker's — the single-bundle CSS is an
// accident of static imports, not a guarantee.
import PersonModal from "../employees/PersonModal";
import "../employees/employees.css";
import type {
  TimeTrackerGroup,
  TimeTrackerNewProjectInput,
  TimeTrackerProjectItem,
  TimeTrackerProjectListItem,
  TimeTrackerProjectMember,
  TimeTrackerProjectSpend,
  TimeTrackerProjectStatus,
  EmployeePerson,
} from "../../shared/types";

export type ModalState = { mode: "new" } | { mode: "edit"; project: TimeTrackerProjectListItem } | null;

interface Props {
  state: Exclude<ModalState, null>;
  groups: TimeTrackerGroup[];
  onClose: () => void;
  onSaved: (p: TimeTrackerProjectListItem) => void;
  /** Optional third action. Supplied by the Employees wizard; absent inside TimeTracker itself. */
  onSavedCreateEmployee?: (p: TimeTrackerProjectListItem) => void;
  /** Lets a caller refresh its own group list after one is created in place. */
  onGroupsChanged?: () => void;
}

const NEW_GROUP = "__new__";
/** Colour is not edited here, but create still needs a value — the column is NOT NULL. */
const DEFAULT_COLOR = "#2f6df6";

/** The icon set the mockup draws (v5:156). Emoji, so nothing is fetched and nothing is licensed. */
export const GROUP_ICONS = ["📷", "🎥", "💍", "🏗", "🎨", "🧾", "📦", "⭐"] as const;

/** Auto-assignment: a stable pick from the group's own name, so the same group always gets the same
    icon and two groups created in a row do not collide by accident. */
export function autoIcon(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return GROUP_ICONS[h % GROUP_ICONS.length];
}

const fmtMoney = (n: number): string =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Ten digits, auto-dashed. Anything beyond ten is dropped — a US number has ten, and quietly
    accepting an eleventh produces something nobody can dial. */
/** "street\ncity, ST zip" → parts for the reveal's four boxes; null when nothing is stored.
    An unparseable second line lands whole in city so nothing typed is ever dropped. */
function parseAddress(stored: string | null): { street: string; city: string; state: string; zip: string } | null {
  if (!stored || stored.trim() === "") return null;
  const [first, ...rest] = stored.split("\n");
  const line2 = rest.join(" ").trim();
  const m = /^(.*?),\s*([A-Za-z]{2})\s*([\w-]*)$/.exec(line2);
  if (m) return { street: first.trim(), city: m[1].trim(), state: m[2].toUpperCase(), zip: m[3] };
  return { street: first.trim(), city: line2, state: "", zip: "" };
}

function formatPhone(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}
/** Extension: digits only, capped at six. */
const formatExt = (raw: string): string => raw.replace(/\D/g, "").slice(0, 6);

export default function ProjectModal({
  state,
  groups,
  onClose,
  onSaved,
  onSavedCreateEmployee,
  onGroupsChanged,
}: Props) {
  const api = window.api;
  const editing = state.mode === "edit" ? state.project : null;

  const [name, setName] = useState(editing?.name ?? "");
  const [clientName, setClientName] = useState(editing?.client_name ?? "");
  const [company, setCompany] = useState(editing?.client_company ?? "");
  const [phone, setPhone] = useState(formatPhone(editing?.contact_phone ?? ""));
  const [ext, setExt] = useState(editing?.phone_ext ?? "");
  const [email, setEmail] = useState(editing?.email ?? "");
  // Address is a reveal — most clients will not have one to hand, and four empty boxes is worse
  // than a button. PERSISTED since 08-06 (clients.address, one text value) — stored as
  // "street\ncity, ST zip" and re-split here on edit; an unparseable value lands whole in street.
  const stored = parseAddress(editing?.client_address ?? null);
  const [showAddr, setShowAddr] = useState(stored != null);
  const [street, setStreet] = useState(stored?.street ?? "");
  const [city, setCity] = useState(stored?.city ?? "");
  const [stateCode, setStateCode] = useState(stored?.state ?? "");
  const [zip, setZip] = useState(stored?.zip ?? "");
  const [amount, setAmount] = useState(editing?.contract_amount != null ? String(editing.contract_amount) : "");
  const [budget, setBudget] = useState(editing?.spend_budget != null ? String(editing.spend_budget) : "");
  const [description, setDescription] = useState(editing?.contract_description ?? "");
  const [contract, setContract] = useState<{ path: string; name: string } | null>(null);
  const [groupSel, setGroupSel] = useState<string>(editing?.group_id != null ? String(editing.group_id) : "");
  const [newGroupName, setNewGroupName] = useState("");
  const [groupIcon, setGroupIcon] = useState<string>("");
  const [status, setStatus] = useState<TimeTrackerProjectStatus>(editing?.status ?? "active");
  const [error, setError] = useState<TimeTrackerErrorExplanation | null>(null);
  const [saving, setSaving] = useState(false);

  // ---- live data, EDIT MODE ONLY: all three need a project id, which a new project has not got yet.
  const [items, setItems] = useState<TimeTrackerProjectItem[] | null>(null);
  const [members, setMembers] = useState<TimeTrackerProjectMember[] | null>(null);
  const [spend, setSpend] = useState<TimeTrackerProjectSpend | null>(null);
  const [people, setPeople] = useState<EmployeePerson[]>([]);
  const [dataError, setDataError] = useState(false);
  const [newItem, setNewItem] = useState({ qty: "1", description: "", rate: "", amount: "" });
  const [memberSel, setMemberSel] = useState("");
  /**
   * NEW-PROJECT BUFFER. Itemized rows and roster entries both need a project_id, and a project
   * being created has not got one yet. Rather than making these blocks edit-only, the form holds
   * them here and FLUSHES them straight after create returns the real id. Same fields, same
   * services, same validation — only the moment of the write differs.
   */
  const [pendingItems, setPendingItems] = useState<{ qty: number; description: string; amount: number; unitRate: number | null }[]>([]);
  const [pendingMembers, setPendingMembers] = useState<number[]>([]);
  const [creatingPerson, setCreatingPerson] = useState(false);
  const [groupAccepted, setGroupAccepted] = useState(false);
  /** The textarea's live text. `description` is the COMMITTED value that actually gets saved. */
  const [descDraft, setDescDraft] = useState(editing?.contract_description ?? "");
  /** After a successful create: offer to staff the project before closing. */
  const [askStaff, setAskStaff] = useState<TimeTrackerProjectListItem | null>(null);
  /** Highlights the Employees block when the user comes back to add someone. */
  const [glowStaff, setGlowStaff] = useState(false);
  /** Every project — the nested Create Employee form needs it for its own Project dropdown. */
  const [allProjects, setAllProjects] = useState<TimeTrackerProjectListItem[]>([]);

  const projectId = editing?.id ?? null;

  const loadFinancials = useCallback((): void => {
    if (projectId == null) return;
    setDataError(false);
    Promise.all([
      api.timetracker.financials.items(projectId),
      api.timetracker.financials.members(projectId),
      api.timetracker.financials.spend(projectId),
    ])
      .then(([i, m, s]) => {
        setItems(i);
        setMembers(m);
        setSpend(s);
      })
      .catch((e: unknown) => {
        // An empty itemize list must never stand in for a failed read on a money surface.
        console.error("[timetracker] project financials read failed:", e);
        setDataError(true);
      });
  }, [api, projectId]);

  useEffect(() => {
    loadFinancials();
  }, [loadFinancials]);

  useEffect(() => {
    void api.employees.people.list().then(setPeople).catch(() => setPeople([]));
    void api.timetracker.projects.list().then(setAllProjects).catch(() => setAllProjects([]));
  }, [api]);

  const num = (s: string): number | null => {
    const n = Number(s.replace(/,/g, ""));
    return s.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : null;
  };

  const acceptGroup = (): void => {
    if (newGroupName.trim() === "") return;
    if (!groupIcon) setGroupIcon(autoIcon(newGroupName.trim()));
    setGroupAccepted(true);
  };

  // One text value on the client row: "street" newline "city, ST zip" — only the parts given.
  const composeAddress = (): string | null => {
    const line2 = [city.trim(), [stateCode.trim(), zip.trim()].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(", ");
    const whole = [street.trim(), line2].filter(Boolean).join("\n");
    return whole === "" ? null : whole;
  };

  const buildInput = (): TimeTrackerNewProjectInput => ({
    name,
    clientName,
    clientCompany: company.trim() || null,
    clientAddress: composeAddress(),
    // The extension rides with the number so one column carries a dialable string; the modal keeps
    // them as separate fields, which is what the ruling asked for. See the report's deviation note.
    contactPhone: ext.trim() === "" ? phone : `${phone} x${ext}`,
    email,
    // Rate type is no longer editable here. Existing projects keep whatever they had; new ones take
    // the column default, and rate editing continues to live in ProjectDetail.
    rateType: editing?.rate_type ?? "hourly",
    hourlyRate: editing?.hourly_rate ?? null,
    color: editing?.color ?? DEFAULT_COLOR, // colour STAYS; it is simply not edited from this modal
    status,
    groupId: groupSel !== "" && groupSel !== NEW_GROUP ? Number(groupSel) : null,
    newGroupName: groupSel === NEW_GROUP ? newGroupName.trim() || null : null,
    newGroupColor: null,
    newGroupIcon: groupSel === NEW_GROUP ? groupIcon || autoIcon(newGroupName.trim()) : null,
    contractAmount: num(amount),
    contractDescription: description,
    contractSourcePath: contract?.path ?? null,
    contractKind: editing?.contract_kind ?? null,
    targetHours: editing?.target_hours ?? null,
    spendBudget: num(budget),
    phoneExt: ext.trim() === "" ? null : ext,
  });

  /**
   * Writes the buffered rows against the id the project just got. Sequential, not parallel: these
   * are money rows and a predictable order is worth more than a few milliseconds.
   * If one fails the project still exists — so the caller is told exactly what landed and what did
   * not, rather than the whole save appearing to have failed.
   */
  const flushPending = async (newId: number): Promise<string | null> => {
    let failed = 0;
    for (const it of pendingItems) {
      try {
        await api.timetracker.financials.addItem({ projectId: newId, ...it });
      } catch (e) {
        failed++;
        console.error("[timetracker] buffered item failed:", e);
      }
    }
    for (const personId of pendingMembers) {
      try {
        await api.timetracker.financials.addMember(newId, personId);
      } catch (e) {
        failed++;
        console.error("[timetracker] buffered member failed:", e);
      }
    }
    return failed === 0 ? null : `The project was created, but ${failed} of the rows you added could not be saved.`;
  };

  const submit = (then: "close" | "employee"): void => {
    if (saving) return;
    setSaving(true);
    setError(null);
    const input = buildInput();
    const op = editing
      ? api.timetracker.projects.update({ ...input, id: editing.id })
      : api.timetracker.projects.create(input);
    void op
      .then(async (p) => {
        // Only a NEW project has anything buffered; editing writes straight through.
        if (!editing && (pendingItems.length > 0 || pendingMembers.length > 0)) {
          const problem = await flushPending(p.id);
          if (problem) {
            setSaving(false);
            setError({ plain: problem, hint: "Reopen the project to add the missing ones." });
            return;
          }
        }
        onGroupsChanged?.();
        if (then === "employee" && onSavedCreateEmployee) { onSavedCreateEmployee(p); return; }
        // A brand-new project with nobody on it: ask before closing, because staffing it is the
        // next thing the user almost always wants and the section is easy to miss.
        if (!editing && pendingMembers.length === 0) {
          setSaving(false);
          setAskStaff(p);
          return;
        }
        onSaved(p);
      })
      .catch((e: unknown) => {
        setSaving(false);
        const raw = e instanceof Error ? e.message : String(e);
        // RAW text to the console ONLY — the dialog gets a sentence (scanErrors.ts precedent).
        console.error("[timetracker] project save failed:", raw);
        setError(explainTimeTrackerError(raw));
      });
  };

  const pickContract = (): void => {
    void api.timetracker.files.pickContract().then((f) => { if (f) setContract(f); }).catch(() => {});
  };

  const addItem = (): void => {
    if (newItem.description.trim() === "") return;
    // Unit rate (08-06): when a rate is typed, amount = qty × rate unless the user overrode it.
    const qty = num(newItem.qty) ?? 1;
    const rate = num(newItem.rate);
    const typedAmount = num(newItem.amount);
    const row = {
      qty,
      description: newItem.description.trim(),
      amount: typedAmount ?? (rate != null ? Math.round(qty * rate * 100) / 100 : 0),
      unitRate: rate,
    };
    // No project id yet → hold it; the flush after create writes it through the same service.
    if (projectId == null) {
      setPendingItems((prev) => [...prev, row]);
      setNewItem({ qty: "1", description: "", rate: "", amount: "" });
      return;
    }
    void api.timetracker.financials
      .addItem({ projectId, ...row })
      .then(() => {
        setNewItem({ qty: "1", description: "", rate: "", amount: "" });
        loadFinancials(); // the readouts move with it
      })
      .catch((e: unknown) => console.error("[timetracker] add item failed:", e));
  };

  /** Saved employee cost + saved items + anything still buffered. The service half is null until a
      project exists, so a NEW project's figures come entirely from the buffer. */
  const liveSpent = (spend?.spent ?? 0) + pendingItems.reduce((s, i) => s + i.amount, 0);

  // Saved rows plus anything still buffered — so the total is honest before the project exists.
  const itemTotal =
    (items ?? []).reduce((s, i) => s + i.amount, 0) + pendingItems.reduce((s, i) => s + i.amount, 0);

  return (
    <div className="tt-modalback" onClick={onClose}>
      <div
        className="tt-modal wide"
        role="dialog"
        aria-label={editing ? "Edit project" : "New project"}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tt-modalhead">{editing ? "Edit project" : "New project"}</div>

        {/* Two columns above ~658px of MODAL width, one below — driven by the modal's own width via
            minmax, not the viewport, because the rail changes the content area independently.
            At the 740px floor this always stacks. See the report's width table. */}
        <div className="tt-modalgrid">
          {/* ---------------- LEFT: CONTRACT / ASSIGNMENT (a contract is written first,
               then who it is with) ---------------- */}
          <div className="tt-mcol">
            <div className="tt-block">
              <div className="tt-blocktitle">Contract / Assignment</div>
              <label className="tt-field">
                <span>Project name</span>
                <input className="tt-input" value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <div className="tt-fieldrow">
                <label className="tt-field">
                  <span>Contracted agreed amount</span>
                  <div className="tt-prefixed"><span className="tt-prefix">$</span>
                    <input className="tt-input mono" inputMode="decimal" value={amount}
                      onChange={(e) => setAmount(e.target.value)} /></div>
                  <p className="tt-hint">What the client agreed to pay for this project.</p>
                </label>
                <label className="tt-field">
                  <span>Hire &amp; spend budget</span>
                  <div className="tt-prefixed"><span className="tt-prefix">$</span>
                    <input className="tt-input mono" inputMode="decimal" value={budget}
                      onChange={(e) => setBudget(e.target.value)} /></div>
                  <p className="tt-hint">What you plan to spend hiring and buying for this project.</p>
                </label>
              </div>

              {/* LIVE, and computed HERE rather than read straight off the service: buffered rows
                  on a new project are not in the database yet, and the figures have to move as the
                  user types or the readouts look broken. `spend.spent` is the saved half. */}
              <div className="tt-statgrid">
                <div className="tt-stat"><span className="k">Contracted</span>
                  <span className="v">{fmtMoney(num(amount) ?? 0)}</span></div>
                <div className="tt-stat"><span className="k">Spent so far</span>
                  <span className="v">{fmtMoney(liveSpent)}</span></div>
                <div className="tt-stat"><span className="k">Budget left</span>
                  <span className={"v" + ((num(budget) ?? 0) - liveSpent >= 0 ? " good" : " over")}>
                    {num(budget) == null ? "—" : fmtMoney((num(budget) ?? 0) - liveSpent)}
                  </span></div>
              </div>
              <p className="tt-hint">
                Spent = employee time and completions on this project plus the itemized rows below.
                Your own tracked time is not counted as spend.
              </p>

              {/* Contract file lives INSIDE this block, above Itemize, with a rule separating it
                  from the readouts above. */}
              <div className="tt-rule" />
              <div className="tt-field">
                <span>Contract file</span>
                <button className="tt-btn ghost sm tt-attach" onClick={pickContract}>
                  {contract ? contract.name : editing?.contract_file_path ? "Replace attached file…" : "Attach file…"}
                </button>
              </div>

              <div className="tt-blocksub">Itemize</div>
              {dataError ? (
                <div className="tt-error" role="alert">
                  <span className="tt-error-plain">Couldn&apos;t load this project&apos;s costs.</span>
                  <span className="tt-error-hint">Nothing is shown rather than an empty list.</span>
                </div>
              ) : projectId != null && items === null ? (
                <p className="tt-hint">Loading…</p>
              ) : (
                <>
                  <div className="tt-itemhead"><span>Qty</span><span>Description</span><span>Rate</span><span>Amount</span><span /></div>
                  {/* Saved rows — edit mode only, removable through the service. Legacy rows without
                      a stored rate DERIVE it as amount ÷ qty (the 08-06 ruling's read-side rule). */}
                  {(items ?? []).map((it) => (
                    <div key={it.id} className="tt-itemrow">
                      <span className="mono">{it.qty}</span>
                      <span>{it.description}</span>
                      <span className="mono dim">{fmtMoney(it.unit_rate ?? (it.qty > 0 ? it.amount / it.qty : it.amount))}</span>
                      <span className="mono">{fmtMoney(it.amount)}</span>
                      <button className="tt-itemx" aria-label={`Remove ${it.description}`}
                        onClick={() => void api.timetracker.financials.removeItem(it.id).then(loadFinancials)
                          .catch((e: unknown) => console.error("[timetracker] remove item failed:", e))}>✕</button>
                    </div>
                  ))}
                  {/* Buffered rows on a NEW project — identical to look at, removed from the buffer
                      rather than the database because they are not in it yet. */}
                  {pendingItems.map((it, i) => (
                    <div key={`pending-${i}`} className="tt-itemrow">
                      <span className="mono">{it.qty}</span>
                      <span>{it.description}</span>
                      <span className="mono dim">{fmtMoney(it.unitRate ?? (it.qty > 0 ? it.amount / it.qty : it.amount))}</span>
                      <span className="mono">{fmtMoney(it.amount)}</span>
                      <button className="tt-itemx" aria-label={`Remove ${it.description}`}
                        onClick={() => setPendingItems((prev) => prev.filter((_, j) => j !== i))}>✕</button>
                    </div>
                  ))}
                  <div className="tt-itemrow new">
                    <input className="tt-input mono" value={newItem.qty} aria-label="Quantity"
                      onChange={(e) => setNewItem({ ...newItem, qty: e.target.value })} />
                    <input className="tt-input" placeholder="Description" value={newItem.description}
                      onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(); } }} />
                    <div className="tt-prefixed"><span className="tt-prefix">$</span>
                      {/* Typing a rate fills Amount live (qty × rate); Amount stays editable and wins. */}
                      <input className="tt-input mono" inputMode="decimal" value={newItem.rate} aria-label="Unit rate"
                        onChange={(e) => {
                          const rate = e.target.value;
                          const q = num(newItem.qty) ?? 1;
                          const r = num(rate);
                          setNewItem({ ...newItem, rate, amount: r != null ? String(Math.round(q * r * 100) / 100) : newItem.amount });
                        }}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(); } }} /></div>
                    <div className="tt-prefixed"><span className="tt-prefix">$</span>
                      <input className="tt-input mono" inputMode="decimal" value={newItem.amount} aria-label="Amount"
                        onChange={(e) => setNewItem({ ...newItem, amount: e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(); } }} /></div>
                    <button className="tt-btn ghost sm" disabled={newItem.description.trim() === ""}
                      onClick={addItem} aria-label="Add row">＋</button>
                  </div>
                  <div className="tt-totline"><span>Itemized total</span><b>{fmtMoney(itemTotal)}</b></div>
                  {projectId == null && pendingItems.length > 0 && (
                    <p className="tt-hint">These rows are saved with the project when you press Add Project.</p>
                  )}
                </>
              )}
            </div>

          </div>
          {/* ---------------- RIGHT: CLIENT + GROUP + EMPLOYEES ---------------- */}
          <div className="tt-mcol">
            <div className="tt-block">
              <div className="tt-blocktitle">Client</div>
              <label className="tt-field">
                <span>Client</span>
                <input className="tt-input" value={clientName} autoFocus onChange={(e) => setClientName(e.target.value)} />
              </label>
              <label className="tt-field">
                <span>Company (optional)</span>
                <input className="tt-input" value={company} onChange={(e) => setCompany(e.target.value)} />
              </label>

              {!showAddr ? (
                <button className="tt-reveal" onClick={() => setShowAddr(true)}>＋ Add Address</button>
              ) : (
                <>
                  <label className="tt-field">
                    <span>Street address</span>
                    <input className="tt-input" value={street} onChange={(e) => setStreet(e.target.value)} />
                  </label>
                  <div className="tt-fieldrow">
                    <label className="tt-field"><span>City</span>
                      <input className="tt-input" value={city} onChange={(e) => setCity(e.target.value)} />
                    </label>
                    <label className="tt-field narrow"><span>State</span>
                      <input className="tt-input" maxLength={2} value={stateCode}
                        onChange={(e) => setStateCode(e.target.value.toUpperCase())} />
                    </label>
                    <label className="tt-field narrow"><span>Zip</span>
                      <input className="tt-input" value={zip} onChange={(e) => setZip(e.target.value)} />
                    </label>
                  </div>
                </>
              )}

              <label className="tt-field">
                <span>Contact email</span>
                <input className="tt-input" value={email ?? ""} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <div className="tt-fieldrow">
                <label className="tt-field">
                  <span>Phone</span>
                  <input className="tt-input" value={phone} placeholder="digits only — dashes add themselves"
                    onChange={(e) => setPhone(formatPhone(e.target.value))} />
                </label>
                <label className="tt-field narrow">
                  <span>Ext</span>
                  <input className="tt-input" value={ext} onChange={(e) => setExt(formatExt(e.target.value))} />
                </label>
              </div>
              <p className="tt-hint">Phone caps at ten digits; the extension field caps at six.</p>
            </div>

            <div className="tt-block">
              <div className="tt-blocktitle">
                Group
                <span className="tt-info" tabIndex={0}>
                  ⓘ
                  <span className="tt-infotip" role="tooltip">
                    A group collects related projects in the rail — a client with several shoots, or a
                    season. Projects keep their own timers and totals; the group is how they sit
                    together in the list.
                  </span>
                </span>
              </div>
              <label className="tt-field">
                <span>Group</span>
                <select className="tt-input" value={groupSel} onChange={(e) => setGroupSel(e.target.value)}>
                  <option value="">Ungrouped</option>
                  {groups.map((g) => (
                    <option key={g.id} value={String(g.id)}>{g.icon ? `${g.icon} ` : ""}{g.name}</option>
                  ))}
                  <option value={NEW_GROUP}>＋ Create group…</option>
                </select>
              </label>
              {groupSel === NEW_GROUP && (
                <>
                  <div className="tt-field">
                    <span>New group name</span>
                    {/* An explicit accept, so it is obvious the name registered. The group is still
                        CREATED with the project (one write, one transaction) — this only confirms
                        the name is taken and locks in the icon. */}
                    <div className="tt-inline">
                      <input className="tt-input" value={newGroupName} disabled={groupAccepted}
                        onChange={(e) => setNewGroupName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); acceptGroup(); } }} />
                      {groupAccepted ? (
                        <button className="tt-btn ghost sm" onClick={() => setGroupAccepted(false)}>Edit</button>
                      ) : (
                        <button className="tt-btn sm" disabled={newGroupName.trim() === ""} onClick={acceptGroup}>
                          Enter
                        </button>
                      )}
                    </div>
                    {groupAccepted && (
                      <p className="tt-ok">✓ Group “{newGroupName.trim()}” will be created with this project.</p>
                    )}
                  </div>
                  <div className="tt-field">
                    <span>Icon</span>
                    <div className="tt-iconrow">
                      {GROUP_ICONS.map((ic) => {
                        const auto = groupIcon === "" && newGroupName.trim() !== "" && autoIcon(newGroupName.trim()) === ic;
                        return (
                          <button key={ic} type="button"
                            className={"tt-icon" + (groupIcon === ic || auto ? " on" : "")}
                            aria-pressed={groupIcon === ic || auto}
                            onClick={() => setGroupIcon(ic)}>{ic}</button>
                        );
                      })}
                    </div>
                    <p className="tt-hint">
                      The group assigns its own icon automatically — pick a different one here if you
                      want, or change it later in Settings. Project colour is unchanged and still set
                      from the project card.
                    </p>
                  </div>
                </>
              )}
              <div className="tt-field">
                <span>Status</span>
                <div className="tt-statuspill" role="radiogroup" aria-label="Status">
                  <button type="button" role="radio" aria-checked={status === "active"}
                    className={"tt-pillbtn" + (status === "active" ? " on" : "")}
                    onClick={() => setStatus("active")}>Active</button>
                  <button type="button" role="radio" aria-checked={status === "parked"}
                    className={"tt-pillbtn" + (status === "parked" ? " on" : "")}
                    onClick={() => setStatus("parked")}>Pause</button>
                </div>
                {status === "done" && (
                  <p className="tt-hint">
                    This project is marked Done. Choosing Active or Pause above will change that.
                  </p>
                )}
              </div>
            </div>
            <div className={"tt-block" + (glowStaff ? " tt-glow" : "")}>
              <div className="tt-blocktitle">Employees on this project</div>
              {dataError ? (
                <div className="tt-error" role="alert">
                  <span className="tt-error-plain">Couldn&apos;t load the project team.</span>
                </div>
              ) : projectId != null && members === null ? (
                <p className="tt-hint">Loading…</p>
              ) : (
                <>
                  {(members ?? []).length === 0 && pendingMembers.length === 0 && (
                    <p className="tt-hint">Nobody is on this project yet.</p>
                  )}
                  {(members ?? []).map((m) => (
                    <div key={m.id} className="tt-emprow">
                      <div className="who">
                        <b>{m.person_name ?? "(removed person)"}</b>
                        <div className="r">{m.person_role ?? "No role set"}</div>
                      </div>
                      <div className="pay">
                        {m.default_rate != null
                          ? `${fmtMoney(m.default_rate)} / ${m.default_pay_type ?? "hour"}`
                          : "No rate set"}
                      </div>
                      <button className="tt-itemx" aria-label={`Remove ${m.person_name ?? "person"}`}
                        onClick={() => projectId != null && void api.timetracker.financials
                          .removeMember(projectId, m.person_id).then(loadFinancials)
                          .catch((e: unknown) => console.error("[timetracker] remove member failed:", e))}>✕</button>
                    </div>
                  ))}
                  {/* Buffered on a NEW project — flushed straight after create returns the id. */}
                  {pendingMembers.map((pid) => {
                    const person = people.find((x) => x.id === pid);
                    return (
                      <div key={`pending-${pid}`} className="tt-emprow">
                        <div className="who">
                          <b>{person?.name ?? "Selected person"}</b>
                          <div className="r">{person?.role ?? "No role set"}</div>
                        </div>
                        <div className="pay">
                          {person?.default_rate != null
                            ? `${fmtMoney(person.default_rate)} / ${person.default_pay_type ?? "hour"}`
                            : "No rate set"}
                        </div>
                        <button className="tt-itemx" aria-label={`Remove ${person?.name ?? "person"}`}
                          onClick={() => setPendingMembers((prev) => prev.filter((x) => x !== pid))}>✕</button>
                      </div>
                    );
                  })}
                  <div className="tt-addemp">
                    {/* The select lists people who ALREADY EXIST. With none on file it is disabled
                        and says so, rather than offering an empty menu that looks broken. Creating
                        someone is the button beside it — a separate action, not a menu entry. */}
                    <select className="tt-input" value={memberSel} disabled={people.length === 0}
                      onChange={(e) => setMemberSel(e.target.value)}>
                      <option value="">
                        {people.length === 0 ? "Add an employee first" : "Add an employee…"}
                      </option>
                      {people
                        .filter((p) => !(members ?? []).some((m) => m.person_id === p.id))
                        .filter((p) => !pendingMembers.includes(p.id))
                        .map((p) => (
                          <option key={p.id} value={String(p.id)}>{p.name}</option>
                        ))}
                    </select>
                    <button className="tt-btn ghost sm" disabled={memberSel === ""}
                      onClick={() => {
                        const pid = Number(memberSel);
                        if (projectId == null) {
                          setPendingMembers((prev) => [...prev, pid]);
                          setMemberSel("");
                          return;
                        }
                        void api.timetracker.financials.addMember(projectId, pid)
                          .then(() => { setMemberSel(""); loadFinancials(); })
                          .catch((e: unknown) => console.error("[timetracker] add member failed:", e));
                      }}>Add</button>
                    {/* Opens the Employees create form LAYERED OVER this modal. Deliberately NOT a
                        navigation: switching modules would unmount this form and lose everything
                        typed into it. The new person lands in the list below without leaving. */}
                    {/* Filled when there is nobody to pick — with an empty roster this IS the
                        only way forward, so it should not look like a secondary action. */}
                    <button className={"tt-btn sm" + (people.length === 0 ? " start" : " ghost")}
                      onClick={() => setCreatingPerson(true)}>
                      ＋ Add Employee
                    </button>
                  </div>
                  {projectId == null && pendingMembers.length > 0 && (
                    <p className="tt-hint">Added to the project when you press Add Project.</p>
                  )}
                </>
              )}
            </div>
          </div>

        </div>

        {/* Description sits below the grid with real air above it — it was crowding the GROUP
            block's lower edge. Contract file moved INTO Contract / Assignment, above Itemize. */}
        {/* Description commits on [+ Add Entry] rather than simply being whatever is in the box
            when the project saves. The draft is separate from the committed value, so it is always
            clear which text is actually going to be stored. */}
        <div className="tt-field tt-descfield">
          <span>Description</span>
          <textarea className="tt-input tt-textarea" value={descDraft}
            onChange={(e) => setDescDraft(e.target.value)} />
          <div className="tt-inline">
            {/* D12 (08-06): the old gate ALSO disabled on an empty draft, so an emptied
                description could never be committed — Save then silently kept the previous text.
                Emptiness is a legal value; only "no change" disables. The label says which act
                this press is. */}
            <button className="tt-btn sm" disabled={descDraft === description}
              onClick={() => setDescription(descDraft)}>
              {descDraft.trim() === "" && description.trim() !== "" ? "Clear entry" : "＋ Add Entry"}
            </button>
            {description.trim() !== "" && descDraft === description && (
              <span className="tt-ok">✓ Saved with the project.</span>
            )}
            {description.trim() !== "" && descDraft !== description && (
              <span className="tt-hint">Unsaved changes — press Add Entry to keep them.</span>
            )}
          </div>
        </div>

        {/* Its own full-width block — wraps to as many lines as the sentence needs, never truncates. */}
        {error && (
          <div className="tt-error" role="alert">
            <span className="tt-error-plain">{error.plain}</span>
            {error.hint && <span className="tt-error-hint">{error.hint}</span>}
          </div>
        )}

        {/* Post-create: staff it now, or finish. */}
        {askStaff && (
          <div className="tt-modalback" onClick={() => onSaved(askStaff)}>
            <div className="tt-modal mini" role="dialog" aria-label="Add an employee?"
              onClick={(e) => e.stopPropagation()}>
              <div className="tt-modalhead">Project created</div>
              <p className="tt-hint" style={{ fontSize: "12.5px" }}>
                Do you want to add an employee to this project?
              </p>
              <div className="tt-modalacts">
                <button className="tt-btn start" onClick={() => {
                  // Stay in this modal and point at the block, rather than navigating away.
                  setAskStaff(null);
                  setGlowStaff(true);
                  window.setTimeout(() => setGlowStaff(false), 4000);
                }}>＋ Add Employee</button>
                <button className="tt-btn" onClick={() => onSaved(askStaff)}>Save Project</button>
              </div>
            </div>
          </div>
        )}

        {/* The Employees create form, layered on top. Nothing here unmounts, so every field the
            user has already filled in survives. */}
        {creatingPerson && (
          <PersonModal
            state={{ mode: "new", project: null }}
            projects={allProjects}
            onClose={() => setCreatingPerson(false)}
            onSaved={(person) => {
              setCreatingPerson(false);
              // Refresh the roster source and preselect the person just created.
              void api.employees.people
                .list()
                .then((rows) => {
                  setPeople(rows);
                  setMemberSel(String(person.id));
                })
                .catch(() => setPeople((prev) => [...prev, person]));
            }}
          />
        )}

        {/* NATIVE three-button row (ruling 6). The Employees portal wrapper is retired. */}
        <div className="tt-modalacts">
          <button className="tt-btn ghost" onClick={onClose}>Cancel</button>
          <button className="tt-btn start" disabled={saving || name.trim() === "" || clientName.trim() === ""}
            onClick={() => submit("close")}>
            {saving ? "Saving…" : editing ? "Save changes" : "Add Project"}
          </button>
          {onSavedCreateEmployee && !editing && (
            <button className="tt-btn start" disabled={saving || name.trim() === "" || clientName.trim() === ""}
              onClick={() => submit("employee")}>
              Add Project + Create Employee
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
