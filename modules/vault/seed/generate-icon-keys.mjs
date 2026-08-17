// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry — Vault standalone lane
// Description: Builds the SHORT-KEY REGISTRY for icons.focalregistry.com — Jason's two-character
//              key chain (A=adobe, A1=amazon, j4=ebay, 40s=google, 5ix=fedex …).
//
//              WHAT THE SHORT KEY BUYS, stated honestly so nobody oversells it later:
//              A request for `/i/A1` instead of `/icons/amazon.svg` means the SERVER'S ACCESS LOG,
//              any proxy in between, and anyone reading traffic metadata sees opaque codes rather
//              than a readable list of the companies in someone's vault. That is a real reduction
//              in incidental leakage — logs get scraped, shipped to analytics, and read by people
//              who were never meant to see them.
//              WHAT IT DOES NOT BUY: this is not encryption. The mapping ships inside the client,
//              so anyone who wants to reverse it can. It defeats casual observation and log
//              archaeology, not a determined attacker. Both halves belong in the product copy.
//
//              Emits TWO artifacts from one source, so the client and the server cannot disagree:
//                • modules/vault/src/modules/vault/iconKeys.generated.ts  — slug → key, for FR
//                • modules/vault/seed/icon-keys.json                      — key → slug, for the API
//
//              Keys are DETERMINISTIC: derived from the slug by hash, so regenerating after adding
//              icons never renumbers the existing ones. A key that changed meaning between releases
//              would serve the wrong logo to every installed copy.
//
//              Run:  node modules/vault/seed/generate-icon-keys.mjs
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: modules/vault/seed/generate-icon-keys.mjs
//------------------------------------------------------------
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = path.join(HERE, "..", "src", "modules", "vault", "brandIcons.manifest.json");
const OUT_TS = path.join(HERE, "..", "src", "modules", "vault", "iconKeys.generated.ts");
const OUT_JSON = path.join(HERE, "icon-keys.json");

/** Base36 minus the characters a human misreads when one is quoted in a bug report. */
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/**
 * Deterministic short key. Starts at two characters and grows ONLY on collision, so the common
 * case stays as terse as Jason's examples while the tail stays unique. Same slug in, same key out,
 * on every machine and every regeneration.
 */
function keyFor(slug, taken) {
  const digest = crypto.createHash("sha256").update(slug).digest();
  for (let length = 2; length <= 6; length++) {
    // Walk the digest so a collision at length N tries genuinely different characters, not a
    // counter suffix that would cluster similar slugs into adjacent keys.
    for (let offset = 0; offset + length <= digest.length; offset++) {
      let key = "";
      for (let i = 0; i < length; i++) key += ALPHABET[digest[offset + i] % ALPHABET.length];
      if (!taken.has(key)) return key;
    }
  }
  throw new Error(`could not mint a key for ${slug}`);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
// Sorted, so the assignment order — and therefore every key — is stable across runs.
const icons = [...manifest.icons].sort((a, b) => a.slug.localeCompare(b.slug));

const taken = new Set();
const bySlug = [];
for (const icon of icons) {
  const key = keyFor(icon.slug, taken);
  taken.add(key);
  bySlug.push({ slug: icon.slug, key, file: icon.file });
}

// ---- the client half: slug → key, so FR can build the request path ----------------------------
const tsBody = bySlug.map((r) => `  ["${r.slug}", "${r.key}"],`).join("\n");
fs.writeFileSync(
  OUT_TS,
  `// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: GENERATED FILE — DO NOT EDIT BY HAND. Short keys for icons.focalregistry.com,
//              emitted by modules/vault/seed/generate-icon-keys.mjs alongside the server's own
//              icon-keys.json, so client and API can never disagree about what a key means.
//              A request reads /i/<key>, so a log or a proxy sees an opaque code instead of the
//              name of a company in someone's vault. That is OBFUSCATION, NOT ENCRYPTION — the
//              map ships in the client and is reversible by anyone who cares to.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: src/modules/vault/iconKeys.generated.ts
//------------------------------------------------------------

/** dashboard-icons slug → short key. ${bySlug.length} entries. */
export const ICON_KEYS: ReadonlyArray<readonly [string, string]> = [
${tsBody}
];
`
);

// ---- the server half: key → file, for the FastAPI ---------------------------------------------
fs.writeFileSync(
  OUT_JSON,
  JSON.stringify(
    {
      _note: "Short-key registry for icons.focalregistry.com. Serve the file at keys[<key>].",
      _generated_by: "modules/vault/seed/generate-icon-keys.mjs",
      _license: "Icon files are Apache-2.0 (homarr-labs/dashboard-icons). Marks remain trademarks of their owners.",
      keys: Object.fromEntries(bySlug.map((r) => [r.key, r.file])),
    },
    null,
    2
  )
);

const lengths = bySlug.reduce((acc, r) => ((acc[r.key.length] = (acc[r.key.length] ?? 0) + 1), acc), {});
console.log(`OK ${bySlug.length} short keys minted — lengths: ${JSON.stringify(lengths)}`);
console.log(`   client: iconKeys.generated.ts   ·   server: seed/icon-keys.json`);
console.log(`   samples: ${bySlug.slice(0, 6).map((r) => `${r.slug}=${r.key}`).join("  ")}`);
