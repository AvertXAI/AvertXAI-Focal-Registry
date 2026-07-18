// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI RunBooks.Systems — CRM platform shell (skeleton)
// Description: Shared TypeScript types used by the services, electron, and renderer layers.
//              Trimmed to the spine: the Data Viewer surface + the dev-gated diag channel.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: CRM_v2/src/shared/types.ts
//------------------------------------------------------------

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

// ---- Runbooks module (standard columns included) ----
export interface Runbook {
  id: number;
  uuid: string;
  title: string;
  description: string | null;
  created_at: string;
  updated_at: string | null;
}
export interface RunbookStep {
  id: number;
  uuid: string;
  runbook_id: number;
  step_order: number;
  prompt_template: string | null;
  created_at: string;
  updated_at: string | null;
}

// ---- Runbook Shredder module (renderer-safe copies of the service shapes at
// electron/core/services/runbook-shredder/api.ts — the renderer imports from HERE, never from services/) ----
export interface RunbookRow {
  id: number;
  uuid: string;
  runbook_id: string | null;
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
export type RunbookFilter = Partial<
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

// ---- Canon Distributor engine (dist_source / dist_targets / dist_log) ----
export interface DistTarget {
  uuid: string;
  label: string;
  path: string;
  is_enabled: number;
  template_id: number | null; // Guardrails manifest: chosen canon_templates row
  selected_agent_ids: string | null; // Guardrails manifest: JSON int array of canon_agents ids
}
export interface TargetSyncStatus {
  uuid: string;
  status: "synced" | "error";
  detail?: string;
}
export interface SyncResult {
  ok: number; // targets synced
  errors: number; // targets (or the source) that failed — see dist_log ERROR rows
  at: string; // ISO timestamp
  targets: TargetSyncStatus[]; // per-target outcome for this run
}
export interface DistLogRow {
  id: number; // pagination cursor (pass as `before` for the next page)
  uuid: string;
  action: string; // COPY | REPLACE | ERROR | NUKE
  detail: string;
  created_at: string;
}
/** Main → renderer push channels the preload bridge whitelists. */
export type PushChannel = "dist:synced";

// ---- Canon Distributor templates (canon_templates — DB-only, never writes a file) ----
export interface CanonTemplate {
  id: number;
  uuid: string;
  title: string;
  writes_as: string; // fixed "CLAUDE.md" (readonly in the UI); metadata for a later bite
  destination: string | null;
  body_md: string;
  version: string; // "v0.1.0"; "Save & Bump" increments the patch renderer-side
  sections_json: string | null; // ordered TemplateSection[] (structural form); body_md = assembled
  created_at: string;
  updated_at: string | null;
}
/** Editable fields sent to create/update (writes_as is immutable, set service-side). */
export interface CanonTemplatePayload {
  title: string;
  destination: string;
  body_md: string;
  version: string;
  sections_json: string;
}
/** One ordered section of the CLAUDE.md builder (persisted as JSON in sections_json). */
export interface TemplateSection {
  heading: string;
  level: 1 | 2 | 3; // 1 = the intro title line; toggleable 2/3 for the rest
  body: string;
  fixed: boolean; // standard sections keep their heading; custom ones are editable/removable
  guidance: string; // placeholder text shown when body is empty
}
/** Guarded disk-write outcome — "exists" means confirm-then-retry with overwrite=true. */
export interface TemplateWriteResult {
  status: "written" | "exists" | "no-destination";
  path?: string;
}

// ---- Canon Distributor agents (canon_agents — imported agent .md files, DB-only) ----
export interface CanonAgent {
  id: number;
  uuid: string;
  name: string;
  category: string | null;
  body_md?: string; // present on get(); omitted from list() (300+ full docs would bloat the wire)
  source: string | null; // repo root folder name
  license: string | null;
  is_favorite: number; // 0/1 — favorited agents also appear in the ★ favorites group
  created_at: string;
  updated_at: string | null;
}
export interface AgentImportResult {
  imported: number;
  updated: number;
  categories: number;
}

/** The IPC surface the preload bridge exposes to the renderer as window.api. */
export interface Api {
  /** Read-only SQLite browser (Data Viewer module) — introspection only, never writes. */
  db: {
    tables: () => Promise<DbTable[]>;
    columns: (table: string) => Promise<DbColumn[]>;
    rows: (table: string, limit: number, offset: number) => Promise<DbRowsPage>;
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
  /** Runbooks module — list + create. */
  runbooks: {
    list: () => Promise<Runbook[]>;
    create: (title: string, description?: string) => Promise<Runbook>;
  };
  /** Runbook Shredder module — read-only queries + watch-folder plumbing. */
  shredder: {
    list: (filter?: RunbookFilter) => Promise<RunbookRow[]>;
    get: (id: string) => Promise<RunbookRow | undefined>;
    search: (q: string) => Promise<RunbookRow[]>;
    listQuarantined: () => Promise<RunbookRow[]>;
    /** Native folder dialog → chosen dir, or null on cancel. */
    pickWatchFolder: () => Promise<string | null>;
    /** Re-ingest the current watch folder now → live ok/error counts. */
    rescan: () => Promise<{ ingested: number; quarantined: number }>;
  };
  /** Canon Distributor engine — source/target CRUD + sync + watcher (service validates paths/labels). */
  dist: {
    getSource: () => Promise<{ path: string } | null>;
    setSource: (path: string) => Promise<void>;
    listTargets: () => Promise<DistTarget[]>;
    addTarget: (label: string, path: string) => Promise<void>;
    setTargetEnabled: (uuid: string, on: boolean) => Promise<void>;
    removeTarget: (uuid: string) => Promise<void>;
    /** Guardrails manifest — selection only; the disk stamp is a later bite. */
    setManifest: (uuid: string, templateId: number | null, agentIds: number[]) => Promise<void>;
    syncNow: () => Promise<SyncResult>;
    getWatcher: () => Promise<boolean>;
    setWatcher: (on: boolean) => Promise<boolean>;
    listLog: (limit?: number, before?: number) => Promise<DistLogRow[]>;
    countLog: () => Promise<number>;
    nukeLog: () => Promise<void>;
    /** History view: all log rows newest-first (renderer groups into per-project blocks). */
    history: () => Promise<DistLogRow[]>;
    /** Per-project log purge (rows only, never files) — sanctioned nuke, recorded after. */
    nukeHistory: (project: string) => Promise<void>;
    /** Native directory picker — resolves the chosen absolute path, or null if cancelled. */
    pickFolder: () => Promise<string | null>;
  };
  /** Canon Distributor templates — DB-only CRUD (service validates; writes_as immutable). */
  templates: {
    list: () => Promise<CanonTemplate[]>;
    get: (id: number) => Promise<CanonTemplate | null>;
    create: (payload: CanonTemplatePayload) => Promise<CanonTemplate>;
    update: (id: number, payload: CanonTemplatePayload) => Promise<CanonTemplate>;
    remove: (id: number) => Promise<void>;
    /** Guarded write of the assembled body_md to {destination}/{writes_as} — never overwrites
        without overwrite=true (UI confirms on "exists"). */
    writeToDisk: (id: number, overwrite?: boolean) => Promise<TemplateWriteResult>;
  };
  /** Canon Distributor agents — import local agent repos into the DB + browse (repos read-only). */
  agents: {
    list: () => Promise<CanonAgent[]>;
    get: (id: number) => Promise<CanonAgent | null>;
    remove: (id: number) => Promise<void>;
    /** Edit-in-place of body_md only (identity fields stay tied to the imported file). */
    update: (id: number, body: string) => Promise<void>;
    setFavorite: (id: number, on: boolean) => Promise<void>;
    importFromFolders: (paths: string[]) => Promise<AgentImportResult>;
  };
  /** Main → renderer push events — whitelisted channels only (dist:synced). */
  on: (channel: PushChannel, cb: (payload: SyncResult) => void) => void;
  off: (channel: PushChannel, cb: (payload: SyncResult) => void) => void;
  /** DIAG-1 dev-gated diagnostics channel (meaningful only when env DIAG=1). */
  diag?: {
    enabled: () => Promise<boolean>;
    perModule: (perModule: Record<string, { renders: number; stateSets: number; subs: number }>) => void;
  };
}
