/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Vault label → vendor domain → brand pack artwork.
//
// THE RESOLUTION IS LOCAL AND MUST STAY LOCAL. The map arrives once, in one IPC call, and every
// lookup after that is a string operation in this file. No label is ever sent anywhere — that is
// the same reason the pack is one download rather than one request per logo (see
// electron/core/services/brandpack/index.ts).
//
// The longest-prefix walk is a deliberate copy of logos.js `resolve()` in the LogoScrape workspace.
// Those two must agree: the harvester decides what "Amazon Prime Video" is filed under, and this
// decides what it asks for. If you change one, change the other.

let VENDORS: Record<string, string> | null = null;
let VERSION = 0;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** Fetch the map once per session. Repeat callers share the same in-flight promise. */
export function loadBrandPack(): Promise<void> {
  if (VENDORS) return Promise.resolve();
  if (pending) return pending;
  pending = window.api.brandpack
    .map()
    .then((res) => {
      if (res) {
        VENDORS = res.vendors;
        VERSION = res.version;
        for (const l of listeners) l();
      }
    })
    .catch(() => {
      // No pack is a normal state, not an error — tiles fall back to colour and initials.
    });
  return pending;
}

export function onBrandPackReady(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function brandPackVersion(): number {
  return VERSION;
}

/**
 * "Amazon Prime Video" → amazonprimevideo? → amazonprime? → amazon ✓ → amazon.com
 *
 * Longest prefix first, so one curated entry ("qualtrics") covers every label built on it, and
 * "Google Cloud" can never be swallowed by "Google". A label that is already a URL or hostname
 * short-circuits to its host.
 *
 * NOTE the deliberate absence of a guess branch. logos.js falls back to "<label>.com" when nothing
 * matches, which is how "Qualtrics Survey" once resolved to qualtricssurvey.com and rendered
 * another company's logo with full confidence. Here a miss returns null and the tile shows
 * initials — a missing mark is cosmetic, a wrong one is a lie about which account this is.
 */
export function domainFor(label: string): string | null {
  if (!VENDORS) return null;
  let s = String(label ?? "").trim().toLowerCase();
  if (!s) return null;

  if (s.includes(".") || s.includes("/")) {
    const host = s
      .replace(/^[a-z]+:\/\//, "")
      .split("/")[0]
      .split("?")[0]
      .split("@")
      .pop()!
      .replace(/^www\./, "");
    if (host.includes(".")) return host;
  }

  // Longest contiguous run wins, earliest start first. Starting only at word 0 was not enough:
  // real vault labels put the brand second — "JPMorgan Chase" (the map knows "chase", not
  // "jpmorgan") and "Google / Gmail". Runs are contiguous, never arbitrary word sets, so
  // "Bank of America" can still only ever match as a whole and never as a stray "america".
  const words = s.split(/[^a-z0-9]+/).filter(Boolean);
  for (let start = 0; start < words.length; start++) {
    for (let end = words.length; end > start; end--) {
      const hit = VENDORS[words.slice(start, end).join("")];
      if (hit) return hit;
    }
  }
  return null;
}

/** Square mark for a tile. Wide wordmarks live in logoUrl and would be an illegible strip here. */
export function iconUrl(label: string): string | null {
  const d = domainFor(label);
  return d ? `brand://icon/${encodeURIComponent(d)}` : null;
}

/** Horizontal wordmark, for surfaces with real width. Never use this in a 26–44px square. */
export function logoUrl(label: string): string | null {
  const d = domainFor(label);
  return d ? `brand://logo/${encodeURIComponent(d)}` : null;
}
