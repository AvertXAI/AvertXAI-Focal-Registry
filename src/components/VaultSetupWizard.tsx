// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: The Secured Vault's setup wizard — RETROFIT ONLY, and shown during boot.
//
//              READ THIS BEFORE CHANGING ANYTHING HERE. There is ONE setup wizard in this
//              application, and it is not this one. FirstRunWizard now collects the master password
//              at install time and seeds it straight into the vault, so `isSetupRequired` answers
//              "not required" from a new install's very first boot and this component never fires.
//
//              It survives for the two installs that predate that merge — Jason's and Paul's —
//              whose vault verifier is still the app-seeded derived initial and which have no other
//              way to set a master password (the ten-click developer leaf is version-keyed and
//              revoked on every update). It fires once on each, then never again for anyone. Once
//              both have run it this whole file is dead code and can be deleted.
//
//              Trimmed 2026-08-19 to password-and-done on Jason's ruling — "the 2nd wizard just
//              asks to set password". The account-type and details steps it used to carry moved to
//              My Profile in Settings. That ruling supersedes MOCKUP-vault-wizard-v5, which still
//              drew a details step.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: src/components/VaultSetupWizard.tsx
//------------------------------------------------------------
import { useMemo, useState } from "react";
import { generatePassword, strengthLabel, strengthScore } from "./setupPassword";
import { useSetupKeys } from "./setupKeys";

/**
 * NOT SKIPPABLE, BY CONSTRUCTION. There is no cancel control and no `onSkip` prop to wire one to
 * later. Boot is held behind this component by an early `return`, so a way out of it would be a way
 * into a half-set-up vault. Escape is not that way out: it QUITS the application rather than
 * dismissing the wizard, which is the only honest exit when there is no shell behind it.
 *
 * It also does no navigating. It reports completion once, upward, and the shell decides where the
 * user lands — `select()` writes `last_active_module` on every call, so a component that routed
 * itself would quietly rewrite where the user goes on the NEXT launch too.
 */
export default function VaultSetupWizard({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(1);
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  // BOTH FIELDS START VISIBLE — same ruling as FirstRunWizard. A password written down wrong is
  // worse than one somebody standing nearby could have glanced at.
  const [showPw, setShowPw] = useState(true);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  /** What Enter said when it could not advance. Cleared as soon as the user types. */
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
  const step1Ok = pwA.length >= 12 && pwMatch;
  /** Normalises the stored password as the user leaves the step, so what step 2 DISPLAYS is exactly
      what gets submitted. */
  const commitPassword = () => { setPw1(pwA); setPw2(pwB); };

  // ENTER ADVANCES — and when it cannot, it says why. It never skips the password step.
  useSetupKeys(() => {
    if (busy) return;
    if (step === 1) {
      if (pwA.length < 12) return setNotice("Your master password needs at least 12 characters.");
      if (!pwMatch) return setNotice("The two entries do not match yet.");
      setNotice("");
      commitPassword();
      return setStep(2);
    }
    void finish();
  });

  async function finish() {
    if (busy) return;
    setBusy(true);
    setSaveError("");
    try {
      // The ONE write. Main re-derives the password this replaces and refuses the call outright if
      // the vault has already been set up — see electron/core/services/vault/ipc.ts.
      await window.api.vault.completeSetup(pw1.trim());
      onComplete();
    } catch (e) {
      // Boot stays held. A failure here means the vault still holds its seeded password, so letting
      // the user through would be shipping them the exact state this wizard exists to end. The
      // message comes from main and never contains the password.
      setSaveError(e instanceof Error ? e.message : "The vault could not be set up. Please try again.");
      setBusy(false);
    }
  }

  const dots = (
    <div className="vsw-steps">
      {[1, 2].map((n) => (
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
          <p className="vsw-eyebrow">Secured Vault · setup</p>
          <h2>Create your master password</h2>
          <p className="vsw-sub">
            This is the password that opens your vault. <b>Write it down somewhere safe &mdash; it cannot be recovered for you.</b>
          </p>

          <label className="vsw-f" htmlFor="vsw-pw1">
            Master password · <span className="vsw-req">required</span>
          </label>
          <div className="vsw-pwrow">
            <input
              id="vsw-pw1"
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
                setShowPw(true);
              }}
            >
              Generate one
            </button>
          </div>
          <div className="vsw-meter">
            <i style={{ width: `${[0, 25, 50, 75, 100][Math.min(score, 4)]}%`, background: score >= 3 ? "var(--vaultsetup-green)" : "var(--vaultsetup-salmon)" }} />
          </div>
          <div className="vsw-meterlbl">{strengthLabel(pwA, score)}</div>

          <label className="vsw-f" htmlFor="vsw-pw2">
            Confirm master password · <span className="vsw-req">required</span>
          </label>
          <input
            id="vsw-pw2"
            type={showPw ? "text" : "password"}
            className="vsw-mono"
            placeholder="Type it again"
            value={pw2}
            onChange={(e) => { setPw2(e.target.value); setNotice(""); }}
          />
          <div className="vsw-err">{pw2.length > 0 && !pwMatch ? "The two entries do not match." : notice || " "}</div>

          {/* NO Back button — this is the first step and there is nothing behind it but a held boot. */}
          <div className="vsw-actions">
            <div className="vsw-spacer" />
            <button type="button" className="vsw-btn pri" disabled={!step1Ok} onClick={() => { commitPassword(); setStep(2); }}>
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="vsw-card">
          {dots}
          <div className="vsw-check">&#10003;</div>
          <h2>Your vault is ready</h2>
          <p className="vsw-sub">One last look before you finish.</p>

          {/* Plain text, monospace, read-only — monospace is what separates a lowercase L from a
              capital I when the user checks the password against their own handwriting. */}
          <label className="vsw-f" htmlFor="vsw-final">
            Your master password
          </label>
          <div className="vsw-pwrow">
            <input id="vsw-final" type="text" className="vsw-mono" readOnly value={pw1} />
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

          <div className="vsw-err">{saveError || notice || " "}&nbsp;</div>

          <div className="vsw-actions">
            <button type="button" className="vsw-btn" disabled={busy} onClick={() => setStep(1)}>
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
