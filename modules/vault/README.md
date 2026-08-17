# Secured Vault — standalone module lane

Everything here is built **inside `modules/vault/`** and is copied into the app later. Nothing in
this folder is wired into the running application yet.

## SEE IT — run the module in its own window

The module is not mounted in Focal Registry (that needs files outside this lane), so this lane
carries its own dev host: one window, the real services, the real vault IPC, against a **throwaway**
database under `dev/.userdata` — never your real vault. From the repo root:

```bash
node modules/vault/dev/build.mjs && npx electron modules/vault/dev/host.cjs
```

The vault opens **locked**. The initial master password is DERIVED from this machine's identity —
SHA-256 over the Windows MachineGuid + SMBIOS hardware UUID, encoded to 16 alphanumerics (ruled
2026-08-14, replacing the old personal-email placeholder). With developer mode on, the lock
screen's "Reveal initial master — dev" control recomputes and shows it. Then: **Vault settings →
Load seed data** puts 46 entries in, and every screen has something to show. Three theme buttons
in the dev bar switch Hybrid / Dark / Light.

Delete `modules/vault/dev/.userdata` any time to start from nothing — it is gitignored, key file
included.

## Run the engine proof

The one command that says whether the vault engine works. It runs the whole engine — schema, lock
gate, create/read/supersede/archive, metadata, version history, access log, generator, health, and
the seed load + exact purge — against an **in-memory** database. It never opens, reads or writes a
real vault file.

From the repo root (`D:\dev\AvertXAI-Focal-Registry`):

```bash
npx esbuild modules/vault/test/engine-proof.ts --bundle --platform=node --format=cjs --external:better-sqlite3-multiple-ciphers --outfile=modules/vault/test/engine-proof.cjs && set ELECTRON_RUN_AS_NODE=1&& npx electron modules/vault/test/engine-proof.cjs
```

Two steps, because the SQLite engine is built for Electron's Node version, not the system one:
`esbuild` bundles the TypeScript, and `ELECTRON_RUN_AS_NODE=1 electron` runs it against the right
binary. Expect `ALL 25 VAULT ENGINE CHECKS PASSED`.

## Type-check the lane

The root `tsconfig.json` only covers `src` and `electron`, so this lane carries its own:

```bash
npx tsc --noEmit -p modules/vault/tsconfig.json
```

## Regenerate the seed dataset

The workbook and the in-app seed loader are emitted from **one** source, so they cannot drift:

```bash
node modules/vault/seed/generate-seed-xlsx.mjs
```

Writes `seed/VAULT-SEED-DATA.xlsx` (46 fake credentials, three letter pages) **and**
`electron/core/services/vault/seed-data.ts` (the same rows, for the in-app Load seed data button).

## What is in here

| Path | Becomes |
|---|---|
| `electron/core/services/vault/` | `electron/core/services/vault/` — schema, services, lock, seed, generator, health, IPC |
| `electron/core/services/{db,utils}/` | **lane shims only** — they re-export the real root modules so the services compile in place with the exact import paths they will use after the copy. They stay behind. |
| `src/modules/vault/` | `src/modules/vault/` — the module interface |
| `seed/` | stays here — a developer tool, never shipped |
| `test/` | stays here — the proof harness |

## The rules this module is built to

- A credential leaves the services through **one** function, `readSecret`, and every ask is written
  to the access log first — hits, misses and refusals. Lists carry metadata only.
- Backup codes and security answers are **credentials**, so they ride the version row with the
  password, never the metadata a list returns.
- A secret value lives in exactly one place: the append-only version history. Superseding appends;
  nothing is ever edited or destroyed. Retirement is a soft archive.
- The vault owns its own settings. The application's Settings page carries no vault controls.
- `localStorage` is banned; view state persists to the vault's own settings table.
- **The master password is a placeholder.** Grep `[master-password-placeholder]`. It gates the
  interface and the IPC surface — it does **not** derive the encryption key, so it stops someone at
  the keyboard, not code running as the same user. The real gate must make the password part of the
  key derivation.
- The vault file names (`<org_id>.atd`, `<org_id>.ixd`) are deliberately dull. That is **obscurity,
  not a security control** — safeStorage, Argon2id and SQLCipher are the protection.
