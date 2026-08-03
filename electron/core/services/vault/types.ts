// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Vault service-side shapes. The renderer's copies live in src/shared/types.ts (the
//              renderer imports from there, never from services/ — the established precedent); the
//              process boundary keeps the two sets deliberately separate. The split that matters:
//              VaultSecretMeta NEVER carries a value — VaultSecretWithValue exists solely for the
//              single explicit read, and nothing else returns it.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/vault/types.ts
//------------------------------------------------------------

/** The four loggable asks. 'read' is the only one that ever returns a value. */
export type VaultAction = "create" | "read" | "supersede" | "archive";

export interface VaultSecretInput {
  kind: string; // open set — 'api_key', 'password', 'taxpayer_id', …
  label: string;
  value: string;
}

/** Metadata ONLY — list surfaces return this and nothing richer. No value field exists to leak. */
export interface VaultSecretMeta {
  id: number;
  uuid: string; // the public locator other modules hold (adjustments doctrine: std uuid = public id)
  kind: string;
  label: string;
  version: number; // DERIVED — the history's highest version; nothing stores it on the secret row
  archived_at: string | null;
  archive_reason: string | null;
  created_at: string;
  updated_at: string | null;
}

/** The single value-bearing shape — returned by readSecret alone, after its access-log row lands. */
export interface VaultSecretWithValue extends VaultSecretMeta {
  value: string;
}
