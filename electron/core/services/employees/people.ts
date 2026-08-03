// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Employees people CRUD — create, read, edit, archive (soft) and restore. A person is
//              NEVER hard-deleted: entries, payments and adjustments point at these rows and a
//              payroll record must not lose the name it belongs to. Archiving hides someone from
//              the active roster and nothing else — their history and outstanding balance survive
//              untouched. Electron-free; tier caps are a LATER phase and appear nowhere here.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/employees/people.ts
//------------------------------------------------------------
import { generateUUIDv7 } from "../utils/uuidv7";
import { nowIso, type Db } from "./db";
import { logEvent } from "./eventLog";
import type { Person, PersonInput } from "./types";
import { vAmount, vId, vNullableString, vString } from "./validate";

function clean(raw: PersonInput): PersonInput {
  return {
    name: vString(raw.name, "name", 200, true).trim(),
    email: vNullableString(raw.email, "email", 200),
    phone: vNullableString(raw.phone, "phone", 50),
    role: vNullableString(raw.role, "role", 100),
    defaultRate: raw.defaultRate == null ? null : vAmount(raw.defaultRate, "default rate"),
    notes: vNullableString(raw.notes, "notes", 4000),
  };
}

/** Active roster — archived people are hidden from every active surface. */
export function listPeople(db: Db, orgId: string): Person[] {
  return db
    .prepare(`SELECT * FROM employee_people WHERE org_id = ? AND archived_at IS NULL ORDER BY name COLLATE NOCASE ASC`)
    .all(orgId) as Person[];
}

/** Archived people only, most recently archived first. */
export function listArchivedPeople(db: Db, orgId: string): Person[] {
  return db
    .prepare(`SELECT * FROM employee_people WHERE org_id = ? AND archived_at IS NOT NULL ORDER BY archived_at DESC`)
    .all(orgId) as Person[];
}

export function getPerson(db: Db, id: number): Person {
  const row = db.prepare(`SELECT * FROM employee_people WHERE id = ?`).get(vId(id, "person id")) as Person | undefined;
  if (!row) throw new Error(`Person ${id} not found`);
  return row;
}

export function createPerson(db: Db, orgId: string, input: PersonInput): Person {
  const p = clean(input);
  const at = nowIso();
  const res = db
    .prepare(
      `INSERT INTO employee_people (uuid, org_id, name, email, phone, role, default_rate, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(generateUUIDv7(), orgId, p.name, p.email, p.phone, p.role, p.defaultRate, p.notes, at);
  const person = getPerson(db, Number(res.lastInsertRowid));
  logEvent(db, orgId, { type: "person_added", employeeId: person.id, employeeName: person.name });
  return person;
}

/** Edits the person's details. A changed default_rate NEVER reaches a logged entry — every entry
    carries its own rate_at_entry, which is exactly why a raise cannot rewrite a closed period. */
export function updatePerson(db: Db, id: number, input: PersonInput): Person {
  const personId = vId(id, "person id");
  const p = clean(input);
  const res = db
    .prepare(
      `UPDATE employee_people
       SET name = ?, email = ?, phone = ?, role = ?, default_rate = ?, notes = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(p.name, p.email, p.phone, p.role, p.defaultRate, p.notes, nowIso(), personId);
  if (res.changes === 0) throw new Error(`Person ${personId} not found`);
  return getPerson(db, personId);
}

/** Soft archive. History stays queryable and any outstanding balance remains owed. */
export function archivePerson(db: Db, orgId: string, id: number, reason: string): Person {
  const person = getPerson(db, id);
  if (person.archived_at) return person;
  const at = nowIso();
  db.prepare(`UPDATE employee_people SET archived_at = ?, archive_reason = ?, updated_at = ? WHERE id = ?`).run(
    at,
    vString(reason, "reason", 500).trim() || null,
    at,
    person.id
  );
  logEvent(db, orgId, { type: "person_archived", employeeId: person.id, employeeName: person.name, detail: reason });
  return getPerson(db, person.id);
}

export function restorePerson(db: Db, orgId: string, id: number): Person {
  const person = getPerson(db, id);
  if (!person.archived_at) return person;
  db.prepare(`UPDATE employee_people SET archived_at = NULL, archive_reason = NULL, updated_at = ? WHERE id = ?`).run(
    nowIso(),
    person.id
  );
  logEvent(db, orgId, { type: "person_restored", employeeId: person.id, employeeName: person.name });
  return getPerson(db, person.id);
}
