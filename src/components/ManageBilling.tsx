/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Manage Billing — the PLATFORM licence surface (Jason 08-22-2026: the licence "in its own section
// ... under Access category"; offered Manage Subscriptions / Manage Billing and said "pick one" —
// Billing picked because the marketplace will sell one-time PWYW features and 7/14/30-day passes
// as well as subscriptions, and "Billing" covers all three).
//
// This is the ONE place a licence key is entered. It MOVED here from TimeTrackerSettings — the key
// was never TimeTracker's: the same `timetracker.licenseKey` row (name frozen — renaming orphans
// every existing activation) resolves the tier that governs TimeTracker's caps, the Employees cap,
// and every FEATURES gate. The MindMerge/module sections show their own entitlement STATE and send
// the user here to change it; per-module licence fields are banned (Marketplace SOP §6).
//
// The licence block below is the exact one that lived in TimeTrackerSettings (state shape, session
// cache, inline messages — no modal, no upsell), lifted, not redesigned. Classes reuse the shipped
// ttset-* rules — Vite bundles every imported module stylesheet into the one main CSS chunk, so
// they resolve here exactly as they did there.
import { useRef, useState, useEffect } from "react";
import { refreshEntitlements } from "../entitlements";
import type { TimeTrackerLicenseState } from "../shared/types";
import Tip from "./Tip";

// Session cache — repeat visits paint correct values on frame one (the Settings toggleCache pattern).
let licenseCache: TimeTrackerLicenseState | null = null;

const capText = (n: number | null): string => (n === null ? "Unlimited" : String(n));

const TIER_NAME: Record<string, string> = { free: "Free", pro: "Pro", business: "Business", root: "Root" };

export default function ManageBilling() {
  const api = window.api;
  const [lic, setLic] = useState<TimeTrackerLicenseState | null>(() => licenseCache);
  const [keyDraft, setKeyDraft] = useState("");
  const [keyMsg, setKeyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const seeded = useRef(false);

  const refreshLicense = (st: TimeTrackerLicenseState): void => {
    licenseCache = st;
    setLic(st);
    if (!seeded.current) {
      setKeyDraft(st.licenseKey ?? "");
      seeded.current = true;
    }
  };

  useEffect(() => {
    void api.timetracker.license.get().then(refreshLicense).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyKey = (): void => {
    void api.timetracker.license.setKey(keyDraft)
      // Key row written — re-resolve the renderer's entitlement snapshot NOW, so a tier change
      // (root revealing the hidden modules, most visibly) lands without a relaunch.
      .then((st) => { void refreshEntitlements(); return st; })
      .then((st) => {
        refreshLicense(st);
        const t = st.keyTiers.licenseKey;
        setKeyMsg(
          keyDraft.trim() === ""
            ? { ok: true, text: "Key cleared." }
            : t
              ? { ok: true, text: `${TIER_NAME[t] ?? t} key recognised ✓` }
              : { ok: false, text: "Saved, but not recognised as a licence key — tier unchanged." }
        );
      })
      .catch((e: unknown) => setKeyMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }));
  };

  const tierLabel = lic ? (TIER_NAME[lic.tier] ?? lic.tier) : "…";

  return (
    <div className="ttset-wrap">
      <h2>Manage Billing</h2>

      {/* ---- Licence ---- */}
      <div className="field">
        <label>Licence</label>
        <p className="hint">
          Current tier: <b>{tierLabel}</b>
          {lic && (
            <> — one key governs the whole app. TimeTracker caps: {capText(lic.caps.projects)} projects ·{" "}
              {capText(lic.caps.timers)} concurrent timers · {capText(lic.caps.soundUploads)} custom sound uploads.
              All 17 bundled alert sounds and unlimited adjustments at every tier.</>
          )}
        </p>
        <div className="ttset-keyrow">
          <input className="ttset-input" placeholder="XXXX-XXXX-XXXX-XXXX" value={keyDraft} aria-label="Licence key"
            onChange={(e) => { setKeyDraft(e.target.value); setKeyMsg(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") applyKey(); }} />
          <button className="btn" onClick={applyKey}>Apply</button>
        </div>
        {keyMsg && <p className="hint" style={{ color: keyMsg.ok ? "var(--mc-green)" : "#e0574f" }}>{keyMsg.text}</p>}
      </div>
      <Tip id="TIP-TT-005" />

      {/* What will live here next is real, so say it — but no dead controls (a control is live iff
          its action can be made real): subscriptions, pay-as-you-go passes, and per-feature
          purchases arrive with the marketplace (Marketplace-Config-As-Data-SOP). */}
      <p className="hint">
        Subscriptions, passes, and per-feature purchases will be managed here when the marketplace opens.
      </p>
    </div>
  );
}
