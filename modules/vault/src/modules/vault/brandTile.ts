/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Coloured brand tiles for the collage — the icon layer.
//
// WHY COLOUR AND INITIALS RATHER THAN THE REAL LOGO ARTWORK. Two roads were researched (08-06-2026)
// and both were rejected for reasons that outrank prettiness:
//   1. Shipping a brand-icon pack. Simple Icons is the obvious candidate and the PROJECT is CC0 —
//      but its own disclaimer says individual icons carry their own licences and the marks remain
//      the trademarks of their owners: "We ask that our users seek the correct permissions to use
//      the icons relevant to their project." Shipping forty brands to a paying customer means forty
//      permission questions, and they change over time.
//   2. Fetching favicons at runtime. This is the dangerous one, and it is dangerous in a way that
//      has nothing to do with law: a vault that resolves logos over the network TELLS SOMEBODY
//      WHICH COMPANIES THE USER HAS ACCOUNTS WITH. Whether that somebody is a favicon service or
//      the sites themselves, it is exactly the metadata a credential store exists to keep. The
//      vault makes no network calls, and this feature will not be the first.
// A brand's COLOUR is not its logo. Using it costs nothing, ships nothing, phones nowhere, works
// offline forever, and gives the collage the thing colour is actually for: recognising a tile
// without reading it. A user who wants their own artwork can attach an image later — their file,
// their choice, no exposure for us.

/** 3,301 OFFICIAL brand colours, vendored from the Simple Icons dataset (CC0) by
    seed/generate-brand-icons.mjs. Fetched once on a developer machine and shipped in the bundle —
    the application never makes that call, so no tile render ever tells anyone what is in the
    vault. This is consulted FIRST; the hand-written table below covers what it misses. */
import { GENERATED_BRAND_COLOURS } from "./brandIcons.generated";
import MANIFEST from "./brandIcons.manifest.json";

/** Longest keys first, so "google cloud" cannot be swallowed by "google". */
const GENERATED_SORTED = [...GENERATED_BRAND_COLOURS].sort((a, b) => b[0].length - a[0].length);

/** Hand-written fallbacks: brands the dataset misses, and the seed's own composite labels
    ("Google / Gmail", "X (Twitter)"). Keys are matched case-insensitively against the entry's
    label. Anything unmatched falls to a deterministic hue from the name — never grey. */
const BRAND_COLOURS: [string, string][] = [
  ["adobe", "#ED2224"],
  ["amazon", "#FF9900"],
  ["apple", "#555555"],
  ["at&t", "#009FDB"],
  ["backblaze", "#E21E29"],
  ["bank of america", "#E31837"],
  ["best buy", "#0046BE"],
  ["canon", "#CC0000"],
  ["cloudflare", "#F38020"],
  ["costco", "#E32831"],
  ["dropbox", "#0061FF"],
  ["ebay", "#E53238"],
  ["etsy", "#F45800"],
  ["facebook", "#1877F2"],
  ["fedex", "#4D148C"],
  ["github", "#24292F"],
  ["godaddy", "#1BDBDB"],
  ["google", "#4285F4"],
  ["hetzner", "#D50C2D"],
  ["honeybook", "#FA7248"],
  ["instagram", "#E4405F"],
  ["intuit", "#2CA01C"],
  ["jpmorgan", "#117ACA"],
  ["chase", "#117ACA"],
  ["keh", "#0F5C2E"],
  ["linkedin", "#0A66C2"],
  ["mailchimp", "#FFE01B"],
  ["netflix", "#E50914"],
  ["office", "#D83B01"],
  ["paypal", "#003087"],
  ["pixieset", "#2E3B4E"],
  ["ppa", "#1B365D"],
  ["quest", "#00857C"],
  ["reddit", "#FF4500"],
  ["resend", "#000000"],
  ["shootproof", "#00A6A6"],
  ["smugmug", "#6DB33F"],
  ["spotify", "#1DB954"],
  ["squarespace", "#000000"],
  ["stripe", "#635BFF"],
  ["t-mobile", "#E20074"],
  ["usps", "#004B87"],
  ["venmo", "#008CFF"],
  ["vimeo", "#1AB7EA"],
  ["wetransfer", "#409FFF"],
  ["wix", "#0C6EFC"],
  ["x (twitter)", "#000000"],
  ["youtube", "#FF0000"],
  ["zelle", "#6D1ED4"],
  ["zoom", "#0B5CFF"],
];

/**
 * THE DROP-IN SEAM for real icon artwork.
 *
 * Returns an SVG path for a brand, or null — and today it is null for everything, so every tile
 * renders colour + initials. When an icon set is approved, this is the ONE function that changes:
 * fill this map (or import a set's paths) and every tile in every view starts drawing the mark,
 * because the tile already asks here first. The path is drawn in `currentColor`, so a monochrome
 * set recolours to the brand colour above for free — which is the shape Jason asked for.
 *
 * What still has to be true before a set is dropped in, whatever its file licence says: the file's
 * licence (MIT, CC0) and the brand's TRADEMARK are separate things, and recolouring or reshaping a
 * mark does not settle the second one. Simple Icons states this itself — its project is CC0 while
 * individual icons carry their own terms, and it asks shippers to obtain the permissions their
 * project needs. So this map stays empty until that call is made; the seam costs nothing to keep.
 */
export function iconPathFor(_label: string): string | null {
  return null;
}

/**
 * THE REAL ICON, when we have one — a FILE PATH, not markup (see BrandMark for why inlining was
 * wrong). Vendored from dashboard-icons (Apache-2.0) at development time by
 * seed/generate-brand-svgs.mjs. Returns null for anything not in the set, and the tile falls back
 * to the brand colour plus initials, so a missing icon is cosmetic and never a broken tile.
 *
 * ICON_BASE is the ONE place the asset location lives. The dev host copies the assets beside its
 * own index.html; on copy-back into the shell this single constant changes and nothing else does.
 */
const ICON_BASE = "./brand-icons/";
const FILE_BY_SLUG = new Map(MANIFEST.icons.map((i) => [i.slug, i.file] as const));
/** Aliases the upstream catalogue publishes — "gmail" reaching "google-gmail" and so on. */
for (const icon of MANIFEST.icons) {
  for (const alias of icon.aliases ?? []) if (!FILE_BY_SLUG.has(alias)) FILE_BY_SLUG.set(alias, icon.file);
}

/** Vault labels are human ("Google / Gmail", "X (Twitter)"); icon slugs are not. Bridge the gap. */
const SLUG_ALIASES: [RegExp, string][] = [
  [/^google\s*\/\s*gmail/i, "gmail"],
  [/^x \(twitter\)/i, "x"],
  [/^intuit quickbooks/i, "quickbooks"],
  [/^jpmorgan chase/i, "chase"],
  [/^bank of america/i, "bank-of-america"],
  [/^american express/i, "americanexpress"],
  [/^office 365/i, "microsoft-office"],
  [/^t-?mobile/i, "t-mobile"],
  [/^at&?t/i, "att"],
  [/^best buy/i, "bestbuy"],
];

export function iconFile(label: string): string | null {
  const raw = label.trim().toLowerCase();
  for (const [pattern, slug] of SLUG_ALIASES) {
    if (pattern.test(label)) {
      const hit = FILE_BY_SLUG.get(slug);
      if (hit) return ICON_BASE + hit;
    }
  }
  // Straight slug: "Squarespace" → "squarespace"; composites are handled by the aliases above.
  const slug = raw.replace(/\s*[/(].*$/, "").trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const hit = FILE_BY_SLUG.get(slug) ?? FILE_BY_SLUG.get(slug.replace(/-/g, ""));
  return hit ? ICON_BASE + hit : null;
}

/** Deterministic hue for anything not in the table — same name, same colour, forever. */
function hashHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function brandColour(label: string): string {
  const key = label.trim().toLowerCase();
  // Hand-written first: it holds the seed's composite labels ("Google / Gmail") and deliberate
  // overrides, which must beat a generic dataset match on a substring of the same name.
  for (const [needle, colour] of BRAND_COLOURS) {
    if (key.startsWith(needle) || key.includes(needle)) return colour;
  }
  // Then the 3,301 official colours. Exact match wins outright; otherwise the longest key that
  // the label starts with — a prefix match only, so "Apple" cannot be claimed by "app".
  for (const [needle, colour] of GENERATED_SORTED) {
    if (key === needle) return colour;
  }
  for (const [needle, colour] of GENERATED_SORTED) {
    if (needle.length >= 3 && key.startsWith(needle)) return colour;
  }
  // Fixed saturation and lightness keep every generated colour in the same family as the published
  // ones, so a mixed collage still reads as one set rather than a ransom note.
  return `hsl(${hashHue(key)}, 62%, 45%)`;
}

/** One or two letters: initials for a multi-word name, the first two letters otherwise. */
export function monogram(label: string): string {
  const words = label
    .replace(/[^\p{L}\p{N}\s&]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && w.toLowerCase() !== "the" && w !== "&");
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Black or white ink, whichever actually reads on that colour (WCAG relative luminance). */
export function inkFor(background: string): string {
  let r = 0;
  let g = 0;
  let b = 0;
  if (background.startsWith("#")) {
    const hex = background.slice(1);
    const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
    r = parseInt(full.slice(0, 2), 16);
    g = parseInt(full.slice(2, 4), 16);
    b = parseInt(full.slice(4, 6), 16);
  } else {
    // hsl(...) from the fallback — its lightness is fixed at 45%, which always takes white ink.
    return "#ffffff";
  }
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  return luminance > 0.5 ? "#111111" : "#ffffff";
}
