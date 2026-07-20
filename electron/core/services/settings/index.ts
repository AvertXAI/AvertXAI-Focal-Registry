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
  "rail_collapsed", // Mission Control sidebar collapse — persisted via app_settings, never localStorage
  "flyout_width", // shell sidebar drag-resize width (px, clamped renderer-side)
  "last_active_module", // boot-to-last-screen routing
  "nav_section_state", // sidebar grouped-section expand/collapse (JSON map) — never localStorage
  "theme_mode", // 3-state theme toggle (system/light/dark) — persisted, never localStorage
  "org_name", // active org display name — read-only in the renderer (TopBar brand); written by first-run/setup
  "markdown_root", // user-chosen ROOT for the app-managed Markdown tree (<root>\MissionControl\…); app owns everything below it
  // Runbook Shredder namespaced settings — the module persists these through this sanctioned path,
  // never a direct app_settings write ("Expose, Don't Connect"). auto_reparse stays main-only.
  "runbook-shredder.watch_path",
  "runbook-shredder.watch_enabled",
  "runbook-shredder.rail_collapsed", // module list-rail « collapse — UI-only, never restarts the engine
  "runbook-shredder.font_size", // detail-pane px size — UI-only, never restarts the engine
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
