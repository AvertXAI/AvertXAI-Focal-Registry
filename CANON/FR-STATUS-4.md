# FR-STATUS-4.md — Focal Registry build state

One line each. *(Derived 2026-07-31, verified against the local branch head. Supersedes FR-STATUS-3 — delete it after upload.)*

## Shipped
- **0.2.5 LIVE and verified on the feed** — installer, manifest, and `REVISIONS.md` all return 200. Branch `main`, HEAD `d10060d`, pushed.
- **Paul is the alpha of one**, auto-updating from the live feed. Update loop proven end-to-end.
- Update server live: nginx on Coolify, valid certificate, correct cache headers.

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
- **15 commits unpushed** through `3fb70de`, unless the push task has run. Last known pushed: `d10060d`.
- `CANON-UPDATES.md` carries Jason's edits, uncommitted.

## Designed, not started
- **Employees — ITS OWN MODULE**, sibling of TimeTracker under Applications. The PROJECTS/PEOPLE rail toggle is DEAD. Five mockups approved (three nav options, payroll v1/v2/v3, in-shell render, Add Time / Add Task / Adjustments forms). Every ruling settled in FR-DECISIONS. No schema, no code.
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

## Dead — do not propose
- In-place rename · `ffprobe` / bundled FFmpeg · `ffprobe-static` · Gitea, OneDev, or any git forge as update host · Python, PySide6, or Tkinter UI · a second GitHub organization · thumbnails or pixel decode of any kind · **the Scan god-mode surface** (wizard, search, extraction, viewers, delete, nuke) · **anything named `runbooks`** — the slug, the migration, the preload global, all removed.
