// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Process monitor — reads the Electron process tree this app belongs to and can end a
//              stale one. READ-ONLY except for kill(), which is developer-mode gated at the IPC layer.
//              Nothing is stored: every call is a live read of what Windows already knows.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/procmon/index.ts
//------------------------------------------------------------
import { execFile } from "node:child_process";
import path from "node:path";
import type { ProcRow, ProcRole } from "../../../../src/shared/types";

/**
 * WHY THIS EXISTS. An Electron app is not one process, it is four or more sharing one image name.
 * Task Manager shows four identical electron.exe rows and cannot tell one instance from two, which
 * is what makes the device gate (CLAUDE.md 2.3) unreliable — a survivor holds the single-instance
 * lock and refocuses a stale window, handing back a false pass.
 *
 * Windows already records everything needed to tell them apart: ParentProcessId, and a command line
 * on which Electron stamps --type=renderer / --type=gpu-process / --type=utility. The MAIN process
 * is the one carrying no --type at all. Nothing here is inferred.
 *
 * LICENCE / STACK NOTE. This invokes two operating-system binaries already present on the machine,
 * BY FULL PATH FROM %SystemRoot% (never PATH) with FIXED arguments and no interpolated user input —
 * the exact allowance in FR-DECISIONS "Node-native" and the same pattern the identity service uses
 * to read MachineGuid through reg.exe. It is not a sidecar, not an interpreter bridge, and ships no
 * binary of its own. PySide6 / Python remain dead and are not involved.
 */

/** Resolved from %SystemRoot%, never PATH — a PATH lookup is how a planted binary gets run. */
function system32(exe: string): string {
  const root = process.env.SystemRoot || process.env.windir || "C:\\Windows";
  return path.join(root, "System32", exe);
}
const POWERSHELL = path.join(
  process.env.SystemRoot || process.env.windir || "C:\\Windows",
  "System32", "WindowsPowerShell", "v1.0", "powershell.exe"
);
const TASKKILL = system32("taskkill.exe");

/**
 * FIXED script text — a constant, never assembled from anything a renderer sent. The filter is
 * deliberately narrow: this is "our app and everything inside it", not a Task Manager clone.
 */
const LIST_SCRIPT = `$ErrorActionPreference='SilentlyContinue';
$p = Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'electron*' -or $_.Name -like 'Focal Registry*' -or $_.Name -eq 'node.exe' } |
  Select-Object ProcessId, ParentProcessId, Name, CommandLine, WorkingSetSize;
ConvertTo-Json -InputObject @($p) -Compress -Depth 2`;

/**
 * PRIORITY IS IMPORTANCE, NEVER USAGE (Jason 08-21-2026). A renderer eating four hundred megabytes
 * still sorts below the main process that holds the single-instance lock, because the question this
 * table answers is "what is holding the gate", not "what is heavy".
 */
const RANK: Record<ProcRole, number> = {
  MAIN: 1, renderer: 2, "gpu-process": 3, utility: 4, node: 5,
};

interface RawProc {
  ProcessId: number;
  ParentProcessId: number;
  Name: string;
  CommandLine: string | null;
  WorkingSetSize: number;
}

function roleOf(raw: RawProc): ProcRole {
  if (raw.Name === "node.exe") return "node";
  const m = /--type=([a-z-]+)/.exec(raw.CommandLine ?? "");
  if (!m) return "MAIN"; // no --type is the definition of the main process, not a fallback guess
  if (m[1] === "renderer" || m[1] === "gpu-process" || m[1] === "utility") return m[1];
  return "utility"; // any future Chromium child type sorts with the utilities rather than vanishing
}

function run(exe: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(exe, args, { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err && !stdout) reject(err);
      else resolve(stdout);
    });
  });
}

/**
 * Every process in this app's family, priority-sorted.
 *
 * SELF IS MARKED, NOT HIDDEN. The row for this very app is returned with isSelf true so the user can
 * see it — hiding it would make the table lie about what is running. What it must never do is die to
 * a "kill all", which is enforced in kill() below and in the renderer's own guard.
 */
export async function listProcesses(): Promise<ProcRow[]> {
  let parsed: RawProc[] = [];
  try {
    const out = await run(POWERSHELL, ["-NoProfile", "-NonInteractive", "-Command", LIST_SCRIPT]);
    const json: unknown = JSON.parse(out.trim() || "[]");
    parsed = (Array.isArray(json) ? json : [json]) as RawProc[]; // PS 5.1 emits a bare object for one row
  } catch {
    return []; // a monitor that throws is worse than a monitor that says nothing is running
  }

  const selfPid = process.pid;
  const rows: ProcRow[] = parsed
    .filter((r) => r && typeof r.ProcessId === "number")
    .map((r) => {
      const role = roleOf(r);
      return {
        pid: r.ProcessId,
        parentPid: r.ParentProcessId,
        name: r.Name,
        role,
        rank: RANK[role],
        memoryMb: Math.round((r.WorkingSetSize || 0) / (1024 * 1024)),
        // Self = this main process AND its own children, because killing our own gpu-process breaks
        // the window just as thoroughly as killing main does.
        isSelf: r.ProcessId === selfPid || r.ParentProcessId === selfPid,
        packaged: r.Name.toLowerCase().startsWith("focal registry"),
      };
    });

  // node.exe matches half the machine (npm, language servers, agents), so keep ONLY the ones that
  // actually parent an Electron process in this list. That is the difference between "our app and
  // everything inside it" and a process browser nobody asked for.
  const electronParents = new Set(rows.filter((r) => r.role !== "node").map((r) => r.parentPid));
  const kept = rows.filter((r) => r.role !== "node" || electronParents.has(r.pid));

  return kept.sort((a, b) => a.rank - b.rank || a.pid - b.pid);
}

/**
 * Ends one process and its children. /T takes the tree, /F is unconditional.
 *
 * THE PID IS COERCED TO AN INTEGER BEFORE IT REACHES THE COMMAND LINE. A renderer cannot smuggle a
 * second argument through it, which is what "fixed arguments, no interpolated user input" means in
 * practice for a value that genuinely has to vary.
 */
export async function killProcess(pidLike: unknown): Promise<{ killed: number }> {
  const pid = Math.floor(Number(pidLike));
  if (!Number.isFinite(pid) || pid <= 0) throw new Error("That is not a process id.");
  if (pid === process.pid) throw new Error("This app cannot hard-kill itself — quit it instead.");
  await run(TASKKILL, ["/PID", String(pid), "/T", "/F"]);
  return { killed: 1 };
}

/**
 * The device gate in one call: end every OTHER instance and leave this one running.
 *
 * WHY SELF IS EXCLUDED, AND IT IS NOT A CONVENIENCE. This monitor renders inside Focal Registry, so
 * its own main process is in its own list. A literal "kill everything" would taskkill /F the process
 * executing the click — an instant hard kill that skips app.on("will-quit") and therefore skips
 * closeAllDbs(), leaving every SQLite handle unclosed with no WAL checkpoint, and skips
 * app.on("before-quit") and therefore Scout Viewer's scroll checkpoint. The window would vanish and
 * read as a crash. Stale instances are the whole point of the button; this one is never the target.
 */
export async function killOthers(): Promise<{ killed: number }> {
  const rows = await listProcesses();
  const targets = rows.filter((r) => !r.isSelf && r.role !== "node");
  let killed = 0;
  for (const t of targets) {
    try { await killProcess(t.pid); killed++; } catch { /* already gone between list and kill */ }
  }
  return { killed };
}
