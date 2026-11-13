/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
/* File: tests/defaultproject.db.test.ts */
// Adding a person to a project (TT-07): the project becomes their default only when they have
// none. Runs under Electron-as-Node against a throwaway database; every name here is made up.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import Database from "better-sqlite3-multiple-ciphers";
import { ensureEmployeesSchema } from "../electron/core/services/employees/db";
import { ensureTimeTrackerSchema } from "../electron/core/services/timetracker/db";
import { addProjectEmployee, removeProjectEmployee } from "../electron/core/services/timetracker/projectFinancials";

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
const project = (name: string): number =>
  insertId(`INSERT INTO timetracker_projects (uuid, org_id, client_id, name) VALUES (?, ?, ?, ?)`, randomUUID(), ORG, clientId, name);
const person = (name: string): number =>
  insertId(`INSERT INTO employee_people (uuid, org_id, name) VALUES (?, ?, ?)`, randomUUID(), ORG, name);
const defaultOf = (id: number): { default_project_id: number | null; default_project_name: string | null } =>
  db.prepare(`SELECT default_project_id, default_project_name FROM employee_people WHERE id = ?`).get(id) as {
    default_project_id: number | null;
    default_project_name: string | null;
  };

const first = project("Fake First Project");
const second = project("Fake Second Project");

test("a person with no default project gets the project they are added to", () => {
  const id = person("Fake Person One");
  assert.deepEqual(defaultOf(id), { default_project_id: null, default_project_name: null });
  const member = addProjectEmployee(db, ORG, first, id);
  assert.equal(member.person_id, id);
  assert.deepEqual(defaultOf(id), { default_project_id: first, default_project_name: "Fake First Project" });
});

test("a person who already has a default keeps it when added to another project", () => {
  const id = person("Fake Person Two");
  addProjectEmployee(db, ORG, first, id);
  addProjectEmployee(db, ORG, second, id);
  assert.deepEqual(defaultOf(id), { default_project_id: first, default_project_name: "Fake First Project" });
});

test("adding a live member again changes nothing, and a cleared default is not put back by it", () => {
  const id = person("Fake Person Three");
  addProjectEmployee(db, ORG, first, id);
  db.prepare(`UPDATE employee_people SET default_project_id = NULL, default_project_name = NULL WHERE id = ?`).run(id);
  addProjectEmployee(db, ORG, first, id);
  assert.deepEqual(defaultOf(id), { default_project_id: null, default_project_name: null });
  // Taken off and added back is a real add again, so the empty default is filled.
  removeProjectEmployee(db, first, id);
  addProjectEmployee(db, ORG, first, id);
  assert.equal(defaultOf(id).default_project_id, first);
});
