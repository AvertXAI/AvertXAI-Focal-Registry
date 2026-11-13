/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// What a repair would store for a damaged note (MM-09): the label fix, then the same read, write
// and Tidy that a save from the editor runs. It is built on a second editor that is never shown,
// so the After on the repair screen is made by the code that stores notes, not by a look-alike
// that could drift away from it.
import { Editor, parserCtx, remarkCtx, rootCtx, serializerCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { EditorState } from "@milkdown/kit/prose/state";
import { faithfulMarkdown, faithfulMarkdownConfig } from "./editorLogic";
import { PENDING_PICTURE, unescapeLabels } from "./noteDamage";
import { tidyMarkdown } from "./tidyMarkdown";

interface MdNode {
  type: string;
  children?: MdNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

export interface Repairer {
  /** The text a save of the repaired note stores. dropPicture also takes out a picture that never arrived. */
  repair: (stored: string, dropPicture?: boolean) => string;
  destroy: () => void;
}

/**
 * `root` is a page element that is never put on screen. Inside a window the editor needs one to
 * start, and without it it would draw itself on the page. Tests have no page and pass nothing: the
 * reader and the writer are ready before the missing page is noticed, as in tests/editor.test.ts.
 */
export async function createRepairer(root?: HTMLElement): Promise<Repairer> {
  const editor = Editor.make()
    .config((ctx) => {
      if (root) ctx.set(rootCtx, root);
      faithfulMarkdownConfig(ctx);
    })
    .use(commonmark)
    .use(gfm)
    .use(faithfulMarkdown);
  await editor.create().catch(() => undefined);
  const ctx = editor.ctx;
  const parse = (markdown: string): ProseNode => ctx.get(parserCtx)(markdown);
  const write = (doc: ProseNode): string => ctx.get(serializerCtx)(doc);

  // Code and raw HTML are found by the editor's own reader, not by a pattern of ours, so a
  // backslash that is meant literally is never taken out. Everything between them is prose.
  const mendLabels = (stored: string): string => {
    if (!stored.includes("\\*\\*")) return stored;
    // The reader drops a leading byte-order mark before it starts counting, so its positions run one short.
    const shift = stored.charCodeAt(0) === 0xfeff ? 1 : 0;
    let out = "";
    let at = 0;
    const walk = (node: MdNode): void => {
      if (node.type !== "code" && node.type !== "inlineCode" && node.type !== "html") return void node.children?.forEach(walk);
      const from = node.position?.start.offset;
      const to = node.position?.end.offset;
      // Without its place in the text a piece of code cannot be stepped around, and guessing could change it.
      if (from === undefined || to === undefined) throw new Error("repair: code without a position");
      out += unescapeLabels(stored.slice(at, from + shift)) + stored.slice(from + shift, to + shift);
      at = to + shift;
    };
    walk(ctx.get(remarkCtx).parse(stored) as unknown as MdNode);
    return out + unescapeLabels(stored.slice(at));
  };

  const withoutPendingPictures = (doc: ProseNode): ProseNode => {
    const tr = EditorState.create({ doc }).tr;
    doc.descendants((node, pos, parent) => {
      if (node.type.name !== "image" || !String(node.attrs.src).startsWith(PENDING_PICTURE)) return;
      // A picture alone on its line takes the line with it: the emptied paragraph would be saved as a blank line of its own.
      const line = parent && parent.type.name === "paragraph" && parent.childCount === 1 ? parent : null;
      const from = tr.mapping.map(line ? pos - 1 : pos);
      tr.delete(from, from + (line ?? node).nodeSize);
    });
    return tr.doc;
  };

  return {
    repair: (stored, dropPicture = false) => {
      const doc = parse(mendLabels(stored));
      return tidyMarkdown(write(dropPicture ? withoutPendingPictures(doc) : doc));
    },
    destroy: () => void editor.destroy().catch(() => undefined),
  };
}

interface Row {
  a?: string;
  b?: string;
}

/**
 * The lines that differ between two texts, each with one line of context, for the Before and
 * After boxes. A stretch that is the same in both is left out and marked with "⋯".
 */
export function changedLines(before: string, after: string): { before: string; after: string } {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  const n = a.length - head - tail;
  const m = b.length - head - tail;

  // One row per line of the two texts laid side by side. A row only one side has is a change.
  const rows: Row[] = a.slice(0, head).map((line) => ({ a: line, b: line }));
  if (n * m > 4_000_000) {
    // ponytail: the table below is lines × lines. Past four million cells the whole middle is
    // shown as changed instead of being lined up; a real diff routine if notes that long need it.
    for (let i = 0; i < n; i += 1) rows.push({ a: a[head + i] });
    for (let j = 0; j < m; j += 1) rows.push({ b: b[head + j] });
  } else {
    // same[i * w + j] = how many lines a[i..] and b[j..] can keep in common, in order.
    const w = m + 1;
    const same = new Uint16Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        same[i * w + j] = a[head + i] === b[head + j] ? same[(i + 1) * w + j + 1] + 1 : Math.max(same[(i + 1) * w + j], same[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[head + i] === b[head + j]) {
        rows.push({ a: a[head + i], b: b[head + j] });
        i += 1;
        j += 1;
      } else if (j >= m || (i < n && same[(i + 1) * w + j] >= same[i * w + j + 1])) {
        rows.push({ a: a[head + i] });
        i += 1;
      } else {
        rows.push({ b: b[head + j] });
        j += 1;
      }
    }
  }
  for (const line of a.slice(a.length - tail)) rows.push({ a: line, b: line });

  const changed = (row: Row | undefined): boolean => row !== undefined && (row.a === undefined || row.b === undefined);
  const lines = { before: [] as string[], after: [] as string[] };
  let skipped = false;
  const markSkipped = (): void => {
    if (!skipped) return;
    lines.before.push("⋯");
    lines.after.push("⋯");
    skipped = false;
  };
  rows.forEach((row, k) => {
    if (!changed(row) && !changed(rows[k - 1]) && !changed(rows[k + 1])) {
      skipped = true;
      return;
    }
    markSkipped();
    if (row.a !== undefined) lines.before.push(row.a);
    if (row.b !== undefined) lines.after.push(row.b);
  });
  if (lines.before.length + lines.after.length > 0) markSkipped();
  return { before: lines.before.join("\n"), after: lines.after.join("\n") };
}
