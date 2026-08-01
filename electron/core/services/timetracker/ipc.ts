// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: TimeTracker IPC registration — thin timetracker:* handlers that validate renderer
//              input (validate.ts, the money-surface trust boundary) then call the Phase 1
//              services with (db, orgId, …). Electron-only concerns (dialog, shell) live HERE,
//              never in the services. Also the module's main-side service start: crash-recovery
//              capture runs BEFORE the first ticker heartbeat (order-critical), then the ONE
//              authoritative 1s ticker pushes timetracker:tick / 5s heartbeats while sessions
//              exist. Deferred scope (CSV, PDF export) is deliberately NOT registered.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/timetracker/ipc.ts
//------------------------------------------------------------
import { app, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../db";
import { getActiveOrg } from "../db/registry";
import * as storage from "../storage";
import { getMainWindow } from "../../windows";
import type { Db } from "./db";
import * as projects from "./projects";
import * as groups from "./groups";
import * as timer from "./timer";
import * as ledger from "./ledger";
import * as costs from "./costs";
import * as adjustments from "./adjustments";
import * as eventLog from "./eventLog";
import * as reports from "./reports";
import * as sounds from "./sounds";
import * as settings from "./settings";
import * as license from "./license";
import * as attention from "./attention";
import { closeMiniTimer, forwardToMini, isMiniOpen, openMiniTimer, resizeMiniFor, wasMiniOpen } from "./mini-window";
import { setBundledSoundsDir, setTimeTrackerStorageRoot } from "./paths";
import {
  REPORT_GRANULARITIES,
  REPORT_RANGES,
  TIME_MODES,
  vAdjustmentUuid,
  vAmount,
  vColor,
  vCostInput,
  vDeltaMinutes,
  vEnum,
  vId,
  vNullableId,
  vNullableString,
  vProjectInput,
  vString,
} from "./validate";

// Local copy of core/ipc.ts's resilient registrar (it is module-local there; a cross-import would
// make core/ipc.ts and this file circular). Same semantics: one failed registration never silently
// kills the rest, and the failure is logged LOUDLY with its channel name.
function safeHandle(channel: string, listener: Parameters<typeof ipcMain.handle>[1]): void {
  try {
    ipcMain.handle(channel, listener);
  } catch (e) {
    console.error(`[ipc] FAILED to register handler '${channel}':`, e);
  }
}

// --- service start (one-shot, scan precedent: lazy ctx + eager call at register time) ---
// ⚠ ORDER-CRITICAL: timer.captureInterrupted() MUST run before the ticker's first heartbeatAll()
// write, or fresh heartbeats overwrite the stale ones and the recovery list comes up silently
// empty. Sessions outlive module navigation, so none of this can wait for the module to open.
let started = false;
let tickerHandle: ReturnType<typeof setInterval> | null = null;
let tickCount = 0;
// PDFs exported THIS session — the only paths timetracker:revealExportedPdf will hand to the OS.
const exportedPdfPaths = new Set<string>();

function ttCtx(): { db: Db; orgId: string } {
  const org = getActiveOrg();
  if (!org) throw new Error("TimeTracker: no active org");
  const db = getDb();
  if (!started) {
    started = true;
    // File storage under the managed markdown tree: <root>\MissionControl\Focal-Registry\TimeTracker\
    // (contracts/ and sounds/ are created beneath it on first use — FR-DECISIONS §TimeTracker).
    try {
      setTimeTrackerStorageRoot(path.join(storage.focalRegistryDir(storage.resolveMarkdownRoot()), "TimeTracker"));
    } catch (e) {
      console.error("[timetracker] storage root unresolved — contract/sound file features disabled:", e);
    }
    // Bundled alert sounds ship inside the package (build.files "assets/sounds/**") — asar-safe:
    // app.getAppPath() resolves into the asar and Electron's patched fs lists/reads inside it.
    setBundledSoundsDir(path.join(app.getAppPath(), "assets", "sounds"));
    timer.captureInterrupted(db); // BEFORE the first heartbeat — see block comment above
    startTicker(db);
    // Attention engine (6B): 15s beat, reads settings LIVE each fire, prompts via the main window.
    attention.startAttentionEngine(db, org.org_id, (channel, payload) => {
      getMainWindow()?.webContents.send(channel, payload);
    });
    // Mini timer (6B): reopen at service start if it was open when the app last quit.
    if (wasMiniOpen(db)) openMiniTimer(timer.status(db).sessions.length);
  }
  return { db, orgId: org.org_id };
}

// THE one authoritative 1s ticker: batched tick payload to the renderer while sessions exist,
// heartbeats every 5th beat (the crash-recovery source). Quiet when no session is live.
function startTicker(db: Db): void {
  if (tickerHandle) return;
  tickerHandle = setInterval(() => {
    const payload = timer.tickPayload(db);
    if (payload.sessions.length === 0) return;
    tickCount += 1;
    if (tickCount % 5 === 0) timer.heartbeatAll(db);
    getMainWindow()?.webContents.send("timetracker:tick", payload);
    // Mini window (6B): same beat, and its height follows the session count main-side.
    forwardToMini("timetracker:tick", payload);
    resizeMiniFor(payload.sessions.length);
  }, 1000);
}

// Every timer mutation tells the renderer, so every surface re-reads status (source timerChanged()
// minus its tray update — the shell tray is Open/Exit only, never per-module).
function timerChanged(): void {
  getMainWindow()?.webContents.send("timetracker:changed");
  forwardToMini("timetracker:changed");
}

export function registerTimeTrackerIpc(): void {
  // Eager service start when an org exists (true service start — crash-marking before any UI asks);
  // pre-org boot (first-run wizard) skips, and the lazy ctx covers the post-wizard session.
  try {
    ttCtx();
  } catch {
    /* no active org yet */
  }

  // projects
  safeHandle("timetracker:listProjects", () => {
    const { db, orgId } = ttCtx();
    return projects.listProjects(db, orgId);
  });
  safeHandle("timetracker:createProject", (_e, input: unknown) => {
    const { db, orgId } = ttCtx();
    return projects.createProject(db, orgId, vProjectInput(input));
  });
  safeHandle("timetracker:updateProject", (_e, input: unknown) => {
    const { db, orgId } = ttCtx();
    const id = vId((input as Record<string, unknown>)?.id, "project id");
    return projects.updateProject(db, orgId, { ...vProjectInput(input), id });
  });
  safeHandle("timetracker:setProjectColor", (_e, id: unknown, color: unknown) => {
    const { db } = ttCtx();
    projects.setProjectColor(db, vId(id, "project id"), vColor(color));
  });
  safeHandle("timetracker:setProjectGroup", (_e, id: unknown, groupId: unknown) => {
    const { db } = ttCtx();
    projects.setProjectGroup(db, vId(id, "project id"), vNullableId(groupId, "group id"));
  });
  safeHandle("timetracker:setProjectTimeMode", (_e, id: unknown, mode: unknown) => {
    const { db } = ttCtx();
    projects.setTimeDisplayMode(db, vId(id, "project id"), vEnum(mode, TIME_MODES, "time display mode"));
  });
  safeHandle("timetracker:renameProject", (_e, id: unknown, name: unknown) => {
    const { db } = ttCtx();
    projects.renameProject(db, vId(id, "project id"), vString(name, "project name", 200, true));
  });
  safeHandle("timetracker:reorderProject", (_e, id: unknown, beforeId: unknown) => {
    const { db } = ttCtx();
    projects.reorderProject(db, vId(id, "project id"), vNullableId(beforeId, "target project id"));
  });
  safeHandle("timetracker:deleteProject", (_e, id: unknown) => {
    const { db } = ttCtx();
    projects.deleteProject(db, vId(id, "project id"));
  });
  safeHandle("timetracker:archiveProject", (_e, id: unknown, reason: unknown) => {
    const { db } = ttCtx();
    projects.archiveProject(db, vId(id, "project id"), vString(reason, "archive reason", 2000, true));
  });
  safeHandle("timetracker:restoreProject", (_e, id: unknown) => {
    const { db } = ttCtx();
    projects.restoreProject(db, vId(id, "project id"));
  });
  safeHandle("timetracker:listArchivedProjects", () => {
    const { db, orgId } = ttCtx();
    return projects.listArchivedProjects(db, orgId);
  });
  safeHandle("timetracker:purgeProject", (_e, id: unknown, reason: unknown) => {
    const { db, orgId } = ttCtx();
    return projects.purgeProject(db, orgId, vId(id, "project id"), vString(reason, "purge reason", 2000, true));
  });
  safeHandle("timetracker:projectDetail", (_e, id: unknown) => {
    const { db } = ttCtx();
    return projects.getProjectDetail(db, vId(id, "project id"));
  });
  safeHandle("timetracker:grandTotals", () => {
    const { db, orgId } = ttCtx();
    return projects.grandTotals(db, orgId);
  });
  safeHandle("timetracker:groupTotals", () => {
    const { db, orgId } = ttCtx();
    return projects.groupTotals(db, orgId);
  });

  // groups
  safeHandle("timetracker:listGroups", () => {
    const { db, orgId } = ttCtx();
    return groups.listGroups(db, orgId);
  });
  safeHandle("timetracker:createGroup", (_e, name: unknown, color: unknown) => {
    const { db, orgId } = ttCtx();
    return groups.createGroup(db, orgId, vString(name, "group name", 100, true), vColor(color));
  });
  safeHandle("timetracker:renameGroup", (_e, id: unknown, name: unknown) => {
    const { db } = ttCtx();
    groups.renameGroup(db, vId(id, "group id"), vString(name, "group name", 100, true));
  });
  safeHandle("timetracker:deleteGroup", (_e, id: unknown) => {
    const { db } = ttCtx();
    groups.deleteGroup(db, vId(id, "group id"));
  });
  safeHandle("timetracker:reorderGroup", (_e, id: unknown, beforeId: unknown) => {
    const { db } = ttCtx();
    groups.reorderGroup(db, vId(id, "group id"), vNullableId(beforeId, "target group id"));
  });

  // sidebar sort (ordering columns + one main-side app_settings key — never time data)
  safeHandle("timetracker:getSidebarSort", () => {
    const { db } = ttCtx();
    return groups.getSidebarSort(db);
  });
  safeHandle("timetracker:sortSidebar", (_e, dir: unknown) => {
    const { db } = ttCtx();
    groups.sortSidebarAlpha(db, vEnum(dir, ["asc", "desc"] as const, "sort direction"));
  });

  // costs
  safeHandle("timetracker:listCosts", (_e, projectId: unknown) => {
    const { db } = ttCtx();
    return costs.list(db, vId(projectId, "project id"));
  });
  safeHandle("timetracker:addCost", (_e, projectId: unknown, input: unknown) => {
    const { db, orgId } = ttCtx();
    return costs.add(db, orgId, vId(projectId, "project id"), vCostInput(input));
  });
  safeHandle("timetracker:updateCost", (_e, id: unknown, input: unknown) => {
    const { db } = ttCtx();
    return costs.update(db, vId(id, "cost id"), vCostInput(input));
  });
  safeHandle("timetracker:removeCost", (_e, id: unknown) => {
    const { db } = ttCtx();
    costs.remove(db, vId(id, "cost id"));
  });
  safeHandle("timetracker:openCostUrl", async (_e, id: unknown) => {
    const { db } = ttCtx();
    const url = costs.getUrl(db, vId(id, "cost id"));
    if (!url || !/^https?:\/\//i.test(url)) throw new Error("No URL on this cost line");
    await shell.openExternal(url);
  });

  // licence (Phase 6A) — hardcoded, offline, validated in the service. No network call exists.
  safeHandle("timetracker:getLicense", () => {
    const { db } = ttCtx();
    return license.getLicenseState(db);
  });
  safeHandle("timetracker:setLicenseKey", (_e, raw: unknown) => {
    const { db } = ttCtx();
    return license.setLicenseKey(db, vString(raw ?? "", "licence key", 40));
  });
  safeHandle("timetracker:setMarketplaceId", (_e, raw: unknown) => {
    const { db } = ttCtx();
    return license.setMarketplaceId(db, vString(raw ?? "", "marketplace id", 80));
  });

  // settings (typed + clamped through the service — NOT the generic settings channel)
  safeHandle("timetracker:getSettings", () => {
    const { db } = ttCtx();
    return settings.getSettings(db);
  });
  safeHandle("timetracker:saveSettings", (_e, input: unknown) => {
    const { db } = ttCtx();
    return settings.saveSettings(db, input);
  });

  // adjustments — own table only; never touches time_entries; never capped
  safeHandle("timetracker:listAdjustments", (_e, projectId: unknown) => {
    const { db } = ttCtx();
    return adjustments.list(db, vId(projectId, "project id"));
  });
  safeHandle("timetracker:listAllAdjustments", () => {
    const { db, orgId } = ttCtx();
    return adjustments.listAll(db, orgId);
  });
  safeHandle("timetracker:createAdjustment", (_e, projectId: unknown, delta: unknown, note: unknown) => {
    const { db, orgId } = ttCtx();
    return adjustments.create(db, orgId, vId(projectId, "project id"), vDeltaMinutes(delta), vString(note, "note", 2000, true));
  });
  safeHandle("timetracker:updateAdjustment", (_e, uuid: unknown, delta: unknown, note: unknown) => {
    const { db } = ttCtx();
    return adjustments.update(db, vAdjustmentUuid(uuid), vDeltaMinutes(delta), vString(note, "note", 2000, true));
  });
  safeHandle("timetracker:softDeleteAdjustment", (_e, uuid: unknown) => {
    const { db } = ttCtx();
    adjustments.softDelete(db, vAdjustmentUuid(uuid));
  });

  // activity — READ-ONLY; events are written only by the timer paths, never the renderer
  safeHandle("timetracker:listActivity", (_e, opts: unknown) => {
    const { db, orgId } = ttCtx();
    const o = (opts ?? {}) as Record<string, unknown>;
    const limit = o.limit == null ? undefined : vAmount(o.limit, "limit");
    const projectId = o.projectId == null ? undefined : vId(o.projectId, "project id");
    return eventLog.listEvents(db, orgId, { limit, projectId });
  });

  // reports — READ-ONLY analytics (SELECT-only service; charts are Phase 5's hand-rolled SVG)
  safeHandle("timetracker:getReport", (_e, range: unknown, granularity: unknown) => {
    const { db, orgId } = ttCtx();
    return reports.getReport(
      db,
      orgId,
      vEnum(range, REPORT_RANGES, "range"),
      vEnum(granularity, REPORT_GRANULARITIES, "granularity")
    );
  });
  // Export PDF (Phase 5) — Electron's built-in printToPDF on the LIVE renderer (rendered SVG charts
  // included, no DB access, no dependency — the standalone's exact approach). Lands in Downloads
  // with a MONTH-FIRST filename; collision-free suffix, never overwrites. reveal only serves paths
  // THIS session exported (the source openablePaths pattern — no arbitrary path reaches the OS).
  safeHandle("timetracker:exportAnalyticsPdf", async () => {
    const win = getMainWindow();
    if (!win) throw new Error("No window to print");
    const pdf = await win.webContents.printToPDF({ pageSize: "Letter", landscape: true, printBackground: true });
    const d = new Date();
    const base = `TimeTracker-Analytics-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}-${d.getFullYear()}`;
    const dir = app.getPath("downloads");
    let target = path.join(dir, `${base}.pdf`);
    for (let i = 2; fs.existsSync(target); i++) target = path.join(dir, `${base}-${String(i).padStart(2, "0")}.pdf`);
    fs.writeFileSync(target, pdf);
    exportedPdfPaths.add(target);
    return target;
  });
  safeHandle("timetracker:revealExportedPdf", (_e, p: unknown) => {
    const target = vString(p, "file path", 1000, true);
    if (!exportedPdfPaths.has(target)) throw new Error("Path not exported by this app session");
    shell.showItemInFolder(target);
  });

  // notes
  safeHandle("timetracker:getNote", (_e, projectId: unknown) => {
    const { db } = ttCtx();
    return projects.getNote(db, vId(projectId, "project id"));
  });
  safeHandle("timetracker:saveNote", (_e, projectId: unknown, body: unknown) => {
    const { db, orgId } = ttCtx();
    projects.saveNote(db, orgId, vId(projectId, "project id"), vString(body, "note body", 100_000));
  });

  // timer (multi-session) — every mutation broadcasts so all surfaces stay in sync
  safeHandle("timetracker:startTimer", (_e, projectId: unknown, note: unknown) => {
    const { db, orgId } = ttCtx();
    const st = timer.start(db, orgId, vId(projectId, "project id"), vNullableString(note, "session note", 2000));
    timerChanged();
    return st;
  });
  safeHandle("timetracker:pauseTimer", (_e, sessionId: unknown) => {
    const { db, orgId } = ttCtx();
    const st = timer.pause(db, orgId, vId(sessionId, "session id"));
    timerChanged();
    return st;
  });
  safeHandle("timetracker:resumeTimer", (_e, sessionId: unknown) => {
    const { db, orgId } = ttCtx();
    const st = timer.resume(db, orgId, vId(sessionId, "session id"));
    timerChanged();
    return st;
  });
  safeHandle("timetracker:stopTimer", (_e, sessionId: unknown, note: unknown) => {
    const { db, orgId } = ttCtx();
    timer.stop(db, orgId, vId(sessionId, "session id"), vNullableString(note, "session note", 2000));
    timerChanged();
    return timer.status(db);
  });
  safeHandle("timetracker:stopAllTimers", () => {
    const { db, orgId } = ttCtx();
    const n = timer.stopAll(db, orgId);
    timerChanged();
    return n;
  });
  safeHandle("timetracker:focusTimer", (_e, sessionId: unknown) => {
    const { db } = ttCtx();
    const st = timer.focus(db, vId(sessionId, "session id"));
    timerChanged();
    return st;
  });
  safeHandle("timetracker:timerStatus", () => {
    const { db } = ttCtx();
    return timer.status(db);
  });
  safeHandle("timetracker:discardIdle", (_e, sessionId: unknown, seconds: unknown) => {
    const { db } = ttCtx();
    const st = timer.discardIdle(db, vId(sessionId, "session id"), vAmount(seconds, "idle seconds"));
    timerChanged();
    return st;
  });

  // crash recovery (per-session)
  safeHandle("timetracker:listInterrupted", () => {
    const { db } = ttCtx();
    return timer.listInterrupted(db);
  });
  safeHandle("timetracker:recoverResume", (_e, sessionId: unknown) => {
    const { db } = ttCtx();
    const st = timer.recoverResume(db, vId(sessionId, "session id"));
    timerChanged();
    return st;
  });
  safeHandle("timetracker:recoverKeep", (_e, sessionId: unknown) => {
    const { db, orgId } = ttCtx();
    timer.recoverKeep(db, orgId, vId(sessionId, "session id"));
    timerChanged();
  });
  safeHandle("timetracker:recoverDiscard", (_e, sessionId: unknown) => {
    const { db } = ttCtx();
    timer.recoverDiscard(db, vId(sessionId, "session id"));
    timerChanged();
  });

  // value ledger — APPEND-ONLY surface (Jason's ruling 07-31-2026): the nukeLedgerEntry /
  // nukeLedgerAll channels from the 1:1 port are DEREGISTERED. The service functions remain in
  // ledger.ts for a future deliberate, confirm-gated maintenance path — but no renderer can
  // reach them, so their absence here is the append-only rule made structural.
  safeHandle("timetracker:listLedger", (_e, projectId: unknown) => {
    const { db } = ttCtx();
    return ledger.list(db, vId(projectId, "project id"));
  });
  safeHandle("timetracker:addLedger", (_e, projectId: unknown, amount: unknown, note: unknown) => {
    const { db, orgId } = ttCtx();
    return ledger.add(db, orgId, vId(projectId, "project id"), vAmount(amount), vNullableString(note, "ledger note", 2000));
  });

  // break-alert sounds — bundled + user-uploaded; selection persisted main-side
  safeHandle("timetracker:listSounds", () => {
    const { db } = ttCtx();
    return sounds.listSounds(db);
  });
  safeHandle("timetracker:readSound", (_e, id: unknown) => {
    const { db } = ttCtx();
    return sounds.readSound(db, vString(id, "sound id", 200, true));
  });
  safeHandle("timetracker:readSelectedSound", () => {
    const { db } = ttCtx();
    if (!settings.getSettings(db).breakSoundEnabled) return null;
    return sounds.readSound(db, sounds.getSelectedSoundId(db));
  });
  safeHandle("timetracker:uploadSound", async (_e2) => {
    const { db, orgId } = ttCtx();
    const win = getMainWindow();
    const opts = {
      title: "Add alert sound",
      properties: ["openFile" as const],
      filters: [{ name: "Audio", extensions: ["mp3", "wav"] }],
    };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled || res.filePaths.length === 0) return null;
    const src = res.filePaths[0];
    return sounds.uploadSound(db, orgId, src, path.basename(src, path.extname(src)));
  });
  safeHandle("timetracker:renameSound", (_e, id: unknown, name: unknown) => {
    const { db } = ttCtx();
    sounds.renameSound(db, vString(id, "sound id", 200, true), vString(name, "sound name", 100, true));
  });
  safeHandle("timetracker:deleteSound", (_e, id: unknown) => {
    const { db } = ttCtx();
    sounds.deleteSound(db, vString(id, "sound id", 200, true));
  });
  safeHandle("timetracker:getSelectedSound", () => {
    const { db } = ttCtx();
    return sounds.getSelectedSoundId(db);
  });
  safeHandle("timetracker:selectSound", (_e, id: unknown) => {
    const { db } = ttCtx();
    sounds.setSelectedSoundId(db, vString(id, "sound id", 200, true));
  });

  // mini timer window (6B) — toggles persist main-side; closing NEVER stops a timer
  safeHandle("timetracker:toggleMiniTimer", () => {
    const { db } = ttCtx();
    if (isMiniOpen()) closeMiniTimer();
    else openMiniTimer(timer.status(db).sessions.length);
    return { open: isMiniOpen() };
  });
  safeHandle("timetracker:miniTimerState", () => ({ open: isMiniOpen() }));
  safeHandle("timetracker:closeMiniTimer", () => {
    closeMiniTimer();
    return { open: false };
  });

  // attention engine (6B) — snooze re-arms the break; resolveIdle applies the USER'S choice only
  safeHandle("timetracker:snoozeBreak", () => {
    const { db } = ttCtx();
    attention.snoozeBreak(db);
  });
  safeHandle("timetracker:resolveIdle", (_e, discard: unknown) => {
    const { db } = ttCtx();
    attention.resolveIdle(db, discard === true);
    timerChanged(); // a discard shifts live clocks — every surface re-reads
  });

  // contract files
  safeHandle("timetracker:pickContract", async () => {
    const win = getMainWindow();
    const opts = {
      title: "Attach contract file",
      properties: ["openFile" as const],
      filters: [
        { name: "Documents", extensions: ["pdf", "doc", "docx", "txt", "png", "jpg", "jpeg"] },
        { name: "All files", extensions: ["*"] },
      ],
    };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled || res.filePaths.length === 0) return null;
    return { path: res.filePaths[0], name: path.basename(res.filePaths[0]) };
  });
  safeHandle("timetracker:openContract", async (_e, projectId: unknown) => {
    const { db } = ttCtx();
    const abs = projects.contractFileAbsolutePath(db, vId(projectId, "project id"));
    if (!abs) throw new Error("No contract file attached");
    const err = await shell.openPath(abs);
    if (err) throw new Error(err);
  });
}
