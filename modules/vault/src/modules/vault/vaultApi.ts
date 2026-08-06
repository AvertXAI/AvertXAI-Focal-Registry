// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: The renderer's view of the vault bridge. These shapes are renderer-safe COPIES of
//              the service types (the renderer imports from shared types, never from services/) —
//              on copy-back they move into src/shared/types.ts and the preload gains the matching
//              `vault:` block, which is why they live in one file and not scattered through the
//              views. Note what is ABSENT and cannot be reached by accident: no bulk value read, no
//              past-version value, no way to write an internal setting.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: src/modules/vault/vaultApi.ts
//------------------------------------------------------------

export interface VaultSecretExtras {
  backupCodes?: string[];
  securityQuestions?: { question: string; answer: string }[];
}

/** Metadata — what every list surface may see. No credential field exists here. */
export interface VaultSecretMeta {
  id: number;
  uuid: string;
  kind: string;
  label: string;
  full_name: string | null;
  username: string | null;
  url: string | null;
  notes: string | null;
  favourite: number;
  folder_id: number | null;
  version: number;
  archived_at: string | null;
  archive_reason: string | null;
  created_at: string;
  updated_at: string | null;
  last_read_at?: string | null;
}

/** The only shape that carries credentials, and only ever from read(). */
export interface VaultSecretWithValue extends VaultSecretMeta {
  value: string;
  extras: VaultSecretExtras | null;
}

export interface VaultSecretInput {
  kind: string;
  label: string;
  value: string;
  fullName?: string | null;
  username?: string | null;
  url?: string | null;
  notes?: string | null;
  folderId?: number | null;
  extras?: VaultSecretExtras | null;
}

export interface VaultVersionRow {
  version: number;
  created_at: string;
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

export interface VaultHealthItem {
  uuid: string;
  label: string;
  username: string | null;
  score: number;
  weak: boolean;
  reused: boolean;
  ageDays: number | null;
  stale: boolean;
  reasons: string[];
}

export interface VaultHealthReport {
  total: number;
  healthy: number;
  weak: number;
  reused: number;
  stale: number;
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

export interface VaultStrength {
  bits: number;
  level: 0 | 1 | 2 | 3 | 4;
  label: string;
  crackTime: string;
}

export interface VaultLockState {
  enabled: boolean;
  locked: boolean;
  failedAttempts: number;
  autoLockMinutes: number;
}

export interface VaultApi {
  lockState: () => Promise<VaultLockState>;
  unlock: (password: string) => Promise<VaultLockState>;
  lock: () => Promise<VaultLockState>;
  changeMasterPassword: (current: string, next: string) => Promise<VaultLockState>;
  create: (input: VaultSecretInput) => Promise<VaultSecretMeta>;
  list: (includeArchived?: boolean) => Promise<VaultSecretMeta[]>;
  /** THE one credential path. Access-logged main-side, misses included. */
  read: (uuid: string) => Promise<VaultSecretWithValue>;
  supersede: (uuid: string, value: string, extras?: VaultSecretExtras | null) => Promise<VaultSecretMeta>;
  updateMeta: (uuid: string, patch: Partial<VaultSecretInput>) => Promise<VaultSecretMeta>;
  setFavourite: (uuid: string, on: boolean) => Promise<VaultSecretMeta>;
  archive: (uuid: string, reason?: string | null) => Promise<VaultSecretMeta>;
  restore: (uuid: string) => Promise<VaultSecretMeta>;
  listVersions: (uuid: string) => Promise<VaultVersionRow[]>;
  listAccessLog: (opts?: { limit?: number; secretUuid?: string }) => Promise<VaultAccessRow[]>;
  health: () => Promise<VaultHealthReport>;
  generate: (opts?: Partial<VaultGeneratorOptions>) => Promise<string>;
  strength: (value: string) => Promise<VaultStrength>;
  getSettings: () => Promise<Record<string, string>>;
  setSetting: (key: string, value: string) => Promise<Record<string, string>>;
  seedStatus: () => Promise<{ present: boolean; count: number }>;
  loadSeed: () => Promise<{ ok: boolean; error?: string; created?: number; superseded?: number }>;
  purgeSeed: () => Promise<{ ok: boolean; error?: string; removed?: number }>;
}

/** The lane's local view of the bridge. On copy-back this member joins the shared `Api` interface
    and this declaration is deleted — it exists so the module compiles standing alone. */
declare global {
  interface Window {
    api: { vault: VaultApi } & Record<string, unknown>;
  }
}

export const vaultApi = (): VaultApi => window.api.vault;
