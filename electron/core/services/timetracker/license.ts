// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: TimeTracker cap ENFORCEMENT. The licence logic itself (keys, tiers, CAPS,
//              resolution, activation) moved to core — electron/core/services/licensing — on
//              2026-08-06, because Employees needed the same tier and a module must never reach
//              into another module's service layer. This file re-exports the core surface so every
//              existing TimeTracker import keeps working, and keeps only what is genuinely
//              TimeTracker's: the live counts its caps are checked against.
//
//              THE setCapsSuspended BACK DOOR IS DELETED (Jason's ruling, 08-06). The seed
//              generator now clears the caps the way a customer would — by activating a key
//              through setLicenseKey — so no code path can switch the product rules off.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/timetracker/license.ts
//------------------------------------------------------------
import type { Db } from "./db";
import { CAPS, resolveTier, TIER_LABEL } from "../licensing";

// The whole licence surface, re-exported from core — one source of truth, zero import churn.
export {
  CAPS,
  KEY_FORMAT,
  LICENSE_KEYS,
  TIER_LABEL,
  getLicenseState,
  normalizeKey,
  resolveTier,
  setLicenseKey,
  setMarketplaceId,
  tierOfKey,
  type LicenseState,
  type Tier,
} from "../licensing";

// ---- cap enforcement — MAIN-SIDE, in the service layer. A disabled button is a hint; THIS is
// ---- the limit. Counts are live queries so the refusal can never trust stale renderer state.
type CapKind = "projects" | "timers" | "soundUploads";

const NOUN: Record<CapKind, string> = {
  projects: "projects",
  timers: "concurrent timers",
  soundUploads: "custom sound uploads",
};

function countOf(db: Db, kind: CapKind): number {
  if (kind === "projects") {
    // Active (non-archived) projects count against the cap — archiving frees a slot. Flagged
    // as a reviewable reading in the Phase 6A report.
    return (db.prepare(`SELECT COUNT(*) AS n FROM timetracker_projects WHERE archived_at IS NULL`).get() as { n: number }).n;
  }
  if (kind === "timers") {
    return (db.prepare(`SELECT COUNT(*) AS n FROM timetracker_active_sessions`).get() as { n: number }).n;
  }
  return (db.prepare(`SELECT COUNT(*) AS n FROM timetracker_alert_sounds WHERE is_bundled = 0`).get() as { n: number }).n;
}

/** Throws a plain, tier-naming error when the cap is already met. null cap = unlimited = no-op. */
export function enforceCap(db: Db, kind: CapKind): void {
  const tier = resolveTier(db);
  const cap = CAPS[tier][kind];
  if (cap === null) return;
  const n = countOf(db, kind);
  if (n < cap) return;
  const lift =
    tier === "free"
      ? `The Pro tier raises this to ${CAPS.pro[kind]}; Business is unlimited.`
      : `The Business tier is unlimited.`;
  throw new Error(`Cap reached: the ${TIER_LABEL[tier]} tier allows ${cap} ${NOUN[kind]}. ${lift}`);
}
