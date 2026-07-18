// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: RunBooks — AvertXAI platform shell (baseplate)
// Description: Canon Distributor templates — DB-only CRUD over canon_templates (this service NEVER
//              writes a file to disk; "writes_as" is stored metadata for a later bite). Trust
//              boundary: every renderer-supplied arg arrives unknown and is validated here. Tenant
//              scoping matches the engine's shared-DB pattern (org_id ?? modules.tenant_id).
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/canon-distributor/templates.ts
//------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../db";
import { generateUUIDv7 } from "../utils/uuidv7";
import type { CanonTemplate, TemplateWriteResult } from "../../../../src/shared/types";

// Same resolution the distributor engine uses (index.ts tenantId): app_settings.org_id, falling
// back to an existing module row's tenant_id for dev DBs whose app_settings predate org_id.
function tenantId(): string {
  const db = getDb();
  const t =
    (db.prepare("SELECT value AS v FROM app_settings WHERE key = 'org_id'").get() as { v: string } | undefined)?.v ??
    (db.prepare("SELECT tenant_id AS v FROM modules LIMIT 1").get() as { v: string } | undefined)?.v;
  if (!t) throw new Error("Tenant DB not seeded — no org_id / module tenant found");
  return t;
}

function cleanTitle(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim() === "") throw new Error("Template title required");
  return raw.trim();
}
function cleanStr(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}
function cleanVersion(raw: unknown): string {
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : "v0.1.0";
}
function cleanId(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isInteger(raw)) throw new Error("Template id must be an integer");
  return raw;
}
function asPayload(raw: unknown): Record<string, unknown> {
  return raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

export function listTemplates(): CanonTemplate[] {
  return getDb()
    .prepare("SELECT * FROM canon_templates WHERE tenant_id = ? ORDER BY updated_at DESC, id DESC")
    .all(tenantId()) as CanonTemplate[];
}

export function getTemplate(id: unknown): CanonTemplate | null {
  return (
    (getDb()
      .prepare("SELECT * FROM canon_templates WHERE id = ? AND tenant_id = ?")
      .get(cleanId(id), tenantId()) as CanonTemplate | undefined) ?? null
  );
}

// writes_as is intentionally NOT taken from the payload — it defaults to 'CLAUDE.md' (schema) and is
// readonly in the UI, so a template's write target can't be silently changed here.
export function createTemplate(payload: unknown): CanonTemplate {
  const p = asPayload(payload);
  const db = getDb();
  const uuid = generateUUIDv7();
  db.prepare(
    "INSERT INTO canon_templates (uuid, tenant_id, title, destination, body_md, version, sections_json) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(
    uuid,
    tenantId(),
    cleanTitle(p.title),
    cleanStr(p.destination),
    cleanStr(p.body_md),
    cleanVersion(p.version),
    cleanStr(p.sections_json)
  );
  return db.prepare("SELECT * FROM canon_templates WHERE uuid = ?").get(uuid) as CanonTemplate;
}

export function updateTemplate(id: unknown, payload: unknown): CanonTemplate {
  const p = asPayload(payload);
  const db = getDb();
  const rowId = cleanId(id);
  const tid = tenantId();
  // writes_as omitted from the SET list — immutable (see createTemplate note).
  db.prepare(
    "UPDATE canon_templates SET title = ?, destination = ?, body_md = ?, version = ?, sections_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?"
  ).run(
    cleanTitle(p.title),
    cleanStr(p.destination),
    cleanStr(p.body_md),
    cleanVersion(p.version),
    cleanStr(p.sections_json),
    rowId,
    tid
  );
  const row = db.prepare("SELECT * FROM canon_templates WHERE id = ? AND tenant_id = ?").get(rowId, tid) as
    | CanonTemplate
    | undefined;
  if (!row) throw new Error("Template not found");
  return row;
}

export function deleteTemplate(id: unknown): void {
  getDb().prepare("DELETE FROM canon_templates WHERE id = ? AND tenant_id = ?").run(cleanId(id), tenantId());
}

// THE ONLY disk write in the templates service — {destination}/{writes_as}, nothing else.
// writes_as is service-immutable ('CLAUDE.md'), so the target filename can't be steered from the
// renderer. NON-DESTRUCTIVE by default: an existing file returns "exists"; the UI must confirm and
// re-invoke with overwrite=true to replace it.
export function writeTemplateToDisk(id: unknown, overwrite: unknown): TemplateWriteResult {
  const t = getTemplate(id);
  if (!t) throw new Error("Template not found");
  const dest = (t.destination ?? "").trim();
  if (dest === "") return { status: "no-destination" };
  if (!path.isAbsolute(dest)) throw new Error("Destination must be an absolute path");
  if (!fs.existsSync(dest) || !fs.statSync(dest).isDirectory()) {
    throw new Error(`Destination folder not found: ${dest}`);
  }
  const target = path.join(dest, t.writes_as);
  if (fs.existsSync(target) && overwrite !== true) return { status: "exists", path: target };
  fs.writeFileSync(target, t.body_md, "utf8");
  return { status: "written", path: target };
}
