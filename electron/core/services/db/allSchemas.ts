// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: ONE registry of every module schema in the SHARED org database, and one loop that
//              ensures them all. Exists because of a shipping bug proven 2026-08-06: an org minted
//              by the first-run wizard got only initDb's four shell tables — firstrun called no
//              ensure at all — so a user who opened TimeTracker before Employees hit
//              "no such table: employee_entries" on the project list, because LIST_SQL joins
//              Employees' tables while ttCtx ensures only TimeTracker's own.
//
//              THE RULE THIS FILE ENFORCES (Jason, 08-05-2026): a module's tables exist because an
//              org exists, never because someone opened a module. Called unconditionally at org
//              creation (firstrun/createOrgDatabase) and at every boot that has an org database.
//              The per-module lazy ensures stay as a harmless backstop — every ensure is
//              CREATE TABLE IF NOT EXISTS plus guarded ALTERs, so running twice costs nothing.
//
//              ADDING A MODULE: add its ensure to SHARED_SCHEMA_ENSURES. A module whose ensure is
//              missing here reintroduces the birth defect for every cross-module reader.
//
//              VAULT IS DELIBERATELY ABSENT: its schema lives in its OWN SQLCipher file behind a
//              derived key, so it can only be ensured where that connection is opened — firstrun,
//              boot, and vaultCtx all do so against the "vault" handle.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/db/allSchemas.ts
//------------------------------------------------------------
import type Database from "better-sqlite3-multiple-ciphers";
import { ensureScanSchema } from "../scan/db";
import { ensureScanNotesSchema } from "../scan/notesDb";
import { ensureRenameSchema } from "../rename/db";
import { ensureMigrateSchema } from "../migrate/db";
import { ensureTimeTrackerSchema } from "../timetracker/db";
import { ensureEmployeesSchema } from "../employees/db";

/** Every shared-DB module's ensure, in one place. Order is not load-bearing — none of the ensures
    reference another module's tables — but it mirrors the sidebar for readability. */
const SHARED_SCHEMA_ENSURES: ReadonlyArray<[name: string, ensure: (db: Database.Database) => void]> = [
  ["scan", ensureScanSchema],
  // Scan Notes ships its own ensure rather than growing scan/db.ts — same shared database, separate
  // feature, separate file. It reads nothing from the scan tables at CREATE time, so ordering beside
  // "scan" is for readability only.
  ["scan-notes", ensureScanNotesSchema],
  ["rename", ensureRenameSchema],
  ["migrate", ensureMigrateSchema],
  ["timetracker", ensureTimeTrackerSchema],
  ["employees", ensureEmployeesSchema],
];

/**
 * Ensures every module schema in the shared org database. Idempotent — safe at every boot and safe
 * to call twice. A failure names the module it died in rather than surfacing as a bare SQL error
 * three modules away.
 */
export function ensureAllModuleSchemas(db: Database.Database): void {
  for (const [name, ensure] of SHARED_SCHEMA_ENSURES) {
    try {
      ensure(db);
    } catch (e) {
      throw new Error(
        `Schema setup failed in the ${name} module: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }
}
