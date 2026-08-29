// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: MindMerge attachment envelope encryption. Layer 1: a random 32-byte per-org secret
//              stored at <orgId>.mxd, encrypted at rest by Electron safeStorage (DPAPI/keychain).
//              Layer 2: Argon2id stretches that secret into the raw 32-byte SQLCipher key.
//              The plaintext secret never touches the repo, the DB, or app_settings.
//              FILENAMES ARE DELIBERATELY DULL (Jason ruled 08-02-2026): <org_id>.mxd for the key,
//              <org_id>.mtd for the database — no "mindmerge", no ".key", no ".locked". This is
//              OBSCURITY, NOT A SECURITY CONTROL: the protection is safeStorage + SQLCipher; the
//              dull names only stop the files from announcing themselves to a folder browser.
//              THE HONEST LIMIT (Jason 08-21-2026: "it doesnt have to lock, per say, just be
//              encrypted"): this protects the file AT REST — a copied db, a stolen drive, a walked
//              backup. It does NOT protect against code already running as this user: the app opens
//              it unattended, so anything running as the user can too. Right trade for screenshots
//              pasted into documents; wrong trade for credentials — which is why the vault still
//              locks. Never let a comment here imply vault-grade secrecy.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/mindmerge/attachCrypto.ts
//------------------------------------------------------------
import { app, safeStorage } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import argon2 from "argon2";

// Fixed salt keeps the derivation DETERMINISTIC — argon2.hash() salts randomly per call by
// default, which would mint a different key every boot and permanently lock the attachment store.
// Per-install uniqueness already comes from the random secret, so a constant salt is safe here.
// Distinct from the vault's salt — hygiene, never reuse (PHASE 5 ADDENDUM).
const KDF_SALT = Buffer.from("avertxai-mm-attach-kdf-v1");

export function getOrCreateAttachSecret(orgId: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("safeStorage unavailable — cannot protect the attachments key file");
  }
  const keyPath = path.join(app.getPath("userData"), `${orgId}.mxd`); // dull name by ruling — see header
  if (fs.existsSync(keyPath)) {
    return safeStorage.decryptString(fs.readFileSync(keyPath));
  }
  const secret = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(keyPath, safeStorage.encryptString(secret));
  return secret;
}

// Argon2id → raw 32 bytes → hex, ready for openAttachmentsDb's `PRAGMA key = "x'...'"`.
export async function deriveAttachKey(secret: string): Promise<string> {
  const raw = await argon2.hash(secret, {
    type: argon2.argon2id,
    raw: true,
    hashLength: 32,
    salt: KDF_SALT,
  });
  return raw.toString("hex");
}
