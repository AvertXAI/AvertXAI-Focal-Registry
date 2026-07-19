// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Boot-time org-database slug migration — runbooks_{org}.db → focalregistry_{org}.db.
//              Runs BEFORE any module opens a connection. Copy first (never move), verify the copy
//              (integrity_check + modules/app_settings row counts), only then flip the registry's
//              app_slug, then keep the old file as .migrated — NEVER deleted. Any failure at any
//              step rolls back the partial copy, leaves the registry untouched, logs loudly, and
//              the app boots on the old database as if nothing happened. Idempotent on every boot.
//              Electron-free (userData injected) so the proof harness runs headless.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/db/migrate.ts
//------------------------------------------------------------
import Database from "better-sqlite3-multiple-ciphers";
import fs from "node:fs";
import path from "node:path";

const OLD_SLUG = "runbooks";
export const NEW_SLUG = "focalregistry";

export interface MigrationOutcome {
  orgId: string;
  action: "migrated" | "completed-prior" | "none" | "rolled-back";
  detail: string;
}

const log = (orgId: string, msg: string): void => console.log(`[db-migrate] ${orgId}: ${msg}`);

function countOrNull(db: Database.Database, table: string): number | null {
  try {
    return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  } catch {
    return null; // table absent — compared as-is; null must match null
  }
}

// Open read-only, integrity-check, count the verification tables. Throws on any problem.
function verifyCopy(newPath: string): { modules: number | null; app_settings: number | null } {
  const db = new Database(newPath, { readonly: true });
  try {
    const ic = db.pragma("integrity_check", { simple: true });
    if (ic !== "ok") throw new Error(`integrity_check returned '${String(ic)}'`);
    return { modules: countOrNull(db, "modules"), app_settings: countOrNull(db, "app_settings") };
  } finally {
    db.close();
  }
}

function removeIfExists(p: string): void {
  for (const f of [p, `${p}-wal`, `${p}-shm`]) {
    if (fs.existsSync(f)) fs.rmSync(f, { force: true });
  }
}

function migrateOne(reg: Database.Database, userData: string, orgId: string): MigrationOutcome {
  const oldPath = path.join(userData, `${OLD_SLUG}_${orgId}.db`);
  const newPath = path.join(userData, `${NEW_SLUG}_${orgId}.db`);

  if (!fs.existsSync(oldPath)) {
    // Crash-after-rename recovery: old already .migrated, new file present, registry not yet
    // flipped. Verify the new file and complete the registry step; otherwise nothing to do.
    if (fs.existsSync(newPath)) {
      try {
        verifyCopy(newPath);
        reg.prepare("UPDATE orgs SET app_slug = ? WHERE org_id = ?").run(NEW_SLUG, orgId);
        log(orgId, "completed prior interrupted migration (registry flipped for verified new file)");
        return { orgId, action: "completed-prior", detail: "registry flipped; verified new file was already present" };
      } catch (e) {
        log(orgId, `new file present but failed verification — leaving registry on old slug: ${e instanceof Error ? e.message : String(e)}`);
        return { orgId, action: "none", detail: "unverifiable orphan new file; registry untouched" };
      }
    }
    return { orgId, action: "none", detail: "no runbooks db file for this org" };
  }

  try {
    // 1. Fold any hot WAL from a previous crash into the main file BEFORE copying — copying only
    //    the .db while a write-ahead log holds data would silently lose it.
    const odb = new Database(oldPath);
    let oldModules: number | null;
    let oldSettings: number | null;
    try {
      odb.pragma("wal_checkpoint(TRUNCATE)");
      oldModules = countOrNull(odb, "modules");
      oldSettings = countOrNull(odb, "app_settings");
    } finally {
      odb.close();
    }
    log(orgId, `old file checkpointed (modules=${oldModules}, app_settings=${oldSettings})`);

    // 2. Copy, never move. A stale destination from a prior failed attempt is removed first —
    //    it was never referenced by the registry (that flip only happens after verification).
    if (fs.existsSync(newPath)) {
      log(orgId, "removing stale destination from a prior failed attempt");
      removeIfExists(newPath);
    }
    fs.copyFileSync(oldPath, newPath);
    log(orgId, `copied to ${path.basename(newPath)}`);

    // 3. Verify the copy: opens, integrity ok, row counts match.
    const counts = verifyCopy(newPath);
    if (counts.modules !== oldModules || counts.app_settings !== oldSettings) {
      throw new Error(
        `row count mismatch (modules ${counts.modules}≠${oldModules} or app_settings ${counts.app_settings}≠${oldSettings})`
      );
    }
    log(orgId, `verified: integrity ok, modules=${counts.modules}, app_settings=${counts.app_settings}`);

    // 4. Only now touch the registry.
    reg.prepare("UPDATE orgs SET app_slug = ? WHERE org_id = ?").run(NEW_SLUG, orgId);
    log(orgId, `registry app_slug → ${NEW_SLUG}`);

    // 5. Keep the old file forever — renamed, never deleted. Disk is cheap; a catalog is not.
    fs.renameSync(oldPath, `${oldPath}.migrated`);
    log(orgId, `old file kept as ${path.basename(oldPath)}.migrated`);
    return { orgId, action: "migrated", detail: "copied, verified, registry updated, old kept as .migrated" };
  } catch (e) {
    // 6. Roll back to "nothing happened": remove the partial copy, registry untouched (it is only
    //    written after verification), boot proceeds on the old database.
    const msg = e instanceof Error ? e.message : String(e);
    try {
      removeIfExists(newPath);
    } catch (cleanupErr) {
      log(orgId, `rollback cleanup incomplete (${String(cleanupErr)}) — registry untouched, old file intact`);
    }
    log(orgId, `MIGRATION FAILED — rolled back, booting on old database: ${msg}`);
    return { orgId, action: "rolled-back", detail: msg };
  }
}

/** Run at boot, before initRegistry()/getDb() — no module connection may exist yet. */
export function migrateOrgDbSlugs(userData: string): MigrationOutcome[] {
  const regPath = path.join(userData, "platform_registry.db");
  if (!fs.existsSync(regPath)) return []; // fresh install — first-run wizard seeds the new slug
  const outcomes: MigrationOutcome[] = [];
  const reg = new Database(regPath);
  try {
    if (!reg.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'orgs'").get()) return [];
    const orgs = reg.prepare("SELECT org_id FROM orgs WHERE app_slug = ?").all(OLD_SLUG) as Array<{ org_id: string }>;
    for (const o of orgs) outcomes.push(migrateOne(reg, userData, o.org_id));
  } finally {
    reg.close();
  }
  return outcomes;
}
