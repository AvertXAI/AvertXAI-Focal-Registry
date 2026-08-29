/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Report a problem — the DELIBERATE channel, reachable from Help → Report a problem and from the
// crash prompt. Built to MOCKUP-report-and-suggest-v5-08-23-2026.html, approved 08-23-2026.
//
// WHAT IS DELIBERATELY ABSENT, because every one of these was ruled OUT and putting any of them back
// is a regression, not an improvement:
//
//  · No "exactly what will be sent" list, no raw-payload viewer, no JSON dump. "they dont need to
//    know all that extra information."
//  · No reply-address field, ever. Ruled 08-23-2026: the reply address is resolved SERVER side from
//    the licence key the report already carries, so this form never asks a person for their email.
//    The CONSEQUENCE is that the reference is the only handle the USER has on this report, which is
//    why it is shown and why main must keep it findable.
//  · No controls on the screenshot — no expand, no full size, no remove. "no options for users." The
//    thumbnail is evidence a picture was taken and nothing else, so it is pointer-events:none.
//  · No "no account needed" line.
//
// THE SCREENSHOT IS TAKEN WHEN THIS OPENS, not when Send is pressed — feedback.begin() does it in
// main. Capturing at send time would photograph this form sitting on top of the thing that broke.
import { useEffect, useRef, useState } from "react";
import { signalAppToast } from "../App";

interface Props {
  onClose: () => void;
  /** Set when the crash prompt opened this, so main can mark the report as crash-originated. */
  crash?: boolean;
  /** Reference and screenshot already obtained by the crash prompt — re-asking would take a second,
      later picture of this form. Absent when opened from the Help menu, which begins its own. */
  begun?: { reference: string; thumb: string | null };
}

/**
 * SCREENSHOTS ARE HIDDEN, NOT REMOVED (Jason 08-24-2026): "lets hide the screenshot section, and
 * leave it for later" — MVP scope control. False also stops the capture itself: begin() is skipped
 * so no PNG is written to disk for a picture nobody will see. Everything downstream (main-side
 * captureScreen, the thumb strip, + Add images) is intact; flip this to true and it is all back.
 */
export const SCREENSHOTS_VISIBLE = false;

export default function ReportProblem({ onClose, crash, begun }: Props) {
  const [reference, setReference] = useState(begun?.reference ?? "");
  const [thumb, setThumb] = useState<string | null>(begun?.thumb ?? null);
  const [description, setDescription] = useState("");
  const [includeSystem, setIncludeSystem] = useState(false);
  const [extraImages, setExtraImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Only when the Help menu opened this cold. A crash-opened form already carries its shot.
    if (begun) return;
    if (!SCREENSHOTS_VISIBLE) {
      // No capture at all — a hidden picture on disk is worse than none. The reference alone still
      // has to exist, and sendReport mints one when the field is empty, so nothing else changes.
      return;
    }
    void window.api.feedback
      .begin("report")
      .then((b) => { setReference(b.reference); setThumb(b.thumb); })
      .catch(() => {
        // No reference and no picture still leaves a usable report — the description is the part
        // that matters. Failing closed here would throw away the words someone is about to type.
      });
  }, [begun]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => { box.current?.focus(); }, []);

  const send = (): void => {
    if (busy) return;
    if (!description.trim()) { setError("Tell me what went wrong first."); box.current?.focus(); return; }
    setBusy(true);
    setError("");
    void window.api.feedback
      .sendReport({ reference, description: description.trim(), includeSystem, extraImages, crash })
      .then((r) => {
        // 2500ms, and it goes on its own — the full "Report sent" receipt screen with its ticket
        // number and Close button was cut on 08-23-2026. Nothing to dismiss.
        signalAppToast(
          r.sent ? "Report sent" : "Report saved — it will go out when a connection is available.",
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

  const addImages = (): void => {
    void window.api.feedback
      .pickImages()
      .then((paths) => { if (paths.length) setExtraImages((prev) => [...prev, ...paths]); })
      .catch(() => undefined);
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="fb-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Report a problem"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="fb-title">Report a problem</h2>

        {reference && (
          <div className="fb-ref">
            Reference <span className="fb-refid">{reference}</span>
          </div>
        )}

        <label className="fb-label" htmlFor="fb-what">
          What went wrong? <span className="fb-req">· required</span>
        </label>
        <textarea
          id="fb-what"
          ref={box}
          className="fb-input"
          value={description}
          onChange={(e) => { setDescription(e.target.value); if (error) setError(""); }}
          placeholder="What were you doing, and what did the app do instead?"
        />

        {SCREENSHOTS_VISIBLE && thumb && (
          <div className="fb-shots">
            {/* alt is empty and aria-hidden is set on purpose: this conveys no information a screen
                reader can use, and announcing "screenshot of your screen" would be noise. The
                sentence that matters is the one the user types above. */}
            <img className="fb-shot" src={thumb} alt="" aria-hidden="true" draggable={false} />
            {extraImages.map((p) => (
              <span key={p} className="fb-extra" title={p}>{p.split(/[\\/]/).pop()}</span>
            ))}
          </div>
        )}

        <label className={`fb-check${includeSystem ? " on" : ""}`}>
          <input
            type="checkbox"
            checked={includeSystem}
            onChange={(e) => setIncludeSystem(e.target.checked)}
          />
          <span>Include the files, folders, system &amp; hardware drivers used.</span>
        </label>

        {error && <div className="fb-error" role="alert">{error}</div>}

        <div className="fb-acts">
          {SCREENSHOTS_VISIBLE && (
            <button className="fb-btn" onClick={addImages} disabled={busy}>+ Add images</button>
          )}
          <span className="fb-spacer" />
          <button className="fb-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="fb-btn primary" onClick={send} disabled={busy}>
            {busy ? "Sending…" : "Send report"}
          </button>
        </div>
      </div>
    </div>
  );
}
