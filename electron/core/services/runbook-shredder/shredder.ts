// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Runbook Shredder ingestion engine — the "shredder" core. Watches a folder of .md
//              runbooks (fs.watch recursive + 500ms debounce, stdlib — no chokidar, matching the
//              Canon Distributor pattern), parses frontmatter with gray-matter, and upserts by
//              file_path into the module DB. Parse failure = QUARANTINE (row kept with
//              parse_status='error'), never a silent drop. Secret refs store POINTERS only.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/runbook-shredder/shredder.ts
//------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { openShredderDb, generateUUIDv7, type Db } from "./db";
import type { ShredderSettings } from "../../../../src/modules/runbook-shredder/config.manifest";

// Columns written on ingest (std id/uuid/created_at/updated_at are handled separately). runbook_id
// maps from frontmatter `id`; the rest map by same name. Order-independent — used for named params.
const COLS = [
  "runbook_id", "title", "type", "status", "severity", "owner", "client", "description",
  "service", "trigger", "version", "updated", "body_md", "tags_flat", "file_path",
  "parse_status", "parse_error",
] as const;

type RowValues = Record<(typeof COLS)[number], string | null>;

// Coerce a frontmatter scalar to TEXT. js-yaml parses `updated: 2026-07-01` as a Date — keep it ISO.
function str(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function blankValues(filePath: string): RowValues {
  const v = Object.fromEntries(COLS.map((c) => [c, null])) as RowValues;
  v.file_path = filePath;
  v.parse_status = "ok";
  return v;
}

// INSERT if the file_path is new, else UPDATE in place (keeps id/uuid/created_at). Returns rowid.
function upsertRow(db: Db, filePath: string, values: RowValues): number {
  const existing = db.prepare("SELECT id FROM runbooks WHERE file_path = ?").get(filePath) as
    | { id: number }
    | undefined;
  if (existing) {
    const sets = COLS.map((c) => `"${c}" = @${c}`).join(", ");
    db.prepare(`UPDATE runbooks SET ${sets}, updated_at = CURRENT_TIMESTAMP WHERE id = @id`).run({
      ...values,
      id: existing.id,
    });
    return existing.id;
  }
  const cols = ["uuid", ...COLS].map((c) => `"${c}"`).join(", ");
  const params = ["@uuid", ...COLS.map((c) => `@${c}`)].join(", ");
  const info = db
    .prepare(`INSERT INTO runbooks (${cols}) VALUES (${params})`)
    .run({ uuid: generateUUIDv7(), ...values });
  return Number(info.lastInsertRowid);
}

// Replace this runbook's tags: clear the junction, dedupe tag names, re-link.
function syncTags(db: Db, rowId: number, tags: string[]): void {
  db.prepare("DELETE FROM runbook_tags WHERE runbook_id = ?").run(rowId);
  const insTag = db.prepare("INSERT OR IGNORE INTO tags (uuid, name) VALUES (?, ?)");
  const getTag = db.prepare("SELECT id FROM tags WHERE name = ?");
  const insJunc = db.prepare("INSERT OR IGNORE INTO runbook_tags (uuid, runbook_id, tag_id) VALUES (?, ?, ?)");
  for (const t of tags) {
    const name = t.trim();
    if (!name) continue;
    insTag.run(generateUUIDv7(), name);
    const tag = getTag.get(name) as { id: number };
    insJunc.run(generateUUIDv7(), rowId, tag.id);
  }
}

// Replace this runbook's secret refs. vault_pointer is copied verbatim — it's a POINTER, so there is
// no value here to leak; we never read or resolve it.
function syncSecretRefs(db: Db, rowId: number, refs: Record<string, unknown>): void {
  db.prepare("DELETE FROM runbook_secret_refs WHERE runbook_id = ?").run(rowId);
  const ins = db.prepare(
    "INSERT INTO runbook_secret_refs (uuid, runbook_id, ref_key, vault_pointer) VALUES (?, ?, ?, ?)"
  );
  for (const [key, pointer] of Object.entries(refs)) {
    const ptr = str(pointer);
    if (ptr) ins.run(generateUUIDv7(), rowId, key, ptr);
  }
}

// Parse + upsert one .md file. Malformed frontmatter is QUARANTINED (row kept, parse_status='error'),
// never dropped, so the UI can surface it as needing a fix.
export function ingestFile(db: Db, filePath: string): void {
  const raw = fs.readFileSync(filePath, "utf8");
  let values = blankValues(filePath);
  let tags: string[] = [];
  let secretRefs: Record<string, unknown> = {};

  try {
    const parsed = matter(raw); // throws on malformed YAML frontmatter
    const fm = (parsed.data ?? {}) as Record<string, unknown>;
    values.runbook_id = str(fm.id);
    values.title = str(fm.title);
    values.type = str(fm.type);
    values.status = str(fm.status);
    values.severity = str(fm.severity);
    values.owner = str(fm.owner);
    values.client = str(fm.client);
    values.description = str(fm.description);
    values.service = str(fm.service);
    values.trigger = str(fm.trigger);
    values.version = str(fm.version);
    values.updated = str(fm.updated);
    values.body_md = parsed.content;
    tags = Array.isArray(fm.tags) ? fm.tags.map((t) => String(t)) : [];
    values.tags_flat = tags.join(" ");
    secretRefs =
      fm.secret_refs && typeof fm.secret_refs === "object" && !Array.isArray(fm.secret_refs)
        ? (fm.secret_refs as Record<string, unknown>)
        : {};
  } catch (e) {
    values = blankValues(filePath);
    values.body_md = raw; // keep the raw text so the user can see/fix it in the UI
    values.parse_status = "error";
    values.parse_error = e instanceof Error ? e.message : String(e);
    tags = [];
    secretRefs = {};
  }

  db.transaction(() => {
    const rowId = upsertRow(db, filePath, values);
    syncTags(db, rowId, tags);
    syncSecretRefs(db, rowId, secretRefs);
  })();
}

// File delete / rename-away — drop the row. FK ON DELETE CASCADE clears tags + secret refs; the
// runbooks_ad trigger clears FTS. One statement cleans everything.
export function removeFile(db: Db, filePath: string): void {
  db.prepare("DELETE FROM runbooks WHERE file_path = ?").run(filePath);
}

// Dependency/build/system directories never hold user runbooks but can hold tens of thousands of .md
// (node_modules alone) — descending them made the initial ingest walk froze the app. Skipped at any
// depth, mirroring the Scan module's dir-exclusion rule.
const EXCLUDED_DIRS = new Set([
  "node_modules", ".git", ".hg", ".svn", "dist", "build", "release", "release-new", "win-unpacked",
  ".next", ".cache", ".turbo", "vendor", "coverage", "$recycle.bin", "system volume information",
]);

function* walkMd(dir: string): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // unreadable dir (permissions / vanished) — skip, don't crash the walk
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name.toLowerCase())) continue;
      yield* walkMd(full);
    } else if (entry.isFile() && full.toLowerCase().endsWith(".md")) yield full;
  }
}

export interface IngestProgress {
  done: number;
  total: number;
}

// Initial/full scan of the folder — ASYNC and YIELDING so the main event loop stays responsive (a
// large tree no longer freezes the app) and progress streams to the UI. Files are collected first so
// there is a real total for the percentage; ingestion yields every 32 files. Returns final counts.
export async function ingestAll(
  db: Db,
  dir: string,
  onProgress?: (p: IngestProgress) => void
): Promise<{ ingested: number; quarantined: number }> {
  const files = [...walkMd(dir)];
  const total = files.length;
  onProgress?.({ done: 0, total });
  for (let i = 0; i < total; i++) {
    try {
      ingestFile(db, files[i]);
    } catch {
      // A file that vanished mid-scan (or is unreadable) is skipped; the watcher will catch it next.
    }
    if ((i & 31) === 31 || i === total - 1) {
      onProgress?.({ done: i + 1, total });
      await new Promise((resolve) => setImmediate(resolve)); // yield: flush IPC/paint, keep UI alive
    }
  }
  const count = (status: string): number =>
    (db.prepare("SELECT COUNT(*) AS n FROM runbooks WHERE parse_status = ?").get(status) as { n: number }).n;
  return { ingested: count("ok"), quarantined: count("error") };
}

// Watch the folder: fs.watch recursive + a single 500ms debounce window that coalesces bursts, then
// re-ingests each changed .md (delete/rename-away → removeFile). autoReparse=false skips re-parsing
// files we already have a row for (only new/deleted files act).
export function watch(db: Db, dir: string, autoReparse: boolean): fs.FSWatcher {
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    timer = null;
    for (const rel of pending) {
      const full = path.join(dir, rel);
      if (!full.toLowerCase().endsWith(".md")) continue;
      try {
        if (fs.existsSync(full)) {
          const known = db.prepare("SELECT 1 FROM runbooks WHERE file_path = ?").get(full);
          if (known && !autoReparse) continue;
          ingestFile(db, full);
        } else {
          removeFile(db, full);
        }
      } catch {
        // Transient read race (file mid-write / just deleted) — next event re-drives it.
      }
    }
    pending.clear();
  };

  return fs.watch(dir, { recursive: true }, (_evt, filename) => {
    if (!filename) return;
    pending.add(filename.toString());
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 500);
  });
}

export interface ShredderHandle {
  db: Db;
  stop(): void;
}

// Public entry — ties DB + initial scan + watcher together, consuming injected settings (no root
// app_settings read). Returns a handle whose stop() closes the watcher (used by tests / teardown).
export function startShredder(opts: {
  orgId: string;
  baseDir: string;
  settings: ShredderSettings;
  onProgress?: (p: IngestProgress) => void;
  skipIngest?: boolean; // watch_enabled toggle only re-wires the watcher — files already in DB
}): ShredderHandle {
  const { orgId, baseDir, settings, onProgress, skipIngest } = opts;
  const db = openShredderDb(orgId, baseDir);
  const watchPath = settings["runbook-shredder.watch_path"];
  let watcher: fs.FSWatcher | null = null;

  if (watchPath && fs.existsSync(watchPath)) {
    // Fire-and-forget: the initial ingest runs async so boot is never blocked by a large folder.
    if (!skipIngest) void ingestAll(db, watchPath, onProgress);
    if (settings["runbook-shredder.watch_enabled"]) {
      watcher = watch(db, watchPath, settings["runbook-shredder.auto_reparse"]);
    }
  }

  return { db, stop: () => watcher?.close() };
}
