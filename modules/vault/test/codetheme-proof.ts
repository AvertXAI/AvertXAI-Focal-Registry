// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry — Vault standalone lane
// Description: Proof for code-block appearance — the tokeniser, the JSONC reader, and the Visual
//              Studio Code theme mapping. Pure functions only, so this needs no database, no
//              Electron and no DOM: plain `node`.
//
//              THE ONE THAT MATTERS MOST is the round-trip invariant: concatenating every token's
//              text must return the input byte for byte. Colour is all that is at stake in this
//              feature, so a tokeniser that can drop or duplicate a character would turn a cosmetic
//              change into wrong code on screen — and somebody will copy that block and run it.
//
//              RUN IT:  npx esbuild modules/vault/test/codetheme-proof.ts --bundle --platform=node
//                       --format=cjs --outfile=modules/vault/test/codetheme-proof.cjs && node it
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: modules/vault/test/codetheme-proof.ts
//------------------------------------------------------------
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  BUILT_IN, importVsCodeTheme, isHighlightable, readTheme, stripJsonc, tokenize, type Role,
} from "../../../src/modules/vault/codeTheme";

let pass = 0;
const ok = (msg: string): void => { pass += 1; console.log(`OK  ${msg}`); };
const roles = (src: string, lang: string): Role[] => tokenize(src, lang).map((t) => t.role);
const textOf = (src: string, lang: string): string => tokenize(src, lang).map((t) => t.text).join("");

// ── 1. THE INVARIANT ─────────────────────────────────────────────────────────────────────────────
{
  const samples: [string, string][] = [
    ["js", `// c\nconst x = "a\\"b";\nfn(1_000, 0xFF);\n/* unclosed`],
    ["ts", `export type A = { b: string };\nclass Foo extends Bar {}`],
    ["py", `def f(a):\n    """doc"""\n    return a # tail`],
    ["bash", `echo "it's" 'quoted' # note\nsudo rm -rf /tmp/x`],
    ["sql", `SELECT * FROM t WHERE a = 'x' -- c`],
    ["json", `{"a":1,"b":[true,null]}`],
    ["yaml", `key: value # c\nlist:\n  - a\n  - 'b'`],
    ["css", `.a { color: #fff; /* c */ margin: 0 }`],
    // The ones designed to break a scanner: a lone quote, a lone slash, unicode, CRLF, empties.
    ["js", `it's a comment-less line with ' one quote`],
    ["js", `/`],
    ["js", `"`],
    ["js", `\r\n\r\n`],
    ["js", `const s = "emoji 🔐 and — dash";`],
    ["js", ``],
    ["js", `   `],
    ["bash", `#`],
    ["sql", `--`],
  ];
  for (const [lang, src] of samples) {
    assert.equal(textOf(src, lang), src, `round-trip must be exact for ${lang}: ${JSON.stringify(src.slice(0, 40))}`);
  }
  // And for something long and adversarial, built rather than typed.
  const nasty = Array.from({ length: 400 }, (_, i) => `line ${i} "s${i}" // c${i}\n\t/*${i}*/ 0x${i}`).join("\n");
  assert.equal(textOf(nasty, "js"), nasty, "400 mixed lines survive byte for byte");
  ok("tokenise: every token run reassembles into the exact input — nothing dropped, nothing doubled");
}

// ── 2. it labels the right things ────────────────────────────────────────────────────────────────
{
  const t = tokenize(`const x = "hi"; // done`, "js");
  const by = (r: Role): string => t.filter((x) => x.role === r).map((x) => x.text).join("");
  assert.equal(by("keyword"), "const", "const is a keyword");
  assert.equal(by("string"), '"hi"', "the quotes are part of the string");
  assert.equal(by("comment"), "// done", "the comment runs to end of line, marker included");
  assert.ok(by("variable").includes("x"), "a bare lowercase name is a variable");

  assert.ok(roles(`f(1)`, "js").includes("function"), "a name followed by ( is a call");
  assert.ok(tokenize(`Foo.bar`, "js").some((x) => x.text === "Foo" && x.role === "type"),
    "a capitalised bare name reads as a type");

  // A block comment with no terminator runs to the end rather than eating one character and
  // resyncing into garbage — a half-typed fence is the normal case, not an error case.
  assert.deepEqual(roles(`/* open forever`, "js"), ["comment"], "an unclosed block comment is all comment");
  // An unterminated single-quote must NOT swallow the rest of the file.
  const un = tokenize(`echo 'oops\necho fine`, "bash");
  assert.ok(un.some((x) => x.text.includes("fine") && x.role !== "string"),
    "an unterminated quote stops at the newline, so the next line is still readable");

  assert.equal(tokenize("SELECT a FROM t", "sql").filter((x) => x.role === "keyword").length, 2,
    "SQL keywords match regardless of the case they are written in");
  ok("tokenise: comments, strings, keywords, calls and types land on the right runs");
}

// ── 3. an unknown language is never guessed ──────────────────────────────────────────────────────
{
  const art = `+------+\n|  box |\n+------+`;
  assert.equal(isHighlightable(undefined), false, "no language is not highlightable");
  assert.equal(isHighlightable("brainfuck"), false, "an unlisted language is not highlightable");
  assert.equal(isHighlightable("JavaScript"), true, "the id is matched case-insensitively");
  assert.deepEqual(tokenize(art, undefined).map((x) => x.role), ["plain"],
    "an untagged fence is ONE plain run — Jason's ASCII diagrams must never be coloured as code");
  assert.equal(tokenize(art, undefined)[0].text, art, "and it still holds every character");
  ok("tokenise: an unknown or absent language renders plain rather than guessed");
}

// ── 3b. two defects that were SHIPPING, both found by recon on 08-13-2026 ───────────────────────
{
  // THE HYPHEN. The identifier pattern admitted `-` for every language, so an expression written
  // without spaces lexed as ONE identifier: the number never lit and the operator never got its
  // colour. It was there only so CSS's `font-face` would match, and it was costing every other
  // language. Now opt-in per language.
  const minus = tokenize("a-b", "js");
  assert.ok(minus.length > 1, "a-b is three tokens in JavaScript, not one identifier");
  assert.ok(minus.some((t) => t.text === "-" && t.role === "punct"), "the minus is punctuation");
  const dec = tokenize("i--;", "js");
  assert.ok(dec.some((t) => t.role === "punct" && t.text.includes("-")), "i-- decrements, it is not a name");
  assert.ok(tokenize("n-1", "js").some((t) => t.text === "1" && t.role === "number"),
    "and the number on the right of a hyphen finally lights");
  // CSS still needs it, which is the whole reason this is a per-language flag rather than a blanket
  // removal. The SAME text lexes differently in the two languages, which is exactly the point.
  assert.equal(tokenize("font-face", "css").length, 1, "in CSS a hyphenated word is ONE token");
  assert.equal(tokenize("font-face", "css")[0].text, "font-face", "kept whole");
  assert.equal(tokenize("font-face", "js").length, 3, "in JavaScript the same text is name-minus-name");
  assert.equal(tokenize("a-b", "js").map((t) => t.text).join(""), "a-b", "and the invariant holds");

  // POWERSHELL was pointed at the bash rules, which is a wrong answer rather than a gap: it served
  // `fi`, `esac` and `done` as keywords and `sudo apt grep sed` as types.
  assert.ok(tokenize("function Get-Thing { param($x) }", "powershell").some((t) => t.text === "function" && t.role === "keyword"),
    "PowerShell has its own keywords now");
  assert.deepEqual(tokenize("<# block #>", "powershell").map((t) => t.role), ["comment"],
    "and its <# #> block comment, which bash has never had");
  assert.ok(!tokenize("fi esac done", "powershell").some((t) => t.role === "keyword"),
    "bash's keywords are NOT PowerShell's");

  // INI/TOML shared the YAML rules, so a semicolon-commented line rendered as code.
  assert.deepEqual(tokenize("; a comment", "ini").map((t) => t.role), ["comment"],
    "a semicolon starts a comment in INI, which YAML has never known");
  ok("shipped defects: the hyphen no longer eats operators, PowerShell is not bash, INI is not YAML");
}

// ── 4. JSONC, because a real theme file is not JSON ──────────────────────────────────────────────
{
  assert.deepEqual(JSON.parse(stripJsonc(`{"a":1,}`)), { a: 1 }, "a trailing comma is removed");
  assert.deepEqual(JSON.parse(stripJsonc(`{ // hi\n"a":1 }`)), { a: 1 }, "a line comment is removed");
  assert.deepEqual(JSON.parse(stripJsonc(`{ /* hi */ "a":1 }`)), { a: 1 }, "a block comment is removed");
  // THE ONE A NAIVE STRIPPER GETS WRONG, and theme files are full of both.
  assert.deepEqual(JSON.parse(stripJsonc(`{"a":"http://x//y"}`)), { a: "http://x//y" },
    "slashes INSIDE a string are data, not a comment");
  assert.deepEqual(JSON.parse(stripJsonc(`{"a":"say \\"/*\\" ok"}`)), { a: 'say "/*" ok' },
    "an escaped quote does not end the string, so the /* inside it is not a comment");
  assert.deepEqual(JSON.parse(stripJsonc(`{"scope":"a, b",\n}`)), { scope: "a, b" }, "both at once");
  ok("stripJsonc: comments and trailing commas go, string contents survive untouched");
}

// ── 5. mapping a Visual Studio Code theme ────────────────────────────────────────────────────────
{
  // Shaped exactly like Jason's SynthWave '84 — trailing commas, comments, a scope-less default,
  // #rrggbbaa, and array scopes — so the fixture exercises what a real file does.
  const fixture = `{
  // a real theme opens with a comment
  "name": "Fixture 84",
  "type": "dark",
  "colors": { "editor.background": "#262335", "editorLineNumber.foreground": "#ffffff73", },
  "tokenColors": [
    { "settings": { "foreground": "#f2f0ff" } },
    { "scope": "comment", "settings": { "foreground": "#848bbd", "fontStyle": "italic" } },
    { "scope": ["string.quoted", "string.template"], "settings": { "foreground": "#ff8b39" } },
    { "scope": "keyword", "settings": { "foreground": "#fede5d" } },
    { "scope": "constant.numeric", "settings": { "foreground": "#f97e72" } },
    { "scope": "entity.name.function", "settings": { "foreground": "#36f9f6" } },
    { "scope": "variable", "settings": { "foreground": "#ff7edb" } },
    { "scope": "entity.name.type", "settings": { "foreground": "#fe4450" } },
  ],
}`;
  const r = importVsCodeTheme(fixture);
  assert.equal(r.ok, true, "a real-shaped theme imports");
  const t = r.theme!;
  assert.equal(t.name, "Fixture 84");
  assert.equal(t.type, "dark");
  assert.equal(t.background, "#262335", "editor.background becomes the block background");
  assert.equal(t.colors.plain, "#f2f0ff", "a scope-less tokenColor supplies the plain text colour");
  assert.equal(t.colors.comment, "#848bbd");
  assert.equal(t.colors.string, "#ff8b39", "an ARRAY scope is matched, not just a string one");
  assert.equal(t.colors.keyword, "#fede5d");
  assert.equal(t.colors.number, "#f97e72");
  assert.equal(t.colors.function, "#36f9f6");
  assert.equal(t.colors.variable, "#ff7edb");
  assert.equal(t.colors.type, "#fe4450");
  assert.equal(t.commentItalic, true, "italic comments carry across — losing it changes the feel");

  // THE PRECEDENCE BUG THIS CAUGHT, pinned so it cannot come back. SynthWave lists
  // `keyword.control.export.js` (mint) ABOVE its plain `keyword` rule (yellow). A matcher that lets
  // a more specific scope answer a general question paints every keyword in the language mint.
  const order = importVsCodeTheme(`{"type":"dark","tokenColors":[
    {"scope":"keyword.control.export.js","settings":{"foreground":"#72f1b8"}},
    {"scope":"keyword","settings":{"foreground":"#fede5d"}}]}`);
  assert.equal(order.theme?.colors.keyword, "#fede5d",
    "a MORE SPECIFIC scope listed first must not answer for keywords in general");

  // But when it is the only rule of its family, it is still better than a built-in that will clash
  // with the rest of the imported palette — accepted, third and last.
  const loose = importVsCodeTheme(`{"type":"dark","tokenColors":[{"scope":"comment.line","settings":{"foreground":"#111111"}}]}`);
  assert.equal(loose.theme?.colors.comment, "#111111", "a lone comment.line is used as a last resort");

  // #rrggbbaa loses its alpha rather than being rejected: half-transparent over an editor's own
  // layers means something, over ours it just reads as a dim colour.
  const alpha = importVsCodeTheme(`{"type":"dark","colors":{"editor.background":"#12345678"},"tokenColors":[{"scope":"keyword","settings":{"foreground":"#abc"}}]}`);
  assert.equal(alpha.theme?.background, "#123456", "#rrggbbaa is truncated to #rrggbb");
  assert.equal(alpha.theme?.colors.keyword, "#aabbcc", "#rgb is expanded to #rrggbb");

  assert.equal(importVsCodeTheme("not json at all").ok, false, "junk is refused, not thrown");
  assert.equal(importVsCodeTheme(`{"name":"empty"}`).ok, false, "a theme with no code colours is refused");
  ok("importVsCodeTheme: real-shaped JSONC maps to nine roles, loose scopes match, junk is refused");
}

// ── 6. a stored palette can never blank the preview ──────────────────────────────────────────────
{
  assert.equal(readTheme(undefined, "dark").name, BUILT_IN["focal-dark"].name, "nothing stored → the built-in");
  assert.equal(readTheme("focal-light", "dark").name, BUILT_IN["focal-light"].name, "a built-in id resolves");
  assert.equal(readTheme("{ broken", "light").name, BUILT_IN["focal-light"].name, "unparseable → the built-in for THAT mode");
  assert.equal(readTheme(`{"name":"x"}`, "dark").name, BUILT_IN["focal-dark"].name, "no background → not a theme");

  // A partial palette is filled from the built-in rather than leaving roles undefined, which would
  // render as inherited text and look like the highlighter had failed.
  const partial = readTheme(`{"name":"Half","type":"dark","background":"#000000","colors":{"keyword":"#ff0000"}}`, "dark");
  assert.equal(partial.colors.keyword, "#ff0000", "what it states is used");
  assert.equal(partial.colors.string, BUILT_IN["focal-dark"].colors.string, "what it omits falls back, never to nothing");
  ok("readTheme: a missing, broken or partial stored palette always resolves to something visible");
}

// ── 7. against the real file on this machine, when it is here ────────────────────────────────────
{
  const real = "C:/Users/lurpz/.vscode/extensions/robbowen.synthwave-vscode-0.1.20/themes/synthwave-color-theme.json";
  if (fs.existsSync(real)) {
    // Proof that the fixture above is not a straw man: standard JSON.parse genuinely cannot read
    // the file this feature exists to read.
    assert.throws(() => JSON.parse(fs.readFileSync(real, "utf8")), "the real theme file is NOT valid JSON");
    const r = importVsCodeTheme(fs.readFileSync(real, "utf8"), "SynthWave '84");
    assert.equal(r.ok, true, "and it imports once the JSONC is handled");
    assert.equal(r.theme?.background, "#262335", "SynthWave's editor background");
    assert.equal(r.theme?.colors.comment, "#848bbd");
    assert.equal(r.theme?.colors.keyword, "#fede5d");
    assert.equal(r.theme?.colors.function, "#36f9f6");
    assert.ok((r.mapped ?? 0) >= 7, `at least seven of eight roles mapped (got ${r.mapped})`);
    ok("SynthWave '84 on this machine: unreadable as JSON, correct as JSONC, eight roles mapped");
  } else {
    console.log("--  SynthWave '84 not installed here — skipped the real-file check");
  }
}

console.log(`\nALL ${pass} CODE-APPEARANCE CHECKS PASSED`);
