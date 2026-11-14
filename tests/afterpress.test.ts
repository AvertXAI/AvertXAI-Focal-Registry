/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
/* File: tests/afterpress.test.ts */
// A save made as focus leaves an editor lands while the mouse button is still down on the row he
// pressed. A list redrawn at that moment takes the row away and the click is never sent (AS-01).
// These cases drive the rule with a made-up window and a made-up timer, then read the three
// screens whose saves redraw a list for their side of it. Run with `npm test`.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { createAfterPress } from "../src/shared/afterPress";

function harness() {
  const heard = new Map<string, { run: () => void; capture: boolean }>();
  const timers: Array<() => void> = [];
  const afterPress = createAfterPress(
    (name, run, capture) => void heard.set(name, { run, capture: capture === true }),
    (run) => void timers.push(run)
  );
  const ran: string[] = [];
  return {
    afterPress,
    ran,
    heard,
    timers,
    fire: (name: string): void => heard.get(name)!.run(),
    /** The turn after the release: the click has been sent by now. */
    tick: (): void => timers.splice(0).forEach((run) => run()),
    work: (name: string) => (): void => void ran.push(name),
  };
}

test("with no mouse press in progress the work runs at once", () => {
  const h = harness();
  h.afterPress(h.work("list"));
  assert.deepEqual(h.ran, ["list"]);
  assert.equal(h.timers.length, 0);
});

test("work asked for during a press waits for the release, and then for the click the release ends in", () => {
  const h = harness();
  h.fire("pointerdown");
  h.afterPress(h.work("first"));
  h.afterPress(h.work("second"));
  assert.deepEqual(h.ran, [], "the row under the mouse must still be there when the button comes up");
  h.fire("pointerup");
  assert.deepEqual(h.ran, [], "the click is sent right after the release, so the work is not run inside it");
  h.tick();
  assert.deepEqual(h.ran, ["first", "second"]);
  h.afterPress(h.work("third"));
  assert.deepEqual(h.ran, ["first", "second", "third"], "once the press is over, work runs at once again");
});

for (const end of ["pointercancel", "blur"]) {
  test(`a press that ends in ${end} lets the waiting work go too`, () => {
    const h = harness();
    h.fire("pointerdown");
    h.afterPress(h.work("list"));
    h.fire(end);
    h.tick();
    assert.deepEqual(h.ran, ["list"]);
  });
}

test("a release with nothing waiting asks for no timer, and a second press does not hold back the first one's work", () => {
  const h = harness();
  h.fire("pointerup");
  h.fire("pointerdown");
  h.fire("pointerup");
  assert.equal(h.timers.length, 0);
  h.fire("pointerdown");
  h.afterPress(h.work("first"));
  h.fire("pointerup");
  h.fire("pointerdown");
  h.afterPress(h.work("second"));
  h.tick();
  assert.deepEqual(h.ran, ["first"]);
  h.fire("pointerup");
  h.tick();
  assert.deepEqual(h.ran, ["first", "second"]);
});

test("the press is heard before the page hears it, and the window's own blur is not mixed up with an editor losing focus", () => {
  const h = harness();
  assert.equal(h.heard.get("pointerdown")!.capture, true, "known before the press moves focus and starts the save");
  assert.equal(h.heard.get("pointerup")!.capture, true);
  assert.equal(h.heard.get("pointercancel")!.capture, true);
  // In the capture phase the window also hears every element's blur. The editor losing focus is
  // what starts the save, so hearing it would end the wait before the save had even landed.
  assert.equal(h.heard.get("blur")!.capture, false);
});

/** The runner starts every test file in the repo root. Line ends are evened out: the repo is CRLF. */
const source = (...parts: string[]): string =>
  fs.readFileSync(path.join(process.cwd(), "src", "modules", ...parts), "utf8").replace(/\r\n/g, "\n");
const count = (text: string, piece: string): number => text.split(piece).length - 1;

test("the three screens whose saves redraw a list send that redraw through the rule, and nothing else", () => {
  const docs = source("mindmerge", "DocsSurface.tsx");
  // "+ New" redraws the list too, but from a button outside it and not from a save.
  const saved = docs.slice(docs.indexOf("onSaved: (info) => {"), docs.indexOf("onError: (message, key) => setSaveErr"));
  assert.equal(count(saved, "afterPress(() => p.onSaved());"), 1);
  assert.equal(count(saved, "p.onSaved()"), 1, "Documents: no list redraw straight from a save");

  const vault = source("vault", "NotesView.tsx");
  assert.equal(count(vault, "if (renamed || !idle) afterPress(() => loadList(style, false));"), 1);

  const notes = source("mindmerge", "NotesView.tsx");
  assert.equal(count(notes, "afterPress(() => loadList(style, false));"), 1);

  for (const [name, text] of [["Documents", docs], ["Vault notes", vault], ["MindMerge notes", notes]] as const) {
    assert.equal(count(text, 'import { afterPress } from "../../shared/afterPress";'), 1, name);
    assert.equal(count(text, "afterPress("), 1, `${name}: only the list redraw waits. The save itself never does`);
  }
});
