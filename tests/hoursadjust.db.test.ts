/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
/* File: tests/hoursadjust.db.test.ts */
// Hours corrections against a throwaway database. One entry of 1,114.95 hours at $25.00 is
// corrected by -1,100 hours, and every total that shows employee hours or pay has to come out at
// 14.95 hours and $373.75: the person's cards, the people list, the project card, the grand
// total, the group rollup, Spent, and the Analytics series. Runs under Electron-as-Node, because
// the SQLite module is built for Electron. Every name here is made up and the database lives in
// the temp folder for the length of the run.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import Database from "better-sqlite3-multiple-ciphers";
import {
  createAmountAdjustment,
  createHoursAdjustment,
  restoreAdjustment,
  softDeleteAdjustment,
  updateAdjustment,
} from "../electron/core/services/employees/adjustments";
import { ensureEmployeesSchema } from "../electron/core/services/employees/db";
import { createEntry, listEntriesForPerson } from "../electron/core/services/employees/entries";
import { balanceFor, employeeCostForProject, hoursByPerson } from "../electron/core/services/employees/reports";
import type { Adjustment, Entry } from "../electron/core/services/employees/types";
import { ensureTimeTrackerSchema } from "../electron/core/services/timetracker/db";
import { projectSpend } from "../electron/core/services/timetracker/projectFinancials";
import { getProject, grandTotals, groupTotals, listProjects } from "../electron/core/services/timetracker/projects";
import { getReport } from "../electron/core/services/timetracker/reports";

const ORG = "org-fake";
const PROJECT = "Fake Project";
const REASON = "Fake reason";
/** 14.95 hours, the way a project total carries it. */
const SECONDS = 53_820;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fr-test-"));
const db = new Database(path.join(dir, "fake.db"));
// Project totals join the employee tables and the employee services read the project table for
// the completion lock, so both schemas have to exist.
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
// Hourly with no rate of its own, so the project has no revenue and no time of its own: every
// second and every dollar on it comes from the employee lines under test.
const projectId = insertId(
  `INSERT INTO timetracker_projects (uuid, org_id, client_id, name) VALUES (?, ?, ?, ?)`,
  randomUUID(),
  ORG,
  clientId,
  PROJECT
);

const hourly = (employeeId: number, hours: number, rate: number, workedOn: string, onProject: number | null = projectId): Entry =>
  createEntry(db, ORG, {
    employeeId,
    projectId: onProject,
    projectName: PROJECT,
    taskId: null,
    payType: "hourly",
    hoursWorked: hours,
    rateAtEntry: rate,
    flatAmount: null,
    workedOn,
    note: null,
  });

/** The Ledger dialog's call: hours only. The project and the rate are left for the service. */
const adjustHours = (employeeId: number, entryId: number | null, minutes: number): Adjustment =>
  createHoursAdjustment(db, ORG, {
    employeeId,
    projectId: null,
    projectName: null,
    deltaMinutes: minutes,
    rateAtEntry: null,
    note: REASON,
    entryId,
  });

const first = person("Fake Person A");
const big = hourly(first, 1114.95, 25, "2026-09-27");

test("1,114.95 hours at $25.00, corrected by -1,100 hours, is 14.95 hours and $373.75 everywhere", () => {
  const adj = adjustHours(first, big.id, -66_000);

  // The correction is its own row, valued at the entry's agreed rate. The entry is as it was logged.
  assert.equal(adj.kind, "hours");
  assert.equal(adj.entry_id, big.id);
  assert.equal(adj.project_id, projectId);
  assert.equal(adj.rate_at_entry, 25);
  assert.equal(adj.delta_minutes, -66_000);
  assert.deepEqual(listEntriesForPerson(db, first), [big]);

  // The person: the three period cards and Outstanding. The day after the work, every window holds it.
  const near = balanceFor(db, first, new Date(2026, 8, 28));
  assert.equal(near.hours, 14.95);
  assert.equal(near.earned, 373.75);
  assert.equal(near.outstanding, 373.75);
  assert.deepEqual(near.week, { hours: 14.95, entries: 1 });
  assert.deepEqual(near.month, { hours: 14.95, entries: 1 });
  assert.deepEqual(near.year, { hours: 14.95, entries: 1 });
  // Weeks later only the year still holds it: the correction counts on the day the work happened,
  // not on the day the correction was made.
  const later = balanceFor(db, first, new Date(2026, 10, 13));
  assert.deepEqual(later.week, { hours: 0, entries: 0 });
  assert.deepEqual(later.month, { hours: 0, entries: 0 });
  assert.deepEqual(later.year, { hours: 14.95, entries: 1 });

  // The people list.
  assert.deepEqual(hoursByPerson(db, ORG), [{ employee_id: first, hours: 14.95 }]);

  // The project card, the grand-total line and the group rollup.
  const card = listProjects(db, ORG)[0];
  assert.equal(card.total_seconds, SECONDS);
  assert.equal(card.total_costs, 373.75);
  assert.deepEqual(getProject(db, projectId), card);
  const grand = grandTotals(db, ORG);
  assert.equal(grand.total_seconds, SECONDS);
  assert.equal(grand.total_costs, 373.75);
  assert.deepEqual(groupTotals(db, ORG), [{ group_id: null, total_seconds: SECONDS }]);

  // Spent.
  const spend = projectSpend(db, ORG, projectId);
  assert.equal(spend.employee_hours, 14.95);
  assert.equal(spend.employee_cost, 373.75);
  assert.equal(spend.spent, 373.75);
  assert.deepEqual(employeeCostForProject(db, ORG, projectId), {
    project_id: projectId,
    project_name: PROJECT,
    employee_hours: 14.95,
    employee_cost: 373.75,
  });

  // Analytics: the cards and all three series that carry employee time or pay.
  const report = getReport(db, ORG, "all", "month", null);
  assert.equal(report.totals.total_seconds, SECONDS);
  assert.equal(report.totals.spent, 373.75);
  assert.deepEqual(report.timeSeries, [{ bucket: "2026-09", hours: 14.95, value: 0, costs: 373.75 }]);
  assert.deepEqual(report.hoursByProject, [{ name: PROJECT, hours: 14.95 }]);
  assert.deepEqual(report.costsByCategory, [{ category: "Employee pay", amount: 373.75 }]);
  // The same with the project picked in the rail, by day.
  const picked = getReport(db, ORG, "all", "day", projectId);
  assert.equal(picked.totals.total_seconds, SECONDS);
  assert.deepEqual(picked.timeSeries, [{ bucket: "2026-09-27", hours: 14.95, value: 0, costs: 373.75 }]);
});

test("an amount correction still moves money only", () => {
  const adj = createAmountAdjustment(db, ORG, {
    employeeId: first,
    projectId,
    projectName: PROJECT,
    deltaAmount: -50,
    note: REASON,
    entryId: big.id,
  });
  assert.equal(adj.kind, "amount");
  assert.equal(adj.delta_minutes, null);
  assert.equal(adj.rate_at_entry, null);
  assert.equal(balanceFor(db, first).hours, 14.95);
  assert.equal(balanceFor(db, first).earned, 323.75);
  assert.equal(listProjects(db, ORG)[0].total_seconds, SECONDS);
  assert.equal(listProjects(db, ORG)[0].total_costs, 323.75);

  // Tied to no entry and no project: the person's pay moves, and no project's cost does.
  createAmountAdjustment(db, ORG, {
    employeeId: first,
    projectId: null,
    projectName: null,
    deltaAmount: 10,
    note: REASON,
  });
  assert.equal(balanceFor(db, first).hours, 14.95);
  assert.equal(balanceFor(db, first).earned, 333.75);
  assert.equal(listProjects(db, ORG)[0].total_costs, 323.75);
});

test("an hours correction that would take an entry below zero is refused", () => {
  const who = person("Fake Person B");
  const entry = hourly(who, 10, 20, "2026-09-01");
  const eight = adjustHours(who, entry.id, -480);
  assert.throws(() => adjustHours(who, entry.id, -150), /below zero hours/); // half an hour too many
  assert.throws(() => updateAdjustment(db, eight.uuid, -660, REASON), /below zero hours/); // an edit digs as deep
  assert.equal(balanceFor(db, who).hours, 2);

  // Exactly to zero is a legal correction, and deleting corrections gives the hours back.
  const rest = adjustHours(who, entry.id, -120);
  assert.equal(balanceFor(db, who).hours, 0);
  assert.equal(balanceFor(db, who).earned, 0);
  softDeleteAdjustment(db, ORG, rest.uuid);
  softDeleteAdjustment(db, ORG, eight.uuid);
  assert.equal(balanceFor(db, who).hours, 10);
  assert.equal(balanceFor(db, who).earned, 200);

  // A deleted "less" correction can only come back while the entry still has the hours for it.
  adjustHours(who, entry.id, -300);
  assert.throws(() => restoreAdjustment(db, ORG, eight.uuid), /below zero hours/);
  assert.equal(restoreAdjustment(db, ORG, rest.uuid).deleted_at, null);
  assert.equal(balanceFor(db, who).hours, 3);
  assert.deepEqual(listEntriesForPerson(db, who), [entry]);
});

test("hours with no entry named are valued only when one rate is in play", () => {
  const two = person("Fake Person C");
  hourly(two, 4, 20, "2026-09-02");
  const dearer = hourly(two, 4, 30, "2026-09-03");
  assert.throws(() => adjustHours(two, null, -60), /Pick the entry/);
  // Named, the entry settles it: its own rate, never the other one.
  assert.equal(adjustHours(two, dearer.id, -60).rate_at_entry, 30);
  // The Adjustments tab states the project and the rate itself, as it always has.
  const typed = createHoursAdjustment(db, ORG, {
    employeeId: two,
    projectId,
    projectName: PROJECT,
    deltaMinutes: 30,
    rateAtEntry: 45,
    note: REASON,
  });
  assert.equal(typed.rate_at_entry, 45);
  assert.equal(typed.entry_id, null);

  const one = person("Fake Person D");
  hourly(one, 4, 40, "2026-09-04");
  const implied = adjustHours(one, null, -60);
  assert.equal(implied.rate_at_entry, 40);
  assert.equal(implied.project_id, projectId);
  assert.equal(balanceFor(db, one).hours, 3);
  assert.equal(balanceFor(db, one).earned, 120);
});

test("an hours correction never moves flat pay and never lands on the wrong entry", () => {
  const who = person("Fake Person E");
  const job = createEntry(db, ORG, {
    employeeId: who,
    projectId,
    projectName: PROJECT,
    taskId: null,
    payType: "job",
    hoursWorked: 10,
    rateAtEntry: 0,
    flatAmount: 500,
    workedOn: "2026-09-05",
    note: null,
  });
  // The job was agreed at a price, so fewer hours on it change the hours and not the pay.
  assert.equal(adjustHours(who, job.id, -120).rate_at_entry, 0);
  assert.equal(balanceFor(db, who).hours, 8);
  assert.equal(balanceFor(db, who).earned, 500);

  const other = person("Fake Person F");
  assert.throws(() => adjustHours(other, job.id, -60), /does not belong to this person/);
  // Work logged against no project has nowhere for corrected hours to land.
  const loose = hourly(who, 2, 25, "2026-09-06", null);
  assert.throws(() => adjustHours(who, loose.id, -60), /not tied to a project/);
});
