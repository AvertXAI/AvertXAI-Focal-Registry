// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Vault folders — the nested tree behind the folder browse. Parent references are
//              SOFT on both sides by design: deleting a folder never deletes a secret, and never
//              deletes a child folder either. A removed folder's contents fall back to All items,
//              which is the only behaviour that cannot lose a credential by accident. Cycles are
//              refused explicitly (a folder cannot become its own ancestor) because a cycle would
//              hang every render that walks the tree. Electron-free.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/vault/folders.ts
//------------------------------------------------------------
import { generateUUIDv7 } from "../utils/uuidv7";
import { nowIso, type Db } from "./db";
import type { VaultFolder } from "./types";

const MAX_NAME = 120;

function vName(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid folder name");
  const s = value.trim();
  if (s === "") throw new Error("A folder needs a name.");
  if (s.length > MAX_NAME) throw new Error(`A folder name can be at most ${MAX_NAME} characters.`);
  return s;
}

export function listFolders(db: Db, orgId: string): VaultFolder[] {
  return db
    .prepare("SELECT id, uuid, name, parent_id, sort_order FROM vault_folders WHERE org_id = ? ORDER BY sort_order, name COLLATE NOCASE")
    .all(orgId) as VaultFolder[];
}

/** Walks up from `startId`, returning true if `ancestorId` is reached. The step cap is a backstop:
    a cycle already in the data must not hang the caller that is trying to prevent one. */
function isDescendantOf(db: Db, startId: number | null, ancestorId: number): boolean {
  let current = startId;
  for (let steps = 0; steps < 100 && current != null; steps++) {
    if (current === ancestorId) return true;
    const row = db.prepare("SELECT parent_id FROM vault_folders WHERE id = ?").get(current) as { parent_id: number | null } | undefined;
    if (!row) return false;
    current = row.parent_id;
  }
  return false;
}

export function createFolder(db: Db, orgId: string, name: unknown, parentId?: unknown): VaultFolder {
  const clean = vName(name);
  const parent = parentId == null ? null : Number(parentId);
  if (parent != null && !db.prepare("SELECT 1 FROM vault_folders WHERE id = ? AND org_id = ?").get(parent, orgId)) {
    throw new Error("That parent folder does not exist.");
  }
  const at = nowIso();
  const res = db
    .prepare("INSERT INTO vault_folders (uuid, org_id, name, parent_id, sort_order, created_at) VALUES (?, ?, ?, ?, 0, ?)")
    .run(generateUUIDv7(), orgId, clean, parent, at);
  return db.prepare("SELECT id, uuid, name, parent_id, sort_order FROM vault_folders WHERE id = ?").get(res.lastInsertRowid) as VaultFolder;
}

export function renameFolder(db: Db, orgId: string, id: unknown, name: unknown): VaultFolder {
  const folderId = Number(id);
  const clean = vName(name);
  const res = db
    .prepare("UPDATE vault_folders SET name = ?, updated_at = ? WHERE id = ? AND org_id = ?")
    .run(clean, nowIso(), folderId, orgId);
  if (res.changes === 0) throw new Error("That folder does not exist.");
  return db.prepare("SELECT id, uuid, name, parent_id, sort_order FROM vault_folders WHERE id = ?").get(folderId) as VaultFolder;
}

/** Re-parents a folder. Refuses to make a folder its own ancestor, which would orphan a whole
    branch out of the tree and spin any renderer that walks it. */
export function moveFolder(db: Db, orgId: string, id: unknown, newParentId: unknown): VaultFolder {
  const folderId = Number(id);
  const parent = newParentId == null ? null : Number(newParentId);
  if (parent === folderId) throw new Error("A folder cannot be inside itself.");
  if (parent != null && isDescendantOf(db, parent, folderId)) {
    throw new Error("A folder cannot be moved inside one of its own folders.");
  }
  const res = db
    .prepare("UPDATE vault_folders SET parent_id = ?, updated_at = ? WHERE id = ? AND org_id = ?")
    .run(parent, nowIso(), folderId, orgId);
  if (res.changes === 0) throw new Error("That folder does not exist.");
  return db.prepare("SELECT id, uuid, name, parent_id, sort_order FROM vault_folders WHERE id = ?").get(folderId) as VaultFolder;
}

/**
 * Deletes the folder only. Its child folders move up to its parent, and any secret inside it falls
 * back to All items — NOTHING is deleted with it. Deleting a container must never delete contents
 * the user did not name; that mistake is unrecoverable in a credential store.
 */
export function deleteFolder(db: Db, orgId: string, id: unknown): { movedSecrets: number; movedFolders: number } {
  const folderId = Number(id);
  const row = db.prepare("SELECT parent_id FROM vault_folders WHERE id = ? AND org_id = ?").get(folderId, orgId) as
    | { parent_id: number | null }
    | undefined;
  if (!row) throw new Error("That folder does not exist.");
  const at = nowIso();
  let movedSecrets = 0;
  let movedFolders = 0;
  db.transaction(() => {
    movedSecrets = db
      .prepare("UPDATE vault_secrets SET folder_id = NULL, updated_at = ? WHERE org_id = ? AND folder_id = ?")
      .run(at, orgId, folderId).changes;
    movedFolders = db
      .prepare("UPDATE vault_folders SET parent_id = ?, updated_at = ? WHERE org_id = ? AND parent_id = ?")
      .run(row.parent_id, at, orgId, folderId).changes;
    db.prepare("DELETE FROM vault_folders WHERE id = ? AND org_id = ?").run(folderId, orgId);
  })();
  return { movedSecrets, movedFolders };
}
