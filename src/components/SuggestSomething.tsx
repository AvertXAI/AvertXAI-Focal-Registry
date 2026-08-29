/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Suggest something — Help → Suggest something. Built to MOCKUP-report-and-suggest-v5-08-23-2026.html,
// approved 08-23-2026. Short on purpose: "the suggestions box should be short and sweet."
//
// FOUR FIELDS, AND THE SECOND AND FOURTH ARE THE VALUABLE ONES:
//
//  1. the idea — what they think the fix is
//  2. what they cannot do today — the actual PROBLEM. An idea is somebody's guess at a solution;
//     this is the thing that guess is aimed at, and it is what makes the report actionable when the
//     guess is wrong.
//  3. which part of the app
//  4. how much it would matter — nice / weekly / blocking / would pay. That last option is a pricing
//     signal, not a courtesy field. It belongs next to entitlement-refusal counts, because "I would
//     pay for this on its own" is the sentence that decides what becomes a separate product.
//
// A SUGGESTION IS NOT A BUG REPORT AND MUST NOT QUIETLY BEHAVE LIKE ONE. No logs, no file paths, no
// system block, no screenshot. Main enforces that in buildSuggestion(); this file simply never
// collects them.
//
// THE MODULE LIST comes in as a prop from App's `visibleModules` — the SAME filtered list the nav,
// the Flyout and Home all read. That is deliberate: when the product lines land and start hiding
// modules, this dropdown follows with no edit here. Nothing in this app may be the surface that
// tells someone other product lines exist.
import { useEffect, useRef, useState } from "react";
import { signalAppToast } from "../App";
import type { ModuleRow } from "../shared/types";

const WEIGHTS: Array<[string, string, string]> = [
  ["nice", "Nice to have", "no rush"],
  ["weekly", "I'd use it weekly", "real habit"],
  ["blocking", "It's blocking me", "working around it"],
  ["pay", "I'd pay for it", "on its own"],
];

interface Props {
  onClose: () => void;
  /** Entitlement-filtered module rows. App owns the filter; this surface must never re-derive it. */
  modules: ModuleRow[];
}

export default function SuggestSomething({ onClose, modules }: Props) {
  const [reference, setReference] = useState("");
  const [idea, setIdea] = useState("");
  const [problem, setProblem] = useState("");
  const [area, setArea] = useState("");
  const [weight, setWeight] = useState("nice");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void window.api.feedback
      .begin("suggestion")
      .then((b) => setReference(b.reference))
      .catch(() => undefined); // a missing reference must not cost someone their idea
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => { box.current?.focus(); }, []);

  const send = (): void => {
    if (busy) return;
    if (!idea.trim()) { setError("Describe the idea first — rough is fine."); box.current?.focus(); return; }
    setBusy(true);
    setError("");
    void window.api.feedback
      .sendSuggestion({
        reference,
        idea: idea.trim(),
        problem: problem.trim(),
        area,
        weight,
        modules: modules.map((m) => m.slug),
      })
      .then((r) => {
        signalAppToast(
          r.sent ? "Suggestion sent" : "Suggestion saved — it will go out when a connection is available.",
          "ok",
          2500
        );
        onClose();
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setBusy(false);
      });
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="fb-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Suggest something"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="fb-title">Suggest something</h2>
        <p className="fb-sub">Anything you wish this app did. Half an idea is fine.</p>

        <label className="fb-label" htmlFor="fb-idea">
          What should it do? <span className="fb-req">· required</span>
        </label>
        <textarea
          id="fb-idea"
          ref={box}
          className="fb-input"
          value={idea}
          onChange={(e) => { setIdea(e.target.value); if (error) setError(""); }}
          placeholder="Describe it however it comes out. Rough is fine."
        />

        <label className="fb-label" htmlFor="fb-problem">What are you trying to do that you can&rsquo;t today?</label>
        <textarea
          id="fb-problem"
          className="fb-input short"
          value={problem}
          onChange={(e) => setProblem(e.target.value)}
          placeholder="The thing you're working around right now."
        />

        <label className="fb-label" htmlFor="fb-area">Which part of the app?</label>
        <select id="fb-area" className="fb-select" value={area} onChange={(e) => setArea(e.target.value)}>
          <option value="">Not sure / the whole app</option>
          {modules.map((m) => (
            <option key={m.slug} value={m.slug}>{m.name}</option>
          ))}
        </select>

        <span className="fb-label">How much would this matter to you?</span>
        <div className="fb-seg" role="group" aria-label="How much would this matter to you?">
          {WEIGHTS.map(([id, label, hint]) => (
            <button
              key={id}
              type="button"
              className={weight === id ? "on" : ""}
              aria-pressed={weight === id}
              onClick={() => setWeight(id)}
            >
              {label}
              <small>{hint}</small>
            </button>
          ))}
        </div>

        {error && <div className="fb-error" role="alert">{error}</div>}

        <div className="fb-acts">
          <span className="fb-spacer" />
          <button className="fb-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="fb-btn primary" onClick={send} disabled={busy}>
            {busy ? "Sending…" : "Send suggestion"}
          </button>
        </div>
      </div>
    </div>
  );
}
