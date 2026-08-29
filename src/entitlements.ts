/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// APP-LEVEL ENTITLEMENTS — the renderer's ONE cached reader of the `licensing:features` channel.
// This is MindMergeModule's session-cache pattern (MindMergeModule.tsx:150 `entitledCache` +
// :284-288 the one guarded fetch) lifted to app level, so App routing, the Flyout, Home, and the
// TimeTracker placements all read the SAME answer instead of each fetching their own.
//
// THREE-STATE LAW (Entitlements SOP §2): `boolean | null`. null means "still asking" — a surface
// hides only on an EXPLICIT false, so an entitled user never watches it flicker on first paint.
// A failed lookup resolves to false, never true (the MindMergeModule.tsx:288 catch, verbatim).
//
// This file is the RENDERER half of the two-layer gate — a courtesy. The refusal is main-side:
// enforceFeature(db, "employeesModule") sits in empCtx() (electron/core/services/employees/ipc.ts),
// the one context every employees:* handler funnels through, so an unentitled install is refused
// no matter what the screen shows. A hidden control is not a control; both halves are required.
import { useEffect, useState } from "react";
import type { LicenseFeature, LicenseFeatureState } from "./shared/types";

/**
 * Module rows hidden OUTRIGHT when their feature grant resolves false. Jason's ruling, 08-22-2026:
 * never-purchased is HIDDEN — "its hidden." — no teaser, no locked placeholder, no marketplace
 * link in the nav. Data, not code: a future entitlement-gated module adds a row here and every nav
 * surface fed by App's one filter picks it up; nothing else changes.
 */
export const MODULE_FEATURE: Partial<Record<string, LicenseFeature>> = {
  employees: "employeesModule",
};

type FeatureMap = Record<LicenseFeature, boolean>;

// Session cache, module-level ON PURPOSE (the entitledCache precedent): a remount or module
// re-entry does not re-ask and re-flicker. resolveTier() is unmemoised MAIN-side, so a licence
// flip is live on the next IPC call; this renderer snapshot refreshes on the next app launch,
// exactly like MindMerge's.
let features: FeatureMap | null = null; // null = still asking
// The licence tier, cached beside the features from the SAME IPC payload (it was always in there —
// the renderer simply dropped it). null = still asking, and for UI_HIDDEN_MODULES null means
// hidden: a non-root user must never see a hidden module flash during resolve; root seeing them
// appear a beat after boot is the acceptable direction.
let tier: string | null = null;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** The fail-closed answer: a lookup that cannot resolve entitles NOTHING (SOP §2, "Failed lookup
    resolves to `false`, never `true`"). */
const ALL_FALSE: FeatureMap = { mindmergeDocs: false, mindmergeBrain: false, employeesModule: false };

/** Resolve the grant set once per session; concurrent callers share the one IPC round-trip.
    NEVER rejects — safe inside any Promise.all (the boot read rides on this). */
export function entitlementsReady(): Promise<void> {
  if (features) return Promise.resolve();
  if (!inflight) {
    inflight = window.api.licensing
      .features()
      .then((st: LicenseFeatureState) => {
        features = st.features;
        tier = st.tier;
      })
      .catch(() => {
        features = ALL_FALSE;
      })
      .then(() => listeners.forEach((l) => l()));
  }
  return inflight;
}

/**
 * LIVE RE-RESOLVE — called after a licence key is saved (Jason 08-25-2026: entering the root key
 * "should work instantly appearing when the key is entered", not on next launch). Drops the session
 * cache and re-asks main, whose resolveTier() is unmemoised, so the answer reflects the row that
 * was just written. Every useEntitlements subscriber re-renders when it lands — the flyout, Home
 * grid and boot-router all read moduleHidden, so a root key makes the hidden modules appear
 * everywhere at once, no relaunch.
 */
export function refreshEntitlements(): Promise<void> {
  features = null;
  tier = null;
  inflight = null;
  return entitlementsReady();
}

/** The three-state answer right now: true / false / null while still asking. */
export function featureNow(f: LicenseFeature): boolean | null {
  return features ? features[f] : null;
}

/**
 * True only when the slug is entitlement-gated AND its grant has resolved to an EXPLICIT false —
 * an unknown slug or a still-loading grant is never hidden (three-state, no flicker). `snap`
 * defaults to the session cache; React callers pass the useEntitlements() snapshot so the compute
 * is pure against their render.
 */
/**
 * UI-HIDDEN FOR EVERYONE EXCEPT ROOT (Jason 08-24-2026, two rulings merged):
 *   1. "with scout viewer not working, lets hide it from the UI - but keep it for later"
 *   2. "i still want my root password to work, so i can give it to paul to use freely. so the
 *      things hidden, just add it to the root to use, but everybody else off."
 * So the set below is invisible on every install EXCEPT one whose licence resolves to the root
 * tier — Jason's and Paul's. Same chokepoint as before: every nav surface, the boot router and the
 * hidden-view redirect all consult moduleHidden, so root sees these everywhere at once and nobody
 * else sees them anywhere. Take a slug out of the set and it is public again.
 */
export const UI_HIDDEN_MODULES = new Set<string>(["scout-viewer"]);

export function moduleHidden(slug: string, snap: FeatureMap | null = features): boolean {
  if (UI_HIDDEN_MODULES.has(slug)) return tier !== "root";
  const key = MODULE_FEATURE[slug];
  return key !== undefined && snap !== null && snap[key] === false;
}

/** React subscription to the session cache: null until the one fetch lands, then the grant map.
    Every subscriber re-renders on resolution; none of them causes a second fetch. */
export function useEntitlements(): FeatureMap | null {
  const [snap, setSnap] = useState<FeatureMap | null>(features);
  useEffect(() => {
    const sync = (): void => setSnap(features);
    listeners.add(sync);
    sync(); // the cache may have resolved between render and effect
    void entitlementsReady();
    return () => {
      listeners.delete(sync);
    };
  }, []);
  return snap;
}

/** One feature's three-state grant — the `docsEntitled` shape (MindMergeModule.tsx:190) as a hook. */
export function useFeature(f: LicenseFeature): boolean | null {
  const snap = useEntitlements();
  return snap ? snap[f] : null;
}
