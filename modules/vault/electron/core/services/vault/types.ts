// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Vault service-side shapes. The renderer's copies live in src/shared/types.ts (the
//              renderer imports from there, never from services/ — the established precedent); the
//              process boundary keeps the two sets deliberately separate. THE SPLIT THAT MATTERS:
//              VaultSecretMeta never carries a credential — VaultSecretWithValue exists solely for
//              the single explicit logged read, and nothing else returns it. Backup codes and
//              security answers ride VaultSecretExtras, which is part of the value payload, NOT of
//              the metadata, for exactly the same reason the password is.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/vault/types.ts
//------------------------------------------------------------
export type { VaultAction } from "./db";

/** Credential material that versions WITH the password as one atomic unit. Never in a list. */
export interface VaultSecretExtras {
  /** One-time backup codes, as typed — the workbook's Backup codes column. */
  backupCodes?: string[];
  /** Question → answer. The ANSWER is a credential; that is why this is not metadata. */
  securityQuestions?: { question: string; answer: string }[];
}

export interface VaultSecretInput {
  kind: string; // open set — 'login', 'api_key', 'taxpayer_id', …
  label: string; // the company / display name
  value: string; // the password or key itself
  fullName?: string | null;
  username?: string | null;
  url?: string | null;
  notes?: string | null;
  folderId?: number | null;
  extras?: VaultSecretExtras | null;
}

/** Metadata ONLY — list surfaces return this and nothing richer. No credential field exists here
 *  to leak: password, backup codes and security answers are all on the version row. */
export interface VaultSecretMeta {
  id: number;
  uuid: string; // the public locator other modules hold (adjustments doctrine: std uuid = public id)
  kind: string;
  label: string;
  full_name: string | null;
  username: string | null;
  url: string | null;
  notes: string | null;
  favourite: number;
  folder_id: number | null;
  version: number; // DERIVED — the history's highest version; nothing stores it on the secret row
  archived_at: string | null;
  archive_reason: string | null;
  created_at: string;
  updated_at: string | null;
  /** Newest access-log timestamp for this secret, or null. Derived, never stored. */
  last_read_at?: string | null;
}

/** The single value-bearing shape — returned by readSecret alone, after its access-log row lands. */
export interface VaultSecretWithValue extends VaultSecretMeta {
  value: string;
  extras: VaultSecretExtras | null;
}

/** One row of the append-only history. Value-FREE by construction: a version list must never
 *  become a second way out for credentials (the whole point of one logged read). */
export interface VaultVersionRow {
  version: number;
  created_at: string;
  /** True when this row also carried backup codes or security answers. Never the content. */
  has_extras: boolean;
}

export interface VaultAccessRow {
  id: number;
  ts: string;
  action: string;
  secret_uuid: string | null;
  secret_label: string | null;
  caller: string;
  granted: number;
  detail: string | null;
}

export interface VaultFolder {
  id: number;
  uuid: string;
  name: string;
  parent_id: number | null;
  sort_order: number;
}

/** Health verdicts. Computed MAIN-side over the decrypted set; only these verdicts cross the
 *  bridge, never the values they were computed from. */
export interface VaultHealthItem {
  uuid: string;
  label: string;
  username: string | null;
  /** 0-100. Higher is healthier. */
  score: number;
  weak: boolean;
  reused: boolean;
  /** Days since the current version was written; null when the timestamp is unreadable. */
  ageDays: number | null;
  stale: boolean;
  /** Plain sentences a photographer can act on — never the password itself. */
  reasons: string[];
}

export interface VaultHealthReport {
  total: number;
  healthy: number;
  weak: number;
  reused: number;
  stale: number;
  /** 0-100 headline number for the donut. */
  score: number;
  items: VaultHealthItem[];
}

export interface VaultGeneratorOptions {
  length: number;
  lowercase: boolean;
  uppercase: boolean;
  numbers: boolean;
  symbols: boolean;
  excludeSimilar: boolean;
  excludeAmbiguous: boolean;
  noRepeats: boolean;
}

/** What the renderer may know about the lock. Never the verifier, never the salt. */
export interface VaultLockState {
  /** Whether a master password is required at all (placeholder default: true). */
  enabled: boolean;
  /** Whether the vault is locked RIGHT NOW in this process. */
  locked: boolean;
  /** Consecutive failed unlock attempts since the last success. */
  failedAttempts: number;
  /** Minutes of inactivity before an auto-lock; 0 = never. */
  autoLockMinutes: number;
}
