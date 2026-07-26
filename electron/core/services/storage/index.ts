// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: The app-managed Markdown storage root. The USER picks a ROOT only (default home\AvertXAI,
//              NOT Documents — Documents is OneDrive-redirected here and would cloud-sync + conflict-copy
//              the tree). The app owns everything below the root: <root>\MissionControl\Focal-Registry\
//              <Module>\. MissionControl\ is SHARED with other AvertXAI products (one index covers all),
//              so we REUSE it if present and never overwrite or clear it. The AvertXAI folder is
//              Windows-HIDDEN (an attribute, not a dot-prefix). A plain-English DO-NOT-DELETE.txt (NOT
//              hidden) explains the folder. ONE tree at the configured root and nowhere else — NO
//              userData fallback: if the root is unreachable, we write nothing. All paths resolve
//              through app.getPath — never a hardcoded drive letter or user path.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/storage/index.ts
//------------------------------------------------------------
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getSetting, setSetting } from "../settings";

export const MARKDOWN_ROOT_KEY = "markdown_root";
// The app owns these module folders under Focal-Registry\. Seeded up front so a future module
// writes into an existing home. "MindMerge" replaced the stale "SecureNote" name (Jason ruled
// 2026-07-26); ensureManagedTree moves a populated legacy SecureNote\ folder rather than orphaning it.
const MODULE_DIRS = ["Scan", "MindMerge", "ScoutViewer", "Rename", "Migrate"] as const;

export function defaultMarkdownRoot(): string {
  // home\AvertXAI — NOT Documents. app.getPath("documents") resolves inside OneDrive on this machine,
  // which cloud-syncs the app-managed tree and spawns conflict copies on racing writes. Home is local.
  return path.join(app.getPath("home"), "AvertXAI");
}
// Layout is two levels shallower — the _source segment is REMOVED (1.3):
//   <root>\MissionControl\Focal-Registry\<Module>\
export const missionControlDir = (root: string): string => path.join(root, "MissionControl");
export const focalRegistryDir = (root: string): string => path.join(missionControlDir(root), "Focal-Registry");
export const scanMarkdownDir = (root: string): string => path.join(focalRegistryDir(root), "Scan");
// Local Documents (%USERPROFILE%\Documents), NOT app.getPath("documents") — that follows the OneDrive
// redirect on this machine. Jason: exports must land OFF OneDrive, in C:\Users\<profile>\Documents.
export const documentsExportsDir = (): string => path.join(app.getPath("home"), "Documents", "Focal Registry", "Scan", "Exports");

/** Configured root, or the home\AvertXAI default — RECORDED when unset. NEVER falls back to userData;
    if the configured root is unreachable, ensureManagedTree fails and nothing is written elsewhere. */
export function resolveMarkdownRoot(): string {
  const cur = getSetting(MARKDOWN_ROOT_KEY);
  if (cur && cur.trim() !== "") return cur;
  const def = defaultMarkdownRoot();
  setSetting(MARKDOWN_ROOT_KEY, def);
  return def;
}

function setHiddenAttribute(dir: string): void {
  if (process.platform !== "win32") return;
  const sysRoot = process.env.SystemRoot;
  if (!sysRoot) return; // resolve attrib from SystemRoot, NEVER via PATH (DECISIONS-48); no hardcoded C:\Windows
  const attrib = path.join(sysRoot, "System32", "attrib.exe");
  try {
    spawnSync(attrib, ["+h", dir], { windowsHide: true, timeout: 10_000 }); // +h = hidden ATTRIBUTE
  } catch {
    /* best-effort — a missing hidden bit never blocks anything */
  }
}

const DO_NOT_DELETE = `FOCAL REGISTRY — PLEASE DO NOT DELETE THIS FOLDER

WHAT THIS IS
  This folder holds the Markdown records the Focal Registry desktop app keeps for you —
  scan reports, and (as those modules arrive) MindMerge notes, Scout Viewer captures, and
  Rename logs. It lives under MissionControl\\ so one index can cover every AvertXAI
  product that shares this computer.

WHAT THE APP USES IT FOR
  The app reads and writes these files here. Scan reports are ALSO saved onto the scanned
  drive so they travel with a shelved archive; the copy in this folder is the one that is
  always here, whether or not that drive is plugged in.

WHAT IS LOST IF YOU DELETE IT
  Scan reports can be REGENERATED from the app's database (Settings -> regenerate).
  Authored notes CANNOT be recreated — deleting them loses them permanently.
  The app will recreate the FOLDER STRUCTURE automatically, but NOT the contents.

TO MOVE IT SAFELY
  Use Settings -> Storage -> Change location. That copies everything and re-points the app.
  Deleting or moving this folder by hand can lose data.
`;

function writeDoNotDelete(fr: string): void {
  try {
    fs.writeFileSync(path.join(fr, "DO-NOT-DELETE.txt"), DO_NOT_DELETE, "utf8"); // NOT hidden (2.4)
  } catch {
    /* best-effort */
  }
}

/** Create the app-managed tree (idempotent; REUSES an existing <root>\MissionControl, never clears it),
    hide the AvertXAI folder (only when the root IS the default AvertXAI folder — a custom root the user
    named themselves is left visible), and drop the DO-NOT-DELETE note. mkdir recursive never overwrites
    contents. Throws if the root is unreachable — the caller reports it; nothing is written elsewhere. */
export function ensureManagedTree(root: string): void {
  const fr = focalRegistryDir(root);
  // Legacy SecureNote\ → MindMerge\ (module renamed 2026-07-24; folder ruling 2026-07-26): a
  // populated legacy folder is MOVED so its contents are never orphaned. If both exist somehow,
  // both are left in place (never merge-overwrite) — the stray SecureNote\ shows up in Explorer
  // and is the user's call. An empty legacy folder is simply removed.
  const legacy = path.join(fr, "SecureNote");
  const mindmerge = path.join(fr, "MindMerge");
  try {
    if (fs.existsSync(legacy) && !fs.existsSync(mindmerge)) {
      if (fs.readdirSync(legacy).length > 0) fs.renameSync(legacy, mindmerge);
      else fs.rmdirSync(legacy); // empty shell — no content to preserve
    }
  } catch {
    /* best-effort — a locked legacy folder never blocks the tree */
  }
  for (const m of MODULE_DIRS) fs.mkdirSync(path.join(fr, m), { recursive: true });
  // The _source hidden-wrapper is gone (1.3); hide the AvertXAI folder itself instead — only when the
  // root's own name is "AvertXAI" (the default), never a user's custom-named folder (1.6).
  if (path.basename(root).toLowerCase() === "avertxai") setHiddenAttribute(root);
  writeDoNotDelete(fr);
}

/** The two storage locations for the Settings transparency section (2.5). */
export function storageLocations(): { markdownRoot: string; focalRegistry: string; scanMarkdown: string; documentsExports: string; reachable: boolean } {
  const root = resolveMarkdownRoot();
  let reachable = true;
  try {
    ensureManagedTree(root); // first look creates it — no prompt beyond the root choice
  } catch {
    reachable = false; // root unreachable — report it, write NOTHING elsewhere (no userData fallback)
  }
  try { fs.mkdirSync(documentsExportsDir(), { recursive: true }); } catch { /* best-effort */ }
  return { markdownRoot: root, focalRegistry: focalRegistryDir(root), scanMarkdown: scanMarkdownDir(root), documentsExports: documentsExportsDir(), reachable };
}

/** Change the root: COPY the existing Focal-Registry tree to the new root (never move, never delete
    the old), re-point the setting, and ensure the new tree. If the COPY fails, the setting does NOT
    change (2.6) — the old location keeps working untouched. */
export function changeMarkdownRoot(newRoot: string): { ok: boolean; error?: string } {
  if (typeof newRoot !== "string" || newRoot.trim() === "") return { ok: false, error: "No folder chosen." };
  const oldFr = focalRegistryDir(resolveMarkdownRoot());
  const newFr = focalRegistryDir(newRoot);
  try {
    if (path.resolve(oldFr) !== path.resolve(newFr) && fs.existsSync(oldFr)) {
      // force:false + errorOnExist:false — copy in, but NEVER overwrite a file already at the target.
      fs.cpSync(oldFr, newFr, { recursive: true, force: false, errorOnExist: false });
    }
    ensureManagedTree(newRoot);
    setSetting(MARKDOWN_ROOT_KEY, newRoot); // re-point ONLY after the copy succeeded
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }; // setting unchanged; old root intact
  }
}
