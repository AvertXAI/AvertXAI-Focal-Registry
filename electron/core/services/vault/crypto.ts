// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Vault envelope encryption. Layer 1: a random 32-byte per-org secret stored at
//              vault_<orgId>.key, encrypted at rest by Electron safeStorage (DPAPI/keychain).
//              Layer 2: Argon2id stretches that secret into the raw 32-byte SQLCipher key.
//              The plaintext secret never touches the repo, the DB, or app_settings.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/vault/crypto.ts
//------------------------------------------------------------
import { app, safeStorage } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import argon2 from "argon2";

// Fixed salt keeps the derivation DETERMINISTIC — argon2.hash() salts randomly per call by
// default, which would mint a different key every boot and permanently lock the vault.
// Per-install uniqueness already comes from the random secret, so a constant salt is safe here.
const KDF_SALT = Buffer.from("avertxai-vault-kdf-v1");

export function getOrCreateVaultSecret(orgId: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("safeStorage unavailable — cannot protect the vault key file");
  }
  const keyPath = path.join(app.getPath("userData"), `vault_${orgId}.key`);
  if (fs.existsSync(keyPath)) {
    return safeStorage.decryptString(fs.readFileSync(keyPath));
  }
  const secret = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(keyPath, safeStorage.encryptString(secret));
  return secret;
}

// Argon2id → raw 32 bytes → hex, ready for openDb's `PRAGMA key = "x'...'"`.
export async function deriveVaultKey(secret: string): Promise<string> {
  const raw = await argon2.hash(secret, {
    type: argon2.argon2id,
    raw: true,
    hashLength: 32,
    salt: KDF_SALT,
  });
  return raw.toString("hex");
}
