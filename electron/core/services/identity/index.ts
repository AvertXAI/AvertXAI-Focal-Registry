// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: LOCAL device identity — two Windows identifiers read with BUILT-INS only (no npm
//              dependency): the per-installation MachineGuid (registry; regenerated on an OS
//              reinstall) and the SMBIOS hardware UUID (firmware; survives an OS reinstall).
//              Together they distinguish "same hardware, fresh Windows" from "new machine".
//              Every read is independently wrapped: a failure yields NULL and is NEVER fatal —
//              account creation must never block on an identifier.
//              LOCAL ONLY: these values are never transmitted, never sent to a server, and never
//              included in any report, export, or error payload.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/identity/index.ts
//------------------------------------------------------------
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export interface DeviceIdentity {
  machine_guid: string | null; // HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid — changes on OS reinstall
  hardware_uuid: string | null; // SMBIOS UUID (Win32_ComputerSystemProduct) — survives OS reinstall
  machine_name: string | null; // os.hostname()
}

// reg.exe resolved from SystemRoot, NEVER via PATH (DECISIONS-48 — the attrib.exe precedent).
function readMachineGuid(): string | null {
  try {
    const sysRoot = process.env.SystemRoot;
    if (!sysRoot) return null;
    const reg = path.join(sysRoot, "System32", "reg.exe");
    const r = spawnSync(reg, ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10_000,
    });
    const m = r.stdout?.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{8,})/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// PowerShell CIM — the same spawnSync pattern scan/drives.ts uses for volume enumeration.
function readHardwareUuid(): string | null {
  try {
    const r = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "(Get-CimInstance Win32_ComputerSystemProduct).UUID"],
      { encoding: "utf8", windowsHide: true, timeout: 15_000 }
    );
    const v = r.stdout?.trim();
    // Some boards report an all-FF placeholder — that is still recorded verbatim; only shape-check here.
    return v && /^[0-9a-fA-F-]{8,}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** Never throws; any failed probe is NULL. */
export function readDeviceIdentity(): DeviceIdentity {
  let machine_name: string | null = null;
  try {
    machine_name = os.hostname() || null;
  } catch {
    machine_name = null;
  }
  return { machine_guid: readMachineGuid(), hardware_uuid: readHardwareUuid(), machine_name };
}
