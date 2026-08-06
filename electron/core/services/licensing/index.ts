// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Licensing — HARDCODED AND OFFLINE by canon ruling. No engine, no server, no network
//              call, ever. Keys are validated locally against the constant below; no key = FREE,
//              and FREE is a working tier, not a lockout.
//
//              MOVED TO CORE 2026-08-06 (Jason's ruling): this logic lived inside TimeTracker's
//              service layer, which left Employees unable to consult it — its people cap was a
//              hardcoded 5 that ignored every key, so a BUSINESS key unlocked unlimited projects
//              while the sixth employee still refused. Tier resolution is a PLATFORM concern, like
//              db/ and utils/: both modules (and any future one) read it from here, and neither
//              reaches into the other's service layer. TimeTracker's license.ts re-exports this
//              file so its existing imports are untouched; cap ENFORCEMENT stays per-module,
//              because the counts are per-module queries.
//
//              The stored keys keep their historical names ("timetracker.licenseKey" /
//              "timetracker.marketplaceId") — renaming them would orphan every existing activation.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/licensing/index.ts
//------------------------------------------------------------
import type Database from "better-sqlite3-multiple-ciphers";

type Db = Database.Database;

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

/**
 * Caps per tier. null = unlimited. Adjustments are deliberately absent — never capped, at any tier.
 * `people` joined 2026-08-06 when the Employees cap became tier-aware: free 5 is canon
 * (DECISIONS-51 "Free tier caps employees at 5"); business unlimited follows the tier's meaning;
 * pro 10 follows the 3→10→unlimited shape of every other cap and is flagged in the report as the
 * one number canon does not state.
 */
export const CAPS: Record<
  Tier,
  { projects: number | null; timers: number | null; soundUploads: number | null; people: number | null }
> = {
  free: { projects: 3, timers: 3, soundUploads: 3, people: 5 },
  pro: { projects: 10, timers: 10, soundUploads: 10, people: 10 },
  business: { projects: null, timers: null, soundUploads: null, people: null },
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

// Historical key names, kept — see the header.
export const LICENSE_KEY_SETTING = "timetracker.licenseKey";
export const MARKETPLACE_ID_SETTING = "timetracker.marketplaceId";

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

/** RESOLUTION RULE: both stored values are checked; the HIGHEST entitlement wins. No key → FREE.
    Deliberately unmemoised — every caller sees a fresh read, so activation takes effect on the
    very next cap check with no reload (relied on by the seed generator). */
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
  caps: { projects: number | null; timers: number | null; soundUploads: number | null; people: number | null };
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

/** The raw stored key, for a caller that must restore state later (the seed's symmetric purge). */
export function getStoredLicenseKey(db: Db): string | null {
  return readSetting(db, LICENSE_KEY_SETTING);
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
