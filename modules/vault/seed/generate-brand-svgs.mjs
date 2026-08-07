// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry — Vault standalone lane
// Description: ONE-TIME DEV FETCH — vendors FULL-COLOUR brand icons from homarr-labs/dashboard-icons
//              into a generated TypeScript file, so the app ships them offline and never makes a
//              logo request at runtime.
//
//              WHY THIS SET, out of the four that were looked at (08-06-2026):
//                • dashboard-icons — Apache-2.0. On the project's ALLOWED licence list, so no ask
//                  is needed; ~3,000 icons; ALREADY FULL COLOUR, so nothing has to be recoloured;
//                  and Apache-2.0 explicitly grants redistribution, which is the whole problem
//                  with the alternatives. THIS ONE.
//                • Simple Icons — CC0, ~3,300, but MONOCHROME; its colours are already vendored by
//                  generate-brand-icons.mjs and remain the fallback for anything without a glyph.
//                • Brandfetch — forbids caching, requires hotlinking. Every tile render would tell
//                  one vendor a company name from the user's vault. Rejected on privacy.
//                • logo.dev — its free tier is display-by-hotlink with only 100 brand retrievals.
//                  Same runtime-network objection. Rejected.
//
//              Trademark still belongs to the brands; Apache-2.0 covers the files, not the marks.
//              That remains Jason's call, and it is recorded in VAULT-CANON-UPDATES.md.
//
//              Run:  node modules/vault/seed/generate-brand-svgs.mjs
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: modules/vault/seed/generate-brand-svgs.mjs
//------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "src", "modules", "vault", "brandSvgs.generated.ts");
const META = "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@main/metadata.json";
const SVG = (name) => `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@main/svg/${name}.svg`;

/**
 * The brands worth shipping. Deliberately a curated list rather than all 3,000: a photographer's
 * vault realistically holds 300-400 companies, and every icon vendored is bundle weight for
 * everyone. Anything not here still gets its official brand COLOUR plus initials, which is why
 * missing an icon is a cosmetic gap and never a broken tile.
 */
const WANTED = [
  // the seed workbook's own companies
  "adobe", "amazon", "apple", "att", "backblaze", "bank-of-america", "bestbuy", "canon", "cloudflare",
  "costco", "dropbox", "ebay", "etsy", "facebook", "fedex", "github", "godaddy", "google", "gmail",
  "google-drive", "hetzner", "honeybook", "instagram", "intuit", "quickbooks", "chase", "keh",
  "linkedin", "mailchimp", "netflix", "microsoft-office", "office", "paypal", "pixieset", "ppa",
  "quest", "reddit", "resend", "shootproof", "smugmug", "spotify", "squarespace", "stripe",
  "t-mobile", "usps", "venmo", "vimeo", "wetransfer", "wix", "x", "twitter", "youtube", "zelle", "zoom",
  // the rest of a normal person's account list
  "microsoft", "outlook", "icloud", "onedrive", "proton", "protonmail", "slack", "discord", "whatsapp",
  "telegram", "signal", "zoom", "notion", "trello", "asana", "figma", "canva", "calendly", "docusign",
  "1password", "bitwarden", "lastpass", "keepass", "nextcloud", "synology", "plex", "jellyfin",
  "steam", "epic-games", "playstation", "xbox", "nintendo", "twitch", "tiktok", "pinterest", "snapchat",
  "shopify", "squareup", "wise", "revolut", "coinbase", "robinhood", "fidelity", "wellsfargo",
  "citibank", "capital-one", "americanexpress", "discover", "visa", "mastercard",
  "uber", "lyft", "airbnb", "booking", "expedia", "delta", "united", "marriott", "hilton",
  "walmart", "target", "homedepot", "lowes", "ikea", "wayfair", "aliexpress",
  "hulu", "disney", "hbo", "primevideo", "audible", "kindle", "goodreads",
  "aws", "azure", "digitalocean", "linode", "vercel", "netlify", "namecheap", "porkbun",
  "gitlab", "bitbucket", "docker", "npm", "python", "nodejs", "wordpress", "drupal",
  "verizon", "xfinity", "spectrum", "starlink", "cvs", "walgreens", "irs", "ups", "dhl",
];

async function getText(url) {
  const res = await fetch(url, { headers: { accept: "*/*" } });
  if (!res.ok) return null;
  return res.text();
}

console.log("fetching dashboard-icons (Apache-2.0) — DEV-TIME ONLY; the app never makes this call…");
let metadata;
try {
  const raw = await getText(META);
  metadata = JSON.parse(raw ?? "{}");
} catch (e) {
  console.error(`\nFETCH FAILED: ${e.message}`);
  console.error("Nothing was written. The vault still works — every tile falls back to the brand");
  console.error("colour plus initials, which needs no network and no icon set at all.");
  process.exit(1);
}

const available = new Set(Object.keys(metadata));
const targets = [...new Set(WANTED)].filter((n) => available.has(n)).sort();
const missing = [...new Set(WANTED)].filter((n) => !available.has(n));

const entries = [];
let bytes = 0;
for (const name of targets) {
  const svg = await getText(SVG(name));
  if (!svg || !svg.includes("<svg")) continue;
  // Keep it small and safe: strip comments, collapse whitespace, drop any script/event handlers.
  // These become inline markup, so a stray <script> or onload would be a live injection point.
  const clean = svg
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length > 40_000) continue; // a 40 KB icon is a drawing, not an icon
  bytes += clean.length;
  entries.push([name, clean]);
}

const body = entries.map(([n, s]) => `  ["${n}", ${JSON.stringify(s)}],`).join("\n");
const file = `// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: GENERATED FILE — DO NOT EDIT BY HAND. Full-colour brand icons vendored from
//              homarr-labs/dashboard-icons (Apache-2.0) by modules/vault/seed/generate-brand-svgs.mjs.
//              Shipped in the bundle: the application makes NO logo request at runtime, so no tile
//              render ever discloses what is in the vault. ${entries.length} icons, ~${Math.round(bytes / 1024)} KB.
//              Re-run the generator to refresh or to widen the curated list.
//
//              Apache-2.0 covers these FILES. The marks remain the trademarks of their owners.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: src/modules/vault/brandSvgs.generated.ts
//------------------------------------------------------------

/** dashboard-icons slug → inline SVG markup, sanitised at generation time. */
export const GENERATED_BRAND_SVGS: ReadonlyArray<readonly [string, string]> = [
${body}
];
`;
fs.writeFileSync(OUT, file);
console.log(`OK wrote brandSvgs.generated.ts — ${entries.length} full-colour icons, ~${Math.round(bytes / 1024)} KB`);
if (missing.length) console.log(`   not in the set (they keep colour + initials): ${missing.slice(0, 12).join(", ")}${missing.length > 12 ? ` +${missing.length - 12}` : ""}`);
