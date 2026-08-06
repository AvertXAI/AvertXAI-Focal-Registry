// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Employees IPC registration — thin employees:* handlers that resolve the active org
//              then call the Phase 1 services with (db, orgId, …). Mirrors timetracker/ipc.ts:
//              a module-local safeHandle (a cross-import of core/ipc.ts's would be circular) and a
//              one-shot lazy context. Input validation lives IN the services (employees/validate.ts
//              is their trust boundary), so the `unknown` args below are handed straight over and
//              every field is checked before it reaches SQL. No Electron-only concern needs to
//              live here yet — no dialog, no shell, no window — and none has been invented.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/employees/ipc.ts
//------------------------------------------------------------
import { BrowserWindow, ipcMain } from "electron";
import { getDb } from "../db";
import { getActiveOrg } from "../db/registry";
import { ensureEmployeesSchema, type Db } from "./db";
import * as people from "./people";
import * as entries from "./entries";
import * as tasks from "./tasks";
import * as payments from "./payments";
import * as adjustments from "./adjustments";
import * as reports from "./reports";
import * as sessions from "./sessions";
import { listEvents } from "./eventLog";
import type { EntryInput, PaymentInput, PersonInput, TaskInput } from "./types";
import type { AmountAdjustmentInput, HoursAdjustmentInput } from "./adjustments";

// Module-local copy of core/ipc.ts's resilient registrar (it is module-local there; a cross-import
// would make core/ipc.ts and this file circular). Same semantics: one failed registration never
// silently kills the rest, and the failure is logged LOUDLY with its channel name.
/**
 * THE CHANGE NOTIFICATION. Employee money and hours feed TimeTracker's project totals, its rail and
 * its charts — but nothing here used to tell anyone, so those surfaces kept whatever they read at
 * mount. Adding time to a person left the project card reading $0.00 until the module was
 * remounted, which looked like the write had failed.
 *
 * It reuses the EXISTING "timetracker:changed" channel rather than inventing a second one: every
 * listener that already invalidates on a timer mutation needs to invalidate on this for exactly the
 * same reason, and two channels meaning "re-read" is how one of them ends up half-wired.
 * Broadcast to every window so the mini timer and any future surface get it too.
 */
/** safeHandle for a WRITE: runs the handler, announces, and returns whatever it returned. Async
    results are awaited first so the notification never races ahead of the data. */
function mutHandle(channel: string, listener: (...a: never[]) => unknown): void {
  safeHandle(channel, (async (...args: never[]) => {
    const out = await (listener as (...a: never[]) => unknown)(...args);
    announceChanged();
    return out;
  }) as Parameters<typeof ipcMain.handle>[1]);
}

function announceChanged(): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send("timetracker:changed");
  }
}

function safeHandle(channel: string, listener: Parameters<typeof ipcMain.handle>[1]): void {
  try {
    ipcMain.handle(channel, listener);
  } catch (e) {
    console.error(`[ipc] FAILED to register handler '${channel}':`, e);
  }
}

let schemaReady = false;

/**
 * Lazy one-shot context (the scan/timetracker pattern). The schema call here is DEFENSIVE and
 * idempotent: boot runs ensureEmployeesSchema for an org that already existed, but an org minted by
 * the first-run wizard IN THIS SESSION never passes that point — without this, the first Employees
 * read after the wizard would hit a missing table until the app restarted.
 */
function empCtx(): { db: Db; orgId: string } {
  const org = getActiveOrg();
  if (!org) throw new Error("Employees: no active org");
  const db = getDb();
  if (!schemaReady) {
    ensureEmployeesSchema(db);
    schemaReady = true;
  }
  return { db, orgId: org.org_id };
}

export function registerEmployeesIpc(): void {
  // ---- people ----
  safeHandle("employees:listPeople", () => {
    const { db, orgId } = empCtx();
    return people.listPeople(db, orgId);
  });
  safeHandle("employees:listArchivedPeople", () => {
    const { db, orgId } = empCtx();
    return people.listArchivedPeople(db, orgId);
  });
  safeHandle("employees:getPerson", (_e, id: unknown) => people.getPerson(empCtx().db, id as number));
  mutHandle("employees:createPerson", (_e, input: unknown) => {
    const { db, orgId } = empCtx();
    return people.createPerson(db, orgId, input as PersonInput);
  });
  mutHandle("employees:updatePerson", (_e, id: unknown, input: unknown) =>
    people.updatePerson(empCtx().db, id as number, input as PersonInput)
  );
  mutHandle("employees:archivePerson", (_e, id: unknown, reason: unknown) => {
    const { db, orgId } = empCtx();
    return people.archivePerson(db, orgId, id as number, reason as string);
  });
  mutHandle("employees:restorePerson", (_e, id: unknown) => {
    const { db, orgId } = empCtx();
    return people.restorePerson(db, orgId, id as number);
  });

  // ---- entries (INSERT + read only — corrections are adjustments, by design) ----
  mutHandle("employees:createEntry", (_e, input: unknown) => {
    const { db, orgId } = empCtx();
    return entries.createEntry(db, orgId, input as EntryInput);
  });
  safeHandle("employees:listEntriesForPerson", (_e, employeeId: unknown) =>
    entries.listEntriesForPerson(empCtx().db, employeeId as number)
  );
  safeHandle("employees:listEntriesForProject", (_e, projectId: unknown) =>
    entries.listEntriesForProject(empCtx().db, projectId as number)
  );
  safeHandle("employees:listEntriesInRange", (_e, fromDate: unknown, toDate: unknown) => {
    const { db, orgId } = empCtx();
    return entries.listEntriesInRange(db, orgId, fromDate as string, toDate as string);
  });

  // ---- tasks ----
  // ---- the employee timer. No tick channel by design: elapsed time is renderer-computed from
  // ---- started_at, so a running session costs the main process nothing.
  safeHandle("employees:activeSessions", () => {
    const { db, orgId } = empCtx();
    return sessions.getActiveSessions(db, orgId);
  });
  mutHandle("employees:startSession", (_e, input: unknown) => {
    const { db, orgId } = empCtx();
    return sessions.startSession(db, orgId, input as Parameters<typeof sessions.startSession>[2]);
  });
  mutHandle("employees:stopSession", (_e, sessionId: unknown, note: unknown) => {
    const { db, orgId } = empCtx();
    return sessions.stopSession(db, orgId, sessionId as number, note);
  });
  mutHandle("employees:cancelSession", (_e, sessionId: unknown) => {
    return sessions.cancelSession(empCtx().db, sessionId as number);
  });

  safeHandle("employees:listTasks", () => {
    const { db, orgId } = empCtx();
    return tasks.listTasks(db, orgId);
  });
  safeHandle("employees:listTasksForPerson", (_e, employeeId: unknown) =>
    tasks.listTasksForPerson(empCtx().db, employeeId as number)
  );
  mutHandle("employees:createTask", (_e, input: unknown) => {
    const { db, orgId } = empCtx();
    return tasks.createTask(db, orgId, input as TaskInput);
  });
  mutHandle("employees:updateTask", (_e, id: unknown, input: unknown) =>
    tasks.updateTask(empCtx().db, id as number, input as TaskInput)
  );
  mutHandle("employees:assignTask", (_e, id: unknown, employeeId: unknown) => {
    const { db, orgId } = empCtx();
    return tasks.assignTask(db, orgId, id as number, (employeeId ?? null) as number | null);
  });
  mutHandle("employees:setTaskDone", (_e, id: unknown, done: unknown) => {
    const { db, orgId } = empCtx();
    return tasks.setTaskDone(db, orgId, id as number, done === true);
  });
  mutHandle("employees:removeTask", (_e, id: unknown) => {
    tasks.removeTask(empCtx().db, id as number); // SOFT delete — the row and its title survive
  });

  // ---- payments (append-only; there is no update or delete channel because there is no such path) ----
  safeHandle("employees:listPayments", (_e, employeeId: unknown) =>
    payments.listPayments(empCtx().db, employeeId as number)
  );
  safeHandle("employees:listPaymentsInRange", (_e, fromDate: unknown, toDate: unknown) => {
    const { db, orgId } = empCtx();
    return payments.listPaymentsInRange(db, orgId, fromDate as string, toDate as string);
  });
  mutHandle("employees:recordPayment", (_e, input: unknown) => {
    const { db, orgId } = empCtx();
    return payments.recordPayment(db, orgId, input as PaymentInput);
  });
  mutHandle("employees:reversePayment", (_e, uuid: unknown, note: unknown) => {
    const { db, orgId } = empCtx();
    return payments.reversePayment(db, orgId, uuid as string, (note ?? null) as string | null);
  });

  // ---- adjustments (never capped; hours and amount are separate operations) ----
  safeHandle("employees:listAdjustments", (_e, employeeId: unknown) =>
    adjustments.listAdjustments(empCtx().db, employeeId as number)
  );
  safeHandle("employees:listAllAdjustments", () => {
    const { db, orgId } = empCtx();
    return adjustments.listAllAdjustments(db, orgId);
  });
  mutHandle("employees:createHoursAdjustment", (_e, input: unknown) => {
    const { db, orgId } = empCtx();
    return adjustments.createHoursAdjustment(db, orgId, input as HoursAdjustmentInput);
  });
  mutHandle("employees:createAmountAdjustment", (_e, input: unknown) => {
    const { db, orgId } = empCtx();
    return adjustments.createAmountAdjustment(db, orgId, input as AmountAdjustmentInput);
  });
  mutHandle("employees:updateAdjustment", (_e, uuid: unknown, deltaValue: unknown, note: unknown) =>
    adjustments.updateAdjustment(empCtx().db, uuid as string, deltaValue as number, note as string)
  );
  mutHandle("employees:softDeleteAdjustment", (_e, uuid: unknown) => {
    const { db, orgId } = empCtx();
    adjustments.softDeleteAdjustment(db, orgId, uuid as string);
  });
  // Undoes a soft delete. Added 2026-08-04 with the Adjustments tab — the first surface that can
  // show a struck-through row, and therefore the first that needs a way back.
  mutHandle("employees:restoreAdjustment", (_e, uuid: unknown) => {
    const { db, orgId } = empCtx();
    return adjustments.restoreAdjustment(db, orgId, uuid as string);
  });

  // ---- derived reads (SELECT-only; the per-project cost seam stays UNWIRED to analytics) ----
  safeHandle("employees:costByProject", () => {
    const { db, orgId } = empCtx();
    return reports.employeeCostByProject(db, orgId);
  });
  safeHandle("employees:costForProject", (_e, projectId: unknown) => {
    const { db, orgId } = empCtx();
    return reports.employeeCostForProject(db, orgId, projectId as number);
  });
  safeHandle("employees:balance", (_e, employeeId: unknown) => reports.balanceFor(empCtx().db, employeeId as number));

  // ---- activity ----
  safeHandle("employees:listActivity", (_e, opts: unknown) => {
    const { db, orgId } = empCtx();
    const o = (opts ?? {}) as { limit?: number; employeeId?: number };
    return listEvents(db, orgId, o);
  });
}
