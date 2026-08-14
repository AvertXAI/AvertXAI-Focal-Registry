// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Secured Notes — notes, runbooks and snippets, one stored shape (kind + title +
//              markdown body). Bodies are CONTENT, not credentials: a credential appears in a note
//              only as an @[[vault:…]] locator and is resolved through readSecret's logged path, so
//              a runbook can say "use this password" without a password ever entering a document.
//              LISTS RETURN AN EXCERPT, NEVER THE BODY — not for secrecy (the body is content) but
//              for weight: 67 bodies on every list render is how a notes list gets slow.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/vault/notes.ts
//------------------------------------------------------------
import { generateUUIDv7 } from "../utils/uuidv7";
import { nowIso, type Db } from "./db";
import { ensureFolderPath } from "./noteFolders";

export interface VaultNoteMeta {
  id: number;
  uuid: string;
  kind: string;
  title: string;
  excerpt: string;
  folder: string | null;
  /** The real tree (08-11-2026). The `folder` text column above is the legacy source it was lifted from. */
  folder_id: number | null;
  pinned: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface VaultNote extends Omit<VaultNoteMeta, "excerpt"> {
  body: string;
}

function vText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string") throw new Error(`Invalid ${label}`);
  if (value.length > max) throw new Error(`${label} too long (max ${max} characters)`);
  if (value.trim() === "") throw new Error(`${label} is required`);
  return value;
}

function vUuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-fA-F-]{36}$/.test(value)) throw new Error("Invalid note locator");
  return value;
}

const MAX_BODY = 1_000_000; // a megabyte of markdown is a book chapter with images referenced, not embedded
/** One column list, one place. `excerpt` is the only part that varies — search cuts its window
 *  around the match instead of the head of the file, and must not fork the other ten columns to
 *  do it. */
const metaCols = (excerpt: string): string =>
  `id, uuid, kind, title, ${excerpt} AS excerpt, folder, folder_id, pinned, archived_at, created_at, updated_at`;
const META_COLS = metaCols("substr(body, 1, 180)");

/**
 * `archived` picks WHICH shelf, it does not widen the list: false = the working set, true = the
 * archive. Archiving with nowhere to look is the same as deleting while claiming otherwise, which
 * is what the first cut shipped (Jason caught it 08-11-2026) — so the archive is a real view.
 */
/**
 * FILTERED AND CAPPED MAIN-SIDE (08-12-2026). This used to return EVERY note with no limit, and the
 * renderer then filtered by folder in JavaScript. With 4,089 imported notes that meant roughly 1.4 MB
 * of rows crossing the IPC bridge — twice, because the global search loaded the whole corpus as well
 * — every time the module reloaded. Jason: "when im in passwords tab, and try to switch to secured
 * notes, the app hangs for about 1.5secs".
 *
 * The folder cut is now SQL, so a folder of 12 notes transfers 12 rows instead of 4,089. The cap is
 * a backstop for "All notes"; `truncated` says when it bit rather than letting a short list look
 * complete.
 *
 * folderId: undefined = every folder · null = Unfiled only · a number = that folder.
 */
export function listNotes(
  db: Db,
  orgId: string,
  kind?: string,
  archived = false,
  folderId?: number | null,
  limit = 60,
  offset = 0
): { rows: VaultNoteMeta[]; total: number; truncated: boolean } {
  const where: string[] = ["org_id = ?", archived ? "archived_at IS NOT NULL" : "archived_at IS NULL"];
  const args: unknown[] = [orgId];
  if (kind) { where.push("kind = ?"); args.push(kind); }
  if (folderId === null) where.push("folder_id IS NULL");
  else if (typeof folderId === "number") { where.push("folder_id = ?"); args.push(folderId); }
  const clause = where.join(" AND ");
  const order = archived ? "archived_at DESC" : "pinned DESC, updated_at DESC, created_at DESC";
  const cap = Math.min(Math.max(Number(limit) || 60, 1), 2000);

  const total = (db.prepare(`SELECT COUNT(*) AS n FROM vault_notes WHERE ${clause}`).get(...args) as { n: number }).n;

  /**
   * TWO PHASES, and this is the whole performance fix — measured 08-12-2026 at Jason's real scale
   * (4,089 notes averaging 21 KB of body):
   *
   *   one query with substr(body,1,180) in the SELECT ....... 400 rows 13.94 ms · 60 rows 8.46 ms
   *   ids first, then fetch only those rows ................. 400 rows  4.57 ms · 60 rows 1.49 ms
   *                                                            ......... and 12 rows 0.36 ms
   *
   * Why it was slow: the excerpt is computed in the SELECT list, so ORDER BY had to read every
   * 21 KB body of every candidate row BEFORE the LIMIT could throw them away. A smaller LIMIT
   * therefore saved payload and no query time at all — a screenful cost the same as 400.
   *
   * Picking ids first touches no body. The second query reads exactly the rows about to be drawn,
   * which is what finally makes windowing worth doing (Jason's idea, 08-12-2026 — it was correct,
   * it just could not pay off until the LIMIT actually reduced the work).
   */
  const ids = (db
    .prepare(`SELECT id FROM vault_notes WHERE ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...args, cap, Math.max(0, Number(offset) || 0)) as { id: number }[]).map((r) => r.id);

  const rows = ids.length === 0 ? [] : (db
    .prepare(`SELECT ${META_COLS} FROM vault_notes WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY ${order}`)
    .all(...ids) as VaultNoteMeta[]);

  return { rows, total, truncated: total > rows.length + (Number(offset) || 0) };
}

/**
 * WORDS, NOT A PHRASE (Jason 08-12-2026: "when i search for builders audit, i get no hits, when i
 * should"). The old query was one `%builders audit%` LIKE, so the two words had to be ADJACENT and in
 * that order — a note saying "BuildersAudit" or "the audit for builders" matched nothing. Every term
 * must now appear somewhere in the title or the body, in any order. Six terms is the ceiling: past
 * that a query is a sentence, and each term costs a full-body scan.
 */
function searchTerms(q: string): string[] {
  return q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
}

/**
 * ONE main-side search across notes — titles and EXCERPTS only, never the full body, and hard-capped.
 * The global search used to hold every note in renderer memory to filter in JavaScript; this replaces
 * that with a query that returns only what is about to be drawn.
 *
 * RELEVANCE, NOT RECENCY (same day, same report: "i should [not] have to scroll all the way down for
 * that specific keyword like buildersaudit"). Ordering by updated_at alone put IDEAS-BUILDERSAUDIT.md
 * below a hundred notes that merely MENTION the word, because a search of 4,089 imported files is
 * mostly incidental body hits. The score is simply how many terms land in the TITLE — a note named
 * after your words is what you were looking for — and a shorter title breaks the tie, since it is the
 * more precisely about them. Recency only decides between equals.
 *
 * WHY NOT FTS5: it would rank better, and it costs a virtual table, a migration and sync triggers on
 * every write. LIKE over 4,089 notes answers in single-digit milliseconds here. Revisit at ~100k.
 */
export function searchNotes(db: Db, orgId: string, q: unknown, limit = 40): VaultNoteMeta[] {
  const terms = searchTerms(typeof q === "string" ? q.trim() : "");
  if (terms.length === 0) return [];
  const cap = Math.min(Math.max(Number(limit) || 40, 1), 200);
  const like = terms.map((t) => `%${t}%`);

  const clause = `org_id = ? AND archived_at IS NULL AND ${terms.map(() => "(title LIKE ? OR body LIKE ?)").join(" AND ")}`;
  const whereArgs: unknown[] = [orgId];
  for (const l of like) whereArgs.push(l, l);

  const order = `(${terms.map(() => "(CASE WHEN title LIKE ? THEN 1 ELSE 0 END)").join(" + ")}) DESC,
                 length(title) ASC, updated_at DESC, created_at DESC`;

  // Ids first, then the rows — the same two-phase shape listNotes measured at 3x, and for the same
  // reason: the excerpt below reads the body, so ORDER BY must not be the thing that computes it.
  const ids = (db
    .prepare(`SELECT id FROM vault_notes WHERE ${clause} ORDER BY ${order} LIMIT ?`)
    .all(...whereArgs, ...like, cap) as { id: number }[]).map((r) => r.id);
  if (ids.length === 0) return [];

  /**
   * THE EXCERPT IS THE MATCH, not the head of the file. Every row used to show `substr(body, 1, 180)`
   * — which for markdown is the same title and front-matter over and over, so twenty results looked
   * identical and none of them showed WHY they matched. The window is cut around the first term's
   * first occurrence; a title-only hit still falls back to the head, because there is nothing else to
   * show. Costs two instr() calls over the rows already about to be drawn, and nothing over the rest.
   */
  const first = terms[0];
  const cols = metaCols(
    `CASE WHEN instr(lower(body), ?) > 0
            THEN substr(body, max(1, instr(lower(body), ?) - 40), 220)
            ELSE substr(body, 1, 180) END`
  );
  return db
    .prepare(`SELECT ${cols} FROM vault_notes WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY ${order}`)
    .all(first, first, ...ids, ...like) as VaultNoteMeta[];
}

/** Back out of the archive. The mirror of archiveNote — nothing was destroyed, so nothing is rebuilt. */
export function restoreNote(db: Db, orgId: string, uuid: unknown): VaultNote {
  const cur = getNote(db, orgId, uuid);
  db.prepare("UPDATE vault_notes SET archived_at = NULL, updated_at = ? WHERE id = ?").run(nowIso(), cur.id);
  return getNote(db, orgId, cur.uuid);
}

/**
 * The ONLY hard delete in the notes surface, and it is reachable from the archive alone — you have
 * to have archived a thing before you can erase it. Two deliberate steps, because this one really
 * is gone.
 */
export function destroyNote(db: Db, orgId: string, uuid: unknown): void {
  const cur = getNote(db, orgId, uuid);
  if (!cur.archived_at) throw new Error("Archive it first — a note is only erasable from the archive.");
  db.prepare("DELETE FROM vault_notes WHERE id = ?").run(cur.id);
  // Free the pages back as we go. On an incremental-auto-vacuum file this measured 0 ms; on a legacy
  // file it is a no-op until one Compact converts it. Either way it is never the 2-second full
  // rebuild that "VACUUM on every delete" would have been.
  try { db.pragma("incremental_vacuum"); } catch { /* never let housekeeping fail a delete */ }
}

export function getNote(db: Db, orgId: string, uuid: unknown): VaultNote {
  const row = db
    .prepare("SELECT id, uuid, kind, title, body, folder, folder_id, pinned, archived_at, created_at, updated_at FROM vault_notes WHERE org_id = ? AND uuid = ?")
    .get(orgId, vUuid(uuid)) as VaultNote | undefined;
  if (!row) throw new Error("Note not found");
  return row;
}

export function createNote(
  db: Db,
  orgId: string,
  input: { kind?: unknown; title?: unknown; body?: unknown; folder?: unknown; folderId?: unknown; sourcePath?: unknown; createdAt?: unknown; updatedAt?: unknown }
): VaultNote {
  const kind = vText(input?.kind ?? "note", "kind", 40);
  const title = vText(input?.title, "title", 300);
  const body = typeof input?.body === "string" ? input.body.slice(0, MAX_BODY) : "";
  const folder = typeof input?.folder === "string" && input.folder.trim() !== "" ? input.folder.slice(0, 120) : null;
  // An IMPORTED note keeps the file's own dates. Stamping an old runbook with today's date throws
  // away the only chronology the archive had (Jason 08-11-2026); a note typed here has no such
  // history, so it falls back to now.
  const at = isoOrNow(input?.createdAt);
  const edited = input?.updatedAt === undefined ? null : isoOrNow(input.updatedAt);
  const uuid = generateUUIDv7();
  const res = db
    // folder_id is written HERE now. It was omitted, so every note ever created started life
    // unfiled and had to be moved by a second call the caller might not make (08-12-2026).
    .prepare("INSERT INTO vault_notes (uuid, org_id, kind, title, body, folder, folder_id, source_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(uuid, orgId, kind, title, body, folder, typeof input?.folderId === "number" && input.folderId > 0 ? input.folderId : null, typeof input?.sourcePath === "string" && input.sourcePath ? input.sourcePath : null, at, edited);
  return getNote(db, orgId, uuid) ?? ({ id: Number(res.lastInsertRowid) } as never);
}

/**
 * The date-resolution order an import follows, exposed so it can be proven: the author's own
 * frontmatter beats the file's timestamps, and both beat the clock.
 */
export function parseImportDates(
  src: { created?: unknown; date?: unknown; updated?: unknown; last_updated?: unknown; birthtimeMs?: unknown; mtimeMs?: unknown }
): { createdAt: string; updatedAt: string } {
  return {
    createdAt: isoOrNow(src.created ?? src.date ?? src.birthtimeMs),
    updatedAt: isoOrNow(src.updated ?? src.last_updated ?? src.mtimeMs),
  };
}

/** A trusted ISO string, or now. Rejects anything unparseable rather than storing "Invalid Date". */
function isoOrNow(value: unknown): string {
  if (typeof value === "string" && value !== "") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return nowIso();
}

/** The placeholder a hand-made note is born with. Only this exact string is ever overwritten. */
export const UNTITLED = "Untitled";

/**
 * A NOTE THAT NAMES ITSELF (Jason 08-12-2026: "this md file auto saved, but the file to the left,
 * still says untitled").
 *
 * Import has derived the title from a leading heading since it shipped — frontmatter, then `# `,
 * then the filename. A note you create in the app got none of that: it was born "Untitled" and stayed
 * "Untitled" no matter what you pasted into it, so the list read Untitled beside a document with a
 * title in its first line.
 *
 * ONLY the untouched placeholder is replaced, and only by a real leading heading. Once you have named
 * a note — even back to something else — this never fires again, because the title is then yours. And
 * a body with no heading keeps the placeholder rather than being given the first line of prose, which
 * would put half a sentence in the list and look like a bug of its own.
 */
export function adoptTitle(title: string, body: string): string {
  if (title.trim() !== UNTITLED) return title;
  // Up to three leading spaces is still a heading in CommonMark, and a pasted document routinely
  // has them. Anchoring hard at column zero is why this missed one in testing.
  const heading = body.match(/^[ \t]{0,3}#{1,3}[ \t]+(.+?)[ \t]*$/m)?.[1]?.trim();
  return heading ? heading.slice(0, 300) : title;
}

export function updateNote(
  db: Db,
  orgId: string,
  uuid: unknown,
  patch: { title?: unknown; body?: unknown; folder?: unknown; pinned?: unknown; kind?: unknown }
): VaultNote {
  const cur = getNote(db, orgId, uuid);
  const wanted = patch.title === undefined ? cur.title : vText(patch.title, "title", 300);
  const nextBody = patch.body === undefined ? cur.body : String(patch.body).slice(0, MAX_BODY);
  db.prepare("UPDATE vault_notes SET kind = ?, title = ?, body = ?, folder = ?, pinned = ?, updated_at = ? WHERE id = ?").run(
    patch.kind === undefined ? cur.kind : vText(patch.kind, "kind", 40),
    adoptTitle(wanted, nextBody),
    nextBody,
    patch.folder === undefined ? cur.folder : patch.folder == null || patch.folder === "" ? null : String(patch.folder).slice(0, 120),
    patch.pinned === undefined ? cur.pinned : patch.pinned ? 1 : 0,
    nowIso(),
    cur.id
  );
  return getNote(db, orgId, cur.uuid);
}

/**
 * Folder import. Reads a walked file list and creates one note per document, splitting YAML
 * frontmatter off the body by hand — a five-line split, not a dependency, because the only thing
 * needed here is "where does the body start".
 *
 * MALFORMED FRONTMATTER IS KEPT, NOT DROPPED. The research Jason supplied names the exact bug that
 * shipped in several real tools: a bad YAML block makes the file vanish with a debug log. Here the
 * note imports with its body intact and a `[import warning]` line prepended, so it is visible and
 * fixable rather than gone.
 */
export function importDocs(
  db: Db,
  orgId: string,
  files: unknown,
  opts: { kind?: unknown; folder?: unknown; mirror?: unknown }
): {
  scanned: number;
  created: number;
  warned: number;
  skipped: number;
  /** skippedFiled + skippedUnfiled + skippedArchived === skipped, always. */
  skippedFiled: number;
  skippedUnfiled: number;
  skippedArchived: number;
  failed: number;
  problems: { file: string; reason: string }[];
} {
  const list = Array.isArray(files) ? files : [];
  const folder = typeof opts?.folder === "string" && opts.folder.trim() !== "" ? opts.folder.slice(0, 120) : null;
  const forced = typeof opts?.kind === "string" && opts.kind !== "auto" ? opts.kind : null;
  const mirror = opts?.mirror === true;
  // ONE cache for the whole import — 2,000 files sharing 142 folders would otherwise run thousands
  // of redundant lookups.
  const folderCache = new Map<string, number>();
  // THE COUNTS MUST RECONCILE, and they now do by construction: scanned === created + skipped +
  // failed, every time. Jason read "2,083 were already in the vault" against a folder whose tree
  // count said 2,078 and reasonably called the message wrong (08-12-2026). Neither number was wrong
  // — they count different things — but a report that states one without the other cannot be checked,
  // and an unverifiable number is indistinguishable from a broken one.
  //
  // WHY THE TWO DIFFER, so this is not rediscovered: the tree count (noteFolderCounts) is notes
  // FILED UNDER THAT FOLDER and EXCLUDES the archived. `seen` below is every note in the vault
  // carrying any source path — archived ones too, and ones filed somewhere else entirely or nowhere.
  // Both are correct; `skipped` is simply the larger set.
  const out = {
    scanned: list.length, created: 0, warned: 0, skipped: 0, failed: 0,
    // WHERE THE SKIPPED ONES ACTUALLY LIVE. These three sum to `skipped`, and `skippedFiled` is the
    // one that lines up with the folder count in the sidebar — so "2,084 already here" against a
    // folder reading 2,078 stops being a contradiction and becomes 2,078 + 0 + 6.
    skippedFiled: 0, skippedUnfiled: 0, skippedArchived: 0,
    problems: [] as { file: string; reason: string }[],
  };
  // ALREADY IMPORTED? One query, not one per file — 2,000 files would otherwise be 2,000 lookups.
  // A MAP, not a Set, because knowing a file is already here is only half an answer; the other half
  // is where it went, and that is the half Jason could not get to from any screen.
  type Where = "filed" | "unfiled" | "archived";
  const seen = new Map<string, Where>();
  for (const r of db
    .prepare("SELECT source_path, folder_id, archived_at FROM vault_notes WHERE org_id = ? AND source_path IS NOT NULL")
    .all(orgId) as { source_path: string; folder_id: number | null; archived_at: string | null }[]) {
    // ARCHIVED WINS over filed/unfiled: an archived note is off the working shelf entirely, which is
    // why the folder tree does not count it and why it is invisible in Unfiled too. That invisibility
    // is precisely the gap this breakdown exists to close.
    seen.set(r.source_path, r.archived_at != null ? "archived" : r.folder_id == null ? "unfiled" : "filed");
  }

  for (const f of list) {
    const rec = f as { name?: unknown; rel?: unknown; path?: unknown; text?: unknown; birthtimeMs?: unknown; mtimeMs?: unknown };
    const sourcePath = typeof rec?.path === "string" && rec.path ? rec.path : null;
    // THE GUARD. Re-importing the same folder now adds what is new and leaves the rest alone, which
    // is what a person expects "import" to mean the second time they press it.
    const already = sourcePath ? seen.get(sourcePath) : undefined;
    if (already) {
      out.skipped++;
      if (already === "archived") out.skippedArchived++;
      else if (already === "unfiled") out.skippedUnfiled++;
      else out.skippedFiled++;
      continue;
    }
    const name = typeof rec?.name === "string" ? rec.name : "Untitled";
    const raw = typeof rec?.text === "string" ? rec.text : "";
    const rel = typeof rec?.rel === "string" ? rec.rel : name;
    try {
      const { front, body, bad } = splitFrontmatter(raw);
      // Title: frontmatter wins, then a leading "# " heading, then the filename without extension.
      const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
      const title = (front.title || heading || name.replace(/\.[^.]+$/, "")).slice(0, 300);
      // Kind: what the caller forced, else the frontmatter's own type, else a guess from shape.
      const kind = forced ?? guessKind(front, body);
      const prefix = bad ? `> [import warning] the YAML block in ${rel} could not be read — it was kept below as text.\n\n` : "";
      // DATES, in order of trust: the frontmatter's own `created`/`updated` (the author wrote them
      // deliberately), then the file's timestamps, and only then the clock.
      const made = createNote(db, orgId, {
        kind, title, body: prefix + body, folder: front.client || folder, sourcePath,
        createdAt: front.created || front.date || rec.birthtimeMs,
        updatedAt: front.updated || front.last_updated || rec.mtimeMs,
      });
      // MIRROR THE FOLDERS ON DISK (Jason 08-11-2026). The file's own relative path becomes a real
      // folder chain, so a tree you already arranged survives the import instead of collapsing into
      // one "Category". Only when the caller asked for it — the flat modes stay flat.
      // WHERE IT LANDS. Mirroring rebuilds the tree from the file's own path; the flat mode files
      // everything into the ONE folder the user named. Previously the flat mode wrote that name to
      // the legacy `folder` text column and left folder_id NULL — so a folder you named produced a
      // pile in Unfiled, which is most of why Unfiled kept filling up (08-12-2026).
      const fid = mirror
        ? ensureFolderPath(db, orgId, rec.rel, folderCache)
        : flatFolderId(db, orgId, front.client || folder, folderCache);
      if (fid != null) db.prepare("UPDATE vault_notes SET folder_id = ? WHERE id = ?").run(fid, made.id);
      // Recorded AFTER the filing, with where it actually went — so a duplicate later in the same run
      // is classified the same way a duplicate from a previous run is.
      if (sourcePath) seen.set(sourcePath, fid != null ? "filed" : "unfiled");
      out.created++;
      if (bad) { out.warned++; out.problems.push({ file: rel, reason: bad }); }
    } catch (e) {
      // COUNTED, not just listed. A file that threw was previously invisible in the arithmetic —
      // `problems` also carries frontmatter warnings for files that DID import, so the two could not
      // be told apart from the totals alone.
      out.failed++;
      out.problems.push({ file: rel, reason: e instanceof Error ? e.message : "could not be stored" });
    }
  }
  return out;
}

/** Splits `---\n…\n---\n` off the top. Returns the scalars it could read and never throws — a file
    whose frontmatter is broken still yields its body. */
function splitFrontmatter(raw: string): { front: Record<string, string>; body: string; bad: string | null } {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw; // Excel/Windows BOM
  if (!/^---\r?\n/.test(text)) return { front: {}, body: text, bad: null };
  const end = text.indexOf("\n---", 4);
  if (end === -1) return { front: {}, body: text, bad: "no closing --- for the frontmatter block" };
  const block = text.slice(4, end);
  const body = text.slice(end).replace(/^\n---\r?\n?/, "");
  const front: Record<string, string> = {};
  let bad: string | null = null;
  for (const line of block.split(/\r?\n/)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (/^\s/.test(line)) continue; // a nested/list line — not a scalar, skip it rather than guess
    const at = line.indexOf(":");
    if (at === -1) { bad = `line "${line.trim().slice(0, 40)}" is not key: value`; continue; }
    const key = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim().replace(/^["']|["']$/g, "").replace(/^\[|\]$/g, "");
    if (key) front[key] = value.slice(0, 500);
  }
  return { front, body, bad };
}

/** note | runbook | snippet, from what the file actually looks like. */
function guessKind(front: Record<string, string>, body: string): string {
  const t = (front.type || "").toLowerCase();
  if (t === "runbook" || t === "procedure") return "runbook";
  if (t === "snippet") return "snippet";
  if (front.id && /^RB-/i.test(front.id)) return "runbook";
  // Numbered steps and a Steps heading are what a runbook looks like from the outside.
  if (/^##\s*steps/im.test(body) && /^\s*1\.\s/m.test(body)) return "runbook";
  // Mostly one big fence and little prose reads as a snippet.
  const fences = (body.match(/```/g) ?? []).length / 2;
  if (fences >= 1 && body.replace(/```[\s\S]*?```/g, "").trim().length < 200) return "snippet";
  return "note";
}

/** Soft archive, mirroring secrets — a note is hidden, never hard-deleted by any UI path. */
export function archiveNote(db: Db, orgId: string, uuid: unknown): void {
  const cur = getNote(db, orgId, uuid);
  db.prepare("UPDATE vault_notes SET archived_at = ?, updated_at = ? WHERE id = ?").run(nowIso(), nowIso(), cur.id);
}


/**
 * PURGE EVERY NOTE, and the folder tree with it. A developer/testing surface and a real one: after a
 * bad import you want the whole thing gone, not 4,000 archive-then-destroy round trips.
 *
 * DELIBERATELY NOT the archive path. destroyNote refuses anything not already archived — that guard
 * exists so one slip cannot erase a note, and it is exactly the wrong shape for "clear it all and
 * start again". This is the other door, and it is confirm-gated in the UI with the count said out
 * loud first. One transaction: it either all goes or none of it does.
 */
export function purgeAllNotes(db: Db, orgId: string): { notes: number; folders: number } {
  let notes = 0;
  let folders = 0;
  db.transaction(() => {
    notes = db.prepare("DELETE FROM vault_notes WHERE org_id = ?").run(orgId).changes;
    folders = db.prepare("DELETE FROM vault_note_folders WHERE org_id = ?").run(orgId).changes;
  })();
  // Hand the pages back as we go — a purge is precisely when the file is at its most bloated.
  try { db.pragma("incremental_vacuum"); } catch { /* housekeeping never fails the purge */ }
  return { notes, folders };
}


/** The ONE folder a flat import files into, created once and reused for the whole run. */
function flatFolderId(db: Db, orgId: string, name: unknown, cache: Map<string, number>): number | null {
  const clean = typeof name === "string" ? name.trim().slice(0, 120) : "";
  if (!clean) return null; // no folder named — genuinely unfiled, and that is the user's choice
  const key = `__flat__/${clean}`;
  const hit = cache.get(key);
  if (hit != null) return hit;
  const existing = db
    .prepare("SELECT id FROM vault_note_folders WHERE org_id = ? AND name = ? AND parent_id IS NULL")
    .get(orgId, clean) as { id: number } | undefined;
  const id = existing
    ? existing.id
    : Number(db
        .prepare("INSERT INTO vault_note_folders (uuid, org_id, name, parent_id, sort_order, created_at) VALUES (?, ?, ?, NULL, 0, ?)")
        .run(generateUUIDv7(), orgId, clean, nowIso()).lastInsertRowid);
  cache.set(key, id);
  return id;
}
