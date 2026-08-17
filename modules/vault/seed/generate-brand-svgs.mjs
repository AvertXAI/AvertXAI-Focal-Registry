// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry — Vault standalone lane
// Description: ONE-TIME DEV FETCH — vendors full-colour brand icons from homarr-labs/dashboard-icons
//              (Apache-2.0) as STATIC FILES plus a manifest, so the app ships them offline and never
//              makes a logo request at runtime.
//
//              WHY FILES AND <img>, NOT INLINED MARKUP. The first version of this script inlined SVG
//              into a generated .ts and rendered it with dangerouslySetInnerHTML. That was a real bug,
//              measured in the 79 icons it had already produced: 15 carried a <style> block, and the
//              class names and ids upstream uses are REPEATED across unrelated icons —
//                  .st0 ×8   .st1 ×6   .st2 ×4   id="a" ×15   id="b" ×9   id="Layer_1" ×7
//              Inlined into one document the last <style> wins and url(#a) gradients resolve against
//              somebody else's definition, so icons render in each other's colours. <img> gives each
//              icon its own document and the problem cannot occur. It also makes them lazy-loadable.
//
//              WHY THE `base` FIELD IS READ. 655 of the 3,074 entries are PNG-only. Requesting
//              /svg/<slug>.svg for those returns 404 — VERIFIED: venmo and porkbun both 404, and the
//              earlier curated run lost them silently. PNG-only entries are fetched as WebP instead.
//
//              PINNED TO A COMMIT, never @main: what ships must be reproducible.
//
//              Apache-2.0 covers these FILES. The marks remain the trademarks of their owners —
//              Jason's call, recorded in VAULT-CANON-UPDATES.md.
//
//              Run:  node modules/vault/seed/generate-brand-svgs.mjs           (curated ~250)
//                    node modules/vault/seed/generate-brand-svgs.mjs --all     (everything, ~25 MB)
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: modules/vault/seed/generate-brand-svgs.mjs
//------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Pinned. Bump deliberately; never track a moving branch.
const SHA = "0d6481f2a87cf611e2bf25adcf8fb07351ed2440";
const CDN = `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@${SHA}`;

// IN-LANE paths only. The assets live beside the module and are copied next to the host at build
// time; on copy-back they move with the module. Nothing is written outside modules/vault/.
const ASSET_DIR = path.join(HERE, "..", "assets", "brand-icons");
const MANIFEST = path.join(HERE, "..", "src", "modules", "vault", "brandIcons.manifest.json");

const CONCURRENCY = 12;
const ALL = process.argv.includes("--all");

/** The curated default: what a photographer's vault actually holds. --all overrides it. */
const WANTED = [
  "adobe", "amazon", "apple", "at-t", "backblaze", "bank-of-america", "bestbuy", "canon", "cloudflare",
  "costco", "dropbox", "ebay", "etsy", "facebook", "fedex", "github", "godaddy", "google", "gmail",
  "google-drive", "hetzner", "honeybook", "instagram", "intuit", "quickbooks", "chase", "linkedin",
  "mailchimp", "netflix", "microsoft-office", "paypal", "pixieset", "reddit", "resend", "smugmug",
  "spotify", "squarespace", "stripe", "t-mobile", "usps", "venmo", "vimeo", "wetransfer", "wix", "x",
  "twitter", "youtube", "zelle", "zoom", "microsoft", "outlook", "icloud", "onedrive", "proton",
  "slack", "discord", "whatsapp", "telegram", "signal", "notion", "trello", "asana", "figma", "canva",
  "calendly", "docusign", "1password", "bitwarden", "lastpass", "keepass", "nextcloud", "synology",
  "plex", "jellyfin", "steam", "playstation", "xbox", "nintendo", "twitch", "tiktok", "pinterest",
  "snapchat", "shopify", "wise", "revolut", "coinbase", "robinhood", "visa", "mastercard", "uber",
  "lyft", "airbnb", "booking", "walmart", "target", "ikea", "hulu", "disney", "audible", "aws",
  "azure", "digitalocean", "linode", "vercel", "netlify", "namecheap", "porkbun", "gitlab",
  "bitbucket", "docker", "npm", "nodejs", "wordpress", "verizon", "starlink", "ups", "dhl",
];

async function grab(url, asText) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: "*/*" } });
      if (res.status === 404) return { ok: false, reason: "404" };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { ok: true, data: asText ? await res.text() : Buffer.from(await res.arrayBuffer()) };
    } catch (e) {
      if (attempt === 2) return { ok: false, reason: e.message };
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
}

async function pool(items, worker) {
  let i = 0;
  const run = async () => {
    while (i < items.length) await worker(items[i++]);
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, run));
}

/** Strip anything executable or remote. These become files the app renders, so a <script> or a
    remote <image href> would be a live hole — and a remote reference would phone out per tile. */
function sanitise(svg) {
  return svg
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(?:xlink:)?href\s*=\s*(["'])\s*javascript:[^"']*\1/gi, "")
    .replace(/<image\b[^>]*?(?:xlink:)?href\s*=\s*["']https?:[^>]*>/gi, "")
    .trim();
}

/** Some upstream icons ship no viewBox and will not scale inside a tile. */
function ensureViewBox(svg) {
  if (/viewBox/i.test(svg)) return svg;
  const w = svg.match(/\swidth\s*=\s*["']?([\d.]+)/i)?.[1];
  const h = svg.match(/\sheight\s*=\s*["']?([\d.]+)/i)?.[1];
  return w && h ? svg.replace(/<svg\b/i, `<svg viewBox="0 0 ${w} ${h}"`) : svg;
}

console.log(`fetching dashboard-icons @ ${SHA.slice(0, 8)} — DEV-TIME ONLY; the app never makes this call…`);
const metaRes = await grab(`${CDN}/metadata.json`, true);
if (!metaRes.ok) {
  console.error(`\nFETCH FAILED: ${metaRes.reason}`);
  console.error("Nothing was written. The vault still works — every tile falls back to the brand");
  console.error("colour plus initials, which needs no network and no icon set at all.");
  process.exit(1);
}
const metadata = JSON.parse(metaRes.data);
const catalogue = Object.keys(metadata).sort();
const slugs = ALL ? catalogue : [...new Set(WANTED)].filter((s) => catalogue.includes(s));
console.log(`  ${catalogue.length} in catalogue · fetching ${slugs.length}${ALL ? " (--all)" : " (curated)"}`);

fs.rmSync(ASSET_DIR, { recursive: true, force: true }); // regenerate cleanly; these are all generated
fs.mkdirSync(ASSET_DIR, { recursive: true });

const entries = [];
const skipped = [];
let bytes = 0;
let done = 0;

/** `base` says which format actually exists upstream — png-only entries 404 on /svg/ (verified). */
async function fetchOne(slug, ownerSlug = null) {
  const rec = metadata[ownerSlug ?? slug];
  if (!rec) return null;
  const isSvg = rec.base === "svg";
  const dir = isSvg ? "svg" : "webp";
  const ext = isSvg ? "svg" : "webp";
  const res = await grab(`${CDN}/${dir}/${slug}.${ext}`, isSvg);
  if (!res.ok) {
    skipped.push({ slug, reason: res.reason });
    return null;
  }
  let payload = res.data;
  if (isSvg) {
    if (!payload.includes("<svg")) {
      skipped.push({ slug, reason: "not an svg" });
      return null;
    }
    payload = ensureViewBox(sanitise(payload));
  }
  fs.writeFileSync(path.join(ASSET_DIR, `${slug}.${ext}`), payload);
  bytes += Buffer.byteLength(payload);
  return { file: `${slug}.${ext}`, format: ext };
}

await pool(slugs, async (slug) => {
  const main = await fetchOne(slug);
  if (!main) return;
  // Theme variants — 624 entries have them. Without these a white-on-transparent mark disappears.
  const variants = {};
  for (const theme of ["light", "dark"]) {
    const vSlug = metadata[slug].colors?.[theme];
    if (!vSlug || vSlug === slug) continue;
    const v = await fetchOne(vSlug, slug);
    if (v) variants[theme] = v.file;
  }
  entries.push({
    slug,
    file: main.file,
    format: main.format,
    ...(Object.keys(variants).length ? { variants } : {}),
    ...(metadata[slug].aliases?.length ? { aliases: metadata[slug].aliases } : {}),
  });
  if (++done % 250 === 0) console.log(`  …${done}/${slugs.length}`);
});

entries.sort((a, b) => a.slug.localeCompare(b.slug));
fs.writeFileSync(
  MANIFEST,
  JSON.stringify(
    {
      _source: `https://github.com/homarr-labs/dashboard-icons/tree/${SHA}`,
      _license: "Apache-2.0 (files). Marks remain trademarks of their owners.",
      _note: "Rendered via <img> so each icon keeps its own styles — inlining collides ids and classes.",
      icons: entries,
    },
    null,
    2
  )
);

console.log(`OK wrote ${entries.length} icons to assets/brand-icons — ${(bytes / 1048576).toFixed(1)} MB`);
console.log("OK wrote brandIcons.manifest.json");
if (skipped.length) {
  console.log(`   skipped ${skipped.length}: ${skipped.slice(0, 10).map((s) => `${s.slug}(${s.reason})`).join(", ")}${skipped.length > 10 ? " …" : ""}`);
}
