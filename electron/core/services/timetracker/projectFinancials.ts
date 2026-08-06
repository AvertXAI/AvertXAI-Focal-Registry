// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Project financials — the itemized cost rows, the project's employee roster, and the
//              one read that answers "spent so far".
//
//              WHAT "SPENT" MEANS (Jason ruled 2026-08-04, and the exclusion is the whole point):
//                spent = employee time + employee completions + this project's itemized rows.
//              Jason's OWN timetracker_time_entries are EXCLUDED. His hours stay tracked per
//              project, but his own time is not money he spent hiring — counting it would inflate
//              every project's cost by the value of his own labour and make "Budget left" a
//              fiction. There is deliberately no join to timetracker_time_entries in this file.
//
//              The employee half is NOT recomputed here. It calls the PROVEN employeeCostByProject,
//              which already unions entries, valued hours corrections and project-scoped amount
//              corrections and excludes soft-deleted ones — so one money rule, one place. This file
//              adds the itemized total and nothing else. That read was built in Employees Phase 1
//              and described in its own header as "THE SEAM a later phase joins to TimeTracker's
//              analytics"; this is that phase.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/timetracker/projectFinancials.ts
//------------------------------------------------------------
import { generateUUIDv7 } from "../utils/uuidv7";
import { employeeCostForProject } from "../employees/reports";
import { assertNotCompleted } from "./completion";
import type { Db } from "./db";
import type { ProjectItem, ProjectItemInput, ProjectMember, ProjectSpend } from "./types";
import { vAmount, vId, vNullableString, vString } from "./validate";

const nowIso = (): string => new Date().toISOString();

// ---- itemized cost rows ------------------------------------------------------------------

/** Live rows for one project, oldest first — the order they were entered is the order they read. */
export function listProjectItems(db: Db, projectId: number): ProjectItem[] {
  return db
    .prepare(
      `SELECT * FROM timetracker_project_items
       WHERE project_id = ? AND deleted_at IS NULL ORDER BY id ASC`
    )
    .all(vId(projectId, "project id")) as ProjectItem[];
}

function getItem(db: Db, id: number): ProjectItem {
  const row = db.prepare(`SELECT * FROM timetracker_project_items WHERE id = ?`).get(id) as ProjectItem | undefined;
  if (!row) throw new Error(`Item ${id} not found`);
  return row;
}

export function addProjectItem(db: Db, orgId: string, input: ProjectItemInput): ProjectItem {
  assertNotCompleted(db, vId(input?.projectId, "project id"));
  const at = nowIso();
  const res = db
    .prepare(
      `INSERT INTO timetracker_project_items (uuid, org_id, project_id, qty, description, amount, unit_rate, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      generateUUIDv7(),
      orgId,
      vId(input?.projectId, "project id"),
      vAmount(input?.qty ?? 1, "quantity"),
      vString(input?.description, "description", 300, true).trim(),
      // The LINE total, not a unit price. Deliberate: the mockup's rows read "2 · Battery rentals ·
      // $80.00" and the itemized total is the plain sum, so multiplying here would double-count.
      vAmount(input?.amount ?? 0, "amount"),
      // Unit rate (08-06) — captured going forward for the invoice's qty × rate = amount columns;
      // null is legal (legacy shape) and readers derive amount ÷ qty.
      input?.unitRate == null ? null : vAmount(input.unitRate, "unit rate"),
      at
    );
  return getItem(db, Number(res.lastInsertRowid));
}

export function updateProjectItem(db: Db, id: number, input: ProjectItemInput): ProjectItem {
  const itemId = vId(id, "item id");
  const existing = getItem(db, itemId);
  if (existing.deleted_at) throw new Error("That row was removed and cannot be edited.");
  assertNotCompleted(db, existing.project_id); // by-item-id path — parent resolved first
  const res = db
    .prepare(
      `UPDATE timetracker_project_items SET qty = ?, description = ?, amount = ?, unit_rate = ?, updated_at = ? WHERE id = ?`
    )
    .run(
      vAmount(input?.qty ?? 1, "quantity"),
      vString(input?.description, "description", 300, true).trim(),
      vAmount(input?.amount ?? 0, "amount"),
      input?.unitRate == null ? null : vAmount(input.unitRate, "unit rate"),
      nowIso(),
      itemId
    );
  if (res.changes === 0) throw new Error(`Item ${itemId} not found`);
  return getItem(db, itemId);
}

/** SOFT delete — the row leaves every total and every list but stays on disk. A money row that
    fed a figure someone may have quoted is never hard-removed. Idempotent. */
export function removeProjectItem(db: Db, id: number): void {
  const item = getItem(db, vId(id, "item id"));
  if (item.deleted_at) return;
  assertNotCompleted(db, item.project_id); // by-item-id path — parent resolved first
  const at = nowIso();
  db.prepare(`UPDATE timetracker_project_items SET deleted_at = ?, updated_at = ? WHERE id = ?`).run(at, at, item.id);
}

/** The itemized total for one project — live rows only. */
export function itemizedTotal(db: Db, projectId: number): number {
  return (
    db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM timetracker_project_items
         WHERE project_id = ? AND deleted_at IS NULL`
      )
      .get(vId(projectId, "project id")) as { total: number }
  ).total;
}

// ---- project roster ---------------------------------------------------------------------

/**
 * Who is CURRENTLY on this project. Joins employee_people for the name and pay terms — the two
 * modules share one database and one connection, so this is a plain join with no ATTACH (the
 * standing arrangement recorded in employees/db.ts).
 * LEFT JOIN, deliberately: person_id is a soft reference, so a membership whose person was purged
 * still lists rather than vanishing, and the caller can see there is something to tidy.
 */
export function listProjectEmployees(db: Db, projectId: number): ProjectMember[] {
  return db
    .prepare(
      `SELECT pe.id, pe.uuid, pe.project_id, pe.person_id, pe.added_at,
              p.name AS person_name, p.role AS person_role,
              p.default_rate AS default_rate, p.default_pay_type AS default_pay_type
       FROM timetracker_project_employees pe
       LEFT JOIN employee_people p ON p.id = pe.person_id
       WHERE pe.project_id = ? AND pe.removed_at IS NULL
       ORDER BY pe.added_at ASC`
    )
    .all(vId(projectId, "project id")) as ProjectMember[];
}

/** Adds someone to the project. Idempotent: re-adding a live member returns the existing row rather
    than tripping the partial unique index. */
export function addProjectEmployee(db: Db, orgId: string, projectId: number, personId: number): ProjectMember {
  const pid = vId(projectId, "project id");
  assertNotCompleted(db, pid);
  const person = vId(personId, "person id");
  const live = db
    .prepare(
      `SELECT id FROM timetracker_project_employees WHERE project_id = ? AND person_id = ? AND removed_at IS NULL`
    )
    .get(pid, person) as { id: number } | undefined;
  if (!live) {
    db.prepare(
      `INSERT INTO timetracker_project_employees (uuid, org_id, project_id, person_id, added_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(generateUUIDv7(), orgId, pid, person, nowIso(), nowIso());
  }
  const row = listProjectEmployees(db, pid).find((m) => m.person_id === person);
  if (!row) throw new Error("Could not read the membership back after adding it.");
  return row;
}

/** SOFT removal — "who was on this in June" stays answerable. Idempotent. */
export function removeProjectEmployee(db: Db, projectId: number, personId: number): void {
  assertNotCompleted(db, vId(projectId, "project id"));
  db.prepare(
    `UPDATE timetracker_project_employees SET removed_at = ?, updated_at = ?
     WHERE project_id = ? AND person_id = ? AND removed_at IS NULL`
  ).run(nowIso(), nowIso(), vId(projectId, "project id"), vId(personId, "person id"));
}

// ---- the three readouts -----------------------------------------------------------------

/**
 * Contracted / Spent so far / Budget left for one project.
 *
 * spent = employeeCostForProject (entries + BOTH correction kinds, soft-deleted excluded — the
 *         proven read, not recomputed here) + the live itemized total.
 * Jason's own timetracker_time_entries are NOT part of this. See the file header.
 *
 * budgetLeft is measured against spend_budget — what he planned to SPEND — not against
 * contract_amount, which is what the client agreed to PAY. Confirmed against the mockup's own
 * arithmetic ($4,000 budget − $1,193.75 spent = $2,806.25). Null budget yields a null remainder
 * rather than a misleading zero: "no budget set" and "nothing left" are different answers.
 */
export function projectSpend(db: Db, orgId: string, projectId: number): ProjectSpend {
  const id = vId(projectId, "project id");
  const row = db
    .prepare(`SELECT contract_amount, spend_budget FROM timetracker_projects WHERE id = ?`)
    .get(id) as { contract_amount: number | null; spend_budget: number | null } | undefined;
  if (!row) throw new Error(`Project ${id} not found`);

  const employee = employeeCostForProject(db, orgId, id);
  const items = itemizedTotal(db, id);
  const spent = employee.employee_cost + items;

  return {
    project_id: id,
    contracted: row.contract_amount,
    employee_cost: employee.employee_cost,
    employee_hours: employee.employee_hours,
    itemized_total: items,
    spent,
    spend_budget: row.spend_budget,
    budget_left: row.spend_budget == null ? null : row.spend_budget - spent,
  };
}

/** Kept so a caller can validate a note without importing the whole validator set. */
export const vItemNote = (v: unknown): string | null => vNullableString(v, "note", 300);
