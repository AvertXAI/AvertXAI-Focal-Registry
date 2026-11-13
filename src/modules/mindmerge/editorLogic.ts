/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
/* File: src/modules/mindmerge/editorLogic.ts */
// The parts of the MindMerge editor that need no browser: how text is written to markdown, how a
// selection becomes clipboard text, and where a pasted or dropped picture goes. They live apart
// from MilkdownEditor.tsx so tests/editor.test.ts can run them against the editor's real parser and
// serializer — the notes hold connection strings and keys, and a character added or dropped on the
// way to storage is a broken credential (Jason 11-12-2026).
import { remarkCtx, remarkStringifyOptionsCtx, schemaCtx, serializerCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import type { Node as ProseNode, Slice } from "@milkdown/kit/prose/model";
import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import { $remark } from "@milkdown/kit/utils";
import { tidyMarkdown } from "./tidyMarkdown";

interface MdNode {
  type: string;
  value?: string;
  url?: string;
  title?: string | null;
  checked?: boolean | null;
  children?: MdNode[];
  position?: { start: { offset?: number } };
}

type PhrasingInfo = Record<string, unknown>;
interface StringifyState {
  /** The constructs being written, outermost first — which quote or list item this text sits in. */
  stack: string[];
  bulletCurrent?: string;
  enter: (construct: string) => () => void;
  containerPhrasing: (parent: MdNode, info: PhrasingInfo) => string;
}
type Handler = (node: MdNode, parent: MdNode | undefined, state: StringifyState, info: PhrasingInfo) => string;

const textOf = (node: MdNode): string => node.value ?? (node.children ?? []).map(textOf).join("");

/**
 * WRITING TEXT WITHOUT ESCAPES IT DOES NOT NEED.
 *
 * The stock writer escapes by pattern, not by need: `redis://user:pw@host` is stored as
 * `redis\://user:pw\@host` because a colon after "s" and an at-sign *could* start a link. The value
 * still reads correctly in the editor, but Raw, an export and anything pasted elsewhere carry the
 * backslashes. So each paragraph is written twice — escaped and plain — and the plain form is kept
 * only when the store would read it back exactly as it reads the escaped form: after the save
 * path's tidy, and in the same quote or list position. A paragraph that really needs an escape
 * (`2*3*4`, a literal `<div>`, a value ending in a backslash) keeps the form it has always had.
 */
let writingPlain = false;

function writePhrasing(paragraph: MdNode, state: StringifyState, info: PhrasingInfo, plain: boolean): string {
  const exitParagraph = state.enter("paragraph");
  const exitPhrasing = state.enter("phrasing");
  const outer = writingPlain;
  writingPlain = plain;
  try {
    return state.containerPhrasing(paragraph, info);
  } finally {
    writingPlain = outer;
    exitPhrasing();
    exitParagraph();
  }
}

/** A link the parser makes by itself from a bare address, so writing the address bare loses nothing. */
function isBareLink(node: MdNode): boolean {
  if (node.type !== "link" || node.title || node.children?.length !== 1 || node.children[0].type !== "text") return false;
  const shown = node.children[0].value ?? "";
  return /^https?:\/\/\S+$/i.test(shown) ? node.url === shown : /^www\.\S+$/i.test(shown) && node.url === `http://${shown}`;
}

function withBareLinksAsText(node: MdNode): MdNode {
  if (!node.children) return node;
  const children: MdNode[] = [];
  for (const child of node.children) {
    const next = isBareLink(child) ? { type: "text", value: textOf(child) } : withBareLinksAsText(child);
    const last = children[children.length - 1];
    if (next.type === "text" && last?.type === "text") children[children.length - 1] = { type: "text", value: `${last.value ?? ""}${next.value ?? ""}` };
    else children.push(next);
  }
  return { ...node, children };
}

/**
 * The paragraph as it will sit in the stored note: between other blocks, inside its quotes and list
 * items. Where text sits changes what it means — `[ ] x` is a checkbox only at the head of a list
 * item, `**` alone after a `*` bullet is a rule — so both forms are judged in place, not alone.
 */
function inPlace(text: string, state: StringifyState, leadsItem: boolean): string {
  const containers = state.stack.filter((construct) => construct === "blockquote" || construct === "listItem");
  // For a numbered list the writer keeps only the delimiter here and puts the number in front itself.
  const bullet = state.bulletCurrent ?? "*";
  const ownMarker = bullet === "." || bullet === ")" ? `1${bullet}` : bullet;
  let lines = text.split("\n");
  for (let depth = containers.length - 1; depth >= 0; depth--) {
    if (containers[depth] === "blockquote") {
      lines = lines.map((line) => (line ? `> ${line}` : ">"));
      continue;
    }
    const leads = leadsItem && depth === containers.length - 1;
    const marker = leads ? ownMarker : "*";
    const indent = " ".repeat(marker.length + 1);
    const body = lines.map((line, at) => (leads && at === 0 ? `${marker} ${line}` : line ? indent + line : line));
    lines = leads ? body : [`${marker} x`, "", ...body];
  }
  return ["x", "", ...lines, "", "x"].join("\n");
}

const comparable = (root: MdNode): string =>
  JSON.stringify(withBareLinksAsText(root), (key, value: unknown) => (key === "position" ? undefined : value));

/** Keyed by both placed forms; the whole note is rewritten on every change, so most paragraphs repeat. */
const readsBackTheSame = new Map<string, boolean>();

/** The places inPlace can rebuild. A table cell or a footnote gives characters a meaning it cannot see. */
const MODELLED = new Set(["blockquote", "list", "listItem"]);

function faithfulParagraph(read: (markdown: string) => MdNode): Handler {
  return (node, parent, state, info) => {
    const escaped = writePhrasing(node, state, info, false);
    const plain = writePhrasing(withBareLinksAsText(node), state, info, true);
    if (plain === escaped) return escaped;
    if (!state.stack.every((construct) => MODELLED.has(construct))) return escaped;
    // Tidy pairs code fences across the whole note, which the one-paragraph check below cannot
    // see: a bare run of three backticks would pair with the next block's opening fence and leave
    // that block's contents open to tidying.
    if (plain.includes("```")) return escaped;
    const leadsItem = parent?.type === "listItem" && parent.children?.[0] === node;
    const placedPlain = inPlace(plain, state, leadsItem);
    const placedEscaped = inPlace(escaped, state, leadsItem);
    const key = `${placedPlain}\u0000${placedEscaped}`;
    let same = readsBackTheSame.get(key);
    if (same === undefined) {
      try {
        same = comparable(read(tidyMarkdown(placedPlain))) === comparable(read(tidyMarkdown(placedEscaped)));
      } catch {
        same = false;
      }
      if (readsBackTheSame.size >= 2000) readsBackTheSame.clear();
      readsBackTheSame.set(key, same);
    }
    return same ? plain : escaped;
  };
}

/** Goes in the editor's `.config()`. A heading is not a paragraph and a table cell is passed over, so both keep the stock escaping. */
export function faithfulMarkdownConfig(ctx: Ctx): void {
  const read = (markdown: string): MdNode => {
    const remark = ctx.get(remarkCtx);
    return remark.runSync(remark.parse(markdown), markdown) as unknown as MdNode;
  };
  ctx.update(remarkStringifyOptionsCtx, (prev) => {
    const handlers = (prev.handlers ?? {}) as unknown as Record<string, Handler | undefined>;
    const escapeText = handlers.text;
    if (!escapeText) return prev;
    const text: Handler = (node, parent, state, info) => (writingPlain ? node.value ?? "" : escapeText(node, parent, state, info));
    return { ...prev, handlers: { ...handlers, text, paragraph: faithfulParagraph(read) } as unknown as typeof prev.handlers };
  });
}

/** micromark hands a tokenizer a code point, null at the end of input, or a negative value for a line ending or tab. */
type Code = number | null;
type TokenState = (code: Code) => TokenState | undefined;
interface AttentionToken { type: string; _open?: boolean; _close?: boolean }
type TokenEvent = [string, AttentionToken, unknown];
interface TokenEffects {
  enter: (type: string) => AttentionToken;
  exit: (type: string) => AttentionToken;
  consume: (code: Code) => void;
}
interface TokenContext {
  previous: Code;
  events: TokenEvent[];
  sliceSerialize: (token: AttentionToken) => string;
  parser: { constructs: { text: Record<number, TokenConstruct | TokenConstruct[] | undefined> } };
}
interface TokenConstruct {
  name?: string;
  tokenize: (this: TokenContext, effects: TokenEffects, ok: TokenState, nok: TokenState) => TokenState;
  resolveAll?: (events: TokenEvent[], context: TokenContext) => TokenEvent[];
}

const ASTERISK = 42;
const isBlank = (code: Code): boolean => code === null || code < 0 || /\s/u.test(String.fromCodePoint(code));
const isPunctuation = (code: Code): boolean => code !== null && code > 0 && /[\p{P}\p{S}]/u.test(String.fromCodePoint(code));
const isOpeningBracket = (code: Code): boolean => code === 40 || code === 91 || code === 123;

/**
 * Whether the bold this run would close began the way a label does: two asterisks at the start of
 * the line or after a space. `f(**kwargs)` and `(a)**2` open after punctuation; closing against
 * those made bold out of text nobody marked, and the asterisks vanished from the screen and from
 * a copy.
 */
function closesALabel(context: TokenContext): boolean {
  const { events } = context;
  try {
    // The last event is this run's own start.
    for (let at = events.length - 2; at >= 0; at--) {
      const [kind, token] = events[at];
      if (kind !== "enter" || token.type !== "attentionSequence" || !token._open) continue;
      const run = context.sliceSerialize(token);
      if (run.charCodeAt(0) !== ASTERISK) continue;
      const lead = events[at - 1];
      return run.length >= 2 && (!lead || /\s$/u.test(context.sliceSerialize(lead[1])));
    }
  } catch {
    // An opener that cannot be read is not one to widen the rules for.
  }
  return false;
}

/**
 * `**LABEL:**value` IS BOLD.
 *
 * CommonMark refuses to close bold when the `**` follows punctuation and is followed by a letter,
 * so a bold label typed hard against its value — `**REDIS URL (INTERNAL):**redis://…` — came back
 * from storage as literal asterisks (MM-03). The editor writes exactly that text for exactly that
 * bold, so the reader has to accept it. Only that one case is widened: two asterisks, punctuation
 * before (not an opening bracket), a letter or digit after, closing bold that began the way a
 * label does. Pairing is still the standard resolver's job.
 */
const lenientStrongClose: TokenConstruct = {
  name: "mindmergeLenientStrongClose",
  tokenize(effects, ok, nok) {
    const before = this.previous;
    let size = 0;
    const inside: TokenState = (code) => {
      if (code === ASTERISK) {
        effects.consume(code);
        size += 1;
        return inside;
      }
      if (size !== 2 || isBlank(code) || isPunctuation(code) || !closesALabel(this)) return nok(code);
      const token = effects.exit("attentionSequence");
      token._open = true;
      token._close = true;
      return ok(code);
    };
    return (code) => {
      if (!isPunctuation(before) || isOpeningBracket(before)) return nok(code);
      effects.enter("attentionSequence");
      return inside(code);
    };
  },
  resolveAll(events, context) {
    const standard = [context.parser.constructs.text[ASTERISK]].flat().find((construct) => construct?.name === "attention");
    if (standard?.resolveAll) return standard.resolveAll(events, context);
    // Without the standard resolver the asterisks would vanish from the note; keep them as text.
    for (const event of events) if (event[1].type === "attentionSequence") event[1].type = "data";
    return events;
  },
};

const lenientStrongClosePlugin = $remark("mindmergeLenientStrongClose", () =>
  function attach(this: unknown): void {
    const data = (this as { data: () => { micromarkExtensions?: unknown[] } }).data();
    (data.micromarkExtensions ??= []).push({ text: { [ASTERISK]: lenientStrongClose } });
  }
);

/**
 * `user:password@host` IS NOT AN EMAIL ADDRESS.
 *
 * The reader turns anything shaped like one into a mailto link, and the writer then wraps that
 * link in angle brackets — which is how a stored connection string grew `<…>` in the middle. An
 * address someone deliberately wrote as a link (`<a@b.c>`, `[a](mailto:…)`) starts with its own
 * bracket and is left alone.
 */
function unlinkBareEmails(node: MdNode, source: string): void {
  if (!node.children) return;
  const children: MdNode[] = [];
  for (const child of node.children) {
    unlinkBareEmails(child, source);
    const typedAt = child.position?.start.offset;
    const opener = typedAt === undefined ? "" : source.charAt(typedAt);
    const address = textOf(child);
    const bare = child.type === "link" && child.url === `mailto:${address}` && opener !== "<" && opener !== "[";
    const next = bare ? { type: "text", value: address } : child;
    const last = children[children.length - 1];
    if (next.type === "text" && last?.type === "text") last.value = `${last.value ?? ""}${next.value ?? ""}`;
    else children.push(next);
  }
  node.children = children;
}

const plainEmailPlugin = $remark("mindmergePlainEmail", () => () => (tree: unknown, file: { value: unknown }) => {
  unlinkBareEmails(tree as MdNode, String(file.value ?? ""));
});

/** Goes after the presets in the editor's `.use()` chain, so these readers run last. */
export const faithfulMarkdown = [lenientStrongClosePlugin, plainEmailPlugin].flat();

/** What a selection looks like on screen — which is what a copy must hand to another program. */
export function visibleText(slice: Slice): string {
  return slice.content.textBetween(0, slice.content.size, "\n\n", (leaf) => {
    if (leaf.type.name === "hardbreak") return leaf.attrs.isInline ? " " : "\n";
    // Inline HTML is shown as its own source, such as a <placeholder> typed in a command.
    return leaf.type.name === "html" ? String(leaf.attrs.value ?? "") : "";
  });
}

/** The same selection as markdown, for the right-click "Copy as Markdown". */
export function sliceMarkdown(ctx: Ctx, slice: Slice): string {
  const schema = ctx.get(schemaCtx);
  // Part of one line is inline content, which only a paragraph can hold.
  const content = slice.content.firstChild?.isInline ? schema.nodes.paragraph.create(null, slice.content) : slice.content;
  return ctx.get(serializerCtx)(schema.topNodeType.create(null, content)).trim();
}

/**
 * A pasted value with no spaces in it — a key, a password, an address — is kept exactly as copied.
 * Read as markdown, a `*` pair or a backslash inside it would be consumed and the secret changed.
 * A markdown link or picture is the one spaceless thing that is still meant as markdown.
 */
export function isSingleValue(text: string): boolean {
  const value = text.trim();
  return value !== "" && !/\s/.test(value) && !/^!?\[[^\]]*\]\([^)]*\)$/.test(value);
}

/**
 * Where a pasted or dropped picture goes: at the caret (or the drop point) when that is inside a
 * paragraph; otherwise in a paragraph of its own beside the block — above it when the caret is at
 * the block's start, below it anywhere else. An image inside a heading is what once wrote `====`.
 */
export function placeImage(state: EditorState, image: ProseNode, dropPos?: number): Transaction {
  const paragraph = state.schema.nodes.paragraph;
  const $at = dropPos === undefined ? state.selection.$from : state.doc.resolve(dropPos);
  if (!paragraph || $at.parent.type === paragraph) {
    return dropPos === undefined ? state.tr.replaceSelectionWith(image) : state.tr.insert(dropPos, image);
  }
  const beside = $at.depth === 0 ? $at.pos : $at.parentOffset === 0 ? $at.before($at.depth) : $at.after($at.depth);
  return state.tr.insert(beside, paragraph.create(null, image));
}

/**
 * Swaps each picture whose save has finished for its stored reference, or removes it when the save
 * was refused. Found by its token wherever it sits now — the user may have typed, or the editor may
 * have been rebuilt, since the paste. Null when nothing in this document was waiting.
 */
export function settlePendingImages(state: EditorState, settled: ReadonlyMap<string, string | null>): Transaction | null {
  const tr = state.tr;
  state.doc.descendants((node, pos) => {
    const token = node.type.name === "image" && typeof node.attrs.src === "string" ? node.attrs.src : "";
    if (!settled.has(token)) return;
    const stored = settled.get(token);
    const at = tr.mapping.map(pos);
    if (stored) tr.setNodeMarkup(at, undefined, { ...node.attrs, src: stored });
    else tr.delete(at, at + node.nodeSize);
  });
  return tr.docChanged ? tr : null;
}
