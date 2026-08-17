/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// THE MARKDOWN HELP MODAL — Jason's mockup v4 (08-16-2026), state "Help Modal", built to match:
// title + intro, a search box that filters ACROSS all tabs, six tabs, three-column rows
// (syntax · what it is · what it renders as), and a footer with the reference link.
//
// THE SIZING RULE (Task 3, with Jason's amendment): the modal renders once at natural height on
// the Basics tab, is measured, and is then PINNED to that measurement plus 40 pixels of headroom
// — one constant size, so switching tabs never resizes, moves, or scrolls the window. The pin is
// clamped to 92% of the available area; when and only when the clamp engages (a window too short
// for the full modal — the shell floor is 740×640) the content area may scroll. Searching may
// always scroll: the filter shows every tab's matches at once.

import { useLayoutEffect, useEffect, useRef, useState } from "react";

interface Row {
  /** Search keywords, same idea as the mockup's data-k. */
  k: string;
  syn: string;
  name: string;
  desc: React.ReactNode;
  out: React.ReactNode;
}

interface Section {
  id: string;
  label: string;
  note?: string;
  rows: Row[];
}

/** A tiny checkbox glyph for the checklist samples. */
const CB = ({ done }: { done?: boolean }) => <span className={`cb${done ? " done" : ""}`}>{done ? "✓" : ""}</span>;

const SECTIONS: Section[] = [
  {
    id: "basics",
    label: "Basics",
    rows: [
      {
        k: "heading header title h1 h2 h3 #",
        syn: "# Heading 1\n## Heading 2\n### Heading 3",
        name: "Heading",
        desc: <>Start a line with <code>#</code> and a space. One <code>#</code> is the biggest, <code>##</code> smaller, down to <code>######</code>. Headings are how you break a note into sections.</>,
        out: <><div className="o-h1">Heading 1</div><div className="o-h2">Heading 2</div><div className="o-h3">Heading 3</div></>,
      },
      {
        k: "bold strong ** ctrl+b",
        syn: "**bold text**",
        name: "Bold",
        desc: <>Wrap words in two asterisks on each side — or select text and press <code>Ctrl+B</code>. Use it to make the important words jump out.</>,
        out: <b>bold text</b>,
      },
      {
        k: "italic emphasis * ctrl+i",
        syn: "*italicized text*",
        name: "Italic",
        desc: <>Wrap words in one asterisk on each side — or select text and press <code>Ctrl+I</code>.</>,
        out: <i>italicized text</i>,
      },
      {
        k: "bold italic both combined *** emphasis",
        syn: "***bold and italic***",
        name: "Bold + Italic together",
        desc: <>Three asterisks on each side does both at once.</>,
        out: <b><i>bold and italic</i></b>,
      },
      {
        k: "strikethrough struck crossed out ~~ delete",
        syn: "~~The world is flat.~~",
        name: "Strikethrough",
        desc: <>Two tildes on each side crosses text out — handy for showing something is done or no longer true, without deleting it.</>,
        out: <s>The world is flat.</s>,
      },
      {
        k: "blockquote quote > callout",
        syn: "> blockquote",
        name: "Block quote",
        desc: <>Start a line with <code>&gt;</code> to set it apart — for quotes, warnings, or anything the reader should pause on. Stack several <code>&gt;</code> lines for a longer quote.</>,
        out: <div className="o-q">blockquote</div>,
      },
      {
        k: "horizontal rule divider line --- hr separator",
        syn: "---",
        name: "Horizontal divider",
        desc: <>Three dashes alone on a line draw a divider — a clean break between topics. Leave a blank line above it, or the line above turns into a heading.</>,
        out: <hr className="o-hr" />,
      },
      {
        k: "escape backslash literal character \\ print asterisk",
        syn: "\\*not italic\\*",
        name: "Print the character itself",
        desc: <>A backslash before a styling character prints it literally instead of styling: <code>\*</code> <code>\#</code> <code>\`</code> <code>\_</code> <code>\[</code> <code>\-</code></>,
        out: <>*not italic*</>,
      },
    ],
  },
  {
    id: "lists",
    label: "Lists",
    rows: [
      {
        k: "bullet list unordered - item",
        syn: "- First item\n- Second item\n- Third item",
        name: "Bullet list",
        desc: <>Start each line with <code>-</code> and a space. Indent two spaces for a sub-item.</>,
        out: <ul><li>First item</li><li>Second item</li><li>Third item</li></ul>,
      },
      {
        k: "numbered list ordered 1. steps",
        syn: "1. First item\n2. Second item\n3. Third item",
        name: "Numbered list",
        desc: <>Start each line with a number and a period. In Runbooks, numbered lines become steps.</>,
        out: <ol><li>First item</li><li>Second item</li><li>Third item</li></ol>,
      },
      {
        k: "checkbox task list todo - [ ] [x] check tick",
        syn: "- [x] done task\n- [ ] open task",
        name: "Checklist",
        desc: <><code>- [ ]</code> makes a checkbox; <code>- [x]</code> is a ticked one. Click a box in the rendered note to toggle it.</>,
        out: (
          <>
            <div className="o-task"><CB done /> done task</div>
            <div className="o-task"><CB /> open task</div>
          </>
        ),
      },
      {
        k: "nested sub-item indent two spaces list inside list",
        syn: "- Parent item\n  - Sub-item\n  - Sub-item",
        name: "Nested items",
        desc: <>Indent two spaces under any list line to make a sub-item. Works in bullet, numbered, and checklists.</>,
        out: <ul><li>Parent item<ul><li>Sub-item</li><li>Sub-item</li></ul></li></ul>,
      },
    ],
  },
  {
    id: "links",
    label: "Links & Images",
    rows: [
      {
        k: "link url hyperlink [name]( ctrl+k",
        syn: "[title](https://www.example.com)",
        name: "Link",
        desc: <>Square brackets hold the text people see; parentheses hold the address. A bare address links by itself.</>,
        out: <span className="o-link">title</span>,
      },
      {
        k: "image picture screenshot ![ alt vault paste",
        syn: "![alt text](image.jpg)",
        name: "Image",
        desc: <>Same as a link, with a <code>!</code> in front. Paste a screenshot and this is written FOR you as <code>![name](vault://…)</code> — the picture lives in the encrypted vault, the text stays one short line.</>,
        out: <div className="o-imgbox">🖼 image renders here<br />“alt text” describes it</div>,
      },
    ],
  },
  {
    id: "code",
    label: "Code & Tables",
    rows: [
      {
        k: "inline code backtick ` command",
        syn: "`code`",
        name: "Inline code",
        desc: <>Backticks around a word show it exactly as typed, in a mono font — for commands, filenames, and keys.</>,
        out: <code>code</code>,
      },
      {
        k: "fenced code block ``` triple backticks language syntax highlight js",
        syn: "```js\nconsole.log('hi')\n```",
        name: "Fenced code block",
        desc: <>Three backticks above and below make a code box. Name the language after the first fence and it colours.</>,
        out: <div className="o-code">console.log('hi')</div>,
      },
      {
        k: "table columns rows pipe | grid",
        syn: "| Name | Role |\n|---|---|\n| Ana | Admin |\n| Ben | Tech |",
        name: "Table",
        desc: <>Columns split with <code>|</code>. The second row is dashes: <code>|---|---|</code> — that row is what turns the first row into headers.</>,
        out: (
          <table>
            <thead><tr><th>Name</th><th>Role</th></tr></thead>
            <tbody><tr><td>Ana</td><td>Admin</td></tr><tr><td>Ben</td><td>Tech</td></tr></tbody>
          </table>
        ),
      },
    ],
  },
  {
    id: "ext",
    label: "Extended",
    note: "Extended syntax — widely supported, but a few of these are flavor-specific. What renders here stays clean markdown either way.",
    rows: [
      {
        k: "highlight mark == important yellow",
        syn: "==very important words==",
        name: "Highlight",
        desc: <>Two equals signs on each side highlight the words, like a marker pen.</>,
        out: <span className="o-hl">very important words</span>,
      },
      {
        k: "footnote reference [^1] note bottom",
        syn: "Here's a claim.[^1]\n\n[^1]: This is the footnote.",
        name: "Footnote",
        desc: <><code>[^1]</code> in the text makes a small reference number; the matching <code>[^1]:</code> line holds the note itself, shown at the bottom.</>,
        out: <>Here's a claim.<span className="fnote">1</span><div className="o-fnbody"><span className="fnote">1</span> This is the footnote.</div></>,
      },
      {
        k: "heading id anchor custom {#} jump",
        syn: "### My Great Heading {#custom-id}",
        name: "Heading ID",
        desc: <>Adds a custom anchor name to a heading so links can jump straight to it.</>,
        out: <><div className="o-h3">My Great Heading</div><div className="o-anchor">#custom-id</div></>,
      },
      {
        k: "definition list term meaning glossary :",
        syn: "term\n: definition",
        name: "Definition list",
        desc: <>A word on one line, its meaning on the next starting with <code>:</code> — a tidy glossary format.</>,
        out: <><b>term</b><div className="o-def">definition</div></>,
      },
      {
        k: "emoji smiley :joy: shortcode",
        syn: ":joy:",
        name: "Emoji shortcode",
        desc: <>A name wrapped in colons becomes the emoji. Typing the emoji itself works too.</>,
        out: <>😂</>,
      },
      {
        k: "subscript superscript h2o x^2 chemistry math ~ ^",
        syn: "H~2~O\nX^2^",
        name: "Subscript & superscript",
        desc: <>Single tildes drop text low (subscript); single carets raise it (superscript).</>,
        out: <>H<sub>2</sub>O &nbsp;·&nbsp; X<sup>2</sup></>,
      },
    ],
  },
  {
    id: "editor",
    label: "This Editor",
    rows: [
      {
        k: "vault password secret chip reveal copy @[[",
        syn: "@[[vault:…]]",
        name: "Vault reference",
        desc: <>Reference a vault entry — it becomes a Reveal/Copy chip; the password never enters the note.</>,
        out: <span className="o-vchip">🔑 staging-api-key <span className="act">Reveal · Copy</span></span>,
      },
      {
        k: "runbook step run mode copy button tick numbered",
        syn: "1. step",
        name: "Runbook steps",
        desc: <>In a Runbook, number a line to make a step; Run mode gives it a copy button and a tick.</>,
        out: <div className="o-step"><span className="n">1.</span> step <span className="copy">⧉ copy</span> <span className="tick">✓</span></div>,
      },
      {
        k: "raw mode switcher stored markdown character source",
        syn: "Raw",
        name: "Raw mode",
        desc: <>The mode switcher's Raw shows the stored markdown character-for-character — the place to see exactly what you have.</>,
        out: <span className="o-raw"><i>**</i>bold<i>**</i> stays <i>**</i>bold<i>**</i></span>,
      },
      {
        k: "tidy repair paste damage clean fix line-joins underlines",
        syn: "Tidy",
        name: "Tidy",
        desc: <>Repairs paste damage in a note — stray \ line-joins, escaped \# headings, leftover ==== underlines.</>,
        out: <span className="o-tidy"><s>\#\# Title ====</s> → <b>## Title</b></span>,
      },
      {
        k: "save ctrl+s autosave",
        syn: "Ctrl+S",
        name: "Save now",
        desc: <>Save now (the editor also autosaves as you type).</>,
        out: <span className="o-saved">● Saved</span>,
      },
      {
        k: "soft line break shift+enter paragraph new line",
        syn: "Shift+Enter",
        name: "Soft line break",
        desc: <>A soft line break inside the same paragraph; plain Enter starts a new one.</>,
        out: <>line one<br />line two — same paragraph</>,
      },
    ],
  },
];

function MRow({ r }: { r: Row }) {
  return (
    <div className="vault-mrow">
      <div className="vault-msyn">{r.syn}</div>
      <div className="vault-mwhat">
        <div className="mname">{r.name}</div>
        <div className="mdesc">{r.desc}</div>
      </div>
      <div className="vault-mout">{r.out}</div>
    </div>
  );
}

export function NotesHelpModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState("basics");
  const [q, setQ] = useState("");
  const boxRef = useRef<HTMLDivElement | null>(null);
  /** The pinned height, measured once off the Basics first paint. null = still at natural height. */
  const [size, setSize] = useState<{ h: number; clamped: boolean } | null>(null);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const natural = el.offsetHeight + 40;
    const max = Math.round((el.parentElement?.clientHeight ?? window.innerHeight) * 0.92);
    setSize({ h: Math.min(natural, max), clamped: natural > max });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const query = q.trim().toLowerCase();
  // The search reads keywords + syntax + name — the same haystack idea as the mockup's data-k.
  const matches = (r: Row): boolean => `${r.k} ${r.syn} ${r.name}`.toLowerCase().includes(query);
  const hits = query ? SECTIONS.map((s) => ({ s, rows: s.rows.filter(matches) })).filter((x) => x.rows.length > 0) : [];
  const active = SECTIONS.find((s) => s.id === tab) ?? SECTIONS[0];

  return (
    <div className="vault-modalback" onClick={onClose}>
      <div className="vault-hmodal" ref={boxRef} style={size ? { height: size.h } : undefined} onClick={(e) => e.stopPropagation()}>
        <div className="vault-hmhead">
          <div className="vault-hmtoprow">
            <div>
              <h3>Markdown, in one card</h3>
              <div className="vault-hmsub">
                Markdown is regular text with a few extra characters — # and * do the styling. Type it and it
                renders live; clean markdown is what gets stored, so your notes open anywhere.
              </div>
            </div>
            <button className="vault-hmclose" title="Close" onClick={onClose}>✕</button>
          </div>
          <input
            className="vault-hmsearch"
            placeholder="🔍  Search the guide — try 'table', 'bold', or 'checkbox'…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="vault-hmtabs">
          {SECTIONS.map((s) => (
            <button key={s.id} className={`vault-htab${!query && tab === s.id ? " on" : ""}`} onClick={() => { setQ(""); setTab(s.id); }}>
              {s.label}
            </button>
          ))}
        </div>
        <div className={`vault-hmbody${query || size?.clamped ? " scroll" : ""}`}>
          {query ? (
            hits.length === 0 ? (
              <div className="vault-nores">No matches — try a shorter word, like "list" or "code".</div>
            ) : (
              hits.map(({ s, rows }) => rows.map((r) => <MRow key={`${s.id}:${r.name}`} r={r} />))
            )
          ) : (
            <>
              {active.note && <div className="vault-hsecnote">{active.note}</div>}
              {active.rows.map((r) => <MRow key={r.name} r={r} />)}
            </>
          )}
        </div>
        <div className="vault-hmfoot">
          <span className="ref">Full reference: <span>markdownguide.org/cheat-sheet</span></span>
          <button className="vault-btn primary" onClick={onClose}>Got it</button>
        </div>
      </div>
    </div>
  );
}
