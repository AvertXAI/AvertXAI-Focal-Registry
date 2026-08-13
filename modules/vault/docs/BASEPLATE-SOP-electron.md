# BASEPLATE-SOP-electron.md

**The AvertXAI Mission Control Electron baseplate — how to build a new application on it.**

This document is the durable, portable procedure for standing up a new desktop product from the Mission Control shell. It is written to be handed to an agent in a brand-new repository with no other context.

**Reference implementation:** `D:\dev\AvertXAI-RUNBOOKS` (the runbooks.systems product). Every value in this document was read out of that tree by read-only reconnaissance on 2026-07-18.

**Scope:** this document owns the *method and the shell*. It does not own any individual product's features — those live in that product's own specification. It does not own an individual repository's standing orders — those live in that repository's `CLAUDE.md`.

---

## 0. Precedence

- This document **overrides** the generic AvertXAI web frontend Standard Operating Procedure for all shell work. That document was written for Next.js and Tailwind marketing sites; its stack rules break this shell.
- From the generic document, keep **only the method**: compute the width math before writing CSS, run the parent-chain audit, and never claim a layout works from reading markup.
- A product's own `CLAUDE.md` may **add** rules. It may not contradict this one. If it does, stop and ask.
- Canon (`FACTS-N`, `STATUS-N`, `DECISIONS-N`, `RULES-N`) overrides everything on conflict.

**One warning about that last line.** Canon and a repository can both be right and still disagree, because canon may describe an **uncommitted working tree** while `HEAD` describes something else. This has already happened once, with the window floor: canon recorded 740 while `HEAD` still carried 960, and both readings were accurate descriptions of different states. When canon and code disagree, **check whether the difference is uncommitted work before declaring either one stale.**

---

## 1. What the baseplate actually is

An Electron desktop shell whose navigation, module set, and settings are **read from a database at boot** rather than compiled in. Modules dock into it. The same shell, reseeded with different modules, becomes a different product.

| Layer | Technology |
|---|---|
| Renderer | React 19 + TypeScript, built by Vite |
| Main process | TypeScript bundled by esbuild to `dist-electron/*.cjs` |
| Styling | Plain CSS custom properties in `src/globals.css`. **No Tailwind, no CSS modules, no Next.js** |
| Database | `better-sqlite3-multiple-ciphers` (SQLCipher-capable), `argon2` for key derivation |
| Packaging | `electron-builder`, configuration inside `package.json` under a `build` key |

**Native modules stay external.** The esbuild command carries `--external:electron --external:better-sqlite3-multiple-ciphers --external:argon2`. A `postinstall` runs `electron-rebuild` against both native modules. Do not bundle them, and do not remove the rebuild step.

**Keep the dependency tree lean.** `pg` and `uuid` do not belong in a local-SQLite desktop application. Weigh the size cost before adding any icon or user-interface mega-package — one of them was 173 megabytes of dead cargo once already.

---

## 2. Standing up a new application — the copy-then-gut method

The generator (`npx avertxai-mission-control`) is deferred. Until it exists, the procedure is manual and this is it.

### 2.1 Copy

Take the reference repository, **excluding**:

```
node_modules/  .git/  .claude/  dist/  dist-electron/  out/  release/
reports/       CANON/
```

Keep `build/icon.ico` if present. Copy `docs/` selectively — the shell and any carried-over module's design documents, nothing else.

**Canon is distributed, never vendored.** It lives at `D:\dev\_source\AvertXAI-CANON` and is synced in; it does not live inside a product repository.

### 2.2 Understand what you copied

A folder copy takes the **working tree**, not `HEAD`. That means uncommitted experiments, untracked files, and half-landed features come with it. Before the first commit, inventory them and decide on each one explicitly. **Do not preserve the source's uncommitted mess as your new repository's history.**

### 2.3 Gut

Remove modules smallest-first, so early mistakes are cheap. For **each** module being removed, the removal surface is:

1. `src/modules/<slug>/` — the folder
2. `electron/core/services/<slug>/` — the service folder
3. `src/App.tsx` — the import and the `MODULE_COMPONENTS` entry
4. `src/components/Flyout.tsx` — the `moduleIcon` case, and any icon function that becomes unreferenced
5. `src/shared/types.ts` — its types and its `Api.<slug>` surface
6. `electron/core/ipc.ts` — its imports and every handler
7. `electron/core/preload.ts` — its bridge object and any push-channel entries
8. `electron/core/services/db/index.ts` — its `createTable` calls, guarded `ALTER`s, indexes, and seeds
9. `electron/core/services/firstrun/index.ts` — its seed row
10. `electron/core/services/db/index.ts` — its back-fill `seedModule` call
11. `electron/core/services/settings/index.ts` — its `RENDERER_KEYS` entries
12. `src/globals.css` — its tokens and its CSS block
13. The Data Viewer's `PIN_ORDER` — its table rows
14. `package.json` — any dependency exclusive to it
15. `electron/main.ts` — any boot hook or tray menu item it registered

**Gate on `npm run build` after each module.** A phase that does not compile is not followed by the next phase.

### 2.4 Re-identify

| Item | Change to |
|---|---|
| `appId` | `com.avertxai.<product>` |
| `BrowserWindow` `title` | Product name |
| Tray tooltip and menu labels | Product name |
| `build/icon.ico` | Product icon |
| `window.<name>` preload bridge | Product name |
| Application slug for database filenames | Product slug — **frozen at first run, never renamed on disk** |
| Hardcoded version strings | **Read from `package.json`** — the reference tree carries a duplicated `"0.1.0"`, which is a defect, not a pattern |

### 2.5 Commit once, cleanly

One initial commit **after** the gut and re-identification. Then start building.

---

## 3. Theming

Three modes via a `data-theme` attribute on `<html>` — set pre-root from a `?theme=` parameter in `src/main.tsx`, then at runtime in `src/App.tsx`. The value `system` clears the attribute, falling through to the `:root` Hybrid block.

### 3.1 The reference token set

All tokens live in `src/globals.css`. A new product may re-value them; it may not rename or remove them without replacing every consumer.

| Token | Hybrid | Dark | Light | Paints |
|---|---|---|---|---|
| `--mc-base` | `#0d1320` | `#1f1f1f` | `#FAFAFA` | window and page base |
| `--mc-panels` | `#121a2e` | `#2c2c2a` | `#FFFFFF` | cards, modals, sticky table headers |
| `--mc-nested` | `#182238` | `#2c2a26` | `#F5F5F5` | inner surfaces, buttons, hovers, logs |
| `--mc-border` | `#233149` | `#61615b` | `#E5E5E5` | all borders |
| `--mc-text` | `#e8edf7` | `#E5E5E5` | `#1A1A1A` | body text |
| `--mc-muted` | `#8b9bb4` | `#A0A0A0` | `#737373` | secondary text |
| `--mc-accent-primary` | `#4f8df0` | `#d97757` | `#d97757` | links, primary button |
| `--mc-orange` | `#ff9100` | `#ff9100` | `#ff9100` | not-built glow |
| `--mc-topbar` | `#0d1320` | `#262626` | `#FFFFFF` | header background |
| `--mc-sidebar` | `#121a2e` | `#262626` | `#FFFFFF` | nav rail |
| `--mc-field` | `#0d1320` | `#424240` | `#FFFFFF` | inputs |
| `--mc-avatar` | `#4f8df0` | `#313131` | `#E6E6E6` | avatar chips |
| `--mc-dimmer` | `#5b6b88` | `#71716B` | `#A3A3A2` | placeholders |
| `--mc-toggle-on` | `#4f8df0` | `#4f8df0` | `#4f8df0` | toggle on-state, fixed in all modes |
| `--mc-seg-on-background` | `#303539` | `#303539` | `#DCE8F5` | selected segment chip |
| `--mc-seg-on-icon` | `#4773a6` | `#4773a6` | `#4773a6` | selected segment glyph |
| `--mc-scrollbar-thumb` | `#2c3a58` | `#7c7b75` | `#B1B1B0` | scrollbars |

**Single-value tokens** — declared once at `:root`, inherited unchanged into dark and light by design:
`--mc-flyout-width: 300px` · `--mc-boot-bg: #0b0e16` · `--mc-underline: var(--mc-accent-primary)` · `--mc-green: #16a34a` · `--mc-radius: 6px` · `--mc-font` · `--mc-mono`

### 3.2 Token naming law

- **Shell tokens keep the `--mc-` prefix** in every product built on this baseplate. The shell is Mission Control regardless of what the product is called. Renaming them per product fragments the baseplate for no benefit.
- **Every module owns a distinct full-word prefix** — `--rename-*`, `--scan-*`, `--shredder-*`, `--vault-*`. Modules sharing a shell must never collide.
- **Role names are spelled out.** `background`, `foreground`, `base`, `border`. Never `bg`, never `fg`, never abbreviations. A second developer and the integrated development environment must find it without a legend.
- **One source of truth per `globals.css`.** No bare unprefixed token shared across scopes. No hardcoded color where a token exists.
- A module may declare its tokens on its own root class rather than `:root` — the reference Shredder does this on `.rbs-shell`. Both are acceptable; scoping to the module is cleaner.

### 3.3 The paint-surface law

The active theme background must be set on **`html`, `body`, AND `#root`.** An unpainted ancestor rasterizes **white** on resize, and a themed child over an unthemed ancestor exposes the wrong color.

### 3.4 The single overlay funnel

All runtime frame recoloring goes through **one function** — `applyOverlayNow()` in `electron/core/windows.ts`. It writes both `setTitleBarOverlay` and the window's `setBackgroundColor`, reading the color at call time. Theme switches, modal dim, and resize re-asserts all route through it.

**Never add a second writer of either call.** A second writer paints stale color outside the funnel and reintroduces the seam. If you need a new color state, add a **mode the funnel resolves** — not a new writer. The only sanctioned call outside the funnel is the `BrowserWindow` constructor's initial value.

*(Note: a `WebContentsView` guest calling its own `setBackgroundColor` is not a violation — that targets a different object than the shell window.)*

### 3.5 The boot frame invariant (has regressed twice)

The boot terminal is hardcoded dark `#0b0e16` in every theme, by design. Therefore during **boot** and the **first-run wizard**, the frame must be `#0b0e16` in every theme — never the user's active theme. Theming the frame during boot produces a light-frame-on-dark-terminal bleed. That is the bug that keeps coming back.

The real theme applies **only** on the `boot:done` inter-process communication message.

**In the reference tree this value lives in four places** — the `--mc-boot-bg` token, a raw hex in `.bootterm`, `OVERLAYS.boot`, and `BASE_BG.boot` — synchronized by comment only. **A new repository should collapse these to one source of truth.** Keep the invariant comments above the constructor's boot-color lines and above the funnel's boot-mode branch.

### 3.6 Verification

Verify **every** theme change in **all three modes.** A fix that is clean in dark can bleed in hybrid.

---

## 4. Window, geometry, and the traps

### 4.1 Constants

- **`MIN_WIDTH = 740`, `MIN_HEIGHT = 640`** — one shared constant in `electron/core/windows.ts`, read by the `BrowserWindow` constructor and re-asserted in `setBooting(false)`. Chosen so the shell docks in a half-screen split beside an integrated development environment. Display profile: 1920 by 1080 at 100 percent scale, device pixel ratio 1, so half-screen is 960 CSS pixels.
- **Nav rail:** expanded `--mc-flyout-width: 300px`, runtime-draggable and clamped to 300 maximum. Collapsed **58 pixels**. Body offset is `padding-left: var(--mc-flyout-width, 300px)`.
- **Topbar height: 58 pixels.** In the reference tree this is **not a constant** — it exists as three duplicated `calc(100vh - 58px)` literals across separate stylesheets, and that drift has already caused a problem. **A new repository should promote it to `--mc-topbar-height` and consume the token everywhere.**
- **Native controls strip: 36 pixels** (`OVERLAY_HEIGHT`).
- **Native reserve:** the topbar carries `padding-right: 150px` and `-webkit-app-region: drag`, with explicit no-drag opt-outs on interactive children.

### 4.2 Responsive tiers

**Mobile-first and 375-pixel rules do not apply.** This shell can never render below 740. Do not add a breakpoint that cannot fire.

The real tiers are:

- **`@container (min-width: 900px)`** — the single topbar threshold. Above it the inline search box and the breadcrumb prefix show; below it the search collapses to a magnifier and the prefix hides, leaving the module name. **Both flip together.** The topbar is one row at every width — never two stacked bars — and is a container-query container.
- **`@media (min-width: 768px)`** — content padding, two-column module grid, 240-pixel settings rail
- **`@media (min-width: 1024px)`** — 280-pixel settings rail
- **`@media (min-width: 1280px)`** — three-column module grid
- **`@media (prefers-reduced-motion: reduce)`** — transitions off

Before changing any grid or flex: compute the width math at **740 / 900 / 960 / 1440**, with the rail both expanded and collapsed, and **show the table.** Then run the parent-chain audit — trace the element up to `#root` and clear any ancestor forcing the layout.

### 4.3 The `setResizable` trap (regressed once)

On Windows, `setResizable(false)` followed by `setResizable(true)` **clears the minimum-size constraint.** You must call `setMinimumSize()` again immediately after re-enabling resize, or the window drags to near zero.

The boot lock triggers exactly this — the constructor is born `resizable: false` and unlocks on `boot:done`. **A window constructed non-resizable never registers its floor, so the unlock re-assert is load-bearing, not decorative.**

### 4.4 `titleBarOverlay` is drawn by the operating system

The native minimize, maximize, and close buttons are painted by Windows **above all web content.**

- An HTML modal or backdrop **cannot** be z-indexed over them. Do not try.
- To make them recede, **dim** them: recolor the overlay to match the modal backdrop while the modal is open, and restore to the **active theme** on close. Restoring to a hardcoded color is the common bug — close a modal in light mode, get a dark overlay.
- Optionally set `setMinimizable`/`setMaximizable`/`setClosable` to false while a modal is open so they read as inert; re-arm on close.
- **Never gate programmatic paths.** `setClosable(false)` only disables the user's button; tray Quit and `app.quit()` must always work or you can deadlock the application.
- Content must **tuck under** the native buttons at minimum width, never collide.

### 4.5 The resize-repaint edge gap — accepted, do not re-chase

During a live window drag, Windows paints freshly-exposed frame pixels with the window `backgroundColor` a beat before Chromium composites the edge content, so the edge reads base-against-panel for a frame or two.

**This is irreducible on frameless Chromium on Windows.** VS Code, Discord, and Slack all show the same hairline. The mitigations are already shipped: byte-identical `backgroundColor` and `--mc-base` in every theme, a single overlay writer, and debounced resize re-asserts. `backgroundMaterial: 'mica'` is **rejected** — it makes the window translucent, which is wrong for an opaque shell.

---

## 5. The boot chain

1. `BrowserWindow` constructed with `show: false`, `resizable: false`, `titleBarStyle: "hidden"`, `backgroundColor` and `titleBarOverlay` both resolved to the **boot** color, `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
2. Renderer boots; the boot terminal runs
3. A **single** renderer effect keyed on the booting state sends `boot:start` and `boot:done` over a dedicated preload bridge — **not** through the main inter-process communication module, which carries unrelated code
4. `boot:done` handler flips the booting flag, snaps the frame to the real theme through the funnel, re-enables resize, and **re-asserts the minimum size**

**The boot effect must be re-entrant and idempotent.** Safe Mode retry re-enters boot, so the lock and darkening must re-apply, not fire once.

---

## 6. Config-as-Data — navigation is data, not code

At boot the shell reads the **`modules` table**. The **`MODULE_COMPONENTS`** slug-to-component registry in `App.tsx` mounts them.

**A `modules` row makes a module navigable. A `MODULE_COMPONENTS` entry makes it real. Both are required.**

### 6.1 The `modules` table

Standard `id` / `uuid` / `created_at` / `updated_at` injected by the shared `createTable` helper, plus:

| Column | Type |
|---|---|
| `tenant_id` | TEXT NOT NULL |
| `name` | TEXT NOT NULL |
| `slug` | TEXT UNIQUE NOT NULL |
| `type` | TEXT NOT NULL |
| `display_order` | INTEGER DEFAULT 0 |
| `is_locked` | INTEGER DEFAULT 0 |
| `is_enabled` | INTEGER DEFAULT 1 |
| `nav_group` | TEXT — added by guarded `ALTER`, backfilled NULL to `'Applications'` |

### 6.2 Adding a module — the six-step recipe

Additive, following the existing pattern. **Copy an existing module; do not invent a new shape.**

1. `src/modules/<slug>/` — the view or views
2. A `MODULE_COMPONENTS["<slug>"]` entry
3. A `modules` seed row — slug, name, `type`, `nav_group`, `display_order`, `is_enabled` — in **both** the first-run seed **and** an additive back-fill, so existing development databases get it
4. `electron/core/services/<slug>/` — main-process services
5. Inter-process communication handlers, the preload bridge entry, and types
6. A `moduleIcon` case in the nav

### 6.3 Navigation rendering

Modules arrive sorted by `display_order`, group by `nav_group` (defaulting to `Applications`), and sections order by the **minimum** `display_order` among their members. Sections are collapsible with a chevron; collapse state persists to `app_settings`. Home is pinned top, Settings pinned bottom. The collapsed rail renders a flat icon list.

**Never hardcode a nav entry. Never bypass the registry.**

### 6.4 Safe Mode

A failed Config-as-Data read degrades to a **static Safe-Mode shell** with a persistent Retry banner that refetches without a restart. The Data Viewer stays reachable so the operator can inspect the database.

**Safe Mode must NEVER reroute to the First-Run wizard.** That path destroys a working install's identity.

---

## 7. Persistence — database, never `localStorage`

All persisted settings live in `app_settings` via one sanctioned path:

```
service getter/setter  →  IPC handler  →  preload channel  →  renderer
```

- **`localStorage` is BANNED** for any persisted state. The reference tree has zero code references — every grep hit is a comment saying not to use it. Keep it that way.
- **Every new persisted key must be added to the `RENDERER_KEYS` whitelist.** Both the getter and the setter gate through a key-validation function that throws "Unknown setting key". Forgetting this throws at boot and drops the shell into Safe Mode. **This has bitten the project more than once.**
- Module keys are namespaced `<module-slug>.<key>`.
- User-interface view state you want sticky across navigation — rail collapse, section collapse, sort order, last active module — also goes to `app_settings`, not React state alone.
- **Module config isolation, "expose don't connect":** a module never writes the root's `app_settings` directly. It builds its toggle user interface locally, namespaces its keys, consumes injected `settings` and `onChange` properties, and ships a typed config manifest listing its keys and defaults as the merge handshake. Root owns persistence; the module owns its user interface and its contract.

---

## 8. Database

- **One shared organization database per organization:** `{app_slug}_{org_id}.db`. `app_slug` is frozen at generation; `org_id` is a UUIDv7 minted once at the first-run wizard.
- **Locked or isolated modules get their own file.** The reference Vault uses its own SQLCipher database; the reference Shredder uses its own plain file with its own `createTable` and identifier helpers, which is what makes it liftable between products.
- **Registry:** `platform_registry.db` in `userData`, one per install, routing each boot to the active organization. It is the bootstrap router, so it deliberately bypasses the standard-columns helper.
- **The full filename set is fixed when the file is CREATED at first run and NEVER renamed on disk.** Display names stay editable in the database.
- Use the shared `getDb()` and `createTable()` helpers for standard columns.
- Tenant-scope module rows the way the shell resolves tenancy. Mirror an existing module; do not invent a scoping scheme.
- **Migrations are additive and guarded only.** Check `PRAGMA table_info` before any `ALTER TABLE ADD COLUMN`. Safe to re-run. **Never drop, recreate, or reorder a table.**
- **Cross-file joins are possible** via SQLite `ATTACH DATABASE` when a product splits data across files. Plan for it rather than discovering it late.
- **Do not run the development reset script casually** — it deletes `platform_registry.db` and resets you to a new empty organization.

---

## 9. Inter-process communication and preload safety

- The renderer talks to main **only** through the `contextBridge` preload interface. No `nodeIntegration`, no direct `require` in the renderer, `sandbox: true`.
- Channels are grouped by module prefix.
- **Push channels** (main to renderer) go through a whitelist, same as settings keys.
- **Pick one subscription mechanism and keep it.** The reference tree carries two coexisting patterns — a whitelisted on/off pair and a `subscribe()` returning an unsubscribe function. That is a defect to inherit deliberately or not at all.
- **Sender-gate any handler that can act on another surface.** The reference Scout handlers verify the sender before acting.
- Secret injection is isolated-world content script plus inter-process communication **only**. **Raw-secret `executeJavaScript` is BANNED.**

---

## 10. System tray

The main window's close button hides to a tray rather than quitting, so background work survives. Quit is explicit and only from the tray, via an `isQuitting` flag that lets `before-quit` hooks run. A single-instance lock's second-instance handler restores a hidden window.

```js
win.on("close", (e) => { if (!isQuitting) { e.preventDefault(); win.hide(); } });
```

**Recommended for any consumer-facing product: make this a user setting.** A user who does not want a background process should be able to turn the tray off, at which point the close button genuinely quits. Store the setting in `app_settings`, whitelist the key, and rewire the handler live rather than requiring a restart.

Ship a real `build/icon.ico` at package time rather than an embedded base64 placeholder.

---

## 11. Not-built surfaces

Non-functional controls in a scaffold build glow orange `#ff9100` on hover — **never a 404, never a dead click.** Orange means not built yet.

**For a product shipping to a paying customer, replace the glow with an explanatory page** stating the module has not been created yet. The orange convention is a signal for the builder's eyes, not the customer's. Keep the `--mc-orange` token declared either way so the token set stays aligned across products.

---

## 12. Long-running jobs — the standing overlay pattern

Any long job — a scan, an archive, a transfer, an update download — uses one pattern:

- An opaque modal over the current page shows the live log
- **Minimize** (offering "remember me") and **Stop**
- Minimizing collapses to a session dot that flashes green like a hard-drive activity light while the job runs
- Auto-dismiss on completion; clicking the dot reopens the modal

**Commit incremental results as they complete, not at the end.** A crash or a stop partway through a multi-hour job must keep everything gathered so far.

---

## 13. Verification and reporting — the hard rules

- **Recon-first.** Read-only pass with `file:line` receipts and explicit `NOT FOUND` markers before any edit. Never assume a class name, a column, or a wiring pattern from memory.
- **Every change report pastes the literal `git diff`** of the touched paths. **An empty diff means the edit did not happen — say so.**
- **Never claim a user interface works from reading markup.** Prove it with width math or an actual render. If you cannot render, say "requires an on-device check at widths X and themes Y."
- **Kill every stale Electron process before testing.** The single-instance lock refocuses an old window running a stale bundle and hands you a false result.
- **Device-gate before commit.** Verify in all three themes. Commit only after the gate passes.
- **Explicit-path staging.** Never `git add -A`. Never `checkout`, `restore`, or `stash` a file carrying uncommitted work you are not deliberately reverting.
- **Separate verified from inferred from assumed from unknown** in every report. Stop for a decision rather than guessing.
- **Line-number citations rot.** They are exact the day they are written and wrong after the next edit. Cite them in a report; carry only values and structures into durable documents.

---

## 14. Hard don'ts

- No Tailwind, no CSS modules, no Next.js constructs
- No hardcoded colors where a token exists
- No `localStorage`
- No hardcoded nav entries
- No non-additive migrations
- No second writer of `setBackgroundColor` or `setTitleBarOverlay`
- No raw-secret `executeJavaScript`
- No `git add -A`
- No development or smoke-test files in the production tree
- No claiming success from markup
- No unlabeled factual claims, and never a fabricated citation

---

*Maintained by Claude as single writer. Add a rule here whenever an Electron-platform trap costs a device-gate cycle. When a rule becomes a settled decision, mirror the one-line version into canon `DECISIONS` or `RULES` and keep the detailed how-to here.*
