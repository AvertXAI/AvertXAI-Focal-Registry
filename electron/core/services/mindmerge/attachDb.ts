// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: MindMerge ATTACHMENTS data layer — the module's OWN SQLCipher-ENCRYPTED file
//              (<org_id>.mtd — deliberately dull name, ruled 08-02-2026; obscurity only, SQLCipher
//              is the control). BL-47 stands: pasted-image bytes are encrypted at rest, in their
//              own file, separate from the PLAIN docs db beside it and separate from the vault.
//              The open copies the core openDb() cipher shape (electron/core/services/db/index.ts:89):
//              cipher scheme + key MUST be the connection's FIRST statements, applied before any
//              other pragma (WAL etc.), or an encrypted file is unreadable.
//              THE KEY IS INJECTED (keyHex parameter) so this file stays electron-free and the
//              proof harness runs headless with a test key — safeStorage + argon2 live in
//              attachCrypto.ts and are only touched on the ipc side.
//              Registry-cached per org exactly like openMindMergeDb in ./db.ts. Like the docs db,
//              this module-local registry is NOT part of core closeAllDbs() — parity with the
//              docs db is deliberate, not an invented shutdown mechanism (Phase 5 report covers it).
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/mindmerge/attachDb.ts
//------------------------------------------------------------
import Database from "better-sqlite3-multiple-ciphers";
import path from "node:path";
import { createTable, type Db } from "./db";

// name -> handle, idempotent per org (matches ./db.ts's connection registry).
const registry = new Map<string, Db>();

// Open (or reuse) the attachments db for this org. keyHex is the raw 32-byte SQLCipher key as hex
// (from attachCrypto's derive at merge; a test key in the proof). baseDir is injected
// (app.getPath("userData") at merge; a temp dir in the proof) so the service stays electron-free
// and headless-testable — same doctrine as openMindMergeDb.
export function openAttachmentsDb(orgId: string, baseDir: string, keyHex: string): Db {
  const name = `mindmerge-attach:${orgId}`;
  const existing = registry.get(name);
  if (existing) return existing;
  const db = new Database(path.join(baseDir, `${orgId}.mtd`));
  db.pragma("cipher = 'sqlcipher'"); // fork defaults to ChaCha20 — pin SQLCipher scheme
  db.pragma(`key = "x'${keyHex}'"`);
  db.pragma("auto_vacuum = INCREMENTAL"); // core applyPragmas parity — deletes reclaim space; only takes on a fresh file, and no production .mtd predates this line
  db.pragma("journal_mode = WAL");
  createAttachSchema(db);
  registry.set(name, db);
  return db;
}

/**
 * The stored image — a MIRROR of vault_attachments (electron/core/services/vault/db.ts:314),
 * same columns, same std-columns createTable wrapper (id/uuid/created_at/updated_at). The bytes
 * live HERE, in the encrypted file, and the document body carries only a short reference —
 * `![name](mindmerge://<uuid>)` — never the base64 wall.
 *
 * No foreign key to the document ON PURPOSE, matching the vault's soft-reference doctrine: a
 * document can be deleted while its image is still referenced from a version of the text
 * somewhere, and a dangling reference renders as a missing image, never a crash.
 */
function createAttachSchema(db: Db): void {
  createTable(db, "mindmerge_attachments", [
    "org_id TEXT NOT NULL",
    "name TEXT NOT NULL", // "pasted-image.png" or the pasted file's own name — shown, never parsed
    "mime TEXT NOT NULL",
    "byte_count INTEGER NOT NULL",
    "bytes BLOB NOT NULL",
  ]);
}
