# FR-DECISIONS-1.md — settled choices for Focal Registry

Current state, one line each. Do not reopen unless Jason says so.
*(Derived 2026-07-19 from DECISIONS-45 + SPEC-focal-registry-scan-v3 + repo CLAUDE.md. Where these disagree with DECISIONS-45, THESE are current — see `CANON-UPDATES.md`.)*

## Identity and build
- Product **Focal Registry**, domain focalregistry.com, alpha customer **Paul Cruz**. Built by copy-then-gut of the RunBooks Mission Control shell.
- Electron + Vite + React + TypeScript. **NOT** Next.js, **NOT** Tailwind, **NOT** CSS modules.
- **Node-native. NO Python runtime, no sidecar interpreter, no `child_process` bridge to a script.** `photo-dates.py`, `photo-summary.py`, `frameshift_v16.py` are REFERENCE ONLY — logic ported, code not.
- Mission Control shell preserved **explicitly** — structure, boot sequence, nav model, theming, persistence. Not restructured, not "improved."
- Shell tokens keep `--mc-*`. Modules use `<module-slug>-*`. Role names spelled out in full — `background`, not `bg`.
- Three theme modes retained in full: Hybrid / Dark / Light.

## THE LAW
- **Never delete, never modify an original. Copy everything.**
- **No thumbnails, no previews, no proxies, no pixel decode. Ever. In any module, for any reason.**
- Focal Registry operates on the photographer's **originals** folder only — read-only. The three-folder workflow (originals / edits / finals) is the governing constraint; the app touches originals and nothing else.
- The only write to a user drive is the report into `[drive]:\_FocalRegistry-Reports\`.

## Licences
- **Permissive only** — MIT, BSD, Apache-2.0, ISC. No GPL, AGPL, LGPL, PolyForm, SSPL, BUSL, or source-available dependency, **as code OR as a shipped binary**.
- Stills metadata: **`exifr`** (MIT). Video and audio: **`music-metadata`** (MIT).
- **`ffprobe` is REJECTED** — the FFmpeg binary is GPLv3 and ships inside the installer. Installed once in error; being removed. **Do not reintroduce it.** *(This supersedes DECISIONS-45's "ffprobe sanctioned" line — blocking discrepancy, logged.)*
- If a format cannot be read by a permissively-licensed library, **write the parser.** MP4/MOV are ISO base media format; a box walker is a few hundred lines, not research. Building it beats importing a licence problem.
- Markdown editor: **Tiptap** (MIT core) for **authored** notes only. Generated reports stay read-only through the existing renderer — never round-tripped. Tiptap Pro extensions are paid; stay on core.

## Storage
- **Scan and Rename SHARE one database** — the org database `focalregistry_{org_id}.db`. Rename appends to rows Scan wrote. No `ATTACH`, no IPC handoff, no shared index — Rename does a `SELECT`. *(Supersedes DECISIONS-45's per-module-file line.)*
- **Secure Note keeps its own file** until it folds into the Vault. Vault has its own SQLCipher file.
- Database filenames are frozen at first run and never renamed casually. The slug migration was a deliberate, verified, rollback-safe exception.
- **`localStorage` is BANNED.** All persisted state goes to `app_settings` via service → IPC → preload, and every new key joins `RENDERER_KEYS`.
- Retention: **keep everything.** No automatic rolloff. A purge control only if Paul asks about disk space.

## Navigation and surfaces
- Applications, in order: **Scan · Rename · Secure Note · Scout Viewer · Secure Vault**. `type: "tool"` for Scan and Rename.
- **System section renders only when a row exists in it.** An empty header would mean hardcoding a nav entry — banned. Not a defect.
- Not-built modules open a **plain explanatory page**, not the orange glow. THIS PRODUCT ONLY; `--mc-orange` stays declared.
- Settings: General · Appearance · Access · Modules (Vault only) · Integrations (Webhooks, Email notifications). Members-and-roles removed; Coming-surfaces replaced with Vault cards.
- **Scout Viewer KEPT** — Paul wants it for privacy. Extraction ships as-is to an alpha of one: a **conscious acceptance** of the terms-of-service exposure canon had gated Founder-only. **Revisit before any wider release.**
- Secure Note is the **display name**; slug `runbook-shredder`, folders, tables, and settings keys unchanged — slug rename is a separate gated task.
- Tray is a **user setting**, default ON. ON = ✕ hides. OFF = ✕ quits. Menu is exactly **Open** and **Exit**.

## Auto-update
- `electron-updater`, **generic** provider, `https://updates.focalregistry.com/prerelease`, channel `prerelease`.
- **`autoDownload` defaults TRUE in this product only.** Paul never thinks about updating. Every other AvertXAI application stays consent-first.
- Check on boot and every 6 hours. Automatic checks fail **silently**; manual checks **always answer**, including failure.
- Builds are **UNSIGNED by design** for the alpha. The unsigned→signed transition is a **deliberate manual reinstall**, never an auto-update.
- Code-signing certificate and LLC both DEFERRED. If both are done, **LLC first** — it removes the reissue publisher-name trap.

## Scan
- Reports on drives, never renames. Stills, video, **and audio** equally.
- Video metadata captured: video codec · audio codec · description · metadata date · bitrate · duration.
- **Both scan units are first-class:** whole drive, or one folder plus its subfolders. Neither is the real mode — the folder path exists because a 50-terabyte batch may run too long.
- **Volume serial is drive identity**, not the drive letter. A completed run means show the existing report, do not rescan.
- Probe first: sample 50 folders (a named constant), extrapolate, present **Start full scan / Abort**. Always labelled a rough guide.
- **Commit per folder, in ONE transaction** — file rows, rollup, counters, and resume cursor together. A crash loses that folder only.
- Reports written to the **scanned drive** so they travel with a shelved archive. New dated file each run; never overwritten.
- Markdown carries the numbers table; the app draws the chart from the database.
- Unknown format → log it, skip it, **continue**. Never crash a run. `stage='media'` error rows.
- `checksum` column exists, NULL in v1.

## Rename
- **COPIES. Never renames, moves, or deletes an original.** Records `source_path` and `copy_path` both. A failed run leaves the archive byte-identical.
- **One folder at a time, recursing into its subfolders. NEVER a drive root** — enforced as a guard, not a convention.
- Scan first → report to the source root → rename from the database. **Cannot rename what was never recorded.**
- Appends to the database, never overwrites. That append-only record IS the reversal mechanism.
- Port fixes owed: `{date}` and `{shotdate}` collide into one slot; FRAMESHIFT's own palette is discarded.

## Errors
- **Bugsink** (self-hosted, Sentry-SDK compatible) for automatic capture; the app ships only the MIT Sentry SDK.
- User-initiated **"Report bug"** shows exactly what will be sent, with a notes field. **Paths and filenames only if the user ticks a box, defaulted off** — a photographer's paths carry client names.
- Delivery by **Resend** email. FreeScout and ntfy deferred until more than one user.
