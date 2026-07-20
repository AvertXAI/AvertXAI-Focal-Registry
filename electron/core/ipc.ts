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
import { app, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { defaultSettings, type ShredderSettings } from "../../src/modules/runbook-shredder/config.manifest";
import { getDb } from "./services/db";
import { getActiveOrg } from "./services/db/registry";
import * as dataviewer from "./services/dataviewer";
import * as firstrun from "./services/firstrun";
import * as modules from "./services/modules";
import * as shredderApi from "./services/runbook-shredder/api";
import { ingestAll, startShredder, type ShredderHandle } from "./services/runbook-shredder/shredder";
import * as scout from "./services/scout-viewer";
import * as scoutTargets from "./services/scout-viewer/targets";
import * as scan from "./services/scan";
import * as scanDrives from "./services/scan/drives";
import * as scanReport from "./services/scan/report";
import { ensureScanSchema } from "./services/scan/db";
import { generateUUIDv7 } from "./services/utils/uuidv7";
import * as settings from "./services/settings";
import { applyThemeOverlay, getMainWindow, setOverlayDim } from "./windows";

// --- Runbook Shredder host — root-side glue ONLY. The service stays electron-free: orgId, baseDir
// (userData, where the module's own .db lives) and settings are injected from here. Lazy so it
// works both at normal boot and in the session right after the First-Run wizard mints the org.
let shredderHandle: ShredderHandle | null = null;

// Manifest defaults overlaid with persisted app_settings rows — root owns persistence
// ("Expose, Don't Connect"); the module never reads app_settings itself.
function readShredderSettings(): ShredderSettings {
  const s = defaultSettings();
  const rows = getDb()
    .prepare("SELECT key, value FROM app_settings WHERE key LIKE 'runbook-shredder.%'")
    .all() as { key: string; value: string }[];
  for (const { key, value } of rows) {
    if (key === "runbook-shredder.watch_path") s[key] = value;
    else if (key === "runbook-shredder.watch_enabled" || key === "runbook-shredder.auto_reparse")
      s[key] = value === "1";
  }
  return s;
}

export function ensureShredder(): ShredderHandle {
  if (shredderHandle) return shredderHandle;
  const org = getActiveOrg();
  if (!org) throw new Error("Runbook Shredder: no active org");
  shredderHandle = startShredder({
    orgId: org.org_id,
    baseDir: app.getPath("userData"),
    settings: readShredderSettings(),
  });
  return shredderHandle;
}

// B4 — re-point the engine when watch_path / watch_enabled changes: stop the old watcher, then
// rebuild from the freshly-persisted settings (openShredderDb is cached, so the same DB carries
// over; startShredder re-ingests + re-watches). Empty watch_path → engine stays idle.
export function restartShredder(): void {
  if (!getActiveOrg()) return;
  shredderHandle?.stop();
  shredderHandle = null;
  ensureShredder();
}

// Full re-ingest of the current watch folder on demand; returns live ok/error counts for the UI.
function rescanShredder(): { ingested: number; quarantined: number } {
  const h = ensureShredder();
  const watchPath = readShredderSettings()["runbook-shredder.watch_path"];
  if (watchPath && fs.existsSync(watchPath)) ingestAll(h.db, watchPath);
  const count = (status: string): number =>
    (h.db.prepare("SELECT COUNT(*) AS n FROM runbooks WHERE parse_status = ?").get(status) as { n: number }).n;
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
    scan.markInterruptedRuns(db); // any run still 'running' at service start is a crash
    scanInit = true;
  }
  return { db, orgId: org.org_id };
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

// --- handlers ---

export function registerIpcHandlers(): void {
  // Scan service start — pre-org boot (first-run wizard) skips; lazy init covers post-wizard.
  try {
    scanCtx();
  } catch {
    /* no active org yet */
  }
  // data viewer — READ-ONLY introspection. The service whitelists `table` against sqlite_master and
  // clamps limit/offset, so the raw `unknown` args can't reach a writable or injectable statement.
  ipcMain.handle("db:tables", () => dataviewer.listTables());
  ipcMain.handle("db:columns", (_e, table: unknown) => dataviewer.getColumns(table));
  ipcMain.handle("db:rows", (_e, table: unknown, limit: unknown, offset: unknown) =>
    dataviewer.getRows(table, limit, offset)
  );
  ipcMain.handle("db:fks", (_e, table: unknown) => dataviewer.getForeignKeys(table));
  ipcMain.handle("dataviewer:getDevMode", () => dataviewer.getDevMode());
  ipcMain.handle("dataviewer:setDevMode", (_e, on: unknown) => dataviewer.setDevMode(on === true));

  // first-run wizard — service validates orgName, then seeds settings + modules in one transaction.
  ipcMain.handle("firstRun:get", () => firstrun.getFirstRunStatus());
  ipcMain.handle("firstRun:complete", (_e, orgName: unknown) => firstrun.completeFirstRun(orgName));

  // module registry — Config-as-Data rows that drive the renderer nav + routing.
  ipcMain.handle("modules:get", () => modules.listModules());

  // platform settings — key-whitelisted app_settings access (service rejects unknown keys).
  ipcMain.handle("settings:get", (_e, key: unknown) => settings.getSetting(key));
  ipcMain.handle("settings:set", (_e, key: unknown, value: unknown) => {
    settings.setSetting(key, value);
    // B4: persisting a shredder watch setting re-points the fs.watch engine at the new folder.
    if (key === "runbook-shredder.watch_path" || key === "runbook-shredder.watch_enabled") restartShredder();
  });

  // Native window-control overlay tint. The window is born in the JARVIS boot navy; the renderer
  // drives every later tint (shell mount + theme flips) through this single channel.
  ipcMain.handle("theme:modalDim", (_e, on: unknown) => setOverlayDim(on === true));
  ipcMain.handle("theme:overlay", (_e, mode: unknown) =>
    applyThemeOverlay(typeof mode === "string" ? mode : null)
  );

  // runbook-shredder module (shredder:*).
  // Read-only queries; the service whitelists filter keys and escapes the FTS input, so the raw
  // renderer args can't reach SQL/FTS syntax.
  ipcMain.handle("shredder:list", (_e, filter: unknown) =>
    shredderApi.listRunbooks(
      ensureShredder().db,
      (typeof filter === "object" && filter !== null ? filter : {}) as shredderApi.RunbookFilter
    )
  );
  ipcMain.handle("shredder:get", (_e, id: unknown) => shredderApi.getRunbook(ensureShredder().db, String(id)));
  ipcMain.handle("shredder:search", (_e, q: unknown) =>
    shredderApi.search(ensureShredder().db, typeof q === "string" ? q : "")
  );
  ipcMain.handle("shredder:listQuarantined", () => shredderApi.listQuarantined(ensureShredder().db));

  // native folder picker → the chosen dir (or null on cancel); the renderer persists it via
  // settings:set, which re-points the engine (B4). rescan re-ingests the current folder on demand.
  ipcMain.handle("shredder:pickWatchFolder", async () => {
    const win = getMainWindow();
    const res = win
      ? await dialog.showOpenDialog(win, { properties: ["openDirectory"] })
      : await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
  });
  ipcMain.handle("shredder:rescan", () => rescanShredder());

  // scan module — READ-ONLY against sources; the only writes are rows in the org DB. Long-running
  // start/resume are fire-and-forget: progress flows over the scan:progress push, errors are pushed
  // as a status note, and the invoke returns immediately so the renderer never holds a pending
  // promise for hours.
  ipcMain.handle("scan:listDrives", () => scanDrives.listVolumes());
  ipcMain.handle("scan:selectSource", (_e, rootPath: unknown, scanUnit: unknown) => {
    const { db, orgId } = scanCtx();
    if (typeof rootPath !== "string" || rootPath.trim() === "") throw new Error("selectSource: rootPath required");
    return scanDrives.selectSource(db, orgId, rootPath, scanUnit === "drive" ? "drive" : "folder", generateUUIDv7, scan.RAW_MODE);
  });
  ipcMain.handle("scan:probe", (_e, rootPath: unknown, scanUnit: unknown) => {
    const { db, orgId } = scanCtx();
    if (typeof rootPath !== "string" || rootPath.trim() === "") throw new Error("probe: rootPath required");
    const unit = scanUnit === "drive" ? "drive" : "folder";
    const drive = scanDrives.resolveDrive(db, orgId, scanDrives.volumeForPath(rootPath), generateUUIDv7);
    const run = scan.createRun(db, orgId, drive.id, rootPath, unit);
    // Fire-and-forget EXACT counting walk (Phase 4) — returns the runId immediately; the exact
    // folder/media counts arrive over scan:progress ('counting' → 'estimating'). No extrapolation.
    void scan.countRun(db, orgId, run.id, { onProgress: sendScanProgress }).catch((e) => {
      console.error("[scan] count failed:", e);
      sendScanProgress({ runId: run.id, status: "error", currentFolder: null, foldersCommitted: 0,
        filesRecorded: 0, errorsLogged: 0, estimatedFiles: null, note: e instanceof Error ? e.message : String(e) });
    });
    return { runId: run.id };
  });
  const launchRun = (runId: number, resume: boolean): { ok: true; runId: number } => {
    const { db, orgId } = scanCtx();
    scan
      .startRun(db, orgId, runId, { resume, onProgress: sendScanProgress })
      .then((finished) => {
        // On a clean completion write the report NOW — in the main process, so a run that finished
        // while the user was on another module still gets its report. A write failure is surfaced
        // as a terminal note; the run STAYS completed (the data is already committed).
        if (finished.status !== "completed") return;
        const result = scanReport.writeScanReport(db, runId);
        sendScanProgress({
          runId, status: "completed", currentFolder: null,
          foldersCommitted: finished.folders_committed, filesRecorded: finished.files_recorded,
          errorsLogged: finished.errors_logged, estimatedFiles: finished.estimated_files,
          reportPath: result.ok ? (result.path ?? null) : null,
          reportError: result.ok ? null : (result.error ?? "report write failed"),
        });
      })
      .catch((e) => {
        console.error("[scan] run failed:", e);
        sendScanProgress({
          runId, status: "error", currentFolder: null, foldersCommitted: 0, filesRecorded: 0,
          errorsLogged: 0, estimatedFiles: null, note: e instanceof Error ? e.message : String(e),
        });
      });
    return { ok: true, runId };
  };
  ipcMain.handle("scan:start", (_e, runId: unknown) => launchRun(Number(runId), false));
  ipcMain.handle("scan:resume", (_e, runId: unknown) => launchRun(Number(runId), true));
  ipcMain.handle("scan:pause", (_e, runId: unknown) => scan.requestPause(Number(runId)));
  ipcMain.handle("scan:abort", (_e, runId: unknown) => {
    const { db } = scanCtx();
    return scan.requestAbort(db, Number(runId));
  });
  ipcMain.handle("scan:status", (_e, runId: unknown) => {
    const { db } = scanCtx();
    return scan.runStatus(db, Number(runId));
  });
  ipcMain.handle("scan:listRuns", () => {
    const { db, orgId } = scanCtx();
    return scan.listRuns(db, orgId);
  });
  // Last run for a volume serial — drives the "already scanned → show the report" path (serial is
  // identity, not the letter) and Option B's populated dashboard.
  ipcMain.handle("scan:lastRunForVolume", (_e, serial: unknown) => {
    const { db, orgId } = scanCtx();
    if (typeof serial !== "string") return null;
    return scan.lastRunForVolume(db, orgId, serial);
  });
  // Folder rollups for Option B's populated view (top-level folders of a run).
  ipcMain.handle("scan:folders", (_e, runId: unknown) => {
    const { db } = scanCtx();
    return scan.listFolders(db, Number(runId));
  });
  // Manual report (re)write — used by the UI if the auto-write on completion failed. Returns the
  // path or an error string; never throws.
  ipcMain.handle("scan:writeReport", (_e, runId: unknown) => {
    const { db } = scanCtx();
    return scanReport.writeScanReport(db, Number(runId));
  });
  // Open the report file / the reports folder in the OS. openPath never throws; returns "" on ok.
  ipcMain.handle("scan:openReport", (_e, runId: unknown) => {
    const { db } = scanCtx();
    const run = scan.getRun(db, Number(runId));
    if (!run.report_path) return { ok: false, error: "no report on this run" };
    void shell.showItemInFolder(run.report_path); // reveals + selects; the safe cross-format open
    return { ok: true };
  });
  ipcMain.handle("scan:openReportsFolder", (_e, runId: unknown) => {
    const { db } = scanCtx();
    const run = scan.getRun(db, Number(runId));
    const dir = run.report_path
      ? path.dirname(run.report_path)
      : path.join(path.parse(path.resolve(run.root_path)).root, scanReport.REPORTS_FOLDER_NAME);
    void shell.openPath(dir);
    return { ok: true };
  });

  // scout-viewer module — Fortified Browser engine (services/scout-viewer). Sender-verified: only
  // the shell window's own webContents may drive the engine (ported guard from the prototype);
  // the service re-validates every payload (URL scheme, clientId charset, bounds clamp) after this.
  const fromShell = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean =>
    event.sender === getMainWindow()?.webContents;
  ipcMain.on("scout:visible", (e, v: unknown) => {
    if (fromShell(e)) scout.setModuleVisible(v === true);
  });
  ipcMain.on("scout:bounds", (e, raw: unknown) => {
    if (fromShell(e)) scout.setBounds(raw);
  });
  ipcMain.on("scout:navigate", (e, raw: unknown) => {
    if (fromShell(e)) scout.navigate(raw);
  });
  ipcMain.on("scout:back", (e) => {
    if (fromShell(e)) scout.goBack();
  });
  ipcMain.on("scout:forward", (e) => {
    if (fromShell(e)) scout.goForward();
  });
  ipcMain.on("scout:reload", (e) => {
    if (fromShell(e)) scout.reload();
  });
  ipcMain.on("scout:stop", (e) => {
    if (fromShell(e)) scout.stopLoad();
  });
  ipcMain.on("scout:modal", (e, open: unknown) => {
    if (fromShell(e)) scout.setModalOpen(open === true);
  });
  ipcMain.on("scout:switch-tab", (e, clientId: unknown, url: unknown) => {
    if (fromShell(e)) void scout.switchClientTab(clientId, url);
  });
  ipcMain.handle("scout:dom-read", (e) => (fromShell(e) ? scout.domRead() : null));

  // scout target CRUD — same sender gate; the service validates every raw unknown arg (name
  // non-empty, url http(s)-only, id integer) before it reaches SQL. client_id is service-minted.
  ipcMain.handle("scout:targets:list", (e) => (fromShell(e) ? scoutTargets.listTargets() : null));
  ipcMain.handle("scout:targets:create", (e, name: unknown, url: unknown) =>
    fromShell(e) ? scoutTargets.createTarget(name, url) : null
  );
  ipcMain.handle("scout:targets:update", (e, id: unknown, name: unknown, url: unknown) =>
    fromShell(e) ? scoutTargets.updateTarget(id, name, url) : null
  );
  ipcMain.handle("scout:targets:delete", (e, id: unknown) => {
    if (fromShell(e)) scoutTargets.deleteTarget(id);
  });

}
