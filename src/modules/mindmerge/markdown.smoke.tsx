// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Headless smoke for the markdown-subset renderer — assert-based, no framework
//              (mirrors brain/smoke.ts). Renders to static HTML and proves: subset → elements,
//              off-subset → literal text (never throws), unsafe links degrade, highlight wraps
//              case-insensitive text-node <mark>s. Run: npx esbuild + node (see smoke command in
//              the ui build notes) — imported by nothing, never ships in the renderer bundle.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: src/modules/mindmerge/markdown.smoke.tsx
//------------------------------------------------------------
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { renderMarkdown, highlightText } from "./markdown";

const html = (n: unknown) => renderToStaticMarkup(<>{n}</>);

// headings / bold / italic / lists / inline code / fences render as ELEMENTS, not literal chars
assert.match(html(renderMarkdown("# Heading")), /<h1>Heading<\/h1>/);
assert.match(html(renderMarkdown("#### Deep")), /<h4>Deep<\/h4>/);
assert.match(html(renderMarkdown("**bold** and *it*")), /<strong>bold<\/strong> and <em>it<\/em>/);
assert.match(html(renderMarkdown("- one\n- two")), /<ul><li>one<\/li><li>two<\/li><\/ul>/);
assert.match(html(renderMarkdown("1. a\n2) b")), /<ol><li>a<\/li><li>b<\/li><\/ol>/);
assert.match(html(renderMarkdown("run `git status` now")), /<code>git status<\/code>/);
assert.match(html(renderMarkdown("```\nline1\nline2\n```")), /<pre><code>line1\nline2<\/code><\/pre>/);

// links: http(s) only; javascript:/file:/relative degrade to literal text
assert.match(html(renderMarkdown("see [docs](https://x.y)")), /<a href="https:\/\/x\.y" rel="noreferrer">docs<\/a>/);
assert.ok(!html(renderMarkdown("[x](javascript:alert(1))")).includes("<a"), "unsafe link must not become an anchor");

// off-subset syntax degrades to plain text — never throws
assert.ok(html(renderMarkdown("~~strike~~ | table | **unclosed")).includes("~~strike~~"));

// highlight: case-insensitive <mark> at text-node level, incl. inside bold + code; regex chars safe
assert.match(
  html(renderMarkdown("Restart **Traefik** via `traefik.yml`", "traefik")),
  /<strong><mark>Traefik<\/mark><\/strong> via <code><mark>traefik<\/mark>\.yml<\/code>/
);
assert.match(html(highlightText("a c++ b C++ c", "c++")), /<mark>c\+\+<\/mark> b <mark>C\+\+<\/mark>/);
assert.equal(html(highlightText("no hits here", "zzz")), "no hits here");

// markRef path must not throw under server render (refs simply don't fire there)
void html(renderMarkdown("x match y", "match", () => undefined));

console.log("markdown.smoke: ALL PASS");
