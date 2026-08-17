# FR-DECISIONS-5.md — settled choices for Focal Registry

Current state, one line each. Do not reopen unless Jason says so.
*(Derived 2026-08-14 from DECISIONS-52 + the Secured Vault standalone lane + the 2026-08-14 merge rulings. Supersedes FR-DECISIONS-4 — delete it after placement.)*

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
- **The rejection covers binaries the INSTALLER SHIPS.** A system-installed tool invoked by a developer-only harness excluded from the package creates no distribution obligation and is permitted. `scan/verify-isobmff.ts` is KEPT under this rule — recon proved it is imported by nothing, referenced by no script, and outside the `files` whitelist. **Do not re-litigate it.**
- The **"by full path, fixed arguments"** rule governs PRODUCT code only; it does not extend to developer-only harnesses.
- If a format cannot be read by a permissively-licensed library, **write the parser.**
- Markdown: **Milkdown types, Markdoc renders** (AMENDED 2026-08-14). Milkdown core + commonmark + gfm presets ONLY — never `@milkdown/react` or `/crepe` (both pull Vue). Markdoc (MIT, zero runtime deps) draws all read-only content including generated reports. Tiptap was evaluated and never adopted. Milkdown is RATIFIED PROVISIONALLY — keep, monitor, keep testing.
- **OFL (Open Font License) is ON the allow-list for font EMBEDDING** — Inter ships inside invoice PDFs under it (RATIFIED 2026-08-14).

## Storage
- **Scan · Rename · Migrate · TimeTracker SHARE one database** — the org database `focalregistry_{org_id}.db`. No `ATTACH`, no IPC handoff, no shared index — a consumer does a plain `SELECT`.
- **MindMerge keeps its own file** — `mindmerge_<org>.db`. Permanent until Jason rules otherwise. MindMerge is Tier-1 agent-READABLE and **cannot fold into the agent-opaque Vault**; it holds Vault pointers, never values.
- Vault has its own SQLCipher file. **Secrets never in the shared database.**
- Module tables are **prefixed by slug** — `scan_*`, `rename_*`, `migrate_*`, `timetracker_*`. Unprefixed names in the shared database are collision bait.
- Every module table carries `org_id TEXT NOT NULL` and the root `createTable()` standard columns.
- Database filenames are frozen at first run and never renamed casually.
- **`localStorage` is BANNED.** All persisted state goes to `app_settings` via service → IPC → preload, and every new key joins `RENDERER_KEYS` — **except a locked module: the Vault keeps its settings in `vault_settings` inside its own encrypted database, with `VAULT_DEFAULTS` as the single source and `VAULT_WRITABLE_KEYS` as its own whitelist.** The doctrine travels; the location is the ruled exception.
- Retention: **keep everything.** No automatic rolloff.

## Navigation and surfaces
- Applications, in order **as built today**: Scan 1 · Rename 2 · Migrate 3 · MindMerge 4 · Scout Viewer 5 · Secure Vault 6 · TimeTracker 7.
- **RESTRUCTURE RULED 2026-07-31, NOT BUILT** — sections are **Archive Media** (Scan · Rename · Migrate) · **Applications** (TimeTracker · Calendar · Employees) · **Tools** (MindMerge · Scout Viewer) · **Secured Vault** standalone · **Marketplace** standalone.
- **"Archive Media" is the verb** — tools that archive media. NOT "Media Archive". Do not flip it.
- **"Applications" is a placeholder name**; membership is settled, the word may change.
- **"Secured Vault"** is a display-name change only; the slug is unchanged. A slug rename is a separate gated task.
- Secured Vault and Marketplace are **top-level entries that are themselves clickable with no children** — a pattern the shell does not have yet. Build it once, use it for both.
- The Jarvis boot screen is **entitlement-aware** — it never names a module the user has not unlocked.
- All of the above is **shell-lane and separately authorised.** Module work may not touch it.
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

## TimeTracker — PORT COMPLETE 2026-07-31
- Slug `timetracker`, nav position 7, `type: "tool"`. Shared org database, tables prefixed `timetracker_`, fresh schema, no data import.
- Ports 1:1. The project-and-proposal layer is a **separate future Project Management module** that consumes this engine — do not build a second time tracker, and do not reserve columns for it.
- Three tiers by hardcoded offline key: **Free 3/3/3 · Pro 10/10/10 · Business unlimited.** Highest entitlement wins across both stored keys; no key resolves to Free, which is a working tier. Key format `XXXX-XXXX-XXXX-XXXX`.
- **Caps bind main-side in the services**, never only in the UI — `projects.ts`, `timer.ts`, `sounds.ts`. A disabled button is a hint; the service is the limit. The UI also checks on click so a user is never refused after filling a form.
- Caps cover projects, concurrent timers, and custom sound uploads. **Adjustments are never capped** — they exist to correct history. All 17 bundled sounds are free at every tier.
- **Restoring an archived project always succeeds**, even over a cap. Data access is never hostage to tier; the next create still refuses.
- **Ledger nuke channels DEREGISTERED** — removed from IPC, preload, and the type union. The service functions remain for a future confirm-gated maintenance path. Append-only is structural, not a UI convention.
- **ONE `DEFAULTS` const is the single source of truth for settings, and nothing is ever seeded.** This is the structural fix for the `break_enabled` bug where turning the sound off did not stick.
- Pause is a **flag** — `state` stays `'paused'` on the open row with `last_paused_at`, never a split entry.
- Charts are **hand-rolled SVG**; no chart dependency. CSV import and export **deferred**. Export PDF rides Electron `printToPDF` straight to Downloads, month-first filename, collision-safe.
- **Mini timer window** — frameless, always-on-top, top-right on first open. Position and open state persist as `timetracker.*` settings. Clicking a row pauses that session; Stop All stops everything; closing it never stops a timer. It displays only and can never bypass the concurrent-timer cap.
- Attention engine: one 15-second beat, **settings read live on every fire, never cached at start**, idle via `powerMonitor.getSystemIdleTime()`. **No session is modified without the user choosing it.**
- Own Settings section inside the shared Settings surface — no module gear, no per-module settings modal.
- Contract attachments live under the user-chosen `markdown_root`.
- **Encryption of the org database: NOT PROCEEDING.** Time entries, scan reports, and rename history do not justify it.

## Employees — RULED 2026-07-31 · BUILT through 3B.2 (2026-08-04)
- **Employees is its OWN MODULE**, a sibling of TimeTracker under Applications. Calendar likewise. *(Reverses the earlier "inside TimeTracker with a rail toggle" ruling.)* The rail toggle is DEAD; Employees has its own People rail.
- Employees tabs: Ledger · Tasks · Payroll · Adjustments · Details. TimeTracker keeps its six unchanged.
- Tables use the **`employee_` prefix** in the shared org database.
- **Employee cost reaches Analytics.** Hours logged against a project at a rate feed that project's COSTS and every chart.
- **Pay type lives on the ENTRY, not the person.** Types: hourly · per job · per task · donated. Hours are tracked for every type; effective rate is amount ÷ hours.
- **`rate_at_entry` is mandatory from the first schema.** A raise must never rewrite a closed period.
- **Free caps people at 5 · PRO at 10 · BUSINESS unlimited** — tier resolution lives in core `licensing/`, caps bind main-side. Adjustments stay uncapped.
- Adjustments split into **hours** and **amount** — different operations. Project required on hours, optional on amount.
- Tasks are their own records — assignable with zero hours logged, and flat-per-task pay needs a done state.
- Payroll is a **payment ledger, not payroll software.** Hours × rate, and a record of what was paid. Never withholds tax, computes net pay, generates an official form, files anything, or moves money.
- Outstanding balance **carries across periods.** Payments are append-only; a mistake is a reversing row.
- Tax Summary produces a **data-sheet PDF** for manual transcription, on a **cash basis** — what was paid in the year, not what was earned. The reporting threshold is a **setting**, never a constant.
- **Taxpayer identifiers live on the person row in the shared database, masked on blur** (AMENDED 2026-08-14 — supersedes the go-in-the-Vault line). SSN never renders unmasked.
- **Scout Viewer capture-on-confirm** reads a payment reference off a page the user navigated to themselves. **Automating a send is BANNED.**

## Business model — RULED 2026-07-31
- **Free shell, paid modules**, by subscription through the marketplace. A lapsed subscription locks the module. *(The earlier ~$99 one-time discussion is DEAD.)*
- **Scan and Rename stay free.** TimeTracker, Migrate, MindMerge, Scout Viewer are the paid layer.
- **Hardcoded keys are a knowing stopgap** — they get replaced by Keystone entitlements, not extended. A hardcoded key cannot expire, so subscriptions structurally require the server model.
- **Marketplace is its own module**, own page, coming-soon until built. Cap hits route there. Marketplace surfaces are never shown by default.

## Errors
- **Bugsink** (self-hosted, Sentry-SDK compatible) for automatic capture; the app ships only the MIT Sentry SDK.
- User-initiated **"Report bug"** shows exactly what will be sent, with a notes field. **Paths and filenames only if the user ticks a box, defaulted off** — a photographer's paths carry client names.
- Delivery by **Resend** email. FreeScout and ntfy deferred until more than one user.

## Device identity
- The device provenance row stays **LOCAL ONLY, never transmitted.** The shipped copy claiming it is *never transmitted anywhere* has been removed from the device panel. Any future licence binding that transmits a derived identifier needs its own ruling first.

## Money, completion, invoices — BUILT 2026-08-02 → 2026-08-10 (device gate pending)
- **ONE money vocabulary:** Revenue (contracted) · Spent (crew + itemized + hard costs via the single `projectSpend` composition) · Profit (revenue − spent). `entryCost.ts` / `projectSpend` are the ONLY authorities — no fourth expression ever.
- **Profit and margin render in ANALYTICS ONLY** — never on active project surfaces. The Completed-tab Net card stays.
- Payments: `timetracker_project_payments`, 8 methods + reference, soft delete; Awaiting/Paid derived vs the contract amount; **deliberately NOT completion-locked** — the lock's one named exception. Completion toast asks "Did you actually get paid?"; **Not-yet is a real answer** → Awaiting badge.
- Complete Job: `assertNotCompleted` guards ALL 16 write paths including Employees; corrections = reactivate → fix → recomplete; completed projects leave the Projects rail and timer select; read tabs keep the full list.
- Contract metadata: contract_date + signed_by + payment_terms; dateless = off the timeline, inside totals.
- Adjustments (employee ledger): entry-linked via soft `entry_id`, required reason, never rewrites the agreed entry. **Own tracked time EXCLUDED from Spent** — no owner rate exists.
- Invoices: `INV-YYYY-NNNN`, stable across re-export; Electron printToPDF path per the avertxai-invoice-pdf skill; Inter embedded (OFL).
- Schema-at-birth: org creation AND boot ensure every registered schema via `db/allSchemas.ts`. Seed asks for a licence key; refuses insufficient tiers in plain sentences.
- Dev mode: behind the ten-click leaf; persists; only a version change re-locks.

## Cross-module architecture (RULED from the 08-05 device failure)
- **Any write that changes a figure another module renders MUST announce on `timetracker:changed` before the call resolves; any surface rendering a derived figure MUST re-read on it.** One channel, deliberately — a second "re-read" channel is how a listener ends up half-wired. A shared database is not a cache; a mounted component never re-queries on its own.
- **A swallowed catch is never acceptable on a read feeding a rendered figure** — log at minimum; prefer a distinct error state (loading / empty / error are three different things). Four known swallowers remain in `TimeTrackerModule.reload()` — open item.

## Secured Vault — standalone lane rulings 2026-08-06 → 2026-08-14
- **Credential split:** a credential (password · backup code · security answer) lives on the append-only version row and leaves only through the single logged read. Presentation fields live on the secret row and may appear in lists.
- **Master password (RULED 2026-08-14):** the initial value is **derived per-install from device identity** — hash (SHA-256) over the Windows MachineGuid + SMBIOS hardware UUID, read through the EXISTING identity service, encoded to **16 alphanumeric characters, no symbols**. The personal-email placeholder is DEAD — the literal must not exist in source. The wizard later performs a **one-time password change presented as setup**; the user is never told a prior value existed. The master password gates the interface and IPC; **the SQLCipher key stays machine-held in safeStorage — deriving the encryption key from the master password is a separate, ruled, future build.** Seams stay marked `[master-password-placeholder]` until then. Existing vaults keep their stored verifier — seeding governs FRESH vaults only.
- **Device identity stays LOCAL ONLY.** Uploading the derived account/key material to Revenue Warden's cloud is ruled LATER and requires activating the transmit ruling first — no network call ships now.
- §4.1 "no pixels" binds **Scan and Rename and the photographer's archive ONLY**. Secured Notes MAY store a user-pasted image or PDF as an individually-encrypted attachment (ruled 2026-08-10 and 2026-08-12 — not to be re-litigated).
- **Network:** the Vault reaches the network for exactly two opt-in breach checks — nothing else. **MindMerge may reach the network; the Repos online reader lives in MindMerge.** A repo is read by MindMerge and pointed at from Vault Repos — never the reverse.
- A seed/demo purge may delete the audit rows it created itself, scoped by an exact ledger, recording the purge. No other path deletes an audit row.
- The shared importer takes a **DESTINATION**, never a file-type hint — each tab imports into its own kinds.
- **Orange:** a not-built MODULE opens a plain page; within a built module `--mc-orange` may mark a mapped-but-not-wired surface. (Clarifies the older blanket reading.)
- Secured Notes shelves: **Notes · Runbooks · Ideas** — the third stores as `snippet`; the label changed 2026-08-12, the stored value deliberately did not.
- Vault housekeeping: `auto_vacuum = INCREMENTAL` + `incremental_vacuum` after destroy + "Compact the vault" button. The shared org database has NO compaction path — open item.

## First-run wizard — RULED 2026-08-14, SEQUENCED LAST (build after merge + fixes)
- Step one: account type — **Personal or Business** — each gets its own modal.
- Collects: **full name · main email · contact number · master password** (own or assist-generated; implemented as the one-time change above). Remaining Business Profile fields stay in Settings.
- Each account gets a **type-specific database ID**; live-app registration of that record + machine id to Revenue Warden's cloud is **LATER** — the wizard makes no network call today.
- **Demo seed data loads at first boot** with a **simple modal notification** so it never reads as a bug or another organisation's data. The full guided tour (pointing toasts) is PARKED — much later.

## Merge + standing assignments — RULED 2026-08-14
- **Sequence: MERGE → test → FIX (vault-broken-patch, in order) → WIZARD → test → SHIP.** The mount task carries no wizard work.
- Post-merge fix map: `D:\dev\_source\AvertXAI-Focal-Registry\fixes\vault-broken-patch.md` — five product-liars first, then the six honest breaks.
- After the fixes: **Secured Notes stack (Milkdown + Markdoc + autosave + import + search) is COPIED into MindMerge** as its editor surface. MindMerge stays Tier-1 agent-readable; the Vault stays agent-opaque.
- Settings tab/page retires into a **settings modal** — mockup with Claude first, very basic, grow from there.
- **Remote control belongs to JARVIS** — parked behind the mount and the MindMerge copy.
