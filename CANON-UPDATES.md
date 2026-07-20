# CANON-UPDATES.md — canon-vs-ground-truth ledger (append only)

Protocol: CLAUDE.md §2.12. Entries record discrepancies; nothing here authorizes acting on them.
Canon governs until Jason rules. Never edit or reorder existing entries — append only.

---

## [CONTRADICTS] 2026-07-19 — dev/prod userData isolation mandated, not implemented in this repo
**Canon says:** "Dev/prod data isolation (Electron, ALL apps): dev builds (`!app.isPackaged`) MUST resolve `userData` to a separate dev directory (e.g. `{userData}-dev`) … packaged app and dev env never share a userData path or single-instance lock." (RULES-35.md §IDE/build)
**Reality:** Focal Registry dev builds resolve `userData` unconditionally — dev (`electron .`) and the installed app both land in `%APPDATA%\AvertXAI Focal Registry` and share one org database and single-instance lock.
**Evidence:** `electron/main.ts` — every path uses `app.getPath("userData")` with no `app.isPackaged` branch (initRegistry/initDb call sites); observed on-device 2026-07-18: dev launches booted against the org the packaged 0.1.1 install created (org `019f7761-…`). STATUS-31 records the same gap for the RunBooks shell ("Dev/prod userData isolation still NOT implemented in this shell — root-lane task"); the Focal Registry entry omits it.
**Suggestion:** add the isolation gap to STATUS-31's Focal Registry entry as an outstanding root-lane task; schedule the `{userData}-dev` split (canon notes the shared path root-caused a live-registry wipe 2026-07-03).
**Severity:** worth-fixing

## [CONTRADICTS] 2026-07-19 — PROJECT-STATUS.md mandated per multi-phase build, absent here
**Canon says:** "Every multi-phase build ships a PROJECT-STATUS.md the agent keeps current" (RULES-35.md §IDE/build)
**Reality:** NOT FOUND at the Focal Registry repo root; the build is many phases in (baseline `b4b6470` → HEAD `cb5eb9c`, 17 commits).
**Evidence:** `ls` of repo root 2026-07-19 — no PROJECT-STATUS.md; `git log --oneline b4b6470..cb5eb9c`.
**Suggestion:** either create and maintain one for this repo, or record in RULES that per-session reports at `D:\dev\_source\<repo>\reports\` supersede it.
**Severity:** worth-fixing

## [STALE] 2026-07-19 — "ffprobe sanctioned" superseded by the GPLv3 rejection
**Canon says:** "**`ffprobe` (single static binary, JSON output) sanctioned** for video/audio container metadata — a capability Node genuinely lacks, NOT a second runtime." (DECISIONS-45.md §Focal Registry)
**Reality:** ffprobe is REJECTED as of 2026-07-19 — the FFmpeg binary is GPLv3 and ships inside the installer, creating distribution obligations the product will not take on. Replacement direction: `music-metadata` (MIT) + write-the-parser for gaps. `@ffprobe-installer/ffprobe` is still in dependencies pending the sanctioned removal phase.
**Evidence:** repo CLAUDE.md §4.2 ("`ffprobe` is REJECTED … installed once in error and removed. Do not reintroduce it."); `package.json` dependencies (`@ffprobe-installer/ffprobe ^2.1.2` at commit `b864282`); licence evaluation report 2026-07-19 (binary GPLv3, wrapper LGPL-2.1).
**Suggestion:** replace the DECISIONS-45 line with the CLAUDE.md §4.2 extraction-stack wording (exifr + music-metadata, ffprobe rejected, write-the-parser directive).
**Severity:** blocking (an agent reading canon alone would reintroduce a GPLv3 binary)

## [STALE] 2026-07-19 — per-module database files superseded by the shared Scan/Rename database
**Canon says:** "Data isolation: every module gets its OWN database file (Scan, Rename, Shredder each separate). Cross-file joins via SQLite `ATTACH DATABASE`." and "Results → its own DB" (DECISIONS-45.md §Focal Registry)
**Reality:** Scan and Rename share the org database `focalregistry_{org_id}.db` per SPEC-focal-registry-scan-v3.md §2 ("DECIDED 2026-07-18 — supersedes per-module isolation for these two … Rename does a SELECT"). Built accordingly; Shredder/Secure Note keeps its own file per the same spec.
**Evidence:** SPEC-focal-registry-scan-v3.md §2; `electron/core/services/scan/db.ts` (schema on the shared `getDb()` connection); `electron/core/services/db/migrate.ts` + `firstrun/index.ts:36` (`focalregistry_{org_id}.db`).
**Suggestion:** update DECISIONS-45 to the spec's storage decision (shared file for Scan+Rename; Secure Note separate pending Vault fold-in).
**Severity:** worth-fixing

## [STALE] 2026-07-19 — Settings "UNKNOWN" and tray "Sync Now remnant" both resolved
**Canon says:** "Settings structure: UNKNOWN — pending fresh recon" and "the inherited Sync Now item + separator are a REMNANT still present (4 entries, not 2)" (DECISIONS-45.md §Focal Registry)
**Reality:** Settings was recon'd on-device and rebuilt to the target state (Members-and-roles removed, Modules shows only Vault, Coming-surfaces replaced with Vault cards, orange copy rewritten); the tray is exactly Open/Exit — Sync Now and the separator were removed with the Canon Distributor.
**Evidence:** commits `cec4c0d` (Settings cleanup) and `08683a9` (Distributor removal incl. tray items); `src/views/Settings.tsx`; `electron/main.ts` tray menu (two items).
**Suggestion:** replace both lines with current state.
**Severity:** worth-fixing

## [STALE] 2026-07-19 — STATUS-31 Focal Registry entry ~15 commits behind
**Canon says:** "NEXT = the gut (GUT-LIST-focal-registry.md §2 onward)" with the remnants list (branding strings, runbooks slug, provenance headers) still open (STATUS-31.md §Focal Registry)
**Reality:** the gut, user-visible branding, updater (0.1.1 live end-to-end), org-DB slug migration, and the Scan foundation + metadata phases are all complete at HEAD `cb5eb9c`.
**Evidence:** `git log --oneline b4b6470..cb5eb9c` — 5696c4d/f3c9f7d/e3f3a6b (updater+identity), 9fdb8a7/08683a9/9f782ed/cec4c0d/46481a8 (gut), 0c621a8 (slug migration), 2b8ba0b→cb5eb9c (Scan). Session reports in `reports/`.
**Suggestion:** roll STATUS-31 → STATUS-32 with the current Focal Registry state; drop the resolved remnant bullets (window.runbooks bridge remains the one open remnant).
**Severity:** worth-fixing

## [STALE] 2026-07-19 — PROJECTS-5 File Index cites superseded versions
**Canon says:** File Index lists `STATUS-30.md` and reference script `frameshift_v10.py` (PROJECTS-5.md §File Index)
**Reality:** STATUS-31 is current (per its own header) and DECISIONS-45/STATUS-31 both record `frameshift_v16.py` as the current reference ("v10 was an older upload").
**Evidence:** STATUS-31.md header ("Supersedes STATUS-30"); DECISIONS-45 §Focal Registry; STATUS-31 §DEAD (FRAMESHIFT note).
**Suggestion:** refresh the two index rows on the next PROJECTS rotation.
**Severity:** cosmetic

## [STALE] 2026-07-19 — module display name is now "Secure Note", canon still says Runbook Shredder
**Canon says:** module named "Runbook Shredder" throughout (DECISIONS-45.md §Focal Registry, STATUS-31.md)
**Reality:** product renamed to display name **Secure Note** (SPEC-focal-registry-scan-v3.md §2 "Secure Note (formerly Shredder)"); implemented as display strings + seed/back-fill only — slug `runbook-shredder`, folders, tables, settings keys unchanged by design (separately gated task).
**Evidence:** SPEC v3 §2; commit `97352c6`; `electron/core/services/db/index.ts` back-fill UPDATE; `electron/core/services/firstrun/index.ts` seed row.
**Suggestion:** record the display rename + the pending slug-rename task in DECISIONS.
**Severity:** cosmetic

## [GAP] 2026-07-19 — no FACTS-N file exists in local canon
**Canon says:** "The canon is these four files … FACTS-N.md | Verified facts — prices, specs, legal rules, costs, identifiers" (CANON-1.md); PROJECTS-5 File Index lists `FACTS-6.md`.
**Reality:** no FACTS-N file exists at `D:\dev\_source\AvertXAI-CANON\CANON PROJECT\` and none was distributed to this repo's `CANON/`. Agents working here cannot verify any facts-class claim locally.
**Evidence:** directory listings 2026-07-19 of both locations (CANON-1, DECISIONS-45, PROJECTS-5, RULES-35, STATUS-31 only).
**Suggestion:** place FACTS-6 (or current) into the local canon folder so the Distributor ships it, or note in CANON-1 that FACTS lives only in the Claude project.
**Severity:** worth-fixing

## [CONTRADICTS] 2026-07-19 — autoDownload: scoped canon TRUE, CLAUDE.md consent-first, code implements consent-first
**Canon says:** "**`autoDownload` defaults TRUE in this product only.** Paul never thinks about updating." (FR-DECISIONS-1.md §Auto-update)
**Reality:** repo CLAUDE.md §3.12 mandates "Download only on user consent … Never pull a large download silently," and the shipped 0.1.1 code sets `autoUpdater.autoDownload = false` (`electron/core/updater.ts`).
**Evidence:** FR-DECISIONS-1.md §Auto-update; CLAUDE.md §3.12; `electron/core/updater.ts` (`autoUpdater.autoDownload = false`).
**Suggestion:** Jason picks one; if TRUE wins, updater.ts and CLAUDE.md §3.12 both change in a gated task.
**Severity:** worth-fixing

## [CONTRADICTS] 2026-07-19 — empty System nav header: scoped canon vs CLAUDE.md
**Canon says:** "System section renders only when a row exists in it. An empty header would mean hardcoding a nav entry — banned. Not a defect." (FR-DECISIONS-1.md §Navigation)
**Reality:** CLAUDE.md §3.6 still reads "System — section header retained, currently empty," which cannot render without violating §3.5's no-hardcoded-nav rule.
**Evidence:** FR-DECISIONS-1.md §Navigation; CLAUDE.md §3.6 vs §3.5; `src/components/Flyout.tsx` (data-driven groups).
**Suggestion:** align CLAUDE.md §3.6 to the scoped wording.
**Severity:** cosmetic

## [STALE] 2026-07-19 — CLAUDE.md Part 0 still routes bootstrap through PROJECT-CANON.md
**Canon says:** (repo law) "Read `PROJECT-CANON.md` at this repo root" first, every session (CLAUDE.md §0.1).
**Reality:** the scoped `CANON/FR-*` set supersedes `PROJECT-CANON.md` (per FR-CANON-1.md and the 2026-07-19 swap prompt Phase 0); the superseded file still sits at the repo root.
**Evidence:** FR-CANON-1.md; swap-prompt Phase 0; `PROJECT-CANON.md` present at root.
**Suggestion:** update CLAUDE.md §0.1 to point at `CANON/FR-CANON-1.md`; decide whether PROJECT-CANON.md is deleted or kept as an archived artifact.
**Severity:** worth-fixing

## [GAP] 2026-07-19 — bitrate and dimensions for MP4/MOV are not deliverable by music-metadata
**Canon says:** "Video metadata captured: video codec · audio codec · description · metadata date · bitrate · duration." (FR-DECISIONS-1.md §Scan; the swap contract adds width · height)
**Reality:** empirically proven on synthetic ISO-BMFF fixtures: music-metadata delivers video codec (via stsd fourcc), audio codec, duration, and creation date for MP4 AND QuickTime-branded MOV — but **bitrate, width, and height populate 0/85** for both (WAV delivers all its fields incl. bitrate 85/85). The library models every ISO-BMFF track as audio and never surfaces tkhd/stsd dimensions or esds bitrates.
**Evidence:** probe dump + crash-test coverage tables, sessions report REPORT-music-metadata-swap-2026-07-19.md (mp4/mov presence: videoCodec 85, audioCodec 85, duration 85, metadataDate 85, bitrate 0, width 0, height 0).
**Suggestion:** per the write-the-parser directive, a SUPPLEMENTAL ISO-BMFF box walker (tkhd/stsd for dimensions, esds/btrt or mdat-size÷duration for bitrate) — roughly 150–250 lines on top of music-metadata, smaller than the full 300–500-line replacement — as its own gated prompt.
**Severity:** worth-fixing (blocks full §Scan field coverage for video)

## [GAP] 2026-07-19 — repo-level law and patterns canon has not absorbed
**Canon says:** nothing on: the per-repo PROJECT-CANON bootstrap protocol, the dependency licence gate (allowed-list + stop-and-ask), the 20-megabyte size gate, the CANON-UPDATES ledger protocol, the org-DB slug boot-migration pattern (copy → verify → registry flip → keep `.migrated`, rollback to nothing-happened), or the Scan crash-test harness pattern (kill mid-run / prove resume equals clean run).
**Reality:** all six are operating law or proven pattern in this repo.
**Evidence:** repo CLAUDE.md Part 0, §2.10–2.12; `electron/core/services/db/migrate.ts` (+ proof run 2026-07-19); `electron/core/services/scan/crash-test.ts` (+ proof runs 2026-07-18/19).
**Suggestion:** promote the licence gate, size gate, and bootstrap protocol to RULES (they are operation-wide, not repo-specific); record the migration and crash-proof patterns as standing engineering patterns.
**Severity:** worth-fixing

## [STALE] 2026-07-19 — the ISO-BMFF bitrate/dimensions GAP entry above is RESOLVED
**Canon says:** (this ledger, earlier today) bitrate, width, and height are not deliverable for MP4/MOV — box walker suggested.
**Reality:** the walker shipped: `isobmff.ts` (parser, commit `5b64441`) + `isobmff-reader.ts` (positioned moov reader) wired as a second engine after music-metadata on branch `feature/isobmff-geometry` (`4cc64c7`…`e94166d`). Verified against a system ffprobe as a local instrument on real encoder fixtures: encoded dims exact, rotation 270=270, duration to the millisecond; synthetic crash-test now 85/85 on all twelve media fields; negatives return NULL without throwing. Real CANON-BODY .MOV proof still pending Jason's fixture files.
**Evidence:** REPORT-isobmff-wiring-2026-07-19.md (verifier table + fixtures-mode + crash-sequence outputs).
**Suggestion:** fold into the next FR-STATUS rotation; the open remainder is Canon-body fixtures + the merge-priority question (music-metadata's MP4 `bitrate` is the audio stream's and currently beats the container value under merge-never-overwrite).
**Severity:** cosmetic (bookkeeping — the gap itself is closed)

## [GAP] 2026-07-19 — mockup shows affordances that are shell-lane or need their own mockup
**Canon says:** SPEC-focal-registry-scan-v3 §11 step 8 + MOCKUP-scan-module-3-options.html show Option C's "Minimize to dot" and a double-scan-guard "Scan a subfolder only" / Option B "+ Add source" (folder-unit) path.
**Reality:** the Scan UI shipped this pass covers whole-drive scanning (both scan_units exist in the engine); it does NOT build (a) the "Minimize to dot" session-dot — that is the standing Jarvis process-overlay (FR-DECISIONS §Long jobs / §4.5), a SHELL-lane pattern not built anywhere in this repo (substance is covered: jobs survive navigation and rejoin on return), and (b) a folder-unit "scan a subfolder only" picker — building that UI without an approved mockup would violate mockup-before-UI (FR-RULES §Build discipline).
**Evidence:** `src/modules/scan/ScanModule.tsx` (whole-drive flow; rejoin-on-mount); no session-dot component in the tree; mockup Option C shows the dot, Option A/B show whole-drive.
**Suggestion:** scope the Jarvis process-overlay as a shell-lane task and the folder-unit picker as its own mockup+build; both are additive to what shipped.
**Severity:** worth-fixing (feature-completeness, not a defect — the shipped flow is whole and correct)

## [GAP] 2026-07-19 — media set narrowed + scan is media-only (Jason approval recorded)
**Canon says:** FR-DECISIONS §Scan — "Stills, video, and audio equally"; no explicit media extension list or media-only rule.
**Reality:** the shipped media set is now fixed in `electron/core/services/scan/media.ts` (stills: jpg jpeg png tif tiff heic heif webp bmp gif cr2 cr3 nef arw dng orf rw2 raf pef srw · video: mp4 mov m4v 3gp avi mts m2ts mkv wmv mpg mpeg webm braw r3d · audio: wav mp3 m4a flac aac ogg wma aiff), and ONLY media files get scan_files rows (non-media counted, no row) — a deliberate behaviour change fixing a 1.29M-row / 20,173-error-row scan down to 36,407 media rows / 7 genuine errors on the real D: drive.
**Evidence:** `media.ts`; Phase 7 measurement REPORT-scan-defects-2026-07-19.md (D: run: 123,924 folders, 36,407 media of 1,289,909 files, 7 error rows).
**Suggestion:** record the media set + media-only decision in DECISIONS; the earlier canon set (which included psd/raw/crw/etc.) is superseded.
**Severity:** worth-fixing (behaviour is shipped and proven; canon should reflect it)

## [GAP] 2026-07-19 — RAW_MODE diagnostic flag added (default false)
**Canon says:** nothing on a diagnostic throughput mode.
**Reality:** `RAW_MODE` (const, default FALSE, in `scan/index.ts`) batches commits every RAW_COMMIT_BATCH=100 folders, skips the double-scan guard, and logs throughput — for benchmarking only. Shipped default behaviour (per-folder commit) is unchanged.
**Evidence:** `scan/index.ts` RAW_MODE/RAW_COMMIT_BATCH; Phase 7 both-mode measurement.
**Suggestion:** note the flag exists so it is never shipped true; no canon rule needed beyond awareness.
**Severity:** cosmetic

## [CONTRADICTS] 2026-07-20 — Jason ruled: automatic update SUCCESS now toasts at download-complete
**Canon says:** "Check on boot and every 6 hours. Automatic checks fail **silently**; manual checks **always answer**, including failure." (FR-DECISIONS-1.md §Auto-update). Read together with "silent on failure — offline is a normal condition" this made BOTH outcomes of an automatic check silent.
**Reality (ruled by Jason 2026-07-20):** an automatic check that FINDS an update is no longer fully silent — with autoDownload ON the update downloads itself, and at **download-complete** the renderer raises the actionable "ready to restart" toast (does not auto-dismiss). Automatic **failures remain silent** (unchanged). Manual checks still always answer (checking / found / latest / failed).
**Evidence:** `electron/core/updater.ts` (`autoUpdater.autoDownload = true`; the `update-downloaded` push is the only automatic user-facing signal; `error` handler logs only, sends nothing); `src/App.tsx` `UpdateToast` (subscribes `updater:downloaded` → "ready to restart", no auto-dismiss; no automatic "available"/progress toast); `src/views/Settings.tsx` (manual "available" answer via the CustomEvent). Commit on branch `feature/isobmff-geometry`.
**Suggestion:** amend FR-DECISIONS §Auto-update to "automatic checks fail silently; an automatic check that finds an update downloads it and raises ONE actionable 'ready to restart' toast at download-complete; manual checks always answer."
**Severity:** worth-fixing (canon wording now lags the ruled behaviour)

## [STALE] 2026-07-20 — autoDownload resolved to TRUE (earlier open discrepancy closed)
**Canon says:** the 2026-07-19 entry above recorded the code set `autoDownload = false` (CLAUDE.md §3.12 consent-first) against FR-DECISIONS §Auto-update "autoDownload defaults TRUE in this product only," and left it "Jason picks one."
**Reality:** Jason picked TRUE (2026-07-20, with the toast task). `electron/core/updater.ts` now sets `autoUpdater.autoDownload = true`, matching FR-DECISIONS. CLAUDE.md §3.12 ("Download only on user consent … Never pull a large download silently") is now the lagging document for this product.
**Evidence:** `electron/core/updater.ts` (`autoUpdater.autoDownload = true`); the actionable-moment toast at download-complete depends on it.
**Suggestion:** update CLAUDE.md §3.12 to record the this-product-only autoDownload-TRUE exception (every other AvertXAI app stays consent-first), closing the 2026-07-19 open pick.
**Severity:** worth-fixing
