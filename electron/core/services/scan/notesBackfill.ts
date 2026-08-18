/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// ONE-TIME BACKFILL of scan_notes_updates.folder_path and .source_uuid.
//
// WHY THIS EXISTS. The feed recorded that a folder was renamed, or that a note was added, without
// recording WHICH folder. That is an incomplete log, not merely an inconvenience for the Recent Work
// panel — a history a user reads back should say what it happened to. Jason ruled on 08-18-2026:
// "dont do things half ass, whatever we need to fix, fix it." So the schema is fixed, the write path
// is fixed so it cannot recur, and the rows already written are repaired here.
//
// THE ONE RULE THIS FILE OBEYS: A ROW IS ONLY WRITTEN WHEN THE ANSWER IS PROVABLE. Every match below
// is either an exact string the writer itself emitted, corroborated against a row that still exists,
// or a unique candidate that also survives a timestamp and a causality test. Anything short of that
// leaves the row NULL. A blank row is honest; a wrong folder name written into a history the user
// reads back is undetectable afterwards.
//
// THIS FILE WAS REWRITTEN AFTER AN ADVERSARIAL REVIEW (08-18-2026) FOUND FIVE WAYS THE FIRST CUT
// COULD WRITE A WRONG PATH. Each is named at the code that now prevents it, because every one of
// them looked safe until someone tried to break it:
//   · a lone candidate was accepted with no timestamp check at all      → see `only()`
//   · a note retitled later could claim an older event's row            → see CAUSALITY
//   · the created-note branch wrote a parsed string with no corroboration → see KNOWN FOLDERS
//   · `indexOf` matched a marker planted inside a user-controlled title  → see lastIndexOf
//   · an em dash in a folder name truncated the rename parse            → see PREFIX MATCH
//
// IT ONLY EVER FILLS NULLS. Every UPDATE carries `AND folder_path IS NULL`, so a re-run cannot
// overwrite a value the live write path recorded correctly.
import type { Db } from "./notesDb";

export interface BackfillCounts {
  /** Matched provably, and written. */
  exact: number;
  /** More than one candidate survived, or none did. Deliberately left NULL. */
  ambiguous: number;
  /** No candidate at all — the note or history row is gone, or the message names no folder. */
  none: number;
  /** Rows examined: kind note or rename, folder_path still NULL. */
  examined: number;
}

interface FeedRow {
  uuid: string;
  kind: string;
  message: string;
  detail: string | null;
  ts: string | null;
}

interface NoteRow {
  uuid: string;
  folder_path: string;
  title: string;
  created_at: string | null;
  updated_at: string | null;
}

interface HistoryRow {
  uuid: string;
  folder_path_new: string;
  name_old: string;
  name_new: string;
  changed_at: string | null;
}

/** The literal sentence createNote writes. The folder path is INTERPOLATED INTO IT. */
const CREATED_MARKER = " — created and saved inside ";

/** `${title} — user notes updated.` — title only, no path. */
const EDITED_SUFFIX = " — user notes updated.";

/**
 * How far apart a source row's clock reading and its feed row's may be and still be the same event.
 *
 * They are separate `nowIso()` calls in the same synchronous block — microseconds in practice — so
 * five seconds is four orders of magnitude of slack. UNLIKE THE FIRST CUT, this is not merely a
 * tie-break between rivals: a lone candidate must pass it too. "Unique" is not the same as
 * "identical", and a note that is the only one with its title but was written eight months after
 * the event is not that event's note.
 */
const WINDOW_MS = 5000;

const ms = (iso: string | null): number => {
  if (!iso) return NaN;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? NaN : t;
};

const within = (a: string | null, b: string | null): boolean => {
  const d = Math.abs(ms(a) - ms(b));
  return !Number.isNaN(d) && d <= WINDOW_MS;
};

/**
 * The single surviving candidate, or a refusal.
 *
 * EVERY CANDIDATE MUST BE INSIDE THE WINDOW, including a lone one. The first cut short-circuited on
 * `length === 1` and returned it unchecked, which is exactly how a note retitled months later could
 * hand its folder to an unrelated event: the title was unique, so nothing else was ever consulted.
 */
function only<T>(candidates: T[], at: (c: T) => string | null, rowTs: string | null): T | "ambiguous" | null {
  if (candidates.length === 0) return null;
  const near = candidates.filter((c) => within(at(c), rowTs));
  if (near.length === 1) return near[0];
  return near.length === 0 ? null : "ambiguous";
}

/**
 * Backfill, inside one transaction. Returns the counts the ruling asks to be reported.
 *
 * THE CALLER WRAPS THIS AND THE ALTER TOGETHER — see notesDb.ts. That matters more than it looks:
 * the first cut's comment claimed a shared transaction that did not exist anywhere on the call path
 * (`ensureAllModuleSchemas` is a bare loop), so the ALTER autocommitted on its own. A crash between
 * the two would have left the column present, the guard satisfied, and the repair skipped FOREVER —
 * no marker row, no version counter, no way back in.
 */
export function backfillFeedFolders(db: Db): BackfillCounts {
  const counts: BackfillCounts = { exact: 0, ambiguous: 0, none: 0, examined: 0 };

  const rows = db
    .prepare(
      `SELECT uuid, kind, message, detail, ts FROM scan_notes_updates
       WHERE folder_path IS NULL AND kind IN ('note', 'rename')`
    )
    .all() as FeedRow[];
  counts.examined = rows.length;
  if (rows.length === 0) return counts;

  const write = db.prepare(
    "UPDATE scan_notes_updates SET folder_path = ?, source_uuid = ? WHERE uuid = ? AND folder_path IS NULL"
  );

  // ---- source tables, read once. Small next to the feed, and a per-row query would be one
  // ---- statement per feed row on a table that grows forever.
  const notes = db
    .prepare("SELECT uuid, folder_path, title, created_at, updated_at FROM scan_notes")
    .all() as NoteRow[];

  const history = db
    .prepare("SELECT uuid, folder_path_new, name_old, name_new, changed_at FROM scan_folder_name_history")
    .all() as HistoryRow[];

  /**
   * KNOWN FOLDERS — every path this organisation has actually scanned, lowercased.
   *
   * This is the corroboration that stops string surgery from becoming a written value. The first cut
   * wrote whatever it parsed out of the detail sentence with no check at all, so a note titled
   * `Something — created and saved inside D:\fake` produced a folder_path of pure nonsense. A parse
   * that does not name a folder this product has seen is not an answer.
   */
  const knownFolders = new Set(
    (db.prepare("SELECT DISTINCT path FROM scan_folders").all() as Array<{ path: string }>).map((r) =>
      r.path.toLowerCase()
    )
  );

  /** title -> every note carrying it. A title is mutable and not unique, which is why this is a list. */
  const notesByTitle = new Map<string, NoteRow[]>();
  for (const n of notes) {
    const k = n.title.trim();
    const list = notesByTitle.get(k);
    if (list) list.push(n); else notesByTitle.set(k, [n]);
  }

  const apply = (folderPath: string, sourceUuid: string | null, rowUuid: string): void => {
    const r = write.run(folderPath, sourceUuid, rowUuid);
    // Counted only when a row actually changed. The first cut incremented on every call, so the
    // console line reported repairs that never happened.
    if (r.changes > 0) counts.exact += 1;
  };

  /**
   * CAUSALITY — a note cannot explain an event that predates it.
   *
   * One `only()` window is not enough on its own for the title-keyed branches, because the note's
   * `updated_at` moves with every later save while the feed row's `ts` is frozen. This is the second
   * gate: whatever else matches, a note created after the event is not that event's note.
   */
  const existedAt = (n: NoteRow, rowTs: string | null): boolean => {
    const c = ms(n.created_at);
    const t = ms(rowTs);
    return Number.isNaN(c) || Number.isNaN(t) ? false : c <= t + WINDOW_MS;
  };

  for (const r of rows) {
    const detail = r.detail ?? "";

    // ============================================================ RENAMES
    // PREFIX MATCH, NOT A PARSE. Rather than splitting the sentence and hoping the pieces are the
    // names, each history row is asked whether the sentence STARTS with what it would have written.
    // `recordHistory` stores name_old/name_new as the same `path.basename()` values the detail was
    // built from, so this compares the writer's output against itself.
    //
    // IT ALSO FIXES THE EM DASH. The first cut cut the string at the first " — ", which silently
    // truncated every rename to a name containing one — and "2024-06-12 Smith — Delivered" is
    // ordinary photographer naming. Worse, the truncated form could match a DIFFERENT history row
    // whose new name happened to be the prefix. Nothing is cut here.
    //
    // A longer new name is a prefix of nothing it should not be: where two rows both match (one new
    // name being a prefix of the other), the window decides, and if it cannot, the row stays NULL.
    if (r.kind === "rename") {
      const cands = history.filter((h) => detail.startsWith(`${h.name_old} -> ${h.name_new}`));
      const hit = only(cands, (h) => h.changed_at, r.ts);
      if (hit === null) { counts.none += 1; continue; }
      if (hit === "ambiguous") { counts.ambiguous += 1; continue; }
      // The NEW path is the destination — after an applied rename the old one no longer exists, and
      // for a queued one it is where scan_folders already has the folder.
      apply(hit.folder_path_new, hit.uuid, r.uuid);
      continue;
    }

    // ============================================================ NOTE CREATED
    // lastIndexOf, NOT indexOf. The marker sits after a title the user controls, so a title
    // containing the marker text made the first cut parse the TITLE's copy and take everything after
    // it. Reading from the last occurrence takes the writer's own, which is always the final one.
    const marker = detail.lastIndexOf(CREATED_MARKER);
    if (marker >= 0) {
      const tail = detail.slice(marker + CREATED_MARKER.length);
      const parsed = (tail.endsWith(".") ? tail.slice(0, -1) : tail).trim();
      const title = detail.slice(0, marker).trim();

      // The note itself is the better answer when it can be found, because `cascadePaths` keeps
      // scan_notes.folder_path CURRENT while this sentence froze the path at creation time. Writing
      // the frozen one would make a since-renamed folder appear TWICE in Recent Work — once under a
      // path that no longer exists and cannot be jumped to.
      const byTitle = (notesByTitle.get(title) ?? []).filter((n) => existedAt(n, r.ts));
      const hit = only(byTitle, (n) => n.created_at, r.ts);
      if (hit !== null && hit !== "ambiguous") { apply(hit.folder_path, hit.uuid, r.uuid); continue; }

      // No note survives — it may have been deleted. The parsed path is still the writer's own
      // variable, so it is usable, but ONLY if it names a folder this organisation actually scanned.
      if (parsed !== "" && knownFolders.has(parsed.toLowerCase())) { apply(parsed, null, r.uuid); continue; }
      if (hit === "ambiguous") counts.ambiguous += 1; else counts.none += 1;
      continue;
    }

    // ============================================================ NOTE EDITED / ARCHIVED
    // Title only — the weakest key in the file, and treated as such: unique within the window AND
    // the note must already have existed. Two notes sharing a title leaves the row NULL.
    const title = detail.endsWith(EDITED_SUFFIX) ? detail.slice(0, -EDITED_SUFFIX.length).trim() : detail.trim();
    if (title === "") { counts.none += 1; continue; }
    const cands = (notesByTitle.get(title) ?? []).filter((n) => existedAt(n, r.ts));
    const hit = only(cands, (n) => n.updated_at ?? n.created_at, r.ts);
    if (hit === null) { counts.none += 1; continue; }
    if (hit === "ambiguous") { counts.ambiguous += 1; continue; }
    apply(hit.folder_path, hit.uuid, r.uuid);
  }

  return counts;
}
