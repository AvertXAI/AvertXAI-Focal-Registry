// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: PROJECT PAYMENTS — money RECEIVED from a client (ruled 08-06; closes the recon's
//              client-payments GAP and the invoice's missing Deposit line). Append-only in
//              spirit: a mistaken row is soft-deleted (voided), never edited — history is what
//              was recorded, corrections are new facts.
//
//              DELIBERATELY NOT completion-locked. The completion toast asks "did you actually
//              get paid?" AFTER the job locks — receiving money is not an edit to the work, and
//              a lock that blocked it would force reactivate→pay→re-complete for every check
//              that arrives after delivery. This is the completion lock's ONE sanctioned
//              exception, named here so it is a decision and not an oversight.
//
//              Paid state is DERIVED, never stored: totalFor(project) >= contract_amount means
//              Paid; less means Awaiting payment (partials are normal). A derived flag cannot
//              drift from the rows that justify it.
//
//              ALSO COUNTED AS PAY (bug sweep 2, TT-06). Money from a client is not payroll, so
//              a payment here never moved a person's Outstanding. On request it can be counted
//              as pay to one person as well: that appends a payroll payment
//              (employees/payments.ts) pointed back at this row. That ledger is append-only, so
//              taking it back is a reversing row there, never a delete, and a reversed row no
//              longer counts as the link.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/timetracker/payments.ts
//------------------------------------------------------------
import { generateUUIDv7 } from "../utils/uuidv7";
import { nowIso, type Db } from "./db";
import { recordPayment, reversePayment } from "../employees/payments";
import type { PaymentPayee, ProjectPayment, ProjectPaymentInput } from "./types";
import { PAYMENT_METHODS, vAmount, vEnum, vId, vNullableString, vString } from "./validate";

// One read behind every payment row the dialog shows. The LEFT JOIN finds the payroll payment a
// client payment is also counted as, when there is one that has not been reversed: a reversed one
// is history in the payroll ledger, not a link.
const PAYMENT_SQL = `
  SELECT pay.*, ep.uuid AS paid_to_uuid, person.name AS paid_to_name
  FROM timetracker_project_payments pay
  LEFT JOIN employee_payments ep
    ON ep.project_payment_uuid = pay.uuid AND ep.reverses_uuid IS NULL
   AND NOT EXISTS (SELECT 1 FROM employee_payments r WHERE r.reverses_uuid = ep.uuid)
  LEFT JOIN employee_people person ON person.id = ep.employee_id`;

function getPayment(db: Db, id: number): ProjectPayment {
  const row = db.prepare(`${PAYMENT_SQL} WHERE pay.id = ?`).get(id) as ProjectPayment | undefined;
  if (!row) throw new Error(`Payment ${id} not found`);
  return row;
}

/** Live payments for one project, oldest first — the order money arrived reads top-down. */
export function list(db: Db, projectId: number): ProjectPayment[] {
  return db
    .prepare(
      `${PAYMENT_SQL}
       WHERE pay.project_id = ? AND pay.deleted_at IS NULL ORDER BY pay.received_on ASC, pay.id ASC`
    )
    .all(vId(projectId, "project id")) as ProjectPayment[];
}

/** The live total received — the number Awaiting/Paid derives from. */
export function totalFor(db: Db, projectId: number): number {
  return (
    db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM timetracker_project_payments
         WHERE project_id = ? AND deleted_at IS NULL`
      )
      .get(vId(projectId, "project id")) as { total: number }
  ).total;
}

/** Saves a payment and, when the "Also count as paid to" tick is on, the payroll payment that goes
    with it. One transaction, so a payment is never saved without the payroll row its tick asked
    for: a half-save would leave the form filled in and invite a second, duplicate payment. */
export function add(db: Db, orgId: string, input: ProjectPaymentInput): ProjectPayment {
  return db.transaction(() => insertPayment(db, orgId, input))();
}

function insertPayment(db: Db, orgId: string, input: ProjectPaymentInput): ProjectPayment {
  const projectId = vId(input?.projectId, "project id");
  if (!db.prepare(`SELECT id FROM timetracker_projects WHERE id = ?`).get(projectId))
    throw new Error(`Project ${projectId} not found`);
  const receivedOn = vString(input?.receivedOn, "date received", 10, true).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(receivedOn)) throw new Error("Date received must be YYYY-MM-DD");
  const res = db
    .prepare(
      `INSERT INTO timetracker_project_payments
         (uuid, org_id, project_id, amount, received_on, method, reference, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      generateUUIDv7(),
      orgId,
      projectId,
      vAmount(input?.amount, "amount"),
      receivedOn,
      vEnum(input?.method, PAYMENT_METHODS, "payment method"),
      vNullableString(input?.reference, "reference", 200),
      vNullableString(input?.note, "note", 2000),
      nowIso()
    );
  const id = Number(res.lastInsertRowid);
  if (input?.paidToEmployeeId != null) countAsPaidTo(db, orgId, id, input.paidToEmployeeId);
  return getPayment(db, id);
}

/**
 * Also count a client payment as pay to one person: appends a payroll payment of the same amount,
 * pointed back at this payment. A client payment is not payroll by itself, so nothing here happens
 * unless it is asked for. Refuses a second live link, which would count the same money twice.
 */
export function countAsPaidTo(db: Db, orgId: string, paymentId: number, employeeId: number): ProjectPayment {
  const pay = getPayment(db, vId(paymentId, "payment id"));
  if (pay.deleted_at) throw new Error("That payment has been removed");
  if (pay.paid_to_uuid) {
    throw new Error(`That payment is already counted as paid to ${pay.paid_to_name ?? "someone"}`);
  }
  const project = db.prepare(`SELECT name FROM timetracker_projects WHERE id = ?`).get(pay.project_id) as
    | { name: string }
    | undefined;
  recordPayment(
    db,
    orgId,
    {
      employeeId: vId(employeeId, "person id"),
      amount: pay.amount,
      paidOn: pay.received_on,
      method: pay.method,
      reference: pay.reference,
      note: `Client payment on ${project?.name ?? "a project"}`,
    },
    pay.uuid
  );
  return getPayment(db, pay.id);
}

/**
 * Stop counting a client payment as pay. The payroll ledger is append-only, so this adds a
 * reversing row there and leaves the client payment received. Returns the payment as it stood, so
 * the caller always learns which client payment the pay belonged to.
 */
export function stopCounting(db: Db, orgId: string, id: number): ProjectPayment {
  const pay = getPayment(db, vId(id, "payment id"));
  if (!pay.paid_to_uuid) throw new Error("That payment is not counted as paid to anyone");
  reversePayment(db, orgId, pay.paid_to_uuid, `No longer counted from the client payment received ${pay.received_on}`);
  return pay;
}

/**
 * Remove a client payment. It is voided, not erased (see softDelete). Returns the payment as it
 * stood, link included, so a caller that left the payroll side alone is still told it exists.
 * `alsoPayroll` takes that side back in the same transaction, so the two never half-apply.
 */
export function remove(db: Db, orgId: string, id: number, alsoPayroll: boolean): ProjectPayment {
  const pay = getPayment(db, vId(id, "payment id"));
  db.transaction(() => {
    if (alsoPayroll && pay.paid_to_uuid) stopCounting(db, orgId, pay.id);
    softDelete(db, pay.id);
  })();
  return pay;
}

/**
 * Who a payment on this project can also be counted as paid to: the people on the project and
 * anyone with time logged against it. When that is nobody, every active person, so the choice is
 * not missing on a project that was never staffed.
 */
export function payees(db: Db, orgId: string, projectId: number): PaymentPayee[] {
  const pid = vId(projectId, "project id");
  const onProject = db
    .prepare(
      `SELECT p.id, p.name FROM employee_people p
       WHERE p.org_id = ? AND p.archived_at IS NULL
         AND (EXISTS (SELECT 1 FROM timetracker_project_employees m
                       WHERE m.person_id = p.id AND m.project_id = ? AND m.removed_at IS NULL)
           OR EXISTS (SELECT 1 FROM employee_entries e WHERE e.employee_id = p.id AND e.project_id = ?))
       ORDER BY p.name COLLATE NOCASE ASC`
    )
    .all(orgId, pid, pid) as PaymentPayee[];
  if (onProject.length > 0) return onProject;
  return db
    .prepare(`SELECT id, name FROM employee_people WHERE org_id = ? AND archived_at IS NULL ORDER BY name COLLATE NOCASE ASC`)
    .all(orgId) as PaymentPayee[];
}

/** VOID a payment (soft) — the row stays on disk with deleted_at set; totals stop counting it. */
export function softDelete(db: Db, id: number): void {
  db.prepare(
    `UPDATE timetracker_project_payments SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`
  ).run(nowIso(), nowIso(), vId(id, "payment id"));
}
