# FR-STATUS-5.md — Focal Registry build state

One line each. *(Derived 2026-08-14 from STATUS-38 + the vault-into-shell handoff. Supersedes FR-STATUS-4 — delete it after placement.)*

## Shipped
- **0.2.6 LIVE on the prerelease feed**. `origin/main` = `3e8a2d4`; working tree habitually on `feature/vault-build`.
- **Paul is the alpha of one**, auto-updating from the live feed. **Installed builds LAG main** — device tests run `npm run dev` at current main or a fresh package, never the stale installed app.
- Update server live: nginx on Coolify, valid certificate, correct cache headers.
- **Commit chain this cycle:** `ce51efc` (Employees 3B people CRUD) → `c952c86` (3B.2 wizard + employee timer) → `62206ec`/`f57edaf` (project-modal rework) → `b451944` (seed + schema-at-birth) → `4465c65` (13-item fix pass) → `e403b76` (Complete Job + Business/Employee Profiles + invoice numbering + dev-mode leaf) → `1a87d67` (invoice skill compliance, Inter embedded) → `d078aae` (profit build: one money vocabulary, payments, below-zero charts, adjustments) → `3e8a2d4` (plan-based purge, dev-gated seed tools, Reset organisation).
- **Employees BUILT through 3B.2** — people CRUD (tier caps 5/10/unlimited), Add Time, employee timer subsystem, both TimeTracker placements. 3C (Tasks · Adjustments · Details) and Payroll OPEN; Payroll parked until Jason sits with it. Two queued fixes: four address columns on `timetracker_clients`; `phone_ext` moves beside the phone it extends.
- **Secured Vault — STANDALONE COMPLETE 2026-08-14** at `modules/vault/` (lane source commit `79e0715` + polished uncommitted work; proofs green: engine 23 · notes 38 · redesign 20 · transfer 16 · codetheme 8). Surfaces: Passwords (versioned secrets, generator, health, access log) · Secured Notes (Milkdown + Markdoc, autosave, import, global search) · Infrastructure (DNS / servers / SSH keys / package ledger) · Repos (local scan, README snapshots) · event log with `VLT-` request ids · vault-held settings · code-theme import. **MOUNT IS THE CURRENT ASSIGNMENT** (Claude Code desktop, root-lane authorised). Sequence: merge → test → fix (`_source\fixes\vault-broken-patch.md`, in order) → wizard → test → ship.

## Built and verified
- **Shell + identity** — gut complete. `productName` is **Focal Registry**; `artifactName` `Focal-Registry-Setup-${version}`. Nav locked at seven. Settings restructured. Not-built page replaces the orange glow. Tray a user setting, Open/Exit only.
- **Auto-updater** — `electron-updater`, generic provider, `prerelease.yml`, `autoDownload` FALSE, `before-quit` handler so `quitAndInstall` is not blocked by the hide-to-tray ✕.
- **Software Update window** — own `BrowserWindow` 560×540, own `updateApi` preload, non-scrolling summary, details fetched main-side via `net.fetch`, Install-or-Quit on a major bump, unmaintained notice at two-plus minors behind.
- **`REVISIONS.md` release pipeline** — single source of release notes; `release.mjs` step order 0/4 inject, 1/4 payload, 2/4 manifest, 3/4 revisions, 4/4 verify.
- **Scan** — five tables plus indexes in the shared org database; volume-serial identity with the double-scan guard; probe and estimate; crash-safe traversal proven on a 1.29-million-file drive; rerunnable harness at `scan/crash-test.ts`. **Reverted to 0.2.4 behaviour at `9711027`** — wizard, search, extraction, and viewers removed.
- **EXIF stills** via `exifr` — `captured_at` with strict `exif`/`file` sourcing, make/model/lens/dimensions, folder rollups computed inside the commit.
- **`src/shared/scanErrors.ts`** — 18 errno codes plus media and EXIF patterns, plain-sentence output with a likely-cause hint; raw `error_text` always kept; whole-run disk-read count computed in SQL so the 200-row page cap cannot hide it.
- **Scan report** — elapsed time from existing `started_at`/`finished_at`, no migration; partial reports every 60 seconds to both the scanned drive and the local tree, deleted and replaced by the final.
- **Rename** — shipped, calling `copyVerified()` with hashing off.
- **Migrate Phase 1** — slug `migrate`, nav 3, four tables, drive identity foreign-keyed to `scan_drives`, extension registry served as data, single-slot queue, both preflight guards proven refusing. Committed `f79cf20`.
- **`copyVerified.ts`** — shared copy core. `COPYFILE_EXCL`, source read-only, byte-count verify, optional SHA-256 default OFF.
- **MindMerge** — renamed end to end from Secure Note at `98ae1b7`: slug `mindmerge`, own database `mindmerge_<org>.db`, IPC `mindmerge:*`, settings `mindmerge.*`, tables `mindmerge_notes`/`mindmerge_fts`, tokens `--mindmerge-*`. Read-only ingest and search.
- **Tips registry** — `src/shared/tips.ts` and `src/components/Tip.tsx`, contract `<Tip id="TIP-XXX-NNN" />`, one global `tips.enabled` setting. Committed `cbf9ecb`. *(Real canon STATUS-35 wrongly lists this as not started.)*
- **Device identity** — `electron/core/services/identity/index.ts` reads MachineGuid via `reg.exe` from `SystemRoot` (never PATH) and the SMBIOS hardware UUID via PowerShell CIM; `device_provenance` row written inside the first-run transaction. **LOCAL ONLY, never transmitted.** *(Also wrongly listed as not started in STATUS-35.)*
- **`window.shell`** — `window.runbooks` renamed across all four consumers; `boot:done` / `boot:start` IPC strings unchanged.
- **`migrate.ts` DELETED** — the legacy `runbooks` migration removed after a disk check proved no legacy database existed.
- **Governance** — `CLAUDE.md` Part 0 bootstrap, licence gate, size gate, `CANON-UPDATES.md`.

## TimeTracker — PORT COMPLETE, all six phases device-gated
`130a331` schema + services (12 tables, 8 indexes, validators intact) · `3478ba0` 65 IPC handlers, `window.api.timetracker.*`, both push whitelists, both nav seeds at 7 · `60af3ba` 17 bundled sounds + `build.files` · `814fbcd` Tracker tab and nested rail · `e6d3b67` Logbook, Adjustments, Activity, Archive · `12de84d` three-state timer bar with live dollar countup, value ledger, costs, sessions, notes, grand total · `ab0ccaa` ledger nuke deregistered · `7a1c10a` Analytics with four hand-rolled SVG charts and Export PDF · `d8c10f8` licensing, caps, Settings section, rail collapse · `7aa6416` fix pass · `3fb70de` mini timer window and attention engine. **Port fully committed.**

**Fixed along the way:** the `.view.shown{display:block}` specificity loss that stacked the rail above the content · the scrollbar gutter sitting inside its parent's padding · the seeded-versus-default `break_enabled` bug that shipped in the standalone · sound playback dead because the CSP has no `media-src`.

## In flight
- **Vault mount** — assigned; the lane's 21 modified + 7 untracked files commit path-explicit as part of it; outside-lane `db/index.ts` (compactDb/closeAllDbs) commits separately.
- Root `CANON-UPDATES.md` — 12-entry pruned working copy is DELIBERATE (08-10 session); commits with the mount; the vault lane's 17-entry ledger appends to it marked applied.
- **FIVE device-gate checklists stacked, never run** — nothing from 3A through the purge fix has fully rendered on Jason's screen beyond leaf/seed/purge spot-checks. Invoice PDF, three themes, analytics visuals, completion-rail behaviour: Unknown until gated.
- **BuildersAudit beta tester** found, wants fake live data; same-app-or-separate OPEN.

## Designed, not started
- **First-run wizard** — RULED 2026-08-14, SEQUENCED LAST (after merge + fixes): Personal/Business fork, full name · email · contact · master-password one-time change, type-specific account ID, demo seed + modal notice. No network call.
- **MindMerge editor** — arrives by COPYING the vault's Secured Notes stack after the fixes. The Repos online reader lives here too.
- **Settings modal** — replaces the Settings tab/page; mockup first, very basic, grow.
- **Employees 3C + Payroll** — tabs designed, Payroll parked until Jason sits with it.
- **Navigation restructure** — Archive Media · Applications · Tools · Secured Vault · Marketplace, plus the entitlement-aware boot screen. Shell-lane.
- **Calendar — ITS OWN MODULE**, sibling of TimeTracker. Shares the org database. Two calendars: Google beside Focal Registry.
- **Marketplace module** — own page, coming-soon.

## Known open
- **Hybrid-theme left-edge seam** — sidebar `#121a2e` against base `#0d1320`, ΔB+14. Two fix options mocked, decision pending.
- **Resize-repaint edge-colour mismatch** — Layer 1 fixed upstream in Chromium 142 and already present in Electron 41.9.2; Layer 2 is the hybrid seam.
- **Dev/prod `userData` isolation NOT implemented** — dev and the installed app share `%APPDATA%\Focal Registry` and one single-instance lock. Root-caused hours of false negatives. Root-lane task.
- `original_filename` is a current-stem fallback — no pure-JavaScript library decodes the MakerNote DCF name.
- No `PROJECT-STATUS.md` in this repo; session reports in `_source\...\reports\` serve that role.
- `CANON/` in this repo reappears after deletion — the Canon Distributor on another machine still targets it.
- nginx serves `.md` with no cache header; add `.md` to the no-cache block in Coolify when convenient.
- **VHS and Hi8 capture** — research complete, viable with zero bundled binaries via `getUserMedia` plus `MediaRecorder` to WebM. Buy an STK1160 UVC grabber, not the UTV007 August VGB100. Blocked on hardware.
- **FR scoped canon staleness in `CLAUDE.md` §0.1** — names `FR-CANON-1` literally; reword to "highest-numbered" (rides the mount).
- Known-broken vault list — `D:\dev\_source\AvertXAI-Focal-Registry\fixes\vault-broken-patch.md`; five product-liars first. FIX PHASE, not the mount.

## Dead — do not propose
- In-place rename · `ffprobe` / bundled FFmpeg · `ffprobe-static` · Gitea, OneDev, or any git forge as update host · Python, PySide6, or Tkinter UI · a second GitHub organization · thumbnails or pixel decode **from the archive** (Scan/Rename — vault note attachments are the ruled 08-12 exception) · **the Scan god-mode surface** (wizard, search, extraction, viewers, delete, nuke) · **anything named `runbooks`** — the slug, the migration, the preload global, all removed.
