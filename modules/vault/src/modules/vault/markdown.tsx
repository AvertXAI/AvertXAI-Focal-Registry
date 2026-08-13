/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Markdown → React, on MARKDOC (Jason ruled 08-11-2026: "research MarkDoc, stripe.com/docs uses it.
// id like to use it also"). MIT, 2.17 MB, ZERO runtime dependencies — it clears the §2.10 licence
// gate and the §2.11 size gate outright.
//
// WHAT IT REPLACED AND WHY THAT MATTERS. This file used to hold a ~90-line line-by-line regex
// parser. It read one line at a time, so anything that spans lines was silently wrong: a nested
// list flattened, a multi-line list item split into unrelated blocks, a table rendered as
// paragraphs. Markdoc is a real CommonMark parser, so those simply work now, and GFM tables and
// strikethrough arrived for free (verified against the installed build, not assumed).
//
// MARKDOC IS A RENDERER, NOT AN EDITOR — it cannot and does not replace Milkdown, which is still
// what you type into. Milkdown owns the left pane; this owns the right one and every read-only
// render in the module (repo READMEs, runbook Run mode).
//
// THE TWO THINGS MARKDOC DOES NOT DO OUT OF THE BOX, both handled by preprocess() below:
//   1. The vault chip @[[vault:Label]] — not markdown at all, it is ours.
//   2. Task lists — "- [ ] x" is GFM-plus, and Markdoc leaves the "[ ]" as literal text (probed,
//      not guessed). Milkdown's GFM preset WRITES that syntax, so the renderer has to read it.
// Both become Markdoc tags before parsing, which keeps the stored markdown clean and portable —
// what gets saved and exported is still "- [ ] x", never a tag.
//
// SAFE BY CONSTRUCTION, unchanged from the old renderer: Markdoc builds a node tree we render as
// React elements. Raw HTML in a note body is NOT executed — `allowIndentation`/html passthrough is
// never enabled — so a pasted note cannot smuggle markup into the page.
import * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Markdoc, { type RenderableTreeNode } from "@markdoc/markdoc";
import { vaultApi, type VaultSecretMeta } from "./vaultApi";

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

/** Markdoc attribute strings are quoted — a label containing a quote would break the tag. */
function quote(s: string): string {
  return JSON.stringify(s);
}

/**
 * The two vault-specific rewrites, applied ONLY OUTSIDE FENCED CODE BLOCKS.
 *
 * The fence split is not fussiness: a runbook that documents this very syntax, or a note holding a
 * shell snippet with square brackets, would otherwise have its code block quietly rewritten. Code
 * fences are literal text and must survive verbatim.
 *
 * ESCAPED FORM IS ACCEPTED TOO. ProseMirror's markdown serializer escapes `[` in plain text, so a
 * chip typed into Milkdown can come back out as `@\[\[vault:X\]\]`. Matching both forms costs one
 * optional backslash per bracket and means a chip cannot be broken by a round-trip through the
 * editor — which is exactly the kind of thing that only shows up on device, days later.
 */
export function preprocess(raw: string): string {
  const parts = normalise(raw).split(/(```[\s\S]*?(?:```|$))/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part; // odd indices are the fenced blocks — untouched, by design
      return part
        .replace(/@\\?\[\\?\[vault:([^\]\\]+)\\?\]\\?\]/g, (_m, label: string) => `{% vault label=${quote(label.trim())} /%}`)
        .replace(/^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/gm, (_m, indent: string, mark: string, text: string) =>
          `${indent}- {% task checked=${mark.toLowerCase() === "x"} %}${text}{% /task %}`
        );
    })
    .join("");
}

const CONFIG = {
  tags: {
    // Self-closing — a non-self-closing inline tag swallows the rest of the paragraph as children
    // (probed on 0.5.9; the sentence after a chip vanished into it).
    vault: { render: "VaultChip", selfClosing: true, attributes: { label: { type: String } } },
    task: { render: "TaskItem", attributes: { checked: { type: Boolean } } },
  },
  nodes: {
    // The copy button is the whole reason a fence gets its own component — a runbook's value is
    // being able to take the command, not read it.
    fence: { render: "CodeBlock", attributes: { content: { type: String }, language: { type: String } } },
  },
} as const;

// ---------------------------------------------------------------- components

/** The credential chip — a note REFERENCES an entry by label; the value arrives only through the
    one logged read, with this surface as the caller, and is dropped when hidden. */
export function VaultChip({ label, secrets }: { label: string; secrets: VaultSecretMeta[] }) {
  const api = vaultApi();
  const hit = secrets.find((s) => s.label.toLowerCase() === label.trim().toLowerCase());
  const [shown, setShown] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!hit) return <span className="vault-chip missing">🔒 {label} <i>— no such entry</i></span>;
  const reveal = (): void => {
    if (shown !== null) return setShown(null);
    setBusy(true);
    void api.read(hit.uuid).then((f) => setShown(f.value)).catch(() => setShown(null)).finally(() => setBusy(false));
  };
  const copy = (): void => {
    setBusy(true);
    void api.read(hit.uuid).then((f) => navigator.clipboard.writeText(f.value)).then(() => setCopied(true))
      .catch(() => undefined).finally(() => setBusy(false));
  };
  return (
    <span className="vault-chip">
      <span className="lk">🔒 {hit.label}</span>
      {shown !== null ? <span className="vault-revealed">{shown}</span> : <span className="vault-masked">••••••</span>}
      <button type="button" disabled={busy} onClick={reveal}>{shown !== null ? "Hide" : "Reveal"}</button>
      <button type="button" disabled={busy} onClick={copy}>{copied ? "Copied" : "Copy"}</button>
    </span>
  );
}

function CodeBlock({ content, language }: { content?: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const text = (content ?? "").replace(/\n$/, "");
  return (
    <div className="vault-cblock">
      <div className="cb">
        <span>{language || "text"}</span>
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
 * one that plainly does not move. Ticking belongs to Run mode, where it is explicitly session state.
 */
function TaskItem({ checked, children }: { checked?: boolean; children?: React.ReactNode }) {
  return (
    <span className={`vault-task${checked ? " done" : ""}`}>
      <input type="checkbox" checked={Boolean(checked)} readOnly tabIndex={-1} />
      <span>{children}</span>
    </span>
  );
}

// ---------------------------------------------------------------- the renderer

function render(body: string, secrets: VaultSecretMeta[]): React.ReactNode {
  const tree: RenderableTreeNode = Markdoc.transform(Markdoc.parse(preprocess(body)), CONFIG);
  return Markdoc.renderers.react(tree, React, {
    components: {
      // secrets is closed over rather than threaded through Markdoc attributes — a credential list
      // has no business being serialised into a document tree.
      VaultChip: (props: { label: string }) => <VaultChip label={props.label} secrets={secrets} />,
      CodeBlock,
      TaskItem,
    },
  });
}

export function Markdown({ body, secrets }: { body: string; secrets: VaultSecretMeta[] }) {
  return <>{useMemo(() => render(body, secrets), [body, secrets])}</>;
}

/**
 * The same render, minus the wrapping paragraph — for a runbook step's title, which sits inside a
 * heading row and must not open a block. Markdoc always wraps a bare line in <p>; this unwraps the
 * single-paragraph case and leaves anything richer alone.
 */
export function InlineMarkdown({ body, secrets }: { body: string; secrets: VaultSecretMeta[] }) {
  const el = useMemo(() => {
    const tree = Markdoc.transform(Markdoc.parse(preprocess(body)), CONFIG);
    if (tree && typeof tree === "object" && "children" in tree) {
      const kids = (tree as { children: RenderableTreeNode[] }).children;
      const only = kids.length === 1 ? kids[0] : null;
      if (only && typeof only === "object" && "name" in only && only.name === "p") {
        return Markdoc.renderers.react({ ...only, name: "span" } as RenderableTreeNode, React, {
          components: {
            VaultChip: (props: { label: string }) => <VaultChip label={props.label} secrets={secrets} />,
            CodeBlock,
            TaskItem,
          },
        });
      }
    }
    return render(body, secrets);
  }, [body, secrets]);
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

export function RunMode({ body, secrets, title }: { body: string; secrets: VaultSecretMeta[]; title: string }) {
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
        <div className="vault-runhead"><b>{title}</b><span className="vault-hint">No numbered steps yet — number lines "1." to make them runnable.</span></div>
        <Markdown body={body} secrets={secrets} />
      </>
    );
  }
  return (
    <>
      <div className="vault-runhead">
        <b>{title}</b>
        <span className="vault-hint">{done.size} of {steps.length} done</span>
        <button type="button" className="vault-btn" onClick={() => setDone(new Set())}>Reset ticks</button>
      </div>
      {intro && <div className="vault-hint" style={{ marginBottom: 10 }}>{intro}</div>}
      {steps.map((s, i) => (
        <div key={i} className={`vault-step${done.has(i) ? " done" : ""}`}>
          <button type="button" className="vault-snum" onClick={() => toggle(i)}>{i + 1}</button>
          <div className="vault-sbody">
            <div className="vault-stitle"><InlineMarkdown body={s.title} secrets={secrets} /></div>
            {s.commands.map((c, j) => (
              <div key={j} className="vault-cmd">
                <span className="c">{c}</span>
                <button type="button" className="vault-btn"
                  onClick={() => { void navigator.clipboard.writeText(c); setCopiedKey(`${i}-${j}`); }}>
                  {copiedKey === `${i}-${j}` ? "Copied" : "Copy"}
                </button>
              </div>
            ))}
            {/* the step body minus its fences — chips and prose keep rendering */}
            <StepProse body={s.body} secrets={secrets} />
          </div>
        </div>
      ))}
    </>
  );
}

function StepProse({ body, secrets }: { body: string; secrets: VaultSecretMeta[] }) {
  const prose = useMemo(() => body.replace(/```[^\n]*\n[\s\S]*?```/g, "").trim(), [body]);
  if (!prose) return null;
  return <div className="vault-stepprose"><Markdown body={prose} secrets={secrets} /></div>;
}
