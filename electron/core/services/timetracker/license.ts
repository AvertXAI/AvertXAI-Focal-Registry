// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: TimeTracker licensing — HARDCODED AND OFFLINE by canon ruling. No engine, no
//              server, no network call, ever. Keys are validated locally against the constant
//              below; tiers gate caps on projects, concurrent timers, and CUSTOM sound uploads
//              only (all 17 bundled sounds work at every tier; adjustments are never capped).
//              Both stored values (licenseKey + marketplaceId) may carry entitlement — the
//              HIGHEST wins at read time and neither ever overwrites the other. No key = FREE,
//              and FREE is a working tier, not a lockout.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/timetracker/license.ts
//------------------------------------------------------------
import type { Db } from "./db";

export type Tier = "free" | "pro" | "business";

// ⚠⚠⚠ JASON PASTES THE REAL KEYS HERE — THE ONE LICENCE CONSTANT IN THE CODEBASE. ⚠⚠⚠
// Format: XXXX-XXXX-XXXX-XXXX (16 alphanumerics in four hyphenated groups), UPPER CASE.
// Several keys per tier are fine (one per sale). Empty lists mean no key validates yet,
// which resolves every install to FREE — safe to ship before the keys exist.
export const LICENSE_KEYS: { PRO: string[]; BUSINESS: string[] } = {
  PRO: ["K7QM-3XVB-9TLD-2WRF"],
  BUSINESS: ["P4HN-8ZJC-6YKS-1BGM"],
};

export const KEY_FORMAT = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

/** Caps per tier. null = unlimited. Adjustments are deliberately absent — never capped. */
export const CAPS: Record<Tier, { projects: number | null; timers: number | null; soundUploads: number | null }> = {
  free: { projects: 3, timers: 3, soundUploads: 3 },
  pro: { projects: 10, timers: 10, soundUploads: 10 },
  business: { projects: null, timers: null, soundUploads: null },
};

const TIER_RANK: Record<Tier, number> = { free: 0, pro: 1, business: 2 };
export const TIER_LABEL: Record<Tier, string> = { free: "Free", pro: "Pro", business: "Business" };

/** Case-insensitive on entry, normalised to UPPER CASE; null when the shape is wrong. */
export function normalizeKey(raw: string): string | null {
  const k = raw.trim().toUpperCase();
  return KEY_FORMAT.test(k) ? k : null;
}

/** The tier a single stored value entitles, or null (unknown/empty/not a key). */
export function tierOfKey(value: string | null): Tier | null {
  if (!value) return null;
  const k = value.trim().toUpperCase();
  if (LICENSE_KEYS.BUSINESS.includes(k)) return "business";
  if (LICENSE_KEYS.PRO.includes(k)) return "pro";
  return null;
}

const LICENSE_KEY_SETTING = "timetracker.licenseKey";
const MARKETPLACE_ID_SETTING = "timetracker.marketplaceId";

function readSetting(db: Db, key: string): string | null {
  const row = db.prepare(`SELECT value FROM app_settings WHERE key = ?`).get(key) as { value: string } | undefined;
  return row?.value ?? null;
}
function writeSetting(db: Db, key: string, value: string | null): void {
  if (value === null || value === "") {
    db.prepare(`DELETE FROM app_settings WHERE key = ?`).run(key);
    return;
  }
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}

/** RESOLUTION RULE: both stored values are checked; the HIGHEST entitlement wins. No key → FREE. */
export function resolveTier(db: Db): Tier {
  const candidates: Tier[] = ["free"];
  const a = tierOfKey(readSetting(db, LICENSE_KEY_SETTING));
  const b = tierOfKey(readSetting(db, MARKETPLACE_ID_SETTING));
  if (a) candidates.push(a);
  if (b) candidates.push(b);
  return candidates.sort((x, y) => TIER_RANK[y] - TIER_RANK[x])[0];
}

export interface LicenseState {
  tier: Tier;
  caps: { projects: number | null; timers: number | null; soundUploads: number | null };
  licenseKey: string | null;
  marketplaceId: string | null;
  /** Per-field entitlement, for live validation feedback in the settings UI. */
  keyTiers: { licenseKey: Tier | null; marketplaceId: Tier | null };
}

export function getLicenseState(db: Db): LicenseState {
  const licenseKey = readSetting(db, LICENSE_KEY_SETTING);
  const marketplaceId = readSetting(db, MARKETPLACE_ID_SETTING);
  const tier = resolveTier(db);
  return {
    tier,
    caps: CAPS[tier],
    licenseKey,
    marketplaceId,
    keyTiers: { licenseKey: tierOfKey(licenseKey), marketplaceId: tierOfKey(marketplaceId) },
  };
}

/** Strict key-format field. Empty clears; a malformed key throws before anything is stored.
    NEVER touches the marketplaceId setting (never overwrite one key with the other). */
export function setLicenseKey(db: Db, raw: string): LicenseState {
  const trimmed = raw.trim();
  if (trimmed === "") {
    writeSetting(db, LICENSE_KEY_SETTING, null);
    return getLicenseState(db);
  }
  const k = normalizeKey(trimmed);
  if (!k) throw new Error("Licence keys look like XXXX-XXXX-XXXX-XXXX — four groups of four letters or digits.");
  writeSetting(db, LICENSE_KEY_SETTING, k);
  return getLicenseState(db);
}

/** Lenient identifier field (product/purchase/installation ids vary) — but if the value happens to
    be a valid key it participates in tier resolution, which is how "both keys held" works. */
export function setMarketplaceId(db: Db, raw: string): LicenseState {
  const v = raw.trim().toUpperCase().slice(0, 64);
  writeSetting(db, MARKETPLACE_ID_SETTING, v === "" ? null : v);
  return getLicenseState(db);
}

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
/**
 * DEMO-DATA ESCAPE HATCH. Tier caps are a PRODUCT rule (what a Free user may create), not a
 * data-integrity rule, and the demo set is deliberately larger than Free allows because its whole
 * purpose is to exercise surfaces that only show something with real volume behind them.
 * Set ONLY by devseed.generateDemo, always restored in a finally. Everything else about the demo
 * still goes through the real services, so every validator and CHECK constraint still applies.
 */
let capsSuspended = false;
export function setCapsSuspended(v: boolean): void {
  capsSuspended = v;
}
export function areCapsSuspended(): boolean {
  return capsSuspended;
}

export function enforceCap(db: Db, kind: CapKind): void {
  if (capsSuspended) return;
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
