// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Shared TypeScript types used by the services, electron, and renderer layers.
//              Trimmed to the spine: the Data Viewer surface + the dev-gated diag channel.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: CRM_v2/src/shared/types.ts
//------------------------------------------------------------
import type { RenameSettings, RenameSourceFile } from "./renamePreview";

// ---- Data Viewer (read-only SQLite browser) ----
export interface DbTable {
  name: string;
  rows: number;
}
export interface DbColumn {
  name: string;
  type: string;
  pk: boolean;
  notnull: boolean;
}
export interface DbRowsPage {
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
}
export interface DbForeignKey {
  table: string;
  from: string;
  to: string;
}

// ---- Config-as-Data module registry (the `modules` table, standard columns included) ----
export interface ModuleRow {
  id: number;
  uuid: string;
  tenant_id: string;
  name: string;
  slug: string;
  type: string;
  display_order: number;
  is_locked: number;
  is_enabled: number;
  /** Sidebar section label (additive nav_group column). Nullable: a row seeded this same boot may
      be transiently NULL until the next boot's backfill — the renderer defaults it to "Applications". */
  nav_group: string | null;
  created_at: string;
  updated_at: string | null;
}

// ---- MindMerge module (renderer-safe copies of the service shapes at
// electron/core/services/mindmerge/api.ts — the renderer imports from HERE, never from services/) ----
export interface NoteRow {
  id: number;
  uuid: string;
  note_id: string | null;
  title: string | null;
  type: string | null;
  status: string | null;
  severity: string | null;
  owner: string | null;
  client: string | null;
  description: string | null;
  service: string | null;
  trigger: string | null;
  version: string | null;
  updated: string | null;
  body_md: string | null;
  tags_flat: string | null;
  file_path: string;
  parse_status: "ok" | "error";
  parse_error: string | null;
  created_at: string;
  updated_at: string | null;
}
/** Equality filters the service accepts; keys outside this set are ignored main-side. */
export type NoteFilter = Partial<
  Record<"status" | "type" | "severity" | "parse_status" | "client" | "owner" | "service", string>
>;

// ---- Scout Viewer (Fortified Browser) — renderer-safe shapes for the engine bridge ----
export interface ScoutBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** A user-editable browse target (scout_targets row). client_id keys the persist:client_<id>
    session partition — minted at create, immutable after. */
export interface ScoutTargetRow {
  id: number;
  uuid: string;
  name: string;
  url: string;
  client_id: string;
  display_order: number;
  created_at: string;
  updated_at: string | null;
}

/** The isolated-world DOM-read result — bounded, plain-serializable, UNTRUSTED page strings. */
export interface ScoutDomCard {
  url: string;
  title: string;
  headings: string[];
  nav: string[];
  tableCols: string[];
  actions: string[];
  counts: { links: number; forms: number; tables: number; iframes: number };
}

/** Main → renderer push channels the preload bridge whitelists. */
export type PushChannel = "scan:progress" | "scan:drives" | "mindmerge:progress" | "rename:progress" | "migrate:progress";

/** LOCAL-ONLY device identity — shown read-only in Settings; never transmitted, never in exports. */
export interface DeviceIdentityInfo {
  machine_guid: string | null;
  hardware_uuid: string | null;
  machine_name: string | null;
  created_at: string | null; // provenance-row timestamp; null when served by a live probe
}

// ---- Migrate module (renderer-safe copies of the service shapes at electron/core/services/migrate) ----
export interface MigrateExtDef { ext: string; label: string; group: string }
export interface MigrateClassDef {
  key: string; label: string; icon: string; desc: string;
  extensions: MigrateExtDef[]; folderNames: string[]; destHint: string;
}
export interface MigrateDrive {
  letter: string; label: string; filesystem: string; totalBytes: number; freeBytes: number;
  serial: string; driveType: number; removable: boolean;
}
export interface MigrateCreateJob {
  label: string; targetKind: "drive" | "folders"; driveId: number | null; rootPaths: string[];
  classes: string[]; extensions: string[]; optFolderNames: boolean; optSubfolders: boolean; optHidden: boolean;
}
export interface MigrateJobRow {
  id: number; label: string | null; target_kind: string; drive_id: number | null; root_paths: string;
  classes: string; extensions: string; status: string; folders_walked: number; files_seen: number;
  files_found: number; errors_logged: number; total_folders_expected: number | null;
  started_at: string | null; finished_at: string | null;
}
export interface MigrateItemRow {
  id: number; job_id: number; asset_class: string; extension: string | null; source_path: string;
  filename: string; size_bytes: number | null; mtime: string | null; selected: number; is_shipped_default: number;
}
export interface MigrateGroupSummary { extension: string | null; count: number; bytes: number; selected: number }
export interface MigrateJobSummary {
  groups: MigrateGroupSummary[]; total: number; bytes: number; selected: number; selectedBytes: number;
}
export interface MigrateBundleRow {
  id: number; job_id: number; destination_root: string; status: string; item_count: number;
  bytes_total: number; items_copied: number; items_failed: number; started_at: string | null; finished_at: string | null;
}
export interface MigratePreflight {
  ok: boolean; neededBytes: number; freeBytes: number | null; bundleDir: string; error?: string;
}
/** migrate:progress push — discovery counters and bundle-copy counters share one channel, split by kind. */
export interface MigrateProgress {
  kind: "discover" | "bundle";
  jobId: number; bundleId?: number; status: string; currentPath: string | null;
  foldersWalked: number; foldersTotal: number | null; filesFound: number;
  copied?: number; failed?: number; totalItems?: number; bytesDone?: number; bytesTotal?: number;
  error?: string;
}

// ---- Rename module (renderer-safe copies of the service shapes) ----
export interface RenameProgress {
  batchId: number;
  status: string; // 'running' | 'completed' | 'aborted' | 'crashed' | 'error'
  currentFile: string | null;
  total: number;
  copied: number;
  skipped: number;
  errored: number;
  error?: string;
}
export interface RenameBatchRow {
  id: number;
  kind: string; // 'rename' | 'revert'
  reverted_from_batch_id: number | null;
  client_name: string | null;
  project_name: string | null;
  shoot_date: string | null;
  custom_tag: string | null;
  prefix_mode: string;
  business_name: string | null;
  photographer_name: string | null;
  sequence_start: number;
  sequence_pad: number;
  destination_path: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  image_count: number;
  video_count: number;
  audio_count: number;
  files_copied: number;
  files_skipped: number;
  files_errored: number;
  created_at: string;
}
export interface RenameRevertRow {
  copy_filename: string;
  source_filename: string;
  source_path: string;
  bytes: number;
}
export interface RenamePresetRow {
  id: number;
  name: string;
  is_last_used: number;
  prefix_mode: string | null;
  business_name: string | null;
  photographer_name: string | null;
  sequence_start: number | null;
  sequence_pad: number | null;
  client_name: string | null;
  project_name: string | null;
  custom_tag: string | null;
}
export interface RenameBatchSample {
  source_filename: string;
  copy_filename: string | null;
  status: string;
}
/** mindmerge:progress push — folder ingest ticker (done/total) so a large MindMerge folder reads as loading. */
export interface MindMergeProgress {
  done: number;
  total: number;
}

// ---- Scan module (renderer-safe copies of the service shapes at electron/core/services/scan/ —
// the renderer imports from HERE, never from services/) ----
export interface ScanVolume {
  letter: string; // "D:"
  label: string;
  filesystem: string;
  totalBytes: number;
  freeBytes: number;
  serial: string; // hex volume serial — the drive's identity, never the letter
}
export interface ScanDriveRow {
  id: number;
  uuid: string;
  org_id: string;
  volume_serial: string;
  volume_label: string | null;
  filesystem: string | null;
  total_bytes: number | null;
  free_bytes: number | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  last_scanned_at: string | null;
}
/** A drive with at least one completed scan — shown in the drive list even when UNPLUGGED, as
    "not connected", still opening its (locally-copied) report. Serial is identity; no letter. */
export interface ScannedDrive {
  serial: string;
  label: string | null;
  total_bytes: number | null;
  last_run_id: number | null;
  last_finished_at: string | null;
}
export interface ScanRunRow {
  id: number;
  uuid: string;
  org_id: string;
  drive_id: number | null;
  root_path: string;
  status: "counting" | "probing" | "estimating" | "running" | "paused" | "completed" | "aborted" | "crashed" | string;
  scan_unit: "drive" | "folder" | string;
  started_at: string | null;
  finished_at: string | null;
  probe_folders_sampled: number | null;
  probe_files_found: number | null;
  /** Legacy extrapolation field (unused since Phase 4); mirrors total_files_expected on new runs. */
  estimated_files: number | null;
  estimated_seconds: number | null;
  folders_committed: number;
  files_recorded: number;
  errors_logged: number;
  resume_cursor: string | null;
  report_path: string | null; // the copy on the scanned drive
  report_local_path?: string | null; // the copy in the app-managed Markdown tree (Phase 3 double-save)
  /** EXACT media-file denominator from the counting walk (Phase 4) — real %, no clamp. */
  total_files_expected: number | null;
  total_folders_expected: number | null;
  /** Joined from scan_drives on listRuns — the run's volume serial, for the per-drive scanned dot. */
  volume_serial?: string | null;
  /** Soft-clear timestamp (History Nuke); null/absent = visible. Purged 30 days after being set. */
  cleared_at?: string | null;
}
/** Double-scan guard answer — data only; the UI presents the choice, the service never decides. */
export interface ScanSourceDecision {
  decision: "proceed" | "offer-resume" | "already-scanned";
  drive: ScanDriveRow;
  rootPath: string;
  scanUnit: "drive" | "folder";
  crashedRun?: ScanRunRow;
  completedRun?: ScanRunRow;
}
/** scan:progress push payload — folder-level, never per-file, throttled main-side. */
export interface ScanProgress {
  runId: number;
  /** Volume serial of the drive this run belongs to — so the UI shows a run only on ITS drive. */
  volumeSerial: string | null;
  status: string;
  currentFolder: string | null;
  foldersCommitted: number;
  filesRecorded: number;
  errorsLogged: number;
  estimatedFiles: number | null;
  note?: string; // e.g. "source-missing" when a drive vanished mid-run
  lastFolderFiles?: number; // most-recent committed folder's media count (console per-folder line)
  lastFolderBytes?: number;
  reportPath?: string | null; // terminal only — the written report, or null on write failure
  reportError?: string | null; // terminal only — surfaced when the report write failed
}
export interface ScanErrorRow {
  path: string | null;
  extension: string | null;
  stage: string | null;
  error_text: string | null;
  occurred_at: string | null;
}
/** Logged-Issues payload — the true total plus a bounded page of rows (the modal never renders more). */
export interface ScanErrorList {
  total: number;
  rows: ScanErrorRow[];
}
/** The two storage locations shown in Settings — the app-managed Markdown tree and the Documents exports. */
export interface StorageLocations {
  markdownRoot: string;
  focalRegistry: string;
  scanMarkdown: string;
  documentsExports: string;
  reachable: boolean; // false when the configured root could not be created/reached (nothing written elsewhere)
}
export interface ScanFolderSummary {
  id: number;
  path: string;
  depth: number;
  file_count: number;
  image_count: number;
  video_count: number;
  audio_count: number;
  total_bytes: number;
  date_min: string | null;
  date_max: string | null;
  top_camera: string | null;
  /** 'capture' = dates are predominantly EXIF; 'file' = predominantly file mtime; null = no dated media. */
  date_source?: "capture" | "file" | null;
}
export interface ScanCameraCount { camera: string; count: number }
/** Report writer outcome — never throws; a failure is data, and the scan stays completed. */
export interface ScanReportResult {
  ok: boolean;
  path?: string;
  secureNoteCopy?: string | null;
  error?: string;
}

// ---- Auto-updater (§3.12) — available/progress/downloaded now live on the Software Update
// window's own updwin:* surface (electron/core/update-window.ts), not on window.api. ----
/** Outcome of a manual "Check for updates" — never rejects; failure is a status, not an exception. */
export interface UpdateCheckOutcome {
  status: "available" | "none" | "error";
  version?: string; // the available version, or the current one when status is "none"
}

/** The IPC surface the preload bridge exposes to the renderer as window.api. */
export interface Api {
  /** Read-only SQLite browser (Data Viewer module) — introspection only, never writes. */
  db: {
    tables: () => Promise<DbTable[]>;
    columns: (table: string) => Promise<DbColumn[]>;
    rows: (table: string, limit: number, offset: number, sortColumn?: string, sortDir?: "ASC" | "DESC") => Promise<DbRowsPage>;
    fks: (table: string) => Promise<DbForeignKey[]>;
  };
  /** Data Viewer persisted View(false)/Developer(true) mode — app_settings 'dataviewer_dev_mode'. */
  dataviewer: {
    getDevMode: () => Promise<boolean>;
    setDevMode: (on: boolean) => Promise<void>;
  };
  /** First-Run Setup Wizard — true once an active org exists in the platform registry. */
  getFirstRunStatus: () => Promise<boolean>;
  completeFirstRun: (orgName: string) => Promise<void>;
  /** Config-as-Data module registry rows (ordered by display_order) — drive nav + routing. */
  getModules: () => Promise<ModuleRow[]>;
  /** Key-whitelisted app_settings access (currently: 'skip_fast_boot'). */
  settings: {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string) => Promise<void>;
  };
  /** Native min/max/close overlay tint — boot-navy at launch; App drives shell-mount + theme flips. */
  theme: {
    applyOverlay: (mode: string) => Promise<void>;
    /** Dim/restore the native min/□/✕ overlay while a modal is open (OS draws it above the DOM). */
    setModalDim: (on: boolean) => Promise<void>;
  };
  /** App-managed Markdown storage root + the Documents export folder (Settings transparency). */
  storage: {
    locations: () => Promise<StorageLocations>;
    pickRoot: () => Promise<string | null>;
    changeRoot: (newRoot: string) => Promise<{ ok: boolean; error?: string }>;
    openFolder: (target: string) => Promise<{ ok: boolean; error?: string }>;
  };
  /** Scout Viewer — Fortified Browser engine bridge. Subscriptions return an unsubscribe fn. */
  scout: {
    setVisible: (visible: boolean) => void;
    updateBounds: (bounds: ScoutBounds) => void;
    navigate: (url: string) => void;
    switchClientTab: (clientId: string, url: string) => void;
    goBack: () => void;
    goForward: () => void;
    reload: () => void;
    stop: () => void;
    setModalState: (open: boolean) => void;
    domRead: () => Promise<ScoutDomCard | null>;
    onSnapshot: (cb: (dataUrl: string) => void) => () => void;
    onTabReady: (cb: () => void) => () => void;
    /** Active-page sync: url + title in one payload (title may lag on SPAs; updates re-emit). */
    onUrlChanged: (cb: (info: { url: string; title: string }) => void) => () => void;
    onLoadingState: (cb: (loading: boolean) => void) => () => void;
    /** Browse-target CRUD (scout_targets). Create/update take name + URL only — client_id is
        service-minted and immutable. Invokes REJECT on validation failure; callers catch. */
    targets: {
      list: () => Promise<ScoutTargetRow[]>;
      create: (name: string, url: string) => Promise<ScoutTargetRow>;
      update: (id: number, name: string, url: string) => Promise<ScoutTargetRow>;
      remove: (id: number) => Promise<void>;
    };
  };
  /** MindMerge module — read-only queries + watch-folder plumbing. */
  mindmerge: {
    ensure: () => Promise<{ ingesting: boolean }>;
    list: (filter?: NoteFilter) => Promise<NoteRow[]>;
    get: (id: string) => Promise<NoteRow | undefined>;
    search: (q: string) => Promise<NoteRow[]>;
    listQuarantined: () => Promise<NoteRow[]>;
    /** Native folder dialog → chosen dir, or null on cancel. */
    pickWatchFolder: () => Promise<string | null>;
    /** Re-ingest the current watch folder now → live ok/error counts. */
    rescan: () => Promise<{ ingested: number; quarantined: number }>;
  };
  /** Scan module — READ-ONLY against sources. start/resume return immediately; progress arrives
   *  over the scan:progress push. The double-scan guard's decision is data; the UI owns the choice. */
  scan: {
    listDrives: () => Promise<ScanVolume[]>;
    listScannedDrives: () => Promise<ScannedDrive[]>;
    selectSource: (rootPath: string, scanUnit: "drive" | "folder") => Promise<ScanSourceDecision>;
    /** Creates the run and kicks off the EXACT counting walk (Phase 4). Returns the runId
     *  immediately; exact folder/media counts arrive over scan:progress ('counting' → 'estimating'). */
    probe: (rootPath: string, scanUnit: "drive" | "folder") => Promise<{ runId: number }>;
    start: (runId: number) => Promise<{ ok: true; runId: number }>;
    pause: (runId: number) => Promise<boolean>;
    resume: (runId: number) => Promise<{ ok: true; runId: number }>;
    abort: (runId: number) => Promise<boolean>;
    status: (runId: number) => Promise<{ run: ScanRunRow; engineActive: boolean }>;
    listRuns: () => Promise<ScanRunRow[]>;
    /** Last run for a volume serial (identity, not the drive letter) — the already-scanned path. */
    lastRunForVolume: (serial: string) => Promise<ScanRunRow | null>;
    /** Top-level folder rollups of a run for the populated dashboard. */
    folders: (runId: number) => Promise<ScanFolderSummary[]>;
    /** Manual (re)write of the report — used when the auto-write on completion failed. */
    writeReport: (runId: number) => Promise<ScanReportResult>;
    /** Reveal the report file / open the reports folder in the OS. */
    openReport: (runId: number) => Promise<{ ok: boolean; error?: string }>;
    openReportsFolder: (runId: number) => Promise<{ ok: boolean; error?: string }>;
    /** Read the report markdown for the in-app modal (MindMerge ingestion is the later path). */
    readReport: (runId: number) => Promise<{ ok: boolean; path?: string; content?: string; error?: string }>;
    /** scan_errors rows for the Logged-Issues modal. */
    listErrors: (runId: number) => Promise<ScanErrorList>;
    /** Reveal a scanned folder in the OS file manager. */
    openPath: (target: string) => Promise<{ ok: boolean; error?: string }>;
    /** Distinct cameras in one folder's media, most-used first — Top-camera click-through. */
    folderCameras: (folderId: number) => Promise<ScanCameraCount[]>;
    /** Print the Reading view to PDF beside the .md report (built-in printToPDF, no dependency). */
    exportReportPdf: (runId: number, html: string, css: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
    /** Stream every media-bearing folder row to a CSV beside the .md report. */
    exportReportCsv: (runId: number) => Promise<{ ok: boolean; path?: string; error?: string }>;
    /** Soft-clear ALL scan history (History Nuke) — hidden from viewers, kept 30 days, restorable. */
    clearHistory: () => Promise<{ cleared: number }>;
    /** Restore soft-cleared history — runs reappear ordered by date. */
    restoreHistory: () => Promise<{ restored: number }>;
    /** Permanently delete all soft-cleared history now (Settings, double-confirmed). */
    deleteHistoryForever: () => Promise<{ deleted: number }>;
    /** Count of soft-cleared runs — gates the Settings Restore / delete-forever controls. */
    clearedHistoryCount: () => Promise<number>;
  };
  /** Auto-updater (§3.12) — check/version answer in every build so the Settings button is never
   *  dead. Download/install belong to the Software Update window's own bridge, not window.api. */
  updater: {
    check: () => Promise<UpdateCheckOutcome>;
    version: () => Promise<string>;
  };
  tray: {
    /** Persist the tray-on-close setting and rewire the ✕ behaviour live (no restart). */
    setEnabled: (enabled: boolean) => Promise<{ ok: boolean }>;
  };
  startup: {
    /** Persist the open-at-login choice and write/clear the OS login item (Windows Run key). */
    setEnabled: (enabled: boolean) => Promise<{ ok: boolean }>;
  };
  /** Migrate module — discovery is read-only; bundle export writes only the chosen destination. */
  /** LOCAL device identity (Settings "This device") — read-only; never transmitted anywhere. */
  identity: {
    get: () => Promise<DeviceIdentityInfo>;
  };
  migrate: {
    registry: () => Promise<MigrateClassDef[]>;
    drives: () => Promise<MigrateDrive[]>;
    pickFolders: () => Promise<string[]>;
    createJob: (opts: MigrateCreateJob) => Promise<number>;
    listJobs: () => Promise<MigrateJobRow[]>;
    jobSummary: (jobId: number) => Promise<MigrateJobSummary>;
    jobItems: (jobId: number, extension: string | null) => Promise<MigrateItemRow[]>;
    setSelected: (payload: { jobId: number; ids?: number[]; extension?: string | null; selected: boolean }) => Promise<{ ok: boolean }>;
    abortJob: (jobId: number) => Promise<boolean>;
    bundlePreflight: (jobId: number, destRoot: string) => Promise<MigratePreflight>;
    startBundle: (jobId: number, destRoot: string) => Promise<{ ok: boolean }>;
    listBundles: (jobId: number) => Promise<MigrateBundleRow[]>;
    openFolder: (p: string) => Promise<{ ok: boolean; error?: string }>;
  };
  rename: {
    gather: (sources: string[]) => Promise<RenameSourceFile[]>;
    isDriveRoot: (p: string) => Promise<boolean>;
    listBatches: () => Promise<RenameBatchRow[]>;
    getBatch: (id: number) => Promise<RenameBatchRow | null>;
    batchSample: (id: number) => Promise<RenameBatchSample[]>;
    revertMapping: (id: number) => Promise<RenameRevertRow[]>;
    start: (payload: { sources: string[]; destination: string; settings: RenameSettings }) => Promise<{ ok: boolean; error?: string }>;
    abort: (id: number) => Promise<{ ok: boolean }>;
    startRevert: (payload: { batchId: number; copiesFolder: string; destination: string }) => Promise<{ ok: boolean; error?: string }>;
    listPresets: () => Promise<RenamePresetRow[]>;
    savePreset: (name: string, settings: RenameSettings) => Promise<{ ok: boolean }>;
    deletePreset: (id: number) => Promise<{ ok: boolean }>;
    pickFolder: (title?: string) => Promise<string | null>;
    openFolder: (p: string) => Promise<{ ok: boolean }>;
  };
  /** Main → renderer push events — whitelisted channels only (PushChannel). Payload follows the
   *  channel (progress tickers for scan / mindmerge / rename, live drive lists for scan). */
  on: <T>(channel: PushChannel, cb: (payload: T) => void) => void;
  off: <T>(channel: PushChannel, cb: (payload: T) => void) => void;
  /** DIAG-1 dev-gated diagnostics channel (meaningful only when env DIAG=1). */
  diag?: {
    enabled: () => Promise<boolean>;
    perModule: (perModule: Record<string, { renders: number; stateSets: number; subs: number }>) => void;
  };
}
