// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Keccak-512 — the ORIGINAL Keccak, not NIST SHA-3.
//
//              WHY THIS FILE EXISTS AND IS NOT A DEPENDENCY. The breach service hashes with
//              original Keccak-512, whose ONLY difference from SHA3-512 is the domain-separation
//              byte appended before padding: Keccak uses 0x01, NIST SHA-3 uses 0x06. That one byte
//              produces an entirely different digest. Node's OpenSSL ships 'sha3-512' and NOT raw
//              Keccak, so `crypto.createHash('sha3-512')` returns a prefix the service has never
//              seen — PROVEN by execution 08-06-2026: every SHA3-512 prefix answered 404, which a
//              caller would have read as "this password is safe". A breach checker that silently
//              always says safe is worse than no breach checker, so the algorithm is implemented
//              here rather than guessed at, and rather than installing a package for ~120 lines.
//
//              Correctness is not assumed: the harness checks this against the PUBLISHED Keccak-512
//              test vector for the empty string before anything trusts it.
//              Electron-free, dependency-free.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/vault/keccak.ts
//------------------------------------------------------------

const MASK = (1n << 64n) - 1n;

/** Keccak-f[1600] round constants. */
const RC: bigint[] = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

function rotl(value: bigint, shift: bigint): bigint {
  if (shift === 0n) return value & MASK;
  return ((value << shift) | (value >> (64n - shift))) & MASK;
}

/** The permutation. Operates on 25 lanes of 64 bits, in place. */
function keccakF(a: bigint[]): void {
  for (let round = 0; round < 24; round++) {
    // θ — parity of each column, folded back across the state
    const c: bigint[] = new Array(5);
    for (let x = 0; x < 5; x++) c[x] = a[x] ^ a[x + 5] ^ a[x + 10] ^ a[x + 15] ^ a[x + 20];
    for (let x = 0; x < 5; x++) {
      const d = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1n);
      for (let y = 0; y < 25; y += 5) a[x + y] ^= d;
    }
    // ρ and π — rotate each lane, then walk it to its new position
    let x = 1;
    let y = 0;
    let current = a[1];
    for (let t = 0; t < 24; t++) {
      const nx = y;
      const ny = (2 * x + 3 * y) % 5;
      const index = nx + 5 * ny;
      const held = a[index];
      a[index] = rotl(current, BigInt((((t + 1) * (t + 2)) / 2) % 64));
      current = held;
      x = nx;
      y = ny;
    }
    // χ — the only non-linear step
    for (let row = 0; row < 25; row += 5) {
      const r = [a[row], a[row + 1], a[row + 2], a[row + 3], a[row + 4]];
      for (let i = 0; i < 5; i++) a[row + i] = r[i] ^ (~r[(i + 1) % 5] & MASK & r[(i + 2) % 5]);
    }
    // ι
    a[0] ^= RC[round];
  }
}

/**
 * Keccak-512 of a UTF-8 string, as lowercase hex.
 * Rate = 1600 − 2×512 = 576 bits = 72 bytes. Padding is Keccak's ORIGINAL 0x01 … 0x80 — the byte
 * that makes this different from SHA3-512. Do not "modernise" it to 0x06.
 */
export function keccak512Hex(input: string): string {
  const RATE = 72;
  const message = Buffer.from(input, "utf8");
  const padLength = RATE - (message.length % RATE);
  const padded = Buffer.concat([message, Buffer.alloc(padLength)]);
  padded[message.length] = 0x01; // ORIGINAL Keccak domain byte — NOT 0x06
  padded[padded.length - 1] |= 0x80;

  const state: bigint[] = new Array(25).fill(0n);
  for (let offset = 0; offset < padded.length; offset += RATE) {
    for (let lane = 0; lane < RATE / 8; lane++) {
      state[lane] ^= padded.readBigUInt64LE(offset + lane * 8);
    }
    keccakF(state);
  }

  // Squeeze 512 bits — one rate block is 576 bits, so a single pass covers it.
  const out = Buffer.alloc(64);
  for (let lane = 0; lane < 8; lane++) out.writeBigUInt64LE(state[lane], lane * 8);
  return out.toString("hex");
}
