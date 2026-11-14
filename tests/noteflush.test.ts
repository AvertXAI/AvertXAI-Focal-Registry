/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
/* File: tests/noteflush.test.ts */
// Unsaved notes at quit, on a fake page: the quit waits for the page to write, a note that could
// not be written is listed with Retry and Quit anyway, and Cancel keeps the app open. The names
// are made up. Run with `npm test`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createNoteFlush } from "../electron/core/services/work/noteFlush";
import { createQuitGuard, type GuardState } from "../electron/core/services/work/quitGuard";

function harness() {
  // What the fake page answers to each round, in order. An Error means it did not answer.
  const answers: Array<string[] | Error> = [];
  let asks = 0;
  const notes = createNoteFlush({
    ask: () => {
      asks += 1;
      const next = answers.shift() ?? [];
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
  });
  const published: Array<GuardState | null> = [];
  let tick: () => void = () => undefined;
  let quits = 0;
  const guard = createQuitGuard({
    running: () => notes.source.list(),
    act: (id, action) => notes.source.act(id, action),
    publish: (state) => void published.push(state),
    every: (fn) => {
      tick = fn;
      return () => undefined;
    },
  });
  // What guardMain does once the round is over.
  const quit = async (): Promise<void> => {
    await notes.flush();
    if (!guard.request("quit", () => void quits++)) quits++;
  };
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  return { notes, guard, answers, published, asks: () => asks, quits: () => quits, quit, tick: () => tick(), settle };
}

test("no unsaved notes: a quit does not wait for the page", () => {
  const h = harness();
  assert.equal(h.notes.mustFlush(), false);
  h.notes.report(0);
  assert.equal(h.notes.mustFlush(), false);
  assert.equal(h.asks(), 0);
});

test("unsaved notes that the page writes: the quit goes on, and is not held a second time", async () => {
  const h = harness();
  h.notes.report(2);
  assert.equal(h.notes.mustFlush(), true);
  h.answers.push([]);
  await h.quit();
  assert.equal(h.quits(), 1);
  assert.equal(h.published.length, 0, "no toast for notes that were written");
  assert.equal(h.notes.mustFlush(), false, "the quit that follows passes, even before the page's own count arrives");
});

test("a note that could not be written is listed with Retry and Quit anyway, and the quit waits", async () => {
  const h = harness();
  h.notes.report(1);
  h.answers.push(["Fake note title"]);
  await h.quit();
  assert.equal(h.quits(), 0);
  const line = h.published.at(-1)?.lines[0];
  assert.equal(line?.text, "Note not saved: Fake note title");
  assert.equal(line?.kind, "note");
  assert.deepEqual(line?.actions, ["retry", "quitAnyway"]);
});

test("a note with no title is still listed", async () => {
  const h = harness();
  h.notes.report(1);
  h.answers.push([""]);
  await h.quit();
  assert.equal(h.published.at(-1)?.lines[0].text, "Note not saved");
});

test("Retry that works lets the quit go on", async () => {
  const h = harness();
  h.notes.report(1);
  h.answers.push(["Fake note title"], []);
  await h.quit();
  h.guard.answer(h.published.at(-1)?.lines[0].id as string, "retry");
  assert.equal(h.asks(), 2, "the page was asked to write again");
  await h.settle();
  h.tick();
  assert.equal(h.quits(), 1);
  assert.equal(h.published.at(-1), null);
});

test("Retry that fails asks again about the same note, with its buttons back", async () => {
  const h = harness();
  h.notes.report(1);
  h.answers.push(["Fake note title"], ["Fake note title"]);
  await h.quit();
  const first = h.published.at(-1)?.lines[0].id as string;
  h.guard.answer(first, "retry");
  await h.settle();
  h.tick();
  assert.equal(h.quits(), 0);
  const again = h.published.at(-1);
  assert.equal(again?.lines.length, 1);
  assert.notEqual(again?.lines[0].id, first, "a new line, so it has no answer yet");
  assert.equal(again?.lines[0].answer, null);
  assert.equal(again?.waiting, false);
});

test("Quit anyway quits, and the quit that follows does not ask the page again", async () => {
  const h = harness();
  h.notes.report(1);
  h.answers.push(["Fake note title"]);
  await h.quit();
  h.guard.answer(h.published.at(-1)?.lines[0].id as string, "quitAnyway");
  h.tick();
  assert.equal(h.quits(), 1);
  assert.equal(h.notes.mustFlush(), false, "the page still holds the note, and he has already answered for it");
  assert.equal(h.asks(), 1);
});

test("text typed after Quit anyway is a new question", async () => {
  const h = harness();
  h.notes.report(1);
  h.answers.push(["Fake note title"]);
  await h.quit();
  h.guard.answer(h.published.at(-1)?.lines[0].id as string, "quitAnyway");
  h.notes.report(2);
  assert.equal(h.notes.mustFlush(), true);
});

test("Cancel keeps the app open and forgets the lines, so a later quit asks the page afresh", async () => {
  const h = harness();
  h.notes.report(1);
  h.answers.push(["Fake note title"]);
  await h.quit();
  h.guard.cancel();
  h.notes.clear();
  assert.equal(h.quits(), 0);
  assert.deepEqual(h.notes.source.list(), []);
  assert.equal(h.notes.mustFlush(), true);
});

test("notes that get written while the toast is up take their line away, and the app stays open", async () => {
  const h = harness();
  h.notes.report(1);
  h.answers.push(["Fake note title"]);
  await h.quit();
  h.notes.report(0); // the screen's own pause wrote it
  h.tick();
  assert.equal(h.published.at(-1), null);
  assert.equal(h.quits(), 0, "he gave no answer, so the quit is not his to have");
});

test("a page that does not answer is listed as possibly unsaved", async () => {
  const h = harness();
  h.notes.report(1);
  h.answers.push(new Error("no answer"));
  await h.quit();
  assert.equal(h.quits(), 0);
  assert.equal(h.published.at(-1)?.lines[0].text, "Notes may not be saved: the window did not answer.");
});

test("two quits during one round ask the page once", async () => {
  const h = harness();
  h.notes.report(1);
  h.answers.push([]);
  const a = h.notes.flush();
  const b = h.notes.flush();
  await Promise.all([a, b]);
  assert.equal(h.asks(), 1);
});
