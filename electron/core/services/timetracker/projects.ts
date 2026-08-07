// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: TimeTracker client + project create/read/update, group assignment, contract
//              attachments, notes, totals, archive (soft) and purge (tombstoned). Ported 1:1
//              from the standalone engine onto the shared org database with prefixed tables.
//              Electron-free — file storage arrives via the injected paths root.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/timetracker/projects.ts
//------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";
import { generateUUIDv7 } from "../utils/uuidv7";
import { nowIso, type Db } from "./db";
import { contractsDir, getStorageRoot } from "./paths";
import { createGroup, getGroup, setSidebarSort } from "./groups";
import { listActive as listActiveAdjustments } from "./adjustments";
import { classifyProjectType } from "./derive";
import { enforceCap } from "./license";
import { assertNotCompleted } from "./completion";
import type {
  ArchiveAuditEntry,
  Cost,
  DeletionTombstone,
  GrandTotals,
  GroupTotalRow,
  LedgerEntry,
  NewProjectInput,
  ProjectDetail,
  ProjectListItem,
  TimeDisplayMode,
  TimeEntry,
  UpdateProjectInput,
} from "./types";

interface ProjectRow extends Omit<ProjectListItem, "total_value"> {
  latest_ledger_amount: number | null;
}

const LIST_SQL = `
SELECT
  p.*,
  c.name  AS client_name,
  c.contact_phone,
  c.email,
  c.company AS client_company,
  c.address AS client_address,
  g.name  AS group_name,
  g.color AS group_color,
  g.icon  AS group_icon,
  (SELECT n.body FROM timetracker_notes n WHERE n.project_id = p.id) AS note_body,
  -- COSTS = hard line items + EMPLOYEE COST. Canon (DECISIONS-51): "Employee cost reaches
  -- Analytics. Hours logged against a project at a rate feed that project's COSTS and every
  -- chart." Before 08-05-2026 this summed timetracker_costs alone, so paying someone against a
  -- project left its COSTS card reading $0.00.
  -- The three employee sources match reports.ENTRY_COST_SQL exactly — entries, valued hours
  -- corrections, and project-scoped amount corrections, soft-deleted ones excluded. A plain
  -- cross-module SELECT is the sanctioned arrangement here: one database, one connection, no
  -- ATTACH (employees/db.ts).
  COALESCE((SELECT SUM(co.amount) FROM timetracker_costs co WHERE co.project_id = p.id), 0)
  + COALESCE((SELECT SUM(CASE e.pay_type
        WHEN 'donated' THEN 0
        WHEN 'hourly'  THEN e.hours_worked * e.rate_at_entry
        ELSE COALESCE(e.flat_amount, 0) END)
      FROM employee_entries e WHERE e.project_id = p.id), 0)
  + COALESCE((SELECT SUM((ea.delta_minutes / 60.0) * ea.rate_at_entry)
      FROM employee_adjustments ea
      WHERE ea.project_id = p.id AND ea.kind = 'hours' AND ea.deleted_at IS NULL), 0)
  + COALESCE((SELECT SUM(ea.delta_amount)
      FROM employee_adjustments ea
      WHERE ea.project_id = p.id AND ea.kind = 'amount' AND ea.deleted_at IS NULL), 0)
  -- ITEMIZED PURCHASES (ruled 08-06, profit build): the recon proved these rows were in NO
  -- analytics read — "Costs" and "Spent" were different, overlapping sets. This term ends that:
  -- total_costs IS the ruled SPENT — crew pay + itemized purchases + hard cost lines.
  + COALESCE((SELECT SUM(i.amount) FROM timetracker_project_items i
      WHERE i.project_id = p.id AND i.deleted_at IS NULL), 0)
  AS total_costs,
  -- total time = clamp(session seconds + non-deleted adjustment minutes, 0). Adjustments live in
  -- their own table; time_entries is never modified. Display clamps at 0; the raw deltas stay honest.
  -- Total time = the user's own committed sessions + their adjustments + EMPLOYEE hours logged
  -- against this project + employee hours corrections. Canon records hours for EVERY pay type,
  -- donated included, so no pay_type filter belongs here — a donated hour is still an hour worked.
  -- Added 08-05-2026: before this the rail read 0h for a project that only had employee time on it.
  MAX(0,
    COALESCE((SELECT SUM(te.duration_seconds) FROM timetracker_time_entries te WHERE te.project_id = p.id), 0)
    + COALESCE((SELECT SUM(a.delta_minutes) * 60 FROM timetracker_adjustments a WHERE a.project_id = p.id AND a.deleted_at IS NULL), 0)
    + COALESCE((SELECT SUM(e.hours_worked) * 3600 FROM employee_entries e WHERE e.project_id = p.id), 0)
    + COALESCE((SELECT SUM(ea.delta_minutes) * 60 FROM employee_adjustments ea
        WHERE ea.project_id = p.id AND ea.kind = 'hours' AND ea.deleted_at IS NULL), 0)
  ) AS total_seconds,
  (SELECT MAX(te.ended_at) FROM timetracker_time_entries te WHERE te.project_id = p.id) AS last_worked,
  (SELECT vl.amount FROM timetracker_value_ledger vl WHERE vl.project_id = p.id ORDER BY vl.id DESC LIMIT 1) AS latest_ledger_amount
FROM timetracker_projects p
JOIN timetracker_clients c ON c.id = p.client_id
LEFT JOIN timetracker_groups g ON g.id = p.group_id
`;

/**
 * Read-only valuation: hourly = hours x rate; contract paid = contract_amount;
 * contract donated = 0 (rendered as "Donated"). Legacy contracts without a kind fall back
 * to the latest value-ledger amount. Pure derivation — never writes time_entries.
 */
function withValue(row: ProjectRow): ProjectListItem {
  const { latest_ledger_amount, ...rest } = row;
  let total_value: number;
  if (row.rate_type === "hourly") {
    total_value = row.hourly_rate ? (row.total_seconds / 3600) * row.hourly_rate : 0;
  } else if (row.contract_kind === "paid") {
    total_value = row.contract_amount ?? latest_ledger_amount ?? 0;
  } else if (row.contract_kind === "donated") {
    total_value = 0;
  } else {
    total_value = latest_ledger_amount ?? 0;
  }
  return { ...rest, total_value };
}

/** Active projects only — archived projects are hidden from every active surface. */
export function listProjects(db: Db, orgId: string): ProjectListItem[] {
  const rows = db
    .prepare(`${LIST_SQL} WHERE p.org_id = ? AND p.archived_at IS NULL ORDER BY p.priority_order ASC, p.id ASC`)
    .all(orgId) as ProjectRow[];
  return rows.map(withValue);
}

/** Archived projects only, newest archive first (for the Archive view). */
export function listArchivedProjects(db: Db, orgId: string): ProjectListItem[] {
  const rows = db
    .prepare(`${LIST_SQL} WHERE p.org_id = ? AND p.archived_at IS NOT NULL ORDER BY p.archived_at DESC`)
    .all(orgId) as ProjectRow[];
  return rows.map(withValue);
}

/** Single project by id (archived or not) — used by detail, restore, purge, wasted math. */
export function getProject(db: Db, id: number): ProjectListItem {
  const row = db.prepare(`${LIST_SQL} WHERE p.id = ?`).get(id) as ProjectRow | undefined;
  if (!row) throw new Error(`Project ${id} not found`);
  return withValue(row);
}

/**
 * Read-only group rollup: per group (null = Ungrouped), the summed COMMITTED time of its
 * non-archived projects — saved sessions ± adjustments ± EMPLOYEE hours, each project clamped at 0
 * (the same formula as LIST_SQL's total_seconds). A live/running session is NOT included until
 * it is stopped and saved. Pure SELECT — never touches time_entries.
 */
export function groupTotals(db: Db, orgId: string): GroupTotalRow[] {
  return db
    .prepare(
      `SELECT p.group_id AS group_id,
         SUM(MAX(0,
           COALESCE((SELECT SUM(te.duration_seconds) FROM timetracker_time_entries te WHERE te.project_id = p.id), 0)
           + COALESCE((SELECT SUM(a.delta_minutes) * 60 FROM timetracker_adjustments a WHERE a.project_id = p.id AND a.deleted_at IS NULL), 0)
           + COALESCE((SELECT SUM(e.hours_worked) * 3600 FROM employee_entries e WHERE e.project_id = p.id), 0)
           + COALESCE((SELECT SUM(ea.delta_minutes) * 60 FROM employee_adjustments ea
               WHERE ea.project_id = p.id AND ea.kind = 'hours' AND ea.deleted_at IS NULL), 0)
         )) AS total_seconds
       FROM timetracker_projects p
       WHERE p.org_id = ? AND p.archived_at IS NULL
       GROUP BY p.group_id`
    )
    .all(orgId) as GroupTotalRow[];
}

export function findOrCreateClient(
  db: Db,
  orgId: string,
  name: string,
  phone: string,
  email: string,
  company = "",
  address = ""
): number {
  const existing = db
    .prepare(`SELECT id FROM timetracker_clients WHERE name = ? COLLATE NOCASE`)
    .get(name.trim()) as { id: number } | undefined;
  if (existing) {
    if (phone.trim() || email.trim() || company.trim() || address.trim()) {
      // Create-path ENRICHMENT (the D12-adjacent semantics, receipted and kept): a non-empty value
      // fills in; an empty one leaves what the matched client already has.
      db.prepare(
        `UPDATE timetracker_clients SET
           contact_phone = CASE WHEN ? <> '' THEN ? ELSE contact_phone END,
           email         = CASE WHEN ? <> '' THEN ? ELSE email END,
           company       = CASE WHEN ? <> '' THEN ? ELSE company END,
           address       = CASE WHEN ? <> '' THEN ? ELSE address END,
           updated_at    = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(
        phone.trim(), phone.trim(), email.trim(), email.trim(),
        company.trim(), company.trim(), address.trim(), address.trim(),
        existing.id
      );
    }
    return existing.id;
  }
  const res = db
    .prepare(
      `INSERT INTO timetracker_clients (uuid, org_id, name, contact_phone, email, company, address, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      generateUUIDv7(), orgId, name.trim(), phone.trim() || null, email.trim() || null,
      company.trim() || null, address.trim() || null, nowIso()
    );
  return Number(res.lastInsertRowid);
}

/** Resolve the modal's group choice: inline-created group wins over an existing selection. */
function resolveGroupId(db: Db, orgId: string, input: NewProjectInput): number | null {
  if (input.newGroupName && input.newGroupName.trim()) {
    return createGroup(db, orgId, input.newGroupName, input.newGroupColor || "#3b82f6", input.newGroupIcon ?? null).id;
  }
  if (input.groupId != null) {
    if (!getGroup(db, input.groupId)) throw new Error(`Group ${input.groupId} not found`);
    return input.groupId;
  }
  return null;
}

/** Copy a contract file into <storage-root>/contracts/<projectId>/ and store the relative path. */
function attachContractFile(db: Db, projectId: number, sourcePath: string): void {
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    throw new Error("Contract file not found");
  }
  const fileName = path.basename(sourcePath);
  const destDir = contractsDir(projectId);
  fs.copyFileSync(sourcePath, path.join(destDir, fileName));
  const relPath = path.join("contracts", String(projectId), fileName);
  db.prepare(`UPDATE timetracker_projects SET contract_file_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
    relPath,
    projectId
  );
}

/** Absolute path of a project's attached contract file, or null. */
export function contractFileAbsolutePath(db: Db, projectId: number): string | null {
  const row = db.prepare(`SELECT contract_file_path FROM timetracker_projects WHERE id = ?`).get(projectId) as
    | { contract_file_path: string | null }
    | undefined;
  if (!row?.contract_file_path) return null;
  return path.join(getStorageRoot(), row.contract_file_path);
}

export function createProject(db: Db, orgId: string, input: NewProjectInput): ProjectListItem {
  enforceCap(db, "projects"); // MAIN-SIDE tier cap — the UI's disabled state is only a hint
  const clientId = findOrCreateClient(
    db, orgId, input.clientName, input.contactPhone, input.email,
    input.clientCompany ?? "", input.clientAddress ?? ""
  );
  const groupId = resolveGroupId(db, orgId, input);
  const maxOrder = db.prepare(`SELECT COALESCE(MAX(priority_order), 0) AS m FROM timetracker_projects`).get() as {
    m: number;
  };
  const isContract = input.rateType === "contract";
  const kind = isContract ? (input.contractKind ?? "paid") : null;
  const res = db
    .prepare(
      `INSERT INTO timetracker_projects
         (uuid, org_id, client_id, name, color, status, rate_type, hourly_rate, priority_order, created_at,
          group_id, contract_amount, contract_description, contract_kind, target_hours,
          spend_budget, phone_ext, contract_date, signed_by, payment_terms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      generateUUIDv7(),
      orgId,
      clientId,
      input.name.trim(),
      input.color,
      input.status,
      input.rateType,
      input.rateType === "hourly" ? input.hourlyRate : null,
      maxOrder.m + 1,
      nowIso(),
      groupId,
      kind === "paid" ? input.contractAmount : null,
      isContract ? input.contractDescription.trim() || null : null,
      kind,
      kind === "donated" ? input.targetHours : null,
      input.spendBudget ?? null,
      input.phoneExt ?? null,
      input.contractDate ?? null,
      input.signedBy ?? null,
      input.paymentTerms ?? null
    );
  const projectId = Number(res.lastInsertRowid);
  if (isContract && input.contractSourcePath) attachContractFile(db, projectId, input.contractSourcePath);
  return getProject(db, projectId);
}

export function updateProject(db: Db, orgId: string, input: UpdateProjectInput): ProjectListItem {
  assertNotCompleted(db, input.id); // completion lock — also covers the contract-file attach below
  const current = db.prepare(`SELECT client_id FROM timetracker_projects WHERE id = ?`).get(input.id) as
    | { client_id: number }
    | undefined;
  if (!current) throw new Error(`Project ${input.id} not found`);
  const groupId = resolveGroupId(db, orgId, input);
  const isContract = input.rateType === "contract";
  const kind = isContract ? (input.contractKind ?? "paid") : null;
  db.prepare(
    `UPDATE timetracker_clients SET name = ?, contact_phone = ?, email = ?, company = ?, address = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(
    input.clientName.trim(),
    input.contactPhone.trim() || null,
    input.email.trim() || null,
    (input.clientCompany ?? "").trim() || null,
    (input.clientAddress ?? "").trim() || null,
    current.client_id
  );
  // Writes ONLY its own columns — a rate/kind change must never touch time_entries.
  db.prepare(
    `UPDATE timetracker_projects SET
       name = ?, color = ?, status = ?, rate_type = ?, hourly_rate = ?,
       group_id = ?, contract_amount = ?, contract_description = ?,
       contract_kind = ?, target_hours = ?, spend_budget = ?, phone_ext = ?,
       contract_date = ?, signed_by = ?, payment_terms = ?,
       contract_file_path = CASE WHEN ? THEN contract_file_path ELSE NULL END,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(
    input.name.trim(),
    input.color,
    input.status,
    input.rateType,
    input.rateType === "hourly" ? input.hourlyRate : null,
    groupId,
    kind === "paid" ? input.contractAmount : null,
    isContract ? input.contractDescription.trim() || null : null,
    kind,
    kind === "donated" ? input.targetHours : null,
    input.spendBudget ?? null,
    input.phoneExt ?? null,
    input.contractDate ?? null,
    input.signedBy ?? null,
    input.paymentTerms ?? null,
    isContract ? 1 : 0,
    input.id
  );
  if (isContract && input.contractSourcePath) attachContractFile(db, input.id, input.contractSourcePath);
  return getProject(db, input.id);
}

export function setProjectColor(db: Db, id: number, color: string): void {
  assertNotCompleted(db, id);
  db.prepare(`UPDATE timetracker_projects SET color = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(color, id);
}

/** Persist the elapsed/remaining flip (display-only; never touches time_entries). */
export function setTimeDisplayMode(db: Db, id: number, mode: TimeDisplayMode): void {
  assertNotCompleted(db, id);
  const res = db
    .prepare(`UPDATE timetracker_projects SET time_display_mode = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(mode, id);
  if (res.changes === 0) throw new Error(`Project ${id} not found`);
}

/** Drag-to-regroup: sidebar drop updates the DB; every view re-reads from here. */
export function setProjectGroup(db: Db, id: number, groupId: number | null): void {
  assertNotCompleted(db, id);
  if (groupId != null && !getGroup(db, groupId)) throw new Error(`Group ${groupId} not found`);
  const res = db
    .prepare(`UPDATE timetracker_projects SET group_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(groupId, id);
  if (res.changes === 0) throw new Error(`Project ${id} not found`);
}

export function getProjectDetail(db: Db, id: number): ProjectDetail {
  const project = getProject(db, id);
  const entries = db
    .prepare(`SELECT * FROM timetracker_time_entries WHERE project_id = ? ORDER BY started_at DESC, id DESC`)
    .all(id) as TimeEntry[];
  const ledger = db
    .prepare(`SELECT * FROM timetracker_value_ledger WHERE project_id = ? ORDER BY id ASC`)
    .all(id) as LedgerEntry[];
  const costs = db.prepare(`SELECT * FROM timetracker_costs WHERE project_id = ? ORDER BY id ASC`).all(id) as Cost[];
  const adjustments = listActiveAdjustments(db, id);
  const noteRow = db.prepare(`SELECT body FROM timetracker_notes WHERE project_id = ?`).get(id) as
    | { body: string }
    | undefined;
  return { project, entries, ledger, costs, adjustments, note: noteRow?.body ?? "" };
}

export function renameProject(db: Db, id: number, name: string): void {
  assertNotCompleted(db, id);
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Project name is required");
  const res = db
    .prepare(`UPDATE timetracker_projects SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(trimmed, id);
  if (res.changes === 0) throw new Error(`Project ${id} not found`);
}

/**
 * Reorder within the project's own group: move it before beforeProjectId (or to the
 * end when null), rewriting priority_order for that group's projects only.
 */
export function reorderProject(db: Db, id: number, beforeProjectId: number | null): void {
  assertNotCompleted(db, id);
  const me = db.prepare(`SELECT id, group_id FROM timetracker_projects WHERE id = ?`).get(id) as
    | { id: number; group_id: number | null }
    | undefined;
  if (!me) throw new Error(`Project ${id} not found`);
  const siblings = (
    db
      .prepare(
        `SELECT id FROM timetracker_projects WHERE COALESCE(group_id, -1) = COALESCE(?, -1) ORDER BY priority_order ASC, id ASC`
      )
      .all(me.group_id) as { id: number }[]
  ).map((r) => r.id);
  const without = siblings.filter((sid) => sid !== id);
  let insertAt = without.length;
  if (beforeProjectId != null) {
    const idx = without.indexOf(beforeProjectId);
    if (idx === -1) throw new Error("Reorder target must be in the same group");
    insertAt = idx;
  }
  without.splice(insertAt, 0, id);
  const write = db.prepare(`UPDATE timetracker_projects SET priority_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);
  const tx = db.transaction(() => {
    without.forEach((sid, i) => write.run(i + 1, sid));
    setSidebarSort(db, "none"); // manual drag wins — custom order until a sort icon is clicked again
  });
  tx();
}

/** Cascade-remove every row owned by a project + its contract files. Shared by Delete and Purge. */
function cascadeDeleteProject(db: Db, id: number): void {
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM timetracker_time_entries WHERE project_id = ?`).run(id);
    db.prepare(`DELETE FROM timetracker_value_ledger WHERE project_id = ?`).run(id);
    db.prepare(`DELETE FROM timetracker_costs WHERE project_id = ?`).run(id);
    db.prepare(`DELETE FROM timetracker_adjustments WHERE project_id = ?`).run(id);
    db.prepare(`DELETE FROM timetracker_notes WHERE project_id = ?`).run(id);
    db.prepare(`DELETE FROM timetracker_projects WHERE id = ?`).run(id);
  });
  tx();
  fs.rmSync(path.join(getStorageRoot(), "contracts", String(id)), { recursive: true, force: true });
}

/**
 * The ONE allowed destructive path (typed confirmation in the UI): intentionally
 * cascades this project's sessions, ledger, costs, notes, and contract files.
 * Refuses while a live session is running on the project.
 */
export function deleteProject(db: Db, id: number): void {
  assertNotCompleted(db, id); // a completed job cannot be destroyed by accident — reactivate first
  const exists = db.prepare(`SELECT id FROM timetracker_projects WHERE id = ?`).get(id);
  if (!exists) throw new Error(`Project ${id} not found`);
  const live = db.prepare(`SELECT id FROM timetracker_active_sessions WHERE project_id = ?`).get(id);
  if (live) throw new Error("Stop the running timer on this project first");
  cascadeDeleteProject(db, id);
}

// --- archive (soft, recoverable) -> purge (permanent, tombstoned) ---

function appendArchiveAudit(db: Db, id: number, entry: ArchiveAuditEntry): void {
  const row = db.prepare(`SELECT archive_audit FROM timetracker_projects WHERE id = ?`).get(id) as
    | { archive_audit: string | null }
    | undefined;
  const log: ArchiveAuditEntry[] = row?.archive_audit ? (JSON.parse(row.archive_audit) as ArchiveAuditEntry[]) : [];
  log.push(entry);
  db.prepare(`UPDATE timetracker_projects SET archive_audit = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
    JSON.stringify(log),
    id
  );
}

/** Archive is always a deliberate manual action; reason required. Sessions are untouched. */
export function archiveProject(db: Db, id: number, reason: string): void {
  const trimmed = reason.trim();
  if (!trimmed) throw new Error("A reason for archiving is required");
  const exists = db.prepare(`SELECT archived_at FROM timetracker_projects WHERE id = ?`).get(id) as
    | { archived_at: string | null }
    | undefined;
  if (!exists) throw new Error(`Project ${id} not found`);
  if (exists.archived_at) throw new Error("Project is already archived");
  const live = db.prepare(`SELECT id FROM timetracker_active_sessions WHERE project_id = ?`).get(id);
  if (live) throw new Error("Stop the running timer on this project first");
  const at = nowIso();
  db.prepare(
    `UPDATE timetracker_projects SET archived_at = ?, archive_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(at, trimmed, id);
  appendArchiveAudit(db, id, { action: "archived", at, reason: trimmed });
}

/** Restore an archived project to active — data returns intact. */
export function restoreProject(db: Db, id: number): void {
  const row = db.prepare(`SELECT archived_at FROM timetracker_projects WHERE id = ?`).get(id) as
    | { archived_at: string | null }
    | undefined;
  if (!row) throw new Error(`Project ${id} not found`);
  if (!row.archived_at) return;
  appendArchiveAudit(db, id, { action: "restored", at: nowIso() });
  db.prepare(
    `UPDATE timetracker_projects SET archived_at = NULL, archive_reason = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(id);
}

/**
 * Permanent purge (Archive view only, reason required): writes a deletion_log tombstone
 * capturing the exact accumulated minutes, THEN cascades the project's rows away.
 * Other projects' time_entries are untouched.
 */
export function purgeProject(db: Db, orgId: string, id: number, reason: string): DeletionTombstone {
  const trimmed = reason.trim();
  if (!trimmed) throw new Error("A reason for purging is required");
  const project = getProject(db, id); // throws if missing
  if (!project.archived_at) throw new Error("Only archived projects can be purged");
  const live = db.prepare(`SELECT id FROM timetracker_active_sessions WHERE project_id = ?`).get(id);
  if (live) throw new Error("Stop the running timer on this project first");

  const tombstone: DeletionTombstone = {
    uuid: generateUUIDv7(),
    project_name: project.name,
    project_type: classifyProjectType(project.rate_type, project.contract_kind),
    total_minutes: Math.floor(project.total_seconds / 60),
    purged_at: nowIso(),
    purge_reason: trimmed,
  };
  db.prepare(
    `INSERT INTO timetracker_deletion_log (uuid, org_id, project_name, project_type, total_minutes, purged_at, purge_reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    tombstone.uuid,
    orgId,
    tombstone.project_name,
    tombstone.project_type,
    tombstone.total_minutes,
    tombstone.purged_at,
    tombstone.purge_reason,
    nowIso()
  );
  cascadeDeleteProject(db, id);
  return tombstone;
}

/**
 * The Contract-details modal's targeted save (two doors, one answer — the other door is the
 * New-project block writing the same columns through createProject/updateProject). Completion-
 * locked like every project edit.
 */
export function setContractDetails(
  db: Db,
  id: number,
  input: { contractDate: string | null; signedBy: string | null; paymentTerms: string | null; contractAmount: number | null }
): void {
  assertNotCompleted(db, id);
  const res = db
    .prepare(
      `UPDATE timetracker_projects SET
         contract_date = ?, signed_by = ?, payment_terms = ?,
         contract_amount = CASE WHEN rate_type = 'contract' AND contract_kind = 'paid' THEN ? ELSE contract_amount END,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(input.contractDate, input.signedBy, input.paymentTerms, input.contractAmount, id);
  if (res.changes === 0) throw new Error(`Project ${id} not found`);
}

export function getNote(db: Db, projectId: number): string {
  const row = db.prepare(`SELECT body FROM timetracker_notes WHERE project_id = ?`).get(projectId) as
    | { body: string }
    | undefined;
  return row?.body ?? "";
}

export function saveNote(db: Db, orgId: string, projectId: number, body: string): void {
  assertNotCompleted(db, projectId);
  db.prepare(
    `INSERT INTO timetracker_notes (uuid, org_id, project_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`
  ).run(generateUUIDv7(), orgId, projectId, body, nowIso(), nowIso());
}

export function grandTotals(db: Db, orgId: string): GrandTotals {
  const projects = listProjects(db, orgId);
  return {
    total_seconds: projects.reduce((s, p) => s + p.total_seconds, 0),
    total_value: projects.reduce((s, p) => s + p.total_value, 0),
    total_costs: projects.reduce((s, p) => s + p.total_costs, 0),
    project_count: projects.length,
  };
}
