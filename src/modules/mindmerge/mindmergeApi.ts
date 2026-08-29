// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: The renderer's view of the MindMerge AUTHORED-DOCUMENTS bridge. These shapes are
//              renderer-safe COPIES of the service types (the renderer imports from here or from
//              shared types, never from services/), which is why they live in one file and not
//              scattered through the views. The METHOD names are the vault's, unchanged, so the
//              ported views need no edit; only the CHANNEL suffix differs — `listDocs` is the wire,
//              `listNotes` is the method. Note what is ABSENT and cannot be reached by accident:
//              this bridge was TRIMMED from the vault's on the entitlement ruling — no master
//              password, no lock state, no secret read, no servers, DNS, SSH, repos, breach sweep,
//              import/export of credentials, or settings writes. MindMerge holds CONTENT, and
//              content is all it can reach.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: src/modules/mindmerge/mindmergeApi.ts
//------------------------------------------------------------

/** One folder in the document tree. Mirrors MindMergeDocFolder in
    electron/core/services/mindmerge/noteFolders.ts. */
export interface MindMergeDocFolder {
  id: number;
  uuid: string;
  name: string;
  parent_id: number | null;
  sort_order: number;
}

/** Document metadata — what every list surface sees. Mirrors MindMergeDocMeta in
    electron/core/services/mindmerge/notes.ts. Lists carry an EXCERPT, never the body. */
export interface MindMergeDocMeta {
  /** The folder tree reference. NULL = Unfiled. */
  folder_id: number | null;
  id: number;
  uuid: string;
  kind: string;
  title: string;
  excerpt: string;
  folder: string | null;
  pinned: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string | null;
}

/** The whole document, body included — only ever from a single-document read. */
export interface MindMergeDoc extends Omit<MindMergeDocMeta, "excerpt"> {
  body: string;
}

export interface VaultWalkedFile {
  path: string;
  name: string;
  rel: string;
  ext: string;
  size: number;
  /** The file's own dates — carried onto the document so an imported archive keeps its chronology. */
  mtimeMs: number;
  birthtimeMs: number;
}

/** What a folder walk (or a stat of hand-picked files) found. Names and stats only — no file
    contents cross here. The vault type NAME is kept, like VaultWalkedFile above, so the ported
    views need no edit. */
export interface VaultWalkResult {
  files: VaultWalkedFile[];
  skipped: number;
  skippedDirs: string[];
  truncated: boolean;
}

/** Four levels, mirroring LOG_LEVELS in the module log. */
export type VaultLogLevel = "debug" | "info" | "warn" | "error";

/** One colour theme this machine has installed. Mirrors FoundTheme in codeThemes.ts. */
export interface VaultFoundTheme {
  label: string;
  uiTheme: "dark" | "light" | null;
  file: string;
  extension: string;
  /** The one named in the user's own workbench.colorTheme — listed first. */
  active: boolean;
}

export interface MindMergeDocsApi {
  /** The document folder tree. One folder per document, shared by every kind. Counts are
   *  INCLUSIVE of descendants. */
  listNoteFolders: () => Promise<{ folders: MindMergeDocFolder[]; counts: Record<number, number>; unfiled: number }>;
  createNoteFolder: (name: string, parentId?: number | null) => Promise<MindMergeDocFolder>;
  renameNoteFolder: (id: number, name: string) => Promise<MindMergeDocFolder>;
  moveNoteFolder: (id: number, parentId: number | null) => Promise<MindMergeDocFolder>;
  /** What a delete would take, without taking it — the confirm is built from this. `archived` is how
   *  many of `notes` are already on the Archived shelf, which is why this total can exceed the number
   *  the tree shows (the tree excludes archived documents). */
  noteFolderSubtree: (id: number) => Promise<{ folders: number; notes: number; directNotes: number; archived: number }>;
  /** Keeps every document and unfiles the WHOLE subtree; the folders stay. The deliberate opposite
   *  of deleteNoteFolder, and a separate action on purpose. */
  emptyNoteFolder: (id: number) => Promise<{ movedNotes: number }>;
  /** Deletes the folder, its subfolders, and every document in any of them. Permanent. */
  deleteNoteFolder: (id: number) => Promise<{ deletedNotes: number; deletedFolders: number }>;
  /** The recoverable delete: every document in the subtree to the Archived shelf, folders removed. */
  archiveNoteFolder: (id: number) => Promise<{ archivedNotes: number; deletedFolders: number }>;
  /** Clears EVERY document and folder. Destructive and confirm-gated. */
  purgeNotes: () => Promise<{ notes: number; folders: number }>;
  setNoteFolder: (uuid: string, folderId: number | null) => Promise<{ ok: boolean }>;
  /** Pure preview — what folders an import would create. Writes nothing. */
  previewFolderPaths: (rels: string[]) => Promise<string[]>;
  /** Filtered and capped MAIN-side. folderId: undefined = all · null = Unfiled · number = that folder. */
  listNotes: (kind?: string, archived?: boolean, folderId?: number | null, limit?: number, offset?: number)
    => Promise<{ rows: MindMergeDocMeta[]; total: number; truncated: boolean }>;
  /** Search titles and bodies main-side, capped — the global search never holds the corpus. */
  searchNotes: (q: string, limit?: number) => Promise<MindMergeDocMeta[]>;
  restoreNote: (uuid: string) => Promise<MindMergeDoc>;
  /** Hard delete — refused unless the document is archived first. */
  destroyNote: (uuid: string) => Promise<{ ok: boolean }>;
  getNote: (uuid: string) => Promise<MindMergeDoc>;
  createNote: (input: { kind?: string; title: string; body?: string; folder?: string | null; folderId?: number | null }) => Promise<MindMergeDoc>;
  updateNote: (uuid: string, patch: Partial<{ kind: string; title: string; body: string; folder: string | null; pinned: boolean }>) => Promise<MindMergeDoc>;
  archiveNote: (uuid: string) => Promise<{ ok: boolean }>;
  /** Folder import (Phase 4) — choose, walk, review, import. Dialogs are main-side and modal; the
   *  renderer never names a path it was not given. The vault's parseServers/importServers (zone and
   *  host-inventory importers) are NOT here — infrastructure is a vault-only surface, same
   *  entitlement logic as the rest of this trim. */
  chooseFolders: () => Promise<string[]>;
  /** Single files. Filters follow the target; "notes" is the default and the only MindMerge one. */
  chooseFiles: (target?: string) => Promise<string[]>;
  statFiles: (paths: string[]) => Promise<VaultWalkResult>;
  /** The chosen file's text, so a parser can run and a review table can be shown BEFORE any
   *  write. Capped at 8 MB main-side. */
  readImportText: (filePath: string) => Promise<string>;
  walkFolders: (roots: string[]) => Promise<VaultWalkResult>;
  importDocs: (
    files: VaultWalkedFile[],
    opts: { kind?: string; folder?: string | null; mirror?: boolean }
    /** THE COUNTS RECONCILE: scanned === created + skipped + failed + repaired, always. `skipped`
     *  is "already imported by source path" — a WIDER set than any one folder's tree count, because
     *  it spans archived documents and documents filed elsewhere. Report both or neither. */
  ) => Promise<{
    scanned: number;
    created: number;
    warned: number;
    skipped: number;
    /** The three sum to `skipped`. `skippedFiled` is the one comparable to a folder's tree count. */
    skippedFiled: number;
    skippedUnfiled: number;
    skippedArchived: number;
    failed: number;
    /** Blank rows from an earlier silently-failed read, filled in place by this re-import. */
    repaired: number;
    problems: { file: string; reason: string }[];
  }>;
  /** Pasted-image attachments — WIRED (Phase 5, 08-22-2026). Bytes live in MindMerge's OWN
   *  SQLCipher-encrypted file, key machine-held (safeStorage + Argon2id — the "doesnt have to
   *  lock, just be encrypted" ruling answered the key question). A refused save (oversize,
   *  non-image) still surfaces through the editor's catch path, which removes the paste and says
   *  so. Base64 is the TRANSPORT (the bridge speaks JSON); at rest it is a BLOB. */
  saveAttachment: (input: { name?: string; mime: string; dataBase64: string }) => Promise<{ uuid: string; name: string; mime: string; byteCount: number }>;
  getAttachment: (uuid: string) => Promise<{ name: string; mime: string; dataBase64: string }>;
  /** THE copy funnel. Every copy in the module goes through this, never through
   *  navigator.clipboard directly — the main side arms the "clear after N seconds" timer and clears
   *  only if the clipboard still holds this exact value when the timer fires. */
  copyText: (text: string) => Promise<boolean>;
  /** Colour themes installed in Visual Studio Code on this machine. Reads only; never the network. */
  findCodeThemes: () => Promise<{ active: string | null; themes: VaultFoundTheme[] }>;
  /** The RAW text of one — JSONC and all. Parsing lives in codeTheme.ts, one implementation. */
  readCodeTheme: (file: string) => Promise<{ name: string; raw: string }>;
  /** The renderer's own failures. A React crash never reaches the main-side error boundary, so
   *  without this the log would quietly imply the renderer never breaks. Returns the reference id
   *  so a surface can show the user the same six characters that are now in the log. */
  logClient: (level: VaultLogLevel, message: string, detail?: string) => Promise<string>;
}

/** The bridge accessor. There is no `declare global` here: the shell's src/global.d.ts already
    types `window.api` as the full `Api`, whose `mindmerge` member carries these doc methods
    ALONGSIDE the ingest ones — and two Window augmentations of `api` will not merge. */
export const mindmergeApi = (): MindMergeDocsApi => window.api.mindmerge;
