/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// THE FAILURE LOG — the thumbnail cache's other half.
//
// The cache records what CAN be previewed. Nothing recorded what could not, so every folder open
// paid the same price for the same hopeless files: a queue slot, a frmedia request, a decoder, and
// ten seconds of ceiling, every time, forever. A file whose format Chromium genuinely cannot decode
// fails identically on the two hundredth attempt as on the first.
//
// This is Jason's design, 08-18-2026: "create a error log for media files that check for failed
// media, then loops back and trys to load those media files again". The loop is in MediaGrid; this
// is the memory it loops against. Two rules shape it, and they are the whole difference between a
// safety net and a treadmill — a retry must be able to SUCCEED, and a failure must be VISIBLE.
//
// NOT A DATABASE TABLE, for the same reason the thumbnail cache is not one: this is not data. It is
// an optimisation whose total loss costs one wasted decode per file and nothing else. It must never
// be able to take the organisation database down with it, and it needs no migration, transaction or
// backup. One small JSON file beside the cache, invalidated on the same terms.
import fs from "node:fs";
import path from "node:path";
import { keyFor, thumbsRoot } from "./thumbs";

/** Why a thumbnail could not be produced. The classifier lives in the renderer, where the media
 *  element's own error is — this side stores the verdict and never second-guesses it. */
export type ThumbFailReason = "transient" | "permanent" | "unknown";

export interface ThumbFailure {
  /** The cache's content key at the time of the failure. Purely an invalidation stamp — see the
   *  note on the map's own key below. */
  key: string;
  /** Basename, for the line under the grid. The renderer has this already; storing it keeps a
   *  future consumer (a diagnostics view) from having to re-walk the listing. */
  name: string;
  reason: ThumbFailReason;
  /** The underlying media error code and message. Diagnostic only — NEVER shown to the user, who
   *  gets a plain sentence chosen in the renderer. */
  detail: string;
  attempts: number;
  /** Epoch milliseconds of the last attempt. Also the sweep order when the file is over cap. */
  at: number;
}

/** How many entries the file may hold before the oldest are dropped. Sized like the cache ceiling:
 *  far past any real archive folder, so in practice it never fires, and present only so an
 *  unattended machine cannot quietly grow a log forever. A log that grows without bound is a bug
 *  with a delay on it. */
const FAILURES_MAX = 4000;

/** Writes are debounced by this much. A folder of four hundred clips failing in a burst — a drive
 *  yanked mid-warm — must be ONE write, not four hundred. */
const FLUSH_DELAY_MS = 2000;

function failuresFile(): string {
  return path.join(thumbsRoot(), "failures.json");
}

/**
 * THE MAP'S KEY IS THE RESOLVED LOWERCASE PATH, NOT THE CONTENT KEY, and this is a deliberate
 * deviation from the cache's shape that is worth the paragraph.
 *
 * The content key is `sha1(path|size|mtime)`, which requires a successful `stat`. But the single
 * most important transient failure — the drive was unplugged, the network share dropped — is
 * exactly the case where the stat FAILS. Keying the map by content key would make the most common
 * recoverable failure the one thing this log cannot record or find.
 *
 * The invalidation semantics the content key exists for are preserved exactly: the key is stored as
 * a FIELD, and a lookup that can stat the file compares it. A changed file has a different key and
 * its entry is dropped — a clean slate, same as the cache. A file that cannot be statted keeps its
 * entry, because a missing drive is not evidence that a file changed.
 */
type Store = Record<string, ThumbFailure>;

function mapKey(target: string): string {
  return path.resolve(target).toLowerCase();
}

let store: Store | null = null;

/** Read once per process. A corrupt or absent file is an empty log, never an error — this subsystem
 *  is not allowed to fail the thing it accelerates. */
function load(): Store {
  if (store !== null) return store;
  try {
    const raw = fs.readFileSync(failuresFile(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    store = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Store) : {};
  } catch {
    store = {};
  }
  return store;
}

let flushQueued = false;

/** WRITE THEN RENAME, same as the cache and for the same reason: a crash mid-write would otherwise
 *  leave truncated JSON that parses as garbage. Debounced, and every failure is swallowed — a log
 *  that cannot be written is a folder that re-tries a few files next launch, which is the exact
 *  behaviour we had before this file existed. */
function scheduleFlush(): void {
  if (flushQueued) return;
  flushQueued = true;
  setTimeout(() => {
    flushQueued = false;
    try {
      const s = load();
      const keys = Object.keys(s);
      if (keys.length > FAILURES_MAX) {
        // Oldest attempt first, same discipline as the cache sweep.
        keys
          .sort((a, b) => s[a].at - s[b].at)
          .slice(0, keys.length - FAILURES_MAX)
          .forEach((k) => delete s[k]);
      }
      const file = failuresFile();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + ".part";
      fs.writeFileSync(tmp, JSON.stringify(s), "utf8");
      try {
        fs.renameSync(tmp, file);
      } catch (e) {
        try { fs.unlinkSync(tmp); } catch { /* ignore */ }
        throw e;
      }
    } catch (e) {
      console.warn("[scan-notes] failure log write failed:", e);
    }
  }, FLUSH_DELAY_MS);
}

/**
 * ONE CALL PER FOLDER, read alongside the cache lookup — never one per tile.
 *
 * An entry whose stored key no longer matches the file on disk is dropped here rather than
 * returned: the file was edited or replaced, and it deserves a clean slate exactly as the cache
 * gives it one.
 */
export function getMany(targets: string[]): Record<string, ThumbFailure> {
  const s = load();
  const out: Record<string, ThumbFailure> = {};
  let dirty = false;
  for (const target of targets) {
    const mk = mapKey(target);
    const hit = s[mk];
    if (!hit) continue;
    try {
      const st = fs.statSync(target);
      if (keyFor(target, st.size, st.mtimeMs) !== hit.key) {
        delete s[mk]; // the file changed — forget everything we thought we knew about it
        dirty = true;
        continue;
      }
    } catch {
      // Cannot stat: the drive is gone. That is not evidence the file changed, so the entry stands.
    }
    out[target] = hit;
  }
  if (dirty) scheduleFlush();
  return out;
}

/** Record one failure, or bump an existing one. The attempt count is cumulative across sessions —
 *  it is what a later diagnostics view would want — while the retry budget itself is per folder
 *  open and lives in the renderer. Only `permanent` gates anything across sessions. */
export function record(target: string, reason: ThumbFailReason, detail: string): void {
  try {
    const s = load();
    const mk = mapKey(target);
    let key = "";
    try {
      const st = fs.statSync(target);
      key = keyFor(target, st.size, st.mtimeMs);
    } catch {
      // Unstattable — keep the previous key if we have one, so a drive coming back does not read as
      // a changed file and wipe a legitimate `permanent` verdict.
      key = s[mk]?.key ?? "";
    }
    const prior = s[mk];
    s[mk] = {
      key,
      name: path.basename(target),
      reason,
      detail: detail.slice(0, 300), // a demuxer message can be long; nothing needs more than this
      attempts: (prior && prior.key === key ? prior.attempts : 0) + 1,
      at: Date.now(),
    };
    scheduleFlush();
  } catch (e) {
    console.warn("[scan-notes] failure log record failed:", e);
  }
}

/** The user pressed Retry. An explicit human request outranks the classifier, which may be wrong —
 *  so this forgets everything about these paths, `permanent` included. */
export function clear(targets: string[]): void {
  try {
    const s = load();
    let dirty = false;
    for (const target of targets) {
      const mk = mapKey(target);
      if (s[mk]) { delete s[mk]; dirty = true; }
    }
    if (dirty) scheduleFlush();
  } catch (e) {
    console.warn("[scan-notes] failure log clear failed:", e);
  }
}
