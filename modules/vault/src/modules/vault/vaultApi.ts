// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: The renderer's view of the vault bridge. These shapes are renderer-safe COPIES of
//              the service types (the renderer imports from shared types, never from services/) —
//              on copy-back they move into src/shared/types.ts and the preload gains the matching
//              `vault:` block, which is why they live in one file and not scattered through the
//              views. Note what is ABSENT and cannot be reached by accident: no bulk value read, no
//              past-version value, no way to write an internal setting.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: src/modules/vault/vaultApi.ts
//------------------------------------------------------------

export interface VaultSecretExtras {
  backupCodes?: string[];
  securityQuestions?: { question: string; answer: string }[];
  /** SSH key passphrase — versions with the private key it unlocks. ssh_key kind only. */
  passphrase?: string;
}

/** Metadata — what every list surface may see. No credential field exists here. */
export interface VaultSecretMeta {
  id: number;
  uuid: string;
  kind: string;
  label: string;
  full_name: string | null;
  username: string | null;
  url: string | null;
  notes: string | null;
  favourite: number;
  folder_id: number | null;
  /** ssh_key kind — NOT a secret; the fingerprint and randomart derive from it. */
  public_key: string | null;
  version: number;
  archived_at: string | null;
  archive_reason: string | null;
  created_at: string;
  updated_at: string | null;
  last_read_at?: string | null;
}

/** The only shape that carries credentials, and only ever from read(). */
export interface VaultSecretWithValue extends VaultSecretMeta {
  value: string;
  extras: VaultSecretExtras | null;
}

export interface VaultSecretInput {
  kind: string;
  label: string;
  value: string;
  fullName?: string | null;
  username?: string | null;
  url?: string | null;
  notes?: string | null;
  folderId?: number | null;
  publicKey?: string | null;
  extras?: VaultSecretExtras | null;
}

export interface VaultVersionRow {
  version: number;
  created_at: string;
  has_extras: boolean;
}

export interface VaultAccessRow {
  id: number;
  ts: string;
  action: string;
  secret_uuid: string | null;
  secret_label: string | null;
  caller: string;
  granted: number;
  detail: string | null;
}

export interface VaultHealthItem {
  uuid: string;
  label: string;
  username: string | null;
  score: number;
  weak: boolean;
  reused: boolean;
  ageDays: number | null;
  stale: boolean;
  reasons: string[];
}

export interface VaultHealthReport {
  total: number;
  healthy: number;
  weak: number;
  reused: number;
  stale: number;
  score: number;
  items: VaultHealthItem[];
}

export interface VaultGeneratorOptions {
  length: number;
  lowercase: boolean;
  uppercase: boolean;
  numbers: boolean;
  symbols: boolean;
  excludeSimilar: boolean;
  excludeAmbiguous: boolean;
  noRepeats: boolean;
}

export interface VaultStrength {
  bits: number;
  level: 0 | 1 | 2 | 3 | 4;
  label: string;
  crackTime: string;
}

export interface VaultLockState {
  enabled: boolean;
  locked: boolean;
  failedAttempts: number;
  autoLockMinutes: number;
}

export interface VaultFolder {
  id: number;
  uuid: string;
  name: string;
  parent_id: number | null;
  sort_order: number;
}

export interface VaultApi {
  lockState: () => Promise<VaultLockState>;
  unlock: (password: string) => Promise<VaultLockState>;
  lock: () => Promise<VaultLockState>;
  changeMasterPassword: (current: string, next: string) => Promise<VaultLockState>;
  create: (input: VaultSecretInput) => Promise<VaultSecretMeta>;
  list: (includeArchived?: boolean) => Promise<VaultSecretMeta[]>;
  /** THE one credential path. Access-logged main-side, misses included. */
  read: (uuid: string) => Promise<VaultSecretWithValue>;
  supersede: (uuid: string, value: string, extras?: VaultSecretExtras | null) => Promise<VaultSecretMeta>;
  updateMeta: (uuid: string, patch: Partial<VaultSecretInput>) => Promise<VaultSecretMeta>;
  setFavourite: (uuid: string, on: boolean) => Promise<VaultSecretMeta>;
  archive: (uuid: string, reason?: string | null) => Promise<VaultSecretMeta>;
  restore: (uuid: string) => Promise<VaultSecretMeta>;
  listVersions: (uuid: string) => Promise<VaultVersionRow[]>;
  listAccessLog: (opts?: { limit?: number; secretUuid?: string }) => Promise<VaultAccessRow[]>;
  /** Folders are containers only — deleting one moves its contents to Unfiled, never deletes them. */
  /** Dark-web exposure. The ONLY network calls in the vault; both are off until enabled.
   *  The sweep is k-anonymous — no password or fragment leaves. The email check DOES send the
   *  address, so it is one at a time, on an explicit press. */
  breachSweep: () => Promise<{ ok: boolean; error?: string; checked: number; exposed: { uuid: string; label: string; site: string | null; count: number | null }[] }>;
  /** Polled while a sweep runs, so the screen shows "14 of 46" instead of a frozen button. */
  breachProgress: () => Promise<{ running: boolean; done: number; total: number; found: number }>;
  breachEmail: (email: string) => Promise<{ ok: boolean; error?: string; exposed: boolean; breaches: string[] }>;
  listFolders: () => Promise<VaultFolder[]>;
  createFolder: (name: string, parentId?: number | null) => Promise<VaultFolder>;
  renameFolder: (id: number, name: string) => Promise<VaultFolder>;
  moveFolder: (id: number, parentId: number | null) => Promise<VaultFolder>;
  deleteFolder: (id: number) => Promise<{ movedSecrets: number; movedFolders: number }>;
  health: () => Promise<VaultHealthReport>;
  generate: (opts?: Partial<VaultGeneratorOptions>) => Promise<string>;
  /** The mockup's other five generator tabs — all local computation, nothing stored or sent. */
  generatePassphrase: (opts?: { words?: number; separator?: string; capitalise?: boolean; includeNumber?: boolean }) => Promise<string>;
  generateMemorable: (length?: number) => Promise<string>;
  generatePin: (digits?: number) => Promise<string>;
  generateBulk: (count?: number, opts?: Partial<VaultGeneratorOptions>) => Promise<string[]>;
  strength: (value: string) => Promise<VaultStrength>;
  getSettings: () => Promise<Record<string, string>>;
  setSetting: (key: string, value: string) => Promise<Record<string, string>>;
  seedStatus: () => Promise<{ present: boolean; count: number }>;
  loadSeed: () => Promise<{ ok: boolean; error?: string; created?: number; superseded?: number }>;
  purgeSeed: () => Promise<{ ok: boolean; error?: string; removed?: number }>;
  /** Import / export. NOTE WHAT DOES NOT CROSS: the renderer never sends or receives a credential.
   *  It asks main for a file dialog, hands back the path it was given, and gets counts. */
  /** Finds the export file already sitting on disk for this source. Names and stat only — never a
   *  browser profile, never contents. Empty array = nothing found, open the dialog. */
  findExports: (kind?: string) => Promise<VaultExportCandidate[]>;
  /** Opens the folder in the OS file browser — highlighting `filePath` when given. Shows, never reads. */
  revealExportFolder: (kind?: string, filePath?: string) => Promise<boolean>;
  chooseImportFile: (kind?: string) => Promise<string | null>;
  importPreview: (filePath: string) => Promise<VaultImportPreview>;
  importCsv: (filePath: string, mapping: VaultImportMapping) => Promise<VaultImportResult>;
  importArchive: (filePath: string, passphrase: string) => Promise<VaultImportResult>;
  /** null when the save dialog was cancelled — a cancel is not an error and is never logged. */
  exportVault: (kind: "csv" | "archive", passphrase?: string) => Promise<{ count: number; path: string } | null>;
  /** Folder import — choose, walk, review, import. One importer per tab. */
  chooseFolders: () => Promise<string[]>;
  /** Single files — what Infrastructure actually imports. Filters follow the target. */
  chooseFiles: (target?: string) => Promise<string[]>;
  statFiles: (paths: string[]) => Promise<VaultWalkResult>;
  /** The chosen file's text, so a parser can run and a review table can be shown BEFORE any
   *  write. Capped at 8 MB main-side. */
  readImportText: (filePath: string) => Promise<string>;
  /** Pure parse of a host inventory (CSV or JSON) — writes nothing. */
  parseServers: (text: string) => Promise<{ servers: VaultParsedServer[]; skipped: number }>;
  importServers: (servers: VaultParsedServer[]) => Promise<{ imported: number }>;
  walkFolders: (roots: string[]) => Promise<VaultWalkResult>;
  importDocs: (
    files: VaultWalkedFile[],
    opts: { kind?: string; folder?: string | null; mirror?: boolean }
    /** THE COUNTS RECONCILE: scanned === created + skipped + failed, always. `skipped` is "already in
     *  the vault by source path" — a WIDER set than any one folder's tree count, because it spans
     *  archived notes and notes filed elsewhere. Report both or neither. */
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
    problems: { file: string; reason: string }[];
  }>;
  /** The event log. Reading is UNGATED on purpose — the log is where you look when the vault will
   *  not open, and it holds no secret values by construction. */
  listEvents: (opts?: { limit?: number; level?: VaultLogLevel; search?: string }) => Promise<VaultLogRow[]>;
  /** Full rebuild — reclaims deleted space and upgrades a legacy file to incremental auto-vacuum. */
  compact: () => Promise<{ before: number; after: number; freed: number }>;
  /** PRESSURE-triggered compaction. Fires when the file is measurably bloated, not on a calendar;
   *  the schedule is only a backstop. Pass `true` for a dry run that returns the arithmetic and
   *  compacts nothing — that is what Settings renders. */
  compactIfDue: (dry?: boolean) => Promise<VaultCompactStatus>;
  /** Clears info and debug ONLY. Errors and warnings are evidence and are never removed. */
  /** Removes info and debug only. Bounded by construction — it CANNOT destroy evidence. */
  clearLog: () => Promise<{ removed: number }>;
  /** Removes EVERYTHING, errors and warnings included. Developer surface, typed-confirm gated. */
  clearAllLog: () => Promise<{ removed: number }>;
  /** The renderer's own failures. A React crash never reaches the main-side error boundary, so
   *  without this the log would quietly imply the renderer never breaks. Returns the reference id
   *  so a surface can show the user the same six characters that are now in the log. */
  logClient: (level: VaultLogLevel, message: string, detail?: string) => Promise<string>;
  /** The Secured Notes folder tree. SEPARATE from the Passwords tree by ruling (08-11-2026), one
   *  folder per note, shared by Notes/Runbooks/Snippets. Counts are INCLUSIVE of descendants. */
  listNoteFolders: () => Promise<{ folders: VaultNoteFolder[]; counts: Record<number, number>; unfiled: number }>;
  createNoteFolder: (name: string, parentId?: number | null) => Promise<VaultNoteFolder>;
  renameNoteFolder: (id: number, name: string) => Promise<VaultNoteFolder>;
  moveNoteFolder: (id: number, parentId: number | null) => Promise<VaultNoteFolder>;
  /** Notes go to Unfiled, subfolders lift one level. A NOTE IS NEVER DELETED BY THIS. */
  /** What a delete would take, without taking it — the confirm is built from this. `archived` is how
   *  many of `notes` are already on the Archived shelf, which is why this total can exceed the number
   *  the tree shows (the tree excludes archived notes). */
  noteFolderSubtree: (id: number) => Promise<{ folders: number; notes: number; directNotes: number; archived: number }>;
  /** Keeps every note and unfiles the WHOLE subtree; the folders stay. The deliberate opposite of
   *  deleteNoteFolder, and a separate action on purpose. */
  emptyNoteFolder: (id: number) => Promise<{ movedNotes: number }>;
  /** Deletes the folder, its subfolders, and every note in any of them. Permanent. */
  deleteNoteFolder: (id: number) => Promise<{ deletedNotes: number; deletedFolders: number }>;
  /** The recoverable delete: every note in the subtree to the Archived shelf, folders removed. */
  archiveNoteFolder: (id: number) => Promise<{ archivedNotes: number; deletedFolders: number }>;
  /** Clears EVERY note and folder. Destructive and confirm-gated — see VaultSettingsView. */
  purgeNotes: () => Promise<{ notes: number; folders: number }>;
  setNoteFolder: (uuid: string, folderId: number | null) => Promise<{ ok: boolean }>;
  /** Pure preview — what folders an import would create. Writes nothing. */
  previewFolderPaths: (rels: string[]) => Promise<string[]>;
  /** Secured Notes — bodies are content, not credentials; lists carry an excerpt, never the body. */
  /** Filtered and capped MAIN-side. folderId: undefined = all · null = Unfiled · number = that folder. */
  listNotes: (kind?: string, archived?: boolean, folderId?: number | null, limit?: number, offset?: number)
    => Promise<{ rows: VaultNoteMeta[]; total: number; truncated: boolean }>;
  /** Search titles and bodies main-side, capped — the global search never holds the corpus. */
  searchNotes: (q: string, limit?: number) => Promise<VaultNoteMeta[]>;
  restoreNote: (uuid: string) => Promise<VaultNote>;
  /** Hard delete — refused unless the note is archived first. */
  destroyNote: (uuid: string) => Promise<{ ok: boolean }>;
  getNote: (uuid: string) => Promise<VaultNote>;
  createNote: (input: { kind?: string; title: string; body?: string; folder?: string | null; folderId?: number | null }) => Promise<VaultNote>;
  updateNote: (uuid: string, patch: Partial<{ kind: string; title: string; body: string; folder: string | null; pinned: boolean }>) => Promise<VaultNote>;
  archiveNote: (uuid: string) => Promise<{ ok: boolean }>;
  /** Infrastructure — rows point at credentials by locator, never contain one. */
  listServers: () => Promise<VaultServer[]>;
  saveServer: (input: Partial<VaultServer> & { host: string; sshSecretUuid?: string | null; runbookUuid?: string | null }) => Promise<VaultServer>;
  deleteServer: (uuid: string) => Promise<{ ok: boolean }>;
  listDns: (domain?: string) => Promise<VaultDnsRecord[]>;
  saveDnsRecord: (input: Partial<VaultDnsRecord> & { domain: string; name: string; rtype: string; content: string }) => Promise<VaultDnsRecord>;
  deleteDnsRecord: (uuid: string) => Promise<{ ok: boolean }>;
  /** Pure parse — writes NOTHING; the review table approves, importZone writes. */
  parseZone: (text: string) => Promise<{ records: VaultZoneRecord[]; flagged: { record: VaultZoneRecord; why: string }[] }>;
  importZone: (domain: string, records: VaultZoneRecord[]) => Promise<{ imported: number }>;
  /** Fingerprint + randomart — derived from the public key every call, never stored, no reveal. */
  sshArt: (uuid: string) => Promise<{ ok: boolean; error?: string; keyType?: string; bits?: number; fingerprint?: string; randomart?: string }>;
  /** Repos + the package ledger. */
  listRepos: () => Promise<VaultRepo[]>;
  saveRepo: (input: Partial<VaultRepo> & { name: string; localPath?: string | null; remoteUrl?: string | null; deploySecretUuid?: string | null; readmeMd?: string | null }) => Promise<VaultRepo>;
  deleteRepo: (uuid: string) => Promise<{ ok: boolean }>;
  scanPackages: () => Promise<{ packages: VaultPackageRow[]; totalMb: number }>;
  /** Local clone discovery — filesystem ONLY, reads .git/config for the remote. No network. */
  chooseScanRoot: () => Promise<string | null>;
  scanLocalRepos: (root: string) => Promise<{ found: VaultFoundRepo[]; scanned: number }>;
  importLocalRepos: (found: VaultFoundRepo[]) => Promise<{ added: number; updated: number }>;
}

export interface VaultCompactStatus {
  ran: boolean;
  reason: "dry" | "off" | "cooldown" | "below-threshold" | "compacted" | string;
  why?: "absolute" | "proportional" | "schedule";
  freed: number;
  /** Size of the vault file on disk. */
  fileBytes: number;
  /** Dead space inside it — freed pages SQLite has not returned to Windows. */
  reclaimable: number;
  /** reclaimable / fileBytes. */
  ratio: number;
  absoluteBar: number;
  ratioBar: number;
  hitsAbsolute: boolean;
  hitsRatio: boolean;
  hitsSchedule: boolean;
  every: string;
  lastCompactedMs: number | null;
}

export interface VaultNoteFolder {
  id: number;
  uuid: string;
  name: string;
  parent_id: number | null;
  sort_order: number;
}

export interface VaultFoundRepo {
  name: string;
  localPath: string;
  /** Read from .git/config. Empty when the clone has no remote — not when we failed to look. */
  remoteUrl: string;
  branch: string;
}

export interface VaultParsedServer {
  host: string;
  address: string;
  provider: string;
  role: string;
  notes: string;
}

export interface VaultWalkedFile {
  path: string;
  name: string;
  rel: string;
  ext: string;
  size: number;
  /** The file's own dates — carried onto the note so an imported archive keeps its chronology. */
  mtimeMs: number;
  birthtimeMs: number;
}

export interface VaultWalkResult {
  files: VaultWalkedFile[];
  skipped: number;
  skippedDirs: string[];
  truncated: boolean;
}

/** Four levels, mirroring LOG_LEVELS in electron/core/services/vault/log.ts. */
export type VaultLogLevel = "debug" | "info" | "warn" | "error";

export interface VaultLogRow {
  uuid: string;
  ts: string;
  level: VaultLogLevel;
  area: string;
  channel: string | null;
  /** The reference the user was shown. This column is why the log is worth having. */
  request_id: string | null;
  actor: string | null;
  message: string;
  detail: string | null;
}

export interface VaultNoteMeta {
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

export interface VaultNote extends Omit<VaultNoteMeta, "excerpt"> {
  body: string;
}

export interface VaultServer {
  id: number;
  uuid: string;
  host: string;
  address: string | null;
  provider: string | null;
  role: string | null;
  ssh_secret_uuid: string | null;
  runbook_uuid: string | null;
  notes: string | null;
}

export interface VaultDnsRecord {
  id: number;
  uuid: string;
  domain: string;
  name: string;
  rtype: string;
  content: string;
  proxied: number | null;
  ttl: string | null;
  comment: string | null;
}

export interface VaultZoneRecord {
  name: string;
  rtype: string;
  content: string;
  ttl: string | null;
  proxied: number | null;
  comment: string | null;
}

export interface VaultRepo {
  id: number;
  uuid: string;
  name: string;
  description: string | null;
  visibility: string | null;
  language: string | null;
  license: string | null;
  stars: string | null;
  version: string | null;
  local_path: string | null;
  remote_url: string | null;
  deploy_secret_uuid: string | null;
  readme_md: string | null;
  updated_at: string | null;
}

export interface VaultPackageRow {
  name: string;
  version: string;
  license: string;
  sizeMb: number;
  verdict: "approved" | "banned" | "needs_ruling";
  why: string;
}

/** A file the vault found that looks like this source's export. `strong` = matched the chosen
    vendor; otherwise it just looks password-shaped and is offered with less confidence. */
export interface VaultExportCandidate {
  name: string;
  path: string;
  dir: "downloads" | "desktop" | "documents";
  mtimeMs: number;
  size: number;
  strong: boolean;
}

/** Column index per field; -1 means "this file has no such column". */
export interface VaultImportMapping {
  label: number;
  value: number;
  username: number;
  url: number;
  notes: number;
}

export interface VaultImportPreview {
  headers: string[];
  sample: string[][];
  total: number;
  guess: VaultImportMapping;
}

export interface VaultImportResult {
  created: number;
  skipped: number;
  problems: { row: number; reason: string }[];
}

/** The lane's local view of the bridge. On copy-back this member joins the shared `Api` interface
    and this declaration is deleted — it exists so the module compiles standing alone. */
declare global {
  interface Window {
    api: { vault: VaultApi } & Record<string, unknown>;
  }
}

export const vaultApi = (): VaultApi => window.api.vault;
