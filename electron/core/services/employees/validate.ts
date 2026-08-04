// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Employees input validators — the trust boundary on a money surface (rates, amounts,
//              hours, adjustment deltas). Deliberately a module-local set rather than an import
//              from TimeTracker's validate.ts: the two modules share a database, never a service
//              layer. Every value that will originate in a renderer passes through here before SQL,
//              so no future handler can forget (timetracker/validate.ts doctrine).
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/employees/validate.ts
//------------------------------------------------------------
import type { AdjustmentKind, PayType } from "./types";

export const PAY_TYPES: PayType[] = ["hourly", "job", "task", "donated"];
export const ADJUSTMENT_KINDS: AdjustmentKind[] = ["hours", "amount"];
/** Pay types that carry an agreed flat amount instead of hours × rate. */
export const FLAT_PAY_TYPES: PayType[] = ["job", "task"];

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
  const s = vString(value, label, maxLen);
  return s.trim() === "" ? null : s;
}

/** Non-negative money, bounded — matches TimeTracker's vAmount ceiling exactly. */
export function vAmount(value: unknown, label = "amount"): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1e12) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

export function vNullableAmount(value: unknown, label = "amount"): number | null {
  if (value == null) return null;
  return vAmount(value, label);
}

/** A payment may be negative (a reversal) but never zero. */
export function vSignedAmount(value: unknown, label = "amount"): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0 || Math.abs(value) > 1e12) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

/** Hours are recorded for EVERY pay type, donated included — zero is legal, negative is not. */
export function vHours(value: unknown, label = "hours"): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100_000) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

/** Signed integer minutes for an hours adjustment: non-zero, bounded (±100000 min ≈ ±1666h). */
export function vDeltaMinutes(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value === 0 || Math.abs(value) > 100_000) {
    throw new Error("Invalid adjustment minutes");
  }
  return value;
}

/** Signed money for an amount adjustment: non-zero (a correction of nothing is not a correction). */
export function vDeltaAmount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0 || Math.abs(value) > 1e12) {
    throw new Error("Invalid adjustment amount");
  }
  return value;
}

/** Public row id — the std uuid column, as TimeTracker's adjustments use it. */
export function vUuid(value: unknown, label = "id"): string {
  if (typeof value !== "string" || !/^[0-9a-fA-F-]{36}$/.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}

export function vEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new Error(`Invalid ${label}`);
  return value as T;
}

/** Two-letter US state code, or null. Uppercased so "tx" and "TX" store identically — the form
    offers a fixed list, but the service is the trust boundary and takes whatever IPC hands it. */
export function vNullableState(value: unknown, label = "state"): string | null {
  if (value == null) return null;
  // Deliberately NOT vString: that helper SLICES to maxLen, so vString(value, label, 2) would turn
  // "TXX" into "TX" and the check below would pass a value the caller never sent. Silent truncation
  // is the one thing a validator must not do — the raw string is tested as given.
  if (typeof value !== "string") throw new Error(`Invalid ${label}`);
  const s = value.trim().toUpperCase();
  if (s === "") return null;
  if (!/^[A-Z]{2}$/.test(s)) throw new Error(`Invalid ${label} — expected a two-letter code`);
  return s;
}

/** A pay type, or null. NULL is a real answer here: it means "no default set for this person",
    which is different from hourly. The ENTRY's pay type is still mandatory and unaffected. */
export function vNullablePayType(value: unknown): PayType | null {
  if (value == null || value === "") return null;
  return vEnum(value, PAY_TYPES, "default pay type");
}

/** A calendar date the work happened on / a payment was made on: YYYY-MM-DD, real date. */
export function vDate(value: unknown, label = "date"): string {
  const s = vString(value, label, 10, true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) {
    throw new Error(`Invalid ${label} — expected YYYY-MM-DD`);
  }
  return s;
}
