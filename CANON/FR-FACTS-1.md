# FR-FACTS-1.md — Focal Registry verified facts

One line each: value — source — verified-on. Re-verify if stale.
*(Derived 2026-07-19. Facts unrelated to this repo were dropped.)*

## This repo
- Repo: `D:\dev\AvertXAI-Focal-Registry` · remote `git@github.com:AvertXAI/AvertXAI-Focal-Registry.git` (fetch+push verified) — 2026-07-18
- Docs: `D:\dev\_source\AvertXAI-Focal-Registry\` · reference scripts in `reference\` · session reports in `reports\`
- Real canon: `D:\dev\_source\AvertXAI-CANON\CANON PROJECT\` — 2026-07-19
- Baseline commit `b4b6470`; HEAD `cb5eb9c` as of 2026-07-19; **never pushed**
- Version 0.1.1; `productName` "AvertXAI Focal Registry"; npm `name` `avertxai-focal-registry`; `appId` `com.avertxai.focalregistry`
- `artifactName` `AvertXAI-Focal-Registry-Setup-${version}.${ext}` — hyphenated on purpose; spaces in artifact filenames break update-feed URLs and shell commands
- Windows `CompanyName` derives from `author`; `FileDescription` derives from `productName`, NOT from `description` — verified in the built exe 2026-07-18
- `userData` derives from `productName` → `%APPDATA%\AvertXAI Focal Registry` (Roaming, not Local) — verified on-device 2026-07-18

## Update feed
- `https://updates.focalregistry.com/prerelease` — nginx:alpine on Coolify at avert-core-01, bind mount `/data/focal-updates`, Traefik SSL, Cloudflare **AAAA, DNS-only** → `2a01:4f8:110:52f0::2` — verified 200 with valid cert 2026-07-18
- Feed file is `prerelease.yml` — electron-builder names update-info `<channel>.yml`; the hyphenated `latest-mac.yml` form is per-OS, not per-channel
- Manifest must never be cached; installers cached 30 days immutable — nginx config verified in response headers
- **Upload order: payload (.exe + .blockmap) BEFORE manifest (.yml).** The manifest is the trigger
- Full update loop proven end-to-end on a clean 0.1.0 install: available → download → restart → relaunched — 2026-07-18
- SSH host alias `avert-core-01` → IPv6 + `id_ed25519_hetzner`; server prompt is red-backgrounded to prevent wrong-window pastes

## Dependencies in this repo
- `argon2` · `better-sqlite3-multiple-ciphers` — native, `--external` in esbuild, rebuilt by `postinstall`
- `exifr@7.1.3` — MIT, zero deps, 1.5 MB, pure JS, header-only reads — verified 2026-07-18
- `gray-matter` — Secure Note's only exclusive dependency
- `electron-updater` — production dependency, ships inside the app
- `music-metadata@11.14.0` — **MIT**, 14-package tree (13 MIT + `ieee754` BSD-3-Clause), **0.96 MB unpacked**, zero native deps — verified at the repository 2026-07-19. **Approved, not yet installed**
- `@ffprobe-installer/ffprobe` — **REJECTED** (wrapper LGPL-2.1, binary GPLv3, 78 MB). Present pending removal
- `ffprobe-static` — rejected, 336 MB, vendors every platform's binary
- `node_modules` ≈ 549 MB, of which electron alone is 349 MB

## Platform
- Electron 41.x · React 19 · Vite · TypeScript · esbuild → `dist-electron/*.cjs`
- Shell floor `MIN_WIDTH=740 / MIN_HEIGHT=640` — Jason-confirmed 2026-07-18, do NOT restore 960
- Rail expanded `--mc-flyout-width: 300px` (drag-clamped ≤300), collapsed **58px**; topbar 58px; native strip 36px; topbar `padding-right: 150px`
- One container threshold `@container (min-width: 900px)` — breadcrumb prefix and search flip together
- `electron-builder` 26.x: publisher name lives at **`win.signtoolOptions.publisherName`**, NOT `win.publisherName` — the latter fails schema validation (`additionalProperties: false`)
- Packaged process is **`AvertXAI Focal Registry.exe`**, not `electron.exe` — both must be killed before any device gate
- `ELECTRON_RUN_AS_NODE=1` is inherited from a VS Code process tree and breaks Electron launch — clear it or launch from a normal terminal

## External
- SmartScreen "Check apps and files" observed **OFF by default** on two Windows 11 machines including a fresh Pro install — Jason, 2026-07-18. Lowers the practical value of a code-signing certificate
- Locally built executables carry no Mark-of-the-Web (`Zone.Identifier`); downloaded copies do
- GitHub Free for organizations: unlimited private repos, unlimited collaborators — verified 2026-07-18. One org, all repos private
- electron-builder's **generic** provider does NOT upload; every other provider does
