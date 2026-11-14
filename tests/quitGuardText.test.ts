/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
/* File: tests/quitGuardText.test.ts */
// The words and the times the quit toast and the next-launch prompt show. Run with `npm test`.
// Every time here is built from local parts (new Date(year, month, day, ...)), so the expected
// text is the same in whatever time zone the test runs. Nothing here is real data.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ACTION_LABEL, parseStored, quitHint, quitTitle, readEndTime, toInputValue, whenText } from "../src/components/quitGuardText";

const STARTED = new Date(2026, 10, 12, 17, 5, 42); // 11-12-2026 5:05:42 PM, local
const NOW = new Date(2026, 10, 13, 9, 12, 30).getTime(); // the next morning, 9:12:30 AM, local
const errorOf = (result: { iso: string } | { error: string }): string => ("error" in result ? result.error : "");

test("each way of ending the app has its own title, and an unknown one reads as a plain quit", () => {
  assert.equal(quitTitle("quit"), "Focal Registry is about to close");
  assert.equal(quitTitle("update"), "An update is ready to install");
  assert.equal(quitTitle("shutdown"), "Windows is shutting down");
  assert.equal(quitTitle("something new"), "Focal Registry is about to close");
});

test("every answer the guard can offer has the label the ruling gave it", () => {
  assert.deepEqual(ACTION_LABEL, {
    pause: "Pause",
    stop: "Stop",
    finish: "Finish, then quit",
    stopSafely: "Stop safely and quit",
    retry: "Retry",
    quitAnyway: "Quit anyway",
  });
});

test("the line under the title does not call an unsaved note running", () => {
  const timer = { kind: "timer" as const };
  const note = { kind: "note" as const };
  assert.equal(quitHint([timer], false), "Still running. The app closes once every line below has an answer.");
  assert.equal(quitHint([note], false), "Not saved. The app closes once every line below has an answer.");
  assert.equal(quitHint([timer, note], false), "Still running, or not saved. The app closes once every line below has an answer.");
  assert.equal(quitHint([timer], true), "Waiting for the last job to finish. The app closes by itself.");
  assert.equal(quitHint([note], true), "Saving again. The app closes by itself once it is saved.");
});

test("a stored time reads month first, in local time, on a twelve-hour clock", () => {
  assert.equal(whenText(STARTED.toISOString()), "11-12-2026 5:05 PM");
  assert.equal(whenText(new Date(2026, 0, 3, 0, 7).toISOString()), "01-03-2026 12:07 AM");
  assert.equal(whenText(new Date(2026, 0, 3, 12, 0).toISOString()), "01-03-2026 12:00 PM");
  assert.equal(whenText(new Date(2026, 0, 3, 23, 59).toISOString()), "01-03-2026 11:59 PM");
});

test("the database's own timestamp shape has no zone marker and is still read as UTC", () => {
  assert.equal(parseStored("2026-11-12 17:05:42"), Date.UTC(2026, 10, 12, 17, 5, 42));
  assert.equal(parseStored("2026-11-12T17:05:42.167Z"), Date.UTC(2026, 10, 12, 17, 5, 42, 167));
  assert.equal(whenText("2026-11-12 17:05:42"), whenText("2026-11-12T17:05:42.000Z"));
});

test("a time that cannot be read is shown as it came, never as a blank or a wrong date", () => {
  assert.ok(Number.isNaN(parseStored("not a time")));
  assert.ok(Number.isNaN(parseStored("")));
  assert.equal(whenText("not a time"), "not a time");
  assert.equal(toInputValue(Number.NaN), "");
});

test("the date-and-time field is given local time to the minute", () => {
  assert.equal(toInputValue(STARTED.getTime()), "2026-11-12T17:05");
  assert.equal(toInputValue(new Date(2026, 0, 3, 0, 7, 59).getTime()), "2026-01-03T00:07");
});

test("a typed end time between the start and now is stored as that moment", () => {
  assert.deepEqual(readEndTime("2026-11-12T18:00", STARTED.toISOString(), NOW), {
    iso: new Date(2026, 10, 12, 18, 0).toISOString(),
  });
  // The minute that is running right now is not the future.
  assert.deepEqual(readEndTime("2026-11-13T09:12", STARTED.toISOString(), NOW), {
    iso: new Date(2026, 10, 13, 9, 12).toISOString(),
  });
});

test("the minute the timer started in means the start itself, not a time before it", () => {
  assert.deepEqual(readEndTime("2026-11-12T17:05", STARTED.toISOString(), NOW), { iso: STARTED.toISOString() });
});

test("an end time before the start, after now, or left empty is refused in a plain sentence", () => {
  assert.equal(errorOf(readEndTime("2026-11-12T17:04", STARTED.toISOString(), NOW)), "The end time cannot be before the timer started, 11-12-2026 5:05 PM.");
  assert.equal(errorOf(readEndTime("2026-11-13T09:13", STARTED.toISOString(), NOW)), "The end time cannot be later than now.");
  assert.equal(errorOf(readEndTime("", STARTED.toISOString(), NOW)), "Enter a date and a time.");
});

test("a start that cannot be read sets no lower limit, and nothing throws", () => {
  assert.deepEqual(readEndTime("2026-11-12T18:00", "not a time", NOW), {
    iso: new Date(2026, 10, 12, 18, 0).toISOString(),
  });
});
