# FR-STATUS-1.md — Focal Registry build state

One line each. *(Derived 2026-07-19, verified against HEAD `cb5eb9c`. Supersedes STATUS-31's Focal Registry entry, which lags ~15 commits.)*

## Shipped
- **0.1.1 installed on Paul's machine**, auto-updating from the live feed. Update loop proven end-to-end.
- Update server live: nginx on Coolify, valid certificate, correct cache headers, all three artifacts serving 200.

## Built and verified
- **Shell + identity** — gut complete (GetScriptClips, Canon Distributor, legacy `runbooks` service, `keystone` removed; Scout Viewer and Secure Note kept). Full identity applied. Nav locked. Settings restructured. Not-built page replaces the orange glow. Tray a user setting, Open/Exit only.
- **Auto-updater** — `electron-updater`, generic provider, `prerelease.yml`, manual check in Settings, `before-quit` handler so `quitAndInstall` is not blocked by the hide-to-tray ✕.
- **Org database renamed** to `focalregistry_{org_id}.db` with an idempotent, copy-verify-flip, rollback-safe boot migration including a **WAL checkpoint before the copy**. Proven on seeded copies: migrate · no-op re-run · crash-after-rename recovery · failure rollback · boots on old.
- **Scan foundation** — five tables + four indexes in the shared org database; volume-serial identity with the double-scan guard; probe and estimate; **crash-safe traversal** (killed mid-run, resumed field-for-field identical to a clean run, 85 folders / 425 files, orphans 0, mismatches 0); rerunnable harness at `scan/crash-test.ts`.
- **EXIF stills** via `exifr` — `captured_at` with strict `exif`/`file` sourcing, make/model/lens/dimensions, folder rollups computed inside the commit.
- **Governance** — `CLAUDE.md` Part 0 bootstrap, §2.10 licence gate, §2.11 size gate, §2.12 `CANON-UPDATES.md`; `PROJECT-CANON.md` generated.

## Commits since baseline `b4b6470`
`5696c4d` `f3c9f7d` `e3f3a6b` (updater + identity) · `9fdb8a7` `08683a9` `9f782ed` `cec4c0d` `46481a8` (gut + seeds) · `0c621a8` (slug migration) · `97352c6` (extensions + Secure Note label) · `221e05a` (EXIF) · `b864282` (ffprobe — being reverted) · `cb5eb9c` (crash re-verification) · `0764d1d` (boot terminal polish). **Nothing pushed.**

## In flight
- **ffprobe removal** — licence evaluation APPROVED (`music-metadata` MIT, 0.96 MB, 14 permissive packages). Phases 2–5 pending: uninstall, esbuild/asarUnpack/path-rewrite cleanup, reimplement, `stage='ffprobe'` → `stage='media'`, re-prove crash test. **MOV must be asserted empirically** — Canon bodies write `.MOV` and it is absent from the documented format table.

## Not started
- Report writer (first sanctioned write to a user drive — needs never-overwrite proof) · Secure Note handoff · Scan module UI (mockup approved) · Rename module (coming-soon page) · Bugsink and Resend (need credentials) · folder watcher.

## Known open
- **Dev/prod `userData` isolation NOT implemented** — dev and the installed app share `%APPDATA%\AvertXAI Focal Registry` and one single-instance lock. Root-caused hours of false negatives on 2026-07-18. Root-lane task.
- **`window.runbooks` preload bridge** and the legacy `runbooks`/`runbook_steps` tables remain. **`OLD_SLUG = "runbooks"` in `migrate.ts` MUST SURVIVE any refactor** — it is how the migration finds Paul's existing database.
- `original_filename` is a current-stem fallback — no pure-JavaScript library decodes the MakerNote DCF name.
- No `PROJECT-STATUS.md` in this repo; session reports in `_source\...\reports\` serve that role.
- `CANON/` in this repo reappears after deletion — the Canon Distributor on another machine still targets it.

## Dead — do not propose
- In-place rename · `ffprobe`/bundled FFmpeg · `ffprobe-static` · Gitea/OneDev/any git forge as update host · Python/PySide6/Tkinter UI · a second GitHub organization · thumbnails or pixel decode of any kind.
