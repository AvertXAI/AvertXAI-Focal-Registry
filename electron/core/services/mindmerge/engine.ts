// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: MindMerge ingestion engine — the "mindmerge" core. Watches a folder of .md
//              notes (fs.watch recursive + 500ms debounce, stdlib — no chokidar, matching the
//              Canon Distributor pattern), parses frontmatter with gray-matter, and upserts by
//              file_path into the module DB. Parse failure = QUARANTINE (row kept with
//              parse_status='error'), never a silent drop. Secret refs store POINTERS only.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/mindmerge/engine.ts
//------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { openMindMergeDb, generateUUIDv7, type Db } from "./db";
import type { MindMergeSettings } from "../../../../src/modules/mindmerge/config.manifest";

// Columns written on ingest (std id/uuid/created_at/updated_at are handled separately). note_id
// maps from frontmatter `id`; the rest map by same name. Order-independent — used for named params.
// severity / service / trigger are DELIBERATELY ABSENT (retired 08-28-2026: runbook fields,
// columns kept for existing rows). COLS drives the upsert's SET list, so listing a retired
// column here would NULL a stored value on the next re-ingest — absence is the preservation.
const COLS = [
  "note_id", "title", "type", "status", "owner", "client", "description",
  "version", "updated", "body_md", "tags_flat", "file_path",
  "parse_status", "parse_error", "mtime_ms",
  "domain", "project", "area", "source", "confidence", // vault fields (Jason 08-28-2026)
] as const;

type RowValues = Record<(typeof COLS)[number], string | number | null>;

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
  const existing = db.prepare("SELECT id FROM mindmerge_notes WHERE file_path = ?").get(filePath) as
    | { id: number }
    | undefined;
  if (existing) {
    const sets = COLS.map((c) => `"${c}" = @${c}`).join(", ");
    db.prepare(`UPDATE mindmerge_notes SET ${sets}, updated_at = CURRENT_TIMESTAMP WHERE id = @id`).run({
      ...values,
      id: existing.id,
    });
    return existing.id;
  }
  const cols = ["uuid", ...COLS].map((c) => `"${c}"`).join(", ");
  const params = ["@uuid", ...COLS.map((c) => `@${c}`)].join(", ");
  const info = db
    .prepare(`INSERT INTO mindmerge_notes (${cols}) VALUES (${params})`)
    .run({ uuid: generateUUIDv7(), ...values });
  return Number(info.lastInsertRowid);
}

// Replace this note's tags: clear the junction, dedupe tag names, re-link.
function syncTags(db: Db, rowId: number, tags: string[]): void {
  db.prepare("DELETE FROM mindmerge_note_tags WHERE note_id = ?").run(rowId);
  const insTag = db.prepare("INSERT OR IGNORE INTO tags (uuid, name) VALUES (?, ?)");
  const getTag = db.prepare("SELECT id FROM tags WHERE name = ?");
  const insJunc = db.prepare("INSERT OR IGNORE INTO mindmerge_note_tags (uuid, note_id, tag_id) VALUES (?, ?, ?)");
  for (const t of tags) {
    const name = t.trim();
    if (!name) continue;
    insTag.run(generateUUIDv7(), name);
    const tag = getTag.get(name) as { id: number };
    insJunc.run(generateUUIDv7(), rowId, tag.id);
  }
}

// Replace this note's secret refs. vault_pointer is copied verbatim — it's a POINTER, so there is
// no value here to leak; we never read or resolve it.
function syncSecretRefs(db: Db, rowId: number, refs: Record<string, unknown>): void {
  db.prepare("DELETE FROM mindmerge_secret_refs WHERE note_id = ?").run(rowId);
  const ins = db.prepare(
    "INSERT INTO mindmerge_secret_refs (uuid, note_id, ref_key, vault_pointer) VALUES (?, ?, ?, ?)"
  );
  for (const [key, pointer] of Object.entries(refs)) {
    const ptr = str(pointer);
    if (ptr) ins.run(generateUUIDv7(), rowId, key, ptr);
  }
}

// Parse + upsert one .md file. Malformed frontmatter is QUARANTINED (row kept, parse_status='error'),
// never dropped, so the UI can surface it as needing a fix.
export function ingestFile(db: Db, filePath: string): void {
  // Stat BEFORE the read: if the file changes between the two, the stored mtime is the older one
  // and the next pass simply re-ingests — stale-marker-safe, never stale-content-safe-marker.
  const mtime = Math.round(fs.statSync(filePath).mtimeMs);
  const raw = fs.readFileSync(filePath, "utf8");
  let values = blankValues(filePath);
  values.mtime_ms = mtime;
  let tags: string[] = [];
  let secretRefs: Record<string, unknown> = {};

  try {
    const parsed = matter(raw); // throws on malformed YAML frontmatter
    const fm = (parsed.data ?? {}) as Record<string, unknown>;
    values.note_id = str(fm.id);
    values.title = str(fm.title);
    values.type = str(fm.type);
    values.status = str(fm.status);
    // values.severity = str(fm.severity); // 08-28-2026 retired: runbook field, kept for existing rows
    values.owner = str(fm.owner);
    values.client = str(fm.client);
    values.description = str(fm.description);
    // values.service = str(fm.service); // 08-28-2026 retired: runbook field, kept for existing rows
    // values.trigger = str(fm.trigger); // 08-28-2026 retired: runbook field, kept for existing rows
    values.version = str(fm.version);
    values.updated = str(fm.updated);
    // Vault fields (Jason 08-28-2026). SOFT validation by design: an unknown domain or confidence
    // is written as-is — quarantine stays reserved for malformed YAML only.
    values.domain = str(fm.domain);
    values.project = str(fm.project);
    values.area = str(fm.area);
    values.source = str(fm.source);
    values.confidence = str(fm.confidence);
    values.body_md = parsed.content;
    tags = Array.isArray(fm.tags) ? fm.tags.map((t) => String(t)) : [];
    values.tags_flat = tags.join(" ");
    secretRefs =
      fm.secret_refs && typeof fm.secret_refs === "object" && !Array.isArray(fm.secret_refs)
        ? (fm.secret_refs as Record<string, unknown>)
        : {};
  } catch (e) {
    values = blankValues(filePath);
    values.mtime_ms = mtime; // the reassignment above dropped it — quarantined rows guard too
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
// mindmerge_ad trigger clears FTS. One statement cleans everything.
export function removeFile(db: Db, filePath: string): void {
  db.prepare("DELETE FROM mindmerge_notes WHERE file_path = ?").run(filePath);
}

// Dependency/build/system directories never hold user notes but can hold tens of thousands of .md
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

/**
 * GHOST-ROW PRUNE (Jason 08-30-2026): a file deleted while the app was closed raises no watch
 * event, ever — and ingestAll only upserted, so the row outlived its file forever (the stale-SOP
 * symptom on the Brain side). After a FULL walk of a root, any row under that root whose file was
 * not seen AND provably no longer exists is dropped through removeFile — the same cascade + FTS
 * path a live delete takes.
 *
 * THE GUARDS ARE THE FEATURE — a prune that can mass-delete is worse than the ghosts it removes:
 *  · the root is re-checked with readdirSync at prune time: walkMd swallows a mid-walk vanish
 *    (an unplugged drive) into an empty yield, which would otherwise read as "everything deleted";
 *  · a row whose path crosses an EXCLUDED_DIRS segment under this root is untouchable — the walk
 *    never descends there (another stacked root can nest inside one), so it cannot judge it;
 *  · ONLY ENOENT/ENOTDIR is proof of absence (adversarial review 08-31-2026): existsSync returns
 *    false on ANY stat error, so a deny-ACL'd or dead-share subtree — which walkMd also silently
 *    skips, taking its files out of `seen` — would have read as "everything deleted". Here an
 *    access failure (EPERM/EACCES/EIO/…) on the file OR its directory means CANNOT JUDGE → keep;
 *  · each candidate's own directory is judged first (one cached readdir per directory): a
 *    directory that is provably gone condemns its rows in one read; a readable one defers to the
 *    per-file stat — which also spares files created after the walk snapshot, and rows whose
 *    stored casing drifted from the walk's.
 * Rows under OTHER roots are out of scope by path containment (the underRoot shape from ipc.ts).
 * Every mindmerge_notes row claims a backing file by schema (file_path UNIQUE NOT NULL; authored
 * notes live in mindmerge_docs), so a row that fails every out is by definition a ghost —
 * quarantined rows (parse_status = 'error') included: their file is just as gone.
 *
 * ASYNC + ONE TRANSACTION (same review): the checks yield every 64 rows so a huge prune cannot
 * freeze the main thread, and the deletes land as one commit — one fsync, not one per ghost.
 */
export async function pruneGhosts(db: Db, dir: string, seenFiles: string[]): Promise<number> {
  try { fs.readdirSync(dir); } catch { return 0; } // root unreadable or vanished — judge nothing
  const seen = new Set(seenFiles);
  const rows = db.prepare("SELECT file_path FROM mindmerge_notes").all() as { file_path: string }[];
  const gone = (e: unknown): boolean => {
    const code = (e as NodeJS.ErrnoException)?.code;
    return code === "ENOENT" || code === "ENOTDIR";
  };
  // Per-directory verdict, cached: "ok" = readable (per-file stat decides), "gone" = provably
  // deleted (its rows are ghosts), "blind" = unreadable for any other reason (judge nothing).
  const dirState = new Map<string, "ok" | "gone" | "blind">();
  const judgeDir = (parent: string): "ok" | "gone" | "blind" => {
    let v = dirState.get(parent);
    if (v === undefined) {
      try { fs.readdirSync(parent); v = "ok"; } catch (e) { v = gone(e) ? "gone" : "blind"; }
      dirState.set(parent, v);
    }
    return v;
  };
  const doomed: string[] = [];
  let checked = 0;
  for (const { file_path } of rows) {
    if ((++checked & 63) === 0) await new Promise((resolve) => setImmediate(resolve));
    if (seen.has(file_path)) continue;
    const rel = path.relative(dir, file_path);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) continue; // not under this root
    if (rel.split(path.sep).some((s) => EXCLUDED_DIRS.has(s.toLowerCase()))) continue; // walk blind spot
    const parent = judgeDir(path.dirname(file_path));
    if (parent === "blind") continue;
    if (parent === "ok") {
      try { fs.statSync(file_path); continue; } // still there — created after the snapshot, or casing drift
      catch (e) { if (!gone(e)) continue; } // access failure is not proof of anything
    }
    doomed.push(file_path); // directory provably gone, or ENOENT under a readable directory
  }
  if (doomed.length > 0) db.transaction(() => { for (const p of doomed) removeFile(db, p); })();
  return doomed.length;
}

// Initial/full scan of the folder — ASYNC and YIELDING so the main event loop stays responsive (a
// large tree no longer freezes the app) and progress streams to the UI. Files are collected first so
// there is a real total for the percentage; ingestion yields every 32 files. Returns final counts.
export async function ingestAll(
  db: Db,
  dir: string,
  onProgress?: (p: IngestProgress) => void
): Promise<{ ingested: number; quarantined: number; pruned: number }> {
  const files = [...walkMd(dir)];
  const total = files.length;
  // CHANGE-GUARD (Jason 08-26-2026 — the Secured Notes direction: the DB is the truth, files are
  // only read when they changed). A file whose stored mtime matches its stat is SKIPPED, so a
  // re-open of the module is a stat-walk in milliseconds, not a re-parse of the whole tree. Rows
  // from before the mtime_ms column read NULL and re-ingest once, which backfills the guard.
  const known = new Map(
    (db.prepare("SELECT file_path, mtime_ms FROM mindmerge_notes").all() as
      { file_path: string; mtime_ms: number | null }[]).map((r) => [r.file_path, r.mtime_ms])
  );
  onProgress?.({ done: 0, total });
  for (let i = 0; i < total; i++) {
    try {
      const have = known.get(files[i]);
      if (have == null || have !== Math.round(fs.statSync(files[i]).mtimeMs)) ingestFile(db, files[i]);
    } catch {
      // A file that vanished mid-scan (or is unreadable) is skipped; the watcher will catch it next.
    }
    if ((i & 31) === 31 || i === total - 1) {
      onProgress?.({ done: i + 1, total });
      await new Promise((resolve) => setImmediate(resolve)); // yield: flush IPC/paint, keep UI alive
    }
  }
  // The walk is complete — reconcile the other direction (DB rows whose files are gone).
  const pruned = await pruneGhosts(db, dir, files);
  const count = (status: string): number =>
    (db.prepare("SELECT COUNT(*) AS n FROM mindmerge_notes WHERE parse_status = ?").get(status) as { n: number }).n;
  return { ingested: count("ok"), quarantined: count("error"), pruned };
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
          const known = db.prepare("SELECT 1 FROM mindmerge_notes WHERE file_path = ?").get(full);
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

export interface MindMergeHandle {
  db: Db;
  stop(): void;
}

// Public entry — ties DB + initial scan + watcher together, consuming injected settings (no root
// app_settings read). Returns a handle whose stop() closes the watcher (used by tests / teardown).
export function startMindMerge(opts: {
  orgId: string;
  baseDir: string;
  settings: MindMergeSettings;
  /** BL-58: the STACKED import roots. Every root is ingested and watched; a new import never
   *  replaces an earlier one ("i wont want the first import to close to open the new imported
   *  folder"). Omitted = the legacy single watch_path, so old callers keep working unchanged. */
  roots?: string[];
  onProgress?: (p: IngestProgress) => void;
  skipIngest?: boolean; // watch_enabled toggle only re-wires the watcher — files already in DB
}): MindMergeHandle {
  const { orgId, baseDir, settings, onProgress, skipIngest } = opts;
  const db = openMindMergeDb(orgId, baseDir);
  const roots = (opts.roots ?? [settings["mindmerge.watch_path"]]).filter(
    (r): r is string => !!r && fs.existsSync(r)
  );
  const watchers: fs.FSWatcher[] = [];

  if (roots.length) {
    // Fire-and-forget, SEQUENTIAL across roots: boot is never blocked, and two ingests never
    // interleave their progress streams into one meaningless percentage.
    if (!skipIngest) {
      void (async () => {
        for (const r of roots) await ingestAll(db, r, onProgress);
      })();
    }
    if (settings["mindmerge.watch_enabled"]) {
      for (const r of roots) watchers.push(watch(db, r, settings["mindmerge.auto_reparse"]));
    }
  }

  return { db, stop: () => watchers.forEach((w) => w.close()) };
}
