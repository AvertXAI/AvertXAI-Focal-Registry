/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
/* File: tests/scannotes-deliver.test.ts */
// Scan Notes autosave (AS-01). The editor reports typing 200 milliseconds after the keystroke, so
// a save made by clicking away has to ask it for the text. These run the question it answers,
// "is there text the page has not been given yet?", against the markdown setup Scan Notes really
// uses, built without a window. Every string is made up. Run with `npm test`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Editor, parserCtx, serializerCtx } from "@milkdown/kit/core";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { scanNotesMarkdownSetup, undelivered } from "../src/modules/scan/notes/MilkdownEditor";

// Milkdown signals readiness through window events and its view needs a real page; Node has
// neither. An event bus stands in for the first. The view simply fails to mount: the parser and
// serializer are built before it, which is all these tests use.
const bus = new EventTarget();
Object.assign(globalThis, {
  addEventListener: bus.addEventListener.bind(bus),
  removeEventListener: bus.removeEventListener.bind(bus),
  dispatchEvent: bus.dispatchEvent.bind(bus),
  document: { body: {} },
});

const ready = (async () => {
  const editor = scanNotesMarkdownSetup(Editor.make());
  await editor.create().catch(() => undefined);
  const ctx = editor.ctx;
  const parse = (markdown: string): ProseNode => ctx.get(parserCtx)(markdown);
  const write = (doc: ProseNode): string => ctx.get(serializerCtx)(doc);
  return { ctx, parse, write };
})();

test("a note that was only opened has nothing to hand over, however its stored text is spelled", async () => {
  const { ctx, parse, write } = await ready;
  const storedText = "Fake first paragraph.\n\n\n\n\nFake second paragraph.";
  const opened = parse(storedText);
  const told = write(opened);
  // The reason the editor remembers its own spelling and not the stored one: against the stored
  // text this note would look edited the moment it was opened, and clicking away would rewrite it.
  assert.notEqual(told, storedText, "the editor spells this note differently from the store");
  assert.equal(undelivered(ctx, opened, told), null);
});

test("words typed since the last hand-over come back as the markdown a save stores", async () => {
  const { ctx, parse, write } = await ready;
  const before = parse("Fake first paragraph.");
  const after = parse("Fake first paragraph. Fake last words.");
  const pending = undelivered(ctx, after, write(before));
  assert.equal(pending, write(after));
  assert.ok(pending?.includes("Fake last words."), String(pending));
});

test("text that was handed over is not handed over a second time", async () => {
  const { ctx, parse, write } = await ready;
  const typed = parse("Fake first paragraph. Fake last words.");
  const first = undelivered(ctx, typed, write(parse("Fake first paragraph.")));
  assert.equal(typeof first, "string");
  assert.equal(undelivered(ctx, typed, first as string), null);
});
