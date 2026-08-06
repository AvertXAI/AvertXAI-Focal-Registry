// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Vault seed data — load and purge, from the SAME rows as VAULT-SEED-DATA.xlsx
//              (seed-data.ts is generated from it, so the sheet and the loader cannot drift).
//              Mirrors the shipped devseed contract: every id written is recorded in an exact
//              LEDGER, and purge removes those rows and only those rows — anything a user created
//              beside the seed survives untouched.
//
//              PURGE IS COMPLETE, ruled by Jason 08-06-2026 ("sure purge it completely"): the
//              seeded secrets, their whole version history, AND their access-log rows all go. That
//              last one is a deliberate, ruled exception to the append-only doctrine and applies
//              ONLY to rows this file wrote — forty seeded "create" entries left behind would
//              pollute the very audit surface the seed exists to exercise.
//
//              Everything is written through the REAL createSecret service, never a raw INSERT, so
//              the seed exercises the same validators, the same access log and the same append-only
//              version history the app uses. Electron-free.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/vault/seed.ts
//------------------------------------------------------------
import type { Db } from "./db";
import { SEED_ENTRIES } from "./seed-data";
import { clearInternal, getInternal, setInternal } from "./settings";
import { createSecret, logAccess, supersedeSecret } from "./store";

const LEDGER_KEY = "seed.ledger"; // internal — outside VAULT_DEFAULTS, so no bridge can write it
const SEED_CALLER = "seed";

interface SeedLedger {
  /** Public locators of every secret this loader created. The purge works from these alone. */
  uuids: string[];
}

function readLedger(db: Db, orgId: string): SeedLedger | null {
  const raw = getInternal(db, orgId, LEDGER_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SeedLedger>;
    return { uuids: Array.isArray(parsed.uuids) ? parsed.uuids : [] };
  } catch {
    return null;
  }
}

export function seedStatus(db: Db, orgId: string): { present: boolean; count: number } {
  const l = readLedger(db, orgId);
  return { present: l !== null && l.uuids.length > 0, count: l?.uuids.length ?? 0 };
}

/** Which vault "kind" a platform belongs to — the sidebar's Types filter reads this. */
function kindFor(company: string, url: string): string {
  if (/cloudflare|stripe|hetzner|resend/i.test(company)) return "api_key";
  if (/bank|chase|paypal|venmo|zelle|quickbooks|intuit/i.test(company)) return "financial";
  if (/^$/.test(url)) return "login";
  return "login";
}

export interface SeedResult {
  ok: boolean;
  error?: string;
  created?: number;
  superseded?: number;
}

/**
 * Loads the workbook dataset. Refuses when a seed is already present rather than doubling it —
 * the ledger is what makes the purge exact, and two overlapping loads would blur it.
 * A few entries are deliberately superseded so the version history has depth to show.
 */
export function loadSeed(db: Db, orgId: string): SeedResult {
  if (seedStatus(db, orgId).present) {
    return { ok: false, error: "Seed data is already loaded. Purge it first if you want a fresh set." };
  }
  const uuids: string[] = [];
  let superseded = 0;
  try {
    db.transaction(() => {
      SEED_ENTRIES.forEach((e, i) => {
        const meta = createSecret(db, orgId, SEED_CALLER, {
          kind: kindFor(e.company, e.url),
          label: e.company,
          value: e.password,
          fullName: e.fullName,
          username: e.username,
          url: e.url,
          notes: e.notes,
          extras:
            e.backupCodes.length > 0 || e.securityQuestions.length > 0
              ? { backupCodes: e.backupCodes, securityQuestions: e.securityQuestions }
              : null,
        });
        uuids.push(meta.uuid);
        // Every seventh entry gets a rotation in its history, so the version panel is not all v1.
        // The superseding value is ALSO deliberately dumb — this dataset exists to look real.
        if (i % 7 === 3) {
          supersedeSecret(db, orgId, SEED_CALLER, meta.uuid, `${e.password}!`);
          superseded += 1;
        }
      });
      setInternal(db, orgId, LEDGER_KEY, JSON.stringify({ uuids } satisfies SeedLedger));
      logAccess(db, orgId, "seed", null, null, SEED_CALLER, true, `${uuids.length} entries loaded`);
    })();
    return { ok: true, created: uuids.length, superseded };
  } catch (e) {
    // The transaction rolled every row back; say what happened without echoing any value.
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Removes exactly what loadSeed created — secrets, their versions, and their access-log rows — in
 * dependency order. HARD deletes, per the ruling: this is test data, and soft-deleted residue keeps
 * polluting the surfaces the seed exists to test. Anything not in the ledger is untouched.
 */
export function purgeSeed(db: Db, orgId: string): { ok: boolean; error?: string; removed?: number } {
  const l = readLedger(db, orgId);
  if (!l || l.uuids.length === 0) return { ok: false, error: "There is no seed data recorded to remove." };
  try {
    let removed = 0;
    db.transaction(() => {
      const idOf = db.prepare("SELECT id FROM vault_secrets WHERE org_id = ? AND uuid = ?");
      const delVersions = db.prepare("DELETE FROM vault_secret_versions WHERE secret_id = ?");
      const delLog = db.prepare("DELETE FROM vault_access_log WHERE org_id = ? AND secret_uuid = ?");
      const delSecret = db.prepare("DELETE FROM vault_secrets WHERE id = ?");
      for (const uuid of l.uuids) {
        const row = idOf.get(orgId, uuid) as { id: number } | undefined;
        // Children first — foreign keys are ON, so a secret cannot go before its versions.
        if (row) {
          delVersions.run(row.id);
          removed += delSecret.run(row.id).changes;
        }
        delLog.run(orgId, uuid); // the ruled exception, scoped to seeded rows alone
      }
      clearInternal(db, orgId, LEDGER_KEY);
      // The purge itself is recorded. A wipe that erased its own record would be a different
      // feature (Jason's "cover their tracks" concept) and is deliberately NOT this one.
      logAccess(db, orgId, "purge", null, null, SEED_CALLER, true, `${removed} entries removed`);
    })();
    return { ok: true, removed };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
