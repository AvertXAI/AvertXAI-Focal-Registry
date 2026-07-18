// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: RunBooks — AvertXAI platform shell (baseplate)
// Description: Distributor engine service — source/target CRUD, the copy-replace-log pipeline, and
//              the debounced folder watcher. Trust boundary: every renderer-supplied arg arrives
//              unknown and is validated here. SAFETY ENVELOPE: the engine writes ONLY inside
//              {target}/CANON/ — never any other path in a target. dist_log is APPEND-ONLY:
//              no UPDATE/DELETE path exists for it anywhere.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/canon-distributor/index.ts
//------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../db";
import { generateUUIDv7 } from "../utils/uuidv7";
// Not a SQLite concern: sync results are pushed to any open renderer (windows may all be closed
// while the tray keeps the app alive — broadcast() is a no-op then).
import { broadcast } from "../../windows";
import type { DistLogRow, DistTarget, SyncResult, TargetSyncStatus } from "../../../../src/shared/types";

// --- validation (trust boundary) ---

// Tenant scoping — matches the shell's shared-DB pattern (db/index.ts initDb): app_settings.org_id,
// falling back to an existing module row's tenant_id for dev DBs whose app_settings predate org_id.
// (runbook-shredder scopes differently — a separate per-org .db FILE — but dist_* live in the shared
// org DB, so the module-table tenant_id pattern is the correct match.)
function tenantId(): string {
  const db = getDb();
  const t =
    (db.prepare("SELECT value AS v FROM app_settings WHERE key = 'org_id'").get() as { v: string } | undefined)?.v ??
    (db.prepare("SELECT tenant_id AS v FROM modules LIMIT 1").get() as { v: string } | undefined)?.v;
  if (!t) throw new Error("Tenant DB not seeded — no org_id / module tenant found");
  return t;
}

function safeAbsPath(p: unknown): string {
  if (typeof p !== "string" || p.trim().length === 0 || !path.isAbsolute(p)) {
    throw new Error("Absolute path required");
  }
  return p;
}

function safeLabel(label: unknown): string {
  if (typeof label !== "string" || label.trim().length === 0) throw new Error("Label required");
  return label.trim();
}

function safeUuid(uuid: unknown): string {
  if (typeof uuid !== "string" || uuid.length === 0) throw new Error("uuid required");
  return uuid;
}

// --- source (one row per tenant) ---

export function getSource(): { path: string } | null {
  const row = getDb().prepare("SELECT path FROM dist_source WHERE tenant_id = ? LIMIT 1").get(tenantId()) as
    | { path: string }
    | undefined;
  return row ?? null;
}

export function setSource(p: unknown): void {
  const src = safeAbsPath(p);
  const db = getDb();
  const tid = tenantId();
  // single-source invariant: replace the tenant's row wholesale
  db.transaction(() => {
    db.prepare("DELETE FROM dist_source WHERE tenant_id = ?").run(tid);
    db.prepare("INSERT INTO dist_source (uuid, tenant_id, path) VALUES (?, ?, ?)").run(generateUUIDv7(), tid, src);
  })();
}

// --- targets (editable rows; dist_log is NOT) ---

export function listTargets(): DistTarget[] {
  return getDb()
    .prepare(
      "SELECT uuid, label, path, is_enabled, template_id, selected_agent_ids FROM dist_targets WHERE tenant_id = ? ORDER BY id ASC"
    )
    .all(tenantId()) as DistTarget[];
}

// Guardrails manifest — persists WHICH template + agents a target gets. Selection only: nothing
// here (or anywhere in this bite) writes CLAUDE.md / agent files to disk — stamping is a later bite.
export function setTargetManifest(uuid: unknown, templateId: unknown, agentIds: unknown): void {
  const tpl = templateId === null || templateId === undefined ? null : Number(templateId);
  if (tpl !== null && !Number.isInteger(tpl)) throw new Error("template_id must be an integer or null");
  if (!Array.isArray(agentIds) || agentIds.some((x) => !Number.isInteger(x))) {
    throw new Error("selected_agent_ids must be an integer array");
  }
  getDb()
    .prepare(
      "UPDATE dist_targets SET template_id = ?, selected_agent_ids = ?, updated_at = CURRENT_TIMESTAMP WHERE uuid = ? AND tenant_id = ?"
    )
    .run(tpl, JSON.stringify(agentIds), safeUuid(uuid), tenantId());
}

export function addTarget(label: unknown, p: unknown): void {
  getDb()
    .prepare("INSERT INTO dist_targets (uuid, tenant_id, label, path, is_enabled) VALUES (?, ?, ?, ?, 1)")
    .run(generateUUIDv7(), tenantId(), safeLabel(label), safeAbsPath(p));
}

export function setTargetEnabled(uuid: unknown, on: boolean): void {
  getDb()
    .prepare(
      "UPDATE dist_targets SET is_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE uuid = ? AND tenant_id = ?"
    )
    .run(on ? 1 : 0, safeUuid(uuid), tenantId());
}

export function removeTarget(uuid: unknown): void {
  getDb().prepare("DELETE FROM dist_targets WHERE uuid = ? AND tenant_id = ?").run(safeUuid(uuid), tenantId());
}

// --- log (APPEND-ONLY) ---

export function log(action: string, detail: string): void {
  getDb()
    .prepare("INSERT INTO dist_log (uuid, tenant_id, action, detail) VALUES (?, ?, ?, ?)")
    .run(generateUUIDv7(), tenantId(), action, detail);
}

// --- copy-replace-log pipeline ---

// Canon whitelist: ONLY these five families ever transfer, and per family ONLY the highest-N
// version ships. Everything else in the source (debriefs, notes, README, AvertXAI-CanonSystem-*)
// is ignored by construction.
const CANON_PATTERN = /^(CANON|FACTS|STATUS|DECISIONS|RULES|PROJECTS)-(\d+)\.md$/;

/** prefix -> { n, file } for the highest-N whitelist file per family in the source dir. */
function resolveShipment(srcDir: string): Map<string, { n: number; file: string }> {
  const best = new Map<string, { n: number; file: string }>();
  for (const f of fs.readdirSync(srcDir)) {
    const m = CANON_PATTERN.exec(f);
    if (!m || !fs.statSync(path.join(srcDir, f)).isFile()) continue;
    const n = parseInt(m[2], 10); // numeric, not lexicographic: STATUS-9 < STATUS-23
    const cur = best.get(m[1]);
    if (!cur || n > cur.n) best.set(m[1], { n, file: f });
  }
  return best;
}

export function syncAll(): SyncResult {
  let ok = 0;
  let errors = 0;
  const targets: TargetSyncStatus[] = [];
  const src = getSource();
  if (!src) {
    errors++;
    log("ERROR", "sync aborted: no source configured");
  } else {
    let shipment = new Map<string, { n: number; file: string }>();
    let sourceOk = true;
    try {
      shipment = resolveShipment(src.path);
    } catch (err) {
      errors++;
      sourceOk = false;
      log("ERROR", `source unreadable (${src.path}): ${String(err)}`);
    }
    if (sourceOk) {
      const files = [...shipment.values()].map((b) => b.file);
      for (const t of listTargets().filter((t) => t.is_enabled === 1)) {
        try {
          // ENVELOPE: the target root must ALREADY exist as a directory — a vanished target is
          // an error, never a mkdir (only the CANON/ subfolder inside it may be created).
          if (!fs.existsSync(t.path) || !fs.statSync(t.path).isDirectory()) {
            throw new Error("path not found — folder moved?");
          }
          // SAFETY ENVELOPE: everything below writes inside {target}/CANON/ only.
          const dest = path.join(t.path, "CANON");
          fs.mkdirSync(dest, { recursive: true });
          for (const f of files) {
            const to = path.join(dest, f);
            const existed = fs.existsSync(to);
            fs.copyFileSync(path.join(src.path, f), to);
            log(existed ? "REPLACE" : "COPY", `${f} -> ${to}`);
          }
          // STALE CLEANUP — confined to {target}/CANON/, and ONLY lower-N files of a shipped
          // family (same whitelist pattern). User notes / non-pattern files always survive.
          for (const entry of fs.readdirSync(dest)) {
            const m = CANON_PATTERN.exec(entry);
            if (!m) continue;
            const cur = shipment.get(m[1]);
            if (cur && parseInt(m[2], 10) < cur.n) {
              fs.unlinkSync(path.join(dest, entry));
              log("PRUNE", `${entry} removed from ${dest} (superseded by ${cur.file})`);
            }
          }
          ok++;
          targets.push({ uuid: t.uuid, status: "synced" });
        } catch (err) {
          // never abort the run — log and continue to the next target
          errors++;
          const detail = err instanceof Error ? err.message : String(err);
          log("ERROR", `target "${t.label}" (${t.path}): ${detail}`);
          targets.push({ uuid: t.uuid, status: "error", detail });
        }
      }
      log(
        "SYNC",
        `shipped: ${files.map((f) => f.replace(/\.md$/, "")).join(", ") || "(nothing matched)"} (${files.length} files)`
      );
    }
  }
  const result: SyncResult = { ok, errors, at: new Date().toISOString(), targets };
  broadcast("dist:synced", result);
  return result;
}

// --- log reads + the sanctioned purge ---

export function listLog(limit?: unknown, before?: unknown): DistLogRow[] {
  const lim = Math.min(Math.max(Math.floor(Number(limit)) || 50, 1), 200); // clamp 1..200, default 50
  const b = Math.floor(Number(before));
  const db = getDb();
  if (Number.isFinite(b) && b > 0) {
    return db
      .prepare(
        "SELECT id, uuid, action, detail, created_at FROM dist_log WHERE tenant_id = ? AND id < ? ORDER BY id DESC LIMIT ?"
      )
      .all(tenantId(), b, lim) as DistLogRow[];
  }
  return db
    .prepare("SELECT id, uuid, action, detail, created_at FROM dist_log WHERE tenant_id = ? ORDER BY id DESC LIMIT ?")
    .all(tenantId(), lim) as DistLogRow[];
}

export function countLog(): number {
  return (getDb().prepare("SELECT COUNT(*) AS c FROM dist_log WHERE tenant_id = ?").get(tenantId()) as { c: number })
    .c;
}

// THE sanctioned exception to dist_log's append-only rule: an explicit, user-CONFIRMED purge
// (mirrors the confirmed-destructive-action pattern). The purge itself is recorded immediately
// after, so the log is never silently empty.
export function nukeLog(): void {
  getDb().prepare("DELETE FROM dist_log WHERE tenant_id = ?").run(tenantId());
  log("NUKE", "log purged");
}

// History view: ALL rows, newest first — the renderer groups them into per-project blocks by the
// \<project>\CANON path inside detail. ponytail: unpaginated full read; page it if the log ever
// grows past what one view can hold.
export function listHistoryRows(): DistLogRow[] {
  return getDb()
    .prepare("SELECT id, uuid, action, detail, created_at FROM dist_log WHERE tenant_id = ? ORDER BY id DESC")
    .all(tenantId()) as DistLogRow[];
}

// Per-project purge (History blocks) — same sanctioned-nuke contract as nukeLog: rows only, never
// files, recorded immediately after. Matches any detail containing \<project>\CANON (COPY/REPLACE
// arrows and PRUNE "removed from" lines both carry it).
export function nukeHistoryFor(project: unknown): void {
  if (typeof project !== "string" || project.trim() === "") throw new Error("Project name required");
  const p = project.trim();
  getDb()
    .prepare("DELETE FROM dist_log WHERE tenant_id = ? AND detail LIKE ?")
    .run(tenantId(), `%\\${p}\\CANON%`);
  log("NUKE", `history purged for ${p}`);
}

// --- watcher (debounced) ---

let watcher: fs.FSWatcher | null = null;
let debounce: NodeJS.Timeout | null = null;
const DEBOUNCE_MS = 500;

export function isWatcherRunning(): boolean {
  return watcher !== null;
}

export function startWatcher(): void {
  if (watcher) return; // idempotent
  const src = getSource();
  if (!src) throw new Error("No source configured");
  const w = fs.watch(src.path, { recursive: true }, () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      try {
        syncAll();
      } catch (err) {
        log("ERROR", `watcher sync: ${String(err)}`);
      }
    }, DEBOUNCE_MS);
  });
  w.on("error", (err) => {
    log("ERROR", `watcher: ${String(err)}`);
    stopWatcher();
  });
  watcher = w;
}

export function stopWatcher(): void {
  if (debounce) {
    clearTimeout(debounce);
    debounce = null;
  }
  watcher?.close();
  watcher = null;
}
