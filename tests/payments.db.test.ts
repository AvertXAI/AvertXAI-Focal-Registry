/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
/* File: tests/payments.db.test.ts */
// Client payments against a throwaway database (TT-06). A payment keeps its note and reference and
// shows as Received on the project card, the grand total and Analytics; profit and margin count
// money received; and a payment can also be counted as pay to one person, linked both ways. Runs
// under Electron-as-Node, because the SQLite module is built for Electron. Every name is made up.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import Database from "better-sqlite3-multiple-ciphers";
import { ensureEmployeesSchema } from "../electron/core/services/employees/db";
import { createEntry } from "../electron/core/services/employees/entries";
import { listPayments } from "../electron/core/services/employees/payments";
import { balanceFor } from "../electron/core/services/employees/reports";
import { ensureTimeTrackerSchema } from "../electron/core/services/timetracker/db";
import * as payments from "../electron/core/services/timetracker/payments";
import { grandTotals, listProjects } from "../electron/core/services/timetracker/projects";
import { getReport } from "../electron/core/services/timetracker/reports";

const ORG = "org-fake";
const PROJECT = "Fake Contract Job";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fr-test-"));
const db = new Database(path.join(dir, "fake.db"));
ensureTimeTrackerSchema(db);
ensureEmployeesSchema(db);
// A second run is what every later launch does: the link column must not be added twice.
ensureEmployeesSchema(db);
after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const insertId = (sql: string, ...values: (string | number)[]): number =>
  Number(db.prepare(sql).run(...values).lastInsertRowid);
const person = (name: string): number =>
  insertId(`INSERT INTO employee_people (uuid, org_id, name) VALUES (?, ?, ?)`, randomUUID(), ORG, name);
const clientId = insertId(`INSERT INTO timetracker_clients (uuid, org_id, name) VALUES (?, ?, ?)`, randomUUID(), ORG, "Fake Client");
// A paid contract of $1,000.00 signed 10-01-2026: billed is known, and nothing has been received.
const projectId = insertId(
  `INSERT INTO timetracker_projects (uuid, org_id, client_id, name, rate_type, contract_kind, contract_amount, contract_date)
   VALUES (?, ?, ?, ?, 'contract', 'paid', 1000, '2026-10-01')`,
  randomUUID(),
  ORG,
  clientId,
  PROJECT
);
const who = person("Fake Person A");
// Four hours at $25.00: the project has spent $100.00 and owes this person $100.00.
createEntry(db, ORG, {
  employeeId: who,
  projectId,
  projectName: PROJECT,
  taskId: null,
  payType: "hourly",
  hoursWorked: 4,
  rateAtEntry: 25,
  flatAmount: null,
  workedOn: "2026-10-20",
  note: null,
});

const card = () => listProjects(db, ORG).find((p) => p.id === projectId)!;
const totals = () => getReport(db, ORG, "all", "day", null).totals;

test("before any payment: billed is the contract, received is zero, profit is below zero and there is no margin", () => {
  assert.equal(card().total_value, 1000);
  assert.equal(card().total_received, 0);
  const t = totals();
  assert.equal(t.billed, 1000);
  assert.equal(t.received, 0);
  assert.equal(t.spent, 100);
  assert.equal(t.profit, -100);
  assert.equal(t.margin, null);
});

test("a payment keeps its note and reference, and shows as Received on the card, the grand total and Analytics", () => {
  const row = payments.add(db, ORG, {
    projectId,
    amount: 150,
    receivedOn: "2026-10-28",
    method: "cash",
    reference: "FAKE-REF-1",
    note: "Fake note",
  });
  assert.equal(row.note, "Fake note");
  assert.equal(row.reference, "FAKE-REF-1");
  assert.equal(row.paid_to_uuid, null);
  assert.equal(row.paid_to_name, null);
  assert.deepEqual(payments.list(db, projectId), [row]);

  // The card and the grand-total line. Billed does not move when money comes in.
  assert.equal(card().total_received, 150);
  assert.equal(card().total_value, 1000);
  assert.equal(grandTotals(db, ORG).total_received, 150);

  // Analytics: profit and margin count the money received, not the contract.
  const report = getReport(db, ORG, "all", "day", null);
  assert.equal(report.totals.billed, 1000);
  assert.equal(report.totals.received, 150);
  assert.equal(report.totals.spent, 100);
  assert.equal(report.totals.profit, 50);
  assert.equal(report.totals.margin, ((150 - 100) / 150) * 100);
  // Billed on the contract date, spend on the day worked, the payment on the day it was received.
  assert.deepEqual(report.timeSeries, [
    { bucket: "2026-10-01", hours: 0, value: 1000, received: 0, costs: 0 },
    { bucket: "2026-10-20", hours: 4, value: 0, received: 0, costs: 100 },
    { bucket: "2026-10-28", hours: 0, value: 0, received: 150, costs: 0 },
  ]);
  assert.deepEqual(report.profitByProject, [{ name: PROJECT, profit: 50 }]);
  assert.deepEqual(report.marginByProject, [{ name: PROJECT, margin: ((150 - 100) / 150) * 100 }]);

  // Money from a client is not pay to a person by itself.
  assert.equal(balanceFor(db, who).paid, 0);
  assert.equal(balanceFor(db, who).outstanding, 100);
  assert.deepEqual(listPayments(db, who), []);
});

test("also count as paid: one payroll payment of the same amount, and each side points at the other", () => {
  const pay = payments.list(db, projectId)[0];
  const linked = payments.countAsPaidTo(db, ORG, pay.id, who);
  const payroll = listPayments(db, who);
  assert.equal(payroll.length, 1);
  assert.equal(payroll[0].amount, 150);
  assert.equal(payroll[0].paid_on, "2026-10-28");
  assert.equal(payroll[0].method, "cash");
  assert.equal(payroll[0].reference, "FAKE-REF-1");
  // The payroll row points at the client payment, and the client payment reads back the payroll row.
  assert.equal(payroll[0].project_payment_uuid, pay.uuid);
  assert.equal(linked.paid_to_uuid, payroll[0].uuid);
  assert.equal(linked.paid_to_name, "Fake Person A");
  assert.deepEqual(payments.list(db, projectId), [linked]);

  // The person's paid total moves; what the client paid and what the project spent do not.
  assert.equal(balanceFor(db, who).paid, 150);
  assert.equal(balanceFor(db, who).outstanding, -50);
  assert.equal(card().total_received, 150);
  assert.equal(totals().spent, 100);

  // The same money is never counted twice.
  assert.throws(() => payments.countAsPaidTo(db, ORG, pay.id, who), /already counted as paid to Fake Person A/);
  assert.equal(listPayments(db, who).length, 1);
});

test("stop counting adds a reversing line, leaves the client payment received, and can be done again later", () => {
  const pay = payments.list(db, projectId)[0];
  const payrollUuid = pay.paid_to_uuid;
  assert.equal(payments.stopCounting(db, ORG, pay.id).paid_to_uuid, payrollUuid);

  // The pay record keeps the payment and gains its mirror image. Nothing was edited or deleted.
  const rows = listPayments(db, who);
  assert.equal(rows.length, 2);
  const reversal = rows.find((r) => r.reverses_uuid !== null)!;
  assert.equal(reversal.amount, -150);
  assert.equal(reversal.reverses_uuid, payrollUuid);
  assert.equal(reversal.project_payment_uuid, null);
  assert.equal(balanceFor(db, who).paid, 0);
  assert.equal(balanceFor(db, who).outstanding, 100);

  // The client payment is still received and no longer reads as counted.
  assert.equal(payments.list(db, projectId)[0].paid_to_uuid, null);
  assert.equal(card().total_received, 150);
  assert.throws(() => payments.stopCounting(db, ORG, pay.id), /not counted as paid to anyone/);

  // A reversed link is history, so the payment can be counted again: a new payroll row.
  const again = payments.countAsPaidTo(db, ORG, pay.id, who);
  assert.notEqual(again.paid_to_uuid, payrollUuid);
  assert.equal(listPayments(db, who).length, 3);
  assert.equal(balanceFor(db, who).paid, 150);
});

test("removing a counted payment: both sides, or the payment only", () => {
  const pay = payments.list(db, projectId)[0];
  // Both: the payment stops counting as received and the pay is reversed, in one step.
  const stood = payments.remove(db, ORG, pay.id, true);
  assert.equal(stood.id, pay.id);
  assert.notEqual(stood.paid_to_uuid, null);
  assert.deepEqual(payments.list(db, projectId), []);
  assert.equal(card().total_received, 0);
  assert.equal(totals().received, 0);
  assert.equal(balanceFor(db, who).paid, 0);
  // Removed, not erased: the row is still on disk, and it can no longer be counted as pay.
  const kept = db.prepare(`SELECT deleted_at FROM timetracker_project_payments WHERE id = ?`).get(pay.id) as { deleted_at: string | null };
  assert.notEqual(kept.deleted_at, null);
  assert.throws(() => payments.countAsPaidTo(db, ORG, pay.id, who), /has been removed/);

  // The tick on the form: the payment and the pay are saved together.
  const second = payments.add(db, ORG, { projectId, amount: 80, receivedOn: "2026-11-01", method: "check", paidToEmployeeId: who });
  assert.equal(second.paid_to_name, "Fake Person A");
  assert.equal(card().total_received, 80);
  assert.equal(balanceFor(db, who).paid, 80);
  // Payment only: the client payment goes and the person's pay is left as it is.
  payments.remove(db, ORG, second.id, false);
  assert.equal(card().total_received, 0);
  assert.equal(balanceFor(db, who).paid, 80);
});

test("the tick and the payment are saved together or not at all", () => {
  const before = db.prepare(`SELECT COUNT(*) AS n FROM timetracker_project_payments`).get() as { n: number };
  assert.throws(
    () => payments.add(db, ORG, { projectId, amount: 20, receivedOn: "2026-11-02", method: "cash", paidToEmployeeId: 999_999 }),
    /not found/
  );
  const after = db.prepare(`SELECT COUNT(*) AS n FROM timetracker_project_payments`).get() as { n: number };
  assert.equal(after.n, before.n);
});

test("who a payment can be counted as paid to: the people on the project, or everyone active when there is nobody", () => {
  assert.deepEqual(payments.payees(db, ORG, projectId), [{ id: who, name: "Fake Person A" }]);

  const other = person("Fake Person B");
  const gone = person("Fake Person C");
  db.prepare(`UPDATE employee_people SET archived_at = ? WHERE id = ?`).run("2026-11-01T00:00:00.000Z", gone);
  const empty = insertId(
    `INSERT INTO timetracker_projects (uuid, org_id, client_id, name) VALUES (?, ?, ?, ?)`,
    randomUUID(),
    ORG,
    clientId,
    "Fake Empty Job"
  );
  // Nobody is on it and nobody logged time against it, so every active person is offered.
  assert.deepEqual(payments.payees(db, ORG, empty), [
    { id: who, name: "Fake Person A" },
    { id: other, name: "Fake Person B" },
  ]);
  // The first project still offers only the person with time on it.
  assert.deepEqual(payments.payees(db, ORG, projectId), [{ id: who, name: "Fake Person A" }]);
});
