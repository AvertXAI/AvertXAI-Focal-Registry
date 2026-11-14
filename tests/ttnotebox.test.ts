/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
/* File: tests/ttnotebox.test.ts */
// The TimeTracker notes boxes (AS-01): what the project pad and the Session notes box do with the
// text on screen when a write lands and when the project or the timer is read again. The boxes are
// plain data and pure functions, so nothing here needs a window. Every string is made up.
import assert from "node:assert/strict";
import { test } from "node:test";
import { noteBoxLoaded, noteBoxSaved, noteBoxShown, noteBoxTyped, noteBoxUnsaved } from "../src/modules/timetracker/noteBox";
import { BULLET, packSessionNotes, parseSessionNotes, sessionNotesText } from "../src/shared/ttNotes";

const KEY = "7";
const fresh = (stored: string) => noteBoxLoaded(null, KEY, stored);

test("a re-read while he is typing keeps the typed text and the textarea it is in", () => {
  const typed = noteBoxTyped(fresh("Fake stored line"), KEY, "Fake stored line plus typing")!;
  const reread = noteBoxLoaded(typed, KEY, "Fake text written elsewhere");
  assert.equal(reread.text, "Fake stored line plus typing", "the re-read does not replace what he typed");
  assert.equal(reread.seed, typed.seed, "and does not remount the textarea");
  assert.equal(reread.saved, "Fake text written elsewhere", "saved follows the database");
  assert.equal(noteBoxUnsaved(reread), true, "so the typed text is still written");
});

test("a re-read with nothing unsaved shows the stored text, and only a changed text re-seeds", () => {
  const box = fresh("Fake old");
  assert.equal(noteBoxLoaded(box, KEY, "Fake old"), box, "an unchanged re-read hands back the same box");
  const next = noteBoxLoaded(box, KEY, "Fake new");
  assert.deepEqual(next, { key: KEY, text: "Fake new", saved: "Fake new", seed: 1 });
  assert.equal(noteBoxLoaded(next, KEY, "Fake new"), next, "and settles in one step");
});

test("text typed during a write stays unsaved, and so does text taken back to the older saved text", () => {
  let box = noteBoxTyped(fresh("Fake A"), KEY, "Fake A B");
  box = noteBoxTyped(box, KEY, "Fake A B C");
  box = noteBoxSaved(box, KEY, "Fake A B");
  assert.equal(noteBoxUnsaved(box!), true, "C was typed while A B was being written");
  box = noteBoxSaved(box, KEY, "Fake A B C");
  assert.equal(noteBoxUnsaved(box!), false, "saved once the database holds what is on screen");

  let back = noteBoxTyped(fresh("Fake A"), KEY, "Fake A B");
  back = noteBoxTyped(back, KEY, "Fake A");
  assert.equal(noteBoxUnsaved(back!), false, "nothing has landed yet, so the old text is the saved text");
  back = noteBoxSaved(back, KEY, "Fake A B");
  assert.equal(noteBoxUnsaved(back!), true, "the write of A B landed after he took B back");
});

test("a write or a keystroke for another project or timer never lands in the box on screen", () => {
  const box = noteBoxTyped(fresh("Fake A"), KEY, "Fake A typed")!;
  assert.equal(noteBoxSaved(box, "8", "Fake A typed"), box);
  assert.equal(noteBoxTyped(box, "8", "Fake other"), box);
  assert.deepEqual(noteBoxLoaded(box, "8", "Fake B"), { key: "8", text: "Fake B", saved: "Fake B", seed: 0 });
  assert.equal(noteBoxSaved(null, KEY, "Fake A"), null);
  assert.equal(noteBoxTyped(null, KEY, "Fake A"), null);
});

test("the autosave rule is shown the box as it stands", () => {
  assert.equal(noteBoxShown(null), null);
  assert.deepEqual(noteBoxShown(fresh("Fake A")), { key: KEY, value: "Fake A", dirty: false });
  assert.deepEqual(noteBoxShown(noteBoxTyped(fresh("Fake A"), KEY, "Fake A B")), { key: KEY, value: "Fake A B", dirty: true });
});

test("Session notes text reads as the packed column hands it back, so an empty line is not unsaved text", () => {
  const typed = `${BULLET} Fake first\n\n   \n${BULLET} Fake second\n`;
  const packed = packSessionNotes({ firstAt: "2026-01-02T03:04:05.000Z", lines: typed.split("\n") });
  const stored = parseSessionNotes(packed).lines.join("\n");
  assert.equal(sessionNotesText(typed), stored);
  assert.equal(sessionNotesText(typed), `${BULLET} Fake first\n${BULLET} Fake second`);
  assert.equal(sessionNotesText("\n  \n"), "");

  const sent = sessionNotesText(typed);
  const box = noteBoxSaved(noteBoxTyped(noteBoxLoaded(null, "3", ""), "3", sent), "3", sent)!;
  assert.equal(noteBoxUnsaved(box), false);
  assert.equal(noteBoxLoaded(box, "3", stored), box, "the status that comes back with the save does not remount the box he is typing in");
});
