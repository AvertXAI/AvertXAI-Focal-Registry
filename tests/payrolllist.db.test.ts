/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
/* File: tests/payrolllist.db.test.ts */
// The Payroll tab's payment list against a throwaway database (TT-09). One person's payments are
// read back with the project a linked client payment came in on, a reversed payment and its
// reversal are told apart, and the total under the list is the figure the Outstanding card calls
// "paid". Runs under Electron-as-Node, because the SQLite module is built for Electron. Every name
// is made up.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import Database from "better-sqlite3-multiple-ciphers";
import { ensureEmployeesSchema } from "../electron/core/services/employees/db";
import { listPayments, recordPayment, reversePayment } from "../electron/core/services/employees/payments";
import { balanceFor } from "../electron/core/services/employees/reports";
import { ensureTimeTrackerSchema } from "../electron/core/services/timetracker/db";
import * as clientPayments from "../electron/core/services/timetracker/payments";
import { paidTotal, reversedUuids } from "../src/modules/employees/payrollLines";

const ORG = "org-fake";
const PROJECT = "Fake Contract Job";

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
const person = (name: string): number =>
  insertId(`INSERT INTO employee_people (uuid, org_id, name) VALUES (?, ?, ?)`, randomUUID(), ORG, name);
const clientId = insertId(`INSERT INTO timetracker_clients (uuid, org_id, name) VALUES (?, ?, ?)`, randomUUID(), ORG, "Fake Client");
const projectId = insertId(
  `INSERT INTO timetracker_projects (uuid, org_id, client_id, name) VALUES (?, ?, ?, ?)`,
  randomUUID(),
  ORG,
  clientId,
  PROJECT
);
const who = person("Fake Person A");
const other = person("Fake Person B");

// Halves and quarters on purpose: they add up exactly, so the totals below can be compared as they
// are, with no rounding in the test to hide a wrong sum.
const ordinary = recordPayment(db, ORG, {
  employeeId: who,
  amount: 80.5,
  paidOn: "2026-10-05",
  method: "check",
  reference: "FAKE-CHK-1",
  note: "Fake note",
});
const mistake = recordPayment(db, ORG, {
  employeeId: who,
  amount: 40.25,
  paidOn: "2026-10-10",
  method: "cash",
  reference: null,
  note: null,
});
const reversal = reversePayment(db, ORG, mistake.uuid, null);
// A client payment on the project, also counted as paid to the person: the linked payroll line.
const received = clientPayments.add(db, ORG, {
  projectId,
  amount: 150,
  receivedOn: "2026-10-28",
  method: "bank_transfer",
  reference: "FAKE-REF-1",
  paidToEmployeeId: who,
});
// Someone else's pay must never reach this person's list or total.
recordPayment(db, ORG, { employeeId: other, amount: 999, paidOn: "2026-10-06", method: null, reference: null, note: null });

test("every payment to the person is listed with its details, and the linked one names its project", () => {
  const rows = listPayments(db, who);
  assert.equal(rows.length, 4);
  assert.ok(rows.every((r) => r.employee_id === who));

  const plain = rows.find((r) => r.uuid === ordinary.uuid)!;
  assert.equal(plain.paid_on, "2026-10-05");
  assert.equal(plain.amount, 80.5);
  assert.equal(plain.method, "check");
  assert.equal(plain.reference, "FAKE-CHK-1");
  assert.equal(plain.note, "Fake note");
  // An ordinary payroll payment came from no client payment, so it names no project.
  assert.equal(plain.project_name, null);

  const linked = rows.find((r) => r.project_payment_uuid === received.uuid)!;
  assert.equal(linked.uuid, received.paid_to_uuid);
  assert.equal(linked.amount, 150);
  assert.equal(linked.paid_on, "2026-10-28");
  assert.equal(linked.method, "bank_transfer");
  assert.equal(linked.project_name, PROJECT);
});

test("a reversed payment and its reversal are both listed, and each can be told for what it is", () => {
  const rows = listPayments(db, who);
  assert.deepEqual([...reversedUuids(rows)], [mistake.uuid]);

  const back = rows.find((r) => r.reverses_uuid === mistake.uuid)!;
  assert.equal(back.uuid, reversal.uuid);
  assert.equal(back.amount, -40.25);
  assert.equal(back.project_name, null);
  // The payment that was taken back is still there, untouched.
  assert.equal(rows.find((r) => r.uuid === mistake.uuid)!.amount, 40.25);
});

test("the total under the list is what the Outstanding card reports as paid", () => {
  const rows = listPayments(db, who);
  // 80.50 + 40.25 - 40.25 + 150.00: the reversed pair is counted and cancels.
  assert.equal(paidTotal(rows), 230.5);
  assert.equal(paidTotal(rows), balanceFor(db, who).paid);

  assert.equal(paidTotal(listPayments(db, other)), 999);
  assert.equal(balanceFor(db, other).paid, 999);
});

test("taking a counted payment back: its reversal names the same project, and the total follows", () => {
  clientPayments.stopCounting(db, ORG, received.id);
  const rows = listPayments(db, who);
  assert.equal(rows.length, 5);

  const back = rows.find((r) => r.reverses_uuid === received.paid_to_uuid)!;
  assert.equal(back.amount, -150);
  // The reversal has no link of its own, and still reads as belonging to the same project.
  assert.equal(back.project_payment_uuid, null);
  assert.equal(back.project_name, PROJECT);
  assert.deepEqual([...reversedUuids(rows)].sort(), [mistake.uuid, received.paid_to_uuid].sort());

  assert.equal(paidTotal(rows), 80.5);
  assert.equal(paidTotal(rows), balanceFor(db, who).paid);
});

test("the project is named as it reads today", () => {
  db.prepare(`UPDATE timetracker_projects SET name = ? WHERE id = ?`).run("Fake Renamed Job", projectId);
  const linked = listPayments(db, who).find((r) => r.project_payment_uuid === received.uuid)!;
  assert.equal(linked.project_name, "Fake Renamed Job");
});

test("float dust below a cent never shows as minus zero", () => {
  // -0.1 - 0.2 + 0.3 is a hair under zero in floating point, which rounds to negative zero.
  assert.equal(Object.is(paidTotal([{ amount: -0.1 }, { amount: -0.2 }, { amount: 0.3 }]), 0), true);
  assert.equal(paidTotal([]), 0);
});
