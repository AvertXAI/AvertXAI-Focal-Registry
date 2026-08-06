// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: [master-password-placeholder] — the unlock gate.
//
//              ⚠ READ THIS BEFORE TRUSTING IT. This gate protects the USER INTERFACE and the IPC
//              surface. It does NOT derive the SQLCipher key: the vault file still opens at boot
//              from the operating system's credential store (safeStorage → Argon2id → SQLCipher),
//              exactly as it did before. So this stops someone at the keyboard of an unlocked
//              machine — it does NOT stop code running as the same user, and it does NOT protect
//              the file at rest any more than the encryption already does. The real gate, when it
//              lands, must make the master password part of the KEY DERIVATION. Every seam that
//              has to change then is marked [master-password-placeholder] — grep for it.
//
//              PLACEHOLDER CREDENTIAL, ruled by Jason 08-06-2026: the initial master password is
//              his own email, "to get this project moving", with a change-password surface to
//              follow in the vault's settings. It is stored ONLY as a scrypt verifier + random
//              salt (node:crypto — no new dependency), never in plaintext, so the future change
//              flow just re-derives and the placeholder never has to be readable to work.
//              Electron-free.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/vault/lock.ts
//------------------------------------------------------------
import crypto from "node:crypto";
import type { Db } from "./db";
import { getBool, getInternal, getNumber, setInternal } from "./settings";
import { logAccess } from "./store";
import type { VaultLockState } from "./types";

/**
 * [master-password-placeholder] — the seeded credential, Jason's ruling 08-06-2026. Replaced the
 * moment the settings change-password surface writes a new verifier; delete this constant when the
 * real gate lands and a password is REQUIRED to be chosen at first run.
 */
const PLACEHOLDER_MASTER_PASSWORD = "lurpz.bmt@gmail.com";

const VERIFIER_KEY = "lock.verifier"; // internal — never renderer-writable (see settings.ts)
const SALT_KEY = "lock.salt";
const SCRYPT_KEYLEN = 32;

/** In-process lock state. Deliberately NOT persisted: a restart always lands locked, which is the
    only honest default for a credential store. */
let unlocked = false;
let failedAttempts = 0;
let lastActivityMs = 0;

function derive(password: string, saltHex: string): string {
  return crypto.scryptSync(password, Buffer.from(saltHex, "hex"), SCRYPT_KEYLEN).toString("hex");
}

/**
 * Guarantees a verifier exists, seeding the placeholder on first run. Idempotent: an existing
 * verifier is NEVER overwritten, so a password the user later sets survives every boot.
 */
export function ensureMasterPassword(db: Db, orgId: string): void {
  if (getInternal(db, orgId, VERIFIER_KEY)) return;
  const salt = crypto.randomBytes(16).toString("hex");
  setInternal(db, orgId, SALT_KEY, salt);
  setInternal(db, orgId, VERIFIER_KEY, derive(PLACEHOLDER_MASTER_PASSWORD, salt));
}

/** Constant-time compare — a length-varying or short-circuiting compare leaks by timing. */
function verify(db: Db, orgId: string, password: string): boolean {
  const stored = getInternal(db, orgId, VERIFIER_KEY);
  const salt = getInternal(db, orgId, SALT_KEY);
  if (!stored || !salt) return false;
  const candidate = derive(password, salt);
  const a = Buffer.from(candidate, "hex");
  const b = Buffer.from(stored, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function lockState(db: Db, orgId: string): VaultLockState {
  const enabled = getBool(db, orgId, "lock.enabled");
  return {
    enabled,
    locked: enabled ? !unlocked : false,
    failedAttempts,
    autoLockMinutes: getNumber(db, orgId, "lock.auto_minutes"),
  };
}

/** True when a caller may proceed. The gate is bypassed entirely when the user has turned the
    lock off, which is a supported choice — this is a convenience lock, and it says so. */
export function isUnlocked(db: Db, orgId: string): boolean {
  if (!getBool(db, orgId, "lock.enabled")) return true;
  autoLockIfIdle(db, orgId);
  return unlocked;
}

/**
 * Attempts an unlock, and RECORDS THE ATTEMPT ITSELF. The logging lives here rather than in the
 * IPC handler for a reason the engine proof caught: a caller that reached this function by any
 * other route would have left a failed attempt unrecorded, and the one event an audit trail exists
 * for is the one nobody should be able to forget. store.ts is still the only writer of the INSERT;
 * this just calls it. The attempted password is NEVER recorded — not its content, not its length.
 * A wrong password never says whether it was close, long, or short.
 */
export function unlock(db: Db, orgId: string, password: unknown, caller = "renderer"): { ok: boolean; state: VaultLockState } {
  const fail = (): { ok: boolean; state: VaultLockState } => {
    failedAttempts += 1;
    logAccess(db, orgId, "unlock_failed", null, null, caller, false, `attempt ${failedAttempts}`);
    return { ok: false, state: lockState(db, orgId) };
  };
  if (typeof password !== "string" || password === "") return fail();
  if (!verify(db, orgId, password)) return fail();
  unlocked = true;
  failedAttempts = 0;
  lastActivityMs = Date.now();
  logAccess(db, orgId, "unlock", null, null, caller, true);
  return { ok: true, state: lockState(db, orgId) };
}

export function lock(db: Db, orgId: string, caller = "renderer"): VaultLockState {
  unlocked = false;
  logAccess(db, orgId, "lock", null, null, caller, true);
  return lockState(db, orgId);
}

/** Every granted operation touches this, so the idle clock measures USE, not wall time. */
export function touch(): void {
  lastActivityMs = Date.now();
}

/** Auto-lock after N idle minutes. 0 (the default) means never — the timer exists, switched off. */
function autoLockIfIdle(db: Db, orgId: string): void {
  const minutes = getNumber(db, orgId, "lock.auto_minutes");
  if (!unlocked || minutes <= 0 || lastActivityMs === 0) return;
  if (Date.now() - lastActivityMs >= minutes * 60_000) unlocked = false;
}

/**
 * Changes the master password. The old one must be supplied and correct — a change path that
 * skips that turns an unlocked screen into a permanent takeover. [master-password-placeholder]:
 * this is what the settings surface will call, and it is already the real thing.
 */
export function changeMasterPassword(db: Db, orgId: string, current: unknown, next: unknown): void {
  if (typeof next !== "string" || next.length < 8 || next.length > 512) {
    throw new Error("A master password must be at least 8 characters.");
  }
  if (typeof current !== "string" || !verify(db, orgId, current)) {
    throw new Error("The current master password is not correct.");
  }
  const salt = crypto.randomBytes(16).toString("hex");
  setInternal(db, orgId, SALT_KEY, salt);
  setInternal(db, orgId, VERIFIER_KEY, derive(next, salt));
  unlocked = true;
  failedAttempts = 0;
}

/** TEST SEAM — lets a harness start from a known locked state. Never reachable from IPC. */
export function resetLockForTest(): void {
  unlocked = false;
  failedAttempts = 0;
  lastActivityMs = 0;
}
