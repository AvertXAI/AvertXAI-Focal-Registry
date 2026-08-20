// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: The two password helpers both setup wizards need. They live here rather than in
//              either wizard because there must be exactly ONE generator in this application: a
//              second copy is a second chance to reach for Math.random, and the copy that gets it
//              wrong is the one nobody re-reads.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: src/components/setupPassword.ts
//------------------------------------------------------------

/** No I, l, 1, O or 0 — the user is expected to write this on paper and type it back. */
const GEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/**
 * A generated master password: 16 characters, `crypto.getRandomValues`, never `Math.random`.
 *
 * The rejection loop is not decoration. The alphabet is 57 characters and a byte holds 256 values,
 * so a bare `% 57` would hand out the first 28 characters slightly more often than the rest — a
 * small bias, but a free one to remove: 57 x 4 = 228, so bytes at 228 and above are drawn again.
 */
export function generatePassword(): string {
  const n = GEN_ALPHABET.length;
  const limit = Math.floor(256 / n) * n;
  let out = "";
  const buf = new Uint8Array(1);
  while (out.length < 16) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) out += GEN_ALPHABET[buf[0] % n];
  }
  return out;
}

/** Advisory only, 0 to 4. The gate to continue is twelve characters and a match — never the score. */
export function strengthScore(v: string): number {
  let s = 0;
  if (v.length >= 12) s++;
  if (v.length >= 16) s++;
  if (/[a-z]/.test(v) && /[A-Z]/.test(v)) s++;
  if (/[0-9]/.test(v)) s++;
  return s;
}

/** Meter label for a score. Empty input gets a space so the row keeps its height. */
export function strengthLabel(v: string, score: number): string {
  if (v.length === 0) return " ";
  return score >= 4 ? "Strong" : score >= 3 ? "Good" : score >= 2 ? "Weak" : "Too short";
}
