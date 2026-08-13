/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// The house confirm dialog. Replaces window.confirm(), which renders as a bare "Electron" OS box —
// wrong typeface, wrong colours, wrong name on the title bar, and no room to say what is actually
// about to happen (Jason 08-11-2026).
//
// A confirm that only says "are you sure?" pushes the thinking onto the user at the worst moment.
// This one carries a CONSEQUENCE line: what happens, and what does NOT — because for most of these
// the reassuring half ("the SSH key it points at is untouched") is the part that decides the answer.
import { useEffect, useRef, useState } from "react";

export interface ConfirmProps {
  title: string;
  /** The plain-sentence consequence. Say what happens AND what does not. */
  body: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive styling — red action, and the cancel takes focus instead. */
  danger?: boolean;
  /**
   * A SECOND way out, for the case where the honest prompt is "which of these two did you mean?"
   * rather than "yes or no" (Jason 08-11-2026, on the archive prompt: "give me the option to delete
   * or archive"). Offering both beats making someone cancel, hunt for the other shelf, and come
   * back — which is how a tick-and-bin gesture turns into four clicks.
   */
  secondary?: { label: string; onPick: () => void; danger?: boolean };
  /**
   * WHY THE PRIMARY CANNOT PROCEED YET — a sentence, or null when it can (Jason 08-12-2026: "if i
   * click on Type EMPTY first button, it shouldnt close the modal, it should advise the user to
   * follow the steps, only cancel closes the modal").
   *
   * The typed-confirmation dialogs used to gate inside their own onConfirm — so clicking with an
   * empty box ran nothing and then CLOSED anyway, which reads exactly like the button worked. A
   * refusal has to say it refused. Passing this also stops a backdrop click from closing: on a
   * dialog you have to type into, a stray click at the edge of the field should not throw the word
   * away. Escape still cancels, because Escape always means cancel.
   */
  blocked?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

export default function ConfirmModal({
  title, body, confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false, secondary, blocked, onConfirm, onClose,
}: ConfirmProps) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const goRef = useRef<HTMLButtonElement | null>(null);
  const root = useRef<HTMLDivElement | null>(null);
  /** Shown only after the user actually clicks a primary that cannot run. Nagging before they try is
   *  scolding someone for something they have not done. */
  const [nag, setNag] = useState<string | null>(null);

  /**
   * FOCUS ONCE, ON MOUNT. This effect used to list [danger, onClose] as its dependencies, and every
   * caller passes onClose as an inline arrow — a fresh identity on every render. So on a dialog with
   * a text field in its body, each keystroke re-rendered the parent, re-ran this, and threw focus
   * onto the Cancel button (Jason 08-12-2026: "when i start typing, the cursor gets removed outside
   * the modal, and i have to click inside the input field once per letter").
   *
   * It also yields to a field that already has focus: a body carrying an autoFocus input has already
   * made the better choice, and that input is the thing the dialog is asking you to fill in.
   */
  useEffect(() => {
    if (root.current?.contains(document.activeElement)) return;
    // On a destructive prompt the SAFE button takes focus, so a stray Enter cancels rather than
    // deletes. Enter still confirms deliberately (the button is focusable); Escape always cancels.
    (danger ? cancelRef : goRef).current?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- mount only, deliberately

  // Escape is read through a ref for the same reason: a changing onClose must not re-bind the
  // listener, and re-binding is what made the effect above fire.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") { e.preventDefault(); closeRef.current(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The moment the gate is satisfied the complaint goes away on its own.
  useEffect(() => { if (!blocked) setNag(null); }, [blocked]);

  return (
    <div className="vault-modalback" onClick={blocked === undefined ? onClose : undefined}>
      <div ref={root} className="vault-modal vault-confirm" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <div className="vault-confirmbody">{body}</div>
        {nag && <div className="vault-confirmnag" role="alert">{nag}</div>}
        <div className="vault-modalacts">
          <button ref={cancelRef} className="vault-btn" onClick={onClose}>{cancelLabel}</button>
          {/* The second choice sits LEFT of the primary and is never the focused button — it is an
              alternative, not the recommendation, and on these prompts it is the harsher of the two. */}
          {secondary && (
            <button
              className={`vault-btn ${secondary.danger ? "danger" : ""}`}
              onClick={() => { secondary.onPick(); onClose(); }}
            >
              {secondary.label}
            </button>
          )}
          <button
            ref={goRef}
            className={`vault-btn ${danger ? "danger solid" : "primary"}${blocked ? " held" : ""}`}
            aria-disabled={blocked ? true : undefined}
            onClick={() => {
              // NOT disabled — a disabled button explains nothing, and this one has something to say.
              if (blocked) { setNag(blocked); return; }
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
