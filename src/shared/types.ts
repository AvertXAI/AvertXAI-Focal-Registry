// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
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

/** Main → renderer push channels the preload bridge whitelists. Currently the updater's three;
    a module needing main-to-renderer progress (e.g. Scan) adds its channel here + in preload. */
export type PushChannel = "updater:available" | "updater:progress" | "updater:downloaded";

// ---- Auto-updater pushes (electron-updater, §3.12) ----
export interface UpdateAvailableInfo {
  version: string;
  notes: string; // release notes when the feed provides them as a plain string, else ""
}
export interface UpdateProgressInfo {
  percent: number; // 0–100, rounded
}
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
  /** Auto-updater (§3.12) — user-consented download, install on quit. Auto cycle is packaged-only;
   *  check/version answer in every build so the Settings button is never dead. */
  updater: {
    download: () => Promise<void>;
    install: () => Promise<void>;
    check: () => Promise<UpdateCheckOutcome>;
    version: () => Promise<string>;
  };
  /** Main → renderer push events — whitelisted channels only (PushChannel). Payload follows the
   *  channel: updater:available → UpdateAvailableInfo, updater:progress → UpdateProgressInfo,
   *  updater:downloaded → empty object. */
  on: <T>(channel: PushChannel, cb: (payload: T) => void) => void;
  off: <T>(channel: PushChannel, cb: (payload: T) => void) => void;
  /** DIAG-1 dev-gated diagnostics channel (meaningful only when env DIAG=1). */
  diag?: {
    enabled: () => Promise<boolean>;
    perModule: (perModule: Record<string, { renders: number; stateSets: number; subs: number }>) => void;
  };
}
