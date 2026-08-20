/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// First-Run Setup Wizard — the full-screen gate rendered instead of the shell until the install is
// configured. It now collects BOTH halves of setup: the workspace name, which names the shared
// organization database, and the master password, which is seeded straight into the vault at birth.
//
// THAT SECOND HALF IS THE WHOLE POINT OF THE MERGE. A new user used to meet two setup gates on two
// different screens. Seeding a chosen password here means the vault's own detector
// (`isSetupRequired`) answers "not required" from the very first boot, so VaultSetupWizard — which
// stays behind for the two installs that predate this — never fires on a new install again.
//
// Headings and button labels are PLACEHOLDER; Jason rewrites the copy later.
import { useMemo, useState } from "react";
import { generatePassword, strengthLabel, strengthScore } from "./setupPassword";
import { useSetupKeys } from "./setupKeys";

export default function FirstRunWizard({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(1);
  const [workspace, setWorkspace] = useState("");
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  // BOTH PASSWORD FIELDS START VISIBLE, and the toggle therefore reads "Hide" on arrival. Jason's
  // ruling: a password written down wrong is worse than one somebody standing nearby could have
  // glanced at. This is not an oversight — do not "fix" it.
  const [showPw, setShowPw] = useState(true);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** What Enter said when it could not advance. Cleared the moment the user types, so the advice
      never outlives the problem it describes. */
  const [notice, setNotice] = useState("");

  // TRIMMED, EVERYWHERE, FROM ONE SOURCE. A trailing space is invisible even in the monospace font
  // the Done step prints the password in — so a user would write down the visible characters, and
  // the verifier would carry the space. Validating, displaying, submitting and deriving all read the
  // SAME trimmed string, and main refuses an untrimmed one outright (vault/lock.ts) so the two sides
  // can never drift apart again.
  const pwA = pw1.trim();
  const pwB = pw2.trim();
  const score = useMemo(() => strengthScore(pw1.trim()), [pw1]);
  const pwMatch = pwA.length > 0 && pwA === pwB;
  const step1Ok = workspace.trim().length >= 2;
  const step2Ok = pwA.length >= 12 && pwMatch;
  /** Normalises the stored password as the user leaves the step, so what step 3 DISPLAYS is exactly
      what gets submitted. Trimming only at submit would show one string and send another. */
  const commitPassword = () => { setPw1(pwA); setPw2(pwB); };

  // ENTER ADVANCES — and when it cannot, it says why rather than doing nothing or skipping ahead.
  // Every branch below either moves one step or sets a message; none of them jumps a step.
  useSetupKeys(() => {
    if (busy) return;
    if (step === 1) {
      if (!step1Ok) return setNotice("Enter a workspace name of at least two characters to continue.");
      setNotice("");
      return setStep(2);
    }
    if (step === 2) {
      if (pwA.length < 12) return setNotice("Your master password needs at least 12 characters.");
      if (!pwMatch) return setNotice("The two entries do not match yet.");
      setNotice("");
      commitPassword();
      return setStep(3);
    }
    void finish();
  });

  async function finish() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await window.api.completeFirstRun(workspace.trim(), pw1.trim());
      onComplete();
    } catch {
      // Deliberately a fixed string. The rejected value is never echoed — an error message is the
      // easiest place in an application for a credential to end up in a log file.
      setError("Setup failed — could not save. Please try again.");
      setBusy(false);
    }
  }

  const dots = (
    <div className="vsw-steps">
      {[1, 2, 3].map((n) => (
        <i key={n} className={n < step ? "done" : n === step ? "now" : ""} />
      ))}
    </div>
  );

  return (
    <div className="vsw">
      <div className="vsw-dimmer" />

      {step === 1 && (
        <div className="vsw-card">
          {dots}
          <p className="vsw-eyebrow">Focal Registry · setup</p>
          <h2>Welcome to Focal Registry</h2>
          <p className="vsw-sub">Two quick things and you&rsquo;re in. Everything stays on this computer.</p>

          <label className="vsw-f" htmlFor="frw-workspace">
            Workspace name · <span className="vsw-req">required</span>
          </label>
          <input
            id="frw-workspace"
            type="text"
            autoFocus
            placeholder="e.g. AvertXAI"
            value={workspace}
            onChange={(e) => { setWorkspace(e.target.value); setNotice(""); }}
          />
          {/* Not "Organization Name" any more — a photographer working alone was being asked to
              name a company they do not have. */}
          <p className="vsw-hint">Your own name works fine if it&rsquo;s just you.</p>
          <div className="vsw-err">{notice || " "}</div>

          <div className="vsw-actions">
            <div className="vsw-spacer" />
            <button type="button" className="vsw-btn pri" disabled={!step1Ok} onClick={() => setStep(2)}>
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="vsw-card">
          {dots}
          <p className="vsw-eyebrow">Focal Registry · setup</p>
          <h2>Create your master password</h2>
          <p className="vsw-sub">
            This is the password that opens your vault. <b>Write it down somewhere safe &mdash; it cannot be recovered for you.</b>
          </p>

          <label className="vsw-f" htmlFor="frw-pw1">
            Master password · <span className="vsw-req">required</span>
          </label>
          <div className="vsw-pwrow">
            <input
              id="frw-pw1"
              type={showPw ? "text" : "password"}
              className="vsw-mono"
              placeholder="At least 12 characters"
              value={pw1}
              onChange={(e) => { setPw1(e.target.value); setNotice(""); }}
            />
            <button type="button" className="vsw-mini" onClick={() => setShowPw(!showPw)}>
              {showPw ? "Hide" : "Show"}
            </button>
            <button
              type="button"
              className="vsw-mini"
              onClick={() => {
                const p = generatePassword();
                setPw1(p);
                setPw2(p);
                setShowPw(true); // a generated password the user cannot see is one they cannot write down
              }}
            >
              Generate one
            </button>
          </div>
          <div className="vsw-meter">
            <i style={{ width: `${[0, 25, 50, 75, 100][Math.min(score, 4)]}%`, background: score >= 3 ? "var(--vaultsetup-green)" : "var(--vaultsetup-salmon)" }} />
          </div>
          <div className="vsw-meterlbl">{strengthLabel(pwA, score)}</div>

          <label className="vsw-f" htmlFor="frw-pw2">
            Confirm master password · <span className="vsw-req">required</span>
          </label>
          <input
            id="frw-pw2"
            type={showPw ? "text" : "password"}
            className="vsw-mono"
            placeholder="Type it again"
            value={pw2}
            onChange={(e) => { setPw2(e.target.value); setNotice(""); }}
          />
          <div className="vsw-err">{pw2.length > 0 && !pwMatch ? "The two entries do not match." : notice || " "}</div>

          <div className="vsw-actions">
            <button type="button" className="vsw-btn" onClick={() => setStep(1)}>
              Back
            </button>
            <div className="vsw-spacer" />
            <button type="button" className="vsw-btn pri" disabled={!step2Ok} onClick={() => { commitPassword(); setStep(3); }}>
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="vsw-card">
          {dots}
          <div className="vsw-check">&#10003;</div>
          <h2>You&rsquo;re all set</h2>
          <p className="vsw-sub">One last look before you finish.</p>

          <div className="vsw-sum">
            <div>
              <span>Workspace</span>
              <span>{workspace.trim()}</span>
            </div>
          </div>

          {/* PLAIN TEXT, MONOSPACE, AND THAT IS THE REQUIREMENT. Monospace is not decoration here:
              it is what separates a lowercase L from a capital I when the user checks the password
              against their own handwriting. Read-only — this is a display, not a field. */}
          <label className="vsw-f" htmlFor="frw-final">
            Your master password
          </label>
          <div className="vsw-pwrow">
            <input id="frw-final" type="text" className="vsw-mono" readOnly value={pw1} />
            <button
              type="button"
              className="vsw-mini"
              onClick={() => {
                void navigator.clipboard.writeText(pw1).then(() => setCopied(true)).catch(() => {});
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="vsw-hint">Check this against what you wrote down. This is the last time it is shown.</p>

          <div className="vsw-err">{error ?? notice ?? " "}&nbsp;</div>

          <div className="vsw-actions">
            <button type="button" className="vsw-btn" disabled={busy} onClick={() => setStep(2)}>
              Back
            </button>
            <div className="vsw-spacer" />
            <button type="button" className="vsw-btn pri" disabled={busy} onClick={() => void finish()}>
              {busy ? "Setting up…" : "Finish setup"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
