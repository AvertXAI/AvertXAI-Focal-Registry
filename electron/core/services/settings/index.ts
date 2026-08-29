// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Renderer-facing app_settings access. Key-whitelisted BY CONSTRUCTION — a generic
//              k/v channel must never let the renderer overwrite platform identity rows
//              (org_id / org_name); add keys to RENDERER_KEYS as real settings appear.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/settings/index.ts
//------------------------------------------------------------
import { getDb } from "../db";

const RENDERER_KEYS = new Set([
  "skip_fast_boot",
  "tray_enabled", // system-tray hide-on-close — user setting, DEFAULT ON (§3.11); "0" = ✕ quits outright
  "launch_at_startup", // open at Windows login — DEFAULT OFF; "1" writes the OS login item (app.setLoginItemSettings)
  "rail_collapsed", // Mission Control sidebar collapse — persisted via app_settings, never localStorage
  "flyout_width", // shell sidebar drag-resize width (px, clamped renderer-side)
  "dv_rail_width", // Data Viewer table-list drag-resize width (px, clamped renderer-side)
  "last_active_module", // boot-to-last-screen routing
  "nav_section_state", // sidebar grouped-section expand/collapse (JSON map) — never localStorage
  "theme_mode", // 3-state theme toggle (system/light/dark) — persisted, never localStorage
  "settings_active_section", // Settings view's open section — survives navigation + restart (post-6A FIX 1)
  "update.skipped_version", // Software Update window "Skip this version" — written main-side (update-window.ts)
  "org_name", // active org display name — read-only in the renderer (TopBar brand); written by first-run/setup
  "markdown_root", // user-chosen ROOT for the app-managed Markdown tree (<root>\MissionControl\…); app owns everything below it
  // MindMerge namespaced settings — the module persists these through this sanctioned path,
  // never a direct app_settings write ("Expose, Don't Connect"). auto_reparse stays main-only.
  "mindmerge.watch_path",
  "mindmerge.watch_roots", // BL-58 stacked imports — JSON array of absolute folder paths
  "mindmerge.watch_enabled",
  "mindmerge.rail_collapsed", // module list-rail « collapse — UI-only, never restarts the engine
  "mindmerge.font_size", // detail-pane px size — UI-only, never restarts the engine
  // MindMerge AUTHORED-DOCUMENTS view (Phase 3, 08-21-2026). The ported NotesView still says
  // "notes.style" / "notes.list_collapsed" / "notes.editor_mode" internally; MindMergeModule renames
  // them into this namespace at the seam, so ONLY these keys ever reach app_settings. UI-only —
  // none of them restart the ingest engine.
  "mindmerge.docs_style", // Notes · Runbooks · Ideas list style
  "mindmerge.docs_list_collapsed", // document-list rail collapse ("1"/"0")
  "mindmerge.docs_editor_mode", // editor | raw | split | preview
  "mindmerge.docs_tab", // which of the two view tabs is open (documents | brain)
  // Phase 4 (08-22-2026) — the Documents folder rail's view state, same seam, same rename rule.
  "mindmerge.docs_folder_selected", // selected folder ("-1" Unfiled — the default, "0" every document, else a folder id)
  "mindmerge.docs_folders_open", // which rail folders are expanded (JSON array of folder ids)
  "migrate.tabs", // Migrate scan tabs (JSON) — renderer tab state persisted so tabs survive navigation
  // Scan Notes view state — sticky across navigation, per §3.8 (never localStorage). The local notes
  // tree itself has NO key: it is a fixed Documents path like documentsExportsDir(), not the
  // relocatable markdown_root tree.
  "scan.notes_tab", // which of the five tabs is open
  "scan.notes_show_empty_folders", // tree toggle — "1" reveals folders whose whole subtree has no media
  "scan.notes_show_raw", // media wall — "1" shows camera RAW alongside the JPEGs; default off
  "tips.enabled", // helpful-tips master switch — ONE global toggle (Jason ruled: no per-tip settings), default on
  // TimeTracker UI-only pref (Phase 6A, the ONE sanctioned out-of-module addition) — the module
  // rail's « collapse, persisted like mindmerge.rail_collapsed. Licence/break keys stay OFF this
  // list: they write through validated timetracker:* channels only.
  "timetracker.rail_collapsed",
  "employees.rail_collapsed", // people-rail « collapse — same UI-only pref, same sanctioned path
  // Scout Viewer's experimental-use acknowledgement. "1" once the user has ticked and continued.
  "scoutviewer.experimental_ack",
  "timetracker.notes_sort", // Notes pad block order ("newest" | "oldest") — a sticky view preference
  // BUSINESS PROFILE (08-06, ruled with the invoice build) — the bill-from block, payment terms and
  // the default tax rate every invoice reads. Config-as-Data rows, written from Settings through
  // this sanctioned path. tax_rate is a percent as free text ("8.25"); the invoice parses it.
  "business.name",
  "business.address",
  "business.phone",
  "business.email",
  "business.website",
  "business.payment_methods",
  "business.terms",
  "business.tax_rate",
  "business.logo_path",
  // MY PROFILE (08-19-2026) — the person using this install, as distinct from the business they
  // invoice as. Added when the two setup wizards merged into one: the vault wizard used to collect
  // these on a details step, which the merge deleted, so they need a home that is editable later.
  "profile.full_name",
  "profile.email",
  "profile.phone",
  "profile.website",
]);

function safeKey(key: unknown): string {
  if (typeof key !== "string" || !RENDERER_KEYS.has(key)) throw new Error("Unknown setting key");
  return key;
}

export function getSetting(key: unknown): string | null {
  const row = getDb().prepare("SELECT value FROM app_settings WHERE key = ?").get(safeKey(key)) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: unknown, value: unknown): void {
  if (typeof value !== "string") throw new Error("Setting value must be a string");
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(safeKey(key), value);
}
