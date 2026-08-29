// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: The formatting repair — five deterministic rules that undo hard-break/escape damage
//              stored by an older paste path, so headings can be headings again and the invisible
//              trailing backslashes stop regenerating on every save. Fenced code passes through
//              byte-identical.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: src/modules/mindmerge/tidyMarkdown.ts
//------------------------------------------------------------
// THE FORMATTING REPAIR (Jason 08-16-2026: "notice how theres a ' \ ' before and after a new line…
// this is causing bugs, it needs to be removed… i cant see the ' \ ' to delete it, because its
// hidden from me").
//
// WHERE THE DAMAGE CAME FROM, so this file is not mistaken for a general prettifier: before the
// paste path was fixed, screenshots and rich text arrived through ProseMirror's HTML paste, which
// minted hard-break nodes (serialised as a trailing `\`) instead of paragraph breaks, and literal
// `#` text inside those glued paragraphs was correctly escaped to `\#` on save. The result is a
// document where nothing can become a heading, every line ends in an invisible `\`, and the two
// parsers (Milkdown editing, Markdoc rendering) legitimately disagree. New pastes no longer
// produce any of it; this repairs what already got stored.
//
// WHY THE DAMAGE REGENERATED (found from Jason's Raw screenshot 08-16-2026, second round): the
// old paste glued HARD BREAKS INSIDE HEADING NODES. A heading containing a line-join cannot be
// written `# `-style, so the serializer is FORCED to write it setext (the ==== underline) and to
// escape its text (`1\.`, `\#`) — and it re-mints all of it on every save while those nodes
// exist. Killing the joins and the setext spelling is what makes the repair STICK.
//
// FIVE RULES, DETERMINISTIC, NOTHING ELSE — a tidy that "improves" content it does not understand
// is how user text gets eaten:
//   1. A line that is only `\` was an empty forced join → a blank line. A line that is only
//      `<br />` is the SAME break in its other spelling — the serializer writes a hard break it
//      cannot hang off trailing text as the HTML tag (seen on device 08-16-2026 PM) → also blank.
//   2. A trailing `\` was a forced join → the line stands alone; a paragraph break follows.
//   3. Escaped syntax at line START gets its meaning back: `\#` headings, `\---` rules,
//      `1\.` numbered items, `\-`/`\*`/`\+` bullets. Mid-line escapes are the user's own and
//      are never touched.
//   4. A `====` underline under an ATX heading or an image line is pure debris → dropped; under
//      nothing at all it is meaningless → dropped.
//   5. A `====` (or `----`) underline under ORDINARY text is a setext heading — same meaning,
//      different spelling. It becomes the `#` (or `##`) form: identical document per CommonMark,
//      and the only way the underline is gone for good. A `---` under a BLANK line stays exactly
//      what it is — a horizontal rule.
// Fenced code blocks pass through byte-identical: a fence documenting this very syntax is exactly
// the thing a repair must never touch (same split as markdown.tsx preprocess()).

function tidyChunk(chunk: string): string {
  const lines = chunk.split("\n");
  const out: string[] = [];
  // True only when the LAST pushed line is a blank that rule 2 inserted — the one blank the
  // setext lookback may step over. A blank the user wrote must stop the lookback dead, or a
  // legitimate `Body.\n\n---` horizontal rule would convert into `## Body.` and eat content.
  let lastBlankFromJoin = false;
  for (const raw of lines) {
    let line = raw;
    // 1. only a hard-break escape (either spelling) → the blank line that was meant
    if (line.trim() === "\\" || /^<br\s*\/?>$/i.test(line.trim())) {
      out.push("");
      lastBlankFromJoin = false;
      continue;
    }
    // 2. trailing single `\` (not an escaped backslash) → drop it, break the paragraph after
    let brokeJoin = false;
    if (/\\$/.test(line) && !/\\\\$/.test(line)) {
      line = line.replace(/[ \t]*\\$/, "");
      brokeJoin = true;
    }
    // 3. escaped syntax at line start gets its meaning back. An UNESCAPED `\---` was escaped
    // precisely because it is a horizontal rule, not a setext underline — that meaning is
    // settled, so rule 5 must not reinterpret it.
    const wasEscapedRule = /^(\s*)\\(---+\s*)$/.test(line);
    line = line.replace(/^(\s*)\\(#{1,6}[ \t])/, "$1$2");
    line = line.replace(/^(\s*)\\(---+\s*)$/, "$1$2");
    line = line.replace(/^(\s*\d+)\\\.(\s)/, "$1.$2");
    line = line.replace(/^(\s*)\\([-*+][ \t])/, "$1$2");

    // 4 + 5. setext underlines
    const isEq = /^\s*=+\s*$/.test(line);
    const isDash = !wasEscapedRule && /^\s*-{2,}\s*$/.test(line);
    if (isEq || isDash) {
      let j = out.length - 1;
      if (j > 0 && out[j] === "" && lastBlankFromJoin) j -= 1; // step over rule 2's break only
      const prev = j >= 0 ? out[j] : "";
      if (prev !== "") {
        if (/^\s*#/.test(prev) || /^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(prev)) continue; // debris
        out[j] = `${isEq ? "#" : "##"} ${prev.trim()}`; // setext → ATX, same heading
        out.length = j + 1; // and the blank rule 2 slid between the pair goes with it
        out.push("");
        lastBlankFromJoin = false;
        continue;
      }
      if (isEq) continue; // `====` under nothing means nothing
      // `----` under a blank line falls through: that is a horizontal rule, kept as written
    }

    out.push(line);
    lastBlankFromJoin = false;
    if (brokeJoin) {
      out.push("");
      lastBlankFromJoin = true;
    }
  }
  return out.join("\n");
}

export function tidyMarkdown(src: string): string {
  const parts = src.replace(/\r\n?/g, "\n").split(/(```[\s\S]*?(?:```|$))/g);
  return parts
    .map((part, i) => (i % 2 === 1 ? part : tidyChunk(part)))
    .join("")
    .replace(/\n{3,}/g, "\n\n");
}
