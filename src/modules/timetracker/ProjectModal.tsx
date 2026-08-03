/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// TimeTracker new/edit project modal — client + contact, rate type (hourly rate, or contract with
// paid/donated kind, amount / donated-hours goal, description, contract file), group (existing or
// inline new), colour, status. Submits through timetracker:createProject / updateProject, whose
// main-side validators are the trust boundary — this form only keeps the obvious guards local.
// Content-area modal: opaque theme surface, NO native-overlay dim (the recurring §3.4 defect).
import { useState } from "react";
import { explainTimeTrackerError, type TimeTrackerErrorExplanation } from "./ttErrors";
import type {
  TimeTrackerContractKind,
  TimeTrackerGroup,
  TimeTrackerNewProjectInput,
  TimeTrackerProjectListItem,
  TimeTrackerProjectStatus,
  TimeTrackerRateType,
} from "../../shared/types";

export type ModalState = { mode: "new" } | { mode: "edit"; project: TimeTrackerProjectListItem } | null;

interface Props {
  state: Exclude<ModalState, null>;
  groups: TimeTrackerGroup[];
  onClose: () => void;
  onSaved: (p: TimeTrackerProjectListItem) => void;
}

const NEW_GROUP = "__new__";
const DEFAULT_COLOR = "#2f6df6";

export default function ProjectModal({ state, groups, onClose, onSaved }: Props) {
  const api = window.api;
  const editing = state.mode === "edit" ? state.project : null;

  const [name, setName] = useState(editing?.name ?? "");
  const [clientName, setClientName] = useState(editing?.client_name ?? "");
  const [phone, setPhone] = useState(editing?.contact_phone ?? "");
  const [email, setEmail] = useState(editing?.email ?? "");
  const [rateType, setRateType] = useState<TimeTrackerRateType>(editing?.rate_type ?? "hourly");
  const [hourlyRate, setHourlyRate] = useState(editing?.hourly_rate != null ? String(editing.hourly_rate) : "");
  const [kind, setKind] = useState<TimeTrackerContractKind>(editing?.contract_kind ?? "paid");
  const [amount, setAmount] = useState(editing?.contract_amount != null ? String(editing.contract_amount) : "");
  const [targetHours, setTargetHours] = useState(editing?.target_hours != null ? String(editing.target_hours) : "");
  const [description, setDescription] = useState(editing?.contract_description ?? "");
  const [contract, setContract] = useState<{ path: string; name: string } | null>(null);
  const [groupSel, setGroupSel] = useState<string>(editing?.group_id != null ? String(editing.group_id) : "");
  const [newGroupName, setNewGroupName] = useState("");
  const [color, setColor] = useState(editing?.color ?? DEFAULT_COLOR);
  const [status, setStatus] = useState<TimeTrackerProjectStatus>(editing?.status ?? "active");
  const [error, setError] = useState<TimeTrackerErrorExplanation | null>(null);
  const [saving, setSaving] = useState(false);

  const num = (s: string): number | null => {
    const n = Number(s);
    return s.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : null;
  };

  const submit = (): void => {
    if (saving) return;
    const input: TimeTrackerNewProjectInput = {
      name,
      clientName,
      contactPhone: phone,
      email,
      rateType,
      hourlyRate: rateType === "hourly" ? num(hourlyRate) : null,
      color,
      status,
      groupId: groupSel !== "" && groupSel !== NEW_GROUP ? Number(groupSel) : null,
      newGroupName: groupSel === NEW_GROUP ? newGroupName.trim() || null : null,
      newGroupColor: null,
      contractAmount: rateType === "contract" && kind === "paid" ? num(amount) : null,
      contractDescription: rateType === "contract" ? description : "",
      contractSourcePath: contract?.path ?? null,
      contractKind: rateType === "contract" ? kind : null,
      targetHours: rateType === "contract" && kind === "donated" ? num(targetHours) : null,
    };
    setSaving(true);
    setError(null);
    const op = editing
      ? api.timetracker.projects.update({ ...input, id: editing.id })
      : api.timetracker.projects.create(input);
    void op.then(onSaved).catch((e: unknown) => {
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

  return (
    <div className="tt-modalback" onClick={onClose}>
      <div className="tt-modal" role="dialog" aria-label={editing ? "Edit project" : "New project"} onClick={(e) => e.stopPropagation()}>
        <div className="tt-modalhead">{editing ? "Edit project" : "New project"}</div>

        <label className="tt-field">
          <span>Project name</span>
          <input className="tt-input" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="tt-fieldrow">
          <label className="tt-field">
            <span>Client</span>
            <input className="tt-input" value={clientName} onChange={(e) => setClientName(e.target.value)} />
          </label>
          <label className="tt-field">
            <span>Phone</span>
            <input className="tt-input" value={phone ?? ""} onChange={(e) => setPhone(e.target.value)} />
          </label>
        </div>
        <label className="tt-field">
          <span>Email</span>
          <input className="tt-input" value={email ?? ""} onChange={(e) => setEmail(e.target.value)} />
        </label>

        <div className="tt-fieldrow">
          <label className="tt-field">
            <span>Rate type</span>
            <select className="tt-input" value={rateType} onChange={(e) => setRateType(e.target.value as TimeTrackerRateType)}>
              <option value="hourly">Hourly</option>
              <option value="contract">Contract</option>
            </select>
          </label>
          {rateType === "hourly" ? (
            <label className="tt-field">
              <span>Hourly rate ($)</span>
              <input className="tt-input" inputMode="decimal" value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} />
            </label>
          ) : (
            <label className="tt-field">
              <span>Contract kind</span>
              <select className="tt-input" value={kind} onChange={(e) => setKind(e.target.value as TimeTrackerContractKind)}>
                <option value="paid">Paid</option>
                <option value="donated">Donated</option>
              </select>
            </label>
          )}
        </div>

        {rateType === "contract" && (
          <>
            <div className="tt-fieldrow">
              {kind === "paid" ? (
                <label className="tt-field">
                  <span>Contract amount ($)</span>
                  <input className="tt-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </label>
              ) : (
                <label className="tt-field">
                  <span>Donated-hours goal</span>
                  <input className="tt-input" inputMode="decimal" value={targetHours} onChange={(e) => setTargetHours(e.target.value)} />
                </label>
              )}
              <div className="tt-field">
                <span>Contract file</span>
                <button className="tt-btn ghost tt-attach" onClick={pickContract}>
                  {contract ? contract.name : editing?.contract_file_path ? "Replace attached file…" : "Attach file…"}
                </button>
              </div>
            </div>
            <label className="tt-field">
              <span>Description</span>
              <textarea className="tt-input tt-textarea" value={description ?? ""} onChange={(e) => setDescription(e.target.value)} />
            </label>
          </>
        )}

        <div className="tt-fieldrow">
          <label className="tt-field">
            <span>Group</span>
            <select className="tt-input" value={groupSel} onChange={(e) => setGroupSel(e.target.value)}>
              <option value="">Ungrouped</option>
              {groups.map((g) => (
                <option key={g.id} value={String(g.id)}>{g.name}</option>
              ))}
              <option value={NEW_GROUP}>— New group…</option>
            </select>
          </label>
          <label className="tt-field">
            <span>Status</span>
            <select className="tt-input" value={status} onChange={(e) => setStatus(e.target.value as TimeTrackerProjectStatus)}>
              <option value="active">Active</option>
              <option value="parked">Parked</option>
              <option value="done">Done</option>
            </select>
          </label>
        </div>
        {groupSel === NEW_GROUP && (
          <label className="tt-field">
            <span>New group name</span>
            <input className="tt-input" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} />
          </label>
        )}

        <div className="tt-colorrow">
          <span className="tt-infolabel">Color</span>
          {["#2f6df6", "#3b82f6", "#38bdf8", "#16a34a", "#84cc16", "#eab308", "#f97316", "#ef4444", "#a855f7", "#8b9bb4"].map((c) => (
            <button key={c} className={"tt-swatch" + (c === color ? " on" : "")} style={{ background: c }}
              aria-label={`Color ${c}`} onClick={() => setColor(c)} />
          ))}
        </div>

        {/* Its own full-width block between the swatches and the actions — wraps to as many lines as
            the sentence needs, never truncates. */}
        {error && (
          <div className="tt-error" role="alert">
            <span className="tt-error-plain">{error.plain}</span>
            {error.hint && <span className="tt-error-hint">{error.hint}</span>}
          </div>
        )}

        <div className="tt-modalacts">
          <button className="tt-btn ghost" onClick={onClose}>Cancel</button>
          <button className="tt-btn start" disabled={saving || name.trim() === "" || clientName.trim() === ""} onClick={submit}>
            {saving ? "Saving…" : editing ? "Save changes" : "Create project"}
          </button>
        </div>
      </div>
    </div>
  );
}
