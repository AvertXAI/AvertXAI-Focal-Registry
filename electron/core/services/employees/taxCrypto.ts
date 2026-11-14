// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Employee tax numbers, encrypted one value at a time. The shared org database is not
//              encrypted as a file, so employee_people.ssn holds AES-256-GCM text instead of the
//              number. The 32-byte key is random, lives at <org_id>.exd beside the databases, and is
//              wrapped by Electron safeStorage (Windows DPAPI), the same way <org_id>.mxd is.
//              THE HONEST LIMIT, the same one attachCrypto.ts states: this protects the number AT
//              REST, in a copied database, a walked backup or a stolen drive. It does not protect
//              against code already running as this Windows user, which can ask Windows to unwrap
//              the key exactly as the app does.
//              A stored value that starts with TAX_PREFIX is encrypted. Anything else was stored
//              plain by an older version and is still read, until taxMigration.ts has encrypted it.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/employees/taxCrypto.ts
//------------------------------------------------------------
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Versioned, so a later change of cipher or layout can tell its own values from these.
export const TAX_PREFIX = "frtax1:";

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export function isEncryptedTax(stored: string | null | undefined): boolean {
  return typeof stored === "string" && stored.startsWith(TAX_PREFIX);
}

/** What the page is handed in place of the number. Asterisks, to match the form's own mask
    (src/modules/employees/format.ts); an empty value stays empty, not a mask over nothing. */
export function maskTax(plain: string): string {
  if (plain.trim() === "") return "";
  const digits = plain.replace(/\D/g, "");
  return `***-**-${digits.length >= 4 ? digits.slice(-4) : "****"}`;
}

export interface TaxCrypto {
  encrypt(plain: string): string;
  /** Throws a plain sentence when the value cannot be read with this key. */
  decrypt(stored: string): string;
}

export function createTaxCrypto(key: Buffer): TaxCrypto {
  if (key.length !== KEY_BYTES) throw new Error("The key for tax numbers is not the right size.");
  return {
    encrypt(plain) {
      // An empty column means "no number on file", and that has to stay readable without a key.
      if (plain === "") throw new Error("There is no tax number to encrypt.");
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
      const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      return TAX_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
    },
    decrypt(stored) {
      try {
        if (!isEncryptedTax(stored)) throw new Error("not an encrypted value");
        const raw = Buffer.from(stored.slice(TAX_PREFIX.length), "base64");
        const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, IV_BYTES), { authTagLength: TAG_BYTES });
        decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
        return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
      } catch {
        // Node names the cipher step that failed, never a cause a person can act on, and the cause
        // is always one of two: another key, or a damaged value.
        throw new Error("This tax number cannot be read on this PC or under this Windows account.");
      }
    },
  };
}

/** Writes a new key file and has it on disk before it returns. Never over a file that is there. */
export function keepNewKeyFile(keyPath: string, wrapped: Buffer): void {
  // "wx" refuses to write over a key file that appeared in the meantime: a new key in its place
  // would leave every number already stored unreadable for good.
  const fd = fs.openSync(keyPath, "wx");
  let kept = false;
  try {
    fs.writeFileSync(fd, wrapped);
    // On disk now, not when Windows gets to it: a power cut just after the numbers are encrypted
    // must not find them written and their key still in memory.
    fs.fsyncSync(fd);
    kept = true;
  } finally {
    fs.closeSync(fd);
    // No number is encrypted with a key that was never handed out, and a half-written file would
    // be refused as a key from another PC at every start from then on.
    if (!kept) fs.rmSync(keyPath, { force: true });
  }
}

const opened = new Map<string, TaxCrypto>();

/** The org's own key: read from <org_id>.exd, or made there the first time it is asked for.
    Throws a plain sentence when Windows cannot wrap or unwrap it. */
export function taxCryptoFor(orgId: string): TaxCrypto {
  const have = opened.get(orgId);
  if (have) return have;
  // Loaded here, not at the top of the file: the tests bundle this file and run it under
  // Electron-as-Node, where the "electron" module is only the path to the program.
  const { app, safeStorage } = require("electron") as typeof import("electron");
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Windows encryption is not available on this PC, so a tax number cannot be saved or read here.");
  }
  const keyPath = path.join(app.getPath("userData"), `${orgId}.exd`); // dull name, like .ixd and .mxd
  let made: TaxCrypto;
  if (fs.existsSync(keyPath)) {
    try {
      made = createTaxCrypto(Buffer.from(safeStorage.decryptString(fs.readFileSync(keyPath)), "hex"));
    } catch (err) {
      console.error("[employees] the tax number key file could not be opened:", err instanceof Error ? err.message : String(err));
      // Never answered with a new key: that would leave every number already stored unreadable for good.
      throw new Error("The key for tax numbers was made on another PC or Windows account, so a tax number cannot be saved or read here.");
    }
  } else {
    const key = randomBytes(KEY_BYTES);
    try {
      keepNewKeyFile(keyPath, safeStorage.encryptString(key.toString("hex")));
    } catch (err) {
      console.error("[employees] the tax number key file could not be written:", err instanceof Error ? err.message : String(err));
      throw new Error("The key for tax numbers could not be kept on this PC, so a tax number cannot be saved here.");
    }
    made = createTaxCrypto(key);
  }
  opened.set(orgId, made);
  return made;
}

/** A stored value back as the number: encrypted or still plain in, plain out, "" when none is on file. */
export function readTax(stored: string | null | undefined, crypto: TaxCrypto): string {
  if (!stored || stored.trim() === "") return "";
  return isEncryptedTax(stored) ? crypto.decrypt(stored) : stored;
}
