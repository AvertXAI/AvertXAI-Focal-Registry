// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Vault label -> brand domain. Pure text resolution, no network, no artwork.
//              Vault labels are human and carry qualifiers: "Chase Bank", "Amazon Prime Video",
//              "Wells Fargo Mobile", "Qualtrics Survey". Gluing the words together produces
//              chasebank.com and amazonprimevideo.com — squatter territory, and the wrong brand.
//              So the label is walked LONGEST PREFIX FIRST against the curated map, which means
//              one map entry ("qualtrics") covers every label built on it and the alias table in
//              brandTile no longer needs a hand-written regex per composite name.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/vault/vendorMap.ts
//------------------------------------------------------------
import { VENDOR_DOMAINS } from "./vendors.generated";

export type VendorVia = "host" | "map" | "guess";

export interface VendorMatch {
  /** Registrable domain that identifies the brand, or null when the label yields nothing. */
  domain: string | null;
  /**
   * How it was reached. `host` came from a URL the user typed, `map` is curated and trustworthy,
   * `guess` is <label>.com and MAY BE THE WRONG COMPANY — never treat a guess as confirmed.
   */
  via: VendorVia | null;
}

const EMPTY: VendorMatch = { domain: null, via: null };

/** "Chase Bank" -> chase.com · "https://x.chase.com/a" -> x.chase.com · "Nowhere Co" -> guess */
export function resolveVendor(raw: unknown): VendorMatch {
  let s = String(raw ?? "").trim().toLowerCase();
  if (s === "") return EMPTY;

  // A URL identifies the brand outright — no need to guess at words.
  if (s.includes(".") || s.includes("/")) {
    s = s.replace(/^[a-z]+:\/\//, "").split("/")[0].split("?")[0].split("@").pop() ?? "";
    s = s.replace(/^www\./, "");
    if (s.includes(".")) return { domain: s, via: "host" };
  }

  const words = s.split(/[^a-z0-9]+/).filter(Boolean);
  for (let n = words.length; n > 0; n--) {
    const hit = VENDOR_DOMAINS[words.slice(0, n).join("")];
    if (hit) return { domain: hit, via: "map" };
  }
  return words.length ? { domain: `${words.join("")}.com`, via: "guess" } : EMPTY;
}

/** Domain only, for callers that do not care how it was reached. */
export function vendorDomain(raw: unknown): string | null {
  return resolveVendor(raw).domain;
}
