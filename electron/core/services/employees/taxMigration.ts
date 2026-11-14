// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: The one-time encryption of tax numbers an older version stored plain. Three pieces,
//              all Electron-free so they run against a throwaway database: the count of values
//              still plain, the migration itself (one transaction, every value read back before
//              the commit), and the order the launch runs things in. The order is the safety: no
//              value is touched unless a full backup finished in this same launch, so the way back
//              is always a folder that was written minutes earlier.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/employees/taxMigration.ts
//------------------------------------------------------------
import type { Db } from "./db";
import { isEncryptedTax, type TaxCrypto } from "./taxCrypto";

export interface TaxMigrationCounts {
  encrypted: number;
  alreadyEncrypted: number;
}

interface StoredTax {
  id: number;
  ssn: string;
}

// An empty string is "no number on file", the same as NULL, and is never encrypted.
const stillPlain = (ssn: string): boolean => ssn.trim() !== "" && !isEncryptedTax(ssn);

function storedTaxes(db: Db): StoredTax[] {
  return db.prepare(`SELECT id, ssn FROM employee_people WHERE ssn IS NOT NULL ORDER BY id`).all() as StoredTax[];
}

export function countLegacyTax(db: Db): number {
  return storedTaxes(db).filter((row) => stillPlain(row.ssn)).length;
}

/**
 * Encrypts every value that is still plain, in one transaction. Each one is read back out of the
 * database and compared with the original before the commit; one that differs throws, and the
 * whole transaction rolls back, so the table is either all as it was or all encrypted. Safe to run
 * again: a value that is already encrypted is left exactly as it is.
 */
export function migrateTaxNumbers(db: Db, crypto: TaxCrypto): TaxMigrationCounts {
  const write = db.prepare(`UPDATE employee_people SET ssn = ? WHERE id = ?`);
  const readBack = db.prepare(`SELECT ssn FROM employee_people WHERE id = ?`);
  const run = db.transaction((): TaxMigrationCounts => {
    const counts: TaxMigrationCounts = { encrypted: 0, alreadyEncrypted: 0 };
    for (const row of storedTaxes(db)) {
      if (isEncryptedTax(row.ssn)) counts.alreadyEncrypted += 1;
      if (!stillPlain(row.ssn)) continue;
      write.run(crypto.encrypt(row.ssn), row.id);
      const now = (readBack.get(row.id) as { ssn: string }).ssn;
      if (!isEncryptedTax(now) || crypto.decrypt(now) !== row.ssn) {
        throw new Error("A tax number did not read back the same after it was encrypted.");
      }
      counts.encrypted += 1;
    }
    return counts;
  });
  // SQLite frees the old row bytes without clearing them, so the plain numbers would stay readable
  // in the file with any hex viewer. With this on, the freed bytes are overwritten with zeros.
  db.pragma("secure_delete = ON");
  const counts = run();
  try {
    // The main file keeps the old pages until the write-ahead log is folded back into it.
    db.pragma("wal_checkpoint(TRUNCATE)");
  } catch (err) {
    // The numbers are committed by now. A throw from here would be reported as "put back as it
    // was", which would be false; the next ordinary checkpoint folds the log back just the same.
    console.error("[employees] the log could not be folded back after encrypting:", err instanceof Error ? err.message : String(err));
  }
  return counts;
}

export type TaxMigrationOutcome =
  | { kind: "none" }
  | { kind: "encrypted"; count: number; folder: string }
  | { kind: "noKey"; why: string }
  | { kind: "backupFailed"; why: string }
  | { kind: "rolledBack"; why: string; folder: string };

export interface TaxMigrationParts {
  countLegacy(): number;
  /** Throws a plain sentence when the key cannot be opened. */
  openKey(): TaxCrypto;
  runBackup(): Promise<{ ok: true; path: string } | { ok: false; error: string }>;
  migrate(crypto: TaxCrypto): TaxMigrationCounts;
}

const said = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * What a launch does about plain tax numbers, in the only order that is safe. Nothing to encrypt:
 * nothing runs, not even the backup. The key is opened before the backup, so a PC that cannot
 * open it does not gain a full backup at every launch. The migration runs only after a backup
 * that finished in this launch.
 */
export async function runTaxMigration(parts: TaxMigrationParts): Promise<TaxMigrationOutcome> {
  if (parts.countLegacy() === 0) return { kind: "none" };
  let crypto: TaxCrypto;
  try {
    crypto = parts.openKey();
  } catch (err) {
    return { kind: "noKey", why: said(err) };
  }
  let copy: Awaited<ReturnType<TaxMigrationParts["runBackup"]>>;
  try {
    copy = await parts.runBackup();
  } catch (err) {
    copy = { ok: false, error: said(err) };
  }
  if (!copy.ok) return { kind: "backupFailed", why: copy.error };
  try {
    return { kind: "encrypted", count: parts.migrate(crypto).encrypted, folder: copy.path };
  } catch (err) {
    return { kind: "rolledBack", why: said(err), folder: copy.path };
  }
}

export interface TaxNotice {
  text: string;
  tone: "ok" | "err";
}

/** The one thing the page says about it after the launch. Sentences and the backup folder only:
    no number, masked or not, and no raw error text from the database. */
export function taxMigrationNotice(outcome: TaxMigrationOutcome): TaxNotice | null {
  switch (outcome.kind) {
    case "none":
      return null;
    case "encrypted":
      return {
        tone: "ok",
        text: `Employee tax numbers are now encrypted on this PC. A full backup was made first, in ${outcome.folder}. That backup still holds the numbers unencrypted.`,
      };
    case "noKey":
      return {
        tone: "err",
        text: `Employee tax numbers were not encrypted at this start. ${outcome.why} Nothing was changed and no backup was made. It is tried again at the next start.`,
      };
    case "backupFailed":
      return {
        tone: "err",
        text: `Employee tax numbers were not encrypted at this start, because the backup that has to come first did not finish. ${outcome.why} Nothing was changed. It is tried again at the next start.`,
      };
    case "rolledBack":
      return {
        tone: "err",
        text: `Encrypting the employee tax numbers did not finish, so every number was put back as it was. It is tried again at the next start. The backup made just before is in ${outcome.folder}.`,
      };
  }
}
