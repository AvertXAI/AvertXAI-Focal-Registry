// Focal Registry — Export all data, the main-process side.
// Description: the dataexport:* channels. Gathers the database handles that are already open,
//              refuses a plain-text Vault while the Vault is locked, and runs the export as a listed
//              job so the quit guard can ask about it. The writing itself is exportAll.ts.
// File: electron/core/services/data/exportAllIpc.ts
import { BrowserWindow, app, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { getDb, hasOpenDb, openDb } from "../db";
import { getActiveOrg } from "../db/registry";
import { deriveAttachKey, getOrCreateAttachSecret } from "../mindmerge/attachCrypto";
import { openAttachmentsDb } from "../mindmerge/attachDb";
import { openMindMergeDb } from "../mindmerge/db";
import { isUnlocked } from "../vault/lock";
import { logAccess } from "../vault/store";
import { trackJob } from "../work/registry";
import { exportAll, sharedModuleOf, type ExportResult, type ExportSource } from "./exportAll";

// The same registrar every module's ipc file carries: one failed registration is logged by name
// and never stops the ones after it.
function safeHandle(channel: string, listener: Parameters<typeof ipcMain.handle>[1]): void {
  try {
    ipcMain.handle(channel, listener);
  } catch (e) {
    console.error(`[ipc] FAILED to register handler '${channel}':`, e);
  }
}

// The Vault's access log names who asked. This is not the Vault's own screen, so it says so.
const CALLER = "data-export";

const refuse = (error: string): ExportResult => ({ ok: false, error });

// The page may only export into the folder the dialog just handed it, never one it names itself.
let pickedFolder: string | null = null;
let running = false;
// The folder the last run left. "Show in folder" shows this one and takes no path from the page.
let lastFolder: string | null = null;

async function gatherSources(orgId: string, appSlug: string, notes: string[]): Promise<ExportSource[]> {
  const userData = app.getPath("userData");
  const sources: ExportSource[] = [];
  // hasOpenDb first: openDb on a name that is not open would create an empty file. The name and
  // file are the ones db/registry.ts opens at boot.
  if (hasOpenDb("platform_registry")) {
    sources.push({ db: openDb("", "platform_registry"), file: "platform_registry.db", module: "registry" });
  }
  sources.push({ db: getDb(), file: `${appSlug}_${orgId}.db`, module: sharedModuleOf });
  // existsSync first, both times: opening a MindMerge store that is not there creates it, and its
  // key helper mints a new key. An install that never used MindMerge must stay that way.
  const docs = path.join(userData, `mindmerge_${orgId}.db`);
  if (fs.existsSync(docs)) {
    sources.push({ db: openMindMergeDb(orgId, userData), file: path.basename(docs), module: "mindmerge" });
  }
  const pictures = path.join(userData, `${orgId}.mtd`);
  if (fs.existsSync(pictures)) {
    try {
      if (!fs.existsSync(path.join(userData, `${orgId}.mxd`))) throw new Error("the picture key file is missing");
      const key = await deriveAttachKey(getOrCreateAttachSecret(orgId));
      sources.push({ db: openAttachmentsDb(orgId, userData, key), file: path.basename(pictures), module: "mindmerge", encrypted: true });
    } catch (err) {
      // The app cannot show these pictures either. The rest still goes out, and the gap is said aloud.
      console.error("[data export] the MindMerge picture store did not open:", err);
      notes.push("MindMerge pictures are missing from this export: the picture store could not be opened.");
    }
  }
  return sources;
}

export function registerDataExportIpc(): void {
  safeHandle("dataexport:pickFolder", async (event) => {
    const options: Electron.OpenDialogOptions = {
      title: "Choose where to put the export",
      properties: ["openDirectory", "createDirectory"],
    };
    // Parented to the window that asked: an unparented folder dialog can hang the app on Windows.
    // The unparented call is only for a window that has already gone.
    const parent = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow();
    const picked = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    pickedFolder = picked.canceled || picked.filePaths.length === 0 ? null : picked.filePaths[0];
    return pickedFolder;
  });

  safeHandle("dataexport:run", async (_event, raw: unknown): Promise<ExportResult> => {
    const asked = (raw ?? {}) as { folder?: unknown; includeVault?: unknown };
    const includeVault = asked.includeVault === true;
    if (typeof asked.folder !== "string" || asked.folder === "" || asked.folder !== pickedFolder) {
      return refuse("Choose a folder for the export first.");
    }
    if (running) return refuse("An export is already running. Wait for it to finish.");
    const destination = asked.folder;
    pickedFolder = null;
    running = true;
    try {
      const org = getActiveOrg();
      if (!org) return refuse("There is nothing to export yet: set up your organisation first.");
      const vaultDb = hasOpenDb("vault") ? openDb("", "vault") : null;
      if (includeVault && !vaultDb) {
        return refuse("The Secured Vault is not open on this install, so it cannot be included. Untick the box and export again.");
      }
      // The Vault's handle is open even while the Vault is locked. Reading through it then would
      // walk around the lock, so the plain-text box needs the same answer every Vault channel needs.
      if (includeVault && vaultDb && !isUnlocked(vaultDb, org.org_id)) {
        return refuse("The Secured Vault is locked. Unlock it first, then export again.");
      }
      const notes: string[] = [];
      const sources = await gatherSources(org.org_id, org.app_slug, notes);
      // Written before any file, as the Vault's own exports do: a run that dies half-way still happened.
      if (vaultDb) {
        logAccess(vaultDb, org.org_id, "export", null, null, CALLER, true, includeVault ? "export all data · plain text" : "export all data · encrypted copy");
      }
      let line = "Export: getting ready";
      const result = await trackJob(
        () => line,
        (shouldStop) =>
          exportAll({
            sources,
            vault: vaultDb
              ? { db: vaultDb, file: `${org.org_id}.atd`, keyEnvelope: path.join(app.getPath("userData"), `${org.org_id}.ixd`) }
              : null,
            includeVault,
            destination,
            appVersion: app.getVersion(),
            notes,
            shouldStop,
            onProgress: (p) => {
              line = `Export: ${p.table} · ${p.done} of ${p.total} tables`;
            },
          })
      );
      if (result.path) lastFolder = result.path;
      // A finished folder with a gap in it must not read as a clean success.
      if (result.ok && notes.length > 0) {
        return { ok: false, path: result.path, error: `The export finished, but it is not complete. ${notes.join(" ")} The rest is in the folder "${path.basename(result.path)}".` };
      }
      return result;
    } catch (err) {
      console.error("[data export] could not start:", err);
      return refuse("The export could not start. Nothing was written.");
    } finally {
      running = false;
    }
  });

  safeHandle("dataexport:reveal", () => {
    if (lastFolder && fs.existsSync(lastFolder)) shell.showItemInFolder(lastFolder);
  });
}
