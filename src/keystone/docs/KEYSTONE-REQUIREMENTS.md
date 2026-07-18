# KEYSTONE-REQUIREMENTS.md

**Purpose:** Auth / entitlement / billing requirements for CoreXAI Keystone, captured BEFORE the build so they're locked when the engine is scaffolded. Keystone is DECIDED but NOT BUILT (per STATUS). This file is the requirements source; architecture/schema live in the Keystone spec (DECISIONS Keystone section + corexai-engine-architect skill).

**Status:** requirements draft — settled 2026-06-27. Supersede with a numbered bump when changed.

---

## 1. Identity & login UX

- **Free tier requires NO account.** The free TimeTracker runs anonymous and local-only. Login NEVER gates the free tracker, and NEVER gates onboarding.
- **Login appears ONLY at purchase / unlock.** A user creates an account + logs in the first time they buy or unlock a paid module — not before.
- Matches the GetScriptClips principle already in canon: the account/payment wall appears only at the point of purchase, never at first use.

## 2. Entitlement model

- **Entitlements = data, not code.** Capability keys per user/tenant (binary + metered), server-side. The app ships ALL module code to everyone; entitlements decide what each user can open.
- **Free-tier-as-default.** A new user defaults to the free `tracker` entitlement. It persists server-side and STICKS until an upgrade flips it — no special handling, it falls out of the entitlements-as-data model.
- **Ship-locked, unlock-on-flip.** New paid modules ship inside the normal app update to everyone, rendered LOCKED ("upgrade to unlock") until the user's entitlement flips on. Payment flips access, not delivery.
- **Server-gated, never a local flag.** A local toggle could be edited to unlock for free; the gate must be a server entitlement check.

## 3. Session & offline model

- **Optional on-launch gate.** The app verifies entitlement on launch. The user MAY disable the local lock (per session / after PC restart), but a silent re-verify still runs in the background.
- **Short JWT + offline grace.** Short-lived access token plus an OFFLINE GRACE window before the app MUST phone home to re-verify. Window = ~2–7 days, exact TBD (Adobe/Photoshop reference = gate-on-launch + ~2-day token; earlier instinct = 7 days). Pick the window at build time.
- **Forced re-verify after grace.** Once grace expires with no successful check, paid modules re-lock to the free tier until the next successful verify.
- Canon auth already specifies: RS256/ES256 JWT, short TTL + refresh rotation + revocation list. The grace window is the refresh/offline dimension of that.

## 4. Billing

- **Stripe = money source of truth.** User pays via Stripe → Stripe webhook → Keystone updates the entitlement → the app's next `/entitlements/check` unlocks the module.
- **Billing ledger = append-only rows.** The engine owns entitlements; Stripe owns money.

## 5. Optional local device-lock (separate concern)

- A thin LOCAL security layer, distinct from server identity: lock the app on THIS PC after a restart (the user's "login for security, or off after restart" idea).
- Sits ON TOP of the Keystone session; not part of identity/entitlement. Later phase, optional.

## 6. Three-attacker model (why server-side)

- **Cloner** (copies the install to another machine) — stopped by server-side entitlement absence on the new device.
- **Freeloader** (tries to use paid features offline forever) — stopped by the short token + offline-grace forced re-verify.
- **Trial-abuser** (resets to re-trial) — stopped by server-side trial/entitlement state, not a local flag.

## 7. Open questions (decide at build)

- Exact offline-grace window (2 vs 7 days, or per-tier).
- Whether the FREE tier phones home at all, or stays fully offline/anonymous (leaning: free stays offline; only paid entitlements require check-in).
- Device-binding model for paid licenses (ref: existing license/activation schema — license_key + device_fingerprint + max_activations, DEBRIEF-2026-004).
- Whether on-launch gate defaults ON or OFF for paid users.

## 8. Sequencing note

- None of this blocks shipping the merged CRM + TimeTracker app or pushing FREE auto-updates via electron-updater. Until Keystone exists, every shipped module is simply ON for everyone (free) — fine, since TimeTracker is the free wedge. The locked-until-paid behavior switches on when Keystone lands. Keystone is already next in the build order.
