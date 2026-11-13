/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
/* File: tests/projecttimer.db.test.ts */
// A project timer an earlier launch left running, against a throwaway database: which sessions the
// next launch asks about, that the last time the app was open survives until the answer, and that
// closing one at a chosen time files exactly the time up to then.
// Runs under Electron-as-Node, because the SQLite module is built for Electron. Every name here
// is made up and the database lives in the temp folder for the length of the run.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import Database from "better-sqlite3-multiple-ciphers";
import { ensureTimeTrackerSchema } from "../electron/core/services/timetracker/db";
import * as timer from "../electron/core/services/timetracker/timer";

const ORG = "org-fake";
const MIN = 60_000;
const iso = (ms: number): string => new Date(ms).toISOString();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fr-test-"));
const db = new Database(path.join(dir, "fake.db"));
ensureTimeTrackerSchema(db);
after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const clientId = Number(
  db.prepare(`INSERT INTO timetracker_clients (uuid, org_id, name) VALUES (?, ?, ?)`).run(randomUUID(), ORG, "Fake client")
    .lastInsertRowid
);

// Each test starts from an empty session table, so "nothing is waiting" can be asserted outright.
const reset = (): void => void db.exec(`DELETE FROM timetracker_active_sessions`);

/**
 * A session as an earlier launch left it: started `startedAgo` minutes ago, last heartbeat
 * `seenAgo` minutes ago. Written by SQL because the service only ever starts a session "now".
 */
function leftBehind(
  name: string,
  state: "running" | "paused",
  startedAgo: number,
  seenAgo: number
): { id: number; start: number; seen: number } {
  const now = Date.now();
  const start = now - startedAgo * MIN;
  const seen = now - seenAgo * MIN;
  const projectId = Number(
    db
      .prepare(`INSERT INTO timetracker_projects (uuid, org_id, client_id, name) VALUES (?, ?, ?, ?)`)
      .run(randomUUID(), ORG, clientId, name).lastInsertRowid
  );
  const id = Number(
    db
      .prepare(
        `INSERT INTO timetracker_active_sessions
           (uuid, org_id, project_id, started_at, wall_started_at, accumulated_seconds, state, last_heartbeat)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(randomUUID(), ORG, projectId, iso(start), iso(start), state === "paused" ? 600 : 0, state, iso(seen))
      .lastInsertRowid
  );
  return { id, start, seen };
}

const heartbeat = (id: number): string =>
  (db.prepare(`SELECT last_heartbeat FROM timetracker_active_sessions WHERE id = ?`).get(id) as { last_heartbeat: string })
    .last_heartbeat;

test("only a timer that was still counting is asked about, and its last-seen time survives the heartbeat", () => {
  reset();
  const left = leftBehind("Fake project A", "running", 180, 120);
  const held = leftBehind("Fake project B", "paused", 180, 120);
  assert.deepEqual(
    timer.captureInterrupted(db).map((s) => s.id),
    [left.id]
  );

  const fresh = leftBehind("Fake project C", "running", 10, 5); // not captured: this launch's own
  // Only this launch's own timer is work being done now. The break reminder reads this list, so
  // its auto-pause can never answer the question about the one that is waiting.
  assert.deepEqual(
    timer.countingNow(db).map((s) => s.id),
    [fresh.id]
  );
  timer.heartbeatAll(db);
  assert.equal(heartbeat(left.id), iso(left.seen));
  assert.notEqual(heartbeat(fresh.id), iso(fresh.seen));
  // The paused one comes back paused, with the time it had.
  const back = timer.status(db).sessions.find((s) => s.id === held.id);
  assert.equal(back?.state, "paused");
  assert.equal(back?.accumulatedSeconds, 600);
});

test("closing it at the last time the app was open files the time up to then", () => {
  reset();
  const left = leftBehind("Fake project D", "running", 180, 120);
  timer.captureInterrupted(db);
  const entry = timer.stop(db, ORG, left.id, null, iso(left.seen));
  assert.equal(entry.duration_seconds, 60 * 60);
  assert.equal(entry.started_at, iso(left.start));
  assert.equal(entry.ended_at, iso(left.seen));
  assert.deepEqual(timer.listInterrupted(db), []);

  // SQLite hands the freed row id straight to the next session: it must not inherit the question.
  const next = leftBehind("Fake project E", "running", 10, 5);
  assert.equal(next.id, left.id);
  assert.deepEqual(timer.listInterrupted(db), []);
});

test("pausing a timer that is waiting for an answer ends the question", () => {
  reset();
  const left = leftBehind("Fake project F", "running", 180, 120);
  timer.captureInterrupted(db);
  timer.pause(db, ORG, left.id);
  assert.deepEqual(timer.listInterrupted(db), []);
});

test("an end time outside the stretch that was counting is refused and the timer stays", () => {
  reset();
  // A start no other test uses, so "nothing was filed" below can only be about this session.
  const left = leftBehind("Fake project G", "running", 200, 120);
  timer.captureInterrupted(db);
  for (const end of [iso(left.start - MIN), iso(left.start), iso(Date.now() + 5 * MIN), "not a time"]) {
    assert.throws(() => timer.stop(db, ORG, left.id, null, end), /after the timer last started/);
  }
  // Resumed half an hour in: an end before that resume would file time the clock was paused for.
  db.prepare(`UPDATE timetracker_active_sessions SET last_resumed_at = ? WHERE id = ?`).run(iso(left.start + 30 * MIN), left.id);
  assert.throws(() => timer.stop(db, ORG, left.id, null, iso(left.start + 20 * MIN)), /after the timer last started/);

  assert.equal(timer.listInterrupted(db).length, 1);
  const filed = db.prepare(`SELECT COUNT(*) AS n FROM timetracker_time_entries WHERE started_at = ?`).get(iso(left.start)) as {
    n: number;
  };
  assert.equal(filed.n, 0);
});
