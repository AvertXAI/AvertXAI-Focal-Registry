// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: RunBooks — AvertXAI platform shell (baseplate)
// Description: Strict UUIDv7 generator (RFC 9562) on Node crypto — 48-bit ms timestamp,
//              version/variant bits set, rest random. Main-process twin of the renderer's
//              `uuid` package v7; no dependency needed here.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
//------------------------------------------------------------
import crypto from "crypto";

export function generateUUIDv7(): string {
  const bytes = new Uint8Array(16);
  crypto.randomFillSync(bytes);
  const timestamp = Date.now();
  bytes[0] = (timestamp / 2 ** 40) & 0xff;
  bytes[1] = (timestamp / 2 ** 32) & 0xff;
  bytes[2] = (timestamp / 2 ** 24) & 0xff;
  bytes[3] = (timestamp / 2 ** 16) & 0xff;
  bytes[4] = (timestamp / 2 ** 8) & 0xff;
  bytes[5] = timestamp & 0xff;
  bytes[6] = (bytes[6] & 0x0f) | 0x70; // version 7 (high nibble of octet 6)
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10 (high bits of octet 8)
  return [...bytes]
    .map((b, i) => b.toString(16).padStart(2, "0") + ([3, 5, 7, 9].includes(i) ? "-" : ""))
    .join("");
}
