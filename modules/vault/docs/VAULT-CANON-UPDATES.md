# VAULT-CANON-UPDATES.md

Canon corrections **proposed** from the vault lane. Jason rules; agents record. Nothing here has
been applied, and no canon file has been touched — per his instruction 08-06-2026, vault-lane canon
suggestions live in this file rather than the repo-root `CANON-UPDATES.md`.

Format follows the standing convention: tag · what canon says · reality · evidence · suggestion ·
severity. Append only.

---

## [GAP] 2026-08-06 — canon has no rule for WHICH credential fields may appear in a list
**Canon says:** `FR-DECISIONS-4` §Storage rules that secrets never live in the shared database and
that the Vault keeps its own SQLCipher file. It says nothing about the split *inside* the vault
between metadata a list may return and credential material that may leave only through a logged
single read.
**Reality:** the vault now stores three kinds of credential — the password, backup codes, and
security-question answers — plus five presentation fields (full name, username, website, notes,
favourite). Without a stated rule, the obvious implementation puts all eight in one row and returns
them together, which would put backup codes on every screen that renders a table. The lane's rule:
**metadata lives on `vault_secrets`, credentials live on the version row**, so `listSecrets` cannot
carry one by construction (`store.ts` `META_COLS` vs `CURRENT_VALUE`).
**Evidence:** `modules/vault/electron/core/services/vault/db.ts` (the two column sets and the block
comment explaining the split); `store.ts` `META_COLS`; `test/engine-proof.ts` check 4 asserts no
list row carries `value` or `extras`, and check 13 asserts the access log contains zero credential
bytes across 46 seeded passwords.
**Suggestion:** add one line to `FR-DECISIONS` §Storage: "Inside the Vault, a credential — password,
backup code, or security answer — lives on the append-only version row and leaves only through the
single logged read. Presentation fields live on the secret row and may appear in lists."
**Severity:** worth-fixing (the rule is now implemented and proven; canon should own it so a future
module does not have to re-derive it)

## [GAP] 2026-08-06 — no canon rule that a module's own settings may live outside `app_settings`
**Canon says:** `FR-DECISIONS-4` §Storage: "**`localStorage` is BANNED.** All persisted state goes
to `app_settings` via service → IPC → preload, and every new key joins `RENDERER_KEYS`."
**Reality:** the Vault's settings deliberately do **not** go to `app_settings`. They live in a
`vault_settings` table inside the encrypted vault database, because canon separately rules that the
application's Settings page carries no vault controls — and a vault reconfigurable from outside
itself hands an attacker a lever. Read literally, the `app_settings` rule forbids what the vault
ruling requires. The lane keeps the *doctrine* (rows read at runtime, no `localStorage`, a
whitelist of writable keys) while moving the *location*.
**Evidence:** `modules/vault/electron/core/services/vault/settings.ts` (`VAULT_DEFAULTS` as the
single source of truth, `VAULT_WRITABLE_KEYS` as the vault's own `RENDERER_KEYS`, and
`getInternal`/`setInternal` for values the bridge must never reach); `test/engine-proof.ts` check 10
proves an internal key is unreachable through the writable path.
**Suggestion:** amend the `app_settings` line to: "…goes to `app_settings` — **except a locked
module, which keeps its settings inside its own encrypted database with its own writable-key
whitelist.** `localStorage` remains banned everywhere."
**Severity:** worth-fixing (an agent following the current wording literally would put vault
settings in the shared database, which the vault ruling exists to prevent)

## [CONTRADICTS] 2026-08-06 — canon's "not-built = plain page, never orange" is narrower than practice
**Canon says:** `FR-DECISIONS-4`: "Not-built modules open a **plain explanatory page**, not the
orange glow. THIS PRODUCT ONLY; `--mc-orange` stays declared." `CLAUDE.md` §3.6 repeats it.
**Reality:** Jason ruled on 08-06-2026 that orange remains valid *inside* a built surface as a
reference marker for a feature that does not exist yet — "orange, is for things not created yet.
used as a reference by me. its ok to use it if thats what your asking." The canon sentence is about
a whole MODULE's landing page shown to a paying customer; it was being read as a blanket ban on the
token anywhere in this product.
**Evidence:** Jason's ruling in session 08-06-2026; applied at
`modules/vault/src/modules/vault/VaultSettingsView.tsx` (the Import / Export card carries an orange
border and a "Not built" chip), against `src/modules/employees/employees.css:11-16`, whose comments
avoid `--mc-orange` entirely on the earlier reading.
**Suggestion:** clarify to: "A not-built **module** opens a plain explanatory page — never the
orange glow. Within a built module, `--mc-orange` may mark an individual surface that is mapped but
not yet wired."
**Severity:** cosmetic, but it will keep costing sessions — two modules have already routed around
the token on the stricter reading

## [GAP] 2026-08-06 — the master-password seam is now real code, and canon does not describe it
**Canon says:** nothing. `src/modules/vault/LOCK-ME-DOWN.md` carries a standing flag that no master
password exists; canon itself is silent.
**Reality:** a placeholder gate now exists — `[master-password-placeholder]` in
`modules/vault/electron/core/services/vault/lock.ts` — seeded with Jason's own email by his ruling
08-06-2026, stored as a scrypt verifier and salt (never plaintext), gating the IPC surface through
one `gated()` funnel in `ipc.ts`. **It does not derive the SQLCipher key**, so it stops someone at
the keyboard and nothing else; the file still opens automatically from safeStorage.
**Evidence:** `lock.ts` (header block states the limitation in full); `ipc.ts` `gated()`;
`test/engine-proof.ts` checks 2 and 16 prove it starts locked, counts and records failures, and
honours its own setting.
**Suggestion:** record in `FR-DECISIONS` §Vault: "The master password is a PLACEHOLDER that gates
the interface and the IPC surface only. Making it part of the key derivation is a separate, ruled
build. Every seam is marked `[master-password-placeholder]`."
**Severity:** worth-fixing (without it, a future reader may believe the vault is password-protected
at rest, which it is not)

## [GAP] 2026-08-06 — no canon rule on purging append-only audit rows
**Canon says:** append-only tables are structural throughout (`timetracker_event_log`,
`employee_event_log`, `vault_access_log`); nothing states whether a test-data purge may remove its
own audit rows.
**Reality:** Jason ruled 08-06-2026 that purging seed data removes it "completely", which the lane
implements as: the seeded secrets, their versions, **and their access-log rows**, scoped by an exact
ledger. Rows the user's own work produced are untouched. This is a deliberate, ruled exception, and
the purge itself is recorded so the deletion is not invisible.
**Evidence:** `modules/vault/electron/core/services/vault/seed.ts` (`purgeSeed`, ledger-scoped);
`test/engine-proof.ts` check 14 proves the hand-made entry and its versions survive, seeded log rows
are gone, and a `purge` row remains on the record.
**Suggestion:** add: "A seed/demo purge may delete the audit rows it created itself, scoped by an
exact ledger, and must record the purge. No other path may delete an audit row."
**Severity:** worth-fixing (the next module to grow a seed loader will face the identical question)

## [GAP] 2026-08-06 — `.gitignore`'s `*secret*` and `*backup*` patterns silently untrack source
**Canon says:** nothing about repository ignore patterns colliding with source filenames.
**Reality:** `.gitignore:10-11` carry blanket `*secret*` and `*backup*` guards for credential
material. Any source file whose NAME matches is silently untrackable — it compiles, builds, and is
missing from a fresh clone. This already happened once: the vault service was first written as
`secrets.ts`, caught only because `git status` did not list it, and renamed to `store.ts`.
**Evidence:** `git check-ignore -v electron/core/services/vault/secrets.ts` →
`.gitignore:10:*secret*`; the rename is recorded in
`reports/vault/REPORT-vault-p1-08-01-2026.md` §6.
**Suggestion:** add to `FR-RULES` §Build discipline: "Never name a source file `*secret*` or
`*backup*` — `.gitignore` will silently untrack it. Vault service files use `store`, `lock`, `seed`."
**Severity:** worth-fixing (silent, and the failure only appears on someone else's machine)

---

## [GAP] 2026-08-10 — §4.1 "no pixels, ever" does not distinguish the photo archive from a vault attachment
**Canon says:** repo `CLAUDE.md` §4.1 "Data only — no pixels": *"No thumbnails are generated or
saved. Ever. This is strict. No preview extraction, no proxy files, no image decode. Metadata reads
only."*
**Reality:** §4.1 is written about the **Scan** module — the rule's intent is that Focal Registry
never decodes, renders, or stores pixel data from the photographer's *image library*. It is silent
on a user pasting a screenshot or a PDF into their own **encrypted vault note** (V-14) or storing a
bank statement against an entry (V-15). These are user-authored attachments in an encrypted store,
not decoded frames from the archive — the opposite case from the one §4.1 guards.
**Evidence:** §4.1 sits under "PART 4 — PRODUCT RULES SPECIFIC TO FOCAL REGISTRY" alongside §4.2
(Scan covers video/audio) and §4.5 (long scan jobs) — every neighbouring rule is about Scan reading
a drive. The Vault section (§3.9, and the whole phase-2 backlog V-13/V-14/V-15) treats attachments
as encrypted blobs behind an envelope pointer, never decoded for display beyond a cheap preview.
**Jason's ruling (08-10-2026):** **attachments ARE allowed in the vault** — encrypted at rest via
the envelope blob store, previewed where cheap (images/PDF), download-to-view for heavy media. §4.1's
"no pixels" continues to bind Scan and the archive, unchanged.
**Suggestion:** scope §4.1's opening line to its subject — e.g. "This product does not render,
decode, or store pixel data **from the photographer's archive**." Add to the Vault rules: "The Vault
MAY store user-authored attachments (screenshots, PDFs, media) as individually-encrypted blobs with
a vault-held pointer; it never decodes archive imagery." So the two rules stop appearing to collide.
**Severity:** worth-fixing (a builder reading §4.1 literally would refuse a feature Jason has ruled in)

## [CONTRADICTS] 2026-08-11 — canon names Tiptap as the markdown editor; the vault ships Milkdown, and now Markdoc for rendering
**Canon says:** *"Markdown editor: **Tiptap** (MIT core) with a Markdown serializer, for **authored** notes only. Generated artifacts such as scan reports stay read-only through the existing renderer"* (repo `CLAUDE.md` §3.1, and the same line at `CANON/FR-DECISIONS-4.md:29`).
**Reality:** Tiptap was never installed. The vault's authored-notes editor is **Milkdown** (`@milkdown/kit@^7.22.0`, root `package.json` dependencies), chosen by Jason on 08-10-2026 and built on 08-11-2026 — the file header at `src/modules/vault/MilkdownEditor.tsx` records that only `/core`, the presets, `/plugin/listener`, `/plugin/history` and `/utils` are imported, deliberately avoiding `@milkdown/react` and `@milkdown/crepe` because both depend on `@milkdown/components`, which depends on Vue. On 08-11-2026 Jason additionally ruled **Markdoc** (`@markdoc/markdoc@0.5.9`) in as the READ-ONLY renderer — "research MarkDoc supposedly stripe.com/docs uses it. id like to use it also… rather than milkdown or tiptap". The two are not alternatives: Markdoc has no editor, so it replaced the hand-rolled regex renderer in `src/modules/vault/markdown.tsx` while Milkdown remains the typing surface. Canon's second sentence — generated artifacts stay read-only through the existing renderer — still holds, but "the existing renderer" is now Markdoc.
**Evidence:** `npm ls @markdoc/markdoc` → `@markdoc/markdoc@0.5.9` (MIT, zero runtime dependencies, 2.17 MB unpacked, `npm view` 08-11-2026); root `package.json` dependencies now carry `@markdoc/markdoc` and `@milkdown/kit`, and carry no `@tiptap/*` entry; `grep -rn "tiptap" modules/vault/` → no match. Milkdown's installed footprint measured at 6.2 MB (`node_modules/@milkdown`) plus ~3.4 MB of `prosemirror-*`.
**Suggestion:** replace the `CLAUDE.md` §3.1 / `FR-DECISIONS-4` line with: "Markdown editor: **Milkdown** (MIT, core + commonmark + gfm presets only — never `@milkdown/react` or `/crepe`, both of which pull in Vue) for **authored** notes. Markdown RENDERING is **Markdoc** (MIT, zero dependencies), which also draws generated artifacts read-only. Tiptap was evaluated and never adopted."
**Severity:** worth-fixing (a future agent told to "use the canon editor" would install a third markdown library into a module that already has two doing distinct jobs)

## [GAP] 2026-08-11 — canon has no rule that a native dialog must be parented, and an unparented one hangs the app on Windows
**Canon says:** nothing. `FR-DECISIONS-4` covers the single-window shell and its sanctioned extra windows; no canon file mentions `dialog.showOpenDialog` or window parenting.
**Reality:** all four native dialogs in the vault were called with no parent window — `dialog.showOpenDialog({…})` rather than `dialog.showOpenDialog(win, {…})`. On Windows an unparented common-file-dialog is owned by nothing, so the shell's preview pane and its namespace extensions have no window pumping their messages; Jason hit the result on 08-11-2026 importing an Infrastructure document — the picker painted "Working on it…", then went to "(Not Responding)" with no way out but killing the process. Fixed by routing every dialog through `showOpen()`/`showSave()` helpers that resolve the requesting window via `BrowserWindow.fromWebContents(event.sender)`, so no future handler can forget it. Note this is a whole-shell exposure, not a vault one: the same unparented pattern will exist anywhere else a dialog was added.
**Evidence:** `electron/core/services/vault/ipc.ts` before the fix — unparented calls at the `vault:chooseImportFile`, `vault:chooseFolders`, `vault:chooseFiles` and `vault:exportVault` handlers; Jason's screenshots 08-11-2026 (dialog title "Choose one or more files (Not Responding)", host window greyed). After: `showOpen`/`showSave` + `parentOf()` in the same file.
**Suggestion:** add a standing rule to canon's Electron section: **"Every native dialog is parented to the requesting window — `dialog.showOpenDialog(win, …)`, resolved from `BrowserWindow.fromWebContents(event.sender)`. An unparented dialog hangs on Windows and presents to the user as a frozen app."** Then audit the other modules for the same call shape.
**Severity:** blocking (it presents to a user as the application having crashed, with data loss the plausible next step)

## [GAP] 2026-08-11 — no module had an error log, and raw technical errors were reaching the user
**Canon says:** `FR-DECISIONS-4` §Errors rules **Bugsink** for automatic capture and a user-initiated "Report bug" with a notes field, both **not built**. It is silent on what a module records locally, and on what a user is shown when something fails.
**Reality:** Jason, 08-11-2026: *"i have no logs… when something breaks, the app spits out a error only i would understand not a normal oh shit something broke contact the developer to the user."* Both halves were true — there was no log table anywhere in the vault beyond `vault_access_log` (which answers "who asked for which secret", not "what broke"), and every IPC failure rethrew its raw message straight to the renderer, which rendered it verbatim. Built this session as the first instance of a pattern the shell does not have yet: `vault_event_log` (four levels — debug/info/warn/error — with timestamp, org, actor, area, channel, message, stack) plus a **request id** (`VLT-XXXXXX`) that is shown to the user inside a plain sentence and stamped on the log row, so a six-character quote from a support message finds the technical detail. The classifier is the convention already present in the services and not a new one: a complete short sentence ("The vault is locked.") is shown as-is; a developer fragment ("Invalid note locator") and anything library-shaped (`SQLITE_ERROR:`, `ENOENT:`) is replaced by a generic apology carrying the same reference.
**Evidence:** `electron/core/services/vault/log.ts` (new — `logEvent`, `listEvents`, `isUserFacing`, `presentableMessage`, `newRequestId`); `db.ts` `vault_event_log` createTable plus its two indexes; `ipc.ts` `safeHandle` now wraps every handler as the single error boundary; `vault:logClient` carries renderer-side failures across, since a React crash never reaches a main-side boundary; `test/notes-proof.ts` 17 checks, including that `SQLITE_ERROR: no such column: secret_value` never reaches the user. Level floor is a setting (`log.min_level`, default `info`), not a build flag, so a problem on Jason's machine can be traced without shipping a different binary.
**Suggestion:** promote this to a shell-level rule before the next module is built, so each one does not invent its own: **"Every module keeps a four-level event log with a request id. A user is never shown a raw error — they are shown a sentence and the reference, and the reference is what reaches the developer."** The Bugsink and Report-bug rulings then sit on top of this rather than replacing it: the reference id is what a bug report should quote.
**Severity:** worth-fixing (built and working for the Vault; the gap is that nothing obliges the next module to do the same)

## [CONTRADICTS] 2026-08-11 — Jason has asked for GitHub fetching in Repos; three code sites say the vault never reaches the network
**Canon says:** the vault's only network features are the two breach checks, and they are off until enabled. Stated in three places in the code rather than in a canon file: *"Dark-web exposure. The **ONLY** network calls in the vault; both are off until enabled"* (`src/modules/vault/vaultApi.ts:152`); *"pasted snapshot — the vault never fetches it (two network features, both on Health)"* (`electron/core/services/vault/db.ts:213`); *"The vault never reaches out to GitHub — the snapshot is what makes it readable offline"* (`src/modules/vault/ReposView.tsx:138`). No `FR-*` file carries the rule, which is itself part of the problem — it is load-bearing and lives only in comments.
**Reality:** Jason ruled on 08-11-2026 that Repos should read a repository from a URL ("if i enter a URL the research should be almost instant") and that the repo surface "is suppose to pull data off the internet from the selected repo's", plus a package ledger populated from real data. That is a third network feature, in the module whose entire premise is that it is the offline-safe encrypted store. Two consequences worth recording beside the ruling: (1) querying GitHub discloses to GitHub which repositories this machine tracks, including the fact that a given private repo is of interest; (2) private repos need a Personal Access Token, which becomes a stored credential the vault itself then depends on — a circular dependency the breach checks do not have.
**Evidence:** the three comment sites above, read 08-11-2026. Mockup `docs/MOCKUP-vault-search-import-repos-v1-08-11-2026.html` §3–4 designs it with three mitigations: fetch is a per-repo button and never automatic, the token is an ordinary vault entry rather than a new secret store, and every fetched value is persisted as a snapshot so the surface still renders with the network off.
**Suggestion:** promote the rule into `FR-DECISIONS` explicitly rather than leaving it in comments, and amend it in the same stroke: **"The vault makes network calls from exactly three features — the two breach checks and the Repos fetch. All three are user-initiated, all three are off by default, and all three persist what they retrieve so every surface still reads with the network off."** Then correct the three comments, which will otherwise read as false the day Repos ships.
**Severity:** worth-fixing (the ruling is Jason's to make and is made; the risk is that three code comments keep asserting the opposite and a later agent "fixes" the fetch back out)

## [GAP] 2026-08-11 — the shared document importer writes to Notes whatever tab opened it
**Canon says:** nothing about import destinations. `FR-DECISIONS-4` covers what the Vault stores, not how a file gets in.
**Reality:** `vault:importDocs` calls `notes.importDocs` unconditionally. The `target` argument ("notes" | "infra" | "repos") is used ONLY to choose the file-dialog filter in `FILE_FILTERS` and never reaches the write. So importing a DNS zone export from the Infrastructure tab creates a Secured Note containing the file's text in a fence — which is why the modal offered "All as Notes / Runbooks / Snippets" on the Infrastructure tab, and why Jason's `avertxai.com.txt` did not appear in Servers & DNS on 08-11-2026 ("i imported a avertxai.com.txt file but where did it land? and where did it load at? it didnt"). The zone parser that WOULD have handled it correctly already exists and is proven (`infra.parseZone`, redesign-proof 9 checks) — it simply is not on this path.
**Evidence:** `electron/core/services/vault/ipc.ts` `vault:importDocs` handler (calls `notes.importDocs`, no target parameter); `vault:chooseFiles` (the only consumer of `target`); `electron/core/services/vault/sources.ts` `FILE_FILTERS`; `electron/core/services/vault/infra.ts` `parseZone` unreferenced from the import path.
**Suggestion:** the importer takes a DESTINATION, not a file-type hint, and the destination list is the tab's own (Infrastructure → DNS records · Servers · SSH keys; Notes → Notes · Runbooks · Snippets; Repos → Repositories · Docs · Package manifest). Design in `docs/MOCKUP-vault-search-import-repos-v1-08-11-2026.html` §2.
**Severity:** blocking (a user's file silently lands somewhere they did not ask for, and the correct parser is bypassed)

## [STALE] 2026-08-11 — the network CONTRADICTS entry above is RESOLVED: MindMerge fetches, the Vault does not
**Canon says:** my own entry above, "Jason has asked for GitHub fetching in Repos; three code sites say the vault never reaches the network", which proposed amending the rule to allow a third Vault network feature.
**Reality:** Jason ruled the opposite and better way on 08-11-2026, within the hour: *"lets create it, but gut it out for MindMerge - so its ok if it makes calls online now."* The repo reader moves to **MindMerge**, which is already the Tier-1 agent-readable store holding Vault pointers and never values (`FR-DECISIONS-4` Storage). The Vault keeps its no-network property completely intact, and **the three code comments stay true as written** — `vaultApi.ts:152`, `db.ts:213` and `ReposView.tsx:138` need no amendment, which is the strongest signal that this is the right seam rather than a workaround. The proposed canon amendment in the entry above should therefore NOT be made.
**What actually landed this session:** the Package ledger moved out of Repos to the Infrastructure tab, between SSH keys and Import records (`src/modules/vault/PackageLedger.tsx` extracted from `ReposView.tsx`; `InfraView.tsx` Tab union and tab strip; `Sidebar.tsx` rail rows) — it reads `package.json`, the lockfile and a folder walk, so it never needed the network either. `ReposView.tsx`'s header comment now records why the online reader is elsewhere.
**Evidence:** `src/modules/vault/PackageLedger.tsx` (new, header states the move and the no-network property); `src/modules/vault/InfraView.tsx` `type Tab = "servers" | "ssh" | "packages" | "import"`; `grep -rln "fetch|net\.|https" electron/core/services/mindmerge/` returns nothing, so the MindMerge side is greenfield; design in `docs/MOCKUP-vault-search-import-repos-v1-08-11-2026.html` section 3; full build brief written to `D:\dev\_source\AvertXAI-Focal-Registry\R&D-Backlogs\mindmerge-R&D-backlog-01.md`.
**Suggestion:** when the MindMerge reader ships, add ONE sentence to canon rather than amending the Vault rule: **"MindMerge may reach the network; the Vault may not, except the two breach checks. A repository is read by MindMerge and, if it needs a deploy key, pointed at from Vault Repos — never the reverse."**
**Severity:** worth-fixing (bookkeeping — the entry above must not be actioned as written, or the Vault's no-network property gets amended away for no reason)

## [GAP] 2026-08-12 — Secured Notes could lose a body silently; canon has no autosave rule
**Canon says:** nothing about when an editor must persist. `FR-DECISIONS-4` covers where data lives, never when it is written.
**Reality:** Jason reported "sometimes when i save to db, and restart the app, the db isnt saved, so i would be losing all that data". It was NOT a database durability problem. `NotesView` wired `onBlur={save}` on the TITLE input and nothing at all on the Milkdown body, so typing in the body only set `dirty` — the text reached `vault_notes` only via Ctrl+S, the Save now button, or blurring the title. Closing the app after typing meant the body had never been sent over IPC at all. `openNote()` was worse: it overwrote the unsaved draft with a freshly fetched note, so clicking another row in the list silently discarded the edit. The on-screen hint read "Unsaved - Ctrl+S, or click away", and clicking away from the body did nothing.
**Evidence:** `src/modules/vault/NotesView.tsx` before the fix — `<input className="vault-notetitle" ... onBlur={save} />` versus `<MilkdownEditor onChange={(md) => { setDraft(md); setDirty(true); }} />` with no blur, no timer and no unmount handler; `openNote()` called `setCurrent/setDraft/setTitle` with no preceding write. Separately, no connection was ever closed: `dev/host.ts` had only `window-all-closed -> app.quit()`, so the WAL sidecar was never checkpointed (recoverable, but it made "did it save?" unanswerable from the files).
**Fixed 08-12-2026:** debounced autosave at 1.2 s, a `live` ref so a flush writes the note it belongs to even mid-switch, flush before `openNote`, flush on unmount and on `beforeunload`, and `closeAllDbs()` on `will-quit` running `wal_checkpoint(TRUNCATE)`.
**Suggestion:** a standing rule — **"Any editor holding user text autosaves on a timer AND flushes before the record changes, before unmount, and before the window closes. Save-on-blur alone is not a save path; a control the user never blurs never fires."** This is the second time a surface has looked correct while silently not persisting, and it presents to the user as database corruption rather than as a UI bug, which sends the diagnosis in exactly the wrong direction.
**Severity:** blocking (silent loss of user work)

## [GAP] 2026-08-12 — no compaction anywhere; "VACUUM on delete" measured 2000x worse than the alternative
**Canon says:** "Retention: keep everything. No automatic rolloff." Silent on reclaiming space from what IS deleted.
**Reality:** SQLite never returns deleted space to the operating system on its own — freed pages are reused, so the file stays at its high-water mark. Jason's dev `.atd` measured **77.84 MB**. He proposed running VACUUM on every delete to "kill two birds with one stone". Measured at his real scale (76 MB, 2,050 notes, SQLCipher on): a full VACUUM after ONE delete cost **2,158 ms and reclaimed nothing**, while `PRAGMA incremental_vacuum` after the same delete cost **0 ms**; both reclaim the identical 76.1 -> 7.4 MB once real garbage exists. So VACUUM-per-delete is roughly **2000x the cost for no gain**, and ten deletes would have frozen the UI for ~21 seconds.
**Evidence:** benchmark run 08-12-2026 through `ELECTRON_RUN_AS_NODE` against the Electron-built `better-sqlite3-multiple-ciphers`, encrypted, WAL, 38 KB rows. Built: `auto_vacuum = INCREMENTAL` set in `openDb` before any table exists, `incremental_vacuum` after `destroyNote`, and `compactDb()` behind a "Compact the vault" button in Vault settings that also converts a legacy file to incremental mode.
**Suggestion:** record the shape as a rule — **"Housekeeping that scales with the whole file never runs on a per-row path. Measure before choosing automatic."** Also worth noting for other modules: the shared org database has the same high-water-mark behaviour and no compaction path at all.
**Severity:** worth-fixing (built for the Vault; the shared database still has no compaction, and the per-delete proposal would have been a visible regression had it shipped)
