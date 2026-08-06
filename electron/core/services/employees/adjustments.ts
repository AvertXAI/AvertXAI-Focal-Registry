// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Employee corrections — create/edit/soft-delete with an append-only audit log, the
//              shape lifted from timetracker/adjustments.ts. HOURS and AMOUNT are different
//              operations: an hours correction names a project and carries its own mandatory rate
//              (so corrected hours are valued at the rate the correction was made at, never at a
//              rate that has since changed); an amount correction needs neither. Adjustments NEVER
//              touch employee_entries, and they are never tier-capped — they exist to fix history.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/employees/adjustments.ts
//------------------------------------------------------------
import { generateUUIDv7 } from "../utils/uuidv7";
import { nowIso, type Db } from "./db";
import { logEvent } from "./eventLog";
import { getPerson } from "./people";
import { assertNotCompleted } from "../timetracker/completion";
import type { Adjustment, AdjustmentKind, EmployeeAuditEntry } from "./types";
import { vAmount, vDeltaAmount, vDeltaMinutes, vId, vNullableId, vNullableString, vString, vUuid } from "./validate";

interface AdjustmentRow extends Omit<Adjustment, "audit_log"> {
  audit_log: string;
}

function parse(row: AdjustmentRow): Adjustment {
  return { ...row, audit_log: JSON.parse(row.audit_log) as EmployeeAuditEntry[] };
}

function getOne(db: Db, uuid: string): Adjustment {
  const row = db.prepare(`SELECT * FROM employee_adjustments WHERE uuid = ?`).get(uuid) as AdjustmentRow | undefined;
  if (!row) throw new Error(`Adjustment ${uuid} not found`);
  return parse(row);
}

/** Every adjustment for one person (soft-deleted included, for the struck-through audit view). */
export function listAdjustments(db: Db, employeeId: number): Adjustment[] {
  return (
    db
      .prepare(`SELECT * FROM employee_adjustments WHERE employee_id = ? ORDER BY created_at DESC, id DESC`)
      .all(vId(employeeId, "person id")) as AdjustmentRow[]
  ).map(parse);
}

export function listAllAdjustments(db: Db, orgId: string): Adjustment[] {
  return (
    db
      .prepare(`SELECT * FROM employee_adjustments WHERE org_id = ? ORDER BY created_at DESC, id DESC`)
      .all(orgId) as AdjustmentRow[]
  ).map(parse);
}

export interface HoursAdjustmentInput {
  employeeId: number;
  /** REQUIRED on an hours adjustment — the hours belong to a project or they cannot be costed. */
  projectId: number;
  projectName: string;
  deltaMinutes: number;
  /** Mandatory: what the corrected hours are worth. Never re-derived later. */
  rateAtEntry: number;
  note: string;
}

export interface AmountAdjustmentInput {
  employeeId: number;
  /** Optional on an amount adjustment — a flat correction need not belong to a project. */
  projectId: number | null;
  projectName: string | null;
  deltaAmount: number;
  note: string;
}

function requireNote(note: string): string {
  const trimmed = vString(note, "note", 2000).trim();
  if (!trimmed) throw new Error("A note explaining the adjustment is required");
  return trimmed;
}

function insert(
  db: Db,
  orgId: string,
  kind: AdjustmentKind,
  values: {
    employeeId: number;
    projectId: number | null;
    projectName: string | null;
    deltaMinutes: number | null;
    rateAtEntry: number | null;
    deltaAmount: number | null;
    note: string;
  }
): Adjustment {
  // Completion lock (ruling 3): no corrections on a completed project — either kind. Adjustments
  // stay exempt from CAPS, not from the lock. A null project (amount kind) passes.
  assertNotCompleted(db, values.projectId);
  const person = getPerson(db, values.employeeId);
  const uuid = generateUUIDv7();
  const at = nowIso();
  const audit: EmployeeAuditEntry[] = [
    {
      action: "created",
      at,
      kind,
      ...(values.deltaMinutes !== null ? { delta_minutes: values.deltaMinutes } : {}),
      ...(values.deltaAmount !== null ? { delta_amount: values.deltaAmount } : {}),
      note: values.note,
    },
  ];
  db.prepare(
    `INSERT INTO employee_adjustments
       (uuid, org_id, employee_id, kind, project_id, project_name, delta_minutes, rate_at_entry,
        delta_amount, note, deleted_at, audit_log, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
  ).run(
    uuid,
    orgId,
    person.id,
    kind,
    values.projectId,
    values.projectName,
    values.deltaMinutes,
    values.rateAtEntry,
    values.deltaAmount,
    values.note,
    JSON.stringify(audit),
    at,
    at
  );
  logEvent(db, orgId, {
    type: "adjusted",
    employeeId: person.id,
    employeeName: person.name,
    detail: kind === "hours" ? `${values.deltaMinutes} min` : `${values.deltaAmount}`,
  });
  return getOne(db, uuid);
}

/** Correct hours. Project is required; the rate travels with the correction. */
export function createHoursAdjustment(db: Db, orgId: string, input: HoursAdjustmentInput): Adjustment {
  return insert(db, orgId, "hours", {
    employeeId: vId(input.employeeId, "person id"),
    projectId: vId(input.projectId, "project id"),
    projectName: vString(input.projectName, "project name", 200, true).trim(),
    deltaMinutes: vDeltaMinutes(input.deltaMinutes),
    rateAtEntry: vAmount(input.rateAtEntry, "rate"),
    deltaAmount: null,
    note: requireNote(input.note),
  });
}

/** Correct an amount. Project is optional and no rate applies — the money is stated outright. */
export function createAmountAdjustment(db: Db, orgId: string, input: AmountAdjustmentInput): Adjustment {
  return insert(db, orgId, "amount", {
    employeeId: vId(input.employeeId, "person id"),
    projectId: vNullableId(input.projectId, "project id"),
    projectName: vNullableString(input.projectName, "project name", 200),
    deltaMinutes: null,
    rateAtEntry: null,
    deltaAmount: vDeltaAmount(input.deltaAmount),
    note: requireNote(input.note),
  });
}

/**
 * Edits the live values AND appends a before/after entry — history is never rewritten. The kind is
 * immutable: an hours correction cannot become an amount one, because that is a different
 * operation with different rules (delete it and make the other).
 */
export function updateAdjustment(db: Db, uuid: string, deltaValue: number, note: string): Adjustment {
  const existing = db.prepare(`SELECT * FROM employee_adjustments WHERE uuid = ?`).get(vUuid(uuid, "adjustment id")) as
    | AdjustmentRow
    | undefined;
  if (!existing) throw new Error(`Adjustment ${uuid} not found`);
  if (existing.deleted_at) throw new Error("Cannot edit a deleted adjustment");
  assertNotCompleted(db, existing.project_id); // by-uuid path — parent resolved first
  const cleanNote = requireNote(note);
  const isHours = existing.kind === "hours";
  const nextMinutes = isHours ? vDeltaMinutes(deltaValue) : null;
  const nextAmount = isHours ? null : vDeltaAmount(deltaValue);
  const at = nowIso();
  const audit = JSON.parse(existing.audit_log) as EmployeeAuditEntry[];
  audit.push({
    action: "edited",
    at,
    from: { delta_minutes: existing.delta_minutes, delta_amount: existing.delta_amount, note: existing.note },
    to: { delta_minutes: nextMinutes, delta_amount: nextAmount, note: cleanNote },
  });
  db.prepare(
    `UPDATE employee_adjustments
     SET delta_minutes = ?, delta_amount = ?, note = ?, updated_at = ?, audit_log = ?
     WHERE uuid = ?`
  ).run(nextMinutes, nextAmount, cleanNote, at, JSON.stringify(audit), existing.uuid);
  return getOne(db, existing.uuid);
}

/**
 * Undoes a soft delete: clears deleted_at and APPENDS a "restored" entry. The "deleted" entry it
 * follows is never removed — the trail has to say that this row was deleted and then brought back,
 * or it is not an audit trail. Idempotent: restoring a live adjustment is a no-op, not an error
 * (the archivePerson precedent). Added 2026-08-04 with the Employees Adjustments tab, which is the
 * first surface that can show a struck-through row and therefore the first that can offer a way back.
 */
export function restoreAdjustment(db: Db, orgId: string, uuid: string): Adjustment {
  const existing = db.prepare(`SELECT * FROM employee_adjustments WHERE uuid = ?`).get(vUuid(uuid, "adjustment id")) as
    | AdjustmentRow
    | undefined;
  if (!existing) throw new Error(`Adjustment ${uuid} not found`);
  if (!existing.deleted_at) return parse(existing);
  assertNotCompleted(db, existing.project_id); // restoring a correction is a correction too
  const at = nowIso();
  const audit = JSON.parse(existing.audit_log) as EmployeeAuditEntry[];
  audit.push({ action: "restored", at });
  db.prepare(`UPDATE employee_adjustments SET deleted_at = NULL, updated_at = ?, audit_log = ? WHERE uuid = ?`).run(
    at,
    JSON.stringify(audit),
    existing.uuid
  );
  const person = getPerson(db, existing.employee_id);
  logEvent(db, orgId, {
    type: "adjusted",
    employeeId: person.id,
    employeeName: person.name,
    detail: "correction restored",
  });
  return getOne(db, existing.uuid);
}

/** Soft delete: sets deleted_at and appends a delete entry; the row is never hard-removed. */
export function softDeleteAdjustment(db: Db, orgId: string, uuid: string): void {
  const existing = db.prepare(`SELECT * FROM employee_adjustments WHERE uuid = ?`).get(vUuid(uuid, "adjustment id")) as
    | AdjustmentRow
    | undefined;
  if (!existing) throw new Error(`Adjustment ${uuid} not found`);
  if (existing.deleted_at) return;
  assertNotCompleted(db, existing.project_id); // by-uuid path — parent resolved first
  const at = nowIso();
  const audit = JSON.parse(existing.audit_log) as EmployeeAuditEntry[];
  audit.push({ action: "deleted", at });
  db.prepare(`UPDATE employee_adjustments SET deleted_at = ?, updated_at = ?, audit_log = ? WHERE uuid = ?`).run(
    at,
    at,
    JSON.stringify(audit),
    existing.uuid
  );
  const person = getPerson(db, existing.employee_id);
  logEvent(db, orgId, { type: "adjustment_removed", employeeId: person.id, employeeName: person.name });
}
