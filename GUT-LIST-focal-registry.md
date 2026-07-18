# GUT-LIST — AvertXAI Focal Registry

**Source:** `D:\dev\AvertXAI-RUNBOOKS` (branch `feature/crud-integrations`, working tree 2026-07-18)
**Target:** `D:\dev\AvertXAI-Focal-Registry`
**Built from:** read-only reconnaissance, Deliverable 9. Every path below was cited in that report.

---

## ⚠ READ BEFORE STEP 1 — DESTRUCTIVE OPERATIONS AHEAD

**This document deletes files permanently. Before you run any of it:**

1. **Confirm you are in `D:\dev\AvertXAI-Focal-Registry`, NOT `AvertXAI-RUNBOOKS`.** Run `pwd` and read it out loud. Every deletion below is correct in the copy and catastrophic in the source.
2. **The source repository must be untouched.** If any command in this document would run against `AvertXAI-RUNBOOKS`, stop.
3. **The source working tree carries uncommitted work** — the `MIN_WIDTH = 740` change, the Scout guest-view parking, `tab-state.ts` (untracked), Distributor manifest hunks, and an `MC_GPU` probe block. Copying the working tree copies all of it. See §0.
4. **Delete in the order given.** Registry entries and imports come out before the folders they point at, so the tree never sits in a state where an import points at a missing file.
5. **After every phase, run `npm run build`.** A phase that does not compile does not get followed by the next phase.

---

## §0 — The uncommitted-state problem, first

*(Verified Data — recon close block, caveat 1.)*

`HEAD` in the source repository still carries `minWidth: 960`. The working tree carries `MIN_WIDTH = 740 / MIN_HEIGHT = 640` with the JASON-APPROVED comment. **The value you get depends on what you copy.**

Copying the working tree — which is what a plain folder copy does — gives you 740, which is what canon says is correct. Good. But it also gives you:

| Item | Disposition in the new repo |
|---|---|
| `MIN_WIDTH = 740` in `windows.ts` | **KEEP** — this is the canon-correct value |
| `MC_GPU` probe block in `main.ts` | **DELETE** — experiment scaffolding, flagged for removal |
| `scout-viewer/tab-state.ts` (untracked) | **DELETE** — Scout is going anyway |
| Distributor manifest hunks | **DELETE** — Distributor is going anyway |
| `markdown.smoke.tsx`, `smoke.ts`, `diag-read.mjs` | **DELETE** — development files in the production tree |

**First commit in the new repository happens after the gut, not before.** You want one clean initial commit, not the source's uncommitted mess preserved as history.

---

## §1 — REMEDIATION: what actually got copied

*(Verified Data — file listing of `D:\dev\AvertXAI-Focal-Registry`, 2026-07-18.)*

The copy happened before this list existed. Everything below is present in the new repository and must be dealt with **before any other phase.**

### 1.1 🔴 `.git` — verify the remote before any push

The source repository's `.git` folder was copied. **Jason has since created a new GitHub repository for Focal Registry.** Confirm the local repository actually points at it:

```
git remote -v
git branch --show-current
git log --oneline -5
```

**Two possible states, and they need different handling:**

**State A — remote was repointed at the new repository, history kept.** Safe to push, but the Focal Registry repository will carry RunBooks' entire commit history. That is not fatal; it is just noise, and the "one clean initial commit" plan in §0 no longer applies. Decide deliberately rather than by default.

**State B — remote still points at RunBooks.** **Do not push.** A push from here writes to a working product. Repoint it:

```
git remote set-url origin <focal-registry-remote>
git remote -v          # verify before doing anything else
```

**If you want a clean history instead**, from inside `D:\dev\AvertXAI-Focal-Registry` **only**:

```
rmdir /s /q .git
git init
git remote add origin <focal-registry-remote>
```

⚠ **Read the path twice. `rmdir /s /q .git` in the wrong folder destroys the source repository's history.**

**Repository visibility: private.** A private repository is invisible to organization followers at every GitHub tier, including free — which is the whole concern, solved at zero cost.

### 1.2 Delete now — copied but not wanted

| Path | Why |
|---|---|
| `dist/` | Build output |
| `dist-electron/` | Build output |
| `reports/` | RunBooks session reports — not this product's history |
| `CANON/` | Canon is distributed, never vendored. It lives at `D:\dev\_source\AvertXAI-CANON`. **The copied set is also stale** — it holds DECISIONS-41, RULES-32, STATUS-27 while current canon is DECISIONS-42, RULES-33, STATUS-28. A stale vendored canon is worse than none, because an agent will read it and believe it. |
| `PURGE-REPORT.md` | RunBooks session artifact |
| `RAIL-UPDATE-REPORT.md` | RunBooks session artifact |
| `RUNBOOKS-SCHEMA-REPORT.md` | RunBooks session artifact |
| `README.md` | RunBooks readme — rewrite for this product rather than edit |

### 1.3 `modules/` at the repository root — verify empty, then delete

There is a `modules/` folder at the **root** of the new repository. *(Verified Data — file listing.)*

**Jason reports its contents were already relocated to `electron/core/services/`** — the main-process service move that canon records as the `/brain/` to `/services/` refactor. So this should be an empty leftover shell.

**Verify before deleting rather than trusting the report:**

```
dir /s /b modules
```

- **Empty** → delete it. Root-level `modules/` violates the universal placement rule regardless of what is in it.
- **Not empty** → **stop and report the contents.** Something landed there that neither the relocation nor the reconnaissance accounted for, and deleting it blind loses it.

**The placement law, restated:** renderer modules live at `src/modules/<slug>/`. Main-process services live at `electron/core/services/<slug>/`. Nothing lives at a bare top-level `modules/`.

### 1.4 Confirmed absent — good

`node_modules/` and `.claude/` were correctly excluded. `docs/` was not copied, which means the shell and Shredder design documents are still in the source repository if you want them later. Retrieve selectively; do not copy the folder wholesale.

### 1.5 Already in place

`CLAUDE.md` and `GUT-LIST-focal-registry.md` are present. Per the new centralization rule, the canonical home for project documents is `D:\dev\_source\AvertXAI-Focal-Registry\`. `CLAUDE.md` is the exception — it must live at the repository root to function.

---

## §2 — DELETE: GetScriptClips (smallest, do it first)

The safest possible warm-up. It is a seven-line stub with no service, no inter-process communication, no tables, no tokens, and no dependencies.

| # | Path / edit |
|---|---|
| 1 | `src/App.tsx` — remove the import and the `MODULE_COMPONENTS` registry entry |
| 2 | `electron/core/services/canon-distributor/claudeMdStandard.ts` — remove the prose mention (cosmetic; this whole folder dies in §4 anyway) |
| 3 | `electron/core/services/firstrun/index.ts` — remove the GetScriptClips seed row |
| 4 | **Delete** `src/modules/getscriptclips/` |

**Gate:** `npm run build` clean. Launch, confirm nav renders without it.

---

## §3 — ~~DELETE~~ **KEEP: Scout Viewer** (REVERSED 2026-07-18)

**Decision reversed. Scout Viewer stays.** Paul dislikes Chrome and became interested once he heard what Scout Viewer was planned to do, so it ships as a product surface rather than a founder-only tool.

**Delete nothing from §3.** Keep all of it:

- `src/modules/scout-viewer/` and `electron/core/services/scout-viewer/`
- The `MODULE_COMPONENTS` entry and the `moduleIcon` case
- `ScoutBounds`, `ScoutTargetRow`, `ScoutDomCard`, `Api.scout`
- All 14 `scout:*` handlers and the `fromShell` sender gate — **the sender gate especially; it is a security control, not scaffolding**
- The preload bridge including the `targets` sub-object and the four subscriptions
- `scout_targets` `createTable`, its seed block, and the `scout_targets_seeded` marker
- `scout_tab_state` (currently untracked — it now needs to be tracked and committed)
- The seed row, the back-fill, the Data Viewer `PIN_ORDER` row
- `--scout-danger` and `--scout-bookmark-saved`
- The `before-quit` scroll-checkpoint hook

**Consequences of keeping it, which must be handled:**

1. **Applications becomes five modules, not four.** Order locked in §8.
2. **Extraction ships too — DECIDED 2026-07-18.** Canon records Scout's extraction surface as Founder-gated because the terms-of-service exposure was meant to stay internal. **Jason's ruling: Paul gets it as-is, incomplete surfaces included, because Paul is the alpha tester and feedback is the point.** This is a conscious acceptance of that exposure for an alpha of one, not an oversight. **Revisit before any wider release.**
3. **`scout-viewer/tab-state.ts` is untracked in the source.** It comes along with the file copy but has never been gated or committed. Device-gate it before the first commit.
4. **The two push-subscription mechanisms both survive.** Scout uses `subscribe()`-returns-unsubscribe; the Distributor's whitelist pattern dies with §4. Unify on one — see §12.

**Gate:** launch, browse to a page, verify the guest view renders and the tray Quit path still fires the `before-quit` hook cleanly.

---

## §4 — DELETE: Canon Distributor (largest)

| # | Path / edit |
|---|---|
| 1 | `src/App.tsx` — remove import and registry entry |
| 2 | `src/components/Flyout.tsx` — remove the `canon-distributor` icon case and the `DistributeIcon` function |
| 3 | `electron/main.ts` — remove the `syncAll` import **and the tray "Sync Now" menu item** (see §7) |
| 4 | `src/shared/types.ts` — remove `DistTarget`, `TargetSyncStatus`, `SyncResult`, `DistLogRow`, `PushChannel`, `CanonTemplate`, `CanonTemplatePayload`, `TemplateSection`, `TemplateWriteResult`, `CanonAgent`, `AgentImportResult`, `Api.dist`, `Api.templates`, `Api.agents`, and the top-level `on`/`off` |
| 5 | `electron/core/ipc.ts` — remove the distributor, templates, and agents imports and all 28 handlers |
| 6 | `electron/core/preload.ts` — remove the `dist`, `templates`, and `agents` bridges, plus `PUSH_CHANNELS`, `wrapped`, `safeChannel`, `on`, and `off` |
| 7 | `electron/core/services/db/index.ts` — remove `createTable` for `dist_source`, `dist_targets`, `dist_log`, `canon_templates`, `canon_agents`; the guarded manifest `ALTER`s; the agents index and `ALTER`; and the bespoke seed |
| 8 | `electron/core/services/firstrun/index.ts` — remove the bespoke Distributor insert |
| 9 | `src/modules/data-viewer/…` — remove `canon_agents` and `canon_templates` from `PIN_ORDER` |
| 10 | `src/globals.css` — remove the four `--canon-distributor-*` tokens **and the entire distributor CSS block** (badges, log, toggle, addcard, pathline, cd-spine, tpl-body) |
| 11 | `electron/core/services/settings/index.ts` — remove `watcher_enabled` from `RENDERER_KEYS` |
| 12 | **Delete** `src/modules/canon-distributor/` (6 files) |
| 13 | **Delete** `electron/core/services/canon-distributor/` (3 files) |

**`dist:synced` was the only entry in `PUSH_CHANNELS`.** Removing it leaves the whitelist empty. **Do not delete the mechanism** — Scan will need a main-to-renderer push channel for live progress. Keep `on`/`off` and the whitelist array, emptied.

**Gate:** `npm run build` clean. Launch, confirm the tray menu no longer offers Sync Now.

---

## §5 — KEEP INTACT: Runbook Shredder

**Do not touch any of this.** It is self-contained — its own database file `runbook-shredder_<org>.db`, its own `createTable` and `uuidv7` copies, its own tokens on `.rbs-shell`. Its only exclusive npm dependency is `gray-matter`.

**Renderer:** `RunbookShredderModule.tsx` · `config.manifest.ts` · `markdown.tsx` · `runbook-shredder.css`
**Main:** `shredder.ts` · `db.ts` · `api.ts`
**Shell touchpoints (all stay):** the `ipc.ts` imports, `ensureShredder`/`restartShredder`/`rescanShredder`, boot start in `main.ts`, the six `shredder:*` handlers, the preload bridge, `RunbookRow` and `RunbookFilter` types, the four `runbook-shredder.*` settings keys, the seed row and back-fill, the `MODULE_COMPONENTS` entry with its mount wrapper, and the `moduleIcon` default case.
**Tables (all stay):** `runbooks`, `tags`, `runbook_tags`, `runbook_secret_refs`, `runbooks_fts` and its three sync triggers.

**Delete only:** `markdown.smoke.tsx` (development file in the production tree).

**Display order changes from 3 to 3** — it stays third. See §8.

---

## §6 — KEEP: Secure Vault, Data Viewer

**Vault** — stub user interface, but its crypto is real and load-bearing at boot. Keep `src/modules/vault/`, `electron/core/services/vault/crypto.ts`, and the locked SQLCipher database path. Its unlock modal currently carries the `.nb` not-built class; that becomes the explanatory page per §9.

**Data Viewer** — keep. It is the Safe Mode escape hatch and a genuine internal tool. Remove the Scout and Distributor rows from `PIN_ORDER` per §3 and §4.

⟨**DECISION NEEDED** — Data Viewer is not in the four-module Applications list. Does it stay as a hidden or developer-gated surface, or does it get a nav entry? It is currently seeded and navigable.⟩

---

## §7 — REWORK: System tray

Current state *(Verified Data — recon Deliverable 10)*: `main.ts` carries an embedded PNG `TRAY_ICON`, a `createTray()` with **Show RunBooks / Sync Now / separator / Quit RunBooks**, click and double-click both calling `showMain()`, and an `isQuitting` flag. The close handler is:

```js
win.on("close", (e) => { if (!isQuitting) { e.preventDefault(); win.hide(); } });
```

**Changes:**

1. Remove the **Sync Now** item (dies with §4) and the separator.
2. Rename menu items to exactly **Open** and **Exit**. Two items, nothing else.
3. Replace the embedded RunBooks PNG with the Focal Registry icon.
4. **Make the whole behavior a setting.** New `app_settings` key, added to `RENDERER_KEYS`, surfaced in Settings, **defaulting to on**. When off, the close handler must genuinely quit — no hidden background process. Flipping it rewires live, no restart.

---

## §8 — REWORK: Module seeds and order

Applications section. **Five modules now that Scout Viewer stays.**

| `display_order` | Slug | Name | State |
|---|---|---|---|
| 1 | `scan` | Scan | **BUILD FIRST** — Paul's immediate need |
| 2 | `rename` | Rename | Seeded, "coming soon" page until it earns production |
| 3 | `runbook-shredder` | Runbook Shredder | Carried over, built |
| 4 | `scout-viewer` | Scout Viewer | Carried over, built |
| 5 | `vault` | Secure Vault | Seeded, not built |

⟨LOCKED 2026-07-18 — Jason confirmed this order. Nav order and build order deliberately differ; Scan leads because it is the module that works.⟩

**System** section header is retained and currently empty. `nav_group` stays `'System'` as a valid value with no members.

Seeds go in **both** `firstrun/index.ts` and the additive `db/index.ts` back-fill.

---

## §9 — REWORK: Not-built presentation

`--mc-orange` (`#ff9100`) and the `.nb` class currently produce the not-built glow, backed by `rgba(255,145,0,…)` literals in `globals.css`.

**In this product:** clicking a seeded-but-unbuilt module opens a plain page stating the module has not been created yet. Remove the `.nb` glow styling and the orange rgba literals. **Keep the `--mc-orange` token declared** — harmless, and it keeps the shell's token set aligned with other AvertXAI applications.

---

## §10 — REWORK: Settings page

⚠ **THE RECONNAISSANCE IS WRONG HERE — TRUST THE RUNNING APPLICATION.**

The recon reported `src/views/Settings.tsx` at 215 lines with a left nav of only **General** and **Appearance**. **Jason confirmed the screenshot showing Access, Modules, and Integrations was taken from the live application under `npm run dev`.** The recon's Deliverable 11 is therefore **incomplete or wrong**, and no other deliverable should be assumed perfect either.

**Before editing this file, re-recon Settings specifically.** Likely explanations, in order of my confidence: the nav rail renders additional entries from data rather than from literal buttons; or the recon read a stale or wrong file; or sections render from a map the recon did not follow. **Find out which. Do not edit from either the screenshot or the old report alone.**

Target state:

- **General** — keep (Workspace name, Skip Fast Boot). Add the tray toggle from §7.
- **Appearance** — keep. Note the recon flagged that its theme segment control **duplicates** the one in the TopBar; a pending decision.
- **Access** — keep the section header; remove *Members and roles*.
- **Modules** — remove *Runbooks*; keep *Vault*.
- **Integrations** — keep both *Webhooks* and *Email notifications*.
- **Coming surfaces** — remove all three cards (Accounts & Roles, Tiers & Editions, Branding / White-label). Replace with the forthcoming Vault surfaces. **Rewrite the helper copy** — it currently says each card "glows orange until wired," which is no longer true here.

---

## §11 — REWORK: Identity and packaging

| Item | From | To |
|---|---|---|
| `appId` | `com.avertxai.runbooks` | `com.avertxai.focalregistry` |
| Window `title` | `RunBooks` | `Focal Registry` |
| Tray tooltip and menu | RunBooks | Focal Registry |
| `build/icon.ico` | RunBooks icon | Focal Registry icon |
| App slug (database filename) | runbooks | ⟨**DECISION NEEDED** — `focalregistry`? This is frozen at first run and **never renamed on disk.** Get it right the first time.⟩ |
| `window.runbooks` preload bridge | `runbooks` | Rename to match the product |
| `window.runbooks.version` | hardcoded `"0.1.0"` | **Read from `package.json`** — the recon flagged this hardcoded duplicate as a defect |

---

## §12 — Sanctioned cleanups (fresh repo, cheap to do now)

The recon surfaced these as defects. A new repository is the one moment they are cheap to fix.

1. **Promote the 58-pixel topbar height to a `--mc-topbar-height` token** and consume it in `globals.css` and `runbook-shredder.css`. It is currently duplicated across three stylesheets and has already drifted once.
2. **Collapse the boot dark `#0b0e16` to one source of truth.** It currently lives in four places synchronized only by comment.
3. **Replace the 30-plus hardcoded hex and rgba literals in `globals.css`** with tokens — particularly `#2c3a58` at the modcard hover border, which silently duplicates the hybrid scrollbar-thumb value, and the raw green and red button colors. Many belong to blocks being deleted anyway, so do this **after** §3 and §4 and the list will be much shorter.
4. **Delete development files from the production tree:** `markdown.smoke.tsx`, `smoke.ts`, `diag-read.mjs`.
5. **Fix or remove the `diag:enabled` handler**, which registers only under `DIAG=1` and throws a benign "No handler registered" console error on every normal run.
6. **Resolve the two push-subscription mechanisms.** Scout's `subscribe()`-returns-unsubscribe pattern dies with §3, leaving only the `on`/`off` whitelist pattern. Good — keep one.
7. **Remove the `MC_GPU` probe block** from `main.ts`.

### §12a — DELETE: Runbooks service and Keystone

**Jason's ruling: photographers need neither. Both go.**

The reconnaissance marked these **UNCERTAIN, not proven dead** — a grep-based negative is not a finding. Since the decision is to remove them regardless of whether they are wired, the trace becomes a **safety check on the way out**, not a question of whether to delete:

| # | Path / edit |
|---|---|
| 1 | **Trace first.** Grep for `runbooks:list`, `runbooks:create`, and `api.runbooks` across `src/`. If a consumer exists, report it before deleting — something is using it and you need to know what breaks. |
| 2 | `electron/core/ipc.ts` — remove the `runbooks:list` and `runbooks:create` handlers |
| 3 | `electron/core/preload.ts` — remove the `runbooks` bridge object |
| 4 | `src/shared/types.ts` — remove `Api.runbooks` and any types exclusive to it |
| 5 | **Delete** `electron/core/services/runbooks/` |
| 6 | **Delete** `src/keystone/` (documents only — no code) |

⚠ **Do not confuse `services/runbooks/` with `services/runbook-shredder/`.** Similar names, completely different modules. **Shredder stays** (§5). Read the path twice before deleting.

**Gate:** `npm run build` clean. Launch and confirm Shredder still ingests and searches.

---

## §13 — Build order

**Paul plugs in a drive tonight. Scan is the deliverable; everything else is scaffolding around it.**

1. **§1 remediation — `.git` first.** Nothing else starts until the remote question is answered.
2. §1.2 and §1.3 deletions
3. §2 GetScriptClips removal (the warm-up), gating on `npm run build`
4. §4 Canon Distributor removal, gating on `npm run build`
5. §12a Runbooks service and Keystone removal, with the trace first
6. §5, §6, §3 verification — Shredder, Vault, Data Viewer, and **Scout Viewer** all still mount and run
7. §7 tray rework
8. §11 identity and packaging
9. §12 cleanups
10. **First commit.** One clean initial commit. Create the remote now, not before.
11. §8 module seeds for Scan and Rename — rows only. The "not created yet" page proves seeding works before either module exists.
12. §9 not-built page
13. §10 Settings — **after** the Settings recon is redone
14. **Scan module: brainstorm → mockup → build.** The priority.
15. Auto-updater — greenfield
16. Rename module — off to the side, ships when it earns it

---

*Every path in this document traces to the read-only reconnaissance of 2026-07-18. Line numbers were deliberately omitted — they were exact that day and shift with the next edit. Verify against the tree, not against this document, and report any mismatch rather than working around it.*
