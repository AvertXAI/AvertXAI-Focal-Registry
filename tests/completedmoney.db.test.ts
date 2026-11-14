/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
/* File: tests/completedmoney.db.test.ts */
// The Completed tab's money cards against a throwaway database (TT-08). The tab prints one
// project's Analytics totals, so a completed job reads the same on both pages: Profit is money
// received less money spent, never the contract less money spent. Runs under Electron-as-Node,
// because the SQLite module is built for Electron. Every name is made up.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import Database from "better-sqlite3-multiple-ciphers";
import { ensureEmployeesSchema } from "../electron/core/services/employees/db";
import { createEntry } from "../electron/core/services/employees/entries";
import { ensureTimeTrackerSchema } from "../electron/core/services/timetracker/db";
import * as payments from "../electron/core/services/timetracker/payments";
import * as reports from "../electron/core/services/timetracker/reports";

const ORG = "org-fake";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fr-test-"));
const db = new Database(path.join(dir, "fake.db"));
ensureTimeTrackerSchema(db);
ensureEmployeesSchema(db);
after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const insertId = (sql: string, ...values: (string | number)[]): number =>
  Number(db.prepare(sql).run(...values).lastInsertRowid);
const clientId = insertId(`INSERT INTO timetracker_clients (uuid, org_id, name) VALUES (?, ?, ?)`, randomUUID(), ORG, "Fake Client");
const contractJob = (name: string, amount: number): number =>
  insertId(
    `INSERT INTO timetracker_projects (uuid, org_id, client_id, name, rate_type, contract_kind, contract_amount, contract_date)
     VALUES (?, ?, ?, ?, 'contract', 'paid', ?, '2026-10-01')`,
    randomUUID(),
    ORG,
    clientId,
    name,
    amount
  );
const who = insertId(`INSERT INTO employee_people (uuid, org_id, name) VALUES (?, ?, ?)`, randomUUID(), ORG, "Fake Person A");
const work = (projectId: number, projectName: string, hours: number): void => {
  createEntry(db, ORG, {
    employeeId: who,
    projectId,
    projectName,
    taskId: null,
    payType: "hourly",
    hoursWorked: hours,
    rateAtEntry: 25,
    flatAmount: null,
    workedOn: "2026-10-20",
    note: null,
  });
};

// The completed job: a $1,000.00 contract, $100.00 spent on four hours of work, $400.00 received.
const jobId = contractJob("Fake Completed Job", 1000);
work(jobId, "Fake Completed Job", 4);
db.prepare(`UPDATE timetracker_projects SET completed_at = ? WHERE id = ?`).run("2026-11-01T00:00:00.000Z", jobId);
payments.add(db, ORG, { projectId: jobId, amount: 400, receivedOn: "2026-11-02", method: "check" });
// A second job, so one project's figures and the whole organization's are different numbers.
const otherId = contractJob("Fake Other Job", 500);
work(otherId, "Fake Other Job", 2);
payments.add(db, ORG, { projectId: otherId, amount: 60, receivedOn: "2026-11-03", method: "cash" });

const completedTab = (id: number) => reports.projectTotals(db, ORG, id);
const analytics = (id: number | null) => reports.getReport(db, ORG, "all", "day", id).totals;

test("the Completed tab's cards are the Analytics figures for that one project", () => {
  const t = completedTab(jobId);
  assert.deepEqual(t, analytics(jobId));
  assert.equal(t.billed, 1000);
  assert.equal(t.received, 400);
  assert.equal(t.spent, 100);
  // Received less spent. The old Net card took the contract less spent, which is $900.00 here.
  assert.equal(t.profit, 300);
  assert.equal(t.margin, 75);
});

test("a payment that arrives after the job is completed moves Received and Profit, and Billed and Spent stay", () => {
  payments.add(db, ORG, { projectId: jobId, amount: 600, receivedOn: "2026-11-05", method: "check" });
  const t = completedTab(jobId);
  assert.equal(t.billed, 1000);
  assert.equal(t.received, 1000);
  assert.equal(t.spent, 100);
  assert.equal(t.profit, 900);
  assert.deepEqual(t, analytics(jobId));
});

test("the figures are one project's, not the whole organization's", () => {
  assert.equal(analytics(null).received, 1060);
  assert.equal(completedTab(jobId).received, 1000);
  const other = completedTab(otherId);
  assert.equal(other.received, 60);
  assert.equal(other.spent, 50);
  assert.equal(other.profit, 10);
});

test("a project the totals do not hold is an error, never a row of zeros", () => {
  assert.throws(() => completedTab(999_999), /Project 999999 not found/);
  // An archived project is out of Analytics, so it is out of this read too.
  db.prepare(`UPDATE timetracker_projects SET archived_at = ? WHERE id = ?`).run("2026-11-06T00:00:00.000Z", otherId);
  assert.throws(() => completedTab(otherId), /not found/);
});
