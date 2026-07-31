// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: TimeTracker file-storage injection — the service layer never imports electron, so
//              root wires the roots in at boot (mindmerge baseDir precedent). Contract attachments
//              live under the user-chosen markdown_root tree (FR-DECISIONS §TimeTracker); bundled
//              alert sounds ship with the app and are listed live from their folder.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/timetracker/paths.ts
//------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";

// File-storage root for TimeTracker-owned files (contract attachments, custom sound uploads).
// Phase 2 wiring points this at the TimeTracker branch of the managed markdown_root tree.
let storageRoot: string | null = null;

export function setTimeTrackerStorageRoot(root: string): void {
  storageRoot = root;
}

export function getStorageRoot(): string {
  if (!storageRoot) throw new Error("TimeTracker storage root not set — call setTimeTrackerStorageRoot() first");
  return storageRoot;
}

/** contracts/<projectId>/ under the storage root — created on first use. */
export function contractsDir(projectId: number): string {
  const dir = path.join(getStorageRoot(), "contracts", String(projectId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** sounds/ under the storage root (custom uploads) — created on first use. */
export function customSoundsDir(): string {
  const dir = path.join(getStorageRoot(), "sounds");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Folder shipping the bundled alert sounds — set from root at startup. Must be a path that
// survives asar (FR-FACTS: bundled assets are listed in build files or read asar-safe).
let bundledSoundsDir: string | null = null;

export function setBundledSoundsDir(dir: string): void {
  bundledSoundsDir = dir;
}

export function getBundledSoundsDir(): string | null {
  return bundledSoundsDir;
}
