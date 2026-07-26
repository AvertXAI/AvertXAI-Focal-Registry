// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Drive enumeration + identity. The VOLUME SERIAL is the drive's identity, never the
//              letter — a drive that comes back as J: instead of G: is still the same drive.
//              Enumeration shells out to PowerShell CIM (Win32_LogicalDisk) — stdlib only, no npm
//              dependency. The double-scan guard returns a DECISION AS DATA; the service never
//              decides for the user.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/scan/drives.ts
//------------------------------------------------------------
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import type { Db } from "./db";

export interface ScanVolume {
  letter: string; // "D:"
  label: string;
  filesystem: string;
  totalBytes: number;
  freeBytes: number;
  serial: string; // hex volume serial — the identity key
  driveType: number; // Win32_LogicalDisk DriveType: 2 removable, 3 fixed, 4 network, 5 optical
  removable: boolean; // driveType === 2 — Migrate identifies USB/removable targets by this
}

export interface ScanDriveRow {
  id: number;
  uuid: string;
  org_id: string;
  volume_serial: string;
  volume_label: string | null;
  filesystem: string | null;
  total_bytes: number | null;
  free_bytes: number | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  last_scanned_at: string | null;
}

export interface ScanRunRow {
  id: number;
  uuid: string;
  org_id: string;
  drive_id: number | null;
  root_path: string;
  status: string;
  scan_unit: string;
  started_at: string | null;
  finished_at: string | null;
  probe_folders_sampled: number | null;
  probe_files_found: number | null;
  estimated_files: number | null;
  estimated_seconds: number | null;
  folders_committed: number;
  files_recorded: number;
  errors_logged: number;
  resume_cursor: string | null;
  report_path: string | null;
  report_local_path: string | null; // the copy in the app-managed Markdown tree — always local, drive or not
  total_files_expected: number | null;
  total_folders_expected: number | null;
}

/** The double-scan guard's answer — data only, the UI owns the choice. */
export interface SourceDecision {
  decision: "proceed" | "offer-resume" | "already-scanned";
  drive: ScanDriveRow;
  rootPath: string;
  scanUnit: "drive" | "folder";
  /** Present when decision is "offer-resume" — the crashed run to resume. */
  crashedRun?: ScanRunRow;
  /** Present when decision is "already-scanned" — the completed run behind
      Open existing report / Rescan anyway / Scan a subfolder only. */
  completedRun?: ScanRunRow;
}

// Win32_LogicalDisk via PowerShell CIM — verified 2026-07-18: returns DeviceID/VolumeName/
// FileSystem/Size/FreeSpace/VolumeSerialNumber for every attached volume. ConvertTo-Json emits an
// object (one drive) or an array (many) — normalize both.
export function listVolumes(): ScanVolume[] {
  const r = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID, VolumeName, FileSystem, Size, FreeSpace, VolumeSerialNumber, DriveType | ConvertTo-Json -Compress",
    ],
    { encoding: "utf8", windowsHide: true, timeout: 15_000 }
  );
  if (r.status !== 0 || !r.stdout) throw new Error(`volume enumeration failed: ${r.stderr || r.status}`);
  const parsed: unknown = JSON.parse(r.stdout);
  const rows = (Array.isArray(parsed) ? parsed : [parsed]) as Array<Record<string, unknown>>;
  return rows
    .filter((d) => typeof d.DeviceID === "string" && typeof d.VolumeSerialNumber === "string")
    .map((d) => {
      const driveType = Number(d.DriveType) || 0;
      return {
        letter: d.DeviceID as string,
        label: (d.VolumeName as string) ?? "",
        filesystem: (d.FileSystem as string) ?? "",
        totalBytes: Number(d.Size) || 0,
        freeBytes: Number(d.FreeSpace) || 0,
        serial: d.VolumeSerialNumber as string,
        driveType,
        removable: driveType === 2,
      };
    });
}

/** Event-driven volume watcher — a long-lived PowerShell subscribed to Win32_VolumeChangeEvent, the
 *  SAME WMI signal Windows itself raises on a drive arrival/removal (EventType 2 = arrival, 3 =
 *  removal). Delivered by the OS the instant a drive connects/disconnects — no polling lag. Calls
 *  onChange() on every such event (the caller debounces + re-enumerates). Returns a stop() that kills
 *  the child. Never throws: if PowerShell can't start, the app still works off the mount-time
 *  enumeration + the manual refresh, just without live detection. */
export function watchVolumes(onChange: () => void): () => void {
  const script =
    "$q='SELECT * FROM Win32_VolumeChangeEvent WHERE EventType=2 OR EventType=3';" +
    "Register-CimIndicationEvent -Query $q -SourceIdentifier FRVol;" +
    "while($true){ Wait-Event -SourceIdentifier FRVol | Out-Null; Remove-Event -SourceIdentifier FRVol; Write-Output 'change'; [Console]::Out.Flush() }";
  let child: ReturnType<typeof spawn> | null = null;
  try {
    child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true });
    child.stdout?.on("data", (buf: Buffer) => { if (buf.toString().includes("change")) onChange(); });
    child.on("error", () => { /* PowerShell unavailable — degrade to no live detection */ });
  } catch {
    /* spawn failed — degrade silently */
  }
  return () => {
    try {
      child?.kill();
    } catch {
      /* already gone */
    }
  };
}

/** The volume a path lives on, by drive letter root. Throws if the letter is not attached. */
export function volumeForPath(p: string): ScanVolume {
  const root = path.parse(path.resolve(p)).root; // "D:\"
  const letter = root.slice(0, 2).toUpperCase(); // "D:"
  const vol = listVolumes().find((v) => v.letter.toUpperCase() === letter);
  if (!vol) throw new Error(`no attached volume for path ${p} (looked for ${letter})`);
  return vol;
}

// Resolve a live volume to its scan_drives identity row: insert on first sight, refresh
// label/filesystem/sizes + last_seen_at on every later sight. Serial is the key, never the letter.
export function resolveDrive(db: Db, orgId: string, vol: ScanVolume, uuid: () => string): ScanDriveRow {
  const existing = db
    .prepare("SELECT * FROM scan_drives WHERE org_id = ? AND volume_serial = ?")
    .get(orgId, vol.serial) as ScanDriveRow | undefined;
  if (existing) {
    db.prepare(
      `UPDATE scan_drives SET volume_label = ?, filesystem = ?, total_bytes = ?, free_bytes = ?,
       last_seen_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(vol.label, vol.filesystem, vol.totalBytes, vol.freeBytes, existing.id);
  } else {
    db.prepare(
      `INSERT INTO scan_drives (uuid, org_id, volume_serial, volume_label, filesystem, total_bytes,
       free_bytes, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).run(uuid(), orgId, vol.serial, vol.label, vol.filesystem, vol.totalBytes, vol.freeBytes);
  }
  return db
    .prepare("SELECT * FROM scan_drives WHERE org_id = ? AND volume_serial = ?")
    .get(orgId, vol.serial) as ScanDriveRow;
}

// The double-scan guard. Serial unknown → proceed. Crashed run on this drive → offer resume.
// Completed run → already-scanned (never silently rescan a drive the user already paid hours for).
// Returned as data — the renderer presents the choice, this service never decides.
export function selectSource(
  db: Db,
  orgId: string,
  rootPath: string,
  scanUnit: "drive" | "folder",
  uuid: () => string,
  rawMode = false // RAW_MODE (Phase 6): skip the guard so a drive can be re-run for benchmarking
): SourceDecision {
  const vol = volumeForPath(rootPath);
  const known = db
    .prepare("SELECT id FROM scan_drives WHERE org_id = ? AND volume_serial = ?")
    .get(orgId, vol.serial) as { id: number } | undefined;
  const drive = resolveDrive(db, orgId, vol, uuid);
  if (rawMode || !known) return { decision: "proceed", drive, rootPath, scanUnit };

  const runFor = (status: string): ScanRunRow | undefined =>
    db
      .prepare("SELECT * FROM scan_runs WHERE org_id = ? AND drive_id = ? AND status = ? ORDER BY id DESC LIMIT 1")
      .get(orgId, drive.id, status) as ScanRunRow | undefined;

  const completed = runFor("completed");
  if (completed) return { decision: "already-scanned", drive, rootPath, scanUnit, completedRun: completed };
  const crashed = runFor("crashed");
  if (crashed) return { decision: "offer-resume", drive, rootPath, scanUnit, crashedRun: crashed };
  return { decision: "proceed", drive, rootPath, scanUnit };
}
