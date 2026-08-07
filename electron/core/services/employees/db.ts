// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Employees module schema — lives in the SHARED org database beside Scan, Rename,
//              Migrate and TimeTracker (one connection, cross-module SELECTs stay plain). Six
//              employee_-prefixed tables through the shared createTable() (std id/uuid/created_at/
//              updated_at), org_id on every table, and inline CHECK constraints carrying the canon
//              rulings that must never be wrong: pay type lives on the ENTRY, rate_at_entry is
//              mandatory, and the hours/amount adjustment split is enforced by the database, not by
//              a caller remembering. FRESH schema — no data import, no user_version ladder
//              (timetracker/db.ts precedent). Everything additive; any future column follows the
//              PRAGMA table_info guard pattern placed AFTER its createTable call, never before.
//              TAXPAYER IDENTIFIER — RULING CHANGED 2026-08-04. This file previously stated that no
//              taxpayer-identifier column existed here because canon put them in the Vault
//              (DECISIONS-51:451). Jason has ruled that superseded FOR EMPLOYEES: the social
//              security number is stored PLAIN, in this shared org database, in employee_people.ssn
//              below. The Vault is deliberately NOT involved. Logged in CANON-UPDATES.md
//              (2026-08-04). Consequence to know: the shared org database is unencrypted (canon
//              ruled encryption of it NOT PROCEEDING), so this value sits in plaintext on disk.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/employees/db.ts
//------------------------------------------------------------
import type Database from "better-sqlite3-multiple-ciphers";
import { createTable } from "../db";

export type Db = Database.Database;

/** ISO-8601 stamp for app-written domain timestamps. A deliberate local copy of TimeTracker's
    helper: the two modules share a DATABASE, never each other's service layer. */
export function nowIso(): string {
  return new Date().toISOString();
}

// Idempotent, additive, safe to re-run on every boot. Guard-only and versionless.
export function ensureEmployeesSchema(db: Db): void {
  // The person. Archived, NEVER hard-deleted: payroll history points at these rows forever.
  // default_rate is a PREFILL convenience only — the money of record is rate_at_entry on each
  // entry, which is why a raise here can never reach a closed period.
  createTable(db, "employee_people", [
    "org_id TEXT NOT NULL",
    "name TEXT NOT NULL",
    "email TEXT",
    "phone TEXT",
    "role TEXT", // free-text job title — presentation only, nothing branches on it
    "default_rate REAL CHECK (default_rate IS NULL OR default_rate >= 0)",
    "notes TEXT",
    "archived_at TEXT", // soft archive; NULL = active
    "archive_reason TEXT",
  ]);
  // Additive migration, guarded, AFTER its createTable (canon order — never before), following the
  // employee_tasks.deleted_at precedent below. SEVEN columns, ALL NULLABLE with no default: SQLite
  // cannot ADD COLUMN NOT NULL without one, and a default here would invent an address, a state or
  // a pay type for every person already on file. Every one of these is optional in the approved
  // form, so nullable is also the honest shape, not just the reachable one.
  //   default_project_id is a SOFT reference — no REFERENCES clause — for the same reason
  //   employee_entries.project_id carries none: an Employees row must survive a TimeTracker project
  //   purge. It resolves through a plain join (one database, one connection) and simply resolves to
  //   nothing if the project is gone. default_project_name rides beside it so the person's row stays
  //   readable afterwards, exactly as entries denormalize project_name.
  //   ssn is PLAIN TEXT by the 2026-08-04 ruling — see the header block.
  {
    const cols = (db.pragma("table_info(employee_people)") as { name: string }[]).map((c) => c.name);
    const add = (name: string, decl: string): void => {
      if (!cols.includes(name)) db.exec(`ALTER TABLE employee_people ADD COLUMN ${decl};`);
    };
    add("street_address", "street_address TEXT");
    add("city", "city TEXT");
    add("state", "state TEXT"); // 2-letter US code, validated in the service; NULL = unset
    add("zip", "zip TEXT"); // free text — postal codes are not numbers and lead with zeros
    add("ssn", "ssn TEXT"); // plain, ruled 2026-08-04; see the header block
    add("default_pay_type", "default_pay_type TEXT"); // PREFILL only — pay type still lives on the ENTRY
    add("default_project_id", "default_project_id INTEGER"); // soft reference, see above
    add("default_project_name", "default_project_name TEXT"); // denormalized beside the id
    // EMPLOYEE PROFILE (Jason ruled 08-06-2026, "same for employee"): only the two fields that had
    // no home and are needed to pay someone. Both nullable; employment_type is validated to
    // 'employee' | 'contractor' in the service (ALTER cannot add a CHECK). 1099 output is NOT
    // built on these — registered in CANON-UPDATES as future, not started.
    add("payment_method", "payment_method TEXT"); // free text — Zelle, Venmo, check payable-to
    add("employment_type", "employment_type TEXT"); // 'employee' | 'contractor', service-validated
  }

  // A unit of work — the payroll atom. THREE canon rulings are enforced here by CHECK:
  //   1. pay_type lives on the ENTRY, not the person (four types, hours recorded for every one).
  //   2. rate_at_entry is MANDATORY — a later raise must never rewrite a closed period, which is
  //      structural here: the services INSERT entries and never UPDATE them (corrections are
  //      adjustments, exactly as TimeTracker corrects time_entries).
  //   3. flat_amount exists for the per-job/per-task types only — "effective rate is amount ÷
  //      hours" is meaningless without an agreed amount, and meaningless FOR hourly/donated.
  // project_id carries NO foreign key — see the block comment above employee_event_log; an entry
  // is money owed to a person and must survive a TimeTracker project purge. project_name is
  // denormalized at write time so the row stays readable afterwards. task_id is soft for the same
  // reason (a tidied task list must never disturb a payroll record).
  createTable(db, "employee_entries", [
    "org_id TEXT NOT NULL",
    "employee_id INTEGER NOT NULL REFERENCES employee_people(id)",
    "project_id INTEGER", // soft reference by design — see above
    "project_name TEXT NOT NULL",
    "task_id INTEGER", // soft reference by design — see above
    "pay_type TEXT NOT NULL CHECK (pay_type IN ('hourly','job','task','donated'))",
    "hours_worked REAL NOT NULL DEFAULT 0 CHECK (hours_worked >= 0)",
    "rate_at_entry REAL NOT NULL CHECK (rate_at_entry >= 0)",
    "flat_amount REAL CHECK ((pay_type IN ('job','task') AND flat_amount IS NOT NULL AND flat_amount >= 0) OR (pay_type IN ('hourly','donated') AND flat_amount IS NULL))",
    "worked_on TEXT NOT NULL", // the date the work happened (payroll periods read this, not created_at)
    "note TEXT",
  ]);

  // Tasks are their OWN records: assignable with zero hours logged (employee_id nullable), and
  // carrying a done state because flat-per-task pay depends on one. Payment still happens through
  // an entry — a task is never itself a money row.
  createTable(db, "employee_tasks", [
    "org_id TEXT NOT NULL",
    "title TEXT NOT NULL",
    "detail TEXT",
    "employee_id INTEGER REFERENCES employee_people(id)", // NULL = unassigned, which is legal
    "project_id INTEGER", // soft reference, same doctrine as entries
    "project_name TEXT",
    "done_at TEXT", // NULL = open
  ]);
  // Additive migration, guarded, AFTER its createTable (canon order — never before). Tasks are
  // SOFT-deleted, mirroring employee_adjustments: a paid per-task entry stores task_id but not the
  // title, so hard-removing a task would strip the context off a payment record that still stands.
  if (!(db.pragma("table_info(employee_tasks)") as { name: string }[]).some((c) => c.name === "deleted_at")) {
    db.exec("ALTER TABLE employee_tasks ADD COLUMN deleted_at TEXT;");
  }

  // APPEND-ONLY payment ledger. Rows are INSERTed and never updated or deleted: a mistake is a
  // reversing row (negative amount + reverses_uuid pointing at the original's std uuid, the public
  // id per the adjustments doctrine). Outstanding balance is DERIVED (reports.balanceFor) and is
  // deliberately absent as a column — a stored balance is a second source of truth that drifts.
  createTable(db, "employee_payments", [
    "org_id TEXT NOT NULL",
    "employee_id INTEGER NOT NULL REFERENCES employee_people(id)",
    "amount REAL NOT NULL CHECK (amount <> 0)", // negative = a reversal
    "paid_on TEXT NOT NULL",
    "method TEXT",
    "reference TEXT", // free-text payment reference (cheque no., transfer id) — typed by the user
    "note TEXT",
    "reverses_uuid TEXT", // soft pointer to the reversed payment's uuid; NULL on an ordinary payment
  ]);

  // Corrections. HOURS and AMOUNT are different operations and the database says so: an hours
  // adjustment must name a project and carries its own mandatory rate_at_entry (so corrected hours
  // are valued at the rate in force WHEN THE CORRECTION IS MADE — never re-derived from a rate that
  // may since have changed); an amount adjustment needs no project and carries no rate. The
  // audit_log + soft-delete shape is lifted from timetracker_adjustments verbatim: history is
  // appended, never rewritten, and rows are never hard-removed.
  createTable(db, "employee_adjustments", [
    "org_id TEXT NOT NULL",
    "employee_id INTEGER NOT NULL REFERENCES employee_people(id)",
    "kind TEXT NOT NULL CHECK (kind IN ('hours','amount'))",
    "project_id INTEGER CHECK ((kind = 'hours' AND project_id IS NOT NULL) OR kind = 'amount')",
    "project_name TEXT",
    "delta_minutes INTEGER CHECK ((kind = 'hours' AND delta_minutes IS NOT NULL AND delta_minutes <> 0) OR (kind = 'amount' AND delta_minutes IS NULL))",
    "rate_at_entry REAL CHECK ((kind = 'hours' AND rate_at_entry IS NOT NULL AND rate_at_entry >= 0) OR (kind = 'amount' AND rate_at_entry IS NULL))",
    "delta_amount REAL CHECK ((kind = 'amount' AND delta_amount IS NOT NULL AND delta_amount <> 0) OR (kind = 'hours' AND delta_amount IS NULL))",
    "note TEXT NOT NULL",
    "deleted_at TEXT", // soft delete — rows are never hard-removed
    "audit_log TEXT NOT NULL", // append-only JSON array; history is never rewritten
  ]);
  // ENTRY-LINKED ADJUSTMENTS (ruled 08-06, "it took longer"): an adjustment can point at the entry
  // it corrects. Soft reference (no FK — same doctrine as every Employees↔TimeTracker link), and
  // NULLABLE: person-level and project-level corrections stay exactly as they were. The entry's
  // agreed rate and hours are NEVER rewritten — the adjustment is its own row; Net is derived.
  // Guard AFTER createTable, per the canon order — the harness caught the reversed order throwing
  // "no such table" on a FRESH database, exactly the trap FR-RULES names.
  if (!(db.pragma("table_info(employee_adjustments)") as { name: string }[]).some((c) => c.name === "entry_id")) {
    db.exec("ALTER TABLE employee_adjustments ADD COLUMN entry_id INTEGER;");
  }

  // OPEN WORK SESSIONS — the employee timer (3B.2-B). Deliberately THIN: this table holds only what
  // is needed to reconstruct an entry when the clock stops. It stores NO money and NO duration.
  //   · A row exists while the clock runs. On stop the service composes a normal employee_entries
  //     row through the EXISTING createEntry and stamps ended_at here. ONE money rule, ONE write
  //     path — this table never duplicates cost logic, so it can never disagree with the ledger.
  //   · rate_at_start and pay_type are captured AT START, not read back at stop: a raise mid-session
  //     must not retroactively reprice work already being done. Same doctrine as rate_at_entry.
  //   · ended_at is kept rather than the row deleted, so a stopped session is auditable and a
  //     crashed one is distinguishable from a finished one.
  // project_id/task_id are soft references, same doctrine as entries — see the block above.
  createTable(db, "employee_sessions", [
    "org_id TEXT NOT NULL",
    "employee_id INTEGER NOT NULL REFERENCES employee_people(id)",
    "project_id INTEGER NOT NULL", // soft reference; an entry needs a project, so a session does too
    "project_name TEXT NOT NULL", // denormalized at start, exactly as entries do
    "task_id INTEGER", // soft reference, nullable
    "pay_type TEXT NOT NULL CHECK (pay_type IN ('hourly','job','task','donated'))",
    "rate_at_start REAL NOT NULL CHECK (rate_at_start >= 0)",
    "note TEXT",
    "started_at TEXT NOT NULL",
    "ended_at TEXT", // NULL = running. Set on stop; the row is never deleted.
  ]);
  // ONE open session per person, enforced by the DATABASE rather than by a caller remembering.
  // A partial index over the running rows only: two stopped sessions for the same person are
  // normal and must stay legal, so the uniqueness applies WHERE ended_at IS NULL.
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS employee_sessions_one_open ON employee_sessions (employee_id) WHERE ended_at IS NULL;"
  );

  // DELIBERATE, mirroring timetracker_event_log: employee_id has NO foreign key. The event log is
  // append-only history that must SURVIVE whatever happens to the person or project it mentions —
  // a hard FK would cascade-delete it or block the operation. employee_name is denormalized at
  // write time so the log stays readable after a rename or archive. DO NOT "fix" this with an FK.
  createTable(db, "employee_event_log", [
    "org_id TEXT NOT NULL",
    "ts TEXT NOT NULL",
    "event_type TEXT NOT NULL CHECK (event_type IN ('person_added','person_archived','person_restored','entry_logged','task_created','task_assigned','task_done','task_reopened','payment_recorded','payment_reversed','adjusted','adjustment_removed'))",
    "employee_id INTEGER", // soft reference by design — see block comment above
    "employee_name TEXT NOT NULL",
    "detail TEXT",
  ]);

  // ---- indexes — one per hot query, IF NOT EXISTS so the ensure stays rerunnable.
  // per-person ledger: every Ledger/Payroll read filters by employee_id
  db.exec("CREATE INDEX IF NOT EXISTS idx_employee_entries_employee ON employee_entries (employee_id);");
  // THE ANALYTICS SEAM: employee cost per project groups by project_id
  db.exec("CREATE INDEX IF NOT EXISTS idx_employee_entries_project ON employee_entries (project_id);");
  // payroll periods + cash-basis reads filter on the work date, not created_at
  db.exec("CREATE INDEX IF NOT EXISTS idx_employee_entries_worked_on ON employee_entries (worked_on);");
  // task lists are per-person (the assigned view) and per-project
  db.exec("CREATE INDEX IF NOT EXISTS idx_employee_tasks_employee ON employee_tasks (employee_id);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_employee_tasks_project ON employee_tasks (project_id);");
  // balance derivation sums every payment for one person
  db.exec("CREATE INDEX IF NOT EXISTS idx_employee_payments_employee ON employee_payments (employee_id);");
  // adjustments list per person; the hours split also rolls up per project into the cost seam
  db.exec("CREATE INDEX IF NOT EXISTS idx_employee_adjustments_employee ON employee_adjustments (employee_id);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_employee_adjustments_project ON employee_adjustments (project_id);");
  // activity feed: newest-first whole log, and the per-person filter
  db.exec("CREATE INDEX IF NOT EXISTS idx_employee_event_log_ts ON employee_event_log (ts);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_employee_event_log_employee ON employee_event_log (employee_id);");
}
