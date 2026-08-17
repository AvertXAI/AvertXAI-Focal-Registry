/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// THE RAW-PANE FORMATTING ENGINE (Jason's toolbar prompt, 08-16-2026: "every toolbar button
// inserts markdown syntax as PLAIN TEXT at the cursor / around the selection… the syntax stays
// visible as text"). One pure function: given the textarea's text and selection, it answers with
// ONE contiguous replacement — never the whole value — so the caller can apply it through
// document.execCommand("insertText") and the textarea's NATIVE undo stack keeps working. A
// whole-value rewrite would be simpler and would silently kill Ctrl+Z, which is the trade that
// decides this file's shape.
//
// This runs in Raw mode and in Split's raw pane. The WYSIWYG never calls it — there the same
// toolbar drives Milkdown's own commands (MilkdownEditor.run), which is a different world.

import type { EditorAction } from "./MilkdownEditor";

export interface RawEdit {
  /** Replace text[start, end) with `insert` … */
  start: number;
  end: number;
  insert: string;
  /** … then leave the selection here (positions in the NEW text). */
  selStart: number;
  selEnd: number;
}

/** Every leader a line can carry, one at a time: heading, quote, checklist, bullet, number.
 *  `- [ ]` must be listed before the bare bullet or the bullet alternative eats its dash. */
const LEAD = /^(\s*)(?:#{1,6}[ \t]+|>[ \t]+|- \[[ xX]\][ \t]+|[-*+][ \t]+|\d+[.)][ \t]+)/;

/** Strip EVERY leader — `> - item` is quoted-and-bulleted and both must go before a new one lands. */
function stripLead(line: string): string {
  let prev = "";
  while (prev !== line) { prev = line; line = line.replace(LEAD, "$1"); }
  return line;
}

/** Wrap the selection in a symmetric mark. No selection → an empty pair with the caret centred. */
function wrap(text: string, s: number, e: number, mark: string): RawEdit {
  const sel = text.slice(s, e);
  return { start: s, end: e, insert: `${mark}${sel}${mark}`, selStart: s + mark.length, selEnd: e + mark.length };
}

/** Rewrite every full line the selection touches, selecting the rewritten block afterwards. */
function lineOp(text: string, s: number, e: number, fn: (line: string, nth: number) => string): RawEdit {
  // A selection that ends exactly at a line start (a triple-click drag) must not drag the next
  // line into the operation.
  const endAt = e > s && text[e - 1] === "\n" ? e - 1 : e;
  const ls = text.lastIndexOf("\n", s - 1) + 1;
  const cut = text.indexOf("\n", endAt);
  const le = cut === -1 ? text.length : cut;
  let nth = 0;
  const block = text
    .slice(ls, le)
    .split("\n")
    .map((line) => (line.trim() === "" ? line : fn(line, nth++)))
    .join("\n");
  return { start: ls, end: le, insert: block, selStart: ls, selEnd: ls + block.length };
}

/** A block inserted at the caret, padded to stand alone. Selects `pick` inside it if given. */
function blockAt(text: string, s: number, e: number, body: string, pick?: string): RawEdit {
  const before = text.slice(0, s);
  const atLineStart = before === "" || before.endsWith("\n");
  const lead = before === "" ? "" : atLineStart ? "\n" : "\n\n";
  const insert = `${lead}${body}\n`;
  const at = pick ? insert.indexOf(pick) : -1;
  const selStart = at >= 0 ? s + at : s + insert.length;
  const selEnd = at >= 0 ? selStart + (pick as string).length : selStart;
  return { start: s, end: e, insert, selStart, selEnd };
}

/**
 * The one entry point. Returns null for actions the raw pane does not own (undo/redo go through
 * the browser's own edit history; "task" arrives as "checklist" here and IS owned).
 */
export function rawEdit(action: EditorAction, text: string, s: number, e: number): RawEdit | null {
  if (typeof action === "object") {
    if ("insert" in action) {
      // The vault chip. Select the Label placeholder so typing replaces it in place.
      const at = action.insert.indexOf("Label");
      return {
        start: s, end: e, insert: action.insert,
        selStart: at >= 0 ? s + at : s + action.insert.length,
        selEnd: at >= 0 ? s + at + "Label".length : s + action.insert.length,
      };
    }
    return lineOp(text, s, e, (line) => `${"#".repeat(action.heading)} ${stripLead(line).trim()}`);
  }
  switch (action) {
    case "bold": return wrap(text, s, e, "**");
    case "italic": return wrap(text, s, e, "*");
    case "strike": return wrap(text, s, e, "~~");
    case "code": return wrap(text, s, e, "`");
    case "paragraph": return lineOp(text, s, e, (line) => stripLead(line));
    case "quote": return lineOp(text, s, e, (line) => `> ${stripLead(line)}`);
    case "bullet": return lineOp(text, s, e, (line) => `- ${stripLead(line)}`);
    case "ordered": return lineOp(text, s, e, (line, nth) => `${nth + 1}. ${stripLead(line)}`);
    case "task": return lineOp(text, s, e, (line) => `- [ ] ${stripLead(line)}`);
    case "codeblock": {
      const endAt = e > s && text[e - 1] === "\n" ? e - 1 : e;
      const ls = text.lastIndexOf("\n", s - 1) + 1;
      const cut = text.indexOf("\n", endAt);
      const le = cut === -1 ? text.length : cut;
      const body = text.slice(ls, le);
      const insert = "```\n" + body + "\n```";
      // Caret right after the opening fence, where the language name goes.
      return { start: ls, end: le, insert, selStart: ls + 3, selEnd: ls + 3 };
    }
    case "hr": return blockAt(text, s, e, "---");
    case "table": return blockAt(text, s, e, "| Column | Column |\n| --- | --- |\n|  |  |", "Column");
    case "link": {
      const sel = text.slice(s, e) || "title";
      const insert = `[${sel}](url)`;
      const at = insert.lastIndexOf("(url)") + 1;
      return { start: s, end: e, insert, selStart: s + at, selEnd: s + at + 3 };
    }
    case "image": {
      const sel = text.slice(s, e) || "alt text";
      const insert = `![${sel}](url)`;
      const at = insert.lastIndexOf("(url)") + 1;
      return { start: s, end: e, insert, selStart: s + at, selEnd: s + at + 3 };
    }
    default:
      return null; // undo/redo — the textarea's own history handles those
  }
}
