/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
/* File: tests/autosave.test.ts */
// The one autosave rule, run once per notes screen with that screen's shape of text and a fake
// store whose write takes 500 milliseconds. Time is a hand-wound clock, so nothing here waits.
// Every string is made up. Run with `npm test`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { AUTOSAVE_MS, createAutosaver, flushAllNotes, onUnsavedCount } from "../src/shared/autosave";

interface Titled {
  title: string;
  body: string;
}
interface Screen<T> {
  name: string;
  text: (typed: string) => T;
  same: (a: T, b: T) => boolean;
}
const titled: Pick<Screen<Titled>, "text" | "same"> = {
  text: (typed) => ({ title: "Fake title", body: typed }),
  same: (a, b) => a.title === b.title && a.body === b.body,
};
const plain: Pick<Screen<string>, "text" | "same"> = { text: (typed) => typed, same: (a, b) => a === b };
const SCREENS: Array<Screen<Titled> | Screen<string>> = [
  { name: "MindMerge notes", ...titled },
  { name: "Vault notes", ...titled },
  { name: "MindMerge Documents", ...plain },
  { name: "Scan Notes", ...titled },
  { name: "TimeTracker project notes", ...plain },
];

function clock() {
  let now = 0;
  let nextId = 1;
  const due = new Map<number, { at: number; fn: () => void }>();
  // A write that lands hands on to promise callbacks, and those have to run before the clock
  // moves again or the test would be ahead of the code.
  const drain = async (): Promise<void> => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  return {
    timers: {
      set: (fn: () => void, ms: number): unknown => {
        due.set(nextId, { at: now + ms, fn });
        return nextId++;
      },
      clear: (handle: unknown): void => void due.delete(handle as number),
    },
    async advance(ms: number): Promise<void> {
      const end = now + ms;
      for (;;) {
        await drain();
        const next = [...due.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        due.delete(next[0]);
        now = next[1].at;
        next[1].fn();
      }
      now = end;
      await drain();
    },
  };
}

function harness<T>(screen: Screen<T>, writeMs = 500, scope = "") {
  const c = clock();
  const store = new Map<string, T>();
  const started: Array<[string, T]> = [];
  const saved: Array<{ key: string; idle: boolean }> = [];
  const errors: string[] = [];
  let failNext = 0;
  const saver = createAutosaver<T>({
    save: (key, value) => {
      started.push([key, value]);
      return new Promise((resolve, reject) => {
        const fail = failNext > 0 && failNext-- > 0;
        c.timers.set(() => {
          if (fail) {
            reject(new Error("The fake store is full."));
            return;
          }
          store.set(key, value);
          resolve(value);
        }, writeMs);
      });
    },
    same: screen.same,
    scope,
    onSaved: ({ key, idle }) => void saved.push({ key, idle }),
    onError: (message) => void errors.push(message),
    timers: c.timers,
  });
  const close = (): void => {
    for (const key of ["a", "b", "gone"]) saver.discard(key);
    saver.dispose();
  };
  return { c, store, started, saved, errors, saver, failNextWrite: () => void (failNext = 1), text: screen.text, close };
}

// A saver left holding text would be asked to write by the quit-flush test, on a clock nobody winds.
async function using<T>(screen: Screen<T>, body: (h: ReturnType<typeof harness<T>>) => Promise<void>, writeMs = 500): Promise<void> {
  const h = harness(screen, writeMs);
  try {
    await body(h);
  } finally {
    h.close();
  }
}

for (const screen of SCREENS as Array<Screen<unknown>>) {
  test(`${screen.name}: nothing is written while he is still typing, and the write starts one second after he stops`, () => using(screen, async (h) => {
    h.saver.edited("a", h.text("one"));
    await h.c.advance(400);
    h.saver.edited("a", h.text("one two"));
    await h.c.advance(400);
    h.saver.edited("a", h.text("one two three"));
    await h.c.advance(AUTOSAVE_MS - 1);
    assert.equal(h.started.length, 0, "1.8 seconds of typing with no full second of pause");
    await h.c.advance(1);
    assert.equal(h.started.length, 1);
    assert.deepEqual(h.started[0], ["a", h.text("one two three")]);
    await h.c.advance(500);
    assert.deepEqual(h.store.get("a"), h.text("one two three"));
    assert.equal(h.saver.unsaved(), 0);
    assert.deepEqual(h.saved, [{ key: "a", idle: true }]);
  }));

  test(`${screen.name}: text typed during a write keeps the note unsaved, and the store ends with the last text`, () => using(screen, async (h) => {
    h.saver.edited("a", h.text("first"));
    await h.c.advance(AUTOSAVE_MS); // the write of "first" starts
    await h.c.advance(200);
    h.saver.edited("a", h.text("first and more")); // typed while that write is on its way
    await h.c.advance(300); // the write of "first" lands
    assert.deepEqual(h.store.get("a"), h.text("first"));
    assert.equal(h.saver.unsaved(), 1, "the store holds older text than the screen, so the note is not saved");
    await h.c.advance(AUTOSAVE_MS + 500);
    assert.deepEqual(h.store.get("a"), h.text("first and more"));
    assert.equal(h.saver.unsaved(), 0);
    assert.equal(h.started.length, 2);
  }));

  test(`${screen.name}: a pause that runs out during a slow write is not dropped`, () => using(screen, async (h) => {
    h.saver.edited("a", h.text("first"));
    await h.c.advance(AUTOSAVE_MS); // write one starts and lands at 2500
    await h.c.advance(100);
    h.saver.edited("a", h.text("second")); // its pause runs out at 2100, with write one still out
    await h.c.advance(1300);
    assert.equal(h.started.length, 1, "two writes of one note are never out at once");
    await h.c.advance(200); // write one lands, and write two starts at once
    assert.equal(h.started.length, 2);
    await h.c.advance(1500);
    assert.deepEqual(h.store.get("a"), h.text("second"));
    assert.equal(h.saver.unsaved(), 0);
  }, 1500));

  test(`${screen.name}: a switch of notes in the middle of a write loses nothing`, () => using(screen, async (h) => {
    h.saver.edited("a", h.text("note a"));
    await h.c.advance(AUTOSAVE_MS); // the write of note a starts
    await h.c.advance(100);
    h.saver.edited("a", h.text("note a, typed during the write"));
    const flushed = h.saver.flush(); // the screen flushes, then shows note b
    h.saver.edited("b", h.text("note b"));
    assert.equal(await Promise.all([flushed, h.c.advance(3000)]).then(([ok]) => ok), true);
    assert.deepEqual(h.store.get("a"), h.text("note a, typed during the write"));
    assert.deepEqual(h.store.get("b"), h.text("note b"));
    assert.equal(h.saver.unsaved(), 0);
  }));

  test(`${screen.name}: a write that fails keeps the text, says so, and is written by the next flush`, () => using(screen, async (h) => {
    h.failNextWrite();
    h.saver.edited("a", h.text("kept"));
    await h.c.advance(AUTOSAVE_MS + 500);
    assert.deepEqual(h.errors, ["The fake store is full."]);
    assert.equal(h.saver.unsaved(), 1);
    assert.equal(h.store.has("a"), false);
    const flushed = h.saver.flush();
    await h.c.advance(500);
    assert.equal(await flushed, true);
    assert.deepEqual(h.store.get("a"), h.text("kept"));
  }));
}

test("a re-render with the same text does not put the write off", () => using(SCREENS[0] as Screen<unknown>, async (h) => {
  h.saver.edited("a", h.text("same"));
  await h.c.advance(900);
  h.saver.edited("a", h.text("same"));
  await h.c.advance(100);
  assert.equal(h.started.length, 1);
}));

test("a deleted note is never written back", () => using(SCREENS[2] as Screen<unknown>, async (h) => {
  h.saver.edited("gone", h.text("typed, then the note was deleted"));
  h.saver.discard("gone");
  await h.c.advance(5000);
  assert.equal(await h.saver.flush(), true);
  assert.equal(h.started.length, 0);
}));

test("the unsaved mark is cleared only when the store holds what is on screen", () => using(SCREENS[0] as Screen<unknown>, async (h) => {
  h.saver.edited("a", h.text("one"));
  await h.c.advance(AUTOSAVE_MS);
  h.saver.edited("a", h.text("two"));
  await h.c.advance(500);
  assert.deepEqual(h.saved, [{ key: "a", idle: true }], "the first write landed");
  assert.equal(h.saver.unsaved(), 1, "but the screen shows newer text");
}));

test("a screen that closed with a write failing gives way once the note is typed in again", async () => {
  const closed = harness(SCREENS[2] as Screen<unknown>, 500, "documents");
  const reopened = harness(SCREENS[2] as Screen<unknown>, 500, "documents");
  const elsewhere = harness(SCREENS[2] as Screen<unknown>, 500, "scan-notes");
  try {
    closed.failNextWrite();
    closed.saver.edited("a", closed.text("older text, never written"), "Fake title");
    const leaving = closed.saver.flush();
    await closed.c.advance(600);
    assert.equal(await leaving, false);
    closed.saver.dispose();
    assert.equal(closed.saver.unsaved(), 1, "kept for the quit: it is the newest text there is");

    elsewhere.saver.edited("a", elsewhere.text("another screen's note with the same number"));
    assert.equal(closed.saver.unsaved(), 1, "a different screen's note is not this note");

    reopened.saver.edited("a", reopened.text("newer text"));
    assert.equal(closed.saver.unsaved(), 0);
    const names = flushAllNotes();
    await Promise.all([closed.c.advance(600), reopened.c.advance(600), elsewhere.c.advance(600)]);
    assert.deepEqual(await names, []);
    assert.deepEqual(reopened.store.get("a"), reopened.text("newer text"));
    assert.equal(closed.store.has("a"), false, "the older text was never written over the newer");
  } finally {
    closed.close();
    reopened.close();
    elsewhere.close();
  }
});

test("the quit flush writes every screen's text and names only what could not be written", async () => {
  const counts: number[] = [];
  onUnsavedCount((n) => void counts.push(n));
  const good = harness(SCREENS[0] as Screen<unknown>);
  const bad = harness(SCREENS[2] as Screen<unknown>);
  good.saver.edited("a", good.text("typed just before quitting"), "Fake good title");
  bad.saver.edited("b", bad.text("typed just before quitting"), "Fake bad title");
  bad.failNextWrite();
  const names = flushAllNotes();
  await Promise.all([good.c.advance(600), bad.c.advance(600)]);
  assert.deepEqual(await names, ["Fake bad title"]);
  assert.deepEqual(good.store.get("a"), good.text("typed just before quitting"));
  // Retry: the same call again, and this time the store takes it.
  const again = flushAllNotes();
  await bad.c.advance(600);
  assert.deepEqual(await again, []);
  assert.deepEqual(counts, [0, 1, 2, 1, 0], "main hears each change of the count, starting with the count at wiring");
  good.saver.dispose();
  bad.saver.dispose();
  onUnsavedCount(null);
});
