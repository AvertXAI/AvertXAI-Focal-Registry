// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Scout Viewer per-client tab state — plain SQLite (scout_tab_state in the shared org
//              DB), one row per client session, indexed SELECT by client_id. Restores where each
//              isolated session was (URL + scroll) across client switches and app restarts.
//              FTS5 is deliberately NOT used here — it stays reserved for MindMerge note content (canon).
//              Table is ensured lazily from THIS lane (additive; db/index.ts untouched).
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/scout-viewer/tab-state.ts
//------------------------------------------------------------
import { createTable, getDb } from "../db";
import { generateUUIDv7 } from "../utils/uuidv7";

export interface ScoutTabState {
  url: string | null;
  scroll_x: number;
  scroll_y: number;
}

// UNIQUE(client_id) is the upsert conflict target — one state row per client session.
let ready = false;
function ensureTable(): void {
  if (ready) return;
  const db = getDb();
  createTable(db, "scout_tab_state", [
    "client_id TEXT NOT NULL",
    "url TEXT",
    "scroll_x INTEGER DEFAULT 0",
    "scroll_y INTEGER DEFAULT 0",
  ]);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS scout_tab_state_client ON scout_tab_state(client_id);");
  ready = true;
}

const clampInt = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;

// Full save — switch-away / module-hide / quit funnel here (clientId is engine-internal, never IPC).
export function saveTabState(clientId: string, url: string, scrollX: unknown, scrollY: unknown): void {
  ensureTable();
  getDb()
    .prepare(
      `INSERT INTO scout_tab_state (uuid, client_id, url, scroll_x, scroll_y) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(client_id) DO UPDATE SET
         url = excluded.url, scroll_x = excluded.scroll_x, scroll_y = excluded.scroll_y,
         updated_at = CURRENT_TIMESTAMP`
    )
    .run(generateUUIDv7(), clientId, url, clampInt(scrollX), clampInt(scrollY));
}

// URL-only sync — fires on every guest did-navigate, so the row stays quit-safe without an async
// scroll read; the stored scroll survives until the next full save.
export function saveTabUrl(clientId: string, url: string): void {
  ensureTable();
  getDb()
    .prepare(
      `INSERT INTO scout_tab_state (uuid, client_id, url) VALUES (?, ?, ?)
       ON CONFLICT(client_id) DO UPDATE SET url = excluded.url, updated_at = CURRENT_TIMESTAMP`
    )
    .run(generateUUIDv7(), clientId, url);
}

// Indexed point read — no row (first visit) is a normal miss, never an error.
export function getTabState(clientId: string): ScoutTabState | undefined {
  ensureTable();
  return getDb()
    .prepare("SELECT url, scroll_x, scroll_y FROM scout_tab_state WHERE client_id = ?")
    .get(clientId) as ScoutTabState | undefined;
}
