# FACTS-12.md

Verified facts. One line each: value — source — verified-on. Re-verify if stale.
*(How to maintain this file: see RULES-39.md. Supersedes FACTS-11 — delete it after upload. Rotated 2026-08-19: worker-window, throttling, virtualization and SQL-LIKE facts measured and recorded.)*

## Hardware — mini PC candidates
- Beelink GTR9 Pro standard SKU (Ryzen AI Max+ 395, 128GB, 2TB, dual 10GbE, 185 reviews): $3,399 — Amazon US — 2026-06-07
- Beelink GTR9 Pro new SKU (built-in AI mic, AMD Radeon 8060S, MSC2.0 cooling 32dB, dual M.2 to 8TB, 0 reviews): $4,349 — Amazon US — 2026-06-07
- GMKtec EVO-X2 (Ryzen AI Max+ 395, 128GB, 2TB): $2,999.99 listed / Keepa current $3,299.99 — Amazon US — 2026-06-07
- NVIDIA Jetson Thor Developer Kit (128GB): $3,499.99 — Amazon US — 2026-06-07
- NVIDIA DGX Spark official (128GB, 4TB): $4,679 — Amazon US — 2026-06-07
- ASUS Ascent GX10 (DGX Spark variant, GB10, 128GB, 1TB): $3,495.26 — Amazon US — 2026-06-07

## Hardware — storage reference
- Seagate Expansion 22TB external USB 3.0: $529.99 = $24.09/TB — Amazon US — 2026-06-07
- Seagate Exos 28TB Renewed (3.5in SATA, requires enclosure or tower): $615 = $21.96/TB — Amazon US — 2026-06-07
- Acer Predator GM7 4TB NVMe (PCIe 4.0): $702.99 = $175.75/TB — Amazon US — 2026-06-07
- Samsung 9100 Pro 4TB NVMe (PCIe 5.0, ~13,400 MB/s seq write): $849.99 = $212.50/TB — Amazon US — 2026-06-07

## Hardware platform notes
- Ryzen AI Max+ 395 / Strix Halo: LPDDR5X soldered, 128GB MAX, NOT upgradable; storage via dual M.2 PCIe 4.0 x4 to 8TB — Beelink spec sheet — 2026-06-07
- 273 GB/s memory bandwidth requires soldered LPDDR5X; standard DDR5 DIMMs would halve it — Industry Convention — 2026-06-07
- NVMe consumer pricing at/near all-time highs (NAND spike from AI buildout); Keepa shows 2-3x increase since Oct 2025 lows — Camel data — 2026-06-07

## Market events
- Amazon Prime Day 2026: June 23–26 (moved from July) — Amazon official — 2026-06-07

## Benefits / legal (personal admin)
- SSI back pay: excluded from $2,000 resource limit for 9 months from receipt (20 CFR §416.1233); must stay identifiable — 2026-05-31
- SSI monthly payment: ~$997 — 2026-05-31

## Market / competitor
- Toast multi-location: ~$3,000–5,000+/mo per location all-in; processing 2.49–2.99% + $0.15/txn; forces Toast Payments; 3-yr contract; $495 ETF — 2026-05-31
- Shift4 / SkyTab: $29.99/mo per terminal + $250/yr per device program fee + required Shift4 processing 2.75% + $0.15/txn; 36-month contract; $295–$10K+ early termination fees — shift4dine.com + skytabpartners.us — 2026-06-08
- Become a PayFac: ~$500K–1M+ upfront, viable only above ~$50M/yr volume; PayFac-as-a-service (Stripe Connect/Finix/Payrix) the only solo path — 2026-05-31
- SOC 2: ~$10K–35K via Vanta, cheaper DIY — 2026-05-31

## Mobile / app store (GetScriptClips + future apps)
- Google Play developer account: $25 one-time, applies to BOTH account types; cannot convert between types (new account + new $25 to switch); apps don't transfer — Play Console Help — 2026-06-22
- Play PERSONAL account: gov ID only; BUT accounts created after Nov 13 2023 must run a closed test (≥12 testers, 14 continuous days) before production access; full legal name shown publicly as developer — Play Console Help — 2026-06-22
- Play ORGANIZATION account: needs D-U-N-S number (free from Dun & Bradstreet) + registered legal entity; EXEMPT from the 12-tester closed-test gate; shows business name as publisher — Play Console Help — 2026-06-22
- Google Play service fee (consumable IAP = credits): CURRENT 15% on first $1M/yr (reduced-tier enrollment via Account Group) / 30% above. NEW structure US/UK/EEA from Jun 30 2026: new installs 20% (or 15% via opt-in Apps Experience Program), existing installs 20%, PLUS 5% billing fee if using Google Play Billing. Subscriptions 10% + 5% billing. — Play Console Help + Google announcement Mar 4 2026 — 2026-06-22
- US fee status IN FLUX: pending Epic v Google ruling (Judge Donato, hearing Apr 9 2026); under prior injunction US alternative billing was 0% to Google. Post-Apr-9 outcome = UNVERIFIED (re-check before relying on US billing assumptions) — 2026-06-22
- Apps Experience Program (to unlock 15% tier): no $ fee to join; requires meeting Google quality/integration benchmarks (full requirements not yet published) — Play Console Help — 2026-06-22
- RevenueCat: billing-abstraction layer on top of Play/App Store/Stripe; does NOT replace the store's fee; has a free tier + paid above a tracked-revenue threshold (exact pricing = Unknown, verify before committing); best for cross-platform subscriptions, likely overkill for Android-only consumable credits — 2026-06-22

## Tooling constraints
- Claude memory: 500 chars/edit, 30 edits max — 2026-05-31
- Claude project files: read-only to Claude; same-name re-upload DUPLICATES (does not overwrite) — tested 2026-05-31
- Antigravity reads GEMINI.md, AGENTS.md (since v1.20.3), .agent/rules/; not .claude/ — 2026-05-31
- PostHog Cloud Free: 1 project, 1M events/mo; multi-site supported via super-properties (`posthog.register({ site: '<slug>' })`); no apps-per-project limit on Cloud per current docs — posthog.com/pricing + cross-domain tracking tutorial — 2026-06-08
- Google AI Studio (Build mode): native Android apps = Kotlin + Jetpack Compose, client-side only (no server runtime), no NDK/C++; export = ZIP download OR Antigravity hand-off only (GitHub export NOT available for Android); export controls = icon strip in top toolbar near Saved/Unsaved status — ai.google.dev + Play/Android docs — 2026-06-22

## On-device ML / Android audio capture (GetScriptClips)
- AudioPlaybackCapture default policy = ALLOW_CAPTURE_BY_ALL for apps targeting Android 10+ (API 29); audio capturable unless app opts out (`allowAudioPlaybackCapture=false` / ALLOW_CAPTURE_BY_NONE); only USAGE_MEDIA/GAME/UNKNOWN capturable; DRM/protected streams silent per-content (not per-app) — Android Developers "Capture video and audio playback" — 2026-07-01
- whisper.cpp on Android = CPU/ARM-NEON only; no working NNAPI backend; OpenCL/CLBlast historically incorrect or slower (Issues #1140/#1738); Core ML/ANE = Apple-only — whisper.cpp GitHub — 2026-07-01
- Snapdragon 8 Gen 3 (Galaxy S24 Ultra) sustained on-device inference: Android thermal governor floors GPU to 231 MHz (from 629–680 MHz) by iteration 6, GPU 78.3°C — Wang et al. arXiv:2603.23640 — 2026-07-01
- Naive "growing buffer" streaming whisper.cpp ≈ 5–7x slower than real-time; fixed independent chunks ≈ 2.5–5x real-time (tiny q8_0, 4 threads) — whisper.cpp Discussion #3567 — 2026-07-01

## Source control / release hosting
- GitHub Free for ORGANIZATIONS: unlimited public repos full-featured, unlimited PRIVATE repos with a limited feature set, unlimited collaborators, 2,000 Actions minutes/mo, 500MB Packages storage — GitHub Docs (githubs-plans) — 2026-07-18
- GitHub Team $4/user/mo adds protected branches, code owners, required reviewers, draft PRs, 3,000 Actions min/mo, 250GB LFS; Enterprise $21/user/mo adds SAML SSO, SCIM, audit-log API, data residency — GitHub Docs + pricing — 2026-07-18
- `electron-builder` uploads release targets + metadata automatically for GitHub Releases / S3 / DigitalOcean Spaces / Keygen; the **generic** HTTP(S) provider is the EXCEPTION — you upload manually — electron.build/docs/features/auto-update — 2026-07-18
- Self-hosted git forges (Gitea, GitBucket, GitLab, Forgejo) have NO built-in electron-builder provider; documented approach = `provider: "generic"` pointed at the server's download directory, i.e. treat the forge as a static file server — electron.build/publish + practitioner guide — 2026-07-18
- macOS auto-update REQUIRES code signing; Windows NSIS does not — electron.build auto-update docs — 2026-07-18
- Coolify root password reset without SMTP: `docker exec -ti coolify sh -c "php artisan root:reset-password"`; email change via `root:change-email` — coolify.io/docs/knowledge-base/commands — 2026-07-18
- Docker Compose inline `configs: content:` requires Compose v2.23.1+ (a separate version from Coolify's) — Compose spec — 2026-07-18 (Real Data, not re-verified this pass)

## Electron / packaging (verified 2026-07-18/19)
- `productName` drives the installer filename, Start Menu entry, Add/Remove Programs, install directory AND the Electron `userData` folder; it must live at the TOP LEVEL of package.json, not under `build` — 2026-07-18
- Windows `CompanyName` derives from `author`; `FileDescription` derives from `productName`, NOT from `description` — 2026-07-18
- electron-builder 26.x: publisher name is `win.signtoolOptions.publisherName`; `win.publisherName` fails schema validation (`additionalProperties: false`) — verified from installed `scheme.json` 2026-07-18
- electron-builder names the update-info file `<channel>.yml` (channel `prerelease` → `prerelease.yml`); the hyphenated `latest-mac.yml` form is per-OS, not per-channel — 2026-07-18
- The **generic** provider does NOT upload; every other electron-builder provider does — electron.build docs — 2026-07-18
- A packaged Electron process is named for `productName` (`AvertXAI Focal Registry.exe`), not `electron.exe`; both hold the single-instance lock — 2026-07-19
- `ELECTRON_RUN_AS_NODE=1` is inherited from a VS Code process tree and breaks Electron launch (`createFromDataURL of undefined`) — 2026-07-18
- `%APPDATA%` = `AppData\Roaming`, NOT `AppData\Local` — Electron `userData` lands in Roaming — confirmed 2026-07-18

## Licences (verified at source 2026-07-19)
- `music-metadata@11.14.0`: **MIT**; 14-package tree = 13 MIT + `ieee754` BSD-3-Clause; **0.96 MB unpacked**; zero native deps; parses audio AND video containers (MP4/M4V/MKV/WebM/ASF + all common audio) — verified from the npm manifest and the repository LICENSE.txt
- `@ffprobe-installer/ffprobe`: wrapper LGPL-2.1, **FFmpeg binary GPLv3**, 78 MB — REJECTED for shipped products
- `ffprobe-static`: 336 MB, vendors every platform's binary — rejected
- `exifr@7.1.3`: MIT, zero deps, 1.5 MB, pure JavaScript — 2026-07-18
- Bugsink: **PolyForm Shield** — free for self-hosting, non-competing use; NOT OSI open source. GlitchTip: MIT (unverified this pass)
- Tiptap: MIT core; some extensions are paid Pro — verify before adding an extension
- Milkdown: MIT, ProseMirror-based, markdown-native via remark — the same ProseMirror core Tiptap uses, so running both is one engine with two shells (licence re-verify at install)
- Electron ships `webContents.printToPDF` — PDF export needs NO dependency

## Video metadata / ISO base media format (verified 2026-07-19)
- `music-metadata` returns **0 of 85** for bitrate, width, and height on MP4 and MOV, and exposes NO display-dimension or rotation field for ISO base media format at all; it DOES deliver video codec, audio codec, duration, and creation date. It types every ISO-BMFF track as audio, so video must be classified by fourcc, and it wraps raw `stsd` fourccs in angle brackets. `parseFile` does NOT throw on unrecognized bytes — it resolves an empty shell, so honest failure needs an emptiness check — empirically verified 2026-07-19
- `mp4box.js` (npm `mp4box` 2.4.1): **BSD-3-Clause**, ~2–3 MB, pure JavaScript, zero non-permissive deps, runs in Node, streams incrementally, returns bitrate + encoded dims + `track_width`/`track_height` + the tkhd matrix. The **desktop GPAC MP4Box CLI is LGPL v2.1** — same project, different licence, opposite of the ffprobe trap. Evaluated and NOT used; we wrote our own parser — verified at the repository LICENSE + npm registry 2026-07-19
- `mediainfo.js` / MediaInfoLib: **BSD-2-Clause including the compiled WASM binary** (~4.2 MB). MediaInfo carried GPL/LGPL terms historically; BSD-2-Clause is current — verified at the MediaArea licence page 2026-07-19
- Blocked for shipping, verified at source 2026-07-19: Bento4 `mp4info` (GPLv2-or-commercial) · GPAC MP4Box CLI (LGPL v2.1, ~72 MB) · AtomicParsley (GPL-2.0+, and tag-only — no geometry) · `mp4v2` (**MPL 1.1**, not 2.0) · exiftool (dual Artistic-1.0-Perl / GPL-1.0+). MediaInfo CLI (BSD-2-Clause, ~3.7 MB zip) is the only permissively-licensed full CLI
- `pymp4` is **Apache-2.0** — legally safe to READ AND PORT into proprietary TypeScript. `hachoir` and `mutagen` are GPL — not safe to port from. PyAV is a BSD wrapper over LGPL/GPL FFmpeg binaries — same trap as ffprobe
- PyInstaller bundles trigger documented Windows Defender false positives (`Trojan:Win32/Wacatac.B!ml`), worst with `--onefile` temp-extraction — a shipped Python sidecar is an antivirus liability, not only a size one — PyInstaller issues #5854/#5848 — 2026-07-19
- Windows Property System exposes `System.Video.FrameWidth`/`FrameHeight`/`EncodingBitrate`/`Orientation` and is reachable with NO native module via PowerShell `Shell.Application.GetDetailsOf`, BUT extraction is codec-handler dependent and regressed after Windows 10 1803/1809 — frequently blank for HEVC, MOV, and ProRes; `GetDetailsOf` indices are not fixed across Windows versions — 2026-07-19
- ISO base media format: a box size field of **1** means a 64-bit `largesize` follows the type; **0** means the box runs to end of file; `stco` becomes `co64` past 4 GB. `tkhd` width/height are **16.16 fixed point** (divide by 65536) and post-transform; `stsd` carries encoded pixels. `mdhd`/`tkhd` version 1 widens timestamps and duration to 64 bits. QuickTime **sound** sample description v1/v2 shift child-atom offsets — reading only `vide` tracks sidesteps it entirely — ISO/IEC 14496-12, applied and proven 2026-07-19

- On a real 2-terabyte development drive, **7,267 of 7,303 folders are file-modification-time dominant and only 36 are EXIF-dominant** — an unlabelled "capture range" is therefore mostly reporting when a file was last written, not when a photograph was taken — live database query 2026-07-19
- `captured_at` carries a real time in 100% of populated rows (0 of 72,820 are midnight-exactly), but 55,810 of 72,820 come from file modification time and only 17,010 from EXIF — live database query 2026-07-19
- SQLite `CURRENT_TIMESTAMP` stores `YYYY-MM-DD HH:MM:SS` in UTC with **no zone marker**, so JavaScript parses it as LOCAL unless a `Z` is appended first. `toISOString()` stores the `Z` form. Mixing the two without normalizing renders the wrong day and time — verified and fixed 2026-07-20
- `--mc-orange` (#ff9100) as TITLE TEXT measures **2.26:1 on the light-theme panel and fails WCAG AA**; as a border accent and as a button background with dark text it holds 8.23:1 in all three themes — computed 2026-07-20

## Windows security behaviour (observed 2026-07-18)
- SmartScreen "Check apps and files" was **OFF by default** on two Windows 11 machines including a fresh Pro install — Jason, direct observation. Published guides claim ON by default; the observation overrides them. Lowers the practical value of a code-signing certificate
- Locally built executables carry no Mark-of-the-Web (`Zone.Identifier`); browser-downloaded copies do. SmartScreen keys off that stream

## Identifiers
- Federal EIN: 83-0908048
- Texas Comptroller taxpayer ID: 32007386447
- Focal Registry update feed: `https://updates.focalregistry.com/prerelease` — nginx:alpine on Coolify, bind mount `/data/focal-updates`, Traefik SSL, Cloudflare AAAA DNS-only → 2a01:4f8:110:52f0::2 — verified 200 with valid cert 2026-07-18
- avert-core-01 VPS: IPv4 178.63.17.184 / IPv6 2a01:4f8:110:52f0::2; Ubuntu 24.04.4 LTS; disk 8.1% of 905GB used; SSH key `id_ed25519_hetzner`, workstation alias `avert-core-01` — 2026-07-18

## Adobe assets and paths — verified 2026-07-25 (Adobe documentation + Adobe community)
- **`.abd` is NOT a Photoshop format** — it maps to unrelated programs. The Photoshop brush format is **`.abr`**. Recorded because `.abd` was carried in error for several sessions.
- Photoshop asset extensions: brushes `.abr` - actions `.atn` - layer styles `.asl` - gradients `.grd` - patterns `.pat` - swatches `.aco` - custom shapes `.csh` - colour books `.acb`.
- Photoshop plugin extensions: filters `.8bf` - import `.8ba` - export `.8be` - file format `.8bi` - automation `.8li`/`.8ly`. Scripts `.jsx`, compiled `.jsxbin`.
- **User presets:** `C:\Users\<user>\AppData\Roaming\Adobe\Adobe Photoshop <version>\Presets\` with a subfolder per preset type. **Shipped presets:** `C:\Program Files\Adobe\Adobe Photoshop <version>\Presets`. **Settings:** `...\Adobe Photoshop <version> Settings\`.
- **THE CRITICAL FINDING:** brushes and actions a user merely LOADED are **not saved as `.abr`/`.atn` files** unless explicitly exported through the Preset Manager — they live inside `Brushes.psp` and `Actions Palette.psp`. A tool hunting only for loose preset files can return EMPTY on a machine holding hundreds of brushes. Adobe's own supported migration is to copy the whole Settings folder. Copy `.psp` files whole; never parse them.
- Photoshop does **not** carry presets forward across version upgrades.
- Adobe script files declare their host application with a `#target <app>` directive — machine-readable, and therefore the reliable way to route a script to the right application. Scripts also declare their dialogs in source (`Window`, `panel`, `listbox`, `radiobutton`), so an interface can be DRAWN without executing anything.
- Fonts: per-user install to `%LOCALAPPDATA%\Microsoft\Windows\Fonts` registered under `HKCU`, **no administrator rights** (Windows 10 and later); all-users install to `C:\Windows\Fonts` registered under `HKLM`, **requires administrator**. Re-verify at build time.
- Windows appends `_0` to a re-downloaded file of the same name — a common source of apparent duplicate fonts.

## Platform and tooling facts — verified 2026-07-25/26
- **Semantic Versioning is three parts** — major.minor.patch. Four-segment versions like `0.2.2.1` are outside the specification and break `electron-updater` comparison. Microsoft's `10.0.28000.2526` style is Windows BUILD numbering, a different standard.
- **`electron-updater` does NOT support the `portable` target** — auto-update requires the installer; portable builds have no update path. Verify before relying on it.
- **A native OS dialog (`showMessageBox`) cannot be themed or extended** — no formatted release notes, no scroll region, no disclosure, no link, no progress bar. Any styled update window is a custom `BrowserWindow`. The Cloudflare One Client dialog is likewise a custom window.
- **The main process has no CORS restriction** — fetching a remote file MAIN-side removes any need for an `Access-Control-Allow-Origin` header on the server. CORS is a browser read-permission rule, not a server defence; it exposes nothing a public URL did not already expose.
- **An Electron application's source is readable by anyone holding the installer** — never embed a secret, key, or token in a shipped build.
- `signtool.exe` lines in an electron-builder log do NOT mean a build was signed — electron-builder ships its own copy and signs only when a certificate is configured. Confirm via Properties -> Digital Signatures.
- Chromium cannot decode camera RAW (CRW, CR2, CR3, NEF, ARW). It renders jpeg, png, webp, and h264 video. RAW files carry an **embedded jpeg preview** written by the camera — that is how a RAW is shown without pixel decode.
- **`exifr` reads EXIF, NOT previews.** It parses from a header window while a RAW's preview sits megabytes in, and it **throws** rather than returning null — CR2 threw with the file's own `ThumbnailLength` in the message. It **cannot read CR3 at all** ("Unknown file format"): CR3 is an ISO Base Media container (MP4/MOV box structure), not TIFF. Previews come from Focal Registry's own resolver — 2026-08-18
- **A RAW preview must be gated on the jpeg SOF marker, never on `FF D8 FF`.** The largest `FF D8 FF` block inside a CR2 is ~30 MB of lossless-jpeg SENSOR data no browser can draw; taking it looks like success and caches garbage — 2026-08-18
- **CR3 layout, measured on three files:** `THMB` box = 160x120 thumbnail; `PRVW` box = 1620x1080 preview sitting behind an **8-byte preamble `THMB` does not have**. `mdat` opens with a genuine 8192x5464 jpeg whose length no box header declares — reading "to the end of the box" returns 55 MB. Walk only named boxes; **validity checks do not prove correctness — verify pixel dimensions** — 2026-08-18
- **Measured RAW preview extraction (Jason's D: drive, 2026-08-18):** CR3 262 of 262 at 1620x1080, zero fallbacks, ~1% of each 53 MB file read, 1.3 ms per file. CR2 415 files, previews at 6000x4000, no regression
- Windows exposes a per-installation identifier (`MachineGuid`, registry) and a hardware UUID. Neither is broadcast or remotely queryable; the "FBI tracks this number" framing is INCORRECT. Verify the exact key at build time.
- Database substring search: an indexed `LIKE` with wildcards is faster to query and cheaper to write than regular expressions, which force a full table scan and a custom function.
- Scan measured ~2 million files in roughly 90 seconds on Jason's hardware — metadata extraction is NOT the bottleneck assumption previously held.

## Focal Registry media pipeline — measured 2026-08-17/18
- **`index.html` has no `media-src`** — media falls back to `default-src 'self'`, so `file:`, `blob:` and `data:` are all blocked for `<video>`. The single sanctioned exception is **`media-src frmedia:`**, added 2026-08-18 by Jason's ruling. Do not loosen anything else.
- **`frmedia` is a privileged custom scheme** (`standard`, `secure`, `stream`, `supportFetchAPI`, `corsEnabled`), registered before `app.ready`, one caller only. `isUnderScannedRoot` runs on EVERY request before any file is opened.
- **In CORS mode Chromium hides response headers from the media element unless exposed**, and a response WITHOUT `Access-Control-Allow-Origin` becomes a generic network error — a `guardPath` 403 then reads as a CORS failure. Every response path must carry the header.
- **`ACAO: *` passes for a `file://` opaque origin** — Chromium's wildcard branch never consults the request origin when credentials mode is not `include`. Echoing the literal `null` would fail; mapping it to `*` is correct.
- **A bounded answer to an open-ended range does not degrade, it DEADLOCKS.** Given a truncated `bytes=0-`, the player re-requests `bytes=0-` rather than reading the tail, so a trailing `moov` is never reached. **No size ceiling can ever be correct here** — the 64 -> 4 -> 64 MB oscillation was three attempts to find the right value for a number that must not exist. Open-ended ranges stream the whole remainder in 4 MB chunks; peak resident memory is ~24 MB at concurrency 6 and does not scale with file size.
- **A painted `<video>` thumbnail holds a decoded frame at NATIVE resolution** — ~3 MB at 1080p, ~12 MB at 4K. A cached jpeg thumbnail is 10-20 KB. This is why thumbnails are captured to disk and the decoder torn down.
- **Thumbnail cache** — content-addressed jpegs at `Documents\Focal Registry\Scan Notes\.thumbs\`, keyed on absolute path + size + mtime, 500 MB ceiling with least-recently-used sweep, hidden via `attrib.exe`. Built with the hand-built home path; **never `app.getPath("documents")`** (OneDrive redirect).
- **`Ctrl+Shift+I` is NOT built into an Electron window** — it comes from the default application menu. An app with no menu has no shortcut. Focal Registry owns it via `before-input-event` (`electron/core/devtools.ts`); a future View menu item must carry NO accelerator or the two fire together and toggle twice.

## Media pipeline — measured 2026-08-18/19
- **`nativeImage` does NOT exist inside a `utilityProcess`** — the child sees only `net` and `systemPreferences`. A utility process cannot make thumbnails — 2026-08-18
- **`nativeImage` IGNORES the EXIF orientation tag.** A hand-written transform table shipped with entries 6 and 8 swapped and rendered a whole shoot upside down; both are axis-swap transforms, so the output was the right SHAPE and the wrong way up — a 90° error presenting as 180° — 2026-08-18
- **`createImageBitmap(blob, { imageOrientation: "from-image" })` applies EXIF in the DECODER** — rotation is never expressed as a table, so that bug class is unrepresentable on that path. Eight-orientation `ABCD/EFGH` fixture: 8/8 — 2026-08-18
- **A hidden `BrowserWindow` IS throttled while the app is minimised** — timers 213/s → 69/s, work ~168 ms → ~229 ms per file (~36% slower). **`backgroundThrottling: false` makes NO measurable difference** on this Electron; tested twice with the flag as the only variable. Work slows, it does not stop — 2026-08-18
- **The worker is NOT faster per file at concurrency 1** — 149 ms against the main process's 141. **The win is parallelism**: 80.9 ms/file at 4 in flight (~1.75×), off the thread that owns every window. Knee at 3; 3→4 buys 15%, 4→6 buys 16% for 50% more contention — 2026-08-18
- **A thumbnail cache key must carry a GENERATION.** Keyed on (path, size, mtime) it is correct for "the file changed" and useless for "our generator changed" — every wrong thumbnail keeps serving as a valid hit after the code is fixed — 2026-08-18
- **`_` is a single-character WILDCARD in SQL `LIKE`, and camera stems are `IMG_0541`** — `LIKE 'folder\stem.%'` silently matches `IMGX0541.jpg`, a different photograph. One query per folder plus exact string equality has neither that problem nor the `ESCAPE`-versus-backslash collision — 2026-08-19
- **Measured, one call vs batched at 500** (1,896 cached thumbnails): main-process block **926 ms → 154 ms** worst, reply **27.2 MB → 7.2 MB**, and batching is faster outright (574 ms vs 926 ms) — no single call has to build a 27 MB string — 2026-08-19
- **Virtualized grid: ~415 elements → ~40–60** on a 415-row folder, computed from real stylesheet values. Windowing arithmetic **fails open** — any measurement it cannot use renders the whole list, because heavy is a performance problem and short is a correctness one — 2026-08-19

## Third-party projects reviewed — fetched 2026-07-22/25
- **Graphify** (`Graphify-Labs/graphify`) — MIT, **Python** command-line tool and agent skill. Outputs `graph.html`, `GRAPH_REPORT.md`, `graph.json`. Parses code locally with tree-sitter (no model); documents and images use a model pass. Has an MCP server plus `--obsidian` and `--wiki` flags and first-class Antigravity install. **CANNOT ship inside Focal Registry** — canon bans a Python runtime in the installer. Use it externally; the app reads its `graph.json`.
- **Binderus** (`binderus/binderus`) — MIT, TypeScript, ~9 MB, local-first, WYSIWYG, wikilinks, and a plaintext-files-OR-encrypted-store split mirroring the MindMerge/Vault tier design. No published releases on the repository; whether `app/` holds real source or compiled output is UNVERIFIED. Design reference until a clone proves otherwise.
- **MindsHub Cowork** (`mindsdb/mindshub`) — MIT, 39.5k stars, Python backend with an Electron desktop app, hosted console plus paid tier. Independently ships **agent-scoped credentials where agents never see raw keys** (matches Vault V-22) and **Hermes** as a swappable agent harness (matches the locked Jarvis runtime). Corroborates the architecture; different market.
