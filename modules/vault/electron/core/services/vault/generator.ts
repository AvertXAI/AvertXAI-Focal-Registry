// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Password generator + strength estimate. Pure functions, electron-free, no
//              dependency: randomness is node:crypto's CSPRNG (randomInt — REJECTION-SAMPLED, so
//              the alphabet is uniform; Math.random and the classic `% alphabet.length` modulo
//              bias both have no place anywhere near a credential). Generated on this machine and
//              nowhere else — nothing is sent anywhere, which is exactly what the mockup promises
//              the user. The strength estimate is a hand-rolled entropy model (recon Q4's lean):
//              zero dependencies, honest about being an estimate, and it never claims a password
//              is safe because it merely looks complicated.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/vault/generator.ts
//------------------------------------------------------------
import crypto from "node:crypto";
import type { VaultGeneratorOptions } from "./types";

const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
const SYMBOLS = "!@#$%^&*()-_=+[]{};:,.?/";
/** Characters a human misreads on paper or a screen — the mockup's "o 0 i l 1". */
const SIMILAR = new Set("oO0iIl1|`'\"");
/** Characters that break shells, CSV files and hand-typing — the mockup's "~ , ; : { } [ ]". */
const AMBIGUOUS = new Set("~,;:{}[]()/\\<>");

export const GENERATOR_DEFAULTS: VaultGeneratorOptions = {
  length: 16,
  lowercase: true,
  uppercase: true,
  numbers: true,
  symbols: true,
  excludeSimilar: false,
  excludeAmbiguous: false,
  noRepeats: false,
};

function alphabetFor(o: VaultGeneratorOptions): string {
  let chars = "";
  if (o.lowercase) chars += LOWER;
  if (o.uppercase) chars += UPPER;
  if (o.numbers) chars += DIGITS;
  if (o.symbols) chars += SYMBOLS;
  if (o.excludeSimilar) chars = [...chars].filter((c) => !SIMILAR.has(c)).join("");
  if (o.excludeAmbiguous) chars = [...chars].filter((c) => !AMBIGUOUS.has(c)).join("");
  return chars;
}

/**
 * Generates one password. Every class the user ticked is GUARANTEED to appear (a 16-character
 * "include symbols" result with no symbol in it is the kind of quiet wrongness nobody notices),
 * then the remainder is filled uniformly and the whole thing shuffled with Fisher-Yates driven by
 * the same CSPRNG — so the guaranteed characters do not sit in predictable positions.
 */
export function generatePassword(opts?: Partial<VaultGeneratorOptions>): string {
  const o: VaultGeneratorOptions = { ...GENERATOR_DEFAULTS, ...opts };
  const length = Math.min(Math.max(Math.floor(o.length) || 16, 4), 128);
  const pools: string[] = [];
  if (o.lowercase) pools.push(LOWER);
  if (o.uppercase) pools.push(UPPER);
  if (o.numbers) pools.push(DIGITS);
  if (o.symbols) pools.push(SYMBOLS);
  if (pools.length === 0) throw new Error("Pick at least one kind of character.");

  const filter = (s: string): string =>
    [...s].filter((c) => (!o.excludeSimilar || !SIMILAR.has(c)) && (!o.excludeAmbiguous || !AMBIGUOUS.has(c))).join("");
  const usable = pools.map(filter).filter((p) => p.length > 0);
  const all = alphabetFor(o);
  if (usable.length === 0 || all.length === 0) throw new Error("Those exclusions leave no characters to choose from.");
  // no-repeats cannot be honoured past the alphabet size — say so instead of looping forever.
  if (o.noRepeats && length > all.length) {
    throw new Error(`No-repeats needs at least ${length} different characters; these options give ${all.length}.`);
  }

  const out: string[] = [];
  const used = new Set<string>();
  const pick = (pool: string): string => {
    for (let attempt = 0; attempt < 500; attempt++) {
      const c = pool[crypto.randomInt(0, pool.length)];
      if (!o.noRepeats || !used.has(c)) {
        used.add(c);
        return c;
      }
    }
    throw new Error("Could not build a password with these options.");
  };
  for (const pool of usable) if (out.length < length) out.push(pick(pool));
  while (out.length < length) out.push(pick(all));
  // Fisher-Yates over a CSPRNG — the guaranteed characters must not be positionally predictable.
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join("");
}

export interface StrengthVerdict {
  /** Estimated bits of entropy — the honest number the rest is derived from. */
  bits: number;
  /** 0-4, the mockup's five-segment meter. */
  level: 0 | 1 | 2 | 3 | 4;
  label: "Very weak" | "Weak" | "Fair" | "Strong" | "Very strong";
  /** Plain-language time to crack, at an offline-attack rate. Always a rough guide, never a promise. */
  crackTime: string;
}

/** Characters that appear in a value tell you which pools an attacker must cover. */
function observedAlphabet(value: string): number {
  let n = 0;
  if (/[a-z]/.test(value)) n += 26;
  if (/[A-Z]/.test(value)) n += 26;
  if (/[0-9]/.test(value)) n += 10;
  if (/[^a-zA-Z0-9]/.test(value)) n += 24;
  return n || 1;
}

/**
 * A deliberately conservative estimate. Raw length × alphabet OVERSTATES a human password badly
 * ("doggy123" scores 47 bits by that maths and is guessed in seconds), so three penalties model
 * what actually breaks: dictionary-ish lowercase runs, a trailing year, and repetition. This is an
 * ESTIMATE and the surface says so — it exists to sort a photographer's passwords worst-first, not
 * to certify anything.
 */
export function estimateStrength(value: string): StrengthVerdict {
  if (!value) return { bits: 0, level: 0, label: "Very weak", crackTime: "instantly" };
  let bits = value.length * Math.log2(observedAlphabet(value));

  // A trailing year or short digit run is the single most predictable human habit — 2026, 123, 1968.
  if (/(19|20)\d{2}[!@#$%^&*]?$/.test(value)) bits -= 12;
  else if (/\d{1,4}[!@#$%^&*]?$/.test(value)) bits -= 8;
  // A long pure-lowercase run is a word or a name, not 26^n of search space.
  const lowerRun = value.match(/[a-z]{4,}/g);
  if (lowerRun) for (const run of lowerRun) bits -= Math.min(run.length * 1.9, 22);
  // Repeated blocks ("calebcalebcaleb") multiply length without multiplying difficulty.
  for (const block of [3, 4, 5, 6]) {
    const re = new RegExp(`(.{${block},})\\1+`);
    if (re.test(value)) {
      bits -= 10;
      break;
    }
  }
  // A leading capital followed by lowercase is the shift-key habit, not a second alphabet.
  if (/^[A-Z][a-z]+/.test(value) && !/[A-Z]/.test(value.slice(1))) bits -= 4;
  bits = Math.max(0, Math.round(bits));

  const level: StrengthVerdict["level"] = bits < 28 ? 0 : bits < 40 ? 1 : bits < 56 ? 2 : bits < 76 ? 3 : 4;
  const label = (["Very weak", "Weak", "Fair", "Strong", "Very strong"] as const)[level];
  return { bits, level, label, crackTime: crackTimeFor(bits) };
}

/** 10 billion guesses/second — a commodity offline cracking rig, not an online login form. */
function crackTimeFor(bits: number): string {
  const seconds = Math.pow(2, bits) / 2 / 1e10;
  if (seconds < 1) return "instantly";
  if (seconds < 60) return `${Math.round(seconds)} seconds`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} minutes`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} hours`;
  if (seconds < 31_536_000) return `${Math.round(seconds / 86_400)} days`;
  const years = seconds / 31_536_000;
  if (years < 1000) return `${Math.round(years)} years`;
  if (years < 1e6) return `${Math.round(years / 1000)} thousand years`;
  if (years < 1e9) return `${Math.round(years / 1e6)} million years`;
  return "billions of years";
}
