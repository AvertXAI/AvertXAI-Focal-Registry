// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Vault IPC registration — thin vault:* handlers that resolve the active org and the
//              "vault" SQLCipher connection, then call the services with (db, orgId, …). Mirrors
//              employees/ipc.ts: a module-local safeHandle (a cross-import of core/ipc.ts's would be
//              circular) and a one-shot lazy context — async here, because obtaining the vault
//              connection derives the SQLCipher key. `caller` is STAMPED here as "renderer", never
//              accepted from the page: a self-reported caller would let any renderer code sign the
//              access log as someone else. Main-side consumers (Employees' taxpayer identifiers)
//              call the services directly with their own caller tag and never pass through IPC.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/vault/ipc.ts
//------------------------------------------------------------
import { BrowserWindow, app, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import { compactDb, openDb } from "../db";
import { getDevMode } from "../dataviewer";
import { getActiveOrg } from "../db/registry";
import { deriveVaultKey, getOrCreateVaultSecret } from "./crypto";
import { ensureVaultSchema, type Db } from "./db";
import * as secrets from "./store";
import * as lock from "./lock";
import * as folders from "./folders";
import * as breach from "./breach";
import * as vaultSettings from "./settings";
import * as seed from "./seed";
import * as transfer from "./transfer";
import * as notes from "./notes";
import * as noteFolders from "./noteFolders";
import * as infra from "./infra";
import * as repos from "./repos";
import { deriveSshArt } from "./sshart";
import { findVsCodeThemes, readVsCodeTheme } from "./codeThemes";
import fs from "node:fs";
import { FILE_FILTERS, exportDirFor, locateExports, statPickedFiles, walkForDocs } from "./sources";
import { clearAllEvents, clearRoutine, listEvents, logEvent, newRequestId, presentableMessage, type VaultLogLevel } from "./log";
import { analyseHealth } from "./health";
import { estimateStrength, generateBulk, generateMemorable, generatePassphrase, generatePassword, generatePin } from "./generator";
import type { VaultGeneratorOptions, VaultSecretInput } from "./types";

/**
 * Module-local copy of core/ipc.ts's resilient registrar (it is module-local there; a cross-import
 * would make core/ipc.ts and this file circular). Same semantics: one failed registration never
 * silently kills the rest, and the failure is logged LOUDLY with its channel name.
 *
 * IT IS ALSO THE ERROR BOUNDARY (Jason 08-11-2026). Every vault channel funnels its failures here,
 * which is why the translation lives in ONE place rather than in forty catch blocks:
 *   1. mint a reference id,
 *   2. write the technical truth to vault_event_log under that id,
 *   3. rethrow a message a PERSON can read, carrying the same id.
 * The renderer therefore cannot show a raw SQLITE_ code or a stack even by accident — it never
 * receives one. See log.ts for how a message is judged fit for a person.
 */
function safeHandle(channel: string, listener: Parameters<typeof ipcMain.handle>[1]): void {
  const guarded: Parameters<typeof ipcMain.handle>[1] = async (event, ...args) => {
    try {
      return await (listener as (...a: unknown[]) => unknown)(event, ...args);
    } catch (err) {
      const requestId = newRequestId();
      const ctx = lastCtx; // may be null when the failure IS the vault opening — logEvent copes
      logEvent(ctx?.db ?? null, ctx?.orgId ?? null, {
        level: "error",
        area: "ipc",
        channel,
        requestId,
        actor: RENDERER_CALLER,
        message: err instanceof Error ? err.message : String(err),
        detail: err instanceof Error ? err.stack ?? null : null,
      });
      throw new Error(presentableMessage(err, requestId));
    }
  };
  try {
    ipcMain.handle(channel, guarded);
  } catch (e) {
    console.error(`[ipc] FAILED to register handler '${channel}':`, e);
  }
}

/**
 * THE PARENT WINDOW FOR NATIVE DIALOGS, and it is not optional on Windows.
 *
 * An unparented common-file-dialog is owned by nothing, so the shell's preview pane and its
 * namespace extensions run with no window to pump their messages — which is how you get the
 * "(Not Responding)" title bar Jason hit on the Infrastructure import (08-11-2026) with no way out
 * but killing the app. Passing the requesting window also makes the dialog properly modal, so a
 * second one cannot be opened behind the first.
 */
function parentOf(event: { sender: Electron.WebContents }): Electron.BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow();
}

/** Every native OPEN in this file goes through here, so no future handler can forget the parent. */
function showOpen(
  event: { sender: Electron.WebContents },
  opts: Electron.OpenDialogOptions
): Promise<Electron.OpenDialogReturnValue> {
  const win = parentOf(event);
  // The unparented overload stays as the fallback ONLY for the case where the window has already
  // gone (a dialog asked for during teardown) — never as the normal path.
  return win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts);
}

/** Same rule for SAVE. */
function showSave(
  event: { sender: Electron.WebContents },
  opts: Electron.SaveDialogOptions
): Promise<Electron.SaveDialogReturnValue> {
  const win = parentOf(event);
  return win ? dialog.showSaveDialog(win, opts) : dialog.showSaveDialog(opts);
}

// Every access-log row born on this bridge says so. The page cannot claim to be anyone else.
const RENDERER_CALLER = "renderer";

/**
 * A note's title for the log line, read BEFORE it is destroyed. Never throws: a logging helper that
 * can fail the operation it was added to observe is a defect, and by the time this is wrong the note
 * is being deleted anyway — a record saying "(untitled)" beats no record and beats a crash.
 */
function titleOf(db: Db, orgId: string, uuid: unknown): string {
  try {
    const row = db.prepare("SELECT title FROM vault_notes WHERE org_id = ? AND uuid = ?").get(orgId, String(uuid)) as
      | { title?: string }
      | undefined;
    return row?.title?.trim() || "(untitled)";
  } catch {
    return "(untitled)";
  }
}

/** Same idea for a folder — read the name while the row still exists. Never throws. */
function folderNameOf(db: Db, orgId: string, id: unknown): string {
  try {
    const row = db.prepare("SELECT name FROM vault_note_folders WHERE org_id = ? AND id = ?").get(orgId, Number(id)) as
      | { name?: string }
      | undefined;
    return row?.name?.trim() || "(unnamed)";
  } catch {
    return "(unnamed)";
  }
}

/**
 * Lazy one-shot context (the scan/timetracker/employees pattern, async because the vault key is
 * derived). The PROMISE is cached, not the result, so two concurrent first calls cannot double-run
 * Argon2id; a failed init clears the cache so a transient failure isn't pinned for the session.
 * openDb is idempotent per registry key: when boot (main.ts) or the first-run wizard already opened
 * "vault", the same handle comes back and the path/key arguments are ignored — the derivation here
 * only ever matters on a path where nothing opened it, which is exactly the defensive case.
 * The schema call is DEFENSIVE and idempotent for the same reason ensureEmployeesSchema's is: boot
 * ensures the schema for an org that already existed, but an org minted by the first-run wizard IN
 * THIS SESSION never passes that point — without this, the first Vault ask after the wizard would
 * hit a missing table until the app restarted (the ttCtx lesson, applied from the start).
 */
let ctxPromise: Promise<{ db: Db; orgId: string }> | null = null;
/**
 * The RESOLVED context, kept synchronously reachable for one reason: safeHandle's catch runs in a
 * failure path and must not await anything to write a log row (awaiting the very context whose
 * derivation may be what just failed is how a logger deadlocks). Null until the vault has opened
 * once, which logEvent handles by falling back to the console.
 */
let lastCtx: { db: Db; orgId: string } | null = null;
function vaultCtx(): Promise<{ db: Db; orgId: string }> {
  if (ctxPromise) return ctxPromise;
  const org = getActiveOrg();
  if (!org) throw new Error("Vault: no active org");
  ctxPromise = (async () => {
    const key = await deriveVaultKey(getOrCreateVaultSecret(org.org_id));
    // <org_id>.atd — the dull name (ruled 08-02-2026); MUST stay byte-identical to the boot and
    // first-run call sites or this defensive open creates a SECOND database beside the real one.
    const db = openDb(path.join(app.getPath("userData"), `${org.org_id}.atd`), "vault", key);
    ensureVaultSchema(db);
    // [master-password-placeholder] — guarantees a verifier exists so the gate below can refuse.
    // Idempotent: an existing verifier is never overwritten, so a chosen password survives.
    lock.ensureMasterPassword(db, org.org_id);
    lastCtx = { db, orgId: org.org_id };
    logEvent(db, org.org_id, { level: "info", area: "vault", message: "Vault opened.", actor: "main" });
    return lastCtx;
  })().catch((e: unknown) => {
    ctxPromise = null;
    throw e;
  });
  return ctxPromise;
}

/**
 * [master-password-placeholder] — THE gate. Every channel that touches vault data calls this
 * first, so "locked" is one decision in one place rather than a check each handler could forget.
 * When the real gate lands, this is the function that starts refusing; nothing else moves.
 * The lock/unlock/state channels deliberately do NOT call it, or the vault could never be opened.
 */
async function gated(): Promise<{ db: Db; orgId: string }> {
  const ctx = await vaultCtx();
  if (!lock.isUnlocked(ctx.db, ctx.orgId)) throw new Error("The vault is locked.");
  lock.touch(); // idle clock measures USE, not wall time
  return ctx;
}

export function registerVaultIpc(): void {
  // ---- the lock (ungated, by necessity) ----
  safeHandle("vault:lockState", async () => {
    const { db, orgId } = await vaultCtx();
    return lock.lockState(db, orgId);
  });
  // Both outcomes are recorded INSIDE lock.unlock — see its comment; the handler must not add a
  // second row, and must not be the only thing standing between a failed attempt and the log.
  safeHandle("vault:unlock", async (_e, password: unknown) => {
    const { db, orgId } = await vaultCtx();
    return lock.unlock(db, orgId, password, RENDERER_CALLER).state;
  });
  safeHandle("vault:lock", async () => {
    const { db, orgId } = await vaultCtx();
    return lock.lock(db, orgId, RENDERER_CALLER);
  });
  safeHandle("vault:changeMasterPassword", async (_e, current: unknown, next: unknown) => {
    const { db, orgId } = await gated();
    lock.changeMasterPassword(db, orgId, current, next);
    secrets.logAccess(db, orgId, "password_change", null, null, RENDERER_CALLER, true);
    return lock.lockState(db, orgId);
  });
  // [master-password-placeholder] — DEV-MODE REVEAL (removed when the wizard's one-time change
  // ships). RECOMPUTES the derived initial from device identity on every call: it never reads the
  // stored verifier or lock state, so a changed password stays unknowable here. Ungated by the
  // lock — it lives ON the lock screen — and gated MAIN-SIDE on the existing developer mode, so a
  // forged call with dev mode off learns nothing. The value goes to the caller and nowhere else:
  // safeHandle logs failures only, and no success path writes it to any log.
  safeHandle("vault:devRevealInitial", async () => {
    if (!getDevMode()) throw new Error("Developer mode is required.");
    return lock.deriveInitialMasterPassword();
  });

  // ---- secrets ----
  safeHandle("vault:createSecret", async (_e, input: unknown) => {
    const { db, orgId } = await gated();
    return secrets.createSecret(db, orgId, RENDERER_CALLER, input as VaultSecretInput);
  });
  // METADATA ONLY — the one list channel; no credential can cross it (listSecrets never selects one).
  safeHandle("vault:listSecrets", async (_e, includeArchived: unknown) => {
    const { db, orgId } = await gated();
    return secrets.listSecrets(db, orgId, includeArchived === true);
  });
  // THE single value-bearing channel. The service logs the ask — hit or miss — before returning.
  safeHandle("vault:readSecret", async (_e, uuid: unknown) => {
    const { db, orgId } = await gated();
    return secrets.readSecret(db, orgId, RENDERER_CALLER, uuid);
  });
  safeHandle("vault:supersedeSecret", async (_e, uuid: unknown, value: unknown, extras: unknown) => {
    const { db, orgId } = await gated();
    return secrets.supersedeSecret(db, orgId, RENDERER_CALLER, uuid, value, extras);
  });
  safeHandle("vault:updateSecretMeta", async (_e, uuid: unknown, patch: unknown) => {
    const { db, orgId } = await gated();
    return secrets.updateSecretMeta(db, orgId, RENDERER_CALLER, uuid, patch);
  });
  safeHandle("vault:setFavourite", async (_e, uuid: unknown, on: unknown) => {
    const { db, orgId } = await gated();
    return secrets.setFavourite(db, orgId, uuid, on);
  });
  safeHandle("vault:archiveSecret", async (_e, uuid: unknown, reason: unknown) => {
    const { db, orgId } = await gated();
    return secrets.archiveSecret(db, orgId, RENDERER_CALLER, uuid, reason);
  });
  safeHandle("vault:restoreSecret", async (_e, uuid: unknown) => {
    const { db, orgId } = await gated();
    return secrets.restoreSecret(db, orgId, RENDERER_CALLER, uuid);
  });
  // Version NUMBERS and timestamps only — never a past value (see store.listVersions).
  safeHandle("vault:listVersions", async (_e, uuid: unknown) => {
    const { db, orgId } = await gated();
    return secrets.listVersions(db, orgId, uuid);
  });
  safeHandle("vault:listAccessLog", async (_e, opts: unknown) => {
    const { db, orgId } = await gated();
    return secrets.listAccessLog(db, orgId, (opts ?? {}) as { limit?: number; secretUuid?: string });
  });

  // ---- folders: containers only. Deleting one never deletes a secret (see folders.ts) ----
  safeHandle("vault:listFolders", async () => {
    const { db, orgId } = await gated();
    return folders.listFolders(db, orgId);
  });
  safeHandle("vault:createFolder", async (_e, name: unknown, parentId: unknown) => {
    const { db, orgId } = await gated();
    const made = folders.createFolder(db, orgId, name, parentId);
    secrets.logAccess(db, orgId, "folder_create", null, null, RENDERER_CALLER, true, made.name);
    return made;
  });
  safeHandle("vault:renameFolder", async (_e, id: unknown, name: unknown) => {
    const { db, orgId } = await gated();
    const row = folders.renameFolder(db, orgId, id, name);
    secrets.logAccess(db, orgId, "folder_rename", null, null, RENDERER_CALLER, true, row.name);
    return row;
  });
  safeHandle("vault:moveFolder", async (_e, id: unknown, parentId: unknown) => {
    const { db, orgId } = await gated();
    return folders.moveFolder(db, orgId, id, parentId);
  });
  safeHandle("vault:deleteFolder", async (_e, id: unknown) => {
    const { db, orgId } = await gated();
    const result = folders.deleteFolder(db, orgId, id);
    secrets.logAccess(
      db,
      orgId,
      "folder_delete",
      null,
      null,
      RENDERER_CALLER,
      true,
      `${result.movedSecrets} entries moved to Unfiled`
    );
    return result;
  });

  // ---- health: verdicts cross the bridge, never the values they came from ----
  safeHandle("vault:health", async () => {
    const { db, orgId } = await gated();
    const report = analyseHealth(db, orgId);
    secrets.logAccess(db, orgId, "health_scan", null, null, RENDERER_CALLER, true, `${report.total} entries analysed`);
    return report;
  });

  // ---- dark-web exposure. THE ONLY NETWORK CALLS IN THE VAULT, and both are off by default.
  // The password sweep is k-anonymous (nothing identifying leaves); the email check sends the
  // address, so it is one at a time and never swept. See breach.ts.
  safeHandle("vault:breachSweep", async () => {
    const { db, orgId } = await gated();
    return breach.sweepPasswords(db, orgId);
  });
  // Polled, not pushed — a push channel would mean joining the shell's whitelist in two root files,
  // which is outside this module's lane. The renderer reads this while a sweep runs.
  safeHandle("vault:breachProgress", () => breach.sweepStatus());
  safeHandle("vault:breachEmail", async (_e, email: unknown) => {
    const { db, orgId } = await gated();
    return breach.checkEmail(db, orgId, email);
  });

  // ---- generator: pure local computation, nothing stored, nothing logged per keystroke ----
  safeHandle("vault:generate", (_e, opts: unknown) => generatePassword((opts ?? {}) as Partial<VaultGeneratorOptions>));
  // The mockup's other five generator tabs. All pure local computation — nothing stored, nothing sent.
  safeHandle("vault:generatePassphrase", (_e, opts: unknown) => generatePassphrase((opts ?? {}) as never));
  safeHandle("vault:generateMemorable", (_e, length: unknown) => generateMemorable(Number(length) || 14));
  safeHandle("vault:generatePin", (_e, digits: unknown) => generatePin(Number(digits) || 6));
  safeHandle("vault:generateBulk", (_e, count: unknown, opts: unknown) =>
    generateBulk(Number(count) || 10, (opts ?? {}) as Partial<VaultGeneratorOptions>)
  );
  safeHandle("vault:strength", (_e, value: unknown) => estimateStrength(typeof value === "string" ? value : ""));

  // ---- the vault's OWN settings (canon: never the application's Settings page) ----
  safeHandle("vault:getSettings", async () => {
    const { db, orgId } = await gated();
    return vaultSettings.getAllSettings(db, orgId);
  });
  safeHandle("vault:setSetting", async (_e, key: unknown, value: unknown) => {
    const { db, orgId } = await gated();
    vaultSettings.setSetting(db, orgId, key, value);
    secrets.logAccess(db, orgId, "settings_change", null, null, RENDERER_CALLER, true, String(key));
    return vaultSettings.getAllSettings(db, orgId);
  });

  // ---- seed data (the Database card in vault settings) ----
  safeHandle("vault:seedStatus", async () => {
    const { db, orgId } = await gated();
    return seed.seedStatus(db, orgId);
  });
  safeHandle("vault:loadSeed", async () => {
    const { db, orgId } = await gated();
    return seed.loadSeed(db, orgId);
  });
  safeHandle("vault:purgeSeed", async () => {
    const { db, orgId } = await gated();
    return seed.purgeSeed(db, orgId);
  });

  // ---- import / export. THE BOUNDARY-CROSSING PAIR, and the reason these handlers look different
  // from every other one in this file: the renderer never names a path and never receives a value.
  // It asks for a dialog, the MAIN process gets a path from the operating system, the service reads
  // and writes MAIN-SIDE, and what comes back is a count. A password cannot ride this bridge in
  // either direction, which is the property that makes the reluctant export screen honest.
  // Finds the export file the user already wrote, so they do not have to remember where it landed.
  // Reads filenames and stat ONLY — never a browser profile, never file contents. See sources.ts.
  safeHandle("vault:findExports", async (_e, kind: unknown) => {
    await gated();
    return locateExports(typeof kind === "string" ? kind : "csv");
  });
  // Opens the folder in the system file browser — highlighting a specific file when one was found,
  // or just opening the folder otherwise. This is the "take me to where it lives" button; it never
  // reads anything, it only shows the user their own folder.
  safeHandle("vault:revealExportFolder", async (_e, kind: unknown, filePath: unknown) => {
    await gated();
    if (typeof filePath === "string" && filePath) {
      shell.showItemInFolder(filePath); // opens the folder with THIS file selected
      return true;
    }
    const dir = exportDirFor(typeof kind === "string" ? kind : "csv");
    if (dir) await shell.openPath(dir);
    return Boolean(dir);
  });
  safeHandle("vault:chooseImportFile", async (e, kind: unknown) => {
    const source = typeof kind === "string" ? kind : "csv";
    const archive = source === "archive";
    const r = await showOpen(e, {
      title: archive ? "Choose a vault archive" : "Choose the exported file",
      // Open IN the folder this exporter drops its file — no more hunting for Downloads.
      defaultPath: exportDirFor(source),
      properties: ["openFile"],
      filters: archive
        ? [{ name: "Vault archive", extensions: ["json", "avxvault"] }]
        : [{ name: "Exported passwords", extensions: ["csv", "txt"] }],
    });
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0];
  });
  // Reads the header row and five sample lines so the human can map the columns. WRITES NOTHING.
  safeHandle("vault:importPreview", async (_e, filePath: unknown) => {
    await gated();
    return transfer.importPreview(filePath);
  });
  safeHandle("vault:importCsv", async (_e, filePath: unknown, mapping: unknown) => {
    const { db, orgId } = await gated();
    return transfer.importCsv(db, orgId, RENDERER_CALLER, filePath, mapping);
  });
  safeHandle("vault:importArchive", async (_e, filePath: unknown, passphrase: unknown) => {
    const { db, orgId } = await gated();
    return transfer.importArchive(db, orgId, RENDERER_CALLER, filePath, passphrase);
  });
  // ---- Secured Notes. Bodies are content, not credentials — see notes.ts for why reads are
  // ---- not access-logged and why lists carry an excerpt, never the body.
  safeHandle("vault:listNotes", async (_e, kind: unknown, archived: unknown, folderId: unknown, limit: unknown, offset: unknown) => {
    const { db, orgId } = await gated();
    // folderId: undefined = every folder · null = Unfiled · number = that folder. The renderer used
    // to do this cut in JavaScript over every row; doing it here is the whole performance fix.
    const folder = folderId === null ? null : typeof folderId === "number" ? folderId : undefined;
    return notes.listNotes(
      db, orgId,
      typeof kind === "string" && kind ? kind : undefined,
      archived === true, folder,
      typeof limit === "number" ? limit : 60,
      typeof offset === "number" ? offset : 0
    );
  });
  /** Search titles and bodies main-side, capped. Replaces holding the whole corpus in the renderer. */
  safeHandle("vault:searchNotes", async (_e, q: unknown, limit: unknown) => {
    const { db, orgId } = await gated();
    return notes.searchNotes(db, orgId, q, typeof limit === "number" ? limit : 40);
  });
  safeHandle("vault:restoreNote", async (_e, uuid: unknown) => {
    const { db, orgId } = await gated();
    const r = notes.restoreNote(db, orgId, uuid);
    // Logged for the same reason archive is: a shelf move is only auditable if BOTH directions are
    // recorded. An archive with no matching restore reads as a note that never came back.
    logEvent(db, orgId, {
      level: "info", area: "notes", channel: "vault:restoreNote", actor: RENDERER_CALLER,
      message: `Restored from the archive: ${r.title}`,
    });
    return r;
  });
  // Hard delete — refused unless the note is already archived (see notes.destroyNote).
  //
  // EVERY DESTRUCTIVE NOTE OPERATION FROM HERE DOWN WRITES TO THE EVENT LOG (Jason 08-12-2026: "no
  // where is this being tracked as it should be. how do i know what the vaults secured notes deletion
  // is doing if it isnt tracked"). He was right and the gap was total — purgeNotes was the only note
  // path that logged anything, so the two operations that actually remove text logged nothing at all.
  //
  // The TITLE is read BEFORE the row goes, because after the delete there is nothing left to name it
  // with and "deleted note 0f3a-…" is not a record anybody can use. Levels are deliberate: a hard
  // delete is `warn` because it cannot be undone, an archive is `info` because it can.
  safeHandle("vault:destroyNote", async (_e, uuid: unknown) => {
    const { db, orgId } = await gated();
    const title = titleOf(db, orgId, uuid);
    notes.destroyNote(db, orgId, uuid);
    logEvent(db, orgId, {
      level: "warn", area: "notes", channel: "vault:destroyNote", actor: RENDERER_CALLER,
      message: `Deleted for good: ${title}`,
    });
    return { ok: true };
  });
  safeHandle("vault:getNote", async (_e, uuid: unknown) => {
    const { db, orgId } = await gated();
    return notes.getNote(db, orgId, uuid);
  });
  safeHandle("vault:createNote", async (_e, input: unknown) => {
    const { db, orgId } = await gated();
    return notes.createNote(db, orgId, (input ?? {}) as never);
  });
  safeHandle("vault:updateNote", async (_e, uuid: unknown, patch: unknown) => {
    const { db, orgId } = await gated();
    return notes.updateNote(db, orgId, uuid, (patch ?? {}) as never);
  });
  safeHandle("vault:archiveNote", async (_e, uuid: unknown) => {
    const { db, orgId } = await gated();
    const title = titleOf(db, orgId, uuid);
    notes.archiveNote(db, orgId, uuid);
    logEvent(db, orgId, {
      level: "info", area: "notes", channel: "vault:archiveNote", actor: RENDERER_CALLER,
      message: `Archived: ${title}`,
    });
    return { ok: true };
  });

  // ---- Secured Notes folder tree (Jason ruled the shape 08-11-2026: separate tree, one folder
  // ---- per note, shared by Notes/Runbooks/Snippets). A container is not its contents — deleting a
  // ---- folder never deletes a note; see noteFolders.ts.
  safeHandle("vault:listNoteFolders", async () => {
    const { db, orgId } = await gated();
    return {
      folders: noteFolders.listNoteFolders(db, orgId),
      counts: noteFolders.noteFolderCounts(db, orgId),
      unfiled: noteFolders.unfiledNoteCount(db, orgId),
    };
  });
  safeHandle("vault:createNoteFolder", async (_e, name: unknown, parentId: unknown) => {
    const { db, orgId } = await gated();
    return noteFolders.createNoteFolder(db, orgId, name, parentId);
  });
  safeHandle("vault:renameNoteFolder", async (_e, id: unknown, name: unknown) => {
    const { db, orgId } = await gated();
    return noteFolders.renameNoteFolder(db, orgId, id, name);
  });
  safeHandle("vault:moveNoteFolder", async (_e, id: unknown, parentId: unknown) => {
    const { db, orgId } = await gated();
    return noteFolders.moveNoteFolder(db, orgId, id, parentId);
  });
  /** What a delete WOULD take. Pure — the confirm is built from this. */
  safeHandle("vault:noteFolderSubtree", async (_e, id: unknown) => {
    const { db, orgId } = await gated();
    return noteFolders.noteFolderSubtree(db, orgId, id);
  });
  /** Keeps every note, unfiles the whole subtree, leaves the folders standing. */
  safeHandle("vault:emptyNoteFolder", async (_e, id: unknown) => {
    const { db, orgId } = await gated();
    const name = folderNameOf(db, orgId, id);
    const r = noteFolders.emptyNoteFolder(db, orgId, id);
    logEvent(db, orgId, {
      level: "info", area: "notes", channel: "vault:emptyNoteFolder", actor: RENDERER_CALLER,
      message: `Emptied folder "${name}" — ${r.movedNotes} note${r.movedNotes === 1 ? "" : "s"} moved to Unfiled, nothing deleted`,
    });
    return r;
  });
  /**
   * Deletes the folder, every folder beneath it, and every note in any of them.
   *
   * WARN, not info: this is the one note path with no way back, and the log is the only place the
   * count survives after the confirm dialog closes.
   */
  safeHandle("vault:deleteNoteFolder", async (_e, id: unknown) => {
    const { db, orgId } = await gated();
    const name = folderNameOf(db, orgId, id);
    const r = noteFolders.deleteNoteFolder(db, orgId, id);
    logEvent(db, orgId, {
      level: "warn", area: "notes", channel: "vault:deleteNoteFolder", actor: RENDERER_CALLER,
      message: `Deleted folder "${name}" — ${r.deletedNotes} note${r.deletedNotes === 1 ? "" : "s"} and ${r.deletedFolders} folder${r.deletedFolders === 1 ? "" : "s"} erased`,
      detail: "Permanent. The notes were not archived.",
    });
    return r;
  });
  /** The third door: every note to the Archived shelf, the folders removed. Restorable. */
  safeHandle("vault:archiveNoteFolder", async (_e, id: unknown) => {
    const { db, orgId } = await gated();
    const name = folderNameOf(db, orgId, id);
    const r = noteFolders.archiveNoteFolder(db, orgId, id);
    logEvent(db, orgId, {
      level: "info", area: "notes", channel: "vault:archiveNoteFolder", actor: RENDERER_CALLER,
      message: `Archived folder "${name}" — ${r.archivedNotes} note${r.archivedNotes === 1 ? "" : "s"} moved to the Archived shelf, ${r.deletedFolders} folder${r.deletedFolders === 1 ? "" : "s"} removed`,
    });
    return r;
  });
  /** Clear every note and folder. Confirm-gated in the UI; the count is said out loud first. */
  safeHandle("vault:purgeNotes", async () => {
    const { db, orgId } = await gated();
    const r = notes.purgeAllNotes(db, orgId);
    secrets.logAccess(db, orgId, "purge", null, null, RENDERER_CALLER, true, `notes · ${r.notes} deleted, ${r.folders} folders`);
    logEvent(db, orgId, {
      level: "warn", area: "notes", channel: "vault:purgeNotes", actor: RENDERER_CALLER,
      message: `Purged ${r.notes} notes and ${r.folders} folders`,
    });
    return r;
  });
  safeHandle("vault:setNoteFolder", async (_e, uuid: unknown, folderId: unknown) => {
    const { db, orgId } = await gated();
    const title = titleOf(db, orgId, uuid);
    noteFolders.setNoteFolder(db, orgId, uuid, folderId);
    // A move is not destructive, but it is the operation most likely to be reported as "my note
    // disappeared" — so where it went is worth a line.
    logEvent(db, orgId, {
      level: "info", area: "notes", channel: "vault:setNoteFolder", actor: RENDERER_CALLER,
      message: `Filed "${title}" into ${folderId == null || folderId === "" ? "Unfiled" : `"${folderNameOf(db, orgId, folderId)}"`}`,
    });
    return { ok: true };
  });
  /** Pure — what folders an import WOULD create. Writes nothing; drives the preview. */
  safeHandle("vault:previewFolderPaths", async (_e, rels: unknown) => {
    await gated();
    return noteFolders.previewFolderPaths(rels);
  });

  // ---- Folder import, one per tab. Choose folders → walk for .md/.txt/.pdf → review → import.
  // The dialog is main-side and multi-select; the renderer never names a path it was not given.
  safeHandle("vault:chooseFolders", async (e) => {
    const r = await showOpen(e, {
      title: "Choose one or more folders",
      properties: ["openDirectory", "multiSelections"],
    });
    return r.canceled ? [] : r.filePaths;
  });
  // FILES, which is what Infrastructure actually imports — a zone export or a spreadsheet you just
  // downloaded, not a directory of them. Filters are per target; see FILE_FILTERS.
  safeHandle("vault:chooseFiles", async (e, target: unknown) => {
    const key = typeof target === "string" && FILE_FILTERS[target] ? target : "notes";
    const r = await showOpen(e, {
      title: "Choose one or more files",
      properties: ["openFile", "multiSelections"],
      filters: FILE_FILTERS[key],
    });
    return r.canceled ? [] : r.filePaths;
  });
  /**
   * Read a chosen file's TEXT so the renderer can run it through a parser and show a review table
   * before anything is written (Jason 08-11-2026 — imports are destination-first now).
   *
   * WHY THIS IS SAFE TO HAND THE RENDERER when importDocs deliberately reads main-side: this returns
   * the contents of a file the USER just picked in a native dialog, and it is text they are about to
   * be shown on screen anyway. It is not a credential, and no path is accepted that the renderer
   * invented — see the guard. Capped so a mispicked 2 GB file cannot take the window down.
   */
  safeHandle("vault:readImportText", async (_e, filePath: unknown) => {
    await gated();
    const p = typeof filePath === "string" ? filePath : "";
    if (!p) throw new Error("No file was chosen.");
    const stat = fs.statSync(p);
    const MAX = 8 * 1024 * 1024;
    if (stat.size > MAX) throw new Error("That file is too large to read here — it is over 8 megabytes.");
    return fs.readFileSync(p, "utf8");
  });
  // Pure parse of a host inventory — writes NOTHING. The review table is built from this.
  safeHandle("vault:parseServers", async (_e, text: unknown) => {
    await gated();
    return infra.parseServers(text);
  });
  safeHandle("vault:importServers", async (_e, servers: unknown) => {
    const { db, orgId } = await gated();
    const r = infra.importServers(db, orgId, servers);
    secrets.logAccess(db, orgId, "import", null, null, RENDERER_CALLER, true, `servers · ${r.imported} imported`);
    return r;
  });
  /** Stat hand-picked files. No extension filtering — the dialog narrowed it and the user chose. */
  safeHandle("vault:statFiles", async (_e, paths: unknown) => {
    await gated();
    return statPickedFiles(paths);
  });
  // Names and stat only — WRITES NOTHING, reads no file contents. The review list comes from this.
  safeHandle("vault:walkFolders", async (_e, roots: unknown) => {
    const { db, orgId } = await gated();
    // The ceiling is a SETTING (Jason 08-11-2026 — the old hardcoded 2,000 refused a real import).
    const cap = vaultSettings.getNumber(db, orgId, "import.max_files");
    return walkForDocs(roots, Number.isFinite(cap) && cap > 0 ? cap : undefined);
  });
  // THE write. Reads each chosen file main-side (a .pdf is stored as a stub note pending a text
  // extractor — flagged in the body rather than pretending it imported clean).
  safeHandle("vault:importDocs", async (_e, files: unknown, opts: unknown) => {
    const { db, orgId } = await gated();
    const list = Array.isArray(files) ? files : [];
    const loaded = list.map((f) => {
      const rec = f as { path?: unknown; name?: unknown; rel?: unknown; ext?: unknown; birthtimeMs?: unknown; mtimeMs?: unknown };
      const p = typeof rec?.path === "string" ? rec.path : "";
      const ext = typeof rec?.ext === "string" ? rec.ext : "";
      let text = "";
      if (ext === ".pdf") {
        text = `> This PDF was imported as a placeholder — the vault has no PDF text extractor yet.\n>\n> File: ${p}\n`;
      } else if (ext === ".xlsx" || ext === ".xls" || ext === ".xlsm") {
        // A spreadsheet needs a parser this product does not carry, and adding one is a dependency
        // decision (§2.10), not a quiet import. Say so in the note rather than storing binary noise.
        text = `> This spreadsheet was imported as a placeholder — the vault has no spreadsheet reader.\n>\n> Export it as CSV and import that for the real contents.\n>\n> File: ${p}\n`;
      } else if (ext === ".doc" || ext === ".docx") {
        // .doc is a binary OLE container and .docx is zipped XML — neither is readable without a
        // parser. Same rule as the spreadsheets: say so, keep the row, never store binary noise.
        text = `> This Word document was imported as a placeholder — the vault has no Word reader.\n>\n> Save it as Markdown or plain text and import that for the real contents.\n>\n> File: ${p}\n`;
      } else if (ext === ".jsonl") {
        // LINE-delimited JSON: each line is its own document. Pretty-printing would destroy the one
        // property that defines the format, so it is kept verbatim in a fence.
        try { text = "```jsonl\n" + fs.readFileSync(p, "utf8").slice(0, 200_000) + "\n```\n"; } catch { text = ""; }
      } else if (ext === ".json") {
        // Pretty-print so a dumped config is readable as a note instead of one enormous line.
        try {
          const rawText = fs.readFileSync(p, "utf8");
          text = "```json\n" + JSON.stringify(JSON.parse(rawText), null, 2).slice(0, 200_000) + "\n```\n";
        } catch { try { text = "```\n" + fs.readFileSync(p, "utf8") + "\n```\n"; } catch { text = ""; } }
      } else if (ext === ".csv" || ext === ".zone") {
        // Kept verbatim in a fence — a zone file or CSV is exact text, and reflowing it as prose
        // would destroy the alignment that makes it readable.
        try { text = "```\n" + fs.readFileSync(p, "utf8").slice(0, 200_000) + "\n```\n"; } catch { text = ""; }
      } else {
        try { text = fs.readFileSync(p, "utf8"); } catch { text = ""; }
      }
      // `path` now travels too — it is what the duplicate guard matches on. It never reaches the
      // renderer; this object is built main-side and consumed main-side.
      return { name: rec?.name, rel: rec?.rel, path: p, text, birthtimeMs: rec?.birthtimeMs, mtimeMs: rec?.mtimeMs };
    });
    const r = notes.importDocs(db, orgId, loaded, (opts ?? {}) as never);
    secrets.logAccess(db, orgId, "import", null, null, RENDERER_CALLER, true, `documents · ${r.created} created, ${r.warned} warned`);
    // THE FULL ARITHMETIC, in the log, where it can be checked after the modal is gone. This is the
    // line that answers "the import said 2,083 and the folder says 2,078" without anyone having to
    // reproduce the import to see the numbers again.
    logEvent(db, orgId, {
      level: "info", area: "import", channel: "vault:importDocs", actor: RENDERER_CALLER,
      message: `Imported ${r.created} of ${r.scanned} files — ${r.skipped} already in the vault, ${r.failed} could not be stored`,
      detail: [
        `Already here: ${r.skippedFiled} filed, ${r.skippedUnfiled} unfiled, ${r.skippedArchived} archived.`,
        r.warned > 0 ? `${r.warned} had unreadable frontmatter and were imported anyway.` : null,
      ].filter(Boolean).join(" "),
    });
    return r;
  });

  // ---- Infrastructure. Rows point at credentials by locator and never contain one.
  safeHandle("vault:listServers", async () => {
    const { db, orgId } = await gated();
    return infra.listServers(db, orgId);
  });
  safeHandle("vault:saveServer", async (_e, input: unknown) => {
    const { db, orgId } = await gated();
    return infra.saveServer(db, orgId, (input ?? {}) as never);
  });
  safeHandle("vault:deleteServer", async (_e, uuid: unknown) => {
    const { db, orgId } = await gated();
    infra.deleteServer(db, orgId, uuid);
    return { ok: true };
  });
  safeHandle("vault:listDns", async (_e, domain: unknown) => {
    const { db, orgId } = await gated();
    return infra.listDns(db, orgId, typeof domain === "string" && domain ? domain : undefined);
  });
  safeHandle("vault:saveDnsRecord", async (_e, input: unknown) => {
    const { db, orgId } = await gated();
    return infra.saveDnsRecord(db, orgId, (input ?? {}) as never);
  });
  safeHandle("vault:deleteDnsRecord", async (_e, uuid: unknown) => {
    const { db, orgId } = await gated();
    infra.deleteDnsRecord(db, orgId, uuid);
    return { ok: true };
  });
  // Pure parse — WRITES NOTHING; the human approves and importZone writes. The exact-format path.
  safeHandle("vault:parseZone", async (_e, text: unknown) => {
    await gated();
    return infra.parseZone(text);
  });
  safeHandle("vault:importZone", async (_e, domain: unknown, records: unknown) => {
    const { db, orgId } = await gated();
    const r = infra.importZone(db, orgId, domain, records);
    secrets.logAccess(db, orgId, "import", null, null, RENDERER_CALLER, true, `zone · ${r.imported} records for ${String(domain)}`);
    return r;
  });
  // Fingerprint + randomart, DERIVED from the public key on every call and never stored. No reveal
  // involved — the public key is metadata (it is designed to be handed out).
  safeHandle("vault:sshArt", async (_e, uuid: unknown) => {
    const { db, orgId } = await gated();
    const meta = secrets.listSecrets(db, orgId, true).find((s) => s.uuid === uuid);
    return deriveSshArt(meta?.public_key ?? "");
  });

  // ---- Repos + the package ledger.
  safeHandle("vault:listRepos", async () => {
    const { db, orgId } = await gated();
    return repos.listRepos(db, orgId);
  });
  safeHandle("vault:saveRepo", async (_e, input: unknown) => {
    const { db, orgId } = await gated();
    return repos.saveRepo(db, orgId, (input ?? {}) as never);
  });
  safeHandle("vault:deleteRepo", async (_e, uuid: unknown) => {
    const { db, orgId } = await gated();
    repos.deleteRepo(db, orgId, uuid);
    return { ok: true };
  });
  /** Pick ONE folder to scan for clones — D:\dev or wherever the user keeps them. */
  safeHandle("vault:chooseScanRoot", async (e) => {
    const r = await showOpen(e, { title: "Choose the folder your repositories live in", properties: ["openDirectory"] });
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0];
  });
  // Filesystem only — reads .git/config for the remote. NO NETWORK; see repos.ts.
  safeHandle("vault:scanLocalRepos", async (_e, root: unknown) => {
    await gated();
    return repos.scanLocalRepos(root);
  });
  safeHandle("vault:importLocalRepos", async (_e, found: unknown) => {
    const { db, orgId } = await gated();
    const r = repos.importLocalRepos(db, orgId, found);
    secrets.logAccess(db, orgId, "import", null, null, RENDERER_CALLER, true, `local repos · ${r.added} added, ${r.updated} updated`);
    return r;
  });
  // Live reading of the installed tree — main-side fs, nothing stored, nothing sent anywhere.
  safeHandle("vault:scanPackages", async () => {
    await gated();
    return repos.scanPackages(app.getAppPath());
  });

  safeHandle("vault:exportVault", async (e, kind: unknown, passphrase: unknown) => {
    const { db, orgId } = await gated();
    const archive = kind === "archive";
    const r = await showSave(e, {
      title: archive ? "Save the encrypted archive" : "Save the plain CSV",
      defaultPath: archive ? "vault-archive.json" : "vault-export.csv",
      filters: archive
        ? [{ name: "Vault archive", extensions: ["json"] }]
        : [{ name: "Comma separated values", extensions: ["csv"] }],
    });
    // A cancelled dialog is NOT an error and must not be logged as an export — nothing left.
    if (r.canceled || !r.filePath) return null;
    return archive
      ? transfer.exportArchive(db, orgId, RENDERER_CALLER, r.filePath, passphrase)
      : transfer.exportCsv(db, orgId, RENDERER_CALLER, r.filePath);
  });

  /**
   * COMPACT THE VAULT — the on-demand half of the space story (Jason 08-12-2026 asked for both, and
   * the measurement decided the split: auto is incremental and free, this is the full rebuild).
   * Also upgrades a legacy file to incremental auto-vacuum, so it only ever needs pressing once
   * before deletes start maintaining themselves.
   */
  safeHandle("vault:compact", async () => {
    const { db, orgId } = await gated();
    const file = path.join(app.getPath("userData"), `${orgId}.atd`);
    const r = compactDb(db, file);
    // STAMP IT HERE TOO. Only the scheduled path recorded this, so pressing the button by hand left
    // the panel reading "Never compacted yet" immediately after a successful compact (Jason
    // 08-12-2026). It also starts the schedule clock, which is what makes the backstop meaningful.
    vaultSettings.setInternal(db, orgId, "maintenance.compact_last", String(Date.now()));
    logEvent(db, orgId, {
      level: "info", area: "vault", channel: "vault:compact", actor: RENDERER_CALLER,
      message: `Vault compacted — ${Math.round(r.freed / 1048576)} MB reclaimed`,
      detail: `before ${r.before} bytes, after ${r.after} bytes`,
    });
    return r;
  });

  /**
   * PRESSURE-TRIGGERED COMPACTION (Jason 08-12-2026, and his framing is the right one: "like ai
   * model inferences in chat, when the context window gets to a certain limit the chat performs a
   * compact… not just firing like an idiot, but calculated").
   *
   * THE FIRST VERSION HAD THE GATES BACKWARDS. It asked "is it Tuesday?" before "is the file
   * bloated?", so a vault carrying 60 MB of dead pages would sit there for a week because the
   * calendar said no. Pressure leads now; the schedule is only a backstop for slow accumulation
   * that never trips a threshold.
   *
   * WHAT IT MEASURES: `freelist_count * page_size` is the dead space, free to read and exact. Two
   * ways to qualify, because a big vault and a small one are bloated at very different absolute
   * numbers:
   *   · ABSOLUTE — enough dead space that a rewrite plainly pays for itself.
   *   · PROPORTIONAL — a quarter of the file is dead, even if that is only a few megabytes.
   * Plus Jason's "close is close enough" band: within 80% of either bar, take it now rather than
   * come back in an hour to do the same work. No harm, no foul.
   *
   * A COOLDOWN stops any chance of thrash: whatever else is true, never twice inside ten minutes.
   *
   * `dry` returns the arithmetic WITHOUT compacting, so Settings can show where the vault stands
   * instead of the decision being invisible.
   */
  safeHandle("vault:compactIfDue", async (_e, dry: unknown) => {
    const { db, orgId } = await gated();
    const every = vaultSettings.getSetting(db, orgId, "maintenance.compact_every");
    const file = path.join(app.getPath("userData"), `${orgId}.atd`);

    const pageSize = (db.pragma("page_size") as { page_size: number }[])[0]?.page_size ?? 4096;
    const freePages = (db.pragma("freelist_count") as { freelist_count: number }[])[0]?.freelist_count ?? 0;
    const reclaimable = freePages * pageSize;
    let fileBytes = 0;
    try { fileBytes = fs.statSync(file).size; } catch { fileBytes = 0; }
    const ratio = fileBytes > 0 ? reclaimable / fileBytes : 0;

    const absBar = Math.max(1, vaultSettings.getNumber(db, orgId, "maintenance.compact_min_mb")) * 1048576;
    const last = Number(vaultSettings.getInternal(db, orgId, "maintenance.compact_last") ?? 0);
    const now = Date.now();
    // THE DECISION IS A PURE FUNCTION — see compactDecision in settings.ts, and notes-proof for the
    // cases it is held to. This handler only gathers the numbers and acts on the verdict.
    const v = vaultSettings.compactDecision({
      every, reclaimable, fileBytes, absoluteBar: absBar,
      sinceLastMs: last ? now - last : null,
    });

    const status = {
      fileBytes, reclaimable, ratio: v.ratio,
      absoluteBar: absBar, ratioBar: vaultSettings.COMPACT_RATIO_BAR,
      hitsAbsolute: v.hitsAbsolute, hitsRatio: v.hitsRatio, hitsSchedule: v.hitsSchedule,
      every, lastCompactedMs: last || null,
    };

    if (dry === true) return { ran: false, reason: "dry" as const, freed: 0, ...status };
    if (!v.compact) return { ran: false, reason: v.reason, freed: 0, ...status };

    const why = v.why;
    const r = compactDb(db, file);
    vaultSettings.setInternal(db, orgId, "maintenance.compact_last", String(now));
    logEvent(db, orgId, {
      level: "info", area: "vault", channel: "vault:compactIfDue", actor: "main",
      message: `Compacted on ${why} pressure — ${Math.round(r.freed / 1048576)} MB reclaimed`,
      detail: `reclaimable ${reclaimable} of ${fileBytes} (${Math.round(ratio * 100)}%), before ${r.before}, after ${r.after}`,
    });
    return { ran: true, reason: "compacted" as const, why, ...r, ...status };
  });

  // ---- The event log. Reading it is DELIBERATELY ungated: the log is where you look when the
  // ---- vault will not open, and a log you can only read once the thing works is not a log.
  // ---- It holds no secret values by construction (see db.ts and log.ts), so there is nothing
  // ---- here for the gate to protect.
  safeHandle("vault:listEvents", async (_e, opts: unknown) => {
    const { db, orgId } = await vaultCtx();
    const o = (opts ?? {}) as { limit?: number; level?: string; search?: string };
    const level = typeof o.level === "string" && ["debug", "info", "warn", "error"].includes(o.level)
      ? (o.level as VaultLogLevel)
      : undefined;
    return listEvents(db, orgId, { limit: o.limit, level, search: typeof o.search === "string" ? o.search : undefined });
  });
  /** Clears info and debug only — errors and warnings are evidence and are never removed here. */
  safeHandle("vault:clearLog", async () => {
    const { db, orgId } = await gated();
    const r = clearRoutine(db, orgId);
    logEvent(db, orgId, {
      level: "info", area: "vault", channel: "vault:clearLog", actor: RENDERER_CALLER,
      message: `Cleared ${r.removed} routine log entries — errors and warnings kept.`,
    });
    return r;
  });

  /**
   * THE DEVELOPER'S CLEAR — errors and warnings included (Jason 08-12-2026: "i need to be able to
   * delete the errors and warnings for testing"). Confirm-gated by a typed word in the renderer.
   *
   * The replacement line is written AFTER the delete, on purpose: an empty log that cannot account
   * for its own emptiness is indistinguishable from one that was never written to.
   */
  /**
   * The Visual Studio Code themes installed on this machine, and the raw text of one.
   *
   * NOT GATED ON THE VAULT LOCK, and that is deliberate: neither call touches the vault database or
   * any secret. They read a public extensions folder, which is the same class of thing as asking the
   * operating system for a font list. Putting them behind `gated()` would mean the settings page
   * could not show you a theme preview until you had unlocked, for no security gained.
   */
  safeHandle("vault:findCodeThemes", async () => findVsCodeThemes());
  safeHandle("vault:readCodeTheme", async (_e, file: unknown) => readVsCodeTheme(file));

  safeHandle("vault:clearAllLog", async () => {
    const { db, orgId } = await gated();
    const r = clearAllEvents(db, orgId);
    logEvent(db, orgId, {
      level: "warn", area: "vault", channel: "vault:clearAllLog", actor: RENDERER_CALLER,
      message: `Log emptied by hand — ${r.removed} entries removed, errors and warnings included.`,
      detail: "Developer action. Everything before this line is gone.",
    });
    return r;
  });

  /**
   * THE RENDERER'S OWN FAILURES. A crash in a React surface never reaches safeHandle — it happens
   * on the other side of the bridge — so without this channel the log would record only main-side
   * problems and quietly imply the renderer never breaks. Level is CLAMPED and the actor is stamped
   * here, never accepted from the page.
   */
  safeHandle("vault:logClient", async (_e, level: unknown, message: unknown, detail: unknown) => {
    const ctx = lastCtx;
    const lvl = typeof level === "string" && ["debug", "info", "warn", "error"].includes(level)
      ? (level as VaultLogLevel)
      : "error";
    const requestId = newRequestId();
    logEvent(ctx?.db ?? null, ctx?.orgId ?? null, {
      level: lvl,
      area: "renderer",
      channel: null,
      requestId,
      actor: RENDERER_CALLER,
      message: typeof message === "string" ? message : String(message),
      detail: typeof detail === "string" ? detail : null,
    });
    return requestId;
  });
}
