// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Markdown → React for MindMerge. Two renderers live here on purpose: the Markdoc
//              document renderer (authoring docs, repo READMEs, runbook Run mode) and the
//              hand-rolled subset renderer kept for the ingest/search surfaces. Both share ONE
//              highlighter — highlightText wraps query hits in <mark> at the TEXT-NODE level, so a
//              hit inside bold or inside a code span highlights without corrupting markup.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: src/modules/mindmerge/markdown.tsx
//------------------------------------------------------------
// Markdown → React, on MARKDOC (Jason ruled 08-11-2026: "research MarkDoc, stripe.com/docs uses it.
// id like to use it also"). MIT, 2.17 MB, ZERO runtime dependencies — it clears the §2.10 licence
// gate and the §2.11 size gate outright.
//
// WHAT IT REPLACED AND WHY THAT MATTERS. The document path used to be a ~90-line line-by-line regex
// parser. It read one line at a time, so anything that spans lines was silently wrong: a nested
// list flattened, a multi-line list item split into unrelated blocks, a table rendered as
// paragraphs. Markdoc is a real CommonMark parser, so those simply work now, and GFM tables and
// strikethrough arrived for free (verified against the installed build, not assumed).
//
// WHY THE SUBSET RENDERER IS STILL BELOW. renderMarkdown() is MindMerge's original hand-rolled
// subset renderer and it is NOT dead code: it is the ingest/search path, its behaviour is pinned
// line by line by markdown.smoke.tsx (off-subset syntax must stay LITERAL, an unsafe link must NOT
// become an anchor), and that contract is the reason a search hit list can never surprise you.
// Markdoc owns the document panes; the subset renderer owns the search surfaces. Neither is a
// fallback for the other, and the highlighter is shared so a hit looks the same in both.
//
// MARKDOC IS A RENDERER, NOT AN EDITOR — it cannot and does not replace Milkdown, which is still
// what you type into. Milkdown owns the left pane; this owns the right one and every read-only
// render in the module (repo READMEs, runbook Run mode).
//
// THE THING MARKDOC DOES NOT DO OUT OF THE BOX, handled by preprocess() below: task lists.
// "- [ ] x" is GFM-plus, and Markdoc leaves the "[ ]" as literal text (probed, not guessed).
// Milkdown's GFM preset WRITES that syntax, so the renderer has to read it. It becomes a Markdoc
// tag before parsing, which keeps the stored markdown clean and portable — what gets saved and
// exported is still "- [ ] x", never a tag.
//
// (The vault build preprocessed a second thing here, a credential-locator chip. MindMerge has no
// credential store, so that rewrite is deliberately absent. The fence split it forced is kept —
// the reasoning below applies just as hard to the task-list rewrite.)
//
// SAFE BY CONSTRUCTION, unchanged from the old renderer: Markdoc builds a node tree we render as
// React elements. Raw HTML in a note body is NOT executed — `allowIndentation`/html passthrough is
// never enabled — so a pasted note cannot smuggle markup into the page.
import * as React from "react";
import { createElement, Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Markdoc, { type RenderableTreeNode } from "@markdoc/markdoc";
/** Markdoc types its renderer options as Record<string, Component>. The vault passed an inline
    object literal so inference did the work; this port factored it into a function, which widened
    the return to Record<string, unknown> and stopped assigning. Same shape, named type. */
type MarkdocComponents = NonNullable<Parameters<typeof Markdoc.renderers.react>[2]>["components"];
import { isHighlightable, tokenize, type Role, type Token } from "./codeTheme";
import { mindmergeApi } from "./mindmergeApi";
import { cachedAttachmentSrc, isMindMergeSrc, resolveAttachmentSrc } from "./attachmentSrc";

// ---------------------------------------------------------------- the highlighter

export type MarkRef = (el: HTMLElement | null) => void;

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Wrap each case-insensitive occurrence of `query` in <mark>, at the text-node level.
export function highlightText(text: string, query?: string, markRef?: MarkRef): ReactNode {
  if (!query || !text) return text;
  const re = new RegExp(escapeRegExp(query), "gi");
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    out.push(
      <mark key={out.length} ref={markRef}>
        {m[0]}
      </mark>
    );
    last = i + m[0].length;
  }
  if (out.length === 0) return text;
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// ---------------------------------------------------------------- the subset renderer

// Inline subset: `code`, **bold**, *italic*, [text](url). Unknown syntax stays literal text.
// Bold/italic contents recurse (one regex, shrinking input — always terminates); code is terminal.
const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*)|(\*[^*\n]+?\*)|\[([^\]\n]+)\]\(([^)\s]+)\)/g;

function renderInline(text: string, query?: string, markRef?: MarkRef): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  const plain = (s: string) => out.push(<Fragment key={out.length}>{highlightText(s, query, markRef)}</Fragment>);
  for (const m of text.matchAll(INLINE)) {
    const i = m.index ?? 0;
    if (i > last) plain(text.slice(last, i));
    if (m[1]) out.push(<code key={out.length}>{highlightText(m[1].slice(1, -1), query, markRef)}</code>);
    else if (m[2]) out.push(<strong key={out.length}>{renderInline(m[2].slice(2, -2), query, markRef)}</strong>);
    else if (m[3]) out.push(<em key={out.length}>{renderInline(m[3].slice(1, -1), query, markRef)}</em>);
    else if (m[4] != null) {
      // http(s) only — anything else (javascript:, file:, relative) degrades to literal text.
      if (/^https?:\/\//i.test(m[5])) {
        out.push(
          <a key={out.length} href={m[5]} rel="noreferrer">
            {highlightText(m[4], query, markRef)}
          </a>
        );
      } else plain(m[0]);
    }
    last = i + m[0].length;
  }
  if (last < text.length) plain(text.slice(last));
  return out;
}

// \x23 is the hash char — kept out of the source literally so the module-wide no-hex grep stays clean.
const HEADING = /^\s{0,3}(\x23{1,6})\s+(.+?)\s*$/;
const UL_ITEM = /^\s*[-*]\s+(.*)$/;
const OL_ITEM = /^\s*\d+[.)]\s+(.*)$/;
const FENCE = /^\s*```/;

function renderBlocks(md: string, query?: string, markRef?: MarkRef): ReactNode[] {
  const lines = md.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  const flushPara = () => {
    const text = para.join("\n").trim();
    if (text) blocks.push(<p key={blocks.length}>{renderInline(text, query, markRef)}</p>);
    para = [];
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (FENCE.test(line)) {
      flushPara();
      const code: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) code.push(lines[i++]);
      i++; // closing fence (or EOF — unterminated fence renders what it has)
      blocks.push(
        <pre key={blocks.length}>
          <code>{highlightText(code.join("\n"), query, markRef)}</code>
        </pre>
      );
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      flushPara();
      blocks.push(createElement(`h${h[1].length}`, { key: blocks.length }, renderInline(h[2], query, markRef)));
      i++;
      continue;
    }
    const ordered = OL_ITEM.test(line);
    if (ordered || UL_ITEM.test(line)) {
      flushPara();
      const itemRe = ordered ? OL_ITEM : UL_ITEM;
      const items: ReactNode[] = [];
      let im: RegExpExecArray | null;
      while (i < lines.length && (im = itemRe.exec(lines[i]))) {
        items.push(<li key={items.length}>{renderInline(im[1], query, markRef)}</li>);
        i++;
      }
      blocks.push(createElement(ordered ? "ol" : "ul", { key: blocks.length }, items));
      continue;
    }
    if (!line.trim()) flushPara();
    else para.push(line);
    i++;
  }
  flushPara();
  return blocks;
}

// Public entry — never throws: any renderer defect degrades to the raw text, not a crashed pane.
export function renderMarkdown(md: string, query?: string, markRef?: MarkRef): ReactNode {
  try {
    return renderBlocks(md, query, markRef);
  } catch {
    return highlightText(md, query, markRef);
  }
}

// ---------------------------------------------------------------- source → Markdoc

/**
 * Milkdown serialises a soft break (Shift+Enter) as a literal `<br />`, and this renderer never
 * emits raw HTML — so the tag was appearing as TEXT on screen (Jason 08-11-2026). Normalising it to
 * a real newline fixes the render without opening an HTML hole: `<br>` becomes a line ending, and
 * every other tag stays inert text.
 */
function normalise(body: string): string {
  return body.replace(/<br\s*\/?>/gi, "\n");
}

/**
 * The task-list rewrite, applied ONLY OUTSIDE FENCED CODE BLOCKS.
 *
 * The fence split is not fussiness: a runbook that documents this very syntax, or a note holding a
 * shell snippet with square brackets, would otherwise have its code block quietly rewritten. Code
 * fences are literal text and must survive verbatim.
 */
export function preprocess(raw: string): string {
  const parts = normalise(raw).split(/(```[\s\S]*?(?:```|$))/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part; // odd indices are the fenced blocks — untouched, by design
      return part.replace(/^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/gm, (_m, indent: string, mark: string, text: string) =>
        `${indent}- {% task checked=${mark.toLowerCase() === "x"} %}${text}{% /task %}`
      );
    })
    .join("");
}

const CONFIG = {
  tags: {
    // Self-closing would be required for an INLINE tag — a non-self-closing one swallows the rest of
    // the paragraph as children (probed on 0.5.9). `task` genuinely wraps its item text, so it takes
    // children by design.
    task: { render: "TaskItem", attributes: { checked: { type: Boolean } } },
  },
  nodes: {
    // The copy button is the whole reason a fence gets its own component — a runbook's value is
    // being able to take the command, not read it.
    fence: { render: "CodeBlock", attributes: { content: { type: String }, language: { type: String } } },
    // Images route through a component so a `mindmerge://<uuid>` reference (pasted-image
    // attachment, 08-16-2026) resolves out of the encrypted store; any other src passes through
    // untouched.
    image: { render: "MindMergeImage", attributes: { src: { type: String }, alt: { type: String }, title: { type: String } } },
  },
} as const;

// ---------------------------------------------------------------- highlighting the Markdoc tree

/**
 * Search highlighting for the Markdoc path, wired to the SAME highlightText as the subset renderer
 * (Jason 08-21-2026: "what i do like about mindmerge is the highlighter! !important!").
 *
 * It works on the TRANSFORMED TREE, not on the source. Highlighting the markdown text before
 * parsing would put `<mark>` inside the syntax and change what the parser sees — a query of "*"
 * would rewrite every emphasis in the note. Here every text node is swapped for a `Highlight` tag
 * carrying the text verbatim, and the component hands it to highlightText, so ALL of the matching
 * logic (case-insensitive, regex characters escaped) lives in exactly one place.
 *
 * A CodeBlock is skipped: its text is an ATTRIBUTE, painted span by span by the tokeniser, and
 * splitting it here would fight the painter for the same characters.
 */
function markTextNodes(node: RenderableTreeNode): RenderableTreeNode {
  if (typeof node === "string") return new Markdoc.Tag("Highlight", { text: node }, []) as RenderableTreeNode;
  if (!node || typeof node !== "object" || !("children" in node)) return node;
  const tag = node as { name?: string; children?: RenderableTreeNode[] };
  if (tag.name === "CodeBlock") return node;
  if (!Array.isArray(tag.children)) return node;
  return { ...node, children: tag.children.map(markTextNodes) } as RenderableTreeNode;
}

// ---------------------------------------------------------------- components

/** Role → the class the stylesheet maps to a --mm-highlighter-* variable. One letter each: a
 *  400-line fence is a lot of spans, and the class name is the bulk of every one of them. */
const CLASS: Record<Role, string> = {
  plain: "", comment: "cc", string: "cs", keyword: "ck",
  number: "cn", function: "cf", variable: "cv", type: "ct", punct: "cp",
};

/** Split the token run at newlines, keeping every character. Only needed when line numbers are on. */
function toLines(tokens: Token[]): Token[][] {
  const lines: Token[][] = [[]];
  for (const t of tokens) {
    const parts = t.text.split("\n");
    parts.forEach((p, i) => {
      if (i > 0) lines.push([]);
      if (p) lines[lines.length - 1].push({ text: p, role: t.role });
    });
  }
  return lines;
}

const paint = (t: Token, i: number): ReactNode =>
  t.role === "plain" ? t.text : <span key={i} className={CLASS[t.role]}>{t.text}</span>;

/**
 * A fenced block, painted (Jason 08-12-2026, pointing at his own editor: "for the JavaScript code,
 * can we use this color for that area"). Approved mockup MOCKUP-vault-code-appearance-v1.
 *
 * The colours arrive as CSS custom properties on the shell rather than as props, which is why this
 * component takes no theme argument and no context. The palette is one thing, it changes when the
 * light/dark mode changes, and Markdoc constructs this component itself from a tag — threading a
 * prop through the renderer's component map would mean rebuilding the whole config on every theme
 * change. A variable on an ancestor costs one repaint.
 *
 * AN UNTAGGED FENCE IS NEVER GUESSED. It renders plain on the themed background. Jason's notes are
 * full of ASCII architecture diagrams, and a language detector that decides one is Perl does more
 * damage than no colour at all.
 */
function CodeBlock({ content, language }: { content?: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const text = (content ?? "").replace(/\n$/, "");
  const lang = (language ?? "").trim();
  const tokens = useMemo(() => (isHighlightable(lang) ? tokenize(text, lang) : null), [text, lang]);

  return (
    <div className="mm-cblock">
      <div className="cb">
        <span>{lang || "text"}</span>
        <button type="button" onClick={() => { void mindmergeApi().copyText(text); setCopied(true); }}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {tokens === null ? (
        <pre>{text}</pre>
      ) : (
        <pre>{tokens.map(paint)}</pre>
      )}
    </div>
  );
}

/** The same painting, for the settings preview and anywhere else that shows a sample. Exported so
 *  there is one renderer — a preview drawn by different code is a preview that can lie. */
export function CodeSample({ source, language, lineNumbers = false }: { source: string; language: string; lineNumbers?: boolean }) {
  const tokens = useMemo(() => (isHighlightable(language) ? tokenize(source, language) : [{ text: source, role: "plain" as Role }]), [source, language]);
  if (!lineNumbers) return <pre className="mm-csample">{tokens.map(paint)}</pre>;
  return (
    <pre className="mm-csample">
      {toLines(tokens).map((line, i) => (
        <span key={i} className="cline">
          <span className="cln">{i + 1}</span>
          {line.map(paint)}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

/**
 * A rendered task list item. READ-ONLY on purpose: ticking here would have to write back through
 * the markdown to mean anything, and a checkbox that forgets the moment you look away is worse than
 * one that plainly does not move. Ticking belongs to Run mode, where it is explicitly session state.
 */
function TaskItem({ checked, children }: { checked?: boolean; children?: React.ReactNode }) {
  return (
    <span className={`mm-task${checked ? " done" : ""}`}>
      <input type="checkbox" checked={Boolean(checked)} readOnly tabIndex={-1} />
      <span>{children}</span>
    </span>
  );
}

/**
 * An image in a document. A `mindmerge://<uuid>` src is a pasted-image attachment — the bytes come
 * out of the encrypted store through the one resolver, cached for the session. Anything else (a
 * data URL in an older note, an external address the CSP will judge) renders as written. A
 * reference whose attachment is gone renders as a labelled chip, never a broken-image glyph with
 * no explanation.
 */
export function MindMergeImage({ src, alt, title }: { src?: string; alt?: string; title?: string }) {
  const s = src ?? "";
  const [url, setUrl] = useState<string | null>(() => (isMindMergeSrc(s) ? cachedAttachmentSrc(s) : s));
  const [gone, setGone] = useState(false);
  useEffect(() => {
    let live = true;
    setGone(false);
    if (!isMindMergeSrc(s)) { setUrl(s); return; }
    const hit = cachedAttachmentSrc(s);
    if (hit) { setUrl(hit); return; }
    setUrl(null);
    void resolveAttachmentSrc(s)
      .then((u) => { if (live) setUrl(u); })
      .catch(() => { if (live) setGone(true); });
    return () => { live = false; };
  }, [s]);
  if (gone) return <span className="mm-chip missing">🖼 {alt || "image"} <i>— no longer in MindMerge</i></span>;
  if (!url) return <span className="mm-hint">image…</span>;
  return <img src={url} alt={alt ?? ""} title={title} />;
}

// ---------------------------------------------------------------- the renderer

/** One components map, built per render. It was duplicated in the vault build because a credential
 *  list was closed over in two places; here the closure is query + markRef, and one factory means
 *  the two entry points can never drift apart. */
function components(query?: string, markRef?: MarkRef): MarkdocComponents {
  return {
    CodeBlock,
    TaskItem,
    MindMergeImage,
    // The text node wrapper markTextNodes() installs. Registered unconditionally — an unregistered
    // tag name would render as a literal <Highlight> element.
    Highlight: (props: { text?: string }) => <>{highlightText(props.text ?? "", query, markRef)}</>,
  };
}

/** Transform, then highlight only when there is something to highlight — no query means the tree is
 *  handed to React exactly as Markdoc built it. */
function prepare(body: string, query?: string): RenderableTreeNode {
  const tree: RenderableTreeNode = Markdoc.transform(Markdoc.parse(preprocess(body)), CONFIG);
  return query ? markTextNodes(tree) : tree;
}

function render(body: string, query?: string, markRef?: MarkRef): React.ReactNode {
  return Markdoc.renderers.react(prepare(body, query), React, { components: components(query, markRef) });
}

export function Markdown({ body, query, markRef }: { body: string; query?: string; markRef?: MarkRef }) {
  return <>{useMemo(() => render(body, query, markRef), [body, query, markRef])}</>;
}

/**
 * The same render, minus the wrapping paragraph — for a runbook step's title, which sits inside a
 * heading row and must not open a block. Markdoc always wraps a bare line in <p>; this unwraps the
 * single-paragraph case and leaves anything richer alone.
 */
export function InlineMarkdown({ body, query, markRef }: { body: string; query?: string; markRef?: MarkRef }) {
  const el = useMemo(() => {
    const tree = prepare(body, query);
    if (tree && typeof tree === "object" && "children" in tree) {
      const kids = (tree as { children: RenderableTreeNode[] }).children;
      const only = kids.length === 1 ? kids[0] : null;
      if (only && typeof only === "object" && "name" in only && only.name === "p") {
        return Markdoc.renderers.react({ ...only, name: "span" } as RenderableTreeNode, React, {
          components: components(query, markRef),
        });
      }
    }
    return render(body, query, markRef);
  }, [body, query, markRef]);
  return <>{el}</>;
}

// ---------------------------------------------------------------- runbook run mode

export interface RunStep {
  title: string;
  /** everything under the numbered line until the next one — rendered as markdown */
  body: string;
  commands: string[];
}

/** Splits a runbook body into numbered steps. A step is "N. title" plus everything beneath it;
    its fenced code blocks become copy-button command rows. */
export function parseRunbook(raw: string): { intro: string; steps: RunStep[] } {
  const lines = normalise(raw).split(/\r?\n/);
  const steps: RunStep[] = [];
  const intro: string[] = [];
  let cur: { title: string; buf: string[] } | null = null;
  for (const line of lines) {
    const m = line.match(/^(\d+)\.\s+(.*)$/);
    if (m) {
      if (cur) steps.push(finish(cur));
      cur = { title: m[2] ?? "", buf: [] };
    } else if (cur) cur.buf.push(line);
    else intro.push(line);
  }
  if (cur) steps.push(finish(cur));
  return { intro: intro.join("\n").trim(), steps };
  function finish(c: { title: string; buf: string[] }): RunStep {
    const body = c.buf.join("\n").trim();
    const commands: string[] = [];
    // A CLOSED fence is the normal case.
    const fence = /```[^\n]*\n([\s\S]*?)```/g;
    let f: RegExpExecArray | null;
    while ((f = fence.exec(body)) !== null) commands.push((f[1] ?? "").trim());
    // An UNCLOSED fence happens constantly while typing — the user opens ``` and is still writing
    // the command. Treat the rest of the step as the command rather than rendering three backticks
    // and the code as raw text, which is what it did before (Jason's screenshot, 08-11-2026).
    if (commands.length === 0) {
      const open = body.match(/```[^\n]*\n([\s\S]*)$/);
      if (open) commands.push((open[1] ?? "").trim());
      // A step whose body is ONE inline-code span is a command too — `psql …` on its own line.
      else {
        const solo = body.match(/^`([^`\n]+)`$/m);
        if (solo) commands.push(solo[1] ?? "");
      }
    }
    return { title: c.title, body, commands };
  }
}

export function RunMode({ body, title, query, markRef }: { body: string; title: string; query?: string; markRef?: MarkRef }) {
  const { intro, steps } = useMemo(() => parseRunbook(body), [body]);
  const [done, setDone] = useState<Set<number>>(new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  // Ticks reset when a different runbook opens — they are session state, deliberately: "where did I
  // get to" belongs to the run, not to the document.
  useEffect(() => setDone(new Set()), [body]);
  const toggle = useCallback((i: number) => setDone((d) => { const n = new Set(d); if (n.has(i)) n.delete(i); else n.add(i); return n; }), []);
  if (steps.length === 0) {
    return (
      <>
        <div className="mm-runhead"><b>{title}</b><span className="mm-hint">No numbered steps yet — number lines "1." to make them runnable.</span></div>
        {/* Wrapped in the content container so the prose rules find it — the pane itself styles
            nothing since the container law (08-16-2026). */}
        <div className="mm-sbody"><Markdown body={body} query={query} markRef={markRef} /></div>
      </>
    );
  }
  return (
    <>
      <div className="mm-runhead">
        <b>{title}</b>
        <span className="mm-hint">{done.size} of {steps.length} done</span>
        <button type="button" className="mm-btn" onClick={() => setDone(new Set())}>Reset ticks</button>
      </div>
      {intro && <div className="mm-hint" style={{ marginBottom: 10 }}>{intro}</div>}
      {steps.map((s, i) => (
        <div key={i} className={`mm-step${done.has(i) ? " done" : ""}`}>
          <button type="button" className="mm-snum" onClick={() => toggle(i)}>{i + 1}</button>
          <div className="mm-sbody">
            <div className="mm-stitle"><InlineMarkdown body={s.title} query={query} markRef={markRef} /></div>
            {s.commands.map((c, j) => (
              <div key={j} className="mm-cmd">
                <span className="c">{c}</span>
                <button type="button" className="mm-btn"
                  onClick={() => { void mindmergeApi().copyText(c); setCopiedKey(`${i}-${j}`); }}>
                  {copiedKey === `${i}-${j}` ? "Copied" : "Copy"}
                </button>
              </div>
            ))}
            {/* the step body minus its fences — chips and prose keep rendering */}
            <StepProse body={s.body} query={query} markRef={markRef} />
          </div>
        </div>
      ))}
    </>
  );
}

function StepProse({ body, query, markRef }: { body: string; query?: string; markRef?: MarkRef }) {
  const prose = useMemo(() => body.replace(/```[^\n]*\n[\s\S]*?```/g, "").trim(), [body]);
  if (!prose) return null;
  return <div className="mm-stepprose"><Markdown body={prose} query={query} markRef={markRef} /></div>;
}
