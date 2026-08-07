// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: The vault's OWN settings store — config-as-data, rows read at runtime, never a
//              hardcoded renderer constant and never app_settings in the shared database. Canon:
//              "The Vault owns its own settings. The application's Settings page carries no vault
//              controls, ever." ONE DEFAULTS const is the single source of truth and NOTHING IS EVER
//              SEEDED — the structural fix for TimeTracker's break_enabled bug, where a seeded row
//              and a default disagreed and turning the setting off did not stick. A key is written
//              only when the user actually changes it. Electron-free.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/vault/settings.ts
//------------------------------------------------------------
import { nowIso, type Db } from "./db";
import { generateUUIDv7 } from "../utils/uuidv7";

/**
 * THE single source of truth for every vault preference. A key absent from the table reads its
 * value from here; nothing is pre-written. Values are strings because the store is key/value —
 * the typed readers below are the only place parsing happens.
 */
export const VAULT_DEFAULTS = {
  // The master-password seam. [master-password-placeholder] — see lock.ts.
  "lock.enabled": "1",
  "lock.auto_minutes": "0", // 0 = never auto-lock. The timer is a later build; the row exists now.
  "lock.on_minimize": "0",
  "lock.wipe_after_failures": "0", // 0 = never. Jason's stolen-laptop concept; OFF until ruled.
  "clipboard.clear_seconds": "30",
  // Presentation — remembered across navigation, per canon (view state persists to the database).
  "view.mode": "list", // 'list' | 'grid'
  "view.sort": "label", // 'label' | 'recent' | 'kind'
  "view.show_archived": "0",
  // Generator preferences, so a photographer's chosen shape survives the app closing.
  "generator.length": "16",
  "generator.lowercase": "1",
  "generator.uppercase": "1",
  "generator.numbers": "1",
  "generator.symbols": "1",
  "generator.exclude_similar": "0",
  "generator.exclude_ambiguous": "0",
  "generator.no_repeats": "0",
  // Health thresholds — a setting, never a constant, so "stale" can be tuned without a build.
  "health.stale_days": "90",
  "health.min_length": "12",
  // Dark-web exposure checks (XposedOrNot). THE ONLY FEATURE IN THE VAULT THAT TOUCHES THE
  // NETWORK, and therefore OFF until the user turns it on — see breach.ts for what each check
  // does and does not send.
  "breach.enabled": "0",
} as const;

export type VaultSettingKey = keyof typeof VAULT_DEFAULTS;

/** Every key the renderer may write. A key outside this list is refused at the trust boundary —
    the same whitelist doctrine as the shell's RENDERER_KEYS, kept inside the vault. */
export const VAULT_WRITABLE_KEYS: readonly VaultSettingKey[] = Object.keys(VAULT_DEFAULTS) as VaultSettingKey[];

export function getSetting(db: Db, orgId: string, key: VaultSettingKey): string {
  const row = db
    .prepare("SELECT value FROM vault_settings WHERE org_id = ? AND key = ?")
    .get(orgId, key) as { value: string } | undefined;
  return row?.value ?? VAULT_DEFAULTS[key];
}

export function getNumber(db: Db, orgId: string, key: VaultSettingKey): number {
  const n = Number(getSetting(db, orgId, key));
  return Number.isFinite(n) ? n : Number(VAULT_DEFAULTS[key]);
}

export function getBool(db: Db, orgId: string, key: VaultSettingKey): boolean {
  return getSetting(db, orgId, key) === "1";
}

/** Reads every key — defaults included — so the renderer never has to know the default list. */
export function getAllSettings(db: Db, orgId: string): Record<string, string> {
  const out: Record<string, string> = { ...VAULT_DEFAULTS };
  const rows = db.prepare("SELECT key, value FROM vault_settings WHERE org_id = ?").all(orgId) as {
    key: string;
    value: string;
  }[];
  for (const r of rows) if (r.key in VAULT_DEFAULTS) out[r.key] = r.value;
  return out;
}

/** Upsert. Refuses an unknown key rather than storing junk the readers will never look at. */
export function setSetting(db: Db, orgId: string, key: unknown, value: unknown): void {
  if (typeof key !== "string" || !(key in VAULT_DEFAULTS)) throw new Error("Unknown vault setting");
  if (typeof value !== "string" || value.length > 500) throw new Error("Invalid vault setting value");
  const at = nowIso();
  db.prepare(
    `INSERT INTO vault_settings (uuid, org_id, key, value, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(org_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(generateUUIDv7(), orgId, key, value, at, at);
}

/**
 * INTERNAL key/value pairs that are NOT user preferences and NOT renderer-writable — the lock
 * verifier and its salt, the seed ledger. Same table, deliberately outside VAULT_DEFAULTS so
 * setSetting can never reach them from the bridge.
 */
export function getInternal(db: Db, orgId: string, key: string): string | null {
  const row = db
    .prepare("SELECT value FROM vault_settings WHERE org_id = ? AND key = ?")
    .get(orgId, key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setInternal(db: Db, orgId: string, key: string, value: string): void {
  const at = nowIso();
  db.prepare(
    `INSERT INTO vault_settings (uuid, org_id, key, value, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(org_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(generateUUIDv7(), orgId, key, value, at, at);
}

export function clearInternal(db: Db, orgId: string, key: string): void {
  db.prepare("DELETE FROM vault_settings WHERE org_id = ? AND key = ?").run(orgId, key);
}
