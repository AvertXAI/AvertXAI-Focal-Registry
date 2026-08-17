// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: SSH fingerprint + randomart, DERIVED from the public key on every display and never
//              stored (Jason ruled 08-10-2026): stored derived data can drift from the key it
//              describes, and a drifted randomart is a picture that lies — the one thing it must
//              never do. The algorithm is OpenSSH's drunken bishop; standard library only, so the
//              licence gate (§2.10) never fires.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/vault/sshart.ts
//------------------------------------------------------------
import crypto from "node:crypto";

export interface SshArt {
  ok: boolean;
  error?: string;
  keyType?: string;
  bits?: number;
  fingerprint?: string;
  randomart?: string;
}

const TYPE_BITS: Record<string, number> = {
  "ssh-ed25519": 256,
  "ssh-rsa": 3072, // nominal — the blob's real modulus length is not worth parsing for a caption
  "ecdsa-sha2-nistp256": 256,
  "ecdsa-sha2-nistp384": 384,
  "ecdsa-sha2-nistp521": 521,
};

/** "ssh-ed25519 AAAA… comment" → the raw key blob, or null when it is not an OpenSSH public key. */
function parsePublicKey(text: string): { type: string; blob: Buffer } | null {
  const parts = text.trim().split(/\s+/);
  if (parts.length < 2 || !parts[0].includes("-")) return null;
  try {
    const blob = Buffer.from(parts[1], "base64");
    if (blob.length < 8) return null;
    return { type: parts[0], blob };
  } catch {
    return null;
  }
}

/**
 * The drunken bishop (OpenSSH key_fingerprint_randomart). A bishop starts mid-board and walks two
 * chess-diagonal steps per digest byte (2 bits each, LSB first); each square's visit count picks a
 * character. Start and end squares are S and E. The output is byte-identical to what ssh-keygen
 * draws for the same digest, which is the entire point — the user compares OUR picture to the
 * TERMINAL's picture.
 */
function drunkenBishop(digest: Buffer, header: string, footer: string): string {
  const W = 17, H = 9;
  const board = Array.from({ length: H }, () => new Array<number>(W).fill(0));
  let x = 8, y = 4;
  for (const byte of digest) {
    let b = byte;
    for (let i = 0; i < 4; i++) {
      x += (b & 1) === 0 ? -1 : 1;
      y += (b & 2) === 0 ? -1 : 1;
      x = Math.max(0, Math.min(W - 1, x));
      y = Math.max(0, Math.min(H - 1, y));
      board[y][x] = Math.min(board[y][x] + 1, 14);
      b >>= 2;
    }
  }
  const startX = 8, startY = 4;
  const SYM = " .o+=*BOX@%&#/^"; // OpenSSH's augmentation string, verbatim
  const line = (label: string): string => {
    const pad = Math.floor((W - label.length - 2) / 2);
    return `+${"-".repeat(Math.max(0, pad))}[${label}]${"-".repeat(Math.max(0, W - label.length - 2 - pad))}+`;
  };
  const rows = board.map((row, ry) =>
    `|${row
      .map((v, rx) => {
        if (rx === startX && ry === startY) return "S";
        if (rx === x && ry === y) return "E";
        return SYM[v] ?? "#";
      })
      .join("")}|`
  );
  return [line(header), ...rows, line(footer)].join("\n");
}

/** Everything the detail pane shows without a reveal. Derived here, on demand, every time. */
export function deriveSshArt(publicKey: unknown): SshArt {
  if (typeof publicKey !== "string" || publicKey.trim() === "") {
    return { ok: false, error: "This entry has no public key stored." };
  }
  const parsed = parsePublicKey(publicKey);
  if (!parsed) return { ok: false, error: "That does not read as an OpenSSH public key." };
  const digest = crypto.createHash("sha256").update(parsed.blob).digest();
  // OpenSSH prints SHA256 fingerprints base64 without padding.
  const fingerprint = `SHA256:${digest.toString("base64").replace(/=+$/, "")}`;
  const bits = TYPE_BITS[parsed.type] ?? 0;
  const short = parsed.type.replace(/^ssh-/, "").replace(/^ecdsa-sha2-/, "ecdsa-").toUpperCase();
  return {
    ok: true,
    keyType: parsed.type,
    bits,
    fingerprint,
    randomart: drunkenBishop(digest, bits ? `${short} ${bits}` : short, "SHA256"),
  };
}
