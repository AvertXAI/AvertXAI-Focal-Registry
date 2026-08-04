/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// New/edit person, and the archive confirmation — two small dialogs that share one frame, one error
// idiom and one file. Both mirror TimeTracker's ProjectModal (committed 470a5cd): content-area
// overlay, opaque theme surface, NO native-overlay dim (the recurring §3.4 defect), raw error text
// to the console and a plain sentence to the banner.
//
// THE FORM OFFERS EXACTLY THE SIX FIELDS EmployeePersonInput CARRIES (src/shared/types.ts:746-753).
// The 3-options mockup draws Address, Started, Status and Group on the person's Details panel —
// NONE of those columns exist on employee_people, so they are deliberately not drawn here. Adding a
// field to this form without a column behind it would fake a record the database cannot keep.
import { useState } from "react";
import type { EmployeePerson, EmployeePersonInput } from "../../shared/types";
import { explainEmployeesError, type EmployeesErrorExplanation } from "./empErrors";

export type PersonModalState = { mode: "new" } | { mode: "edit"; person: EmployeePerson } | null;

interface Props {
  state: Exclude<PersonModalState, null>;
  onClose: () => void;
  onSaved: (p: EmployeePerson) => void;
}

export default function PersonModal({ state, onClose, onSaved }: Props) {
  const api = window.api;
  const editing = state.mode === "edit" ? state.person : null;

  const [name, setName] = useState(editing?.name ?? "");
  const [email, setEmail] = useState(editing?.email ?? "");
  const [phone, setPhone] = useState(editing?.phone ?? "");
  const [role, setRole] = useState(editing?.role ?? "");
  const [rate, setRate] = useState(editing?.default_rate != null ? String(editing.default_rate) : "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [error, setError] = useState<EmployeesErrorExplanation | null>(null);
  const [saving, setSaving] = useState(false);

  /** Blank → null (the services collapse blanks anyway); a bad number → null, never NaN into IPC. */
  const nullable = (s: string): string | null => (s.trim() === "" ? null : s);
  const rateValue = (): number | null => {
    const n = Number(rate);
    return rate.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : null;
  };
  /** A typed rate that isn't a usable number is a mistake worth naming, not silently dropping. */
  const rateInvalid = rate.trim() !== "" && rateValue() === null;

  const submit = (): void => {
    if (saving) return;
    const input: EmployeePersonInput = {
      name,
      email: nullable(email),
      phone: nullable(phone),
      role: nullable(role),
      defaultRate: rateValue(),
      notes: nullable(notes),
    };
    setSaving(true);
    setError(null);
    const op = editing ? api.employees.people.update(editing.id, input) : api.employees.people.create(input);
    void op.then(onSaved).catch((e: unknown) => {
      setSaving(false);
      const raw = e instanceof Error ? e.message : String(e);
      // RAW text to the console ONLY — the dialog gets a sentence. The Free-tier cap refusal lands
      // here and passes through the classifier untouched, because it is already a plain sentence.
      console.error("[employees] person save failed:", raw);
      setError(explainEmployeesError(raw, editing ? "this person" : "this new person"));
    });
  };

  return (
    <div className="emp-modalback" onClick={onClose}>
      <div
        className="emp-modal"
        role="dialog"
        aria-label={editing ? "Edit person" : "New employee"}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="emp-modalhead">{editing ? `Edit ${editing.name}` : "New employee"}</div>

        <label className="emp-field">
          <span>Full name</span>
          <input className="emp-input" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="emp-fieldrow">
          <label className="emp-field">
            <span>Email</span>
            <input className="emp-input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="emp-field">
            <span>Phone</span>
            <input className="emp-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
        </div>
        <div className="emp-fieldrow">
          <label className="emp-field">
            <span>Role</span>
            <input
              className="emp-input"
              value={role}
              placeholder="Retoucher, second shooter…"
              onChange={(e) => setRole(e.target.value)}
            />
          </label>
          <label className="emp-field">
            <span>Default rate ($ / hour)</span>
            <input
              className="emp-input"
              inputMode="decimal"
              value={rate}
              placeholder="optional"
              onChange={(e) => setRate(e.target.value)}
            />
            {/* Says plainly what this column is for, because the name invites the wrong assumption. */}
            <em className="emp-hint">Prefills the Add Time form. Each entry keeps its own rate, so
              changing this never alters time already logged.</em>
          </label>
        </div>
        <label className="emp-field">
          <span>Notes</span>
          <textarea className="emp-input emp-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        {rateInvalid && (
          <div className="emp-error" role="alert">
            <span className="emp-error-plain">The default rate needs to be a number of zero or more.</span>
            <span className="emp-error-hint">Clear the field to leave it unset.</span>
          </div>
        )}
        {error && (
          <div className="emp-error" role="alert">
            <span className="emp-error-plain">{error.plain}</span>
            {error.hint && <span className="emp-error-hint">{error.hint}</span>}
          </div>
        )}

        <div className="emp-modalacts">
          <button className="emp-btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="emp-btn primary" disabled={saving || name.trim() === "" || rateInvalid} onClick={submit}>
            {saving ? "Saving…" : editing ? "Save changes" : "Add employee"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Archive confirmation. The REASON IS REQUIRED at the form level — the bridge types it as a plain
 * `string` (types.ts:1233) and the service accepts a blank one (people.ts collapses it to null), so
 * the requirement is enforced here or nowhere. Archiving is how a Free-tier slot is freed, so the
 * reason is the only record of why someone left the roster.
 */
export function ArchiveModal({
  person,
  onClose,
  onArchived,
}: {
  person: EmployeePerson;
  onClose: () => void;
  onArchived: (p: EmployeePerson) => void;
}) {
  const api = window.api;
  const [reason, setReason] = useState("");
  const [error, setError] = useState<EmployeesErrorExplanation | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = (): void => {
    if (saving || reason.trim() === "") return;
    setSaving(true);
    setError(null);
    void api.employees.people
      .archive(person.id, reason.trim())
      .then(onArchived)
      .catch((e: unknown) => {
        setSaving(false);
        const raw = e instanceof Error ? e.message : String(e);
        console.error("[employees] archive failed:", raw);
        setError(explainEmployeesError(raw, "this change"));
      });
  };

  return (
    <div className="emp-modalback" onClick={onClose}>
      <div className="emp-modal narrow" role="dialog" aria-label="Archive person" onClick={(e) => e.stopPropagation()}>
        <div className="emp-modalhead">Archive {person.name}</div>
        <p className="emp-modaldesc">
          They leave the active roster. Every entry, payment and adjustment stays exactly as it is,
          and any outstanding balance is still owed. You can restore them at any time.
        </p>
        <label className="emp-field">
          <span>Reason</span>
          <input
            className="emp-input"
            value={reason}
            autoFocus
            placeholder="Season finished, contract ended…"
            onChange={(e) => setReason(e.target.value)}
          />
        </label>

        {error && (
          <div className="emp-error" role="alert">
            <span className="emp-error-plain">{error.plain}</span>
            {error.hint && <span className="emp-error-hint">{error.hint}</span>}
          </div>
        )}

        <div className="emp-modalacts">
          <button className="emp-btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="emp-btn primary" disabled={saving || reason.trim() === ""} onClick={submit}>
            {saving ? "Archiving…" : "Archive"}
          </button>
        </div>
      </div>
    </div>
  );
}
