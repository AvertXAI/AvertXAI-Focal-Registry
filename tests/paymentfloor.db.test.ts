/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
/* File: tests/paymentfloor.db.test.ts */
// A payment of zero or less against a throwaway database (TT-11). Both services refuse it in a
// sentence a person can read: money received from a client, and money paid to a person. A normal
// payment still saves, and a reversal, the one negative row the pay record holds, still works.
// Runs under Electron-as-Node, because the SQLite module is built for Electron. Every name is made up.
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
import type { PaymentInput } from "../electron/core/services/employees/types";
import { ensureTimeTrackerSchema } from "../electron/core/services/timetracker/db";
import * as payments from "../electron/core/services/timetracker/payments";
import type { ProjectPaymentInput } from "../electron/core/services/timetracker/types";

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
const projectId = insertId(
  `INSERT INTO timetracker_projects (uuid, org_id, client_id, name, rate_type, contract_kind, contract_amount, contract_date)
   VALUES (?, ?, ?, ?, 'contract', 'paid', 1000, '2026-10-01')`,
  randomUUID(),
  ORG,
  clientId,
  "Fake Contract Job"
);
const who = insertId(`INSERT INTO employee_people (uuid, org_id, name) VALUES (?, ?, ?)`, randomUUID(), ORG, "Fake Person A");

const received = (amount: number, paidToEmployeeId: number | null = null): ProjectPaymentInput => ({
  projectId,
  amount,
  receivedOn: "2026-11-02",
  method: "cash",
  paidToEmployeeId,
});
const paid = (amount: number): PaymentInput => ({
  employeeId: who,
  amount,
  paidOn: "2026-11-02",
  method: null,
  reference: null,
  note: null,
});
const clientRows = (): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM timetracker_project_payments`).get() as { n: number }).n;

test("money received: zero or less is refused in a sentence and nothing is saved, and a normal amount saves", () => {
  for (const amount of [0, -25, -0.01]) {
    assert.throws(() => payments.add(db, ORG, received(amount)), /Amount received must be more than zero\./);
  }
  // Not a number at all is still refused, in the validator's own words.
  assert.throws(() => payments.add(db, ORG, received("25" as unknown as number)), /Invalid amount/);
  assert.equal(clientRows(), 0);
  assert.equal(payments.totalFor(db, projectId), 0);

  const row = payments.add(db, ORG, received(150));
  assert.equal(row.amount, 150);
  assert.equal(payments.totalFor(db, projectId), 150);
});

test("money paid to a person: zero or less is refused in a sentence, a normal amount saves, and a reversal still works", () => {
  for (const amount of [0, -40, -0.01]) {
    assert.throws(() => recordPayment(db, ORG, paid(amount)), /The payment amount must be more than zero\./);
  }
  assert.throws(() => recordPayment(db, ORG, paid("40" as unknown as number)), /Invalid payment amount/);
  assert.deepEqual(listPayments(db, who), []);

  const payment = recordPayment(db, ORG, paid(40));
  assert.equal(payment.amount, 40);
  assert.equal(balanceFor(db, who).paid, 40);

  // The reversal is written from the original's own amount, so the floor on a typed amount does
  // not reach it: the pay record keeps the payment and gains its mirror image.
  const reversal = reversePayment(db, ORG, payment.uuid, null);
  assert.equal(reversal.amount, -40);
  assert.equal(reversal.reverses_uuid, payment.uuid);
  assert.equal(listPayments(db, who).length, 2);
  assert.equal(balanceFor(db, who).paid, 0);
  assert.throws(() => reversePayment(db, ORG, payment.uuid, null), /already been reversed/);
});

test("the tick: a zero payment reaches neither record, and a payment counted as pay can still be taken back", () => {
  const clientBefore = clientRows();
  const payrollBefore = listPayments(db, who).length;
  for (const amount of [0, -80]) {
    assert.throws(() => payments.add(db, ORG, received(amount, who)), /Amount received must be more than zero\./);
  }
  assert.equal(clientRows(), clientBefore);
  assert.equal(listPayments(db, who).length, payrollBefore);

  const counted = payments.add(db, ORG, received(80, who));
  assert.equal(counted.paid_to_name, "Fake Person A");
  assert.equal(balanceFor(db, who).paid, 80);

  // Stop counting appends a reversing line of the same size below zero. The client payment stays.
  payments.stopCounting(db, ORG, counted.id);
  const reversal = listPayments(db, who).find((r) => r.reverses_uuid === counted.paid_to_uuid);
  assert.equal(reversal?.amount, -80);
  assert.equal(balanceFor(db, who).paid, 0);
  assert.equal(payments.totalFor(db, projectId), 230);
});
