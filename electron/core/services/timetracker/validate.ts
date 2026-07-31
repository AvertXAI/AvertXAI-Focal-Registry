// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: TimeTracker input validators — the trust boundary on a money-adjacent surface
//              (rates, amounts, adjustment deltas). Ported 1:1 from the standalone engine's
//              ipc.ts and moved INTO the service layer so no future handler can forget them.
//              Every value that originated in a renderer passes through here before SQL.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/timetracker/validate.ts
//------------------------------------------------------------
import type {
  ContractKind,
  CostInput,
  CostRecurrence,
  NewProjectInput,
  ProjectStatus,
  RateType,
  ReportGranularity,
  ReportRange,
  TimeDisplayMode,
} from "./types";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
export const STATUSES: ProjectStatus[] = ["active", "parked", "done"];
export const RATE_TYPES: RateType[] = ["hourly", "contract"];
export const CONTRACT_KINDS: ContractKind[] = ["paid", "donated"];
export const TIME_MODES: TimeDisplayMode[] = ["elapsed", "remaining"];
export const REPORT_RANGES: ReportRange[] = ["all", "7d", "30d", "90d"];
export const REPORT_GRANULARITIES: ReportGranularity[] = ["day", "week", "month"];
export const RECURRENCES: CostRecurrence[] = ["once", "monthly", "yearly"];

export function vId(value: unknown, label = "id"): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

export function vNullableId(value: unknown, label = "id"): number | null {
  if (value == null) return null;
  return vId(value, label);
}

export function vString(value: unknown, label: string, maxLen: number, required = false): string {
  if (typeof value !== "string") throw new Error(`Invalid ${label}`);
  const s = value.slice(0, maxLen);
  if (required && s.trim() === "") throw new Error(`${label} is required`);
  return s;
}

export function vNullableString(value: unknown, label: string, maxLen: number): string | null {
  if (value == null) return null;
  return vString(value, label, maxLen);
}

export function vAmount(value: unknown, label = "amount"): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1e12) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

/** Signed integer minutes for an adjustment: non-zero, bounded (±100000 min ≈ ±1666h). */
export function vDeltaMinutes(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value === 0 || Math.abs(value) > 100_000) {
    throw new Error("Invalid adjustment minutes");
  }
  return value;
}

/** Adjustment public id — the std uuid column (the standalone app's `adj_` prefix scheme is gone). */
export function vAdjustmentUuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-fA-F-]{36}$/.test(value)) throw new Error("Invalid adjustment id");
  return value;
}

export function vEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new Error(`Invalid ${label}`);
  return value as T;
}

export function vColor(value: unknown): string {
  const c = vString(value, "color", 7);
  if (!HEX_COLOR.test(c)) throw new Error("Invalid color");
  return c;
}

export function vProjectInput(raw: unknown): NewProjectInput {
  if (typeof raw !== "object" || raw === null) throw new Error("Invalid project input");
  const o = raw as Record<string, unknown>;
  const rateType = vEnum(o.rateType, RATE_TYPES, "rate type");
  let hourlyRate: number | null = null;
  if (rateType === "hourly" && o.hourlyRate != null) hourlyRate = vAmount(o.hourlyRate, "hourly rate");
  let contractAmount: number | null = null;
  if (rateType === "contract" && o.contractAmount != null) {
    contractAmount = vAmount(o.contractAmount, "contract amount");
  }
  let contractKind: ContractKind | null = null;
  if (rateType === "contract" && o.contractKind != null) {
    contractKind = vEnum(o.contractKind, CONTRACT_KINDS, "contract kind");
  }
  let targetHours: number | null = null;
  if (rateType === "contract" && o.targetHours != null) {
    targetHours = vAmount(o.targetHours, "target hours");
  }
  return {
    name: vString(o.name, "project name", 200, true),
    clientName: vString(o.clientName, "client name", 200, true),
    contactPhone: vString(o.contactPhone ?? "", "contact phone", 50),
    email: vString(o.email ?? "", "email", 200),
    rateType,
    hourlyRate,
    color: vColor(o.color),
    status: vEnum(o.status, STATUSES, "status"),
    groupId: vNullableId(o.groupId, "group id"),
    newGroupName: vNullableString(o.newGroupName, "new group name", 100),
    newGroupColor: o.newGroupColor == null ? null : vColor(o.newGroupColor),
    contractAmount,
    contractDescription: vString(o.contractDescription ?? "", "contract description", 2000),
    contractSourcePath: vNullableString(o.contractSourcePath, "contract file path", 1000),
    contractKind,
    targetHours,
  };
}

export function vCostInput(raw: unknown): CostInput {
  if (typeof raw !== "object" || raw === null) throw new Error("Invalid cost input");
  const o = raw as Record<string, unknown>;
  const url = vString(o.url ?? "", "url", 1000);
  if (url.trim() && !/^https?:\/\//i.test(url.trim())) throw new Error("URL must start with http:// or https://");
  return {
    label: vString(o.label, "label", 200, true),
    category: vString(o.category ?? "", "category", 100),
    amount: vAmount(o.amount),
    recurrence: vEnum(o.recurrence, RECURRENCES, "recurrence"),
    url,
  };
}
