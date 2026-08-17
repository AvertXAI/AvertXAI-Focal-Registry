// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: The Secured Notes folder tree. Jason ruled all three shape questions on 08-11-2026:
//              · SEPARATE from the Passwords tree — "Financial" and "Photography" are password
//                folders, and one tree holding credentials AND thousands of markdown files stops
//                being navigable. Same behaviour, two trees.
//              · ONE folder per note. Tags do the many-places job better, and a note in two places
//                makes "delete this folder" ambiguous.
//              · Notes, Runbooks and Snippets SHARE the tree — they are one stored shape with three
//                list styles, and three parallel trees over one table would be three places to file
//                the same thing.
//
//              DELETING A FOLDER DELETES EVERYTHING IN IT. Subfolders, and every note in any of
//              them. Jason ruled it on 08-12-2026 — "if i delete a folder, EVERYTHING in that folder,
//              whether sub-folders or files inside that folder MUST be deleted". The confirm states
//              the counts BEFORE anything happens; that warning is the only guard on the delete,
//              which is why it is not optional.
//
//              THREE DOORS OUT OF A FOLDER, and they are deliberately three verbs rather than one
//              button with options — "remove everything", "keep everything but recoverable" and
//              "keep everything in place" are different outcomes and must not share a control:
//                · deleteNoteFolder  — the folder, its subfolders, and every note. Gone.
//                · archiveNoteFolder — every note to the Archived shelf, folders removed. Restorable.
//                    (Jason 08-12-2026: the folder prompt should offer the same three choices the
//                     note trashbin does — cancel, delete, archive.)
//                · emptyNoteFolder   — every note to Unfiled, folders left standing. Nothing deleted.
//
//              Electron-free and filesystem-free, like every other note service: this file cannot
//              touch a file on disk even by accident.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/vault/noteFolders.ts
//------------------------------------------------------------
import { generateUUIDv7 } from "../utils/uuidv7";
import { nowIso, type Db } from "./db";

const MAX_NAME = 120;
/** A tree deeper than this is a mistake, and an import can generate one from a stray path. */
const MAX_DEPTH = 12;

export interface VaultNoteFolder {
  id: number;
  uuid: string;
  name: string;
  parent_id: number | null;
  sort_order: number;
}

function cleanName(name: unknown): string {
  if (typeof name !== "string") throw new Error("Invalid folder name");
  const v = name.trim();
  if (v === "") throw new Error("A folder needs a name.");
  if (v.length > MAX_NAME) throw new Error(`A folder name can be at most ${MAX_NAME} characters.`);
  return v;
}

export function listNoteFolders(db: Db, orgId: string): VaultNoteFolder[] {
  return db
    .prepare("SELECT id, uuid, name, parent_id, sort_order FROM vault_note_folders WHERE org_id = ? ORDER BY sort_order, name")
    .all(orgId) as VaultNoteFolder[];
}

/**
 * Note counts per folder, INCLUSIVE OF DESCENDANTS.
 *
 * A parent reading 0 while its children hold a thousand notes is the kind of number that makes
 * people distrust the whole tree, so the rollup happens here rather than being left to the renderer
 * to get subtly wrong. Direct counts are one indexed GROUP BY; the rollup is then pure arithmetic
 * over the parent chain, so this stays one query regardless of depth.
 */
export function noteFolderCounts(db: Db, orgId: string): Record<number, number> {
  const direct = db
    .prepare("SELECT folder_id AS id, COUNT(*) AS n FROM vault_notes WHERE org_id = ? AND folder_id IS NOT NULL AND archived_at IS NULL GROUP BY folder_id")
    .all(orgId) as { id: number; n: number }[];
  const parentOf = new Map<number, number | null>();
  for (const f of listNoteFolders(db, orgId)) parentOf.set(f.id, f.parent_id);

  const out: Record<number, number> = {};
  for (const id of parentOf.keys()) out[id] = 0;
  for (const row of direct) {
    let cursor: number | null = row.id;
    let hops = 0;
    // Walk UP, adding this folder's own notes to every ancestor. The hop guard means a cycle
    // introduced by a bad write cannot spin forever — moveNoteFolder already refuses to create one.
    while (cursor != null && hops++ <= MAX_DEPTH) {
      out[cursor] = (out[cursor] ?? 0) + row.n;
      cursor = parentOf.get(cursor) ?? null;
    }
  }
  return out;
}

/** How many notes have no folder at all. Unfiled is always shown, even at zero — a hidden Unfiled
    is how notes get lost. */
export function unfiledNoteCount(db: Db, orgId: string): number {
  return (db
    .prepare("SELECT COUNT(*) AS n FROM vault_notes WHERE org_id = ? AND folder_id IS NULL AND archived_at IS NULL")
    .get(orgId) as { n: number }).n;
}

export function createNoteFolder(db: Db, orgId: string, name: unknown, parentId?: unknown): VaultNoteFolder {
  const clean = cleanName(name);
  const parent = parentId == null || parentId === "" ? null : Number(parentId);
  if (parent != null) {
    const exists = db.prepare("SELECT id FROM vault_note_folders WHERE id = ? AND org_id = ?").get(parent, orgId);
    if (!exists) throw new Error("That parent folder does not exist.");
  }
  const at = nowIso();
  const info = db
    .prepare("INSERT INTO vault_note_folders (uuid, org_id, name, parent_id, sort_order, created_at) VALUES (?, ?, ?, ?, 0, ?)")
    .run(generateUUIDv7(), orgId, clean, parent, at);
  return db
    .prepare("SELECT id, uuid, name, parent_id, sort_order FROM vault_note_folders WHERE id = ?")
    .get(Number(info.lastInsertRowid)) as VaultNoteFolder;
}

export function renameNoteFolder(db: Db, orgId: string, id: unknown, name: unknown): VaultNoteFolder {
  const clean = cleanName(name);
  const folderId = Number(id);
  const changed = db
    .prepare("UPDATE vault_note_folders SET name = ?, updated_at = ? WHERE id = ? AND org_id = ?")
    .run(clean, nowIso(), folderId, orgId).changes;
  if (changed === 0) throw new Error("That folder does not exist.");
  return db
    .prepare("SELECT id, uuid, name, parent_id, sort_order FROM vault_note_folders WHERE id = ?")
    .get(folderId) as VaultNoteFolder;
}

/** Re-parent a folder with its whole subtree. REFUSES a move into itself or a descendant — that
    would detach the subtree from the root and it would vanish from every list. */
export function moveNoteFolder(db: Db, orgId: string, id: unknown, newParentId: unknown): VaultNoteFolder {
  const folderId = Number(id);
  const parent = newParentId == null || newParentId === "" ? null : Number(newParentId);
  if (parent === folderId) throw new Error("A folder cannot be moved inside itself.");
  const all = listNoteFolders(db, orgId);
  if (parent != null && !all.some((f) => f.id === parent)) throw new Error("That parent folder does not exist.");

  let cursor: number | null = parent;
  let hops = 0;
  while (cursor != null && hops++ <= MAX_DEPTH) {
    if (cursor === folderId) throw new Error("A folder cannot be moved inside one of its own subfolders.");
    cursor = all.find((f) => f.id === cursor)?.parent_id ?? null;
  }
  const changed = db
    .prepare("UPDATE vault_note_folders SET parent_id = ?, updated_at = ? WHERE id = ? AND org_id = ?")
    .run(parent, nowIso(), folderId, orgId).changes;
  if (changed === 0) throw new Error("That folder does not exist.");
  return db
    .prepare("SELECT id, uuid, name, parent_id, sort_order FROM vault_note_folders WHERE id = ?")
    .get(folderId) as VaultNoteFolder;
}

/**
 * Delete a folder. `withContents` decides which of the two things it means:
 *   TRUE  — the folder, every folder beneath it, and every note in any of them. Jason's default.
 *   FALSE — the folder only; its notes go to Unfiled and its children lift one level.
 * Returns all four counts so the caller can report exactly what happened.
 */
export function deleteNoteFolder(
  db: Db,
  orgId: string,
  id: unknown
): { deletedNotes: number; deletedFolders: number } {
  const folderId = Number(id);
  const row = db.prepare("SELECT parent_id FROM vault_note_folders WHERE id = ? AND org_id = ?").get(folderId, orgId) as
    | { parent_id: number | null }
    | undefined;
  if (!row) throw new Error("That folder does not exist.");

  const ids = subtreeIds(db, orgId, folderId);
  const marks = ids.map(() => "?").join(",");
  let deletedNotes = 0;
  let deletedFolders = 0;
  db.transaction(() => {
    deletedNotes = db.prepare(`DELETE FROM vault_notes WHERE org_id = ? AND folder_id IN (${marks})`).run(orgId, ...ids).changes;
    deletedFolders = db.prepare(`DELETE FROM vault_note_folders WHERE org_id = ? AND id IN (${marks})`).run(orgId, ...ids).changes;
  })();
  return { deletedNotes, deletedFolders };
}

/**
 * ARCHIVE a folder — the third way out, and the one Jason asked for on 08-12-2026 ("if i wanted to
 * delete a note, and i hit the trashbin, i get 3 options, cancel, delete or archive. I should get
 * that option for the folder").
 *
 * It is the note-level archive applied to a whole subtree: every note in it moves to the Archived
 * shelf with its text kept in full and restorable, and the now-empty folders are removed. The folders
 * go because leaving a tree of empty boxes behind is not "archived", it is litter — and the notes are
 * still reachable on the Archived shelf, which is the point of the shelf existing.
 *
 * Already-archived notes are left alone rather than re-stamped, so the returned count is what this
 * action actually moved.
 */
export function archiveNoteFolder(
  db: Db,
  orgId: string,
  id: unknown
): { archivedNotes: number; deletedFolders: number } {
  const folderId = Number(id);
  const exists = db.prepare("SELECT id FROM vault_note_folders WHERE id = ? AND org_id = ?").get(folderId, orgId);
  if (!exists) throw new Error("That folder does not exist.");
  const ids = subtreeIds(db, orgId, folderId);
  const marks = ids.map(() => "?").join(",");
  const at = nowIso();
  let archivedNotes = 0;
  let deletedFolders = 0;
  db.transaction(() => {
    archivedNotes = db
      .prepare(
        `UPDATE vault_notes SET archived_at = ?, updated_at = ?, folder_id = NULL
           WHERE org_id = ? AND folder_id IN (${marks}) AND archived_at IS NULL`
      )
      .run(at, at, orgId, ...ids).changes;
    // Anything still pointing here was already archived — unfile it too, or the folder delete below
    // would orphan a row nothing can reach.
    db.prepare(`UPDATE vault_notes SET folder_id = NULL WHERE org_id = ? AND folder_id IN (${marks})`).run(orgId, ...ids);
    deletedFolders = db.prepare(`DELETE FROM vault_note_folders WHERE org_id = ? AND id IN (${marks})`).run(orgId, ...ids).changes;
  })();
  return { archivedNotes, deletedFolders };
}

/**
 * EMPTY a folder — keep every note, just stop them being filed here. Jason asked for it as a
 * deliberate action rather than an option on the delete prompt (08-12-2026), and that separation is
 * the point: "remove everything" and "keep everything" are opposite outcomes and must not share a
 * button.
 *
 * Moves the WHOLE SUBTREE's notes, not just the ones sitting directly in this folder. The earlier
 * version moved only the direct ones, which is why emptying a folder of 7 could move 1 — correct by
 * its own logic and useless as an answer to "where did my notes go".
 *
 * The folders themselves are LEFT STANDING. Emptying is not deleting; if you want them gone,
 * deleteNoteFolder is the other door and it says so.
 */
export function emptyNoteFolder(db: Db, orgId: string, id: unknown): { movedNotes: number } {
  const folderId = Number(id);
  const exists = db.prepare("SELECT id FROM vault_note_folders WHERE id = ? AND org_id = ?").get(folderId, orgId);
  if (!exists) throw new Error("That folder does not exist.");
  const ids = subtreeIds(db, orgId, folderId);
  const marks = ids.map(() => "?").join(",");
  const movedNotes = db
    .prepare(`UPDATE vault_notes SET folder_id = NULL, updated_at = ? WHERE org_id = ? AND folder_id IN (${marks})`)
    .run(nowIso(), orgId, ...ids).changes;
  return { movedNotes };
}

/** Every folder id at or beneath `root`. Shared by the delete and the count it is confirmed with,
    so the number shown and the set removed can never disagree. */
function subtreeIds(db: Db, orgId: string, root: number): number[] {
  const all = listNoteFolders(db, orgId);
  const out = [root];
  for (let i = 0; i < out.length && i < 5000; i++) {
    for (const f of all) if (f.parent_id === out[i] && !out.includes(f.id)) out.push(f.id);
  }
  return out;
}

/** Move ONE note into a folder, or to Unfiled with null. One folder per note, by ruling. */
export function setNoteFolder(db: Db, orgId: string, uuid: unknown, folderId: unknown): void {
  const target = folderId == null || folderId === "" ? null : Number(folderId);
  if (target != null) {
    const exists = db.prepare("SELECT id FROM vault_note_folders WHERE id = ? AND org_id = ?").get(target, orgId);
    if (!exists) throw new Error("That folder does not exist.");
  }
  const changed = db
    .prepare("UPDATE vault_notes SET folder_id = ?, updated_at = ? WHERE org_id = ? AND uuid = ?")
    .run(target, nowIso(), orgId, String(uuid)).changes;
  if (changed === 0) throw new Error("Note not found");
}

// ---------------------------------------------------------------- import path mapping

/**
 * Turn a file's RELATIVE PATH into a folder chain, creating what is missing and REUSING what is
 * already there. This is what makes "mirror the folders on disk" work — the importer already
 * carries `rel` for every walked file, so the structure you spent years arranging survives the
 * import instead of collapsing into one "Category" box.
 *
 * The filename itself is dropped: a note is not its own folder. Depth is capped so a pathological
 * path cannot build a hundred-deep chain.
 *
 * `cache` is passed in by the caller and reused across the whole import — without it, 2,000 files
 * sharing 142 folders would run thousands of redundant SELECTs.
 */
export function ensureFolderPath(
  db: Db,
  orgId: string,
  relPath: unknown,
  cache: Map<string, number>
): number | null {
  const rel = typeof relPath === "string" ? relPath : "";
  if (!rel) return null;
  // Both separators — a walk on Windows produces backslashes, a pasted path may not.
  const parts = rel.split(/[\\/]+/).filter((p) => p !== "" && p !== "." && p !== "..");
  parts.pop(); // the filename is not a folder
  if (parts.length === 0) return null;

  let parent: number | null = null;
  let key = "";
  for (const raw of parts.slice(0, MAX_DEPTH)) {
    const name = raw.trim().slice(0, MAX_NAME);
    if (!name) continue;
    key = key ? `${key}/${name}` : name;
    const hit = cache.get(key);
    if (hit != null) { parent = hit; continue; }

    const existing = db
      .prepare(
        parent == null
          ? "SELECT id FROM vault_note_folders WHERE org_id = ? AND name = ? AND parent_id IS NULL"
          : "SELECT id FROM vault_note_folders WHERE org_id = ? AND name = ? AND parent_id = ?"
      )
      .get(...(parent == null ? [orgId, name] : [orgId, name, parent])) as { id: number } | undefined;

    let id: number;
    if (existing) id = existing.id;
    else {
      const info = db
        .prepare("INSERT INTO vault_note_folders (uuid, org_id, name, parent_id, sort_order, created_at) VALUES (?, ?, ?, ?, 0, ?)")
        .run(generateUUIDv7(), orgId, name, parent, nowIso());
      id = Number(info.lastInsertRowid);
    }
    cache.set(key, id);
    parent = id;
  }
  return parent;
}

/** How many folders a set of relative paths WOULD produce — for the import preview, writes nothing. */
export function previewFolderPaths(rels: unknown): string[] {
  const list = Array.isArray(rels) ? rels : [];
  const seen = new Set<string>();
  for (const r of list) {
    const rel = typeof r === "string" ? r : "";
    const parts = rel.split(/[\\/]+/).filter((p) => p !== "" && p !== "." && p !== "..");
    parts.pop();
    let key = "";
    for (const raw of parts.slice(0, MAX_DEPTH)) {
      const name = raw.trim().slice(0, MAX_NAME);
      if (!name) continue;
      key = key ? `${key}/${name}` : name;
      seen.add(key);
    }
  }
  return [...seen].sort();
}


/**
 * What deleting this folder WOULD take, without taking it. The confirm dialog is built from this —
 * a destructive prompt that cannot say how much it is about to destroy is not a warning, it is a
 * formality (Jason 08-12-2026: "we need a modal warning of deleting that folder or file, before
 * deleting").
 */
export function noteFolderSubtree(
  db: Db,
  orgId: string,
  id: unknown
): { folders: number; notes: number; directNotes: number; archived: number } {
  const root = Number(id);
  const ids = subtreeIds(db, orgId, root);
  const marks = ids.map(() => "?").join(",");
  const notes = (db
    .prepare(`SELECT COUNT(*) AS n FROM vault_notes WHERE org_id = ? AND folder_id IN (${marks})`)
    .get(orgId, ...ids) as { n: number }).n;
  // THE NUMBER THAT MADE THE TREE LOOK WRONG. This count includes archived notes; the tree's own
  // count (noteFolderCounts) excludes them. So a folder showing 0 could delete 1, and deleting one
  // note could drop the parent's total by two — which is exactly what Jason watched happen when he
  // archived a note and then deleted its folder (08-12-2026). Both numbers were right and neither
  // was stated, so the confirm now says how many of them are already archived.
  const archived = (db
    .prepare(`SELECT COUNT(*) AS n FROM vault_notes WHERE org_id = ? AND folder_id IN (${marks}) AND archived_at IS NOT NULL`)
    .get(orgId, ...ids) as { n: number }).n;
  // DIRECT notes are the only ones "keep the notes" actually unfiles — the rest stay filed inside
  // the subfolders, which are lifted rather than removed. Jason deleted a folder of 7 and watched
  // Unfiled move by 1 (08-12-2026); the two numbers were never distinguished on screen, so the
  // outcome looked like a miscount instead of two different things happening.
  const directNotes = (db
    .prepare("SELECT COUNT(*) AS n FROM vault_notes WHERE org_id = ? AND folder_id = ?")
    .get(orgId, root) as { n: number }).n;
  return { folders: ids.length, notes, directNotes, archived };
}
