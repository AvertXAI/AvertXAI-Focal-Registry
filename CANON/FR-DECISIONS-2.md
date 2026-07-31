# FR-DECISIONS-2.md — settled choices for Focal Registry

Current state, one line each. Do not reopen unless Jason says so.
*(Derived 2026-07-31 from DECISIONS-49 + repo CLAUDE.md + the TimeTracker port recon. Supersedes FR-DECISIONS-1.)*

## Identity and build
- Product **Focal Registry**, domain focalregistry.com, alpha customer **Paul Cruz**. Built by copy-then-gut of the RunBooks Mission Control shell.
- Electron + Vite + React + TypeScript. **NOT** Next.js, **NOT** Tailwind, **NOT** CSS modules.
- **Node-native. NO Python runtime, no sidecar interpreter, no `child_process` bridge to a script.** Invoking an operating-system binary already present on the machine is permitted, by full path, with fixed arguments and no interpolated user input.
- `photo-dates.py`, `photo-summary.py`, `frameshift_v16.py` are REFERENCE ONLY — logic ported, code not.
- Mission Control shell preserved **explicitly** — structure, boot sequence, nav model, theming, persistence. Not restructured, not "improved."
- Shell tokens keep `--mc-*`. Modules use `--<module-slug>-*`, declared on the module shell class, not `:root`. Role names spelled out in full — `background`, not `bg`.
- Three theme modes retained in full: Hybrid / Dark / Light. Every UI change is verified in all three.
- **All RunBooks lineage is REMOVED.** `migrate.ts` deleted, the legacy `OLD_SLUG = "runbooks"` migration deleted, `window.runbooks` renamed `window.shell`. Do not resurrect any of it.

## THE LAW
- **Never delete, never modify an original. Copy everything.** — **governs RENAME only.** It is not a whole-product absolute; other modules write files by design.
- **No thumbnails, no previews, no proxies, no pixel decode. Ever.**
- Focal Registry operates on the photographer's **originals** folder only — read-only. The three-folder workflow (originals / edits / finals) is the governing constraint.
- **Sanctioned writes outside the application's own data folder are FOUR:** Scan's report · Rename's destination copies · Migrate's bundle export · Scan's extraction. Migrate Phase 2 install would be a confirm-gated fifth.

## Licences
- **Permissive only** — MIT, BSD, Apache-2.0, ISC. No GPL, AGPL, LGPL, PolyForm, SSPL, BUSL, or source-available dependency, **as code OR as a shipped binary**.
- Stills metadata: **`exifr`** (MIT). Video and audio: **`music-metadata`** (MIT).
- **`ffprobe` is REJECTED** — the FFmpeg binary is GPLv3 and ships inside the installer. **Do not reintroduce it.**
- If a format cannot be read by a permissively-licensed library, **write the parser.**
- Markdown editor: **Tiptap** (MIT core) for **authored** notes only. Generated reports stay read-only through the existing renderer.

## Storage
- **Scan · Rename · Migrate · TimeTracker SHARE one database** — the org database `focalregistry_{org_id}.db`. No `ATTACH`, no IPC handoff, no shared index — a consumer does a plain `SELECT`.
- **MindMerge keeps its own file** — `mindmerge_<org>.db`. Permanent until Jason rules otherwise. MindMerge is Tier-1 agent-READABLE and **cannot fold into the agent-opaque Vault**; it holds Vault pointers, never values.
- Vault has its own SQLCipher file. **Secrets never in the shared database.**
- Module tables are **prefixed by slug** — `scan_*`, `rename_*`, `migrate_*`, `timetracker_*`. Unprefixed names in the shared database are collision bait.
- Every module table carries `org_id TEXT NOT NULL` and the root `createTable()` standard columns.
- Database filenames are frozen at first run and never renamed casually.
- **`localStorage` is BANNED.** All persisted state goes to `app_settings` via service → IPC → preload, and every new key joins `RENDERER_KEYS`.
- Retention: **keep everything.** No automatic rolloff.

## Navigation and surfaces
- Applications, in order: **Scan 1 · Rename 2 · Migrate 3 · MindMerge 4 · Scout Viewer 5 · Secure Vault 6 · TimeTracker 7.**
- **System section renders only when a row exists in it.** An empty header would mean hardcoding a nav entry — banned. Not a defect.
- Not-built modules open a **plain explanatory page**, not the orange glow. THIS PRODUCT ONLY; `--mc-orange` stays declared.
- Settings: General · Appearance · Access · Modules · Integrations, plus a **per-module section**. TimeTracker gets its own page, holding all of its settings including break sound.
- **Scout Viewer KEPT** — Paul wants it for privacy. Extraction ships as-is to an alpha of one: a conscious acceptance of terms-of-service exposure. **Revisit before any wider release.**
- **MindMerge** is the module name and slug — the "Secure Note" name is RETIRED. "Secure Notes" now means only the encrypted notes inside the Vault.
- Tray is a **user setting**, default ON. ON = ✕ hides. OFF = ✕ quits. Menu is exactly **Open** and **Exit** — one shell tray, never one per module.
- Single-window shell. Sanctioned extra windows: the Software Update window · Scout's child views · **TimeTracker's mini timer**.
- Every tip carries a `TIP-<MODULE>-<NNN>` identifier. **ONE global tips on/off setting** — no per-tip options.
- Dates read **month-first** everywhere a human sees them, including report filenames.

## Auto-update
- `electron-updater`, **generic** provider, `https://updates.focalregistry.com/prerelease`, channel `prerelease`.
- **`autoDownload` is FALSE.** Consent-first, matching every other AvertXAI application.
- Check on boot and every 6 hours. Automatic checks fail **silently**; manual checks **always answer**, including failure.
- Software Update is its own `BrowserWindow`, 560×540, with its own `updateApi` preload; details fetched main-side via `net.fetch`. Required mode is Install-or-Quit on a major bump; an unmaintained notice appears at two-plus minors behind.
- `REVISIONS.md` at repo root is the **single source of release notes**. `release.mjs` extracts the version Summary, refuses on missing, placeholder, or over-400-character notes, injects into `prerelease.yml`, and uploads `REVISIONS.md` to the feed root.
- Builds are **UNSIGNED by design** for the alpha. The unsigned→signed transition is a deliberate manual reinstall, never an auto-update.
- Code-signing certificate and LLC both DEFERRED. If both are done, **LLC first**.

## Scan
- Reports on drives, never renames. Stills, video, **and audio** equally.
- **Scan is at 0.2.4 behaviour.** The three-step wizard, format selection, results filter, job tabs, queue, custom search, extraction, document viewer, media preview, and nuke were **built then scrapped as scope creep and reverted at `9711027`**. Do not rebuild any of them without an explicit new ruling from Jason.
- **Both scan units are first-class:** whole drive, or one folder plus its subfolders.
- **Volume serial is drive identity**, not the drive letter. A completed run means show the existing report, do not rescan.
- Probe first: sample 50 folders, extrapolate, present **Start full scan / Abort**. Always labelled a rough guide.
- **Commit per folder, in ONE transaction** — file rows, rollup, counters, and resume cursor together.
- Reports written to the **scanned drive** so they travel with a shelved archive, and to the local tree. New dated file each run; never overwritten. Partial reports every 60 seconds during a long run, clearly marked, replaced by the final on completion.
- Report body = drive summary + top 100 folders by media count, positioned stream writes. **NEVER one section per folder, never one in-memory document string.** Full per-folder detail stays queryable in the database and rides the CSV export.
- Markdown carries the numbers table; **the app draws the chart from the database** — no chart dependency.
- The markdown report carries YAML frontmatter and lands in MindMerge's watch folder for full-text search.
- Read errors are classified into plain sentences by `src/shared/scanErrors.ts`; only `EIO`/`ENXIO`/`ENODEV` is flagged as possible disk failure. Never infer drive health from a parse failure.
- Unknown format → log it, skip it, **continue**. Never crash a run.

## Rename
- **COPIES. Never renames, moves, or deletes an original.** Records `source_path` and `copy_path` both.
- **One folder at a time, recursing into its subfolders. NEVER a drive root** — enforced as a guard.
- Scan first → report to the source root → rename from the database. **Cannot rename what was never recorded.**
- Appends to the database, never overwrites. That append-only record IS the reversal mechanism.
- Calls the shared `copyVerified()` core with hashing OFF. The REVERT path passes `verify:false` because it never size-verified and a user-edited copy must still revert.

## Migrate
- Phase 1 shipped: slug `migrate`, nav position 3, tables `migrate_jobs` / `items` / `bundles` / `bundle_items`, drive identity foreign-keyed to `scan_drives`, extension registry **served as data, never hardcoded**, single-slot queue, both preflight guards proven refusing.
- Calls `copyVerified()` with SHA-256 hashing **ON**.
- **Phase 2 (import a bundle, install to Adobe and font folders) is NOT started.** Mockup M4 approved, build order written then cancelled. Export alone satisfies the stated need.
- Framed as **backup-and-restore**; machine-to-machine migration is one restore target.

## TimeTracker
- **Dock gate OPEN** (2026-07-31). Slug `timetracker`, display name TimeTracker, nav position 7, `type: "tool"`.
- Lives in the **shared org database**, tables prefixed `timetracker_*`. Not the Vault.
- **Fresh schema. No data import** from any existing TimeTracker database.
- Ports 1:1. The project-and-proposal layer is a **separate future Project Management module** that consumes this engine — do not build a second time tracker, and do not reserve columns for the layer.
- Three tiers, enforced by hardcoded licence key: **Free 3/3/3 · Pro 10/10/10 · Business unlimited**. Unlimited overrides everything.
- Caps apply to timers, projects, custom sound uploads, groups, and cost line items — **never to adjustments**, which exist to correct history.
- All 17 bundled alert sounds are available at every tier; the cap is on **custom uploads**.
- Licence keys are hardcoded and offline, coupon format `XXXX-XXXX-XXXX-XXXX`, 16 alphanumeric. No engine, no server call. Stored as `timetracker.licenseKey` and `timetracker.marketplaceId` in `app_settings`.
- Marketplace identifiers are three distinct things: **product** (the app sold online), **purchase** (one per transaction), **installation** (one per client).
- Hitting a cap routes to the marketplace module's pricing page. **Marketplace surfaces are not shown by default.**
- Own Settings page under Settings, holding all TimeTracker settings including break sound.
- Mini timer window KEPT as a sanctioned second window, always-on-top, top-right. Clicking a row pauses that session; Stop All available from it.
- Pause is a **flag** — `state` stays `'paused'` on the open row with `last_paused_at`, never a split entry.
- Break reminder, idle detection, and alert sounds all KEPT. The seeded-versus-default `break_enabled` contradiction is a bug — **fix it, do not port it**.
- Charts are **hand-rolled SVG**. No `recharts`, no chart dependency.
- CSV import and export **deferred**. No `papaparse`.
- Contract attachments live under the user-chosen `markdown_root`.
- Build proceeds in **six device-gated phases**: schema and services · IPC and registration · core UI · remaining tabs · analytics · licensing and settings.

## Errors
- **Bugsink** (self-hosted, Sentry-SDK compatible) for automatic capture; the app ships only the MIT Sentry SDK.
- User-initiated **"Report bug"** shows exactly what will be sent, with a notes field. **Paths and filenames only if the user ticks a box, defaulted off** — a photographer's paths carry client names.
- Delivery by **Resend** email. FreeScout and ntfy deferred until more than one user.
