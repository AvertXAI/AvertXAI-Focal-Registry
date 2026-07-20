// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: The app-managed Markdown storage root. The USER picks a ROOT only; the app owns the
//              tree below it — <root>\_source\MissionControl\Focal-Registry\<Module>\. _source\
//              MissionControl\ is SHARED with other AvertXAI products (one index covers all), so we
//              REUSE it if present and never overwrite, clear, or assume it is ours alone. The
//              _source folder is Windows-HIDDEN (an attribute, not a dot-prefix — a leading dot does
//              nothing on Windows). A plain-English DO-NOT-DELETE.txt (NOT hidden) explains the
//              folder. All paths resolve through app.getPath — never a hardcoded drive letter.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/storage/index.ts
//------------------------------------------------------------
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getSetting, setSetting } from "../settings";

export const MARKDOWN_ROOT_KEY = "markdown_root";
// The app owns these module folders under Focal-Registry\. SecureNote/ScoutViewer/Rename are seeded
// now so a future module writes into an existing home.
const MODULE_DIRS = ["Scan", "SecureNote", "ScoutViewer", "Rename"] as const;

export function defaultMarkdownRoot(): string {
  return app.getPath("documents"); // localized, follows a redirected Documents folder; never C:-assumed
}
export const sourceDir = (root: string): string => path.join(root, "_source");
export const focalRegistryDir = (root: string): string => path.join(sourceDir(root), "MissionControl", "Focal-Registry");
export const scanMarkdownDir = (root: string): string => path.join(focalRegistryDir(root), "Scan");
export const documentsExportsDir = (): string => path.join(app.getPath("documents"), "Focal Registry", "Scan", "Exports");

/** Configured root, or the Documents default — which is RECORDED when unset (2.2). */
export function resolveMarkdownRoot(): string {
  const cur = getSetting(MARKDOWN_ROOT_KEY);
  if (cur && cur.trim() !== "") return cur;
  const def = defaultMarkdownRoot();
  setSetting(MARKDOWN_ROOT_KEY, def);
  return def;
}

function setHiddenAttribute(dir: string): void {
  if (process.platform !== "win32") return;
  try {
    spawnSync("attrib", ["+h", dir], { windowsHide: true, timeout: 10_000 }); // +h = hidden ATTRIBUTE
  } catch {
    /* best-effort — a missing hidden bit never blocks anything */
  }
}

const DO_NOT_DELETE = `FOCAL REGISTRY — PLEASE DO NOT DELETE THIS FOLDER

WHAT THIS IS
  This folder holds the Markdown records the Focal Registry desktop app keeps for you —
  scan reports, and (as those modules arrive) Secure Notes, Scout Viewer captures, and
  Rename logs. It lives under _source\\MissionControl\\ so one index can cover every
  AvertXAI product that shares this computer.

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

/** Create the app-managed tree (idempotent; REUSES an existing _source\MissionControl, never clears
    it), hide _source, and drop the DO-NOT-DELETE note. mkdir recursive never overwrites contents. */
export function ensureManagedTree(root: string): void {
  const fr = focalRegistryDir(root);
  for (const m of MODULE_DIRS) fs.mkdirSync(path.join(fr, m), { recursive: true });
  setHiddenAttribute(sourceDir(root));
  writeDoNotDelete(fr);
}

/** The two storage locations for the Settings transparency section (2.5). */
export function storageLocations(): { markdownRoot: string; focalRegistry: string; scanMarkdown: string; documentsExports: string } {
  const root = resolveMarkdownRoot();
  ensureManagedTree(root); // first look creates it — no prompt beyond the root choice (2.2)
  fs.mkdirSync(documentsExportsDir(), { recursive: true });
  return { markdownRoot: root, focalRegistry: focalRegistryDir(root), scanMarkdown: scanMarkdownDir(root), documentsExports: documentsExportsDir() };
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
