# 🔒 LOCKED DOWN — Vault

This module has its OWN database file, opened at app boot on a separate handle, **encrypted at rest**.

## Envelope Encryption architecture (implemented)

- **File:** `<org_id>.atd` (under Electron `userData`; one per org, routed by the platform registry). The name is **deliberately dull** (ruled 08-02-2026) — no "vault", no ".locked" — so the file does not announce itself to anyone browsing the folder. **This is obscurity, not a security control**: the protection is the SQLCipher encryption below, and the master password that does not exist yet. SQLite's `-wal`/`-shm` sidecars follow the name automatically.
- **Encryption:** SQLCipher (forced via `PRAGMA cipher = 'sqlcipher'` — the `better-sqlite3-multiple-ciphers` engine defaults to ChaCha20, so the scheme is pinned explicitly). Cipher + key pragmas run as the connection's first statements, before WAL/FK pragmas, in `openDb()`.
- **Key Management (Envelope Encryption):** a 32-byte random secret is generated on first run, encrypted via the OS native keychain (Electron's `safeStorage` / DPAPI on Windows), and stored alongside the DB as `<org_id>.ixd` (same dull-name ruling — no ".key" suffix inviting a look). The plaintext secret never touches the repo, the DB, or `app_settings`.
- **Key Derivation:** on boot, the secret is decrypted via `safeStorage` and hashed with **Argon2id** using a deterministic fixed salt (`avertxai-vault-kdf-v1`) to derive the raw 32-byte hex key passed to SQLCipher. The salt MUST stay fixed — a random salt would derive a different key each boot and permanently lock the vault; per-install uniqueness comes from the random secret.

Implementation: [electron/core/services/vault/crypto.ts](../../../electron/core/services/vault/crypto.ts) (secret + derivation), [electron/core/services/db/index.ts](../../../electron/core/services/db/index.ts) (`openDb` cipher/key pragmas), wired in `firstrun` (vault born encrypted) and `main.ts` (boot).

## Still open (second layer, when the module gets real)

- Value-level encryption of sensitive fields as defense-in-depth on top of SQLCipher.
- Note the trust boundary: `safeStorage`/DPAPI protects the key file from *other users and offline theft*, not from code running as the same OS user.
