// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Thin IPC handlers for the shared spine — Data Viewer (read-only SQLite introspection)
//              only. The TimeTracker channels were gutted with the module; the Data Viewer service
//              whitelists table names and clamps limit/offset, so the raw `unknown` args are safe.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/ipc.ts
//------------------------------------------------------------
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { defaultSettings, type MindMergeSettings } from "../../src/modules/mindmerge/config.manifest";
import { getDb } from "./services/db";
import { getActiveOrg } from "./services/db/registry";
import { vendorMap } from "./services/brandpack";
import * as dataviewer from "./services/dataviewer";
import * as firstrun from "./services/firstrun";
import * as modules from "./services/modules";
import * as mindmergeApi from "./services/mindmerge/api";
import * as migrateEngine from "./services/migrate/engine";
import { ensureMigrateSchema } from "./services/migrate/db";
import { registerTimeTrackerIpc } from "./services/timetracker/ipc";
import { registerEmployeesIpc } from "./services/employees/ipc";
import { registerVaultIpc } from "./services/vault/ipc";
import * as devseed from "./services/devseed";
import { ASSET_CLASSES } from "./services/migrate/registry";
import { readDeviceIdentity } from "./services/identity";
import { ingestAll, startMindMerge, type IngestProgress, type MindMergeHandle } from "./services/mindmerge/engine";
import * as scout from "./services/scout-viewer";
import * as scoutTargets from "./services/scout-viewer/targets";
import * as scan from "./services/scan";
import * as rename from "./services/rename";
import { ensureRenameSchema } from "./services/rename/db";
import type { RenameSettings } from "../../src/shared/renamePreview";
import * as scanDrives from "./services/scan/drives";
import * as scanNotes from "./services/scan/notes";
import * as scanThumbs from "./services/scan/thumbs";
import * as scanJobs from "./services/scan/jobs";
import * as scanSiblings from "./services/scan/siblings";
import * as scanThumbFails from "./services/scan/thumbFailures";
import * as scanMedia from "./services/scan/mediaBrowse";
import { ensureScanNotesSchema } from "./services/scan/notesDb";
import * as scanReport from "./services/scan/report";
import * as scanExport from "./services/scan/export";
import * as storage from "./services/storage";
import { ensureScanSchema } from "./services/scan/db";
import { generateUUIDv7 } from "./services/utils/uuidv7";
import * as settings from "./services/settings";
import { applyThemeOverlay, getMainWindow, setOverlayDim } from "./windows";

// --- MindMerge host — root-side glue ONLY. The service stays electron-free: orgId, baseDir
// (userData, where the module's own .db lives) and settings are injected from here. Lazy so it
// works both at normal boot and in the session right after the First-Run wizard mints the org.
let mindmergeHandle: MindMergeHandle | null = null;

// Manifest defaults overlaid with persisted app_settings rows — root owns persistence
// ("Expose, Don't Connect"); the module never reads app_settings itself.
function readMindMergeSettings(): MindMergeSettings {
  const s = defaultSettings();
  const rows = getDb()
    .prepare("SELECT key, value FROM app_settings WHERE key LIKE 'mindmerge.%'")
    .all() as { key: string; value: string }[];
  for (const { key, value } of rows) {
    if (key === "mindmerge.watch_path") s[key] = value;
    else if (key === "mindmerge.watch_enabled" || key === "mindmerge.auto_reparse")
      s[key] = value === "1";
  }
  return s;
}

// Throttled ingest-progress push — the MindMerge strip shows a live % so a large-folder ingest
// reads as "loading", not hung. Always sends the final tick (done === total) so the ticker clears.
let mindmergeProgressAt = 0;
function sendMindMergeProgress(p: IngestProgress): void {
  const now = Date.now();
  if (p.done < p.total && now - mindmergeProgressAt < 150) return;
  mindmergeProgressAt = now;
  getMainWindow()?.webContents.send("mindmerge:progress", p);
}

export function ensureMindMerge(skipIngest = false): MindMergeHandle {
  if (mindmergeHandle) return mindmergeHandle;
  const org = getActiveOrg();
  if (!org) throw new Error("MindMerge: no active org");
  mindmergeHandle = startMindMerge({
    orgId: org.org_id,
    baseDir: app.getPath("userData"),
    settings: readMindMergeSettings(),
    onProgress: sendMindMergeProgress,
    skipIngest,
  });
  return mindmergeHandle;
}

// B4 — re-point the engine when watch_path / watch_enabled changes: stop the old watcher, then
// rebuild from the freshly-persisted settings (openMindMergeDb is cached, so the same DB carries
// over; startMindMerge re-ingests + re-watches). Empty watch_path → engine stays idle.
export function restartMindMerge(skipIngest = false): void {
  if (!getActiveOrg()) return;
  mindmergeHandle?.stop();
  mindmergeHandle = null;
  ensureMindMerge(skipIngest);
}

// Full re-ingest of the current watch folder on demand; returns live ok/error counts for the UI.
// Async + progress-streaming so a large folder neither freezes the app nor looks hung.
async function rescanMindMerge(): Promise<{ ingested: number; quarantined: number }> {
  const h = ensureMindMerge();
  const watchPath = readMindMergeSettings()["mindmerge.watch_path"];
  if (watchPath && fs.existsSync(watchPath)) return ingestAll(h.db, watchPath, sendMindMergeProgress);
  const count = (status: string): number =>
    (h.db.prepare("SELECT COUNT(*) AS n FROM mindmerge_notes WHERE parse_status = ?").get(status) as { n: number }).n;
  return { ingested: count("ok"), quarantined: count("error") };
}

// --- Scan module host — root-side glue. Schema + crash-marking run once per process, lazily on
// first access AND eagerly at register time when an org exists (true service start), so runs left
// 'running' by a crash become 'crashed' before any UI asks. The service itself stays electron-free.
let scanInit = false;
function scanCtx(): { db: ReturnType<typeof getDb>; orgId: string } {
  const org = getActiveOrg();
  if (!org) throw new Error("Scan: no active org");
  const db = getDb();
  if (!scanInit) {
    ensureScanSchema(db);
    // Scan Notes shares this context — same shared database, same module. allSchemas already ensured
    // it at boot; this is the same harmless backstop ensureScanSchema is.
    ensureScanNotesSchema(db);
    scan.markInterruptedRuns(db); // any run still 'running' at service start is a crash
    scanInit = true;
  }
  return { db, orgId: org.org_id };
}
// Scan Notes' single push. Fire-and-forget: the payload is nothing, because every surface re-reads
// what it needs — one channel beats a fan-out that drifts as surfaces are added.
function sendNotesChanged(): void {
  getMainWindow()?.webContents.send("scan:notes:changed");
}
// A scan walks thousands of files; per-folder progress can still burst on a shallow-wide tree.
// ONLY the high-frequency in-phase updates ('counting' and 'running') are throttled. Every STATE
// TRANSITION ('estimating', 'completed', 'aborted', 'paused', 'crashed', 'error') always sends —
// otherwise a fast count's final 'estimating' event lands within the throttle window and is dropped,
// and the Step-2 estimate card never appears.
const SCAN_PROGRESS_THROTTLE_MS = 400;
let lastProgressAt = 0;
const THROTTLED_STATES = new Set(["counting", "running"]);
const sendScanProgress = (p: scan.ScanProgress): void => {
  const now = Date.now();
  if (THROTTLED_STATES.has(p.status) && now - lastProgressAt < SCAN_PROGRESS_THROTTLE_MS) return;
  lastProgressAt = now;
  getMainWindow()?.webContents.send("scan:progress", p);
};

// --- Live drive watcher — pushes a fresh drive list on every OS volume arrival/removal, so a newly
// connected drive appears WITHOUT Ctrl+R (Windows-speed, event-driven). Debounced: one connect can
// raise several events, and a freshly-mounted volume needs a beat before it enumerates cleanly.
let stopDriveWatcher: (() => void) | null = null;
let driveDebounce: ReturnType<typeof setTimeout> | null = null;
function startDriveWatcher(): void {
  if (stopDriveWatcher) return; // already watching
  stopDriveWatcher = scanDrives.watchVolumes(() => {
    if (driveDebounce) clearTimeout(driveDebounce);
    driveDebounce = setTimeout(() => {
      try {
        getMainWindow()?.webContents.send("scan:drives", scanDrives.listVolumes());
      } catch {
        /* transient enumeration hiccup — the next event or a manual refresh recovers */
      }
      // Scan Notes rides the SAME event and the SAME debounce — a second watcher would mean a second
      // PowerShell child, a second orphan risk on quit, and two answers to "is this drive here yet".
      drainScanNotes();
    }, 600);
  });
}

/**
 * The reconnect consumer: apply every queued rename whose drive is now present, then rewrite both
 * app-owned trees for it. Never throws — it runs inside a debounce callback that must survive any
 * one drive's bad day, and the service already logs each failure to the feed.
 *
 * A CONNECT IS THE ONLY MOMENT SOME OF THIS CAN HAPPEN, so the summary is pushed to the renderer as
 * a toast rather than left in a tab the user may not open. Quiet when there was nothing to do — a
 * notification that fires on every USB stick is a notification people learn to ignore.
 */
function drainScanNotes(withSync = true): void {
  try {
    const { db, orgId } = scanCtx();
    const r = scanNotes.drainQueue(db, orgId, scanNotes.currentVolumes(), withSync);
    const win = getMainWindow();
    win?.webContents.send("scan:notes:changed");
    const worked = r.drives.filter((d) => d.applied > 0 || d.stale > 0 || d.filesWritten > 0);
    if (worked.length > 0) win?.webContents.send("scan:notes:synced", { drives: worked });
  } catch {
    /* no org yet, or the drive list is momentarily unreadable — the next event or the manual
       refresh button recovers, and nothing here may break the watcher */
  }
}
// Kill the PowerShell child on quit so no orphan process survives the app.
app.on("before-quit", () => {
  if (driveDebounce) clearTimeout(driveDebounce);
  stopDriveWatcher?.();
  stopDriveWatcher = null;
});

// --- Rename host — lazy schema + crash-recovery, mirroring the Scan host. Rename copies from chosen
// source folders (independent of Scan) and its long jobs stream over rename:progress.
let renameInit = false;
function renameCtx(): { db: ReturnType<typeof getDb>; orgId: string } {
  const org = getActiveOrg();
  if (!org) throw new Error("Rename: no active org");
  const db = getDb();
  if (!renameInit) {
    ensureRenameSchema(db);
    rename.markInterruptedRenames(db); // any batch left 'running' by a crash → 'crashed'
    renameInit = true;
  }
  return { db, orgId: org.org_id };
}
const RENAME_PROGRESS_THROTTLE_MS = 300;
let lastRenameProgressAt = 0;
const sendRenameProgress = (p: rename.RenameProgress): void => {
  const now = Date.now();
  if (p.status === "running" && now - lastRenameProgressAt < RENAME_PROGRESS_THROTTLE_MS) return; // terminals always flush
  lastRenameProgressAt = now;
  getMainWindow()?.webContents.send("rename:progress", p);
};

// --- handlers ---

// Resilient registration: one channel failing to register must NEVER silently kill the rest
// (the failure mode that produced a wrong "stale bundle" diagnosis). Each registration is isolated
// and any throw is logged LOUDLY with its channel name; the sequence continues.
function safeHandle(channel: string, listener: Parameters<typeof ipcMain.handle>[1]): void {
  try {
    ipcMain.handle(channel, listener);
  } catch (e) {
    console.error(`[ipc] FAILED to register handler '${channel}':`, e);
  }
}
function safeOn(channel: string, listener: Parameters<typeof ipcMain.on>[1]): void {
  try {
    ipcMain.on(channel, listener);
  } catch (e) {
    console.error(`[ipc] FAILED to register listener '${channel}':`, e);
  }
}

/** Tell every window that data changed — the same "timetracker:changed" channel every listening
    surface already invalidates on. One channel meaning "re-read", never two. */
function broadcastChanged(): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send("timetracker:changed");
  }
}

export function registerIpcHandlers(): void {
  // Scan service start — pre-org boot (first-run wizard) skips; lazy init covers post-wizard.
  try {
    scanCtx();
  } catch {
    /* no active org yet */
  }
  // TimeTracker module (timetracker:*) — registration + service start live in the module's own
  // ipc file (crash-recovery capture MUST precede the ticker's first heartbeat; see that file).
  registerTimeTrackerIpc();
  // Employees module (employees:*) — same shape: registration and its lazy org context live in the
  // module's own ipc file. No service start, no ticker, no push channel — reads only until asked.
  registerEmployeesIpc();
  // Brand pack artwork. Returns null until a pack has downloaded, which the renderer reads as
  // "no artwork" and renders the colour-and-initials tile — the pre-pack behaviour, unchanged.
  ipcMain.handle("brandpack:map", () => vendorMap());
  // Secured Vault (vault:*) — same shape again; its lazy ctx also derives the SQLCipher key and
  // defensively ensures the vault schema (a wizard-minted org never reaches main.ts's boot ensure).
  registerVaultIpc();
  // Live drive detection — starts once, independent of any org (enumeration is org-agnostic). A new
  // drive now pushes scan:drives to the renderer immediately; no Ctrl+R.
  startDriveWatcher();
  // ONE QUEUE DRAIN AT STARTUP, because the watcher cannot see the past: a drive plugged in while
  // the app was closed raises no event, and the WMI watcher can also fail to start entirely.
  //
  // NO MIRROR REWRITE HERE (Jason, on device 08-17-2026 — the app hung on launch). Draining the
  // queue is usually zero rows and costs nothing; rewriting every file for an 800-folder drive is
  // seconds of synchronous work, and doing it before the user has clicked anything froze the window
  // on every single launch. A rename that DOES apply still syncs, because its files really did
  // change. Otherwise the sync belongs to a connect or to the refresh button.
  setTimeout(() => drainScanNotes(false), 3000);
  // The thumbnail cache sweep walks a directory, so it is fired here — well clear of boot and of
  // every per-tile path — and after that only when a session has written enough to be worth it.
  scanThumbs.scheduleSweep(15_000);
  // data viewer — READ-ONLY introspection. The service whitelists `table` against sqlite_master and
  // clamps limit/offset, so the raw `unknown` args can't reach a writable or injectable statement.
  safeHandle("db:tables", () => dataviewer.listTables());
  safeHandle("db:columns", (_e, table: unknown) => dataviewer.getColumns(table));
  safeHandle("db:rows", (_e, table: unknown, limit: unknown, offset: unknown, sortColumn: unknown, sortDir: unknown) =>
    dataviewer.getRows(table, limit, offset, sortColumn, sortDir)
  );
  // DIAG is env-gated (DIAG=1). Answer explicitly so the renderer's invoke resolves cleanly instead
  // of logging "No handler registered for 'diag:enabled'" on every boot — a red herring in the log.
  safeHandle("diag:enabled", () => process.env.DIAG === "1");
  safeHandle("db:fks", (_e, table: unknown) => dataviewer.getForeignKeys(table));
  // B6 (08-06): dev mode re-locks on app update — the stored unlock is compared against THIS
  // version, injected once here so the service stays electron-free.
  dataviewer.setRunningVersion(app.getVersion());
  safeHandle("dataviewer:getDevMode", () => dataviewer.getDevMode());
  // Developer-mode row writes (A3). Gated in the SERVICE on dev mode; broadcast after, because a
  // raw edit can move any figure any surface renders.
  safeHandle("dataviewer:updateRow", (_e, table: unknown, pkValue: unknown, changes: unknown) => {
    const r = dataviewer.updateRow(table, pkValue, (changes ?? {}) as Record<string, unknown>);
    if (r.changed > 0) broadcastChanged();
    return r;
  });
  safeHandle("dataviewer:deleteRow", (_e, table: unknown, pkValue: unknown) => {
    const r = dataviewer.deleteRow(table, pkValue);
    if (r.changed > 0) broadcastChanged();
    return r;
  });
  safeHandle("dataviewer:setDevMode", (_e, on: unknown) => dataviewer.setDevMode(on === true));

  // first-run wizard — service validates orgName, then seeds settings + modules in one transaction.
  safeHandle("firstRun:get", () => firstrun.getFirstRunStatus());
  safeHandle("firstRun:complete", (_e, orgName: unknown, masterPassword: unknown) =>
    firstrun.completeFirstRun(orgName, masterPassword)
  );

  // LOCAL device identity for the Settings "This device" read-only surface. Prefers the provenance
  // row written at account creation; an install that predates that row gets a LIVE probe (read-only,
  // nothing written). LOCAL ONLY — this data never leaves the machine (see services/identity).
  safeHandle("identity:get", () => {
    const org = getActiveOrg();
    if (org) {
      try {
        const row = getDb()
          .prepare(
            "SELECT machine_guid, hardware_uuid, machine_name, created_at FROM device_provenance WHERE org_id = ? ORDER BY id LIMIT 1"
          )
          .get(org.org_id) as { machine_guid: string | null; hardware_uuid: string | null; machine_name: string | null; created_at: string | null } | undefined;
        if (row) return row;
      } catch {
        /* table absent on a mid-upgrade DB — fall through to the live probe */
      }
    }
    return { ...readDeviceIdentity(), created_at: null };
  });

  // module registry — Config-as-Data rows that drive the renderer nav + routing.
  safeHandle("modules:get", () => modules.listModules());

  // platform settings — key-whitelisted app_settings access (service rejects unknown keys).
  safeHandle("settings:get", (_e, key: unknown) => settings.getSetting(key));
  safeHandle("settings:set", (_e, key: unknown, value: unknown) => {
    settings.setSetting(key, value);
    // B4: persisting a mindmerge watch setting re-points the fs.watch engine. A new watch_path means a
    // different folder → full re-ingest. Toggling watch_enabled only starts/stops the live watcher; the
    // files are already in the DB, so skipIngest=true avoids a needless re-read (no loading overlay).
    if (key === "mindmerge.watch_path") restartMindMerge();
    else if (key === "mindmerge.watch_enabled") restartMindMerge(true);
  });

  // Native window-control overlay tint. The window is born in the JARVIS boot navy; the renderer
  // drives every later tint (shell mount + theme flips) through this single channel.
  // Three states, validated here rather than trusted: the renderer may ask for the viewer chrome
  // by name, and anything else is read as a plain boolean.
  safeHandle("theme:modalDim", (_e, on: unknown) => setOverlayDim(on === "viewer" ? "viewer" : on === true));
  safeHandle("theme:overlay", (_e, mode: unknown) =>
    applyThemeOverlay(typeof mode === "string" ? mode : null)
  );

  // mindmerge module (mindmerge:*).
  // Read-only queries; the service whitelists filter keys and escapes the FTS input, so the raw
  // renderer args can't reach SQL/FTS syntax.
  // Lazy engine start on module open. Returns whether THIS call actually kicks off an ingest (a fresh
  // engine start with a real watch folder) so the module can show its loading overlay from the instant
  // it opens — before the first progress tick — and only when there is genuinely a load to cover.
  safeHandle("mindmerge:ensure", () => {
    const fresh = mindmergeHandle === null;
    try {
      ensureMindMerge();
    } catch {
      return { ingesting: false };
    }
    const wp = readMindMergeSettings()["mindmerge.watch_path"];
    return { ingesting: fresh && !!wp && fs.existsSync(wp) };
  });
  safeHandle("mindmerge:list", (_e, filter: unknown) =>
    mindmergeApi.listNotes(
      ensureMindMerge().db,
      (typeof filter === "object" && filter !== null ? filter : {}) as mindmergeApi.NoteFilter
    )
  );
  safeHandle("mindmerge:get", (_e, id: unknown) => mindmergeApi.getNote(ensureMindMerge().db, String(id)));
  safeHandle("mindmerge:search", (_e, q: unknown) =>
    mindmergeApi.search(ensureMindMerge().db, typeof q === "string" ? q : "")
  );
  safeHandle("mindmerge:listQuarantined", () => mindmergeApi.listQuarantined(ensureMindMerge().db));

  // native folder picker → the chosen dir (or null on cancel); the renderer persists it via
  // settings:set, which re-points the engine (B4). rescan re-ingests the current folder on demand.
  safeHandle("mindmerge:pickWatchFolder", async () => {
    const win = getMainWindow();
    const res = win
      ? await dialog.showOpenDialog(win, { properties: ["openDirectory"] })
      : await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
  });
  safeHandle("mindmerge:rescan", () => rescanMindMerge());

  // --- storage (Phase 2): the app-managed Markdown root + the Documents export folder ---
  // locations ENSURES the tree exists (first look creates it, no prompt beyond the root choice).
  safeHandle("storage:locations", () => storage.storageLocations());
  safeHandle("storage:pickRoot", async () => {
    const win = getMainWindow();
    const res = win
      ? await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"], title: "Choose a folder for Focal Registry's records" })
      : await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"], title: "Choose a folder for Focal Registry's records" });
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
  });
  // Copies the existing tree to the new root, then re-points — never moves/deletes the old (2.6).
  safeHandle("storage:changeRoot", (_e, newRoot: unknown) => storage.changeMarkdownRoot(String(newRoot ?? "")));
  // migrate module — discovery is READ-ONLY against sources; bundle export writes ONLY into the
  // user-chosen destination via the shared copyVerified core (hash ON — removable media). Jobs drain
  // a single-slot queue (Jason's ruling); long-running work is fire-and-forget over migrate:progress.
  let migrateInit = false;
  const migrateCtx = (): { db: ReturnType<typeof getDb>; orgId: string } => {
    const org = getActiveOrg();
    if (!org) throw new Error("Migrate: no active org");
    const db = getDb();
    if (!migrateInit) {
      ensureMigrateSchema(db);
      migrateEngine.markInterruptedMigrate(db); // runs left 'running' by a crash become 'crashed'
      migrateInit = true;
    }
    return { db, orgId: org.org_id };
  };
  const sendMigrateProgress = (p: migrateEngine.MigrateProgress): void => {
    getMainWindow()?.webContents.send("migrate:progress", p);
  };
  safeHandle("migrate:registry", () => ASSET_CLASSES);
  safeHandle("migrate:drives", () => scanDrives.listVolumes());
  safeHandle("migrate:pickFolders", async () => {
    const win = getMainWindow() ?? undefined;
    const opts = { properties: ["openDirectory", "multiSelections"] as Array<"openDirectory" | "multiSelections">, title: "Choose folders to search" };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return res.canceled ? [] : res.filePaths;
  });
  safeHandle("migrate:createJob", (_e, opts: unknown) => {
    const { db, orgId } = migrateCtx();
    const jobId = migrateEngine.createJob(db, orgId, opts as migrateEngine.CreateJobOpts);
    void migrateEngine.pumpQueue(db, orgId, sendMigrateProgress); // fire-and-forget drain
    return jobId;
  });
  safeHandle("migrate:listJobs", () => {
    const { db, orgId } = migrateCtx();
    return migrateEngine.listJobs(db, orgId);
  });
  safeHandle("migrate:jobSummary", (_e, jobId: unknown) => {
    const { db } = migrateCtx();
    return migrateEngine.jobSummary(db, Number(jobId));
  });
  safeHandle("migrate:jobItems", (_e, jobId: unknown, extension: unknown) => {
    const { db } = migrateCtx();
    return migrateEngine.jobItems(db, Number(jobId), extension == null ? null : String(extension));
  });
  safeHandle("migrate:setSelected", (_e, payload: unknown) => {
    const { db } = migrateCtx();
    const p = payload as { jobId: number; ids?: number[]; extension?: string | null; selected: boolean };
    if (Array.isArray(p.ids)) migrateEngine.setItemsSelected(db, p.jobId, p.ids, p.selected);
    else migrateEngine.setScopeSelected(db, p.jobId, p.extension ?? null, p.selected);
    return { ok: true };
  });
  safeHandle("migrate:abortJob", (_e, jobId: unknown) => migrateEngine.requestAbortJob(Number(jobId)));
  safeHandle("migrate:bundlePreflight", (_e, jobId: unknown, destRoot: unknown) => {
    const { db } = migrateCtx();
    return migrateEngine.bundlePreflight(db, Number(jobId), String(destRoot));
  });
  safeHandle("migrate:startBundle", (_e, jobId: unknown, destRoot: unknown) => {
    const { db, orgId } = migrateCtx();
    // Fire-and-forget: progress + terminal states flow over migrate:progress; a preflight rejection
    // surfaces as a failed push so the renderer can show the exact message.
    void migrateEngine.startBundle(db, orgId, Number(jobId), String(destRoot), sendMigrateProgress).catch((e) => {
      sendMigrateProgress({
        kind: "bundle", jobId: Number(jobId), status: "failed", currentPath: null,
        foldersWalked: 0, foldersTotal: null, filesFound: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    });
    return { ok: true };
  });
  safeHandle("migrate:listBundles", (_e, jobId: unknown) => {
    const { db } = migrateCtx();
    return migrateEngine.listBundles(db, Number(jobId));
  });
  safeHandle("migrate:openFolder", (_e, target: unknown) => {
    const p = String(target ?? "");
    if (p === "" || !fs.existsSync(p)) return { ok: false, error: "Folder not found." };
    void shell.openPath(p);
    return { ok: true };
  });

  // Open one of the shown storage folders in the OS file manager (Settings transparency, 2.5).
  safeHandle("storage:openFolder", (_e, target: unknown) => {
    const p = String(target ?? "");
    if (p === "" || !fs.existsSync(p)) return { ok: false, error: "Folder not found." };
    void shell.openPath(p);
    return { ok: true };
  });

  // scan module — READ-ONLY against sources; the only writes are rows in the org DB. Long-running
  // start/resume are fire-and-forget: progress flows over the scan:progress push, errors are pushed
  // as a status note, and the invoke returns immediately so the renderer never holds a pending
  // promise for hours.
  safeHandle("scan:listDrives", () => scanDrives.listVolumes());
  // Drives with a completed scan — including ones currently UNPLUGGED, so the list can show them as
  // "not connected" and still open their (locally-copied) report. Serial is identity; no letter.
  safeHandle("scan:listScannedDrives", () => {
    const { db, orgId } = scanCtx();
    return scan.listScannedDrives(db, orgId);
  });
  safeHandle("scan:selectSource", (_e, rootPath: unknown, scanUnit: unknown) => {
    const { db, orgId } = scanCtx();
    if (typeof rootPath !== "string" || rootPath.trim() === "") throw new Error("selectSource: rootPath required");
    return scanDrives.selectSource(db, orgId, rootPath, scanUnit === "drive" ? "drive" : "folder", generateUUIDv7, scan.RAW_MODE);
  });
  safeHandle("scan:probe", (_e, rootPath: unknown, scanUnit: unknown) => {
    const { db, orgId } = scanCtx();
    if (typeof rootPath !== "string" || rootPath.trim() === "") throw new Error("probe: rootPath required");
    const unit = scanUnit === "drive" ? "drive" : "folder";
    const drive = scanDrives.resolveDrive(db, orgId, scanDrives.volumeForPath(rootPath), generateUUIDv7);
    const run = scan.createRun(db, orgId, drive.id, rootPath, unit);
    // Fire-and-forget EXACT counting walk (Phase 4) — returns the runId immediately; the exact
    // folder/media counts arrive over scan:progress ('counting' → 'estimating'). No extrapolation.
    const serial = scan.driveSerial(db, drive.id);
    void scan.countRun(db, orgId, run.id, { onProgress: sendScanProgress }).catch((e) => {
      console.error("[scan] count failed:", e);
      sendScanProgress({ runId: run.id, volumeSerial: serial, status: "error", currentFolder: null, foldersCommitted: 0,
        filesRecorded: 0, errorsLogged: 0, estimatedFiles: null, note: e instanceof Error ? e.message : String(e) });
    });
    return { runId: run.id };
  });
  const launchRun = (runId: number, resume: boolean): { ok: true; runId: number } => {
    const { db, orgId } = scanCtx();
    const serial = scan.driveSerial(db, scan.getRun(db, runId).drive_id);
    scan
      .startRun(db, orgId, runId, {
        resume,
        onProgress: sendScanProgress,
        // Time-based checkpoint: rewrite a clearly-marked PARTIAL report so an interrupted scan still
        // leaves a readable summary. Best-effort — writeScanReport never throws, and the engine also
        // guards the call, so a report failure can never disturb the running scan.
        onCheckpoint: (rid) => { scanReport.writeScanReport(db, rid, { partial: true }); },
      })
      .then((finished) => {
        // On a clean completion write the report NOW — in the main process, so a run that finished
        // while the user was on another module still gets its report. A write failure is surfaced
        // as a terminal note; the run STAYS completed (the data is already committed).
        if (finished.status !== "completed") return;
        const result = scanReport.writeScanReport(db, runId);
        sendScanProgress({
          runId, volumeSerial: serial, status: "completed", currentFolder: null,
          foldersCommitted: finished.folders_committed, filesRecorded: finished.files_recorded,
          errorsLogged: finished.errors_logged, estimatedFiles: finished.estimated_files,
          reportPath: result.ok ? (result.path ?? null) : null,
          reportError: result.ok ? null : (result.error ?? "report write failed"),
        });
      })
      .catch((e) => {
        console.error("[scan] run failed:", e);
        sendScanProgress({
          runId, volumeSerial: serial, status: "error", currentFolder: null, foldersCommitted: 0, filesRecorded: 0,
          errorsLogged: 0, estimatedFiles: null, note: e instanceof Error ? e.message : String(e),
        });
      });
    return { ok: true, runId };
  };
  safeHandle("scan:start", (_e, runId: unknown) => launchRun(Number(runId), false));
  safeHandle("scan:resume", (_e, runId: unknown) => launchRun(Number(runId), true));
  safeHandle("scan:pause", (_e, runId: unknown) => scan.requestPause(Number(runId)));
  safeHandle("scan:abort", (_e, runId: unknown) => {
    const { db } = scanCtx();
    return scan.requestAbort(db, Number(runId));
  });
  safeHandle("scan:status", (_e, runId: unknown) => {
    const { db } = scanCtx();
    return scan.runStatus(db, Number(runId));
  });
  safeHandle("scan:listRuns", () => {
    const { db, orgId } = scanCtx();
    return scan.listRuns(db, orgId);
  });
  // Last run for a volume serial — drives the "already scanned → show the report" path (serial is
  // identity, not the letter) and Option B's populated dashboard.
  safeHandle("scan:lastRunForVolume", (_e, serial: unknown) => {
    const { db, orgId } = scanCtx();
    if (typeof serial !== "string") return null;
    return scan.lastRunForVolume(db, orgId, serial);
  });
  // Folder rollups for Option B's populated view (top-level folders of a run).
  safeHandle("scan:folders", (_e, runId: unknown) => {
    const { db } = scanCtx();
    return scan.listFolders(db, Number(runId));
  });
  // Manual report (re)write — used by the UI if the auto-write on completion failed. Returns the
  // path or an error string; never throws.
  safeHandle("scan:writeReport", (_e, runId: unknown) => {
    const { db } = scanCtx();
    return scanReport.writeScanReport(db, Number(runId));
  });
  // Open the report file / the reports folder in the OS. openPath never throws; returns "" on ok.
  safeHandle("scan:openReport", (_e, runId: unknown) => {
    const { db } = scanCtx();
    const run = scan.getRun(db, Number(runId));
    // Prefer the on-drive copy; fall back to the local copy when the drive is unplugged.
    const target = run.report_path && fs.existsSync(run.report_path) ? run.report_path
      : run.report_local_path && fs.existsSync(run.report_local_path) ? run.report_local_path
      : null;
    if (!target) return { ok: false, error: "no report on this run" };
    void shell.showItemInFolder(target); // reveals + selects; the safe cross-format open
    return { ok: true };
  });
  // Reveal a scanned folder in the OS file manager. Hardened (audit R2): the path must (a) exist,
  // (b) be a DIRECTORY — never a file, so shell.openPath can't LAUNCH an .exe/.bat/.ps1 — and (c) sit
  // under a root_path this org actually scanned, so the channel can't open arbitrary paths on the
  // machine. Every rejection returns a clean error; it never throws.
  safeHandle("scan:openPath", (_e, target: unknown) => {
    const { db, orgId } = scanCtx();
    const p = String(target ?? "");
    if (p === "" || !fs.existsSync(p)) return { ok: false, error: "Folder not found (drive offline or moved?)." };
    let isDir = false;
    try {
      isDir = fs.statSync(p).isDirectory();
    } catch {
      return { ok: false, error: "Folder not found (drive offline or moved?)." };
    }
    if (!isDir) return { ok: false, error: "That path is not a folder." };
    if (!scan.isUnderScannedRoot(db, orgId, p)) return { ok: false, error: "That folder is outside any scanned drive." };
    void shell.openPath(p);
    return { ok: true };
  });
  // Distinct cameras for one folder's media (most-used first) — the Top-camera click-through.
  safeHandle("scan:folderCameras", (_e, folderId: unknown) => {
    const { db } = scanCtx();
    return scan.folderCameras(db, Number(folderId));
  });
  // History retention. clearHistory = soft-clear (History Nuke, one press, reversible 30 days);
  // restoreHistory / deleteHistoryForever + clearedCount drive the Settings Scan controls.
  safeHandle("scan:clearHistory", (_e) => {
    const { db, orgId } = scanCtx();
    return { cleared: scan.clearHistory(db, orgId) };
  });
  safeHandle("scan:restoreHistory", (_e) => {
    const { db, orgId } = scanCtx();
    return { restored: scan.restoreHistory(db, orgId) };
  });
  safeHandle("scan:deleteHistoryForever", (_e) => {
    const { db, orgId } = scanCtx();
    return { deleted: scan.deleteHistoryForever(db, orgId) };
  });
  safeHandle("scan:clearedHistoryCount", (_e) => {
    const { db, orgId } = scanCtx();
    return scan.clearedHistoryCount(db, orgId);
  });
  // Export the Reading view to PDF via Electron's built-in printToPDF (no dependency). The renderer
  // sends the rendered HTML + a print stylesheet; we print it in a hidden, script-disabled window and
  // save beside the .md report, never overwriting (collision → -02). Any failure returns { ok:false }.
  safeHandle("scan:exportReportPdf", async (_e, runId: unknown, html: unknown, css: unknown) => {
    let tmp: string | null = null;
    try {
      const { db } = scanCtx();
      const run = scan.getRun(db, Number(runId));
      if (run.status !== "completed") return { ok: false, error: "The scan has not completed yet." };
      const { base } = scanReport.reportStem(db, run.id); // filename stem only; exports live in Documents now
      const exportDir = storage.documentsExportsDir();
      fs.mkdirSync(exportDir, { recursive: true });
      const outPath = scanExport.collisionFreeName(exportDir, base, ".pdf");
      const doc = `<!doctype html><html><head><meta charset="utf-8"><style>${String(css ?? "")}</style></head><body>${String(html ?? "")}</body></html>`;
      tmp = path.join(app.getPath("temp"), `focal-report-${run.id}-${Date.now()}.html`);
      fs.writeFileSync(tmp, doc, "utf8");
      // Drive label for the repeating page header — from the DB (our data), never renderer input.
      const drive = run.drive_id != null
        ? (db.prepare("SELECT volume_label FROM scan_drives WHERE id = ?").get(run.drive_id) as { volume_label: string | null } | undefined)
        : undefined;
      const headerLabel = (drive?.volume_label ?? "").replace(/[<>&]/g, "");
      const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, javascript: false } });
      try {
        await win.webContents.loadFile(tmp);
        // Letter, explicit margins (inches) leaving room for the header/footer; printBackground on.
        const pdf = await win.webContents.printToPDF({
          printBackground: true,
          pageSize: "Letter",
          margins: { top: 0.75, bottom: 0.7, left: 0.6, right: 0.6 },
          displayHeaderFooter: true,
          headerTemplate: `<div style="font-size:8px;width:100%;padding:0 0.6in;text-align:right;color:#888;">${headerLabel}</div>`,
          footerTemplate: `<div style="font-size:8px;width:100%;padding:0 0.6in;text-align:center;color:#888;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
        });
        fs.writeFileSync(outPath, pdf);
      } finally { win.destroy(); }
      void shell.showItemInFolder(outPath); // land the user in the folder with the file selected
      return { ok: true, path: outPath };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    } finally {
      if (tmp) { try { fs.unlinkSync(tmp); } catch { /* best-effort temp cleanup */ } }
    }
  });
  // Export ALL media-bearing folder rows (not the report's top-100) to a streamed CSV beside the .md.
  safeHandle("scan:exportReportCsv", async (_e, runId: unknown) => {
    try {
      const { db } = scanCtx();
      const run = scan.getRun(db, Number(runId));
      if (run.status !== "completed") return { ok: false, error: "The scan has not completed yet." };
      const { base } = scanReport.reportStem(db, run.id); // filename stem only; exports live in Documents now
      const exportDir = storage.documentsExportsDir();
      fs.mkdirSync(exportDir, { recursive: true });
      const outPath = scanExport.collisionFreeName(exportDir, base, ".csv");
      await scanExport.exportFoldersCsv(db, run.id, outPath);
      void shell.showItemInFolder(outPath); // land the user in the folder with the file selected
      return { ok: true, path: outPath };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  // Same rows as the CSV, as a workbook. Written by our own minimal writer — no dependency.
  safeHandle("scan:exportReportXlsx", async (_e, runId: unknown) => {
    try {
      const { db } = scanCtx();
      const run = scan.getRun(db, Number(runId));
      if (run.status !== "completed") return { ok: false, error: "The scan has not completed yet." };
      const { base } = scanReport.reportStem(db, run.id);
      const exportDir = storage.documentsExportsDir();
      fs.mkdirSync(exportDir, { recursive: true });
      const outPath = scanExport.collisionFreeName(exportDir, base, ".xlsx");
      scanExport.exportFoldersXlsx(db, run.id, outPath);
      void shell.showItemInFolder(outPath);
      return { ok: true, path: outPath };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  // Re-reveal an export the user already made — what the green "Saved …" bar clicks through to.
  // HARDENED: the path must sit inside the exports directory, so this cannot reveal arbitrary
  // locations on the machine even though the value originates in the renderer.
  safeHandle("scan:revealExport", (_e, target: unknown) => {
    try {
      const p = String(target ?? "");
      const exportDir = path.resolve(storage.documentsExportsDir());
      if (!p || !path.resolve(p).startsWith(exportDir)) return { ok: false, error: "outside the exports folder" };
      if (!fs.existsSync(p)) return { ok: false, error: "that file is no longer there" };
      void shell.showItemInFolder(p);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  // ---- DEMO DATA (Data Viewer). Writes through the real services; purge removes exactly what it
  // ---- created, by recorded id, and never empties a table.
  safeHandle("devseed:status", () => devseed.demoStatus(getDb()));
  // The key is the USER'S, typed into the prompt — validated and activated inside the service
  // through the same setLicenseKey the Settings screen uses (ruling 4). After a successful write
  // (either direction) every window is told to re-read: seed data has to appear everywhere without
  // a single click into a module (ruling on the refresh contract, 08-05).
  safeHandle("devseed:generate", (_e, rawKey: unknown) => {
    const org = getActiveOrg();
    if (!org) return { ok: false, error: "No workspace is open." };
    const result = devseed.generateDemo(getDb(), org.org_id, String(rawKey ?? ""));
    if (result.ok) broadcastChanged();
    return result;
  });
  safeHandle("devseed:purge", () => {
    const result = devseed.purgeDemo(getDb());
    if (result.ok) broadcastChanged();
    return result;
  });
  // F1 (08-10): the DRY RUN — what purge WOULD delete, per table, seeded vs attached. Read-only.
  safeHandle("devseed:previewPurge", () => devseed.previewPurge(getDb()));
  // F6 (08-10): reset this organisation's data. DEVELOPER MODE ONLY, service-checked here so a
  // forged renderer call cannot reach it with the flag off; the renderer adds a typed confirm.
  safeHandle("devseed:resetOrg", () => {
    if (!dataviewer.getDevMode()) {
      return { ok: false, error: "Developer mode is off — the reset is a developer-mode tool." };
    }
    const result = devseed.resetOrgData(getDb());
    if (result.ok) broadcastChanged();
    return result;
  });

  safeHandle("scan:openReportsFolder", (_e, runId: unknown) => {
    const { db } = scanCtx();
    const run = scan.getRun(db, Number(runId));
    // Drive copy's folder if the drive is present; else the local copy's folder (unplugged); else the
    // drive's reports root as a last resort. Never send the OS at a dead drive letter.
    const dir = run.report_path && fs.existsSync(run.report_path) ? path.dirname(run.report_path)
      : run.report_local_path && fs.existsSync(run.report_local_path) ? path.dirname(run.report_local_path)
      : path.join(path.parse(path.resolve(run.root_path)).root, scanReport.REPORTS_FOLDER_NAME);
    void shell.openPath(dir);
    return { ok: true };
  });
  // Read the report markdown back for the in-app modal (until MindMerge ingestion lands). Bounded
  // read; never throws. Returns { ok, content } or { ok:false, error }.
  safeHandle("scan:readReport", (_e, runId: unknown) => {
    const { db } = scanCtx();
    const run = scan.getRun(db, Number(runId));
    // Prefer the drive copy (travels with the archive); fall back to the local copy in the app-managed
    // tree when the drive is unplugged — report_local_path is ALWAYS on local disk (Phase 3 double-save),
    // so reviewing a past scan works whether or not the drive is connected.
    const src = run.report_path && fs.existsSync(run.report_path) ? run.report_path
      : run.report_local_path && fs.existsSync(run.report_local_path) ? run.report_local_path
      : null;
    if (!src) return { ok: false, error: "No report file on disk." };
    try {
      return { ok: true, path: src, content: fs.readFileSync(src, "utf8") };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  // Logged-issues detail for the errors modal — the scan_errors rows for a run.
  safeHandle("scan:listErrors", (_e, runId: unknown) => {
    const { db } = scanCtx();
    return scan.listErrors(db, Number(runId));
  });

  // --- Scan Notes — per-folder notes, the folder-rename engine, and the Updated Notes feed. Every
  // handler is a thin pass-through: validation, the transaction and the plain-sentence failures all
  // live in the service, so this block stays a wiring list. ---
  safeHandle("scan:notesTree", () => {
    const { db, orgId } = scanCtx();
    return scanNotes.driveTree(db, orgId, scanNotes.currentVolumes());
  });
  // The tree's backfill and scroll page — one drive at a time, so the first paint never waits on a
  // drive with eight hundred folders in it.
  safeHandle("scan:notesFolders", (_e, driveId: unknown, offset: unknown, limit: unknown) => {
    const { db, orgId } = scanCtx();
    return scanNotes.driveFolders(db, orgId, driveId, Number(offset) || 0, Number(limit) || 400);
  });
  safeHandle("scan:notesList", (_e, driveId: unknown, folderPath: unknown) => {
    const { db, orgId } = scanCtx();
    return scanNotes.listNotes(
      db,
      orgId,
      driveId == null ? null : Number(driveId),
      typeof folderPath === "string" ? folderPath : undefined
    );
  });
  safeHandle("scan:notesGet", (_e, uuid: unknown) => {
    const { db, orgId } = scanCtx();
    return scanNotes.getNote(db, orgId, uuid);
  });
  safeHandle("scan:notesCreate", (_e, driveId: unknown, folderPath: unknown, title: unknown, body: unknown) => {
    const { db, orgId } = scanCtx();
    const note = scanNotes.createNote(db, orgId, {
      driveId: driveId == null ? null : Number(driveId),
      folderPath,
      title,
      body,
    });
    sendNotesChanged();
    return note;
  });
  // The autosave target. NO push — a push per keystroke would loop the renderer back into a re-read.
  safeHandle("scan:notesSave", (_e, uuid: unknown, title: unknown, body: unknown) => {
    const { db, orgId } = scanCtx();
    return scanNotes.saveNote(db, orgId, { uuid, title, body });
  });
  safeHandle("scan:notesArchive", (_e, uuid: unknown) => {
    const { db, orgId } = scanCtx();
    const r = scanNotes.archiveNote(db, orgId, uuid);
    sendNotesChanged();
    return r;
  });
  safeHandle("scan:notesSearch", (_e, q: unknown) => {
    const { db, orgId } = scanCtx();
    return scanNotes.searchNotes(db, orgId, q);
  });
  safeHandle("scan:notesSearchFolders", (_e, q: unknown) => {
    const { db, orgId } = scanCtx();
    return scanNotes.searchFolders(db, orgId, q);
  });
  safeHandle("scan:notesCard", (_e, folderPath: unknown) => {
    const { db, orgId } = scanCtx();
    return scanNotes.folderCard(db, orgId, folderPath);
  });
  safeHandle("scan:notesHistory", (_e, folderPath: unknown) => {
    const { db, orgId } = scanCtx();
    return scanNotes.folderHistory(db, orgId, folderPath);
  });
  // THE ONE DESTRUCTIVE CHANNEL in this feature. The service refuses before it touches the disk and
  // returns the refusal as data — a bad name is never an exception the user reads as a crash.
  safeHandle("scan:notesRename", (_e, folderPath: unknown, newName: unknown) => {
    const { db, orgId } = scanCtx();
    const r = scanNotes.renameFolder(db, orgId, { folderPath, newName }, scanNotes.currentVolumes());
    sendNotesChanged();
    return r;
  });
  safeHandle("scan:notesPendingRenames", () => {
    const { db, orgId } = scanCtx();
    return scanNotes.pendingRenameCount(db, orgId);
  });
  safeHandle("scan:notesUpdates", (_e, limit: unknown) => {
    const { db, orgId } = scanCtx();
    return scanNotes.listUpdates(db, orgId, limit == null ? 200 : Number(limit));
  });
  safeHandle("scan:notesRecent", (_e, limit: unknown) => {
    const { db, orgId } = scanCtx();
    return scanNotes.recentFolders(db, orgId, limit == null ? 12 : Number(limit));
  });
  safeHandle("scan:notesUnseen", () => {
    const { db, orgId } = scanCtx();
    return scanNotes.unseenUpdateCount(db, orgId);
  });
  safeHandle("scan:notesMarkSeen", () => {
    const { db, orgId } = scanCtx();
    return scanNotes.markUpdatesSeen(db, orgId);
  });
  // Manual refresh — the same work the reconnect consumer does, on demand: drain every connected
  // drive's queue, then rewrite both trees for every drive on record.
  safeHandle("scan:notesSync", () => {
    const { db, orgId } = scanCtx();
    const volumes = scanNotes.currentVolumes();
    const drained = scanNotes.drainQueue(db, orgId, volumes);
    const swept = scanNotes.syncAll(db, orgId, volumes);
    sendNotesChanged();
    return { ...drained, filesWritten: drained.filesWritten + swept.filesWritten };
  });
  safeHandle("scan:notesShortcut", () => {
    const { db, orgId } = scanCtx();
    return scanNotes.createDesktopShortcut(db, orgId);
  });
  safeHandle("scan:notesLocalRoot", () => scanNotes.localTreeRoot());
  // Media browsing — LOOKING only. Stills come back as data URLs under the existing img-src;
  // video and audio get an frmedia: URL, whose handler re-runs the same guards main-side.
  safeHandle("scan:notesMedia", (_e, folderPath: unknown) => {
    const { db, orgId } = scanCtx();
    return scanMedia.listFolderMedia(db, orgId, folderPath);
  });
  safeHandle("scan:notesImage", async (_e, target: unknown) => {
    const { db, orgId } = scanCtx();
    return scanMedia.readImage(db, orgId, target);
  });
  // THE WALL'S path — tile-sized and cached. `scan:notesImage` above stays the VIEWER's path
  // and returns the full image, because zoom needs the pixels this one deliberately throws away.
  safeHandle("scan:notesStillThumb", async (_e, target: unknown, token: unknown) => {
    const { db, orgId } = scanCtx();
    return scanMedia.readStillThumb(db, orgId, target, token);
  });
  // CANCELLATION. Calling this issues a fresh token and thereby abandons every job carrying an
  // older one — the renderer does not have to know what is outstanding. It is called on folder
  // change, on module change and on teardown.
  safeHandle("scan:notesJobToken", () => {
    // LOGGED ON EVERY ISSUE, so "cancellation works" is a number in the log rather than a claim.
    // Reading it here also means the device gate produces the evidence as a side effect of use.
    const s = scanJobs.stats();
    if (s.started > 0) {
      const t = scanSiblings.tallySnapshot();
      console.info(
        `[scan-notes] jobs since last folder — started ${s.started}, completed ${s.completed}, ` +
          `abandoned ${s.abandoned}`
      );
      // The Phase 3 tally, logged beside the job counts so one folder change reports both and the
      // "reported the tally" requirement is satisfied by using the app rather than by a claim.
      console.info(
        `[scan-notes] RAW siblings — reused ${t.reused}, no-sibling ${t["no-sibling"]}, ` +
          `ambiguous ${t.ambiguous}, time-mismatch ${t["time-mismatch"]}`
      );
      scanSiblings.resetTally();
    }
    scanJobs.resetStats();
    return scanJobs.nextToken();
  });
  // The counters behind the cancellation, so "it cancels" can be a number rather than a claim.
  safeHandle("scan:notesJobStats", (_e, reset: unknown) => {
    const s = scanJobs.stats();
    if (reset === true) scanJobs.resetStats();
    return s;
  });
  /** Upper bound on ONE thumbsGet call. This is no longer a ceiling on a folder — the renderer
   *  now chunks its cache lookup and calls this repeatedly, so the bound is on the BATCH, which is
   *  the thing that actually matters here: `getMany` is a synchronous loop of statSync + readFileSync
   *  on the thread that owns every window, and it returns base64 in the reply. Both cost scale with
   *  the array length, so bounding the array bounds the block AND the payload.
   *
   *  It used to be 2000 and sat silently below a folder that could legitimately exceed it. */
  const THUMBS_MAX = 500;
  // THE THUMBNAIL CACHE. One call per FOLDER, not per tile — that is the whole point: a warm folder
  // opens on one round trip with no decoders at all. Both directions run the same guard every other
  // media path runs, so a renderer bug cannot turn this into "hash any file on this machine".
  safeHandle("scan:thumbsGet", (_e, targets: unknown) => {
    // NOTHING HERE MAY THROW. A rejected invoke lands in the renderer's folder-load chain, and a
    // CACHE failure that empties the media grid is the exact inversion this cache exists to avoid.
    // An empty object is a miss for every tile; they generate as usual.
    try {
      if (!Array.isArray(targets)) return {};
      const { db, orgId } = scanCtx();
      // Clamped like listFolderMedia. The guard below is a database lookup, not a filesystem touch,
      // but an unbounded array is still an unbounded synchronous loop on the window-owning thread.
      const allowed = targets
        .slice(0, THUMBS_MAX)
        .filter((t): t is string => typeof t === "string" && scanMedia.isUnderScannedDrive(db, orgId, t));
      return scanThumbs.getMany(allowed);
    } catch (e) {
      console.warn("[scan-notes] thumb cache lookup failed; every tile will generate:", e);
      return {};
    }
  });
  safeHandle("scan:thumbsPut", (_e, target: unknown, dataUrl: unknown) => {
    try {
      if (typeof target !== "string" || typeof dataUrl !== "string") return false;
      if (!dataUrl.startsWith("data:image/jpeg;base64,")) return false; // this cache stores frames, nothing else
      const { db, orgId } = scanCtx();
      if (!scanMedia.isPlayablePath(db, orgId, target)) return false;
      scanThumbs.put(target, dataUrl);
      return true;
    } catch (e) {
      console.warn("[scan-notes] thumb cache write refused:", e);
      return false;
    }
  });
  // THE FAILURE LOG. Same guard, same clamp, same never-throw discipline as the cache above: a log
  // that can empty the media grid is worse than no log, and that inversion has already happened once
  // in this module (a rejected thumbsGet rendered "No media recorded in this folder").
  // SHOW IN EXPLORER, for one media file. shell.showItemInFolder REVEALS AND SELECTS rather than
  // opening, which is the only safe shape here: openPath on a file would LAUNCH it, and this channel
  // takes a path from the renderer. Guarded exactly like every other media path — the file must sit
  // under a drive this org actually scanned, so the channel cannot reveal arbitrary files.
  safeHandle("scan:revealMedia", (_e, target: unknown) => {
    try {
      if (typeof target !== "string" || target === "") return { ok: false, error: "no path" };
      const { db, orgId } = scanCtx();
      if (!scanMedia.isUnderScannedDrive(db, orgId, target)) return { ok: false, error: "outside any scanned drive" };
      if (!fs.existsSync(target)) return { ok: false, error: "that file is no longer there — the drive may be unplugged" };
      void shell.showItemInFolder(target);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  safeHandle("scan:thumbFailuresGet", (_e, targets: unknown) => {
    try {
      if (!Array.isArray(targets)) return {};
      const { db, orgId } = scanCtx();
      const allowed = targets
        .slice(0, THUMBS_MAX)
        .filter((t): t is string => typeof t === "string" && scanMedia.isUnderScannedDrive(db, orgId, t));
      return scanThumbFails.getMany(allowed);
    } catch (e) {
      console.warn("[scan-notes] failure log lookup failed; every tile attempts as usual:", e);
      return {};
    }
  });
  safeHandle("scan:thumbFailurePut", (_e, target: unknown, reason: unknown, detail: unknown) => {
    try {
      if (typeof target !== "string" || typeof detail !== "string") return false;
      if (reason !== "transient" && reason !== "permanent" && reason !== "unknown") return false;
      // AUDIO IS NEVER A THUMBNAIL FAILURE. An .mp3 has no video track to capture, so there is
      // nothing for it to fail AT. The renderer already refuses to queue one; this refuses to
      // record one, so a future caller cannot reintroduce the lie from the other side.
      if (scanMedia.isAudioPath(target)) return false;
      const { db, orgId } = scanCtx();
      if (!scanMedia.isPlayablePath(db, orgId, target)) return false;
      scanThumbFails.record(target, reason, detail);
      return true;
    } catch (e) {
      console.warn("[scan-notes] failure log record refused:", e);
      return false;
    }
  });
  safeHandle("scan:thumbFailuresClear", (_e, targets: unknown) => {
    try {
      if (!Array.isArray(targets)) return false;
      const { db, orgId } = scanCtx();
      const allowed = targets
        .slice(0, THUMBS_MAX)
        .filter((t): t is string => typeof t === "string" && scanMedia.isUnderScannedDrive(db, orgId, t));
      scanThumbFails.clear(allowed);
      return true;
    } catch (e) {
      console.warn("[scan-notes] failure log clear refused:", e);
      return false;
    }
  });
  // The frmedia: handler resolves its org LAZILY, on every request — an org minted mid-session by
  // the first-run wizard must not leave the scheme permanently dead.
  scanMedia.installMediaProtocol(() => {
    try {
      return scanCtx();
    } catch {
      return null;
    }
  });

  // --- Rename — copies only; never renames/moves/deletes an original. Long jobs stream over
  // rename:progress; the batch survives navigation and the renderer rejoins a 'running' batch. ---
  try {
    renameCtx();
  } catch {
    /* no active org yet — lazy init covers post-wizard */
  }
  // Read-only gather for the live preview: walk the chosen source folders and return the media files.
  safeHandle("rename:gather", (_e, sources: unknown) =>
    rename.gatherSources(Array.isArray(sources) ? sources.map((s) => String(s)) : [])
  );
  safeHandle("rename:isDriveRoot", (_e, p: unknown) => rename.isDriveRoot(String(p ?? "")));
  safeHandle("rename:listBatches", () => {
    const { db, orgId } = renameCtx();
    return rename.listBatches(db, orgId);
  });
  safeHandle("rename:getBatch", (_e, id: unknown) => {
    const { db, orgId } = renameCtx();
    return rename.getBatch(db, orgId, Number(id));
  });
  safeHandle("rename:batchSample", (_e, id: unknown) => {
    const { db, orgId } = renameCtx();
    return rename.batchSample(db, orgId, Number(id));
  });
  safeHandle("rename:revertMapping", (_e, id: unknown) => {
    const { db, orgId } = renameCtx();
    return rename.revertMapping(db, orgId, Number(id));
  });
  // Fire-and-forget copy job. Validates the drive-root guard synchronously for an immediate answer;
  // the engine re-guards as a backstop. Progress + the batchId flow over rename:progress.
  safeHandle("rename:start", (_e, payload: unknown) => {
    const { db, orgId } = renameCtx();
    const a = (payload ?? {}) as { sources?: unknown; destination?: unknown; settings?: RenameSettings };
    const sources = Array.isArray(a.sources) ? a.sources.map((s) => String(s)).filter(Boolean) : [];
    const destination = String(a.destination ?? "");
    const settings = a.settings as RenameSettings;
    if (sources.length === 0) return { ok: false, error: "Add at least one source folder." };
    if (!destination) return { ok: false, error: "Choose a destination folder." };
    for (const s of sources) if (rename.isDriveRoot(s)) return { ok: false, error: `"${s}" is a drive root — choose a folder inside the drive.` };
    if (rename.isDriveRoot(destination)) return { ok: false, error: `The destination "${destination}" is a drive root.` };
    rename.saveLastUsed(db, orgId, settings);
    void rename.startRename(db, orgId, { sources, destination, settings, onProgress: sendRenameProgress }).catch((e) => {
      getMainWindow()?.webContents.send("rename:progress", {
        batchId: -1, status: "error", currentFile: null, total: 0, copied: 0, skipped: 0, errored: 0,
        error: e instanceof Error ? e.message : String(e),
      } satisfies rename.RenameProgress);
    });
    return { ok: true };
  });
  safeHandle("rename:abort", (_e, batchId: unknown) => ({ ok: rename.requestAbort(Number(batchId)) }));
  // Fire-and-forget revert — restores originals to a NEW destination (third file set).
  safeHandle("rename:startRevert", (_e, payload: unknown) => {
    const { db, orgId } = renameCtx();
    const a = (payload ?? {}) as { batchId?: unknown; copiesFolder?: unknown; destination?: unknown };
    const copiesFolder = String(a.copiesFolder ?? "");
    const destination = String(a.destination ?? "");
    if (!copiesFolder || !destination) return { ok: false, error: "Choose the copies folder and a destination." };
    if (rename.isDriveRoot(destination)) return { ok: false, error: `The destination "${destination}" is a drive root.` };
    void rename.startRevert(db, orgId, { batchId: Number(a.batchId), copiesFolder, destination, onProgress: sendRenameProgress }).catch((e) => {
      getMainWindow()?.webContents.send("rename:progress", {
        batchId: -1, status: "error", currentFile: null, total: 0, copied: 0, skipped: 0, errored: 0,
        error: e instanceof Error ? e.message : String(e),
      } satisfies rename.RenameProgress);
    });
    return { ok: true };
  });
  safeHandle("rename:listPresets", () => {
    const { db, orgId } = renameCtx();
    return rename.listPresets(db, orgId);
  });
  safeHandle("rename:savePreset", (_e, name: unknown, settings: unknown) => {
    const { db, orgId } = renameCtx();
    rename.savePreset(db, orgId, String(name ?? ""), settings as RenameSettings);
    return { ok: true };
  });
  safeHandle("rename:deletePreset", (_e, id: unknown) => {
    const { db, orgId } = renameCtx();
    rename.deletePreset(db, orgId, Number(id));
    return { ok: true };
  });
  // Native folder picker + reveal — same guarded pattern as Scan/Storage.
  safeHandle("rename:pickFolder", async (_e, title: unknown) => {
    const win = getMainWindow();
    const opts = { properties: ["openDirectory" as const], title: typeof title === "string" ? title : "Choose a folder" };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
  });
  safeHandle("rename:openFolder", (_e, p: unknown) => {
    const dir = String(p ?? "");
    if (dir) void shell.openPath(dir);
    return { ok: true };
  });

  // scout-viewer module — Fortified Browser engine (services/scout-viewer). Sender-verified: only
  // the shell window's own webContents may drive the engine (ported guard from the prototype);
  // the service re-validates every payload (URL scheme, clientId charset, bounds clamp) after this.
  const fromShell = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean =>
    event.sender === getMainWindow()?.webContents;
  safeOn("scout:visible", (e, v: unknown) => {
    if (fromShell(e)) scout.setModuleVisible(v === true);
  });
  safeOn("scout:bounds", (e, raw: unknown) => {
    if (fromShell(e)) scout.setBounds(raw);
  });
  safeOn("scout:navigate", (e, raw: unknown) => {
    if (fromShell(e)) scout.navigate(raw);
  });
  safeOn("scout:back", (e) => {
    if (fromShell(e)) scout.goBack();
  });
  safeOn("scout:forward", (e) => {
    if (fromShell(e)) scout.goForward();
  });
  safeOn("scout:reload", (e) => {
    if (fromShell(e)) scout.reload();
  });
  safeOn("scout:stop", (e) => {
    if (fromShell(e)) scout.stopLoad();
  });
  safeOn("scout:shell-overlay", (e, open: unknown) => {
    if (fromShell(e)) scout.setShellOverlay(open === true);
  });
  safeOn("scout:modal", (e, open: unknown) => {
    if (fromShell(e)) scout.setModalOpen(open === true);
  });
  safeOn("scout:switch-tab", (e, clientId: unknown, url: unknown) => {
    if (fromShell(e)) void scout.switchClientTab(clientId, url);
  });
  safeHandle("scout:dom-read", (e) => (fromShell(e) ? scout.domRead() : null));

  // scout target CRUD — same sender gate; the service validates every raw unknown arg (name
  // non-empty, url http(s)-only, id integer) before it reaches SQL. client_id is service-minted.
  safeHandle("scout:targets:list", (e) => (fromShell(e) ? scoutTargets.listTargets() : null));
  safeHandle("scout:targets:create", (e, name: unknown, url: unknown) =>
    fromShell(e) ? scoutTargets.createTarget(name, url) : null
  );
  safeHandle("scout:targets:update", (e, id: unknown, name: unknown, url: unknown) =>
    fromShell(e) ? scoutTargets.updateTarget(id, name, url) : null
  );
  safeHandle("scout:targets:delete", (e, id: unknown) => {
    if (fromShell(e)) scoutTargets.deleteTarget(id);
  });

}
