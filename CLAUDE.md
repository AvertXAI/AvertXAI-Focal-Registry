# CLAUDE.md — AvertXAI Focal Registry

**Repo:** `D:\dev\AvertXAI-Focal-Registry`
**Product:** Focal Registry — photography archive tooling for professionals
**Built by:** copy-then-gut of the AvertXAI Mission Control Electron shell (`D:\dev\AvertXAI-RUNBOOKS`)
**Project documents:** `D:\dev\_source\AvertXAI-Focal-Registry\`
**Canon:** `D:\dev\_source\AvertXAI-CANON\`

This file is standing law for every agent working in this repo. Read it fully before your first action in any session. If any prompt, other document, or your own training conflicts with this file — **stop and ask.**

---

## PART 0 — FIRST ACTIONS, EVERY SESSION, BEFORE READING THE TASK

**Do this before you read what you have been asked to do.** It is not conditional on the prompt mentioning it. A prompt that forgets to say "read canon" does not excuse skipping canon.

### 0.1 The order

1. **Read `PROJECT-CANON.md` at this repo root.**
2. **Read `CANON-UPDATES.md` at this repo root** — known discrepancies between canon and this codebase. Do not act on them; know they exist so you do not rediscover them or trip over one.
3. **Then** read the task.

### 0.2 Self-bootstrap — if `PROJECT-CANON.md` is missing or stale, build it FIRST

**Missing** → stop, generate it, report, and only then start the task.
**Stale** → its header records which canon versions it came from. If any file at `D:\dev\_source\AvertXAI-CANON\` now carries a higher version number, it is stale. Regenerate it first.

To generate: read every canon file completely, read this repo, and sort every canon entry into **APPLIES / OUT OF SCOPE / CONTRADICTS / STALE / GAP**. Carry APPLIES forward verbatim with its source citation. Drop OUT OF SCOPE — other products, business administration, infrastructure this repo never touches. Record the other three in the appendix and in `CANON-UPDATES.md`.

**When unsure whether an entry applies, carry it forward.** A rule that turns out to be irrelevant costs a few lines. A rule dropped that later mattered costs a rebuild.

The header must record: generation date, every source canon filename **with its version number**, and the repo's git HEAD. Without that there is no way to tell later whether the file is current.

### 0.3 The rules that keep this safe

- **NEVER modify, edit, move, or delete a canon file.** Canon is read-only to you, permanently. It is versioned and updated by Jason alone.
- **`PROJECT-CANON.md` is GENERATED, never authored.** Do not hand-edit it. Regenerate it.
- **Canon wins.** Where `PROJECT-CANON.md` and real canon disagree, canon is right and this file has a defect — report it, do not act on it.
- **Silence is not permission.** When `PROJECT-CANON.md` says nothing about something, read real canon before concluding no rule exists. It is a filtered view, and a filter can drop something.
- **You record discrepancies. You never resolve them.** Canon governs until Jason rules, even when you are certain canon is wrong.

---

## PART 1 — HOW YOU THINK AND REPORT

### 1.1 Source-confidence labels are mandatory

Every factual claim you make carries one of these labels. No exceptions, no matter how long the response.

| Label | Means |
|---|---|
| **Verified Data** | You read it in this codebase or a canon file this session, and you can cite `file:line` |
| **Real Data** | Externally true and well-established, but you did not verify it against a live source this session |
| **My Speculation** | Your inference, judgment, or guess — clearly your opinion, not fact |
| **Industry Convention** | The common practice, not a rule this project has adopted |
| **Unknown** | You do not know, and you are saying so rather than filling the gap |

A claim with no label is a defect. Fabricating a `file:line` citation is the worst failure mode in this project.

### 1.2 The reasoning sequence

For anything non-trivial, work in this order and show it:

1. **Decompose** — break the request into independently checkable parts
2. **Distinguish** — separate verified facts / inferences / assumptions / unknowns
3. **Solve** — address each part; invent nothing to fill a gap
4. **Verify** — check logical consistency, factual accuracy, whether the answer actually covers the request, and whether an unsupported assumption is doing load-bearing work
5. **Calibrate** — assign a confidence score from 0.0 to 1.0 based on evidence quality, never on how convincing your answer sounds
6. **Retry** — below 0.8, identify your weakest claim, reconsider, revise, or state plainly what information you need

### 1.3 Ambiguities go BEFORE the artifact, never after

If a task has more than one reasonable interpretation, you produce a **numbered list of ambiguities with your lean flagged on each** — and you stop. You do not build the thing and caveat it afterward. A wrong build costs real money and real hours; a question costs thirty seconds.

### 1.4 Report format

Close every substantive response with:

```
Clear Answer:      the most accurate, useful answer you can give
Confidence Level:  0.0–1.0 with a one-line reason
Key Caveats:       assumptions, unknowns, conflicts, things needing verification
```

### 1.5 Write acronyms out

First use of any acronym gets spelled out — Exchangeable Image File Format (EXIF), Inter-Process Communication (IPC), Integrated Development Environment (IDE). Jason often listens to output through text-to-speech, so **spell out units in prose** ("four feet", not `4'`). Symbol form is fine inside code blocks and tables.

---

## PART 2 — HOW YOU WORK

### 2.1 Recon-first is non-negotiable

Before you write, edit, or delete **any** file:

- Run a **read-only** pass over the relevant code
- Quote `file:line` for every structural claim
- Write `NOT FOUND` explicitly where something you expected is absent
- Never assume a class name, a wiring pattern, a table column, or a function signature from memory

If recon contradicts the task premise: **stop and report.** Do not proceed on a premise you have disproved.

### 2.2 Every change report pastes the literal git diff

Not a summary. Not "I updated the file." The actual `git diff` of the touched paths.

**An empty diff means the edit did not happen — say so out loud.** Reports in this project have previously claimed edits that were never in the tree. That is why this rule exists.

### 2.3 Device-gate before commit

Agent-done is not done. Before any commit:

1. Kill **every** running `electron.exe` — the single-instance lock will refocus a stale window running an old bundle and hand you a false result
2. `npm run dev` and verify on-device
3. Verify in **all three theme modes** — a fix that is clean in dark can bleed in hybrid
4. Jason confirms the gate passed
5. Only then commit

### 2.4 Commit discipline

- **Explicit-path staging only.** `git add src/modules/rename/View.tsx` — never `git add -A`
- Never `checkout`, `restore`, or `stash` a file carrying uncommitted work you are not deliberately reverting
- One logical change per commit

### 2.5 Never claim a user interface works from reading markup

Class names looking correct proves nothing. Prove layout claims with the width math at the reachable breakpoints, or with an actual render. If you cannot render, say: *"requires Jason's on-device check at widths X and themes Y."* Do not assert success.

### 2.6 Mockup before code

Any new or reshaped user interface gets a single-file Hypertext Markup Language (HTML) mockup approved **before** a component is scaffolded. No exceptions for "small" changes.

### 2.7 Build it right the first time

No throwaway shortcuts. Do not offer Jason a "fast but disposable" option alongside a "correct" one — just do it correctly. Persisted state goes to the database through the sanctioned path, never to a convenient shortcut.

### 2.8 Stay in your lane

Being assigned a module means you work **inside** `src/modules/<slug>/` only. You do not touch the root, the shell, or another module. Wiring a module into the shell is a **separate, explicitly assigned root-lane task.** Never self-authorize it.

### 2.9 Scope discipline

Task surface equals request surface. A scoped task gets a scoped response. No unsolicited alternatives, no sequencing advice, no adjacent suggestions, no strategic commentary. Jason manages priorities himself.

---

### 2.10 Dependency licence gate — STOP, do not report after the fact

**Before any `npm install`, before any vendored binary, before any new package enters this tree.**

**ALLOWED without asking:** MIT · BSD-2-Clause · BSD-3-Clause · Apache-2.0 · ISC · Unlicense · CC0

**STOP AND ASK, every time, no exceptions:** GPL (any version) · AGPL · LGPL · SSPL · BUSL · PolyForm (any variant) · Elastic · "source-available" · non-commercial · dual-licence · unlicensed · licence you cannot determine

When a licence is not on the allowed list:

1. **Do not install it.** Not to measure it, not to test it, not "just to see."
2. Report: what it is, its exact licence, why it was chosen, and **at least two alternatives with permissive licences** — including the option of writing it ourselves and roughly what that costs in lines and days.
3. Wait for Jason's ruling.

**"Industry standard" is not a licence. "It's what everyone uses" is not a licence.** The reflexive answer for a problem is usually the popular package, and the popular package is often the one with the licence problem. Look past the reflex before reaching for it.

**This applies to binaries the app ships, not only to code it links.** A GPL executable inside the installer creates distribution obligations even when it runs as a separate process.

**Read canon before any dependency decision.** `D:\dev\_source\AvertXAI-CANON` holds the standing rule that this project is commercially clean from day one. A copyleft dependency that reaches a build is a failure of process, not of judgement — and it costs a full phase to undo.

---

### 2.11 Weigh size before you install

Report the installed size of any new package **before** committing to it. One package was 173 megabytes of dead cargo in a prior project; another vendored every platform's binary at 336 megabytes when a per-platform variant existed.

**If a package exceeds 20 megabytes, stop and report it** with the reason it is needed and a lighter alternative if one exists.

---

### 2.12 CANON-UPDATES.md — report discrepancies, never self-authorize

Canon is written from conversation. **You are the one touching the code**, so you see ground truth that canon may not reflect. When those disagree, that information must not die inside a session report.

**Append to `CANON-UPDATES.md` at the repo root whenever you find any of:**

| Tag | Meaning |
|---|---|
| `CONTRADICTS` | Canon states something the code disproves |
| `STALE` | Canon references a file, tool, version, or product that no longer exists |
| `GAP` | Canon is silent on something a builder needs to know |
| `BETTER` | Research surfaced an approach superior to what canon specifies |
| `REDUNDANT` | The same rule appears in more than one place, or at more length than it needs |

**Entry format — append only, never edit or reorder existing entries:**

```
## [TAG] YYYY-MM-DD — one-line summary
**Canon says:** quote it, with the file name and version
**Reality:** what is actually true, with file:line receipts
**Evidence:** the command, grep, or source that proves it
**Suggestion:** what the canon entry should say instead
**Severity:** blocking / worth-fixing / cosmetic
```

**THREE RULES, and they matter more than the format:**

1. **You record. You do not act.** Never change behaviour to match a discrepancy you found. Canon governs until Jason rules otherwise, even when you are confident canon is wrong.
2. **Never edit a canon file.** Not one line, not a typo. Canon is versioned and updated by Jason.
3. **Every entry needs a receipt.** `file:line`, a command and its output, or a cited source. A discrepancy without evidence is an opinion and does not belong in this file.

Mention new entries in your session report so they are not missed. **This file is a second pair of eyes on canon, and it exists because neither Jason nor Claude catches everything.**

---

## PART 3 — WHAT THIS APPLICATION IS

### 3.1 Stack

- **Electron + Vite + React + TypeScript.** Not Next.js. Not Tailwind. Not CSS modules.
- Renderer builds via `vite build`; the main process bundles via `esbuild` to `dist-electron/*.cjs`
- Styling is **plain CSS custom properties in `src/globals.css`** — plain class names, not utility classes
- Database is **`better-sqlite3-multiple-ciphers`** (SQLCipher-capable), `argon2` for key derivation
- Native dependencies stay `--external` in the esbuild command — do not bundle them
- **No Python.** Rename and Scan logic is ported to Node. Metadata reading via a Node EXIF library — no second runtime, no sidecar process, no PyInstaller
- Keep the dependency tree lean. `pg` and `uuid` do not belong here. Weigh the size cost before adding any icon or user-interface mega-package — see §2.10 and §2.11
- **Permissive licences only.** MIT, BSD, Apache-2.0, ISC. No GPL, AGPL, LGPL, PolyForm, SSPL, BUSL, or source-available dependency enters this product — as code OR as a shipped binary. See §2.10.
- **Markdown editor: Tiptap** (MIT core) with a Markdown serializer, for **authored** notes only. Generated artifacts such as scan reports stay read-only through the existing renderer — never round-tripped through an editor. Tiptap Pro extensions are paid; stay on core and open extensions.

### 3.2 The Mission Control shell is preserved — explicitly

This application **is** the Mission Control shell, rebranded. Do not restructure it. Do not "improve" its architecture. Do not flatten its folders. The shell's structure, boot sequence, nav model, theming system, and persistence path are all **carried over intact**.

**Token namespace:**
- Shell-level tokens stay `--mc-*` (Mission Control). Do not rename them.
- Module-level tokens use `<module-slug>-*` — e.g. `--rename-*`, `--scan-*`, `--shredder-*`, `--vault-*`
- Role names are **spelled out in full**: `background`, `foreground`, `base`, `border`. Never `bg`, never `fg`, never abbreviations
- One source of truth per `globals.css`. No hardcoded color anywhere a token exists. No bare unprefixed token shared across scopes

### 3.3 Theming — three modes, all mandatory

Three themes via a `data-theme` attribute on `<html>`. Set pre-root from a `?theme=` parameter in `src/main.tsx`, then at runtime in `src/App.tsx`. `system` clears the attribute, falling through to the `:root` Hybrid block.

**All tokens live in `src/globals.css`.** *(Verified Data — recon 2026-07-18.)*

| Token | Hybrid | Dark | Light | Paints |
|---|---|---|---|---|
| `--mc-base` | `#0d1320` | `#1f1f1f` | `#FAFAFA` | window and page base; `html`/`body`/`#root` |
| `--mc-panels` | `#121a2e` | `#2c2c2a` | `#FFFFFF` | cards, modals, sticky table headers |
| `--mc-nested` | `#182238` | `#2c2a26` | `#F5F5F5` | inner surfaces, buttons, hovers, logs |
| `--mc-border` | `#233149` | `#61615b` | `#E5E5E5` | all borders |
| `--mc-text` | `#e8edf7` | `#E5E5E5` | `#1A1A1A` | body text |
| `--mc-muted` | `#8b9bb4` | `#A0A0A0` | `#737373` | secondary text |
| `--mc-accent-primary` | `#4f8df0` | `#d97757` | `#d97757` | links, primary button, spark |
| `--mc-orange` | `#ff9100` | `#ff9100` | `#ff9100` | not-built glow — **suppressed in this product, see §3.6** |
| `--mc-topbar` | `#0d1320` | `#262626` | `#FFFFFF` | header background |
| `--mc-sidebar` | `#121a2e` | `#262626` | `#FFFFFF` | nav rail |
| `--mc-field` | `#0d1320` | `#424240` | `#FFFFFF` | inputs |
| `--mc-avatar` | `#4f8df0` | `#313131` | `#E6E6E6` | avatar chips |
| `--mc-dimmer` | `#5b6b88` | `#71716B` | `#A3A3A2` | placeholders |
| `--mc-toggle-on` | `#4f8df0` | `#4f8df0` | `#4f8df0` | toggle on-state (fixed blue, all modes) |
| `--mc-seg-on-background` | `#303539` | `#303539` | `#DCE8F5` | selected segment chip |
| `--mc-seg-on-icon` | `#4773a6` | `#4773a6` | `#4773a6` | selected segment glyph |
| `--mc-scrollbar-thumb` | `#2c3a58` | `#7c7b75` | `#B1B1B0` | scrollbars |

**Single-value tokens** (declared once at `:root`, inherited unchanged into dark and light by design):
`--mc-flyout-width: 300px` · `--mc-boot-bg: #0b0e16` · `--mc-underline: var(--mc-accent-primary)` · `--mc-green: #16a34a` · `--mc-radius: 6px` · `--mc-font` · `--mc-mono`

**Module-scoped tokens.** Every module owns a distinct full-word prefix. Shredder's live on `.rbs-shell`, not `:root` — `--shredder-highlighter-background: #ffe14d`, `--shredder-highlighter-foreground: #1a1500`. Rename, Scan, and Vault declare their own as needed.

**Paint-surface law:** the active theme background must be set on **`html`, `body`, AND `#root`.** An unpainted ancestor rasterizes white on resize.

**Window background tracks the theme.** The single overlay funnel is `applyOverlayNow()` at `electron/core/windows.ts`. It is the **only** runtime writer of `setTitleBarOverlay` and of the window's `setBackgroundColor` — the sole other call is the constructor's initial value. **Never add a second writer.** New color states become a *mode the funnel resolves*.

**Boot frame invariant (has regressed twice):** the boot dark is `#0b0e16` and currently lives in **four** places — the `--mc-boot-bg` token, a raw hex in `.bootterm`, `OVERLAYS.boot`, and `BASE_BG.boot` — synchronized by comment only. During boot and the first-run wizard the frame is this color in every theme. The real theme applies **only** on the `boot:done` inter-process communication message. **Improvement sanctioned for this repo:** collapse the four copies to one source of truth during the gut.

### 3.4 Layout and breakpoints

- **Window floor is `MIN_WIDTH = 740`, `MIN_HEIGHT = 640`**, one shared constant in `electron/core/windows.ts`. This is Jason-approved so the shell docks at half-screen (960 CSS pixels) with slack. **DO NOT restore 960.** Mobile-first and 375-pixel rules **do not apply** — this shell can never render below 740. Do not add a breakpoint that cannot fire. *(Verified Data — canon DECISIONS-42.)*
- Display profile: 1920 by 1080 at 100 percent scale, device pixel ratio 1. Half-screen is therefore 960 CSS pixels.
- **Topbar is ONE row at every width** — never two stacked bars. It is a container-query container (`container-type: inline-size`). Header height is a constant of roughly 58 pixels; do not reintroduce a variable-height header. Below the **single** `@container (min-width: 900px)` threshold, the breadcrumb prefix (`{org} · {workspace} /`) hides — leaving `{module} 🔒` — and the search field collapses to the magnifier icon. **Both flip at the same threshold.** *(Verified Data — canon DECISIONS-42.)*
- **Nav rail:** expanded is `--mc-flyout-width: 300px` (runtime-draggable, clamped to 300 maximum); collapsed is **58 pixels** (`body.rail-collapsed { padding-left: 58px }` and `.flyout.collapsed { width: 58px }`). Body offset is `padding-left: var(--mc-flyout-width, 300px)`. Collapse state persists to `app_settings`, key `rail_collapsed`. *(Verified Data — recon 2026-07-18.)*
- **Topbar height is 58 pixels but is NOT a constant.** It exists as three duplicated `calc(100vh - 58px)` literals across `globals.css`, `runbook-shredder.css`, and `scout-viewer.css`. This drift has already caused a problem once. **Sanctioned improvement for this repo:** promote it to a single `--mc-topbar-height` token during the gut and consume it everywhere.
- Native controls strip height is 36 pixels (`OVERLAY_HEIGHT` in `windows.ts`).
- **Frameless window with `titleBarOverlay`.** Reserve the native-controls zone: topbar `padding-right` of roughly 150 pixels plus `-webkit-app-region: drag`. Content **tucks under** the native buttons at minimum width — it never collides. The topbar background runs full width beneath the overlay
- The native buttons are drawn by the operating system, above all web content. **You cannot z-index an HTML modal over them.** To make them recede, *dim* them: recolor the overlay to match the modal backdrop, restore to the **active** theme on close
- **The `setResizable` trap:** on Windows, `setResizable(false)` then `setResizable(true)` **clears the minimum-size constraint.** You must call `win.setMinimumSize()` again immediately after re-enabling resize, or the window drags to near zero
- Before changing any grid or flex: compute the width math at 740 / 900 / 960 / 1440, with the rail both present and collapsed, and **show the table.** Then run the parent-chain audit — trace the element up to `#root` and clear any ancestor forcing the layout

### 3.5 Config-as-Data — nav is data, not hardcode

At boot the shell reads the **`modules` table**; the **`MODULE_COMPONENTS`** slug-to-component registry in `App.tsx` mounts them. A `modules` row makes a module *navigable*; a `MODULE_COMPONENTS` entry makes it *real*. **Both are required.**

**Adding a module — additive, following the existing pattern. Copy an existing module; do not invent a new one:**

1. `src/modules/<slug>/` — the view or views
2. A `MODULE_COMPONENTS["<slug>"]` entry
3. A `modules` table **seed row** — slug, name, `type`, `nav_group`, `display_order`, `is_enabled` — in **both** the first-run seed **and** an additive back-fill, so existing development databases get it
4. `electron/core/services/<slug>/` — main-process services
5. IPC handlers in `electron/core/ipc.ts`, the preload bridge in `electron/core/preload.ts`, types in `src/shared/types.ts`
6. A `moduleIcon` case in the nav

**Never hardcode a nav entry. Never bypass the registry. Never `mkdir` a ghost folder.**

**Safe Mode:** a failed Config-as-Data read degrades to a static Safe-Mode shell with a persistent Retry banner. It must **never** reroute to the First-Run wizard.

### 3.6 Navigation structure — locked for this product

**Applications** (in this order):

| Order | Module | State |
|---|---|---|
| 1 | **Rename** | To be built — port of the Python rename logic |
| 2 | **Scan** | To be built — port of the Python scan logic, extended to video |
| 3 | **Shredder** | Carried over from RUNBOOKS, built, updated later |
| 4 | **Vault** | Seeded, not built — next project |

**System** — section header retained, currently empty. Scout Viewer, GetScriptClips, and Canon Distributor are **removed from this repo.**

**Not-built modules do not glow orange in this product.** Clicking a seeded-but-unbuilt module opens a plain page stating that the module has not been created yet. The orange `#FF9100` not-built convention remains standard for other AvertXAI applications — it is suppressed **here only**, because this build ships to a paying photographer.

### 3.7 Settings structure — locked for this product

- **General** — retained (workspace name, Skip Fast Boot)
- **Appearance** — retained
- **Access** — section header retained; *Members and roles* **removed**
- **Modules** — *Runbooks* **removed**; *Vault* retained
- **Integrations** — *Webhooks* and *Email notifications* both retained
- **Coming surfaces** — the three existing cards (Accounts & Roles, Tiers & Editions, Branding / White-label) are **removed** and replaced with the forthcoming Vault surfaces. The section's helper copy must lose its reference to orange glow.

### 3.8 Persistence — database, never localStorage

- **All persisted settings live in `app_settings`** via the sanctioned path: service getter/setter → IPC handler → preload channel. This is exactly how the three theme modes persist.
- **`localStorage` is BANNED** for any persisted state, without exception.
- **Every new persisted key must be added to the `RENDERER_KEYS` whitelist** in `electron/core/services/settings/index.ts`. Forgetting this throws "Unknown setting key" at boot and drops the shell into Safe Mode. This has bitten the project more than once.
- User-interface view state you want sticky across navigation — rail collapse, section collapse, sort order — also goes to `app_settings`, not React state alone.

### 3.9 Database rules

- One shared organization database per organization: `{app_slug}_{org_id}.db`. Locked modules such as Vault get their own SQLCipher file. The registry is `platform_registry.db`, which routes the active organization.
- Use the shared `getDb()` and `createTable()` helpers, which supply the standard `id` / `uuid` / `created_at` / `updated_at` columns.
- Tenant-scope module rows the way the shell already resolves tenancy (`org_id ?? modules.tenant_id`). Mirror an existing module; do not invent a scoping scheme.
- **Migrations are additive and guarded only.** Check `PRAGMA table_info` before any `ALTER TABLE ADD COLUMN`. Safe to re-run. **Never drop, recreate, or reorder a table.**
- **Do not run `dev:clean` casually** — it deletes `platform_registry.db` and resets you to a new empty organization. Use plain `npm run dev`.

### 3.10 IPC and preload safety

- The renderer talks to the main process **only** through the `contextBridge` preload application programming interface. No `nodeIntegration`. No direct `require` in the renderer.
- Push channels go through the preload whitelist, same as settings keys.
- Secret injection is isolated-world content script plus IPC only. **Raw-secret `executeJavaScript` is BANNED.**

### 3.11 System tray — user-controlled, default on

The shell's main window is a `BrowserWindow` with a system tray. **In this product the tray is a user setting, not a fixed behavior.**

- Setting key lives in `app_settings` (Config-as-Data), added to the `RENDERER_KEYS` whitelist, exposed in Settings. **Default: on.**
- **Tray on:** window ✕ calls `e.preventDefault()` and `win.hide()`; the process stays alive in the background. Quit is explicit and only from the tray.
- **Tray off:** window ✕ genuinely quits the application. No background process. A user who turns the tray off must not find the application still running.
- **Tray menu has exactly two items: Open and Exit.** Nothing else.
- Flipping the setting rewires the close handler live — it must not require a restart.
- The pre-existing single-instance lock's `second-instance` handler restores a hidden window.

### 3.12 Auto-updater

- **`electron-updater`, generic provider**, serving `latest.yml`, the installer, and the blockmap from Anthropic-independent infrastructure Jason controls (Hetzner plus Coolify plus Traefik). Not GitHub Releases — a private repository would require an embedded token in the shipped application.
- **Channel: `prerelease`.** The product name lives in the application identifier, never in the channel string, so a future rename cannot orphan an installed base mid-update.
- **`electron-updater` is not present in the source repository at all** — zero code, zero dependencies. This is a greenfield implementation, not a modification. *(Verified Data — recon 2026-07-18.)*
- **Check on boot and every six hours. Notify with a non-blocking toast. Download only on user consent (`autoDownload = false`). Install on quit.** Never pull a large download silently — the user may be on a slow or metered connection. **THE SECURITY REASON, so this is never reopened:** the alpha builds are **unsigned by design**, so `electron-updater` validates only a **SHA512 the feed itself supplies** — an attacker controlling the feed controls both the installer and its hash, so auto-download would be **code execution with no click**. Consent is the last human gate, and it costs one button. *(Jason ruled consent-first 2026-07-20, reversing an earlier same-day autoDownload-TRUE; see `CANON-UPDATES.md`. Consent-first also matches every other AvertXAI application.)*
- The download runs inside the standing process-overlay pattern (§4.5).
- **Publisher-name trap:** `electron-updater` validates the Windows publisher name on the incoming installer. The first builds are **unsigned by design**. When a code-signing certificate is later introduced, the unsigned-to-signed transition is a **deliberate manual reinstall**, not an auto-update. Do not let it happen by drift. If the publisher name ever changes again — for example a doing-business-as name becoming a limited liability company name — **both names must be listed in `win.publisherName`** or existing users' auto-update breaks silently.

---

## PART 4 — PRODUCT RULES SPECIFIC TO FOCAL REGISTRY

### 4.1 Data only — no pixels

This product answers **who, what, when, where, why** about a photographer's archive. It does not render, decode, or store image or video pixel data.

- **No thumbnails are generated or saved. Ever.** This is strict.
- No preview extraction, no proxy files, no image decode
- Metadata reads only — timestamps, camera, lens, dimensions, codec, duration, file size, path

### 4.2 Scan covers video and audio too

A photographer's folders contain forgotten video and audio. Scan detects and reports both alongside stills, with the same date-grouping treatment. Container and codec metadata are in scope; frames are not.

**Extraction stack — permissive licences only:**
- Stills: `exifr` (MIT, ~1.5 megabytes, pure JavaScript, header-only reads)
- Video and audio: **`music-metadata` (MIT)** — parses audio *and video* containers, returning container, codec, duration, and bitrate, with `trackInfo` for multi-track MP4 and Matroska.
- **`ffprobe` is REJECTED.** The FFmpeg binary is GPLv3 and ships inside the installer, which creates distribution obligations this product will not take on. It was installed once in error and removed. Do not reintroduce it.
- If a format genuinely cannot be read by a permissively-licensed library, **write the parser.** MP4 and MOV are ISO base media format — walking the box tree for `mvhd`, `stsd`, and `udta` is a few hundred lines, not a research project. Building it is preferable to importing a licence problem.

### 4.3 Results live in the database, not in text files

The Python originals wrote a text file. **The Electron modules write to the database.** A user opens the application and looks up a past rename operation or a past scan result — they never open a text file to find out what happened. Every run is a queryable, persisted record.

### 4.4 Rename operations must be reversible and auditable

Renaming a professional's archive is destructive by nature. Every rename run is logged as an append-only record capturing the original path, the new path, the timestamp, and the rule that produced it — sufficient to reverse the operation.

### 4.5 Long jobs use the standing process-overlay pattern

Scanning a multi-terabyte drive is a long job. It uses the standard AvertXAI overlay: an opaque modal over the current page showing the live log, with **Minimize** (offering "remember me") and **Stop**. Minimizing collapses it to a session dot that flashes green like a hard-drive activity light while the job runs, auto-dismisses on completion, and reopens the modal when clicked.

The Python originals flushed results to disk as each folder finished, so a crash mid-scan kept everything gathered so far. **Preserve that property** — commit each folder's results to the database as that folder completes, not at the end of the run.

---

## PART 5 — HARD DON'TS

- No Tailwind, no CSS modules, no Next.js constructs
- No Python runtime, no sidecar process, no `child_process` bridge to a script
- No hardcoded colors where a token exists
- No `localStorage`
- No `git add -A`
- No `dev:clean` unless a full reset is genuinely intended
- No hardcoded nav entries
- No non-additive migrations
- No raw-secret `executeJavaScript`
- No thumbnail or preview generation
- No second writer of `setBackgroundColor` or `setTitleBarOverlay`
- No claiming a user interface works from reading markup
- No unlabeled factual claims
- No fabricated `file:line` citations

---

*This file supersedes the generic AvertXAI web frontend Standard Operating Procedure for all work in this repo. That document was written for Next.js and Tailwind marketing sites; its stack rules break this shell. Keep only its method — math before CSS, the parent-chain audit, and never claiming success from markup.*
