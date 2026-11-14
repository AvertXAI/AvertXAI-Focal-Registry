/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
/* File: tests/hoursfloor.db.test.ts */
// The floor under hours corrections, against a throwaway database (TT-10). No correction, tied to
// an entry or not, may leave a person with less than no hours on a project, and that holds for
// making one, editing one, deleting one and bringing one back. "Hours on a project" is read from
// netTotals(), the figure every total shows. Runs under Electron-as-Node, because the SQLite
// module is built for Electron. Every name here is made up and the database lives in the temp
// folder for the length of the run.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import Database from "better-sqlite3-multiple-ciphers";
import {
  createHoursAdjustment,
  restoreAdjustment,
  softDeleteAdjustment,
  updateAdjustment,
} from "../electron/core/services/employees/adjustments";
import { ensureEmployeesSchema } from "../electron/core/services/employees/db";
import { createEntry } from "../electron/core/services/employees/entries";
import { netTotals } from "../electron/core/services/employees/netHours";
import type { Adjustment, Entry } from "../electron/core/services/employees/types";
import { ensureTimeTrackerSchema } from "../electron/core/services/timetracker/db";

const ORG = "org-fake";
const PROJECT = "Fake Project";
const REASON = "Fake reason";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fr-test-"));
const db = new Database(path.join(dir, "fake.db"));
// The employee services read the project table for the completion lock, so both schemas have to exist.
ensureTimeTrackerSchema(db);
ensureEmployeesSchema(db);
after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const insertId = (sql: string, ...values: (string | number)[]): number =>
  Number(db.prepare(sql).run(...values).lastInsertRowid);

const person = (name: string): number =>
  insertId(`INSERT INTO employee_people (uuid, org_id, name) VALUES (?, ?, ?)`, randomUUID(), ORG, name);

const clientId = insertId(
  `INSERT INTO timetracker_clients (uuid, org_id, name) VALUES (?, ?, ?)`,
  randomUUID(),
  ORG,
  "Fake Client"
);
const project = (name: string): number =>
  insertId(
    `INSERT INTO timetracker_projects (uuid, org_id, client_id, name) VALUES (?, ?, ?, ?)`,
    randomUUID(),
    ORG,
    clientId,
    name
  );
const projectId = project(PROJECT);
const otherProjectId = project("Fake Other Project");

const hourly = (employeeId: number, hours: number, workedOn: string, onProject = projectId): Entry =>
  createEntry(db, ORG, {
    employeeId,
    projectId: onProject,
    projectName: PROJECT,
    taskId: null,
    payType: "hourly",
    hoursWorked: hours,
    rateAtEntry: 20,
    flatAmount: null,
    workedOn,
    note: null,
  });

/** The Adjustments tab's call: the project and the rate are stated, and no entry is named. */
const loose = (employeeId: number, minutes: number): Adjustment =>
  createHoursAdjustment(db, ORG, {
    employeeId,
    projectId,
    projectName: PROJECT,
    deltaMinutes: minutes,
    rateAtEntry: 20,
    note: REASON,
  });

/** The Ledger dialog's call: hours only. The project and the rate are left for the service. */
const tied = (employeeId: number, entryId: number | null, minutes: number): Adjustment =>
  createHoursAdjustment(db, ORG, {
    employeeId,
    projectId: null,
    projectName: null,
    deltaMinutes: minutes,
    rateAtEntry: null,
    note: REASON,
    entryId,
  });

/** One person's net hours on one project: the figure the floor is held against. */
const hoursOn = (employeeId: number, onProject = projectId): number =>
  netTotals(db, { employeeId, projectId: onProject })[0].hours;

test("a correction that names no entry cannot take a person's hours on a project below zero", () => {
  const who = person("Fake Person A");
  hourly(who, 10, "2026-09-01");
  assert.throws(
    () => loose(who, -660),
    /with -1\.00 hours on this project\. They have 10\.00 hours on it now\./
  );
  assert.equal(hoursOn(who), 10);

  // Exactly to zero is a legal correction. One minute more is not.
  loose(who, -600);
  assert.equal(hoursOn(who), 0);
  assert.throws(() => loose(who, -1), /with -0\.02 hours on this project/);

  // Hours added are never refused.
  loose(who, 60);
  assert.equal(hoursOn(who), 1);
  // The Ledger's call with no entry picked lands on the same floor.
  assert.throws(() => tied(who, null, -120), /with -1\.00 hours on this project/);
  assert.equal(hoursOn(who), 1);

  // A third of a hundredth of an hour short is still short, and the sentence does not say "-0.00".
  const sliver = person("Fake Person B");
  hourly(sliver, 0.33, "2026-09-01");
  assert.throws(() => loose(sliver, -20), /with -0\.01 hours on this project\. They have 0\.33 hours on it now\./);
  assert.equal(hoursOn(sliver), 0.33);
});

test("an edit cannot dig a correction with no entry deeper than the person's hours on the project", () => {
  const who = person("Fake Person C");
  hourly(who, 10, "2026-09-02");
  const less = loose(who, -300);
  assert.throws(
    () => updateAdjustment(db, less.uuid, -660, REASON),
    /with -1\.00 hours on this project\. They have 5\.00 hours on it now\./
  );
  assert.equal(hoursOn(who), 5);
  assert.equal(updateAdjustment(db, less.uuid, -600, REASON).delta_minutes, -600);
  assert.equal(hoursOn(who), 0);
  // Rewording the reason moves no hours, so it is never refused, even at zero.
  assert.equal(updateAdjustment(db, less.uuid, -600, "Fake reason, reworded").note, "Fake reason, reworded");
});

test("deleting a \"more\" correction with no entry is refused when it would leave the project below zero", () => {
  const who = person("Fake Person D");
  hourly(who, 2, "2026-09-03");
  const more = loose(who, 180); // 5 hours
  const less = loose(who, -240); // 1 hour, allowed only because of the 3 added
  assert.throws(
    () => softDeleteAdjustment(db, ORG, more.uuid),
    /with -2\.00 hours on this project\. They have 1\.00 hours on it now\./
  );
  assert.equal(hoursOn(who), 1);
  // In the other order both go, and the project is back to what was logged.
  softDeleteAdjustment(db, ORG, less.uuid);
  softDeleteAdjustment(db, ORG, more.uuid);
  assert.equal(hoursOn(who), 2);
});

test("restoring a \"less\" correction with no entry is refused when it would leave the project below zero", () => {
  const who = person("Fake Person E");
  hourly(who, 4, "2026-09-04");
  const first = loose(who, -180); // 1 hour
  softDeleteAdjustment(db, ORG, first.uuid); // 4 hours
  const second = loose(who, -120); // 2 hours
  assert.throws(
    () => restoreAdjustment(db, ORG, first.uuid),
    /with -1\.00 hours on this project\. They have 2\.00 hours on it now\./
  );
  assert.equal(hoursOn(who), 2);
  // It can come back once the hours it takes are there again.
  softDeleteAdjustment(db, ORG, second.uuid);
  assert.equal(restoreAdjustment(db, ORG, first.uuid).deleted_at, null);
  assert.equal(hoursOn(who), 1);
});

test("the entry floor still refuses as before, and a correction against an entry answers to the project floor too", () => {
  const who = person("Fake Person F");
  const entry = hourly(who, 10, "2026-09-05");
  assert.throws(() => tied(who, entry.id, -660), /take the entry below zero hours\. It has 10\.00 hours left\./);
  const eight = tied(who, entry.id, -480);
  assert.throws(
    () => updateAdjustment(db, eight.uuid, -660, REASON),
    /take the entry below zero hours\. It has 2\.00 hours left\./
  );
  softDeleteAdjustment(db, ORG, eight.uuid);
  tied(who, entry.id, -300);
  assert.throws(() => restoreAdjustment(db, ORG, eight.uuid), /take the entry below zero hours\. It has 5\.00 hours left\./);
  const more = tied(who, entry.id, 60); // 6 hours
  tied(who, entry.id, -360); // none
  assert.throws(() => softDeleteAdjustment(db, ORG, more.uuid), /take the entry below zero hours\. It has 0\.00 hours left\./);
  assert.equal(hoursOn(who), 0);

  // The entry has the hours and the project does not: a correction with no entry already took them.
  const other = person("Fake Person G");
  const whole = hourly(other, 10, "2026-09-05");
  loose(other, -480);
  assert.equal(netTotals(db, { entryId: whole.id })[0].hours, 10);
  assert.throws(
    () => tied(other, whole.id, -180),
    /with -1\.00 hours on this project\. They have 2\.00 hours on it now\./
  );
  assert.equal(tied(other, whole.id, -120).entry_id, whole.id);
  assert.equal(hoursOn(other), 0);
});

test("the floor is one person's hours on one project, not the project's and not the person's", () => {
  const short = person("Fake Person H");
  const long = person("Fake Person I");
  hourly(short, 3, "2026-09-06");
  hourly(long, 10, "2026-09-06");
  hourly(short, 5, "2026-09-07", otherProjectId);
  // The project holds 13 hours and the person 8, but only 3 are this person's on this project.
  assert.throws(
    () => loose(short, -240),
    /with -1\.00 hours on this project\. They have 3\.00 hours on it now\./
  );
  assert.equal(loose(short, -180).delta_minutes, -180);
  assert.equal(hoursOn(short), 0);
  assert.equal(hoursOn(short, otherProjectId), 5);
  assert.equal(hoursOn(long), 10);
});

test("hours already below zero can be brought back up, and cannot be taken further down", () => {
  const who = person("Fake Person J");
  hourly(who, 1, "2026-09-08");
  // A correction stored before the floor existed: three hours off a project holding one.
  const old = randomUUID();
  const at = new Date().toISOString();
  db.prepare(
    `INSERT INTO employee_adjustments
       (uuid, org_id, employee_id, kind, project_id, project_name, delta_minutes, rate_at_entry,
        delta_amount, note, entry_id, deleted_at, audit_log, created_at, updated_at)
     VALUES (?, ?, ?, 'hours', ?, ?, -180, 20, NULL, ?, NULL, NULL, '[]', ?, ?)`
  ).run(old, ORG, who, projectId, PROJECT, REASON, at, at);
  assert.equal(hoursOn(who), -2);

  assert.throws(
    () => loose(who, -30),
    /with -2\.50 hours on this project\. They have -2\.00 hours on it now\./
  );
  // Adding hours is allowed though it does not reach zero, and so is deleting what caused it.
  loose(who, 60);
  assert.equal(hoursOn(who), -1);
  softDeleteAdjustment(db, ORG, old);
  assert.equal(hoursOn(who), 2);
});
