// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry — Vault standalone lane
// Description: ONE-TIME DEV FETCH — pulls the Simple Icons dataset and vendors it into a generated
//              TypeScript file. Run it on a developer machine, commit the output, ship it offline
//              forever. THE APPLICATION NEVER MAKES THIS CALL: no runtime fetch, no API key, no
//              per-render request, so the vault never tells anyone which companies are in it.
//
//              WHY THIS BEATS A LOGO API. Brandfetch forbids caching and requires hotlinking under
//              its standard terms, which means (a) the "fetch once, save forever" plan needs a
//              custom agreement and (b) every tile render would phone one vendor with the name of
//              a company in the user's vault. Simple Icons is CC0 — redistribution is the entire
//              point of that licence — and it publishes each brand's OFFICIAL HEX COLOUR alongside
//              the mark, which is exactly the "colour icons" ask, for zero dollars and zero calls.
//
//              WHAT IS STILL JASON'S CALL: CC0 covers copyright, not trademark. Colours alone
//              (WITH_PATHS = false, the default) carry no trademark exposure — a colour is not a
//              mark. Turning WITH_PATHS on vendors the actual glyphs, which is the decision that
//              needs his explicit yes. The switch is one line, deliberately.
//
//              Run:  node modules/vault/seed/generate-brand-icons.mjs
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: modules/vault/seed/generate-brand-icons.mjs
//------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "src", "modules", "vault", "brandIcons.generated.ts");

/** Colours only, by default. Flip to true ONLY on Jason's explicit ruling — see the header. */
const WITH_PATHS = false;

const DATA_URL = "https://cdn.jsdelivr.net/npm/simple-icons@latest/_data/simple-icons.json";

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

console.log("fetching the Simple Icons dataset (CC0) — this is a DEV-TIME call, never made by the app…");
let raw;
try {
  raw = await getJson(DATA_URL);
} catch (e) {
  console.error(`\nFETCH FAILED: ${e.message}`);
  console.error("No network, or the CDN moved. The vault still works — brandTile.ts keeps its");
  console.error("hand-written colour table as the fallback, so nothing breaks by skipping this.");
  process.exit(1);
}

// The dataset has moved shape between majors; accept either.
const icons = Array.isArray(raw) ? raw : Array.isArray(raw.icons) ? raw.icons : [];
if (icons.length === 0) {
  console.error("The dataset parsed but held no icons — shape changed. Not writing a file.");
  process.exit(1);
}

/** Match key: lowercase title, which is what the vault has (the entry's label). */
const rows = icons
  .filter((i) => typeof i.title === "string" && typeof i.hex === "string")
  .map((i) => ({
    title: i.title,
    key: i.title.toLowerCase(),
    hex: `#${i.hex.replace(/^#/, "").toUpperCase()}`,
    slug: typeof i.slug === "string" ? i.slug : i.title.toLowerCase().replace(/[^a-z0-9]/g, ""),
  }))
  // Deterministic order so a re-run produces a byte-identical file.
  .sort((a, b) => a.key.localeCompare(b.key));

const seen = new Set();
const unique = rows.filter((r) => (seen.has(r.key) ? false : (seen.add(r.key), true)));

const body = unique.map((r) => `  ["${r.key.replace(/"/g, '\\"')}", "${r.hex}"],`).join("\n");

const file = `// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: GENERATED FILE — DO NOT EDIT BY HAND. Official brand colours from the Simple Icons
//              dataset (CC0), vendored by modules/vault/seed/generate-brand-icons.mjs so the app
//              ships them offline and NEVER fetches a logo at runtime. Re-run the generator to
//              refresh. ${unique.length} brands.
//
//              These are COLOURS, not marks: a hex value carries no trademark. The glyphs are a
//              separate, deliberate decision — see the generator's header.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: src/modules/vault/brandIcons.generated.ts
//------------------------------------------------------------

/** Lowercased brand title → official hex. Sorted, so a regeneration diffs cleanly. */
export const GENERATED_BRAND_COLOURS: ReadonlyArray<readonly [string, string]> = [
${body}
];
`;

fs.writeFileSync(OUT, file);
console.log(`OK wrote brandIcons.generated.ts — ${unique.length} official brand colours, offline forever`);
if (!WITH_PATHS) {
  console.log("   glyph paths NOT vendored (colours only) — that switch needs Jason's explicit ruling");
}
