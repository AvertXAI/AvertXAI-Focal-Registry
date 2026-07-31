# FR-STATUS-2.md — Focal Registry build state

One line each. *(Derived 2026-07-31, verified against HEAD `d10060d`. Supersedes FR-STATUS-1, which was written at `cb5eb9c` and lags ~30 commits.)*

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

## In flight
- **Scan triage improvements UNCOMMITTED, awaiting Jason's device gate** — grouped issues modal, disk-read banner, elapsed line, partial reports, plus pre-existing display fixes. Ten files: `electron/core/ipc.ts`, `scan/db.ts`, `scan/index.ts`, `scan/report.ts`, `src/modules/scan/ScanModule.tsx`, `scan.css`, `src/shared/types.ts`, `src/shared/scanErrors.ts`, `src/modules/rename/rename.css`, `src/views/Settings.tsx`.
- **TimeTracker port** — recon COMPLETE at 0.93 confidence, `REPORT-timetracker-port-recon-07-30-2026.md`. All rulings settled. **Phase 1 of 6 not started.**

## Not started
- Migrate Phase 2 (import and install) · MindMerge editor (rebuild approved, no layout chosen) · Rename module UI polish · Bugsink and Resend (need credentials) · folder watcher · Jarvis home dashboard (three concepts mocked, J1 the lean, nothing chosen) · hidden module unlock (Control + Left Shift plus 10 clicks on the version number) · the marketing website (own repo, Next.js on Coolify, no pricing decided).

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
