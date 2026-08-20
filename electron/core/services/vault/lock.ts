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
//              INITIAL CREDENTIAL, ruled by Jason 2026-08-14 (supersedes the 08-06 personal-email
//              placeholder — that literal must never appear in source again): the initial master
//              for a FRESH vault is DERIVED PER-INSTALL from device identity — SHA-256 over the
//              Windows MachineGuid + the SMBIOS hardware UUID, both read through the ONE identity
//              service — encoded to exactly 16 alphanumeric characters. LOCAL ONLY: never
//              transmitted, never logged, shown only by the dev-mode reveal. Stored ONLY as a
//              scrypt verifier + random salt (node:crypto — no new dependency), so an existing
//              vault keeps its stored verifier untouched and the wizard's future one-time change
//              just re-derives. Electron-free.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/vault/lock.ts
//------------------------------------------------------------
import crypto from "node:crypto";
import { readDeviceIdentity } from "../identity";
import type { Db } from "./db";
import { getBool, getInternal, getNumber, setInternal } from "./settings";
import { logAccess } from "./store";
import type { VaultLockState } from "./types";

/**
 * [master-password-placeholder] — the derived initial credential, Jason's ruling 2026-08-14.
 * Replaced the moment a chosen password is written (settings change, or the wizard's one-time
 * change presented as setup); delete this function when the real gate lands and the master
 * password joins KEY DERIVATION.
 *
 * SHA-256 over MachineGuid + SMBIOS hardware UUID — read through the ONE identity service, never
 * probed here — first 16 digest bytes mapped one-per-character onto a 62-char alphabet, giving
 * exactly 16 alphanumerics, no symbols. The modulo mapping carries a small bias toward the
 * alphabet's head; accepted — this credential gates the INTERFACE, while the SQLCipher key stays
 * machine-held in safeStorage (see the header). Deterministic per machine, so the dev-mode reveal
 * RECOMPUTES it on demand instead of anything ever storing it.
 */
const INITIAL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
export function deriveInitialMasterPassword(): string {
  const id = readDeviceIdentity();
  const material = `${id.machine_guid ?? ""}${id.hardware_uuid ?? ""}`;
  if (material === "") {
    throw new Error("Device identity is unavailable on this machine — the initial master password cannot be derived.");
  }
  const digest = crypto.createHash("sha256").update(material, "utf8").digest();
  let out = "";
  for (let i = 0; i < 16; i++) out += INITIAL_ALPHABET[digest[i] % INITIAL_ALPHABET.length];
  return out;
}

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
 * Guarantees a verifier exists, seeding the DERIVED initial on a fresh vault. Idempotent: an
 * existing verifier is NEVER overwritten — a password the user later sets, and every pre-08-14
 * vault's stored verifier, survives every boot.
 */
export function ensureMasterPassword(db: Db, orgId: string): void {
  if (getInternal(db, orgId, VERIFIER_KEY)) return;
  const salt = crypto.randomBytes(16).toString("hex");
  setInternal(db, orgId, SALT_KEY, salt);
  setInternal(db, orgId, VERIFIER_KEY, derive(deriveInitialMasterPassword(), salt));
}

/**
 * SEED THE VERIFIER FROM A PASSWORD THE USER CHOSE — first run's one write into the vault.
 *
 * This is `ensureMasterPassword` with the password supplied instead of derived, and it exists so a
 * brand-new install never meets a second setup wizard. `isSetupRequired` below returns true only
 * when the stored verifier matches the DERIVED initial; seeding from a chosen password means it
 * cannot match, so the boot-time vault wizard answers "not required" and never fires. **No flag, no
 * migration, no change to the detector** — the existing mechanism gives the right answer for free.
 *
 * IT MAY ONLY EVER ACT ON A VAULT THAT HAS NEVER BEEN SEEDED. The early return is the same guard
 * `ensureMasterPassword` uses, and it is the difference between a first-run helper and a silent
 * password reset: without it, any later call would overwrite a password its caller never knew.
 *
 * THE PASSWORD APPEARS IN NO ERROR MESSAGE. Both throws below describe the rule that was broken and
 * quote nothing. A first-run failure surfaces to the user, and an error string is the easiest place
 * in a codebase for a credential to end up in a log file.
 *
 * IT DERIVES FROM THE RAW STRING, not the trimmed one, even though the length check uses the
 * trimmed length. `verify()` below derives from exactly what the user types at the unlock screen —
 * seeding a trimmed value while verifying an untrimmed one would lock the owner out of their own
 * vault on the first restart. The trim is a validity test only; it never reaches `derive`.
 */
export function seedMasterPassword(db: Db, orgId: string, password: unknown): void {
  if (getInternal(db, orgId, VERIFIER_KEY)) return; // already seeded — never overwrite
  if (typeof password !== "string") {
    throw new Error("A master password is required.");
  }
  if (password.length < 12) {
    throw new Error("A master password must be at least 12 characters.");
  }
  // THE TRAILING-SPACE LOCKOUT, CLOSED HERE PERMANENTLY. This used to validate the TRIMMED length
  // and derive from the RAW string, which let a password with a trailing space pass the check and
  // seed a verifier containing the space — while the Done step printed it, and a trailing space is
  // invisible even in monospace. The user writes down what they can see, restarts, and is locked out
  // of their own vault with no recovery path.
  //
  // `verify()` below does not trim, and MUST NOT: trimming on one side only is what creates the
  // lockout in the first place. So the fix is to refuse the ambiguous input outright rather than
  // silently normalise it, and to refuse it on BOTH sides. The renderer now trims before it submits,
  // which means this branch can never fire in practice — it exists so the two sides can never
  // silently disagree again.
  if (password !== password.trim()) {
    throw new Error("A master password cannot begin or end with a space.");
  }
  const salt = crypto.randomBytes(16).toString("hex");
  setInternal(db, orgId, SALT_KEY, salt);
  setInternal(db, orgId, VERIFIER_KEY, derive(password, salt));
}

/**
 * HAS THE USER EVER SET THEIR OWN MASTER PASSWORD? — the vault setup wizard's one trigger.
 *
 * NOTHING STORED ANSWERS THIS, and that is why the shape is what it is. `ensureMasterPassword`
 * above and `changeMasterPassword` below write the SAME two keys, with the same random salt and the
 * same scrypt output: a seeded verifier and a chosen one are byte-for-byte indistinguishable. There
 * is no `set_at`, no flag, no provenance column anywhere.
 *
 * So this RECOMPUTES rather than reads — Jason's ruling, DECISIONS-56: "recompute-and-compare, zero
 * schema change". `deriveInitialMasterPassword()` is deterministic per machine and `derive()` is a
 * pure function of password and salt, so re-deriving against the STORED salt and comparing to the
 * STORED verifier answers the question with no migration and no new write, and it answers it
 * correctly for vaults that already exist.
 *
 * IT FAILS QUIET, NOT LOUD, AND THAT IS RULED. `deriveInitialMasterPassword()` throws when device
 * identity is unavailable (see above). A machine that cannot answer must not have its boot held
 * behind a wizard it can never satisfy, so a throw is logged and reported as "no setup required" —
 * the user reaches their application, and the vault behaves exactly as it did before this existed.
 *
 * IT LEAKS NOTHING. The return value is a boolean. The derived password, the salt and the verifier
 * never leave this function, and the error path logs the failure WITHOUT the value.
 */
export function isSetupRequired(db: Db, orgId: string): boolean {
  const stored = getInternal(db, orgId, VERIFIER_KEY);
  const salt = getInternal(db, orgId, SALT_KEY);
  // Nothing seeded yet — a genuinely fresh vault. `ensureMasterPassword` seeds it on the very next
  // vaultCtx(), and what it seeds is the derived initial, so setup is required either way.
  if (!stored || !salt) return true;
  try {
    const seeded = derive(deriveInitialMasterPassword(), salt);
    const a = Buffer.from(seeded, "hex");
    const b = Buffer.from(stored, "hex");
    // Same constant-time compare as verify() below. The timing of THIS call is not a secret, but a
    // second comparison convention in one file is how the careful one eventually gets edited away.
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (e) {
    console.error("[vault] setup check could not derive the initial master password:", e);
    return false;
  }
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
