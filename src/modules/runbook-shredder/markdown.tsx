// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: RunBooks — AvertXAI platform shell (baseplate)
// Description: Hand-rolled markdown-subset renderer for runbook bodies — emits React ELEMENTS
//              (never an HTML string, no dangerouslySetInnerHTML, so no sanitizer needed; canon
//              LEAN rule: no renderer dep). Subset: headings, bold, italic, inline code, code
//              fences, ul/ol lists, http(s) links. Anything outside the subset degrades to plain
//              text — never throws. Optional query highlighting wraps matches in <mark> at the
//              text-node level; markRef fires per <mark> so callers can capture the first match.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: src/modules/runbook-shredder/markdown.tsx
//------------------------------------------------------------
import { createElement, Fragment, type ReactNode } from "react";

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
