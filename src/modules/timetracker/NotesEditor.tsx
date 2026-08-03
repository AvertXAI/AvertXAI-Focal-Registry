/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// The auto-bulleting notes textarea — used by BOTH editors (the project pad and the live Session
// notes block), so their keyboard behaviour can never drift apart. A plain <textarea> plus a
// keydown handler: no markdown library, no rich text, no contenteditable, no dependency.
//
// BEHAVIOUR (Jason rulings 7 + 8):
//   Enter          → newline + the next marker, continuing the current line's style
//                    (∙ stays ∙ · 1. → 2. · A. → B. · Z. → AA.)
//   Shift + Enter  → a plain newline with NO marker (handled by doing nothing — the browser's own
//                    insertion is exactly right, and letting it through keeps undo native)
//   Enter on a line holding only a marker → clears that marker and ends the list, the convention
//                    every editor uses. Never fight the typist.
//   A line the user has de-bulleted stays plain: nothing here ever rewrites an existing line.
//
// UNDO: insertion goes through document.execCommand("insertText"), which Chromium records as ONE
// undoable edit. Writing to textarea.value directly would nuke the undo stack, and setRangeText
// fragments it — that is why a deprecated-but-working API is the right call here.
import { useRef, type FocusEvent, type KeyboardEvent } from "react";
import { BULLET, nextMarker } from "../../shared/ttNotes";

/** A document holding nothing but an opening marker — what an untouched, just-focused editor has. */
const MARKER_ONLY = new RegExp(`^\\s*(${BULLET}|[0-9]+\\s?[.\\-]|[A-Za-z]{1,3}\\s?[.\\-])\\s*$`);

interface Props {
  /** Seed text. This is an UNCONTROLLED textarea (like the pad it replaces) — remount to re-seed. */
  defaultValue: string;
  /** Fired on blur with the full text, only when it actually changed. */
  onCommit: (value: string) => void;
  className?: string;
  placeholder?: string;
  ariaLabel: string;
}

export default function NotesEditor({ defaultValue, onCommit, className, placeholder, ariaLabel }: Props) {
  const seeded = useRef(defaultValue);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    // Shift+Enter: let the browser insert a bare newline. No marker, native undo, nothing to do.
    if (e.key !== "Enter" || e.shiftKey) return;
    const el = e.currentTarget;
    const pos = el.selectionStart;
    // A selection spanning text is a replace-and-newline; treat the line as the caret's line start.
    const before = el.value.slice(0, pos);
    const lineStart = before.lastIndexOf("\n") + 1;
    const currentLine = before.slice(lineStart);
    const marker = nextMarker(currentLine);

    e.preventDefault();
    // Marker-only line → end the list: select the orphan marker away and leave a clean newline.
    if (currentLine.trim() !== "" && currentLine.trim() === marker.trim()) {
      el.setSelectionRange(lineStart, pos);
      document.execCommand("insertText", false, "\n");
      return;
    }
    document.execCommand("insertText", false, `\n${marker}`);
    // Caret lands after the inserted marker automatically — execCommand collapses the range to the
    // end of what it inserted, which is precisely the position the typist expects.
  };

  // Clicking into an EMPTY editor hands you the first bullet immediately — you should never have to
  // press Enter once to start a list (Jason 08-02-2026). Only ever fires on a genuinely empty
  // document, so it can never touch a word the user already wrote.
  const onFocus = (e: FocusEvent<HTMLTextAreaElement>): void => {
    const el = e.currentTarget;
    if (el.value !== "") return;
    const seed = `${BULLET} `;
    if (!document.execCommand("insertText", false, seed)) {
      el.value = seed; // fallback: nothing to undo on an empty document, so a direct write is safe
      el.setSelectionRange(seed.length, seed.length);
    }
  };

  return (
    <textarea
      className={className}
      placeholder={placeholder}
      defaultValue={defaultValue}
      aria-label={ariaLabel}
      spellCheck
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        // A lone seeded marker is NOT content: clicking in and straight back out must leave the note
        // exactly as it was, never save a stray "∙".
        const value = MARKER_ONLY.test(e.target.value) ? "" : e.target.value;
        if (value === seeded.current) return; // unchanged — no write
        seeded.current = value;
        onCommit(value);
      }}
    />
  );
}
