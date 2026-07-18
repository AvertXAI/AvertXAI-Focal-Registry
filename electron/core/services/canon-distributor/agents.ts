// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: RunBooks — AvertXAI platform shell (baseplate)
// Description: Canon Distributor agents — imports agent .md files from local repos into canon_agents
//              (READ-ONLY on the repos; nothing is ever written back out — that's a later bite).
//              Import walks recursively, skips dot-folders and repo-root .md files, and UPSERTs on
//              (tenant_id, source, category, name) so re-import is idempotent. Trust boundary:
//              renderer args arrive unknown and are validated here.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/canon-distributor/agents.ts
//------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../db";
import { generateUUIDv7 } from "../utils/uuidv7";
import type { AgentImportResult, CanonAgent } from "../../../../src/shared/types";

// Same resolution the engine/templates use: app_settings.org_id ?? modules.tenant_id fallback.
function tenantId(): string {
  const db = getDb();
  const t =
    (db.prepare("SELECT value AS v FROM app_settings WHERE key = 'org_id'").get() as { v: string } | undefined)?.v ??
    (db.prepare("SELECT tenant_id AS v FROM modules LIMIT 1").get() as { v: string } | undefined)?.v;
  if (!t) throw new Error("Tenant DB not seeded — no org_id / module tenant found");
  return t;
}

function cleanId(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isInteger(raw)) throw new Error("Agent id must be an integer");
  return raw;
}

// License by repo root name — the two known sources; anything else imports with "".
const LICENSES: Record<string, string> = {
  "AvertXAI-Contains-Studio-Agents": "none (personal use only)",
  "AvertXAI-Agency-Agents": "MIT",
};

export function listAgents(): CanonAgent[] {
  return getDb()
    .prepare(
      "SELECT id, uuid, name, category, source, license, is_favorite, created_at, updated_at FROM canon_agents WHERE tenant_id = ? ORDER BY category ASC, name ASC"
    )
    .all(tenantId()) as CanonAgent[];
}

// In-app edits only touch body_md — name/category/source stay tied to the imported file identity
// (the unique index), so an edited agent still updates in place on the next re-import.
export function updateAgent(id: unknown, body: unknown): void {
  if (typeof body !== "string") throw new Error("Agent body must be a string");
  const r = getDb()
    .prepare("UPDATE canon_agents SET body_md = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?")
    .run(body, cleanId(id), tenantId());
  if (r.changes === 0) throw new Error("Agent not found");
}

export function setFavorite(id: unknown, on: unknown): void {
  getDb()
    .prepare("UPDATE canon_agents SET is_favorite = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?")
    .run(on === true ? 1 : 0, cleanId(id), tenantId());
}

export function getAgent(id: unknown): CanonAgent | null {
  return (
    (getDb()
      .prepare("SELECT * FROM canon_agents WHERE id = ? AND tenant_id = ?")
      .get(cleanId(id), tenantId()) as CanonAgent | undefined) ?? null
  );
}

export function deleteAgent(id: unknown): void {
  getDb().prepare("DELETE FROM canon_agents WHERE id = ? AND tenant_id = ?").run(cleanId(id), tenantId());
}

// Recursive *.md collector — skips dot-entries (.git/.github), files sitting at the repo root
// (CONTRIBUTING/SECURITY are docs, not agents; an agent always lives under a category dir), and
// README.md at ANY depth (the Agency repo nests per-integration READMEs inside category folders).
function collectMd(dir: string, root: string, out: string[]): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const lower = e.name.toLowerCase();
    const full = path.join(dir, e.name);
    if (e.isDirectory()) collectMd(full, root, out);
    else if (e.isFile() && lower.endsWith(".md") && lower !== "readme.md" && dir !== root) out.push(full);
  }
}

export function importFromFolders(paths: unknown): AgentImportResult {
  if (!Array.isArray(paths) || paths.some((p) => typeof p !== "string" || !path.isAbsolute(p))) {
    throw new Error("importFromFolders: absolute path list required");
  }
  const db = getDb();
  const tid = tenantId();
  let imported = 0;
  let updated = 0;
  const categories = new Set<string>();

  const exists = db.prepare(
    "SELECT id FROM canon_agents WHERE tenant_id = ? AND source = ? AND category = ? AND name = ?"
  );
  const upsert = db.prepare(
    `INSERT INTO canon_agents (uuid, tenant_id, name, category, body_md, source, license) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (tenant_id, source, category, name)
     DO UPDATE SET body_md = excluded.body_md, license = excluded.license, updated_at = CURRENT_TIMESTAMP`
  );

  db.transaction(() => {
    for (const root of paths as string[]) {
      if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`Folder not found: ${root}`);
      const source = path.basename(root);
      const license = LICENSES[source] ?? "";
      const files: string[] = [];
      collectMd(root, root, files);
      for (const f of files) {
        const category = path.basename(path.dirname(f)); // immediate parent = category (handles both repo shapes)
        const name = path.basename(f, ".md");
        categories.add(category);
        if (exists.get(tid, source, category, name)) updated++;
        else imported++;
        upsert.run(generateUUIDv7(), tid, name, category, fs.readFileSync(f, "utf8"), source, license);
      }
    }
  })();

  return { imported, updated, categories: categories.size };
}
