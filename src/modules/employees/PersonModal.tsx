/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Create Employee / Edit Employee, and the archive confirmation.
//
// Built to MOCKUP-employees-3b2-wizard-v5-08-03-2026.html scenes 3 (create) and 6 (edit).
// Content-area overlay, opaque theme surface, NO native-overlay dim (the recurring §3.4 defect).
// Raw error text to the console, a plain sentence to the banner (the ttErrors idiom).
//
// The form now offers every column employee_people carries after the 3B.2-A delta — including the
// seven added 2026-08-04. Address is a REVEAL: an address is optional and most people will not have
// one to hand, so it stays behind [+ Add Address] rather than padding the form with four empty
// boxes. Social security is stored PLAIN by ruling; it shows while focused and masks on blur.
import { useEffect, useState } from "react";
import type {
  EmployeePayType,
  EmployeePerson,
  EmployeePersonInput,
  TimeTrackerProjectListItem,
} from "../../shared/types";
import { explainEmployeesError, type EmployeesErrorExplanation } from "./empErrors";
import { PAY_TYPE_PILLS, US_STATES, formatPhone, formatSsn, maskSsn, normalizeMoney, rateSuffix } from "./format";
import WorkHistory from "./WorkHistory";

export type PersonModalState =
  | { mode: "new"; project: TimeTrackerProjectListItem | null }
  | { mode: "edit"; person: EmployeePerson }
  | null;

interface Props {
  state: Exclude<PersonModalState, null>;
  projects: TimeTrackerProjectListItem[];
  onClose: () => void;
  /** `addTime` is true when the user pressed "Add Employee + Add Time". */
  onSaved: (p: EmployeePerson, addTime: boolean) => void;
}

type Tab = "details" | "history";

export default function PersonModal({ state, projects, onClose, onSaved }: Props) {
  const api = window.api;
  const editing = state.mode === "edit" ? state.person : null;
  const seedProject = state.mode === "new" ? state.project : null;

  const [tab, setTab] = useState<Tab>("details");
  const [name, setName] = useState(editing?.name ?? "");
  const [email, setEmail] = useState(editing?.email ?? "");
  const [phone, setPhone] = useState(formatPhone(editing?.phone ?? ""));
  const [role, setRole] = useState(editing?.role ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  // Address — revealed on demand, but auto-open when editing someone who already has one.
  const [showAddr, setShowAddr] = useState(
    Boolean(editing?.street_address || editing?.city || editing?.state || editing?.zip)
  );
  const [street, setStreet] = useState(editing?.street_address ?? "");
  const [city, setCity] = useState(editing?.city ?? "");
  const [stateCode, setStateCode] = useState(editing?.state ?? "");
  const [zip, setZip] = useState(editing?.zip ?? "");
  // Social security — `ssn` is the real value; `ssnFocused` decides whether it or the mask shows.
  const [ssn, setSsn] = useState(editing?.ssn ?? "");
  const [ssnFocused, setSsnFocused] = useState(false);
  const [payType, setPayType] = useState<EmployeePayType>(editing?.default_pay_type ?? "hourly");
  const [rate, setRate] = useState(editing?.default_rate != null ? String(editing.default_rate) : "");
  // Employee Profile (08-06, "same for employee") — the two fields that had no home. Everything
  // else the profile shows already lives on the person row; nothing is duplicated.
  const [paymentMethod, setPaymentMethod] = useState(editing?.payment_method ?? "");
  const [employmentType, setEmploymentType] = useState<"" | "employee" | "contractor">(
    editing?.employment_type ?? ""
  );
  const [projectSel, setProjectSel] = useState(
    String(editing?.default_project_id ?? seedProject?.id ?? "")
  );
  const [error, setError] = useState<EmployeesErrorExplanation | null>(null);
  const [saving, setSaving] = useState(false);

  // A project created by the wizard a moment ago may not have been in `projects` when this mounted.
  useEffect(() => {
    if (seedProject && projectSel === "") setProjectSel(String(seedProject.id));
  }, [seedProject]); // eslint-disable-line react-hooks/exhaustive-deps

  const nullable = (s: string): string | null => (s.trim() === "" ? null : s);
  const rateValue = (): number | null => {
    const n = Number(rate);
    return rate.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : null;
  };
  const rateInvalid = rate.trim() !== "" && rateValue() === null;
  const project = projects.find((p) => String(p.id) === projectSel) ?? null;

  const submit = (addTime: boolean): void => {
    if (saving) return;
    const input: EmployeePersonInput = {
      name,
      email: nullable(email),
      phone: nullable(phone),
      role: nullable(role),
      defaultRate: rateValue(),
      notes: nullable(notes),
      streetAddress: nullable(street),
      city: nullable(city),
      state: nullable(stateCode),
      zip: nullable(zip),
      ssn: nullable(ssn),
      defaultPayType: payType,
      defaultProjectId: project?.id ?? null,
      // Denormalized beside the id so the row stays readable if that project is ever purged.
      defaultProjectName: project?.name ?? null,
      paymentMethod: nullable(paymentMethod),
      employmentType: employmentType === "" ? null : employmentType,
    };
    setSaving(true);
    setError(null);
    const op = editing ? api.employees.people.update(editing.id, input) : api.employees.people.create(input);
    void op
      .then((p) => onSaved(p, addTime))
      .catch((e: unknown) => {
        setSaving(false);
        const raw = e instanceof Error ? e.message : String(e);
        // RAW to the console ONLY. The Free-tier cap refusal lands here and passes through the
        // classifier untouched, because it is already a plain sentence.
        console.error("[employees] person save failed:", raw);
        setError(explainEmployeesError(raw, editing ? "this person" : "this new person"));
      });
  };

  const disabled = saving || name.trim() === "" || rateInvalid;

  return (
    <div className="emp-modalback" onClick={onClose}>
      <div
        className="emp-modal wide"
        role="dialog"
        aria-label={editing ? "Edit employee" : "Create employee"}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="emp-modalhead">{editing ? "Edit Employee" : "Create Employee"}</div>

        {/* Two tabs on EDIT only — there is no history to show for someone who does not exist yet.
            House boxed-tab standard, the same shape as the module's own strip. */}
        {editing && (
          <div className="emp-tabs modal" role="tablist" aria-label="Employee views">
            <button
              className={"emp-tab" + (tab === "details" ? " on" : "")}
              role="tab"
              aria-selected={tab === "details"}
              onClick={() => setTab("details")}
            >
              Employee Details
            </button>
            <button
              className={"emp-tab" + (tab === "history" ? " on" : "")}
              role="tab"
              aria-selected={tab === "history"}
              onClick={() => setTab("history")}
            >
              Work History
            </button>
          </div>
        )}

        {editing && tab === "history" ? (
          <>
            <WorkHistory person={editing} />
            <div className="emp-modalacts">
              <button className="emp-btn ghost" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="emp-field">
              <span>Full name</span>
              <input className="emp-input" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
            </label>

            {!showAddr ? (
              <div className="emp-field">
                <button className="emp-reveal" onClick={() => setShowAddr(true)}>
                  ＋ Add Address
                </button>
              </div>
            ) : (
              <>
                <label className="emp-field">
                  <span>Street address</span>
                  <input className="emp-input" value={street} onChange={(e) => setStreet(e.target.value)} />
                </label>
                <div className="emp-fieldrow">
                  <label className="emp-field">
                    <span>City</span>
                    <input className="emp-input" value={city} onChange={(e) => setCity(e.target.value)} />
                  </label>
                  <label className="emp-field narrow">
                    <span>State</span>
                    <select className="emp-input" value={stateCode} onChange={(e) => setStateCode(e.target.value)}>
                      <option value="">—</option>
                      {US_STATES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="emp-field narrow">
                    <span>Zip</span>
                    <input className="emp-input mono" value={zip} onChange={(e) => setZip(e.target.value)} />
                  </label>
                </div>
              </>
            )}

            <div className="emp-fieldrow">
              <label className="emp-field">
                <span>Contact email</span>
                <input className="emp-input" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label className="emp-field">
                <span>Phone</span>
                <input
                  className="emp-input mono"
                  value={phone}
                  placeholder="digits only — dashes add themselves"
                  onChange={(e) => setPhone(formatPhone(e.target.value))}
                />
              </label>
            </div>

            <label className="emp-field">
              <span>Role</span>
              <input
                className="emp-input"
                value={role}
                placeholder="Photographer 2, Second Shooter, Carpenter, Painter…"
                onChange={(e) => setRole(e.target.value)}
              />
            </label>

            {/* Directly under Role, as drawn. A soft reference: if that project is later purged the
                id resolves to nothing, which is why the name is stored beside it. */}
            <label className="emp-field">
              <span>Project</span>
              <select className="emp-input" value={projectSel} onChange={(e) => setProjectSel(e.target.value)}>
                <option value="">No default project</option>
                {projects.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name}
                  </option>
                ))}
              </select>
              <em className="emp-hint">
                {seedProject
                  ? "The project just created is selected — switch any time."
                  : "Sets the starting project on this person's Add Time form."}
              </em>
            </label>

            <div className="emp-fieldrow">
              <div className="emp-field">
                <span>Default rate (${rateSuffix(payType)})</span>
                <div className="emp-rateline">
                  <div className="emp-prefixed">
                    <span className="emp-prefix">$</span>
                    <input
                      className="emp-input mono"
                      inputMode="decimal"
                      value={rate}
                      onChange={(e) => setRate(e.target.value)}
                      onBlur={() => setRate(normalizeMoney(rate))}
                    />
                  </div>
                  {/* Joined pill, sized to its words, ALWAYS active — no checkbox (ruled). */}
                  <div className="emp-pillset" role="radiogroup" aria-label="Default pay type">
                    {PAY_TYPE_PILLS.map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        role="radio"
                        aria-checked={payType === key}
                        className={"emp-pillbtn" + (payType === key ? " on" : "")}
                        onClick={() => setPayType(key)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <em className="emp-hint">
                  Prefills the Add Time form. Each entry keeps its own rate, so changing this never
                  alters time already logged.
                </em>
              </div>
              <label className="emp-field">
                <span>Social security</span>
                <input
                  /* emp-ssn enlarges the mask glyphs only — plain-on-focus behaviour is unchanged. */
                  className={"emp-input mono emp-ssn" + (ssnFocused ? "" : " masked")}
                  value={ssnFocused ? ssn : maskSsn(ssn)}
                  onFocus={() => setSsnFocused(true)}
                  onBlur={() => setSsnFocused(false)}
                  onChange={(e) => setSsn(formatSsn(e.target.value))}
                />
                <em className="emp-hint">Plain while editing, masked when you leave the field.</em>
              </label>
            </div>

            {/* EMPLOYEE PROFILE (08-06): a labelled block so everything about paying this person
                reads in one place. Only these two fields are NEW columns — the rest of the person's
                profile is the fields above. 1099 output is NOT built on this (CANON-UPDATES). */}
            <div className="emp-profileblock">
              <div className="emp-profiletitle">Employee Profile</div>
              <div className="emp-fieldrow">
                <label className="emp-field">
                  <span>Payment method</span>
                  <input
                    className="emp-input"
                    placeholder="Zelle, Venmo, check payable-to…"
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                  />
                </label>
                <label className="emp-field narrow">
                  <span>Employment type</span>
                  <select
                    className="emp-input"
                    value={employmentType}
                    onChange={(e) => setEmploymentType(e.target.value as "" | "employee" | "contractor")}
                  >
                    <option value="">— unset —</option>
                    <option value="employee">Employee</option>
                    <option value="contractor">Contractor</option>
                  </select>
                </label>
              </div>
              <em className="emp-hint">How this person gets paid, and what they are to the business.</em>
            </div>

            <label className="emp-field">
              <span>Notes</span>
              <textarea
                className="emp-input emp-textarea"
                value={notes}
                placeholder="optional…"
                onChange={(e) => setNotes(e.target.value)}
              />
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
              <button className="emp-btn" disabled={disabled} onClick={() => submit(false)}>
                {saving ? "Saving…" : editing ? "Save changes" : "Add Employee"}
              </button>
              {!editing && (
                <button className="emp-btn primary" disabled={disabled} onClick={() => submit(true)}>
                  Add Employee + Add Time
                </button>
              )}
            </div>
          </>
        )}
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
