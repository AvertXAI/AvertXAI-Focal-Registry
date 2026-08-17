# PROJECTS-10.md
**AvertXAI Umbrella Corp — Master Project Inventory**
_Last updated: August 14, 2026. Supersedes PROJECTS-9 — delete it after upload._

---

## How to maintain this file

- One row per project. Current state only — no history.
- Status options: `Active` / `Parked` / `Client` / `Idea` / `North Star`
- Priority options: `High` / `Med` / `Low`
- When a project moves status, update the row. Do not add history rows.
- Point to related files in the File Index at the bottom — do not duplicate spec content here.
- Keep "What it is" to one line. If it needs more, it belongs in a spec file.

---

## Project Inventory

_Focus August 14, 2026: **Focal Registry, sole focus** — 0.2.6 on the prerelease feed, main `3e8a2d4`; Secured Vault standalone COMPLETE, mount + first-run wizard assigned to Claude Code desktop (the new main build lane; Antigravity retired to surgical tasks). Then: vault-broken-patch fixes in order → Secured Notes copied into MindMerge → settings modal → JARVIS remote control. Prior focus note retained below._
_Focus 2026-07-19 (evening): **Focal Registry** is the active workstream — Scan module SHIPPED end-to-end and proven on a 1.29-million-file drive; Secure Note next, mockup approved. **TimeTracker reactivating** for a standalone revamp ahead of docking as a Focal Registry module. runbooks.systems remains Active as the baseplate source._

| Project | Domain | Status | What it is | Priority |
|---|---|---|---|---|
| **GetScriptClips** | avertxai.com | Parked | Android reel-to-text tool; native Kotlin/Compose; OCR+Whisper; PAUSED 2026-07-04 (Apify "buy the transcript" + desktop pivot under evaluation, not locked) | High |
| **MissionControl** | avertxai.com | Parked | Electron desktop platform/dashboard (the product); houses all modules — Client Matrix, Keystone Engine, Vault, Data Viewer; architecture LOCKED 2026-07-12 (Jarvis stack), monorepo D:\dev\AvertXAI-RunBooks.Systems\, no code yet; resume anchor = HANDOFF-MissionControl-Jarvis-2026-07-12.md | High |
| **Keystone Engine / Revenue Warden** (Auth/Entitlements/Billing/Subs) | core.avertxai.com · revenuewarden.com | Parked — built through P1 | Headless Node/Fastify/Drizzle/Postgres engine; P0 identity (26 tests) + P1 profiles/entitlements MERGED (d662dce); Azure Key Vault ES256 signer merged; paused pending Q22 issuer strings, Q23–Q27, live-vault run, firewall stack; lane = Claude Code web | High |
| **TimeTracker** | avertxai.com | **Parked — docking queued** | Electron desktop time tracker; DUAL — standalone solo app + module under Client Matrix; may relocate into the runbooks shell (TBD) | High |
| **Data Viewer** | avertxai.com | Parked | MissionControl module (shipped 46f19e3) — read-only SQLite browser; also a $30 standalone | Med |
| **Secured Vault** | avertxai.com | Built (standalone) — mounting | Focal Registry module: SQLCipher store, versioned secrets, Secured Notes (Milkdown+Markdoc), Infrastructure (DNS/SSH/packages), Repos, generator, health, access + event logs; mount assigned 2026-08-14 to Claude Code desktop; post-merge fix map = vault-broken-patch.md | High |
| **Remote Control** (JARVIS) | — | Idea | Peer-agent remote desktop — WebRTC, session codes, headless provision; attached to JARVIS; queued behind the Vault mount and the MindMerge Secured-Notes copy | Med |
| **Wiki** | — | Idea | Standalone knowledge/docs product (NOT a MissionControl module) | Low |
| **Casa Sabor / RestaurantOS** | lacasasabor.com | Parked | Restaurant ops platform; demo at demos.avertxai.com/casasabor stays deployed | High |
| **HappySmiles / DentalOS** | gethappysmiles.com | Parked | Dental practice platform; barter deal (~$40K veneer) | High |
| **runbooks.systems** | runbooks.systems | **On Hold** | Standalone Electron ops platform (NOT a MissionControl module); repo D:\dev\AvertXAI-RUNBOOKS; its Config-as-Data shell = the reusable "Mission Control shell" (Scout Viewer + Runbook Shredder mounted); 2026-07-15 shell adds grouped collapsible sidebar (committed 79da1f3) + system tray (committed) | Med |
| **Canon Distributor** | avertxai.com | Active | Electron dev utility (com.avertxai.canondistributor); syncs highest-N canon into every project's CANON/ (whitelist + prune + tray watcher); standalone Design-A UI complete. 2026-07-15: RELOCATING into the runbooks/Mission-Control shell as the `canon-distributor` module under nav_group `System` (engine+schema+IPC+UI copied) — transfer in device-gate fix cycle, NOT committed; standalone remains daily driver until the module is verified | Med |
| **Focal Registry** | focalregistry.com | **Active — sole focus** | Electron photography archive tooling (Scan · Rename · Migrate · MindMerge · Scout · Vault); repo D:\dev\AvertXAI-Focal-Registry, branch main, HEAD 3e8a2d4 pushed; **0.2.6 LIVE on the prerelease feed**; Employees built through 3B.2; Complete Job + one-money-vocabulary profit + invoices shipped; Secured Vault mounting + first-run wizard (Personal/Business, master-password change, demo seed) in the same assignment; Software Update window + REVISIONS.md pipeline shipped; Migrate Phase 1 shipped (not user-facing until Phase 2); MindMerge is read-only ingest+search, editor NOT built; alpha customer Paul Cruz (must uninstall 0.1.1 before installing 0.2.4) | **High** |
| **landing.avertxai.com** | avertxai.com | Parked | Developer-services lead capture page; form stays live; ad pixels pending | Med |
| **THATSME.DIRECT** | thatsme.direct | Parked | NFC digital business card platform; username.thatsme.direct subdomain model | Med |
| **PaperPluck** | paperpluck.com | Parked | PDF bank statement → CSV/accounting parser; ICP: bookkeepers + small accounting firms | Med |
| **BuildersAudit** | buildersaudit.com | Parked | Contractor OS; building material price comparison + project procurement | Med |
| **PASS Verified** | getpassverified.com | Parked | Course for SSI recipients navigating PESS/PASS; sequenced after Jason's own approval | Med |
| **Jax's Collectibles** | jaxscollectibles.com | Client | Ecommerce platform for Russell Felan; collectibles/memorabilia; client unresponsive | Med |
| **mindmerge.network** | mindmerge.network | Parked | $29 playbook on architecting Claude for solo founders; contingent on 90-day canon validation | Low |
| **PhantomProtocolPro** | phantomprotocolpro.com | Parked | Chrome MV3 extension; SCUM game server vote automation | Low |
| **Ctrl+X** | avertxai.com | Parked | Chrome MV3 tab session manager | Low |
| **iLedger** | iledger.avertxai.com | Parked | Windows desktop; tracks install/uninstall history via Windows registry; stays running on VPS | Low |
| **TokenSaver.app** | tokensaver.app | Parked | AI model performance monitoring dashboard | Low |
| **PhantomGate** | — | Parked | Internal lead generation dashboard; 1,870+ records | Low |
| **Proxie** | — | Idea | Radar-triggered vehicular evidence-capture hardware; Raspberry Pi 5 + OPS243-C | Low |
| **KEYSTONE / CoreXAI (biometric legacy)** | thecorexai.com | Parked | Pre-patent biometric identity (face-to-hash, non-transferable credentials); renamed Legacy Keystone | Low |
| **AVERT-X-AI Defense/AR Platform** | — | North Star | Defense/AR platform; funded by AvertXAI revenue; long-horizon goal | High |

---

## File Index

> How to read this: every file in project knowledge listed here, one line each.
> Type tells you what kind of doc it is and how to use it.
> When adding a new file to project knowledge, add a row here.

---

### Canon Files _(authoritative — override memory on conflict)_

| File | Type | Summary |
|---|---|---|
| `CANON-2.md` | Canon Index | Index of all canon files; read this first |
| `FACTS-9.md` | Canon · Facts | Business facts true regardless of decisions (EIN, legal, infra specs, licences, format traps) |
| `STATUS-34.md` | Canon · Status | Current build state of every product; one line each |
| `DECISIONS-48.md` | Canon · Decisions | All locked architectural + product decisions |
| `RULES-38.md` | Canon · Rules | How the operation runs; communication + build standards |
| `PROJECTS-8.md` | Canon · Projects | Master project inventory + the file index (this file) |
| `RESEARCH-AND-BACKLOG-CRM-1.md` | Canon · Backlog | MissionControl/platform research + parked items (P-001 usage capture) |

---

### Deep Spec Docs _(full architecture, business model, feature specs — read when building)_

| File | Type | Summary |
|---|---|---|
| `IDEAS-BUILDERSAUDIT.md` | Deep Spec | Full BuildersAudit spec — architecture, business model, scraper strategy, tier pricing, open decisions, ideas backlog |
| `IDEAS-RESTAURANTOS.md` | Deep Spec | Full RestaurantOS/Casa Sabor super-platform spec — all features, delivery, catering, video ordering, build order |
| `AVERTXAI_RD_Memorandum_KEYSTONE_2026.docx` | Deep Spec | CoreXAI Keystone R&D memorandum |
| `onboard-avertxai-spec-v3.md` | Deep Spec | AvertXAI onboarding OS spec v3 |
| `AvertXAI_Diner-Fee_Ordering_Platform__Architecture_and_Go-to-Market_Strategy.md` | Deep Spec | Diner fee / ordering platform architecture + GTM strategy |
| `SPEC-GetScriptClips-Phase1-AudioPipeline.md` | Deep Spec | GetScriptClips Phase-1 audio pipeline spec (whisper.cpp, chunking, compliance) |
| `GetScriptClips_Phase-1__On-Device_Reel_Capture_and_Whisper_Transcription_Blueprint_for_Unrooted_Android.md` | Deep Spec | Phase-1 research blueprint — on-device capture + Whisper |
| `getscriptclips-pitches.md` | Strategy | GetScriptClips pitch copy |
| `RESEARCH-AND-BACKLOG-3.md` | Canon · Backlog | Research + backlog (supersedes -1/-2 where present) |

---

### Standard Operating Procedures _(how work is done)_

| File | Type | Summary |
|---|---|---|
| `BASEPLATE-SOP-electron.md` | SOP | **Portable** procedure for building ANY new desktop app on the Mission Control Electron baseplate — stack, copy-then-gut method, full token table, geometry, Config-as-Data, boot chain, traps. Lives at `D:\dev\_source\AvertXAI-ElectronBASE\` |
| `Config-As-Data-SOP-electron.md` | SOP | Electron platform playbook for the shell — overlay funnel, boot invariant, titleBarOverlay, setResizable trap |
| `CLAUDE.md` (per repo root) | Standing orders | Per-repo agent law — reasoning protocol, source-confidence labels, shell rules, product rules |
| `GUT-LIST-focal-registry.md` | Procedure | Path-by-path gut of the copied RunBooks tree into Focal Registry |
| `RB-UPDATES-01-coolify-update-server.md` | Runbook | nginx update server on Coolify + the one-command release script |

---

### Reference Scripts _(logic sources — ported, not shipped)_

| File | Type | Summary |
|---|---|---|
| `frameshift_v16.py` | Reference | FRAMESHIFT Tkinter renamer — logic source for the Rename module; 33 extensions incl. CR2/CR3/NEF/ARW/DNG; RAW+JPEG stem grouping; preview-before-execute; NO reversal record; palette discarded |
| `photo-summary.py` | Reference | Recursive per-folder date-grouping summary — logic source for Scan; crash-safe per-folder flush PRESERVED |
| `photo-dates.py` | Reference | Single-folder EXIF date lister — earliest Scan precursor |

---

### Scoped Canon _(per-repo, generated — NOT operation canon)_

| File | Type | Summary |
|---|---|---|
| `FR-CANON-1.md` | Scoped Index | Focal Registry scoped canon index + precedence rules |
| `FR-FACTS-1.md` | Scoped Facts | Versions, sizes, licences, endpoints, platform traps for that repo |
| `FR-RULES-1.md` | Scoped Rules | How work is done in that repo |
| `FR-DECISIONS-1.md` | Scoped Decisions | Product and architecture choices for that repo |
| `FR-STATUS-1.md` | Scoped Status | Build state verified against HEAD |
| `CANON-UPDATES.md` | Ledger | Append-only canon-vs-ground-truth discrepancies, recorded never acted on. **Reconciled against this rotation 2026-07-20 — 11 entries closed** |
| `FocalRegistry-R&D-Backlog-04.md` | Backlog | Focal Registry working board — active, sequence, parked, research, dead |

---

### Brand & Design Files

| File | Type | Summary |
|---|---|---|
| `focal-registry-brand.md` | Brand | Focal Registry full brand system — typography, color tokens, UI rules |
| `lawnspluz_design.md` | Brand | Lawnspluz design reference |

---

### Session Debriefs & Handoffs _(pick up where a session left off)_

| File | Type | Summary |
|---|---|---|
| `HANDOFF-missioncontrol-2026-06-29.md` | Handoff | MissionControl platform + generator — full parked state, 4-item fix punch list, A-vs-B config-in-DB decision; resume anchor |
| `DEBRIEF-2026-009.md` | Debrief | Casa Sabor / Las Palapas — Phase 1–8 execution checklist |
| `DEBRIEF-2026-004.docx` | Debrief | Session debrief 004 |
| `DEBRIEF-2026-005.docx` | Debrief | Session debrief 005 |
| `DEBRIEF-2026-006-v2.docx` | Debrief | Session debrief 006 v2 |
| `AvertXAI-CasaSabor-Claude-Opus_4_7-5-18-26-6_49pm-1.md` | Debrief | Casa Sabor session — Opus 4.7, 2026-05-18 |
| `DEBRIEF-AMAZON-UNITWISE-2026-06-04.md` | Debrief | Amazon UnitWise Chrome extension — parked, Reddit validation first |
| `RestaurantOS_Session_Transfer.md` | Handoff | RestaurantOS session transfer doc |
| `Las_Palapas_Lighthouse_Session_Transfer.md` | Handoff | Las Palapas Lighthouse session transfer |
| `CtrlX_Session_Transfer.md` | Handoff | Ctrl+X session transfer |
| `photorename-handoff.md` | Handoff | Focal Registry (formerly PhotoRename) handoff — codebase state + brand transition |
| `HANDOFF-focal-registry-2026-07-19.md` | Handoff | Focal Registry — goals, files in flight, traps, open rulings; resume anchor |
| `REPORT-isobmff-estimate-2026-07-19.md` | Report | Scoping estimate for the ISO-BMFF parser — componentized hours, cut list, fixture requirements |
| `REPORT-isobmff-wiring-2026-07-19.md` | Report | Second engine built, wired, and verified against ffprobe — zero field disagreements |
| `REPORT-scan-ui-2026-07-19.md` | Report | Scan module UI + report writer shipped |
| `REPORT-scan-defects-2026-07-19.md` | Report | Four scan defects fixed and measured on the real 1.29M-file drive |
| `REPORT-ipc-registration-2026-07-19.md` | Report | IPC registration diagnosis (no defect — stale bundle), safeHandle resilience, media set |
| `REPORT-scan-ui-batch-2026-07-19b.md` | Report | Console palette, report Reading/Source views, folder table fixes, camera investigation |
| `REPORT-dates-and-toast-2026-07-20.md` | Report | Shared date formatter, UTC-render bug fixed, capture-source labelling, BL-25 proven, update toast |

---

### Research & Strategy

| File | Type | Summary |
|---|---|---|
| `Research_Report.md` | Research | General research report |
| `memorial-platform-debrief.md` | Research | Memorial platform exploration |
| `etsy-shop-debrief.md` | Research | Etsy shop research debrief |
| `DEBRIEF-AMAZON-UNITWISE-2026-06-04.md` | Research | UnitWise Chrome extension market research + validation plan |
| `AvertXAI-Kiva-Borrower-Narrative.md` | Strategy | Kiva borrower narrative for CDFI funding |
| `redline-motorsports-resolution-plan.md` | Strategy | Texas Comptroller / Redline Motorsports resolution plan |
| `Employment_After_a_Felony__A_Complete_Guide_to_Platforms__Programs__and_Pathways.md` | Research | Employment resource guide |

---

### Legal & Financial

| File | Type | Summary |
|---|---|---|
| `Jason_Cruz_Resume_2026.docx` | Legal/Personal | Jason's current resume |

---

### Skills _(installed Claude skills)_

| File | Type | Summary |
|---|---|---|
| `avertxai-defer-to-ide-verification-SKILL.md` | Skill | Defers IDE/build verification to Antigravity |
| `CLAUDE-FABLE-5.md` | Skill Config | Claude Fable agent config v5 |

---

### Mockups & HTML Previews

| File | Type | Summary |
|---|---|---|
| `ctrlx_hero_preview.html` | Mockup | Ctrl+X hero section preview |
| `happysmile_clinic_sky_mint.html` | Mockup | HappySmiles clinic design variant — sky/mint palette |
| `happysmiles_landing_page.html` | Mockup | HappySmiles landing page mockup |
| `mockup-B-warm-restaurant.html` | Mockup | Casa Sabor warm palette mockup B |
| `onboard-landing-mockups.html` | Mockup | AvertXAI onboarding landing page mockups |
| `MOCKUP-scan-module-3-options.html` | Mockup | Focal Registry Scan module — A empty state, B populated home, C running log (APPROVED, built) |
| `MOCKUP-secure-note-additions.html` | Mockup | Focal Registry Secure Note — three panes, draggable dividers, lazy tree, editor toolbar, one-sort dropdown, two-mode search (APPROVED 2026-07-19, not built) |

---

### Scripts & Tools

| File | Type | Summary |
|---|---|---|
| `debrief.js` | Script | Debrief generation script |
| `generate_subdomain.py` | Script | Subdomain generation utility |
| `SiteMirrorExtractor.py` | Script | Site mirror/extraction tool |
| `ImageScraper.py` | Script | Image scraper utility |
| `ImageScraperPro.py` | Script | Image scraper pro variant |


---

## Focal Registry — session artifacts, July 2026

| File | Type | What it holds |
|---|---|---|
| `REPORT-vault-preflight-recon-2026-07-22.md` | Recon | Git ground truth, auto-update code baseline, Vault crypto substrate; proved no vault branch existed |
| `REPORT-mindmerge-completeness-and-blastradius-2026-07-22.md` | Recon | Proved MindMerge has NO editor (read-only viewer) + the 385-hit runbooks/shredder blast radius, bucketed by risk |
| `REPORT-mindmerge-rename-2026-07-24.md` | Build | The runbook-shredder -> mindmerge rename, guarded migrations, full literal diff |
| `REPORT-shell-bridge-identity-07-25-2026.md` | Build | window.shell bridge rename, Focal Registry identity, branding scrub, migration removal |
| `REPORT-update-window-07-26-2026.md` | Build | Software Update window, REVISIONS.md pipeline, required/unmaintained modes, main-side details fetch |
| `REPORT-migrate-phase1-recon-07-26-2026.md` | Recon | Reuse ledger — what Scan and Rename already provide for Migrate; corrected the SHA-256 and write-surface premises |
| `REPORT-migrate-phase1-build-07-26-2026.md` | Build | copyVerified extraction + proof harness re-run, registration, schema, discovery engine, M1–M3 UI, bundle export |
| `MOCKUP-mindmerge-and-updater-07-25-2026.html` | Mockup | 6 tabs — 3 updater options, 3 MindMerge layouts (MindMerge layout NOT yet chosen) |
| `MOCKUP-release-window-07-25-2026.html` | Mockup | 4 tabs — update available, details open, required update, true-native comparison (R2 APPROVED, built) |
| `MOCKUP-migrate-module-07-25-2026.html` | Mockup | 4 tabs — new scan, results, bundle export, import and install (M1–M4 APPROVED; M1–M3 built) |
| `MOCKUP-scan-migrate-viewers-tips-07-26-2026.html` | Mockup | 7 tabs — Scan restructure, documents deep dive, revised Migrate, font viewer, script viewer, tips registry (IN REVIEW) |
| `REVISIONS.md` | Release notes | Single source for the update window and the website; lives at the Focal Registry repo root |
