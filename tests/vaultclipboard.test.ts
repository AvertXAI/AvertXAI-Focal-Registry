/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
/* File: tests/vaultclipboard.test.ts */
// The Vault's timed clipboard clear (VA-04): a copy made with a Vault button and a copy the browser
// made itself (Ctrl+C, Ctrl+X, the menu's Copy in a note) are both cleared when the wait runs out,
// and only while the clipboard still holds them. The clipboard and the clock here are fakes, every
// string is made up, and no timer really waits.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { _resetForTest, clearAfterOwnCopy, copyWithClear, shouldClear } from "../electron/core/services/vault/clipboard";

/** A clipboard with a text flavour and one other thing (a picture, a file), which reads as no text. */
function fakeClipboard() {
  const clip = {
    text: "",
    picture: false,
    read: (): string => clip.text,
    write: (text: string): void => {
      clip.text = text;
      clip.picture = false;
    },
    clear: (): void => {
      clip.text = "";
      clip.picture = false;
    },
    copyPicture: (): void => {
      clip.text = "";
      clip.picture = true;
    },
  };
  return clip;
}

interface FakeTimer {
  run: () => void;
  ms: number;
  cancelled: boolean;
}

function fakeClock() {
  const timers: FakeTimer[] = [];
  return {
    timers,
    set: (run: () => void, ms: number): unknown => {
      const timer: FakeTimer = { run, ms, cancelled: false };
      timers.push(timer);
      return timer;
    },
    clear: (timer: unknown): void => {
      (timer as FakeTimer).cancelled = true;
    },
    /** The wait of timer `i` runs out. A cancelled timer never fires, as with clearTimeout. */
    elapse: (i: number): void => {
      if (!timers[i].cancelled) timers[i].run();
    },
  };
}

const NOTE_TEXT = "Fake Person 000-00-1234";

beforeEach(() => _resetForTest());

test("the rule: cleared only while the clipboard still holds what the vault left there", () => {
  assert.equal(shouldClear(NOTE_TEXT, NOTE_TEXT), true, "still the vault's copy");
  assert.equal(shouldClear(NOTE_TEXT, "copied from a fake web page"), false, "he copied something else afterwards");
  assert.equal(shouldClear(NOTE_TEXT, ""), false, "a picture or a file is on the clipboard now");
  assert.equal(shouldClear("", ""), false, "an empty copy holds nothing to recognise");
});

test("an editor's own copy is cleared when the wait runs out, and is not rewritten", () => {
  const clip = fakeClipboard();
  const clock = fakeClock();
  clip.write(NOTE_TEXT); // the browser's own write, before main hears of the copy
  assert.equal(clearAfterOwnCopy(NOTE_TEXT, 30, clip, clock), true);
  assert.equal(clip.text, NOTE_TEXT, "the copy is still there to paste");
  assert.equal(clock.timers.length, 1);
  assert.equal(clock.timers[0].ms, 30_000, "the wait is the setting's seconds");
  clock.elapse(0);
  assert.equal(clip.text, "", "cleared when the wait ran out");
});

test("something copied afterwards is left alone", () => {
  const clip = fakeClipboard();
  const clock = fakeClock();
  clip.write(NOTE_TEXT);
  clearAfterOwnCopy(NOTE_TEXT, 30, clip, clock);
  clip.write("copied from a fake web page");
  clock.elapse(0);
  assert.equal(clip.text, "copied from a fake web page", "a later text copy survives");

  clip.write(NOTE_TEXT);
  clearAfterOwnCopy(NOTE_TEXT, 30, clip, clock);
  clip.copyPicture();
  clock.elapse(1);
  assert.equal(clip.picture, true, "a later picture copy survives");
});

test("a second copy inside the wait restarts it, and the first timer cannot clear the second copy", () => {
  const clip = fakeClipboard();
  const clock = fakeClock();
  clip.write("first fake line");
  clearAfterOwnCopy("first fake line", 30, clip, clock);
  clip.write("second fake line");
  clearAfterOwnCopy("second fake line", 30, clip, clock);
  assert.equal(clock.timers[0].cancelled, true, "the first wait is over");
  clock.timers[0].run(); // even if it fired all the same
  assert.equal(clip.text, "second fake line", "the first timer leaves the second copy alone");
  clock.elapse(1);
  assert.equal(clip.text, "", "the second copy is cleared at the end of its own wait");
});

test("a button copy and an editor copy of the same text share one wait, the later one", () => {
  const clip = fakeClipboard();
  const clock = fakeClock();
  copyWithClear("same fake line", 30, clip, clock);
  assert.equal(clearAfterOwnCopy("same fake line", 30, clip, clock), true);
  clock.elapse(0);
  assert.equal(clip.text, "same fake line", "not cleared early by the button's wait");
  clock.elapse(1);
  assert.equal(clip.text, "");
});

test("a copy that never reached the clipboard starts nothing, and the older copy stays", () => {
  const clip = fakeClipboard();
  const clock = fakeClock();
  clip.write("copied somewhere else earlier");
  assert.equal(clearAfterOwnCopy("", 30, clip, clock), false, "nothing was selected");
  assert.equal(clearAfterOwnCopy(NOTE_TEXT, 30, clip, clock), false, "the write did not land");
  assert.equal(clock.timers.length, 0);
  assert.equal(clip.text, "copied somewhere else earlier");
});

test("Windows line ends and plain spaces do not hide a copy that did arrive", () => {
  const clip = fakeClipboard();
  const clock = fakeClock();
  clip.write("fake line one\r\nfake line two");
  assert.equal(clearAfterOwnCopy("fake line one\nfake\u00a0line two", 30, clip, clock), true);
  clock.elapse(0);
  assert.equal(clip.text, "");
});

test("an empty button copy never clears a picture copied afterwards", () => {
  const clip = fakeClipboard();
  const clock = fakeClock();
  copyWithClear("", 30, clip, clock);
  clip.copyPicture();
  clock.elapse(0);
  assert.equal(clip.picture, true);
});

test("a wait of zero means never, for an editor copy too", () => {
  const clip = fakeClipboard();
  const clock = fakeClock();
  clip.write(NOTE_TEXT);
  assert.equal(clearAfterOwnCopy(NOTE_TEXT, 0, clip, clock), false);
  assert.equal(clock.timers.length, 0);
  assert.equal(clip.text, NOTE_TEXT);
});
