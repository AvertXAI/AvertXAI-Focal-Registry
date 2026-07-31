// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: TimeTracker read-only display derivations (countdown, time mode, contract kind) —
//              pure functions, never write anything. Ported 1:1 from the standalone engine.
//              The renderer gets its own copy via src/shared in Phase 3.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/timetracker/derive.ts
//------------------------------------------------------------
import type { ContractKind, ProjectType, RateType, TimeDisplayMode } from "./types";

/** Normalised project type used by wasted-hours buckets + purge tombstones. */
export function classifyProjectType(rateType: RateType, contractKind: ContractKind | null): ProjectType {
  if (rateType === "hourly") return "hourly";
  if (contractKind === "paid") return "contract-paid";
  if (contractKind === "donated") return "contract-donated";
  return "contract-unpaid"; // legacy/null-kind contract
}

/** For-profit = hourly + contract-paid; everything else (donated/unpaid) is non-profit. */
export function isForProfit(type: ProjectType): boolean {
  return type === "hourly" || type === "contract-paid";
}

interface TimeModeFields {
  contract_kind: ContractKind | null;
  target_hours: number | null;
  time_display_mode: TimeDisplayMode | null;
}

/**
 * Effective display mode: an explicit per-project choice wins; otherwise donated
 * contracts default to the countdown and everything else counts up. The countdown
 * is only available when a target is actually set.
 */
export function resolveTimeMode(p: TimeModeFields): TimeDisplayMode {
  if (p.target_hours == null) return "elapsed";
  if (p.time_display_mode) return p.time_display_mode;
  return p.contract_kind === "donated" ? "remaining" : "elapsed";
}

/** remaining = max(target − logged, 0). Pure read of summed durations. */
export function remainingHours(targetHours: number, totalSeconds: number): number {
  return Math.max(targetHours - totalSeconds / 3600, 0);
}
