/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
/* File: tests/employeetimer.db.test.ts */
// The Employees timer against a throwaway database: pauses come out of the hours, a chosen end
// time is honoured and checked, and "last seen" is written only for sessions that are counting.
// Runs under Electron-as-Node, because the SQLite module is built for Electron. Every name here
// is made up and the database lives in the temp folder for the length of the run.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import Database from "better-sqlite3-multiple-ciphers";
import { ensureEmployeesSchema } from "../electron/core/services/employees/db";
import * as sessions from "../electron/core/services/employees/sessions";
import type { Session } from "../electron/core/services/employees/types";
import { ensureTimeTrackerSchema } from "../electron/core/services/timetracker/db";
import { workedMs } from "../src/shared/employeeTimer";

const ORG = "org-fake";
const MIN = 60_000;
const iso = (ms: number): string => new Date(ms).toISOString();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fr-test-"));
const db = new Database(path.join(dir, "fake.db"));
// Stopping a timer files an entry, and that path reads TimeTracker's project table for the
// completion lock, so both schemas have to exist.
ensureTimeTrackerSchema(db);
ensureEmployeesSchema(db);
after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A made-up person whose timer began `minutesAgo` minutes ago. */
function running(name: string, minutesAgo: number): { id: number; start: number } {
  const employeeId = Number(
    db.prepare(`INSERT INTO employee_people (uuid, org_id, name) VALUES (?, ?, ?)`).run(randomUUID(), ORG, name)
      .lastInsertRowid
  );
  const session = sessions.startSession(db, ORG, {
    employeeId,
    projectId: 1,
    projectName: "Fake project",
    taskId: null,
    payType: "hourly",
    rateAtStart: 25,
    note: null,
  });
  // The service always starts a session "now"; these tests need one with a past behind it.
  const start = Date.now() - minutesAgo * MIN;
  db.prepare(`UPDATE employee_sessions SET started_at = ? WHERE id = ?`).run(iso(start), session.id);
  return { id: session.id, start };
}

const row = (id: number): Session =>
  db.prepare(`SELECT * FROM employee_sessions WHERE id = ?`).get(id) as Session;

const localDate = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

test("paused time is taken out of the hours, and a second pause or resume changes nothing", () => {
  const { id, start } = running("Fake Person A", 240);
  sessions.pauseSession(db, id, iso(start + 60 * MIN));
  sessions.pauseSession(db, id, iso(start + 72 * MIN));
  assert.equal(row(id).paused_at, iso(start + 60 * MIN));

  sessions.resumeSession(db, id, iso(start + 150 * MIN));
  sessions.resumeSession(db, id, iso(start + 180 * MIN));
  assert.equal(row(id).paused_at, null);
  assert.equal(row(id).paused_seconds, 90 * 60);
  assert.equal(row(id).last_seen_at, iso(start + 150 * MIN));

  const { session, entry } = sessions.stopSession(db, ORG, id, null, iso(start + 210 * MIN));
  assert.equal(entry.hours_worked, 2); // three and a half hours on the clock, one and a half paused
  assert.equal(session.ended_at, iso(start + 210 * MIN));
});

test("a timer stopped while paused counts only up to the pause", () => {
  const { id, start } = running("Fake Person B", 240);
  sessions.pauseSession(db, id, iso(start + 75 * MIN));
  // The card's clock is this same function: it must hold still however late it is asked.
  assert.equal(workedMs(row(id), start + 200 * MIN), 75 * MIN);
  const { entry } = sessions.stopSession(db, ORG, id); // stopped now, hours after the pause
  assert.equal(entry.hours_worked, 1.25);
});

test("a chosen end time books start to end, less the pauses, on the day the work started", () => {
  const { id, start } = running("Fake Person C", 30 * 60); // started yesterday
  sessions.pauseSession(db, id, iso(start + 60 * MIN));
  sessions.resumeSession(db, id, iso(start + 180 * MIN));
  const end = start + 26 * 60 * MIN; // the next day, still in the past
  const { session, entry } = sessions.stopSession(db, ORG, id, "Fake note", iso(end));
  assert.equal(entry.hours_worked, 24);
  assert.equal(entry.worked_on, localDate(start));
  assert.equal(entry.note, "Fake note");
  assert.equal(session.ended_at, iso(end));
});

test("last seen is stamped only on sessions that are counting", () => {
  const counting = running("Fake Person D", 120);
  const paused = running("Fake Person E", 120);
  const stopped = running("Fake Person F", 120);
  sessions.pauseSession(db, paused.id, iso(paused.start + 30 * MIN));
  sessions.stopSession(db, ORG, stopped.id, null, iso(stopped.start + 30 * MIN));

  const at = iso(Date.now());
  sessions.touchSessions(db, "org-other", at);
  assert.equal(row(counting.id).last_seen_at, null);

  sessions.touchSessions(db, ORG, at);
  assert.equal(row(counting.id).last_seen_at, at);
  assert.equal(row(paused.id).last_seen_at, null);
  assert.equal(row(stopped.id).last_seen_at, null);

  assert.throws(() => sessions.pauseSession(db, stopped.id), /already been stopped/);
  assert.throws(() => sessions.resumeSession(db, stopped.id), /already been stopped/);
});

test("a session an earlier launch left running keeps its old stamp until he keeps it", () => {
  const launch = Date.now() - 60 * MIN;
  const left = running("Fake Person G", 180); // never stamped, and started before the launch
  const fresh = running("Fake Person H", 180);
  sessions.markSeen(db, fresh.id, iso(launch + MIN)); // seen by this launch

  const at = iso(launch + 5 * MIN);
  sessions.touchSessions(db, ORG, at, iso(launch));
  assert.equal(row(left.id).last_seen_at, null);
  assert.equal(row(fresh.id).last_seen_at, at);

  sessions.markSeen(db, left.id, iso(launch + 6 * MIN)); // his answer: keep all of it
  const later = iso(launch + 7 * MIN);
  sessions.touchSessions(db, ORG, later, iso(launch));
  assert.equal(row(left.id).last_seen_at, later);
});

test("an end time outside the session is refused and the timer stays open", () => {
  const { id, start } = running("Fake Person I", 120);
  assert.throws(() => sessions.stopSession(db, ORG, id, null, iso(start - MIN)), /after the timer started/);
  assert.throws(() => sessions.stopSession(db, ORG, id, null, iso(start)), /after the timer started/);
  assert.throws(() => sessions.stopSession(db, ORG, id, null, iso(Date.now() + 5 * MIN)), /in the future/);
  assert.throws(() => sessions.stopSession(db, ORG, id, null, "not a time"), /could not be read/);

  assert.equal(row(id).ended_at, null);
  const filed = db
    .prepare(`SELECT COUNT(*) AS n FROM employee_entries WHERE employee_id = ?`)
    .get(row(id).employee_id) as { n: number };
  assert.equal(filed.n, 0);
});
