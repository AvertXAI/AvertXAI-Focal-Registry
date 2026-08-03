// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: The payment ledger — APPEND-ONLY, and this file contains no UPDATE and no DELETE to
//              prove it. A mistake is corrected by a reversing row (negative amount pointing at the
//              original's uuid), never by editing history. This is a record of what was PAID: it
//              never withholds tax, computes net pay, files anything, or moves money. The
//              outstanding balance is derived in reports.ts and is stored nowhere.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/employees/payments.ts
//------------------------------------------------------------
import { generateUUIDv7 } from "../utils/uuidv7";
import { nowIso, type Db } from "./db";
import { logEvent } from "./eventLog";
import { getPerson } from "./people";
import type { Payment, PaymentInput } from "./types";
import { vDate, vId, vNullableString, vSignedAmount, vUuid } from "./validate";

function getPayment(db: Db, id: number): Payment {
  const row = db.prepare(`SELECT * FROM employee_payments WHERE id = ?`).get(id) as Payment | undefined;
  if (!row) throw new Error(`Payment ${id} not found`);
  return row;
}

/** One person's payments, most recent first. Reversals sit in the list beside what they reversed. */
export function listPayments(db: Db, employeeId: number): Payment[] {
  return db
    .prepare(`SELECT * FROM employee_payments WHERE employee_id = ? ORDER BY paid_on DESC, id DESC`)
    .all(vId(employeeId, "person id")) as Payment[];
}

/** Inclusive payment-date window — the cash-basis read a later Tax Summary phase builds on. */
export function listPaymentsInRange(db: Db, orgId: string, fromDate: string, toDate: string): Payment[] {
  return db
    .prepare(
      `SELECT * FROM employee_payments
       WHERE org_id = ? AND paid_on >= ? AND paid_on <= ?
       ORDER BY paid_on DESC, id DESC`
    )
    .all(orgId, vDate(fromDate, "from date"), vDate(toDate, "to date")) as Payment[];
}

/** Record a payment. Append-only: this INSERT is the only ordinary write in the ledger. */
export function recordPayment(db: Db, orgId: string, input: PaymentInput): Payment {
  const person = getPerson(db, vId(input.employeeId, "person id"));
  const amount = vSignedAmount(input.amount, "payment amount");
  const paidOn = vDate(input.paidOn, "payment date");
  const res = db
    .prepare(
      `INSERT INTO employee_payments
         (uuid, org_id, employee_id, amount, paid_on, method, reference, note, reverses_uuid, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
    )
    .run(
      generateUUIDv7(),
      orgId,
      person.id,
      amount,
      paidOn,
      vNullableString(input.method, "method", 100),
      vNullableString(input.reference, "reference", 200),
      vNullableString(input.note, "note", 2000),
      nowIso()
    );
  const payment = getPayment(db, Number(res.lastInsertRowid));
  logEvent(db, orgId, {
    type: "payment_recorded",
    employeeId: person.id,
    employeeName: person.name,
    detail: `${amount} on ${paidOn}`,
  });
  return payment;
}

/**
 * Reverse a payment by APPENDING its mirror image — the original row is left exactly as it was.
 * Refuses to reverse a reversal, and refuses to reverse the same payment twice, because either
 * would quietly move the balance twice.
 */
export function reversePayment(db: Db, orgId: string, uuid: string, note: string | null): Payment {
  const original = db.prepare(`SELECT * FROM employee_payments WHERE uuid = ?`).get(vUuid(uuid, "payment id")) as
    | Payment
    | undefined;
  if (!original) throw new Error(`Payment ${uuid} not found`);
  if (original.reverses_uuid) throw new Error("That row is already a reversal — reverse the original payment instead");
  const existing = db
    .prepare(`SELECT id FROM employee_payments WHERE reverses_uuid = ?`)
    .get(original.uuid) as { id: number } | undefined;
  if (existing) throw new Error("That payment has already been reversed");

  const person = getPerson(db, original.employee_id);
  const at = nowIso();
  const res = db
    .prepare(
      `INSERT INTO employee_payments
         (uuid, org_id, employee_id, amount, paid_on, method, reference, note, reverses_uuid, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      generateUUIDv7(),
      orgId,
      original.employee_id,
      -original.amount, // the mirror image; the original keeps its own value untouched
      at.slice(0, 10), // reversed on the day it is reversed — the original's date is history
      original.method,
      original.reference,
      vNullableString(note, "note", 2000) ?? `Reversal of payment ${original.uuid}`,
      original.uuid,
      at
    );
  const reversal = getPayment(db, Number(res.lastInsertRowid));
  logEvent(db, orgId, {
    type: "payment_reversed",
    employeeId: person.id,
    employeeName: person.name,
    detail: `${original.amount} paid ${original.paid_on}`,
  });
  return reversal;
}
