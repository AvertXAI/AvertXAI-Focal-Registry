/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
/* File: tests/notesautosave.test.ts */
// The MindMerge and the Vault notes screens save by the shared autosave rule (AS-01). The rule
// itself is tested in tests/autosave.test.ts. A screen is a React view and this runner has no
// window, so these cases read each screen's own source for its side of the rule: no write of a
// note outside the hook, no clearing of the unsaved mark without the hook's say, and a save before
// anything replaces the text on screen. They pin the shape; they do not prove how a screen behaves.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const SCREENS = ["mindmerge", "vault"] as const;

/** The runner starts every test file in the repo root. Line ends are evened out: the repo is CRLF. */
const source = (name: string): string =>
  fs.readFileSync(path.join(process.cwd(), "src", "modules", name, "NotesView.tsx"), "utf8").replace(/\r\n/g, "\n");
const count = (text: string, piece: string): number => text.split(piece).length - 1;
// Patterns are checked with RegExp.test, not assert.match: a failed assert.match carries the whole
// source file in its error, and the test runner then never exits.

for (const name of SCREENS) {
  const text = source(name);
  const named = (what: string): string => `${name} notes screen: ${what}`;

  test(named("saving is the shared hook's, with no pause or window-close save of its own"), () => {
    assert.equal(count(text, 'import { useAutosave } from "../../shared/useAutosave";'), 1);
    assert.equal(count(text, "useAutosave<NoteText>("), 1);
    assert.equal(count(text, `scope: "${name}-note",`), 1, "a reopened screen's text replaces what a closed one still held");
    assert.equal(count(text, "AUTOSAVE_MS"), 0, "the pause is the hook's one shared constant");
    assert.equal(count(text, "beforeunload"), 0, "the hook saves when the window closes");
    assert.equal(count(text, "setTimeout("), 1, "the one timer left is the Saved flash");
  });

  test(named("a note's text reaches the store through one write, the one the hook calls"), () => {
    assert.equal(count(text, "api.updateNote("), 1);
    assert.equal(count(text, "save: (uuid, text) => api.updateNote(uuid, text).then("), 1);
  });

  test(named("the unsaved mark is cleared only when the screen still shows what was sent"), () => {
    const handler = /onSaved: \(\{ value, result, current: still, idle \}\) => \{\n([\s\S]*?)\n    \},\n/.exec(text)?.[1] ?? "";
    const guard = handler.indexOf("if (!still) return;");
    assert.ok(guard >= 0, "the saved handler asks the hook whether the screen still shows that text");
    assert.ok(guard < handler.indexOf("setDirty(false);"), "and asks before it clears the mark");
    assert.equal(count(handler, "setDirty("), 1);
    assert.equal(count(text, "setDirty(false)"), 2, "the saved handler, and a note that was just created empty");
    assert.equal(count(text, "setDirty(text !== n);"), 1, "a note read from the store is clean unless a refused save left text for it");
  });

  test(named("a click away from the title, the raw box or either editor saves"), () => {
    assert.equal(count(text, "onBlur={() => void flush()}"), 2, "the editing pane, and Split's editor pane");
    assert.ok(!/notetitle inhdr"[^\n]*onBlur=\{save\}/.test(text));
    assert.equal(count(text, "onClick={save}"), 0);
  });

  test(named("the text is saved before anything else replaces it on screen"), () => {
    assert.ok(/void flush\(\)\s*\.then\(\(\) => api\.getNote\(uuid\)\)\s*\.then\(show\)/.test(text), "a note opened from the list");
    assert.ok(/void flush\(\)\s*\.then\(\(\) => api\.getNote\(wanted\)\)/.test(text), "a note opened from search");
    assert.ok(/void flush\(\)\s*\.then\(\(\) => api\.createNote\(/.test(text), "+ New");
    assert.equal((text.match(/flush\(\)\s*\.then\(\(\) => Promise\.all\(/g) ?? []).length, 4, "archive, delete for good, restore, permanent delete");
    assert.ok(/const setMode = \(m: Mode\): void => \{ void flush\(\); /.test(text), "a switch of editor mode");
    assert.ok(/r\.length === 0\) \{ void flush\(\); setCurrent\(null\);/.test(text), "an empty folder, style or shelf");
    assert.equal(count(text, "e.preventDefault(); void flush(); }"), 1, "Ctrl+S");
  });

  test(named("text a save was refused for comes back with its note, and a deleted note is let go"), () => {
    assert.ok(/^const refused = new Map<string, NoteText>\(\);$/m.test(text));
    assert.equal(count(text, "refused.set(uuid, text);"), 1, "a refused save keeps its text");
    assert.equal(count(text, "(n) => { refused.delete(uuid); return n; },"), 1, "a save that lands lets it go");
    assert.equal(count(text, "const text = refused.get(n.uuid) ?? n;"), 1, "opening the note puts it back on screen");
    assert.ok(/lastOpenUuid && \(refused\.has\(lastOpenUuid\) \|\| /.test(text), "the note with unsaved text is the one that reopens");
    assert.equal(count(text, "for (const uuid of gone) if (uuid) { refused.delete(uuid); discard(uuid); }"), 1);
    assert.equal(count(text, ".then(() => u, () => null)"), 2, "only a delete that went through lets a note go");
  });
}
