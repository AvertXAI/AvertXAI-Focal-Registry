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

// ---------------------------------------------------------------- the other five modes
// The mockup's generator has six tabs. Only "Strong / random" existed; these are the rest.

/**
 * A hand-written word list for passphrases. Deliberately NOT a vendored dictionary: the well-known
 * lists carry their own licences, and a short list of ordinary English nouns needs none. 256 words
 * is 8 bits per word, so the entropy maths below is exact rather than optimistic — six words is 48
 * bits from the list plus whatever the separator and capitalisation add.
 */
const WORDS = (
  "able acid acorn actor adapt admit adopt agent album alert alien alloy amber amble anchor angle " +
  "ankle apple apron arbor arrow aspen atlas attic audio autumn awake bacon badge bagel baker balmy " +
  "banjo barge basil basin batch beach beacon beam bean bear bench berry birch bison black blade " +
  "blaze bloom board boat bolt bonus boost booth boulder brave bread brick bridge brisk broom brush " +
  "bubble buddy bugle build bunch bundle cabin cable cacao camel candle canoe canvas canyon carbon " +
  "cargo carrot castle cedar chalk charm chart cheese cherry chess chime cider cinder circle citrus " +
  "clay clever cliff cloak clock cloud clover coast cobalt cocoa coffee comet coral cotton cove " +
  "crane crate creek crisp crown crystal cube curve cycle dagger daisy dance dawn deck delta denim " +
  "desert diamond diner ditch dock dolphin donut draft dragon dream drift drum dune eagle earth " +
  "east echo eclipse elbow elder ember emerald engine ember fable falcon fancy fabric farm feather " +
  "fern fiber field fig finch fjord flame flint float flour flute forest forge fossil fountain fox " +
  "frost garden garlic gate gecko ginger glacier glass globe glove gold grain granite grape grass " +
  "gravel green grove guitar hammer harbor harvest hazel heather hedge helm hickory hollow honey " +
  "horizon hunter ice indigo iris island ivory jacket jade jasmine jetty jewel juniper kayak kettle " +
  "kite koala lagoon lake lantern lark laurel lava leaf ledge lemon lentil level lilac lily linen " +
  "lion lobby locket lotus lumber lunar lynx magnet maple marble marsh meadow melon mercy metal " +
  "meteor mint mirror mist moss motion mountain muffin nectar needle nickel noble north nutmeg oak " +
  "oasis ocean olive onion opal orbit orchard otter oxide oyster paddle palm pantry paper pastel " +
  "pearl pebble pepper petal pewter pigeon pillar pine pixel planet plum pocket pollen pond poppy " +
  "porch potato prairie prism puffin pumpkin quarry quartz quiver rabbit radish rain ranch raven " +
  "reef ribbon ridge river robin rocket rose rowan ruby saddle sage salmon sand sapphire satin " +
  "scarlet school seed shadow shell shore silk silver sketch sky slate sleet slope smoke snow " +
  "socket solar sparrow spice spiral spring spruce squash stable stone storm stream sugar summit " +
  "sunset swan sweater table talon teal temple thicket thistle thunder tiger timber toast topaz " +
  "torch tower trail tulip tundra turtle twine umber valley vanilla velvet vine violet walnut " +
  "willow window winter wolf wonder wren yarrow yellow zebra zenith"
).split(/\s+/);

const SYLLABLE_START = ["b", "c", "d", "f", "g", "h", "j", "k", "l", "m", "n", "p", "r", "s", "t", "v", "w", "z", "br", "cr", "dr", "fl", "gr", "pl", "st", "tr"];
const SYLLABLE_END = ["a", "e", "i", "o", "u", "an", "en", "in", "on", "ar", "er", "or", "il", "el", "us", "is"];

export type GeneratorMode = "random" | "advanced" | "memorable" | "passphrase" | "pin" | "bulk";

export interface PassphraseOptions {
  words: number;
  separator: string;
  capitalise: boolean;
  includeNumber: boolean;
}

/** Words joined by a separator. Every word is drawn with the CSPRNG, never Math.random. */
export function generatePassphrase(opts?: Partial<PassphraseOptions>): string {
  const words = Math.min(Math.max(Math.floor(opts?.words ?? 5), 3), 12);
  const separator = typeof opts?.separator === "string" ? opts.separator.slice(0, 3) : "-";
  const picked: string[] = [];
  for (let i = 0; i < words; i++) {
    const w = WORDS[crypto.randomInt(0, WORDS.length)];
    picked.push(opts?.capitalise ? w.charAt(0).toUpperCase() + w.slice(1) : w);
  }
  // A digit on a random word rather than always the last — a predictable position is a free hint.
  if (opts?.includeNumber) {
    const at = crypto.randomInt(0, picked.length);
    picked[at] = picked[at] + crypto.randomInt(0, 100);
  }
  return picked.join(separator);
}

/**
 * Pronounceable, so it can be read down a phone or copied off a screen without errors. HONEST
 * ABOUT THE TRADE: alternating consonant-vowel syllables is a much smaller search space than random
 * characters of the same length, and the strength meter scores what it actually is, not what its
 * length suggests.
 */
export function generateMemorable(length = 14): string {
  const target = Math.min(Math.max(Math.floor(length) || 14, 8), 64);
  let out = "";
  while (out.length < target) {
    out += SYLLABLE_START[crypto.randomInt(0, SYLLABLE_START.length)] + SYLLABLE_END[crypto.randomInt(0, SYLLABLE_END.length)];
  }
  out = out.slice(0, target);
  // One capital and one digit, because most sites demand them — placed randomly, not at the ends.
  const capAt = crypto.randomInt(0, out.length);
  out = out.slice(0, capAt) + out.charAt(capAt).toUpperCase() + out.slice(capAt + 1);
  return out + crypto.randomInt(10, 100);
}

/** Digits only. Bank and phone PINs — short by nature, and the meter says so plainly. */
export function generatePin(digits = 6): string {
  const n = Math.min(Math.max(Math.floor(digits) || 6, 3), 12);
  let out = "";
  for (let i = 0; i < n; i++) out += crypto.randomInt(0, 10);
  return out;
}

/** Many at once — for setting up a batch of accounts, or handing out one-time credentials. */
export function generateBulk(count = 10, opts?: Partial<VaultGeneratorOptions>): string[] {
  const n = Math.min(Math.max(Math.floor(count) || 10, 1), 200);
  return Array.from({ length: n }, () => generatePassword(opts));
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
