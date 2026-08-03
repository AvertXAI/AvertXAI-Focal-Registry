// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Employee tasks — their own records, assignable with zero hours logged, carrying the
//              done state that flat-per-task pay depends on. A task is NEVER a money row: paying
//              for one is an entry with pay_type 'task'. Entries reference a task softly, so
//              tidying the task list can never disturb a payroll record.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/employees/tasks.ts
//------------------------------------------------------------
import { generateUUIDv7 } from "../utils/uuidv7";
import { nowIso, type Db } from "./db";
import { logEvent } from "./eventLog";
import { getPerson } from "./people";
import type { Task, TaskInput } from "./types";
import { vId, vNullableId, vNullableString, vString } from "./validate";

function clean(raw: TaskInput): TaskInput {
  return {
    title: vString(raw.title, "title", 200, true).trim(),
    detail: vNullableString(raw.detail, "detail", 4000),
    employeeId: vNullableId(raw.employeeId, "person id"),
    projectId: vNullableId(raw.projectId, "project id"),
    projectName: vNullableString(raw.projectName, "project name", 200),
  };
}

export function getTask(db: Db, id: number): Task {
  const row = db.prepare(`SELECT * FROM employee_tasks WHERE id = ?`).get(vId(id, "task id")) as Task | undefined;
  if (!row) throw new Error(`Task ${id} not found`);
  return row;
}

/** Open tasks first, then completed ones — newest first within each. Soft-deleted rows are hidden. */
export function listTasks(db: Db, orgId: string): Task[] {
  return db
    .prepare(
      `SELECT * FROM employee_tasks WHERE org_id = ? AND deleted_at IS NULL
       ORDER BY (done_at IS NOT NULL) ASC, COALESCE(done_at, created_at) DESC, id DESC`
    )
    .all(orgId) as Task[];
}

export function listTasksForPerson(db: Db, employeeId: number): Task[] {
  return db
    .prepare(
      `SELECT * FROM employee_tasks WHERE employee_id = ? AND deleted_at IS NULL
       ORDER BY (done_at IS NOT NULL) ASC, COALESCE(done_at, created_at) DESC, id DESC`
    )
    .all(vId(employeeId, "person id")) as Task[];
}

export function createTask(db: Db, orgId: string, input: TaskInput): Task {
  const t = clean(input);
  // An assignee is optional, but a named one must exist.
  const assignee = t.employeeId == null ? null : getPerson(db, t.employeeId);
  const res = db
    .prepare(
      `INSERT INTO employee_tasks (uuid, org_id, title, detail, employee_id, project_id, project_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(generateUUIDv7(), orgId, t.title, t.detail, t.employeeId, t.projectId, t.projectName, nowIso());
  const task = getTask(db, Number(res.lastInsertRowid));
  logEvent(db, orgId, {
    type: "task_created",
    employeeId: assignee?.id ?? null,
    employeeName: assignee?.name ?? "Unassigned",
    detail: task.title,
  });
  return task;
}

export function updateTask(db: Db, id: number, input: TaskInput): Task {
  const taskId = vId(id, "task id");
  if (getTask(db, taskId).deleted_at) throw new Error("Cannot edit a deleted task");
  const t = clean(input);
  if (t.employeeId != null) getPerson(db, t.employeeId);
  const res = db
    .prepare(
      `UPDATE employee_tasks
       SET title = ?, detail = ?, employee_id = ?, project_id = ?, project_name = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(t.title, t.detail, t.employeeId, t.projectId, t.projectName, nowIso(), taskId);
  if (res.changes === 0) throw new Error(`Task ${taskId} not found`);
  return getTask(db, taskId);
}

/** Assign or unassign (null). Assignment is deliberately its own operation — it is the common one. */
export function assignTask(db: Db, orgId: string, id: number, employeeId: number | null): Task {
  const task = getTask(db, id);
  if (task.deleted_at) throw new Error("Cannot assign a deleted task");
  const assignee = employeeId == null ? null : getPerson(db, vId(employeeId, "person id"));
  db.prepare(`UPDATE employee_tasks SET employee_id = ?, updated_at = ? WHERE id = ?`).run(
    assignee?.id ?? null,
    nowIso(),
    task.id
  );
  logEvent(db, orgId, {
    type: "task_assigned",
    employeeId: assignee?.id ?? null,
    employeeName: assignee?.name ?? "Unassigned",
    detail: task.title,
  });
  return getTask(db, task.id);
}

/** The done state flat-per-task pay depends on. Idempotent both ways. */
export function setTaskDone(db: Db, orgId: string, id: number, done: boolean): Task {
  const task = getTask(db, id);
  if (task.deleted_at) throw new Error("Cannot complete a deleted task");
  if (done === (task.done_at !== null)) return task;
  const at = nowIso();
  db.prepare(`UPDATE employee_tasks SET done_at = ?, updated_at = ? WHERE id = ?`).run(done ? at : null, at, task.id);
  const assignee = task.employee_id == null ? null : getPerson(db, task.employee_id);
  logEvent(db, orgId, {
    type: done ? "task_done" : "task_reopened",
    employeeId: assignee?.id ?? null,
    employeeName: assignee?.name ?? "Unassigned",
    detail: task.title,
  });
  return getTask(db, task.id);
}

/**
 * SOFT delete (Jason 08-01-2026, correcting Phase 1's hard delete). A paid per-task entry stores
 * task_id but NOT the title, so hard-removing the row would strip the context off a payment record
 * that still stands. The row is hidden from every list and never leaves the table — the same shape
 * employee_adjustments uses. Idempotent.
 */
export function removeTask(db: Db, id: number): void {
  const task = getTask(db, id);
  if (task.deleted_at) return;
  const at = nowIso();
  db.prepare(`UPDATE employee_tasks SET deleted_at = ?, updated_at = ? WHERE id = ?`).run(at, at, task.id);
}
