// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: The launch step that encrypts tax numbers an older version stored plain. It hands
//              taxMigration.ts its real parts: the live database, the org's Windows-wrapped key,
//              and the SAME full backup the Backup button runs, into the same folder. What happened
//              is kept as one sentence until the page asks for it, once, after boot.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/employees/taxBoot.ts
//------------------------------------------------------------
import { runDataCopy } from "../data/copyAllIpc";
import type { Db } from "./db";
import { taxCryptoFor } from "./taxCrypto";
import { countLegacyTax, migrateTaxNumbers, runTaxMigration, taxMigrationNotice, type TaxNotice } from "./taxMigration";

let waiting: Promise<TaxNotice | null> = Promise.resolve(null);

/**
 * Not awaited by the launch: the backup that has to come first can take minutes, and the window
 * must not wait for it. Running beside a live app is safe. A number saved in the meantime is
 * already encrypted and is skipped, and the migration itself is one synchronous transaction.
 */
export function startTaxMigration(db: Db, orgId: string): void {
  waiting = runTaxMigration({
    countLegacy: () => countLegacyTax(db),
    openKey: () => taxCryptoFor(orgId),
    runBackup: runDataCopy,
    migrate: (crypto) => migrateTaxNumbers(db, crypto),
  })
    .then((outcome) => {
      // The reason stays in the console: it can be raw database text, which is not for a toast.
      if (outcome.kind === "rolledBack") console.error("[employees] tax numbers were not encrypted:", outcome.why);
      return taxMigrationNotice(outcome);
    })
    .catch((err: unknown): TaxNotice => {
      console.error("[employees] could not check for plain tax numbers:", err instanceof Error ? err.message : String(err));
      return {
        tone: "err",
        text: "Focal Registry could not check whether employee tax numbers still need encrypting. Nothing was changed. It is tried again at the next start.",
      };
    });
}

/** Handed over once. A page that reloads and asks again is told nothing. The answer waits for the
    backup and the migration, so the page is never told before the work is done. */
export function takeTaxNotice(): Promise<TaxNotice | null> {
  const mine = waiting;
  waiting = Promise.resolve(null);
  return mine;
}
