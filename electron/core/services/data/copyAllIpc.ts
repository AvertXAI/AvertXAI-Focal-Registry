// Focal Registry — "Back up everything": the app side.
// Description: gathers every database the app has open, the two key files and TimeTracker's
//              attached folders, hands them to copyAll, and remembers where the copy went. One run
//              at a time; the run is listed as a job, so the quit guard can wait for it or stop it
//              between files. Settings and the Software Update window both come through here.
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { DataCopyResult, DataCopyStatus } from "../../../../src/shared/types";
import { getDb, hasOpenDb, openDb } from "../db";
import { getActiveOrg } from "../db/registry";
import { deriveAttachKey, getOrCreateAttachSecret } from "../mindmerge/attachCrypto";
import { openAttachmentsDb } from "../mindmerge/attachDb";
import { openMindMergeDb } from "../mindmerge/db";
import { getMainSetting, setMainSetting } from "../settings";
import { defaultMarkdownRoot, focalRegistryDir, MARKDOWN_ROOT_KEY } from "../storage";
import { trackJob } from "../work/registry";
import { contractsGap, copyEverything, isInside, stampOf, type CopyPlan } from "./copyAll";

// Main-only rows: the page asks for a folder through the picker below and never writes these itself.
const FOLDER_KEY = "data.copy_folder";
const LAST_AT_KEY = "data.last_copy_at";
const LAST_PATH_KEY = "data.last_copy_path";

// Same registrar the other module files carry: one channel that fails to register must not
// silently take the channels registered after it down with it.
function safeHandle(channel: string, listener: Parameters<typeof ipcMain.handle>[1]): void {
  try {
    ipcMain.handle(channel, listener);
  } catch (e) {
    console.error(`[ipc] FAILED to register handler '${channel}':`, e);
  }
}

/** A settings read that answers null before an organisation exists, when there is no database. */
function saved(key: string): string | null {
  try {
    return getMainSetting(key);
  } catch {
    return null;
  }
}

// Built from the home folder like every other Documents path in the app: getPath("documents")
// follows the OneDrive redirect, and the backups would land apart from the data folder they sit beside.
const documents = (): string => path.join(app.getPath("home"), "Documents");

function chosenFolder(): string {
  return saved(FOLDER_KEY)?.trim() || path.join(documents(), "Focal Registry Backups");
}

// Read without resolveMarkdownRoot(): that one records the default when the row is missing, and
// a backup must not change a setting on its way through.
const recordsRoot = (): string => saved(MARKDOWN_ROOT_KEY)?.trim() || defaultMarkdownRoot();

function managedTree(): string {
  return focalRegistryDir(recordsRoot());
}

/** How many projects say they have a contract file. Zero when TimeTracker has never run here. */
function contractsOnRecord(): number {
  try {
    const row = getDb()
      .prepare(`SELECT COUNT(*) AS n FROM timetracker_projects WHERE contract_file_path IS NOT NULL AND contract_file_path != ''`)
      .get() as { n: number };
    return row.n;
  } catch {
    return 0; // no TimeTracker tables yet
  }
}

/** Why a folder cannot hold backups, or null when it can. A backup kept inside the data it
    copies is lost together with that data, which is the one day it is needed. */
function refusal(folder: string): string | null {
  const own = [app.getPath("userData"), path.join(documents(), "Focal Registry"), managedTree()];
  return own.some((dir) => isInside(folder, dir))
    ? "That folder is inside Focal Registry's own data. Choose a folder outside it."
    : null;
}

async function planFor(destinationRoot: string): Promise<Omit<CopyPlan, "shouldStop" | "report">> {
  const org = getActiveOrg();
  if (!org) throw new Error("There is nothing to back up yet: finish setting up Focal Registry first.");
  const userData = app.getPath("userData");
  const inData = (name: string): string => path.join(userData, name);
  // The development build and the installed app keep separate data but share one default backup
  // folder, so each backup says which data folder it came from.
  const notes = [`The databases and key files came from ${userData}. A restore puts them back there.`];

  // Both of these are open whenever an organisation exists, so neither call can create a file.
  const databases: CopyPlan["databases"] = [
    { name: "The shared database", fileName: `${org.app_slug}_${org.org_id}.db`, db: getDb() },
    { name: "The platform registry", fileName: "platform_registry.db", db: openDb(inData("platform_registry.db"), "platform_registry") },
  ];

  // Only through the connection the app opened with its key. Opening the Vault here without one
  // would leave a broken connection behind for everything that asks for it afterwards.
  const vaultFile = `${org.org_id}.atd`;
  if (hasOpenDb("vault")) {
    databases.push({ name: "The Vault", fileName: vaultFile, db: openDb("", "vault") });
  } else if (fs.existsSync(inData(vaultFile))) {
    // Never a backup that calls itself whole with the Vault missing from it.
    throw new Error("The Vault is on disk but is not open, so it cannot be copied. Restart Focal Registry and back up again.");
  }

  // Asking for either MindMerge store when its file is not there would create an empty one.
  const docsFile = `mindmerge_${org.org_id}.db`;
  const picturesFile = `${org.org_id}.mtd`;
  const picturesKeyFile = `${org.org_id}.mxd`;
  const loose: CopyPlan["files"] = [];
  try {
    if (fs.existsSync(inData(docsFile))) {
      databases.push({ name: "MindMerge documents", fileName: docsFile, db: openMindMergeDb(org.org_id, userData) });
    }
    if (fs.existsSync(inData(picturesFile))) {
      if (fs.existsSync(inData(picturesKeyFile))) {
        // The key file is there, so this reads it. With the file missing it would mint a new key.
        const key = await deriveAttachKey(getOrCreateAttachSecret(org.org_id));
        databases.push({ name: "MindMerge pictures", fileName: picturesFile, db: openAttachmentsDb(org.org_id, userData, key) });
      } else {
        // No key file, so the app cannot open this store and nothing is writing to it: a plain
        // copy of its files is a whole copy. Leaving it out would lose the pictures for good on
        // the day the key file turns up in an older backup.
        for (const name of [picturesFile, `${picturesFile}-wal`, `${picturesFile}-shm`]) {
          if (fs.existsSync(inData(name))) loose.push({ from: inData(name), to: name });
        }
        notes.push(`${picturesFile} (MindMerge pictures) was copied as a plain file, not through the app: its key file ${picturesKeyFile} is missing, so the app cannot open it. It can be opened again only with that key file.`);
      }
    }
  } catch (err) {
    // MindMerge opens its stores on first use, so this can be their first open of the session, and
    // a bare SQLite or Windows message would not say which store it is about.
    throw new Error(`MindMerge's data could not be opened, so nothing was copied: ${err instanceof Error ? err.message : String(err)}`);
  }

  // The key files are ordinary files, not live databases, so a plain copy is a whole copy.
  const keyFiles = [`${org.org_id}.ixd`, picturesKeyFile]
    .filter((name) => fs.existsSync(inData(name)))
    .map((name) => ({ from: inData(name), to: name }));
  const files = [...keyFiles, ...loose];
  if (keyFiles.length > 0) {
    notes.push(
      "The Vault and MindMerge pictures are tied to this Windows account on this PC: their key files (.ixd and .mxd) are wrapped by Windows. Restored under another account or on another PC, those two cannot be opened. Everything else can."
    );
  }

  // Contract files and custom alert sounds live outside the databases, which only hold their paths.
  const attached = path.join(managedTree(), "TimeTracker");
  const folders = ["contracts", "sounds"]
    .filter((name) => fs.existsSync(path.join(attached, name)))
    .map((name) => ({ from: path.join(attached, name), to: path.join("TimeTracker", name) }));
  if (folders.length > 0) notes.push(`The TimeTracker folder came from ${attached}. A restore puts it back there.`);
  // Never a backup that calls itself whole while the contract files its rows point at are out of reach.
  if (!fs.existsSync(path.join(attached, "contracts"))) {
    const root = recordsRoot();
    const gap = contractsGap(contractsOnRecord(), root, fs.existsSync(root));
    if (gap && "refuse" in gap) throw new Error(gap.refuse);
    if (gap) notes.push(gap.note);
  }

  return { databases, files, folders, destinationRoot, stamp: stampOf(new Date()), appVersion: app.getVersion(), notes };
}

async function copyNow(): Promise<DataCopyResult> {
  try {
    const folder = chosenFolder();
    // Asked again at every run, not only when the folder is picked: the data folders can move after.
    const refused = refusal(folder);
    if (refused) return { ok: false, error: refused };
    const plan = await planFor(folder);
    let progress = "Backup: getting ready";
    const result = await trackJob(
      () => progress,
      (shouldStop) => copyEverything({ ...plan, shouldStop, report: (text) => { progress = text; } })
    );
    if (result.ok) {
      try {
        setMainSetting(LAST_AT_KEY, new Date().toISOString());
        setMainSetting(LAST_PATH_KEY, result.path);
      } catch (err) {
        // A backup that worked is not reported as failed because its date could not be saved.
        console.error("[data] could not record the last backup:", err);
      }
    }
    return result;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

let inFlight: Promise<DataCopyResult> | null = null;

/** One run at a time. A second caller joins the run already going and gets its result, so Settings
    and the Software Update window can never start two copies of the same data. */
export function runDataCopy(): Promise<DataCopyResult> {
  if (inFlight) return inFlight;
  const run = copyNow().finally(() => {
    inFlight = null;
  });
  inFlight = run;
  return run;
}

export function lastDataCopy(): { at: string | null; path: string | null } {
  return { at: saved(LAST_AT_KEY), path: saved(LAST_PATH_KEY) };
}

export function registerDataCopyIpc(): void {
  safeHandle("datacopy:status", (): DataCopyStatus => {
    const last = lastDataCopy();
    return { folder: chosenFolder(), lastAt: last.at, lastPath: last.path, running: inFlight !== null };
  });
  safeHandle("datacopy:pickFolder", async (event) => {
    // Parented to the window that asked: an unparented folder dialog can hang the app on Windows.
    const win = BrowserWindow.fromWebContents(event.sender);
    const opts: Electron.OpenDialogOptions = {
      title: "Choose where backups are kept",
      defaultPath: chosenFolder(),
      properties: ["openDirectory", "createDirectory"],
    };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled || res.filePaths.length === 0) return null;
    const refused = refusal(res.filePaths[0]);
    if (refused) throw new Error(refused);
    setMainSetting(FOLDER_KEY, res.filePaths[0]);
    return res.filePaths[0];
  });
  safeHandle("datacopy:run", () => runDataCopy());
  safeHandle("datacopy:reveal", (_event, target: unknown) => {
    const shown = path.resolve(String(target ?? ""));
    // The page names the path, so only a backup location is ever shown, never a file of its choosing.
    if (shown !== lastDataCopy().path && !isInside(shown, chosenFolder())) return;
    if (fs.existsSync(shown)) shell.showItemInFolder(shown);
  });
}
