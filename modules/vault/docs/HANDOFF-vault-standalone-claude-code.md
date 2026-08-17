# HANDOFF — Vault module, standalone build (for Claude Code desktop)

**Repo:** `D:\dev\AvertXAI-Focal-Registry` · **Your lane:** `modules/vault/` at the repo ROOT — a new folder that does not exist yet.
**Written:** 08-05-2026, for an agent with zero prior context.
**Another agent (the IDE) is working in this same repo at the same time.** Everything below about lane discipline is therefore a hard rule, not a preference.

---

## 1 · What you are building

The **Secured Vault** module for Focal Registry — an encrypted secret store for a photographer's business credentials. It already exists as a services layer inside the Electron app; **your job is the module: the interface and the logic behind it, built standalone in your own folder, to the approved mockup.**

When you are done, the IDE copies your code into `electron/core/services/vault/` and `src/modules/vault/`. Build it so that copy is mechanical — no shell assumptions, no cross-module imports.

---

## 2 · LANE DISCIPLINE — the hard rules

1. **You write ONLY inside `modules/vault/`.** Never `electron/`, never `src/`, never the repo root, never `package.json`. If you believe you need a change outside your folder, STOP and report it — do not make it.
2. **You may READ anything**, and you should. `electron/core/services/vault/` is your reference implementation — read it in full before writing a line (see §3).
3. **Explicit-path staging only**, never `git add -A`, never `git add .`. Every commit lists your own files by path. No co-authored trailers.
4. **Before every commit:** `npx tsc --noEmit && npm run build` chained with `&&`, both exit 0. Never `;`.
5. **Pull before you push, push often, small commits.** Another agent is committing to this repo in parallel. If a pull brings conflicts in files outside your folder, you have violated rule 1.
6. **Never run `git checkout`, `restore`, `stash`, or `reset` on files you did not write.** The other agent's uncommitted work lives in this tree.
7. Reports go to `reports/REPORT-vault-<topic>-<MM-DD-YYYY>.md` inside the repo — never print-only to the chat window.

---

## 3 · READ FIRST — the existing implementation and why it is the way it is

**Code (shipped, commit `b2d4b34`), read all of it:**
- `electron/core/services/vault/db.ts` — schema. Three tables. Note: `vault_secrets` has **no value column and no version column** — both derive from `vault_secret_versions`, so they cannot drift. `vault_access_log` has no value column at all.
- `electron/core/services/vault/store.ts` — services. `META_COLS` (defined once, carries no value) vs `CURRENT_VALUE` (referenced by exactly one query, `readSecret`). Every list/create/supersede/archive returns metadata only. Oversize input **throws** rather than truncating. Supersede takes `MAX(version)` and inserts inside one transaction.
- `electron/core/services/vault/crypto.ts` — key handling. Windows safeStorage → Argon2id → SQLCipher.
- `electron/core/services/vault/ipc.ts` — the bridge. `caller` is stamped as a constant in this layer; the renderer cannot sign the log as anyone else.
- `electron/core/services/vault/types.ts`, `electron/core/preload.ts:337-345`, `src/shared/types.ts:909-931` and `:1277-1287` — the existing surface.
- `src/modules/vault/LOCK-ME-DOWN.md` and `README.md` — the module's own security notes.

**Facts you must not re-litigate (all ruled):**
- Files on disk are `<org_id>.ixd` (key) and `<org_id>.atd` (database). Dull names on purpose. **This is obscurity, not a security control** — say so in any doc you write; the real protection is safeStorage + Argon2id + SQLCipher.
- The three `.atd` path expressions in the app must stay byte-identical or a second database is silently created. If your code constructs a path, it matches exactly.
- Secret values live in exactly one place: the append-only version history. No mirror column, no stored version integer.
- Misses and refusals are logged **before** the throw.
- The Vault owns its own settings. The application's Settings page carries no vault controls, ever.
- **`localStorage` is banned.** Persisted state goes service → IPC → preload → database.

**The known gap, and it is yours to close:** every `vault:*` channel is reachable from the renderer today with **no master password**. `LOCK-ME-DOWN.md` admits it. Any renderer code can call `vault.read` and get plaintext, and the access log can only ever record `caller = "renderer"`. **The master password / unlock gate is part of this build** — design it, mock it, then build it.

---

## 4 · The approved design

`MOCKUP-vault-v3-8-options-08-02-2026.html` — **all eight surfaces are approved as the destination**, ruled by Jason 08-03-2026:
1. Stored secrets table · 2. Three-pane browse (All items / Favourites / Archived / Types) · 3. Grid-and-list view · 4. Folders · 5. Password generator · 6. Password health · 7. New-entry form · 8. Vault-only settings.

**Phase it at the schema boundary:** surfaces that need no schema change ship first; the ones that expand the schema (folders, generator, health — verify which against the real schema, do not trust this list) ship second. **Mockup before any interface work, every time** — Jason walks it and redlines before you build. He is a visual person: give him something to react to before you plan deeply.

---

## 5 · Config-as-data (how this must be built)

- All vault configuration lives in **rows**, read at runtime — never hardcoded, never in the renderer. The vault's own settings table is the store; the app's Settings page stays out of it.
- A failed config read **never** routes to setup or first-run — degrade to a locked shell with a retry that refetches without a restart.
- Governing doc: `Config-AS-Data-SOP-Electron.md` — read §1 through §10, especially §10's tab-strip standard if you draw tabs, and the `.view.shown` specificity trap: a module shell needing flex **must** use `.view.shown.vault-shell { display: flex; }` (three classes) or its rail stacks above its content. The compiler cannot see this.
- Module tokens are `--vault-*` declared on the module shell class, never `:root`. Never a literal colour where a token exists. Proprietary header on every new file.
- Three states are three visibly different things: loading, empty, error. An empty list is **never** rendered over a failed read.

---

## 6 · Where things stand around you

- `HEAD = origin/main = f567141`. The IDE is working on a seed-data and schema-lifecycle rebuild — it will touch `firstrun`, boot, and both TimeTracker and Employees. Expect its commits; none of it is yours.
- **Known live defect, do not be surprised by it:** on a fresh org, first-run creates only four tables (`app_settings`, `modules`, `device_provenance`, `scout_targets`) — no module schema is ensured until that module is opened. The IDE is fixing this. **Your vault code must ensure its own schema on its own context, idempotently**, and must not assume any other module has ever run.
- Canon lives in `CANON/` — list it, load the **highest-numbered** file of each kind. Never hardcode a canon version number.
- `CANON-UPDATES.md` — you SUGGEST canon corrections there with file:line receipts, tagged CONTRADICTS / STALE / GAP. You never edit a canon file and never apply your own suggestions.
- Where canon or spec is silent, STOP and record the question. Jason rules; agents record.

---

## 7 · What to do first

1. Read everything in §3, then canon, then the mockup.
2. Write `reports/REPORT-vault-standalone-recon-<date>.md` — what exists, what the eight surfaces need, what the master-password gate touches, and every open question with a lean flagged as a lean. **file:line receipts or NOT FOUND. Decide nothing.**
3. Stop there and wait for Jason's rulings before designing or building. He will want a mockup before any interface code.
