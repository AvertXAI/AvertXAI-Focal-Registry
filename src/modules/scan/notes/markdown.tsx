/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Markdown → React for Scan Notes. A COPY of the Vault's Markdoc renderer (src/modules/vault/
// markdown.tsx) with the encryption removed — that is the whole brief for this file.
//
// WHAT CAME ACROSS: the Markdoc pipeline itself, the `<br />` normalisation, the fence-aware
// preprocess, task lists (GFM-plus, which Markdoc leaves as literal "[ ]" text unless rewritten),
// and the fenced-code copy button.
//
// WHAT DID NOT, and why each one is an encryption seam rather than a feature we chose to drop:
//   · the @[[vault:Label]] credential chip — it exists to pull a secret through the one logged read.
//     Scan Notes has no secrets: these rows are plaintext in the shared org database by ruling.
//   · vault:// image resolution — attachments live in the encrypted store behind a derived key.
//     An image here is whatever the author wrote, judged by the page's own Content Security Policy.
//   · the runbook Run mode — a Vault feature, not a photographer's folder note.
//   · the codeTheme tokenizer (22 KB) — syntax highlighting for a folder note is weight with no
//     reader. Fences render plain on the themed background, which is what the Vault does anyway for
//     an untagged fence. ponytail: import codeTheme if a user ever asks for coloured code here.
//
// SAFE BY CONSTRUCTION, unchanged from the original: Markdoc builds a node tree rendered as React
// elements. Raw HTML in a note body is NOT executed — html passthrough is never enabled — so a
// pasted note cannot smuggle markup into the page.
import * as React from "react";
import { useMemo, useState } from "react";
import Markdoc, { type RenderableTreeNode } from "@markdoc/markdoc";

/** Milkdown serialises a soft break (Shift+Enter) as a literal `<br />`, and this renderer never
 *  emits raw HTML — so the tag would appear as TEXT on screen. Normalising it to a real newline
 *  fixes the render without opening an HTML hole. */
function normalise(body: string): string {
  return body.replace(/<br\s*\/?>/gi, "\n");
}

/**
 * Task lists, rewritten OUTSIDE FENCED CODE BLOCKS only.
 *
 * The fence split is not fussiness: a note holding a shell snippet with square brackets would
 * otherwise have its code block quietly rewritten. Code fences are literal text and must survive
 * verbatim. What gets SAVED is still "- [ ] x" — the tag exists only between parse and render.
 */
export function preprocess(raw: string): string {
  return normalise(raw)
    .split(/(```[\s\S]*?(?:```|$))/g)
    .map((part, i) =>
      i % 2 === 1 // odd indices are the fenced blocks — untouched, by design
        ? part
        : part.replace(
            /^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/gm,
            (_m, indent: string, mark: string, text: string) =>
              `${indent}- {% task checked=${mark.toLowerCase() === "x"} %}${text}{% /task %}`
          )
    )
    .join("");
}

const CONFIG = {
  tags: {
    task: { render: "TaskItem", attributes: { checked: { type: Boolean } } },
  },
  nodes: {
    // The copy button is the whole reason a fence gets its own component.
    fence: { render: "CodeBlock", attributes: { content: { type: String }, language: { type: String } } },
  },
} as const;

function CodeBlock({ content, language }: { content?: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const text = (content ?? "").replace(/\n$/, "");
  return (
    <div className="scannotes-cblock">
      <div className="cb">
        <span>{(language ?? "").trim() || "text"}</span>
        {/* The renderer's own clipboard — no IPC round trip for a string the page already holds. */}
        <button type="button" onClick={() => { void navigator.clipboard.writeText(text); setCopied(true); }}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>{text}</pre>
    </div>
  );
}

/**
 * A rendered task list item. READ-ONLY on purpose: ticking here would have to write back through
 * the markdown to mean anything, and a checkbox that forgets the moment you look away is worse than
 * one that plainly does not move. Tick it in the editor, where the change is real.
 */
function TaskItem({ checked, children }: { checked?: boolean; children?: React.ReactNode }) {
  return (
    <span className={`scannotes-task${checked ? " done" : ""}`}>
      <input type="checkbox" checked={Boolean(checked)} readOnly tabIndex={-1} />
      <span>{children}</span>
    </span>
  );
}

const COMPONENTS = { CodeBlock, TaskItem };

export function Markdown({ body }: { body: string }) {
  return (
    <>
      {useMemo(
        () =>
          Markdoc.renderers.react(
            Markdoc.transform(Markdoc.parse(preprocess(body)), CONFIG) as RenderableTreeNode,
            React,
            { components: COMPONENTS }
          ),
        [body]
      )}
    </>
  );
}
