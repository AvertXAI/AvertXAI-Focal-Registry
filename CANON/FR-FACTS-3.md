# FR-FACTS-3.md — Focal Registry verified facts

One line each: value — source — verified-on. Re-verify if stale.
*(Derived 2026-07-31. Facts unrelated to this repo were dropped. Supersedes FR-FACTS-2 — delete it after upload.)*

## This repo
- Repo: `D:\dev\AvertXAI-Focal-Registry` · remote `git@github.com:AvertXAI/AvertXAI-Focal-Registry.git`
- Docs: `D:\dev\_source\AvertXAI-Focal-Registry\` · reference scripts in `reference\` · session reports in `reports\`
- Real canon: `D:\dev\_source\AvertXAI-CANON\CANON PROJECT\` — now five files plus `CANON-2` index
- **Last PUSHED commit is `d10060d`** (2026-07-28). Branch `main` sits **14 commits ahead, unpushed** — the whole TimeTracker port is local-only
- Real canon is now `CANON-2` · `DECISIONS-50` · `RULES-39` · `STATUS-36` · `PROJECTS-9` · `FACTS-10`
- **Version 0.2.5**; `productName` **"Focal Registry"**; npm `name` `avertxai-focal-registry`; `appId` `com.avertxai.focalregistry`; `description` "Photography Archive Tools"
- `artifactName` **`Focal-Registry-Setup-${version}.${ext}`** — hyphenated on purpose; spaces in artifact filenames break update-feed URLs and shell commands. `scripts/release.mjs:15` pin moves in lockstep
- **Packaged process is `Focal Registry.exe`** — kill it AND `electron.exe` before any device gate; both share the single-instance lock and a stale window fakes false results
- Windows `CompanyName` derives from `author`; `FileDescription` derives from `productName`, NOT from `description`
- `userData` derives from `productName` → `%APPDATA%\Focal Registry` (Roaming, not Local)

## Update feed
- `https://updates.focalregistry.com/prerelease` — nginx:alpine on Coolify at avert-core-01, bind mount `/data/focal-updates`, Traefik SSL, Cloudflare **AAAA, DNS-only** → `2a01:4f8:110:52f0::2`
- Feed file is `prerelease.yml` — electron-builder names update-info `<channel>.yml`; the hyphenated `latest-mac.yml` form is per-OS, not per-channel
- Manifest must never be cached; installers cached 30 days immutable. **nginx serves `.md` with no cache header** — `REVISIONS.md` needs adding to the no-cache block
- **Upload order: payload (.exe + .blockmap) BEFORE manifest (.yml).** The manifest is the trigger
- `electron-updater` does NOT support the portable target; a themed update window must be a custom `BrowserWindow`
- SSH host alias `avert-core-01` → IPv6 + `id_ed25519_hetzner`; server prompt is red-backgrounded to prevent wrong-window pastes

## Dependencies in this repo
- `argon2` · `better-sqlite3-multiple-ciphers@^12.11.1` — native, `--external` in esbuild, rebuilt by `postinstall`
- `exifr@7.1.3` — MIT, zero deps, 1.5 MB, pure JS, header-only reads
- `gray-matter` — the sole runbook YAML parser
- `electron-updater` — production dependency, ships inside the app
- `music-metadata@11.14.0` — **MIT**, 14-package tree (13 MIT + `ieee754` BSD-3-Clause), **0.96 MB unpacked**, zero native deps
- `@ffprobe-installer/ffprobe` — **REJECTED** (wrapper LGPL-2.1, binary GPLv3, 78 MB)
- `ffprobe-static` — rejected, 336 MB, vendors every platform's binary
- `@fluentui/react-icons` — **BANNED**, 172 MB installed. Icons are hand-rolled outline SVGs
- `recharts` — **not used**, 8.2 MB. Charts are hand-rolled SVG
- `papaparse` — **not used**. CSV deferred
- `tailwindcss` — **BANNED**, not the stack
- `node_modules` ≈ 549 MB, of which electron alone is 349 MB

## Platform
- **Electron 41.9.2** · React 19 · Vite · TypeScript · esbuild → `dist-electron/*.cjs`
- Shell floor `MIN_WIDTH=740 / MIN_HEIGHT=640` — do NOT restore 960
- Rail expanded `--mc-flyout-width: 300px` (drag-clamped ≤300), collapsed **58px**; topbar 58px; native strip 36px; topbar `padding-right: 150px`
- One container threshold `@container (min-width: 900px)` — breadcrumb prefix and search flip together
- Hybrid theme tokens: `--mc-base` `#0d1320` · `--mc-panels` `#121a2e` · `--mc-nested` `#182238` · `--mc-border` `#233149` · `--mc-text` `#e8edf7` · `--mc-muted` `#8b9bb4` · `--mc-accent-primary` `#4f8df0` · `--mc-orange` `#ff9100` · boot `#0b0e16`
- Boot dark `#0b0e16` is duplicated in four places synced by comment only — **has regressed twice**
- `applyOverlayNow()` in `electron/core/windows.ts` is the ONLY writer of overlay and background colour. A second writer is a hard don't
- `electron-builder` 26.x: publisher name lives at **`win.signtoolOptions.publisherName`**, NOT `win.publisherName`
- Packs with `asar: true` and explicit `files` / `asarUnpack` lists — bundled assets must be listed or read from a path that survives asar
- `ELECTRON_RUN_AS_NODE=1` is inherited from a VS Code process tree and breaks Electron launch — clear it or launch from a normal terminal
- **Never `npm run dev:clean`** — it deletes `platform_registry.db`
- **`index.html` has NO `media-src` in its Content Security Policy** — media falls back to `default-src 'self'`, so blob URLs are blocked and `<audio>` src assignment fails silently into a swallowed promise. Alert sounds decode IPC bytes through WebAudio instead; **do not loosen the CSP to "fix" this**
- **`.view.shown{display:block}` in `globals.css` (0,2,0) outranks a module shell's `display:flex` (0,1,0)** — a module needing flex must use a three-class rule. This stacked TimeTracker's rail above its content and `tsc` cannot see it
- The mini timer window is `mini-window.ts` + `mini-preload.cjs` + `dist/mini.html`, built by its own vite entry with a `?theme=` handshake; frame colours are constructor-only via `baseFor()` so `applyOverlayNow()` stays the single runtime writer

## Adobe assets — for Migrate
- User presets: `AppData\Roaming\Adobe\Adobe Photoshop <version>\Presets\`. Shipped presets: under `Program Files`. Settings in the `Settings` folder
- Extensions: `.abr` brushes · `.atn` actions · `.asl` styles · `.grd` gradients · `.pat` patterns · `.aco` swatches · `.csh` shapes · `.acb` colour books · `.8bf`/`.8ba`/`.8be`/`.8bi`/`.8li`/`.8ly` plugins · `.jsx`/`.jsxbin` scripts
- **Brushes and actions a user merely LOADED are not `.abr` or `.atn` files** — they live inside `Brushes.psp` and `Actions Palette.psp`. **Copy those whole; never parse them.** This is why every competing tool returns empty for a user with hundreds of loaded brushes
- Photoshop does **not** carry presets forward across version upgrades
- Compiled `.8*` plugins are built against a specific Photoshop SDK and break across major versions. A migration tool can inventory, flag, and preserve the reinstall path — it cannot make an old binary work

## External
- SmartScreen "Check apps and files" observed **OFF by default** on two Windows 11 machines. Lowers the practical value of a code-signing certificate
- Locally built executables carry no Mark-of-the-Web; downloaded copies do
- GitHub Free for organizations: unlimited private repos, unlimited collaborators. One org, all repos private
- electron-builder's **generic** provider does NOT upload; every other provider does
