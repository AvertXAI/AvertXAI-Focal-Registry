/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
/* File: tests/editortail.test.ts */
// The text an editor still owes the page (AS-01): Milkdown reports a change 200 ms late, so focus
// leaving the editor hands it over at once. Here a document is a plain string and every string is
// made up. Run with `npm test`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createTail } from "../src/shared/editorTail";

function harness() {
  const told: string[] = [];
  let writes = 0;
  const tail = createTail<string>((markdown) => void told.push(markdown), (a, b) => a === b);
  const write = (doc: string): string => {
    writes += 1;
    return `md:${doc}`;
  };
  return { tail, told, write, writes: () => writes };
}

test("words typed just before focus leaves are handed over at once, and Milkdown's late report of them is dropped", () => {
  const h = harness();
  h.tail.changed("fake a");
  h.tail.handOver("fake a b", h.write);
  assert.deepEqual(h.told, ["md:fake a b"], "handed over without waiting out the 200 ms");
  h.tail.reported("md:fake a b");
  assert.deepEqual(h.told, ["md:fake a b"], "the same text is not reported twice");
  h.tail.reported("md:fake a b c");
  assert.deepEqual(h.told, ["md:fake a b", "md:fake a b c"], "a later change is reported as ever");
});

test("with nothing owed, focus leaving hands over nothing and the document is not even written out", () => {
  const h = harness();
  h.tail.handOver("fake a", h.write);
  h.tail.changed("fake a");
  h.tail.reported("md:fake a b");
  h.tail.handOver("fake a b", h.write);
  assert.deepEqual(h.told, ["md:fake a b"], "only Milkdown's own report");
  assert.equal(h.writes(), 0);
});

test("text typed and taken back again is not a change", () => {
  const h = harness();
  h.tail.changed("fake a");
  h.tail.changed("fake a b"); // the second keystroke: what counts is the document before the first
  h.tail.handOver("fake a", h.write);
  assert.deepEqual(h.told, []);
  assert.equal(h.writes(), 0);
});

test("typing that goes on after a hand-over is reported by Milkdown as usual", () => {
  const h = harness();
  h.tail.changed("fake a");
  h.tail.handOver("fake a b", h.write);
  h.tail.changed("fake a b");
  h.tail.reported("md:fake a b c");
  assert.deepEqual(h.told, ["md:fake a b", "md:fake a b c"]);
  // The dropped-repeat memory does not outlive the report that followed the hand-over.
  h.tail.changed("fake a b c");
  h.tail.reported("md:fake a b");
  assert.deepEqual(h.told, ["md:fake a b", "md:fake a b c", "md:fake a b"], "going back to earlier text is a change");
});

test("a second hand-over with nothing new typed hands over nothing", () => {
  const h = harness();
  h.tail.changed("fake a");
  h.tail.handOver("fake a b", h.write);
  h.tail.handOver("fake a b", h.write);
  assert.deepEqual(h.told, ["md:fake a b"]);
  assert.equal(h.writes(), 1);
});
