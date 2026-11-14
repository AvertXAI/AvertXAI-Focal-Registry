/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
/* File: src/modules/vault/copyClear.ts */
// The Vault's copy buttons go through main, which clears the clipboard after the wait set in the
// Vault's settings. A plain Ctrl+C, Ctrl+X or the menu's Copy in a note is the browser's own copy
// and never passed that way, so note text stayed on the clipboard for good. This tells main about
// such a copy. The browser still does the writing, so a rich copy stays rich.
import type { ClipboardEvent } from "react";
import { vaultApi } from "./vaultApi";

/**
 * The plain text this copy or cut is about to leave on the clipboard. The rich editor and its code
 * blocks write their own flavours onto the event before it reaches here; a text box or a selection
 * in the preview has written nothing yet, so it is read from what is selected.
 */
function copiedText(e: ClipboardEvent): string {
  const written = e.clipboardData.getData("text/plain");
  if (written) return written;
  const from = e.target;
  if (from instanceof HTMLTextAreaElement || from instanceof HTMLInputElement) {
    return from.value.slice(from.selectionStart ?? 0, from.selectionEnd ?? 0);
  }
  return window.getSelection()?.toString() ?? "";
}

/** onCopy and onCut for a surface that shows note text. */
export function clearCopyLater(e: ClipboardEvent): void {
  const text = copiedText(e);
  if (text === "") return;
  // A timer, not a promise: the browser writes the clipboard only after this event has run, and
  // main starts the wait only if it finds the copy there.
  window.setTimeout(() => {
    vaultApi().clearCopied(text).catch((err: unknown) => {
      // Message and stack only, never the copied text.
      void vaultApi()
        .logClient("warn", "Notes: the timed clear could not be started for a copy, so it stays on the clipboard", err instanceof Error ? (err.stack ?? err.message) : String(err))
        .catch(() => undefined);
    });
  }, 0);
}
