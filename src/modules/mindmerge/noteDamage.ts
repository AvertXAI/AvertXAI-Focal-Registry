/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// The four kinds of damage an earlier version left in stored note text (bug sweep 1, report
// section 7), and how each one is recognised. Plain string work with no editor in it, so the main
// process can list damaged notes with the very test the repair screen later uses to say what a
// repair leaves behind. The two can then never disagree about what counts as damage.
import { isBoldLabel } from "./boldLabel";

export type DamageKind = "scheme" | "at" | "label" | "picture";

/** A pasted picture is stored under this address until its file is saved. One still there never arrived (MM-04). */
export const PENDING_PICTURE = "mindmerge-pending:";

/** Told to the open Notes editor after a repair is saved, so it does not write the old text back. */
export const NOTE_REPAIRED_EVENT = "focal:mindmerge-note-repaired";

// A fence may sit inside a list item or a quote, so their markers are allowed in front of it.
const FENCE = /^(?:[ \t>]|[-*+][ \t]|\d+[.)][ \t])*(`{3,}|~{3,})(.*)$/;

// An escaped pair of asterisks that opens where the editor lets bold open (line start, a space, an
// opening bracket or a quote) and closes right after a colon: what the old writer made of a bold
// label typed hard against its value. The first group is what stands in front of it.
const ESCAPED_LABEL = /(^|[\s([{"'“‘])\\\*\\\*(?=\S)([^*\n]*?:)\\\*\\\*/gmu;

// Code is where a backslash is meant: a regular expression or a shell line is not damage, and the
// old writer never escaped anything inside code. Each code span becomes one space so the text on
// either side of it cannot join up into something that looks like damage.
function proseOnly(body: string): string {
  let open = "";
  return body
    .split(/\r\n?|\n/)
    .map((line) => {
      const found = FENCE.exec(line);
      const run = found?.[1] ?? "";
      const rest = found?.[2] ?? "";
      if (open) {
        if (run[0] === open[0] && run.length >= open.length && rest.trim() === "") open = "";
        return "";
      }
      // Backticks later on the same line make it inline code, not the start of a block.
      if (run && !(run[0] === "`" && rest.includes("`"))) {
        open = run;
        return "";
      }
      return line.replace(/(?<![\\`])(`+)(?!`)[^\n]*?(?<!`)\1(?!`)/g, " ");
    })
    .join("\n");
}

/** Which kinds of damage the stored text of one note still has, always in this order. */
export function damageKinds(body: string): DamageKind[] {
  const prose = proseOnly(body);
  const kinds: DamageKind[] = [];
  if (prose.includes("\\://")) kinds.push("scheme");
  if (prose.includes("\\@")) kinds.push("at");
  // search, not test: this pattern is also used to replace, and test would start where that left off.
  if (prose.search(ESCAPED_LABEL) !== -1) kinds.push("label");
  if (prose.includes(`](${PENDING_PICTURE}`)) kinds.push("picture");
  return kinds;
}

/**
 * Gives a damaged label its two real asterisks back, so the editor reads it as bold again.
 * It follows the editor's own reading rule, so the repair mends exactly the labels the editor
 * would show as bold: at the start of a line or after a space, any label; right after an opening
 * bracket or a quote, only one the app's label test passes (boldLabel.ts), because there the same
 * shape is usually code. Anything else stays exactly as stored, and the repair screen says so.
 * The narrower rule left "\*\*URL (INTERNAL):\*\*value" unrepaired, which is the very damage
 * sweep 1 found most of.
 */
export function unescapeLabels(text: string): string {
  return text.replace(ESCAPED_LABEL, (whole, lead: string, label: string) =>
    !/["'“‘([{]/u.test(lead) || isBoldLabel(label) ? `${lead}**${label}**` : whole
  );
}
