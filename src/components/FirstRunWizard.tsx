/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// First-Run Setup Wizard — full-screen gate rendered instead of the shell until the org is
// configured. Submits via window.api.completeFirstRun, then hands control back through onComplete.
import { useState, type FormEvent } from "react";

export default function FirstRunWizard({ onComplete }: { onComplete: () => void }) {
  const [orgName, setOrgName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const name = orgName.trim();
    if (!name || busy) return;
    setBusy(true);
    setError(null);
    try {
      await window.api.completeFirstRun(name);
      onComplete();
    } catch {
      setError("Setup failed — could not save. Please try again.");
      setBusy(false);
    }
  };

  return (
    <div className="frw">
      <form className="frw-card" onSubmit={submit}>
        <h1>Welcome to AvertXAI Focal Registry</h1>
        <p className="frw-sub">One step to set up your workspace — everything stays local.</p>
        <div className="field">
          <label htmlFor="frw-org">Organization Name</label>
          <input
            id="frw-org"
            className="input"
            autoFocus
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            placeholder="e.g. AvertXAI"
            disabled={busy}
          />
        </div>
        {error && <p className="frw-err">{error}</p>}
        <div className="frw-actions">
          <button className="btn blue" type="submit" disabled={busy || !orgName.trim()}>
            {busy ? "Setting up…" : "Complete Setup"}
          </button>
        </div>
      </form>
    </div>
  );
}
