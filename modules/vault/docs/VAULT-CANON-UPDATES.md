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
