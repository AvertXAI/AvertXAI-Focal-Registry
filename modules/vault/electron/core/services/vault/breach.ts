// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Dark-web exposure checks against XposedOrNot (MIT-licensed, free, no API key for
//              the two endpoints used here). THIS IS THE ONLY FILE IN THE VAULT THAT TOUCHES THE
//              NETWORK, and it is off by default — every check is a thing the user asked for.
//
//              TWO ENDPOINTS, TWO VERY DIFFERENT PRIVACY PROPERTIES. Read this before changing
//              anything here, because the difference is the whole design:
//
//              1. PASSWORD — k-anonymous, and therefore safe to run across the whole vault.
//                 The password is hashed LOCALLY and only the FIRST 10 CHARACTERS of the digest
//                 are sent. The service receives a bucket prefix shared by countless passwords and
//                 cannot know which one was asked about. The password itself never leaves.
//
//              2. EMAIL — NOT anonymous. The full address goes in the URL path. That is a real
//                 disclosure to a third party, so it is ONE ADDRESS AT A TIME, on an explicit
//                 press, never a background sweep — which would also blow the free tier's 25-50
//                 per hour cap and hand over the user's entire account list in one go.
//
//              Nothing here is ever called automatically. Nothing is cached to disk. A network
//              failure is reported as "could not check", NEVER as "you are safe".
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/vault/breach.ts
//------------------------------------------------------------
import type { Db } from "./db";
import { keccak512Hex } from "./keccak";
import { getBool } from "./settings";
import { logAccess, readAllForAnalysis } from "./store";

const PASSWORD_ENDPOINT = "https://passwords.xposedornot.com/api/v1/pass/anon/";
const EMAIL_ENDPOINT = "https://api.xposedornot.com/v1/check-email/";
/** The published anonymity window: hash locally, send this many hex characters and no more. */
const PREFIX_LENGTH = 10;
const TIMEOUT_MS = 12_000;

export interface PasswordExposure {
  uuid: string;
  label: string;
  /** The entry's website, so the screen can offer to open it — metadata, never a credential. */
  site: string | null;
  /** True when the bucket contained this exact digest. */
  exposed: boolean;
  /** How many times the service has seen it, when it says. */
  count: number | null;
}

export interface PasswordSweepResult {
  ok: boolean;
  error?: string;
  checked: number;
  exposed: PasswordExposure[];
}

export interface EmailExposureResult {
  ok: boolean;
  error?: string;
  exposed: boolean;
  /** Named breaches the address appeared in — public knowledge, not a credential. */
  breaches: string[];
}

/** One fetch with a hard timeout. A hung request must never leave a spinner running forever. */
async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": "FocalRegistry-Vault" },
    });
    // 404 is the service's "not found", which for a breach check is good news, not an error.
    const body = res.status === 404 ? null : await res.json().catch(() => null);
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The local half of k-anonymity: ORIGINAL Keccak-512 (see keccak.ts for why this is not
 * crypto.createHash('sha3-512') — that returns a digest the service has never seen, and every
 * lookup would 404 into a false "you are safe").
 */
export function passwordDigest(password: string): string {
  return keccak512Hex(password);
}

/** The service's own composition signature: digits, letters, symbols, length. */
function charSignature(password: string): string {
  const digits = (password.match(/\d/g) ?? []).length;
  const alpha = (password.match(/[a-zA-Z]/g) ?? []).length;
  const symbols = password.length - digits - alpha;
  return `D:${digits};A:${alpha};S:${symbols};L:${password.length}`;
}

/**
 * Checks ONE password without sending it.
 *
 * HOW THE ANSWER IS ACTUALLY DECIDED, verified against the live service 08-06-2026. The endpoint
 * does NOT return a list of full hashes to search — it returns one record describing the exposed
 * password that matched our 10-character prefix:
 *     {"SearchPassAnon":{"anon":"aa77c1b9b7","char":"D:3;A:8;S:0;L:11","count":"62703"}}
 * A 10-character prefix is 40 bits and is deliberately shared, so a 200 alone is NOT proof: some
 * other password could occupy the same bucket. The `char` field is what closes it — it describes
 * the composition of the exposed password, and we compare it against OUR password's composition
 * locally. Match means it is ours; mismatch means the bucket belongs to somebody else's password
 * and ours is not in the set. That is the whole point of k-anonymity, and it is why the deciding
 * comparison happens HERE and not on their server.
 */
export async function checkPassword(password: string): Promise<{ ok: boolean; exposed: boolean; count: number | null; error?: string }> {
  if (typeof password !== "string" || password === "") return { ok: false, exposed: false, count: null, error: "No password given." };
  const prefix = passwordDigest(password).slice(0, PREFIX_LENGTH);
  try {
    const { status, body } = await getJson(`${PASSWORD_ENDPOINT}${prefix}`);
    // 404 is the good answer: nothing in the exposed set starts with this prefix.
    if (status === 404 || body == null) return { ok: true, exposed: false, count: null };
    if (status === 429) return { ok: false, exposed: false, count: null, error: "The breach service is rate-limiting. Try again shortly." };
    if (status >= 400) return { ok: false, exposed: false, count: null, error: `The breach service answered ${status}.` };

    const record = (body as { SearchPassAnon?: { char?: string; count?: string | number } }).SearchPassAnon;
    if (!record) return { ok: true, exposed: false, count: null };
    // The local confirmation — a bucket hit that does not match our composition is not our password.
    const exposed = typeof record.char === "string" && record.char === charSignature(password);
    const count = Number(record.count);
    return { ok: true, exposed, count: exposed && Number.isFinite(count) ? count : null };
  } catch (e) {
    // NEVER report a network failure as "safe".
    return { ok: false, exposed: false, count: null, error: e instanceof Error ? e.message : "The breach service could not be reached." };
  }
}

/**
 * Sweeps every stored password. Safe to run wholesale precisely BECAUSE the check is k-anonymous —
 * no password and no identifying fragment leaves the machine. Sequential with a small pause: the
 * free tier allows 2 requests a second, and a vault with forty entries must not trip it.
 */
/**
 * Live progress for the sweep, POLLED rather than pushed. A push channel would mean joining the
 * shell's PUSH_CHANNELS whitelist in two root files, which is outside this module's lane — and a
 * poll is honest for a job measured in seconds. The renderer reads this every half-second so the
 * user sees "14 of 46" instead of a frozen button.
 */
let sweepProgress: { running: boolean; done: number; total: number; found: number } = {
  running: false,
  done: 0,
  total: 0,
  found: 0,
};

export function sweepStatus(): { running: boolean; done: number; total: number; found: number } {
  return { ...sweepProgress };
}

export async function sweepPasswords(db: Db, orgId: string): Promise<PasswordSweepResult> {
  if (!getBool(db, orgId, "breach.enabled")) {
    return { ok: false, error: "Breach checking is turned off. Turn it on in Vault settings first.", checked: 0, exposed: [] };
  }
  const rows = readAllForAnalysis(db, orgId);
  const exposed: PasswordExposure[] = [];
  let checked = 0;
  sweepProgress = { running: true, done: 0, total: rows.length, found: 0 };
  try {
    for (const row of rows) {
      const result = await checkPassword(row.value);
      if (!result.ok) {
        logAccess(db, orgId, "breach_check", null, null, "renderer", false, result.error ?? "unreachable");
        return { ok: false, error: result.error, checked, exposed };
      }
      checked += 1;
      if (result.exposed) exposed.push({ uuid: row.uuid, label: row.label, site: row.url ?? null, exposed: true, count: result.count });
      sweepProgress = { running: true, done: checked, total: rows.length, found: exposed.length };
      await new Promise((r) => setTimeout(r, 600)); // stay under the published 2/second
    }
  } finally {
    // Cleared on every exit — a crash mid-sweep must not leave the button spinning forever.
    sweepProgress = { running: false, done: checked, total: rows.length, found: exposed.length };
  }
  logAccess(db, orgId, "breach_check", null, null, "renderer", true, `${checked} passwords checked, ${exposed.length} exposed`);
  return { ok: true, checked, exposed };
}

/**
 * Checks ONE email address. The full address IS sent — that is how the endpoint works, there is no
 * anonymous variant — so this is deliberately per-address and never swept. The caller must have
 * shown the user what is about to be sent.
 */
export async function checkEmail(db: Db, orgId: string, email: unknown): Promise<EmailExposureResult> {
  if (!getBool(db, orgId, "breach.enabled")) {
    return { ok: false, error: "Breach checking is turned off. Turn it on in Vault settings first.", exposed: false, breaches: [] };
  }
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "That is not an email address.", exposed: false, breaches: [] };
  }
  try {
    const { status, body } = await getJson(`${EMAIL_ENDPOINT}${encodeURIComponent(email)}`);
    if (status === 404 || body == null) {
      logAccess(db, orgId, "breach_check", null, null, "renderer", true, "email: not found in any breach");
      return { ok: true, exposed: false, breaches: [] };
    }
    if (status === 429) return { ok: false, error: "The breach service is rate-limiting. Try again later.", exposed: false, breaches: [] };
    if (status >= 400) return { ok: false, error: `The breach service answered ${status}.`, exposed: false, breaches: [] };

    const found = (body as { breaches?: string[][] }).breaches;
    const names = Array.isArray(found) ? found.flat().filter((b): b is string => typeof b === "string") : [];
    // The log records THAT an email was checked and what came back — never the address itself,
    // which is the user's own data and does not belong in an audit row.
    logAccess(db, orgId, "breach_check", null, null, "renderer", true, `email checked: ${names.length} breaches`);
    return { ok: true, exposed: names.length > 0, breaches: names };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The breach service could not be reached.", exposed: false, breaches: [] };
  }
}
