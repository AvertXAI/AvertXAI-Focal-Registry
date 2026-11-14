/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Milkdown tells the page about a change 200 ms after it, and not at all once the editor has been
// torn down. A click that opened another note inside those 200 ms tore the editor down, so the last
// words typed or pasted before the click were never handed to the page and never saved. This keeps
// track of a change the editor still owes the page, so that focus leaving the editor can hand it
// over at once. It hands over exactly what Milkdown would have reported, only sooner.

export interface Tail<Doc> {
  /** A change Milkdown will report after its wait. `before` is the document as it was before it. */
  changed(before: Doc): void;
  /** Milkdown's own report. */
  reported(markdown: string): void;
  /** Focus is leaving the editor: hands over what is owed, when something is. */
  handOver(now: Doc, write: (doc: Doc) => string): void;
}

export function createTail<Doc>(report: (markdown: string) => void, same: (a: Doc, b: Doc) => boolean): Tail<Doc> {
  let owed: { before: Doc } | null = null;
  // Text handed over ahead of Milkdown. Its own report of the same text is then dropped: a second
  // report would mark a note unsaved again just after it was saved.
  let early: string | null = null;
  return {
    changed(before) {
      if (!owed) owed = { before };
    },
    reported(markdown) {
      owed = null;
      const repeat = markdown === early;
      early = null;
      if (!repeat) report(markdown);
    },
    handOver(now, write) {
      const from = owed;
      owed = null;
      // Typed and taken back again: Milkdown reports nothing for that, so neither does this.
      if (!from || same(from.before, now)) return;
      early = write(now);
      report(early);
    },
  };
}
