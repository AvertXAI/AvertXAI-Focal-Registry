/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Code-block appearance — the whole of it that is pure, so the whole of it is testable.
// Approved mockup: docs/MOCKUP-vault-code-appearance-v1-08-12-2026.html (Jason 08-13-2026).
//
// THREE PARTS, DELIBERATELY IN ONE FILE because they only make sense against each other: the nine
// colour roles a code block has, a tokeniser that labels source with those roles, and the mapping
// that turns a Visual Studio Code theme into them.
//
// WHY A HAND-WRITTEN TOKENISER AND NOT PRISM OR HIGHLIGHT.JS. Both are MIT and would clear the
// licence gate; neither is needed. A markdown code block has code in it and nothing else — no
// folding, no hover, no diagnostics, no incremental reparse — so what is actually required is
// "split this string into comment / string / keyword / number / call / type / punctuation", which is
// the sixty lines below. The tree is being kept lean on purpose (§3.1) and this is exactly the kind
// of reflexive dependency §2.10 warns about.
//
// THE ONE INVARIANT, AND IT IS TESTED: concatenating every token's text returns the input, byte for
// byte. Colour is the only thing at stake here — a tokeniser that can drop a character has turned a
// cosmetic feature into data loss on screen, and someone will copy that block and run it.
//
// THE CEILING, STATED SO NOBODY DISCOVERS IT AS A BUG: this is a scanner, not a parser. It does not
// know scope, so it cannot tell a shadowed name from a keyword, and a language it has never heard of
// renders plain rather than guessed. A wrong guess is worse than no colour — Jason's notes are full
// of ASCII diagrams that a language detector would happily shred as Perl.

/** The nine roles a code block can paint, plus the background it paints them on. */
export type Role = "plain" | "comment" | "string" | "keyword" | "number" | "function" | "variable" | "type" | "punct";

export interface CodeTheme {
  /** What it is called on screen. Carries the origin for an imported one — "SynthWave '84". */
  name: string;
  /** "dark" | "light" — only used to pick a sane fallback foreground when a theme omits one. */
  type: "dark" | "light";
  background: string;
  /** Comments in italic, because SynthWave sets it and losing it changes the whole feel. */
  commentItalic: boolean;
  colors: Record<Role, string>;
}

export interface Token {
  text: string;
  role: Role;
}

// ---------------------------------------------------------------- the themes we own

/**
 * The two built-ins, authored here. NOTHING THIRD-PARTY SHIPS: a bundled theme would be someone
 * else's work redistributed inside a commercial product, and the importer below makes it pointless
 * anyway — the user's own theme is already on their machine and is the one they actually want.
 */
export const BUILT_IN: Record<string, CodeTheme> = {
  "focal-dark": {
    name: "Focal Dark",
    type: "dark",
    background: "#1b1b1f",
    commentItalic: true,
    colors: {
      plain: "#e6e6e6", comment: "#8a8a94", string: "#9ecb8a", keyword: "#d98a70",
      number: "#d9b970", function: "#7fb8e6", variable: "#e6e6e6", type: "#c39ae0", punct: "#a0a0a8",
    },
  },
  /**
   * REWRITTEN 08-13-2026 — Jason, on the first version: "id like to at least have different text
   * colors, blue, red and maroon and black color isnt sexy".
   *
   * He was right, and the numbers say why. Five of the nine roles were near-black or grey: plain
   * 14.05:1, string 12.28:1 (nominally navy, indistinguishable from black at 11.5 pixels), type
   * 7.09:1 bottle green, and the two greys. Only three hues were actually visible. Worse, `plain`
   * paints EVERY character of a fence whose language the scanner does not know, so an untagged block
   * was a solid slab of near-black.
   *
   * This set spans five hues — red, maroon, blue, violet, teal — plus two greys told apart by
   * temperature, and an ink with a blue cast so it does not read as printer black. Every value was
   * contrast-checked against the #fbfaf8 background this session; the figure is on each line. The
   * floor is 4.5:1 for body-weight text and the comment sits deliberately AT the floor, because a
   * comment is meant to recede — it is the only role allowed to be the quietest thing in the block.
   */
  "focal-light": {
    name: "Focal Light",
    type: "light",
    background: "#fbfaf8",
    commentItalic: true,
    colors: {
      // ink 15.01 · warm grey 4.59 (the floor, on purpose) · MAROON 9.63 · RED 6.67
      plain: "#1b2430", comment: "#79716a", string: "#7a1f3d", keyword: "#b3121b",
      // violet 7.08 · BLUE 7.67 · steel 9.81 · teal 5.68 · cool slate 5.75
      number: "#6b3fa0", function: "#0a4f9e", variable: "#33415c", type: "#0f6f74", punct: "#5a6472",
    },
  },
};

export const DEFAULT_DARK = "focal-dark";
export const DEFAULT_LIGHT = "focal-light";

/** A stored theme that will not parse must never blank the preview. */
export function readTheme(raw: string | undefined, mode: "dark" | "light"): CodeTheme {
  const fallback = BUILT_IN[mode === "dark" ? DEFAULT_DARK : DEFAULT_LIGHT];
  if (!raw) return fallback;
  if (BUILT_IN[raw]) return BUILT_IN[raw];
  try {
    const t = JSON.parse(raw) as Partial<CodeTheme>;
    if (!t || typeof t.background !== "string" || !t.colors) return fallback;
    // Merge over the fallback so a theme missing a role is dim, never invisible.
    return {
      name: typeof t.name === "string" ? t.name : "Custom",
      type: t.type === "light" ? "light" : "dark",
      background: t.background,
      commentItalic: t.commentItalic !== false,
      colors: { ...fallback.colors, ...t.colors },
    };
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------- the tokeniser

interface Lang {
  line: string[];
  block: [string, string][];
  quotes: string[];
  keywords: Set<string>;
  types: Set<string>;
  /**
   * MAY A HYPHEN SIT INSIDE A WORD? Only in stylesheets, and getting this wrong is a real defect
   * that shipped: the identifier pattern admitted `-` for every language, so `n-1`, `i--` and `a-b`
   * all lexed as ONE identifier. The number never lit, the operator never got its colour, and the
   * whole expression came out as a variable. CSS needs it for `font-face`; nothing else does.
   */
  hyphenWords?: boolean;
}

const set = (s: string): Set<string> => new Set(s.split(/\s+/).filter(Boolean));

const JS: Lang = {
  line: ["//"],
  block: [["/*", "*/"]],
  quotes: ['"', "'", "`"],
  keywords: set(`
    const let var function return if else for while do switch case break continue new delete typeof
    instanceof in of class extends super this async await yield try catch finally throw import export
    from default null undefined true false void static get set public private protected readonly
    interface type enum namespace declare implements as satisfies keyof infer abstract override`),
  types: set(`
    string number boolean object symbol bigint any unknown never Array Promise Map Set Object Date
    RegExp Error JSON Math console process window document`),
};

const PY: Lang = {
  line: ["#"],
  block: [['"""', '"""'], ["'''", "'''"]],
  quotes: ['"', "'"],
  keywords: set(`
    def class return if elif else for while break continue pass import from as with try except
    finally raise lambda yield global nonlocal assert del in is not and or None True False async
    await match case self`),
  types: set("int str float bool list dict tuple set bytes object type Exception print len range"),
};

const SH: Lang = {
  line: ["#"],
  block: [],
  quotes: ['"', "'"],
  keywords: set(`
    if then elif else fi for while until do done case esac function return exit local export
    readonly declare source echo cd set unset trap shift break continue in`),
  types: set("sudo apt npm node git docker curl wget grep sed awk find ls cat rm cp mv mkdir chmod ssh"),
};

const SQL: Lang = {
  line: ["--"],
  block: [["/*", "*/"]],
  quotes: ["'", '"', "`"],
  keywords: set(`
    SELECT FROM WHERE INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE ALTER DROP INDEX VIEW JOIN
    LEFT RIGHT INNER OUTER FULL ON AS AND OR NOT NULL IS IN LIKE BETWEEN GROUP BY ORDER HAVING LIMIT
    OFFSET DISTINCT UNION ALL PRIMARY KEY FOREIGN REFERENCES UNIQUE DEFAULT CASE WHEN THEN ELSE END
    BEGIN COMMIT ROLLBACK TRANSACTION PRAGMA WITH RETURNING EXISTS`),
  types: set("INTEGER TEXT REAL BLOB VARCHAR CHAR BOOLEAN DATE TIMESTAMP NUMERIC COUNT SUM AVG MIN MAX"),
};

const JSON_L: Lang = { line: ["//"], block: [["/*", "*/"]], quotes: ['"'], keywords: set("true false null"), types: set("") };
const YAML_L: Lang = { line: ["#"], block: [], quotes: ['"', "'"], keywords: set("true false null yes no on off"), types: set("") };
/** INI and TOML used to share the YAML rules, which meant a `;`-commented line rendered as code —
 *  the semicolon is INI's own comment marker and YAML has never heard of it. */
const INI_L: Lang = { line: ["#", ";"], block: [], quotes: ['"', "'"], keywords: set("true false null yes no on off"), types: set("") };
const CSS_L: Lang = {
  line: ["//"],
  block: [["/*", "*/"]],
  quotes: ['"', "'"],
  keywords: set("important media supports keyframes import font-face root from to and not only"),
  types: set("px rem em vh vw fr deg ms s"),
  hyphenWords: true, // the ONE language where a hyphen belongs inside a word — see the Lang comment
};
/**
 * PowerShell used to be pointed at the shell rules, which is a WRONG ANSWER rather than a gap: it
 * was being served bash's keywords (`fi`, `esac`, `done`, `then` — none of which exist here) and a
 * types set of `sudo apt npm grep sed awk` that means nothing on Windows. Jason works in PowerShell
 * daily, so it gets its own: `<# #>` block comments, and verb-noun cmdlets left to the call rule.
 */
const PS_L: Lang = {
  line: ["#"],
  block: [["<#", "#>"]],
  quotes: ['"', "'"],
  keywords: set(`
    if elseif else switch foreach for while do until break continue return function filter param
    begin process end try catch finally throw trap class enum using namespace in
    and or not xor is isnot as data dynamicparam exit inlinescript workflow hidden static`),
  types: set(`
    string int long double decimal bool char byte array hashtable pscustomobject psobject scriptblock
    void switch ref type xml regex datetime timespan guid uri version single sbyte
    true false null Host Path Item ChildItem Content Location Process Service Object`),
};

/**
 * Language id → scanner rules. An id NOT in here is rendered plain, on purpose: guessing is the one
 * behaviour that can make a code block worse than it was.
 */
const LANGS: Record<string, Lang> = {
  js: JS, jsx: JS, javascript: JS, mjs: JS, cjs: JS,
  ts: JS, tsx: JS, typescript: JS,
  json: JSON_L, jsonc: JSON_L,
  py: PY, python: PY,
  sh: SH, bash: SH, shell: SH, zsh: SH, console: SH,
  powershell: PS_L, pwsh: PS_L, ps1: PS_L,
  sql: SQL, sqlite: SQL,
  yaml: YAML_L, yml: YAML_L,
  toml: INI_L, ini: INI_L, env: INI_L, dotenv: INI_L, properties: INI_L,
  css: CSS_L, scss: CSS_L, less: CSS_L,
};

/**
 * THE C FAMILY IS DELIBERATELY ABSENT. It was researched and costed — nine keyword sets, and several
 * carry named defects the scanner shape cannot avoid (Rust lifetimes open a string that never
 * closes; C++ raw strings and digit separators mis-terminate; C# verbatim paths are mangled by the
 * escape rule). Jason ruled it out on 08-13-2026 — "im not coding c++ right now, thats fine to just
 * show it in a text view form" — so a ```cpp fence renders plain, which is exactly what an unknown
 * language is supposed to do here. Nine sets of keywords for languages nobody in this project writes
 * is maintenance with no reader.
 */

export function isHighlightable(language: string | undefined): boolean {
  return Boolean(language && LANGS[language.trim().toLowerCase()]);
}

/**
 * Split source into coloured runs. Never throws, never loses a character — see the header.
 *
 * A character scanner rather than a regex sweep because only a scanner can guarantee that: every
 * branch advances `i` by exactly the length it emitted, so the output reassembles into the input by
 * construction rather than by hoping the patterns tile.
 */
export function tokenize(source: string, language?: string): Token[] {
  const lang = LANGS[(language ?? "").trim().toLowerCase()];
  if (!lang || source.length === 0) return source ? [{ text: source, role: "plain" }] : [];

  const out: Token[] = [];
  const push = (text: string, role: Role): void => {
    if (text.length === 0) return;
    const last = out[out.length - 1];
    if (last && last.role === role) last.text += text; // merge runs — fewer spans, same pixels
    else out.push({ text, role });
  };

  const n = source.length;
  let i = 0;
  while (i < n) {
    const rest = source.slice(i);

    // 1. block comment. An UNCLOSED one runs to the end of the block, which is what an editor does
    //    and what a half-typed fence needs.
    let matched = false;
    for (const [open, close] of lang.block) {
      if (!rest.startsWith(open)) continue;
      const end = source.indexOf(close, i + open.length);
      const stop = end === -1 ? n : end + close.length;
      push(source.slice(i, stop), "comment");
      i = stop;
      matched = true;
      break;
    }
    if (matched) continue;

    // 2. line comment
    const lc = lang.line.find((p) => rest.startsWith(p));
    if (lc) {
      const nl = source.indexOf("\n", i);
      const stop = nl === -1 ? n : nl;
      push(source.slice(i, stop), "comment");
      i = stop;
      continue;
    }

    const c = source[i];

    // 3. string, with backslash escapes. Unterminated stops at the newline (or the end) rather than
    //    swallowing the remainder of the file — a stray apostrophe in a shell comment is common.
    if (lang.quotes.includes(c)) {
      let j = i + 1;
      while (j < n) {
        if (source[j] === "\\") { j += 2; continue; }
        if (source[j] === c) { j++; break; }
        if (source[j] === "\n" && c !== "`") break;
        j++;
      }
      push(source.slice(i, Math.min(j, n)), "string");
      i = Math.min(j, n);
      continue;
    }

    // 4. number
    const num = /^(?:0[xXbBoO][0-9a-fA-F_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)/.exec(rest);
    if (num && (i === 0 || !/[\w$]/.test(source[i - 1]))) {
      push(num[0], "number");
      i += num[0].length;
      continue;
    }

    // 5. identifier — keyword, known type, a call, or a plain name
    const id = (lang.hyphenWords ? /^[A-Za-z_$@][\w$-]*/ : /^[A-Za-z_$@][\w$]*/).exec(rest);
    if (id) {
      const word = id[0];
      const after = source.slice(i + word.length);
      const isCall = /^\s*\(/.test(after);
      const role: Role = lang.keywords.has(word) || lang.keywords.has(word.toUpperCase())
        ? "keyword"
        : lang.types.has(word) || lang.types.has(word.toUpperCase())
          ? "type"
          : isCall
            ? "function"
            : /^[A-Z]/.test(word)
              ? "type" // a capitalised bare name is a class or constructor far more often than not
              : "variable";
      push(word, role);
      i += word.length;
      continue;
    }

    // 6. whitespace, in one run
    const ws = /^\s+/.exec(rest);
    if (ws) { push(ws[0], "plain"); i += ws[0].length; continue; }

    // 7. anything else is punctuation, one character at a time — the branch that guarantees progress
    push(c, "punct");
    i++;
  }

  return out;
}

// ---------------------------------------------------------------- Visual Studio Code themes

/**
 * JSONC → JSON. Written by hand and STRING-AWARE, which is the whole reason it exists: a theme file
 * is full of values like "//" and scope names with slashes in them, and a naive comment strip
 * corrupts them silently.
 *
 * It is needed at all because a real theme is not JSON. Jason's own SynthWave '84 file has trailing
 * commas and line comments, and `JSON.parse` refuses it at position 12660 — verified 08-12-2026.
 */
export function stripJsonc(src: string): string {
  let out = "";
  let i = 0;
  let inStr = false;
  while (i < src.length) {
    const c = src[i];
    if (inStr) {
      out += c;
      if (c === "\\") { out += src[i + 1] ?? ""; i += 2; continue; }
      if (c === '"') inStr = false;
      i++;
      continue;
    }
    if (c === '"') { inStr = true; out += c; i++; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

/**
 * Which TextMate scopes feed each of our roles, most specific first.
 *
 * NINE ROLES, NOT TWO HUNDRED. A Visual Studio Code theme colours an entire development environment
 * — gutter, minimap, breadcrumbs, git decorations, terminal ANSI. A markdown code block has none of
 * that, so the importer reads the handful of scopes that describe code and ignores everything else.
 */
const SCOPES: Record<Exclude<Role, "plain">, string[]> = {
  comment: ["comment"],
  string: ["string.quoted", "string"],
  keyword: ["keyword.control", "keyword", "storage.type", "storage.modifier", "storage"],
  number: ["constant.numeric", "constant.language", "constant"],
  function: ["entity.name.function", "support.function", "variable.function"],
  variable: ["variable", "entity.name.variable", "support.variable"],
  type: ["entity.name.type", "support.type", "entity.name.class", "entity.name", "support"],
  punct: ["punctuation.separator", "punctuation", "meta.brace"],
};

interface RawTokenColor {
  scope?: string | string[];
  settings?: { foreground?: string; fontStyle?: string };
}
interface RawTheme {
  name?: string;
  type?: string;
  colors?: Record<string, string>;
  tokenColors?: RawTokenColor[];
  semanticHighlighting?: unknown;
}

/**
 * Find the theme rule that answers a wanted scope.
 *
 * TWO PASSES, AND THE ORDER IS THE WHOLE POINT. A theme scope answers a question when it IS the
 * wanted scope, or is a more GENERAL prefix of it — `comment` legitimately colours
 * `comment.line.double-slash`. A more SPECIFIC scope must never answer a general question, and
 * getting that backwards is a real bug the proof caught: SynthWave '84 lists
 * `keyword.control.export.js` (mint green, for import/export only) above its plain `keyword` rule
 * (yellow), so a naive match painted every keyword in the language mint green.
 *
 * Exact wins over general, because a theme that bothered to state `keyword.control` separately meant
 * it — and within a pass the file's own order decides, which is what TextMate does.
 *
 * A more specific scope IS accepted, but only as a last resort: a theme whose sole comment rule is
 * `comment.line` should still colour comments, because its own colour beats a built-in that will
 * clash with the rest of the imported palette. Third, never first.
 */
function findScope(tokens: RawTokenColor[], wanted: string): RawTokenColor | undefined {
  const scopesOf = (t: RawTokenColor): string[] =>
    (Array.isArray(t.scope) ? t.scope : typeof t.scope === "string" ? t.scope.split(",") : [])
      .map((s) => s.trim())
      .filter(Boolean);

  for (const t of tokens) {
    if (t.settings?.foreground && scopesOf(t).some((s) => s === wanted)) return t;
  }
  for (const t of tokens) {
    if (t.settings?.foreground && scopesOf(t).some((s) => wanted.startsWith(`${s}.`))) return t;
  }
  for (const t of tokens) {
    if (t.settings?.foreground && scopesOf(t).some((s) => s.startsWith(`${wanted}.`))) return t;
  }
  return undefined;
}

/** #rgb / #rrggbb / #rrggbbaa → #rrggbb. Alpha is dropped: it is meaningful over an editor's own
 *  layers and meaningless over ours, and a half-transparent keyword just reads as a dim one. */
function hex6(v: string | undefined): string | null {
  if (!v) return null;
  const m = /^#([0-9a-fA-F]{3,8})$/.exec(v.trim());
  if (!m) return null;
  const h = m[1];
  if (h.length === 3) return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
  if (h.length >= 6) return `#${h.slice(0, 6)}`;
  return null;
}

export interface ImportResult {
  ok: boolean;
  theme?: CodeTheme;
  /** How many of the eight coloured roles the theme actually supplied. Shown, so a theme that maps
   *  badly is visible as a number rather than as a preview that looks vaguely wrong. */
  mapped?: number;
  error?: string;
}

/**
 * Turn a Visual Studio Code theme file into one of ours. Given the RAW file text, comments and
 * trailing commas and all.
 */
export function importVsCodeTheme(raw: string, fallbackName?: string): ImportResult {
  let t: RawTheme;
  try {
    t = JSON.parse(stripJsonc(raw)) as RawTheme;
  } catch {
    return { ok: false, error: "That file is not a theme this app can read." };
  }
  if (!t || typeof t !== "object") return { ok: false, error: "That file is not a theme this app can read." };

  const tokens = Array.isArray(t.tokenColors) ? t.tokenColors : [];
  const type: "dark" | "light" = t.type === "light" ? "light" : "dark";
  const base = BUILT_IN[type === "dark" ? DEFAULT_DARK : DEFAULT_LIGHT];

  const background = hex6(t.colors?.["editor.background"]) ?? base.background;
  // A theme may set no editor.foreground and instead carry a scope-less tokenColor as its default.
  const bare = tokens.find((x) => !x.scope && x.settings?.foreground);
  const plain = hex6(t.colors?.["editor.foreground"]) ?? hex6(bare?.settings?.foreground) ?? base.colors.plain;

  const colors: Record<Role, string> = { ...base.colors, plain };
  let mapped = 0;
  let commentItalic = false;
  for (const role of Object.keys(SCOPES) as Exclude<Role, "plain">[]) {
    for (const wanted of SCOPES[role]) {
      const hit = findScope(tokens, wanted);
      const c = hex6(hit?.settings?.foreground);
      if (!c) continue;
      colors[role] = c;
      mapped++;
      if (role === "comment") commentItalic = (hit?.settings?.fontStyle ?? "").includes("italic");
      break;
    }
  }

  if (mapped === 0) return { ok: false, error: "That theme file has no code colours in it." };
  return {
    ok: true,
    mapped,
    theme: { name: t.name || fallbackName || "Imported theme", type, background, commentItalic, colors },
  };
}
