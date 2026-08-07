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
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/timetracker/payments.ts
//------------------------------------------------------------
import { generateUUIDv7 } from "../utils/uuidv7";
import { nowIso, type Db } from "./db";
import type { ProjectPayment, ProjectPaymentInput } from "./types";
import { PAYMENT_METHODS, vAmount, vEnum, vId, vNullableString, vString } from "./validate";

/** Live payments for one project, oldest first — the order money arrived reads top-down. */
export function list(db: Db, projectId: number): ProjectPayment[] {
  return db
    .prepare(
      `SELECT * FROM timetracker_project_payments
       WHERE project_id = ? AND deleted_at IS NULL ORDER BY received_on ASC, id ASC`
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

export function add(db: Db, orgId: string, input: ProjectPaymentInput): ProjectPayment {
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
  return db
    .prepare(`SELECT * FROM timetracker_project_payments WHERE id = ?`)
    .get(Number(res.lastInsertRowid)) as ProjectPayment;
}

/** VOID a payment (soft) — the row stays on disk with deleted_at set; totals stop counting it. */
export function softDelete(db: Db, id: number): void {
  db.prepare(
    `UPDATE timetracker_project_payments SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`
  ).run(nowIso(), nowIso(), vId(id, "payment id"));
}
