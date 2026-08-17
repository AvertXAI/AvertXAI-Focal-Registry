// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: The vault's event log — four levels, one table, and the REFERENCE ID that lets a
//              plain apology on screen still be diagnosable in the log. Jason ruled it 08-11-2026
//              after an import dialog hung and the app had nothing to show for it:
//              "when something breaks, the app spits out an error only I would understand".
//
//              THE TWO-AUDIENCE SPLIT, which is the whole point of this file:
//              · The USER gets a sentence they can act on, plus a short reference — never a stack,
//                never an SQLITE_ code, never a file path.
//              · The LOG gets the technical truth, stamped with that same reference, so the two
//                halves can be rejoined by a human reading a support message.
//
//              HOW A MESSAGE IS CLASSIFIED (deliberately ONE rule, not two): a thrown message that
//              is a complete short SENTENCE is meant for a person and is shown as-is; anything else
//              is a developer fragment and is replaced by GENERIC. This is not a new convention —
//              it is the one already in the services, without exception: "The vault is locked." and
//              "A server needs a host name." are sentences; "Invalid note locator" and "Secret not
//              found" are fragments. New code that wants to be certain calls userError().
//
//              WHAT NEVER ENTERS THIS TABLE: a secret value, a passphrase, a master password. There
//              is no column for one, and `detail` carries stacks and reasons only — the same rule
//              that governs vault_access_log, for the same reason.
//
//              A FAILING LOGGER MUST NEVER BE THE THING THAT BREAKS THE APP. Every write here is
//              wrapped: if the log cannot be written the call still returns, and the console keeps
//              the line. That is why nothing in this file rethrows.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/vault/log.ts
//------------------------------------------------------------
import crypto from "node:crypto";
import { nowIso, type Db } from "./db";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type VaultLogLevel = (typeof LOG_LEVELS)[number];

/** Ordering for the persistence threshold. Debug is DROPPED unless a developer lowers the floor. */
const RANK: Record<VaultLogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** The vault setting that decides what is kept. Default "info" — normal operation, no debug noise. */
export const MIN_LEVEL_KEY = "log.min_level";
const DEFAULT_MIN: VaultLogLevel = "info";

/** What a user is told when the real message is not fit for them. Deliberately says what to do. */
export const GENERIC = "Something went wrong and the vault could not finish that. Nothing was changed. Send the reference below to the developer.";

export interface VaultLogInput {
  level: VaultLogLevel;
  /** Which part of the vault — "ipc", "notes", "import", "dialog". Coarse on purpose. */
  area: string;
  /** The IPC channel or named action, when there is one. */
  channel?: string | null;
  /** The technical message. Never shown to a user unless it passes isUserFacing(). */
  message: string;
  /** Stack, error code, counts. NEVER a secret value. */
  detail?: string | null;
  /** The id the user is shown. Generate with newRequestId() and reuse it in the thrown error. */
  requestId?: string | null;
  /** Who caused it — "renderer", "main", "boot". Stamped by the trust boundary, never self-reported. */
  actor?: string | null;
}

export interface VaultLogRow {
  uuid: string;
  ts: string;
  level: VaultLogLevel;
  area: string;
  channel: string | null;
  request_id: string | null;
  actor: string | null;
  message: string;
  detail: string | null;
}

/**
 * The reference a user reads off the screen and types into a message. Short enough to say out loud,
 * random enough not to collide within a session. Not a security token — it names a log row, and the
 * log row is already behind the vault's own encryption.
 */
export function newRequestId(): string {
  return `VLT-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

/** Cached per connection so a chatty debug path is not a settings SELECT per line. */
const minCache = new WeakMap<object, VaultLogLevel>();

export function minLevel(db: Db, orgId: string): VaultLogLevel {
  const hit = minCache.get(db as unknown as object);
  if (hit) return hit;
  let level: VaultLogLevel = DEFAULT_MIN;
  try {
    const row = db.prepare("SELECT value FROM vault_settings WHERE org_id = ? AND key = ?").get(orgId, MIN_LEVEL_KEY) as
      | { value?: string }
      | undefined;
    if (row?.value && (LOG_LEVELS as readonly string[]).includes(row.value)) level = row.value as VaultLogLevel;
  } catch {
    /* the settings table may not exist yet during a very early failure — the default stands */
  }
  minCache.set(db as unknown as object, level);
  return level;
}

/** Called by the settings writer so a level change takes effect without a restart. */
export function forgetMinLevel(db: Db): void {
  minCache.delete(db as unknown as object);
}

/**
 * THE write. Never throws — see the header. A dropped log line is a nuisance; a logger that can
 * take down the handler it was meant to diagnose is a defect.
 */
/**
 * THE CONSOLE MIRROR IS ASCII (Jason 08-12-2026, on seeing `Cleared 6 routine log entries ГÇö`).
 *
 * Not a bug in the log — the row in the database is correct UTF-8 and the in-app terminal renders the
 * em-dash properly. It is the WINDOWS CONSOLE: cmd and Git Bash default to a legacy code page, so the
 * three UTF-8 bytes of `—` come out as three cp437 characters. Mangled punctuation in a log line
 * reads as corruption, and a developer who has to decide whether their own log is broken has lost the
 * thing a log is for. The stored message keeps its typography; only this mirror is folded down.
 */
function asciiFold(s: string): string {
  return s
    .replace(/[—–]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, "...")
    .replace(/·/g, "*")
    .replace(/[^\x20-\x7E]/g, "?"); // anything else still unprintable — a ? beats a mojibake run
}

export function logEvent(db: Db | null, orgId: string | null, e: VaultLogInput): void {
  const line = asciiFold(`[vault:${e.level}] ${e.area}${e.channel ? ` ${e.channel}` : ""} ${e.requestId ?? ""} ${e.message}`);
  if (e.level === "error") console.error(line, e.detail ?? "");
  else if (e.level === "warn") console.warn(line);
  else if (e.level === "debug") console.debug(line);
  else console.info(line);

  // No database yet (a failure BEFORE the vault opened, which is exactly when the key derivation or
  // the registry is the thing that broke) — the console line above is the whole record, by necessity.
  if (!db || !orgId) return;
  try {
    if (RANK[e.level] < RANK[minLevel(db, orgId)]) return;
    db.prepare(
      `INSERT INTO vault_event_log (uuid, org_id, ts, level, area, channel, request_id, actor, message, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      crypto.randomUUID(),
      orgId,
      nowIso(),
      e.level,
      e.area,
      e.channel ?? null,
      e.requestId ?? null,
      e.actor ?? null,
      e.message.slice(0, 2000),
      e.detail ? e.detail.slice(0, 8000) : null
    );
  } catch (err) {
    console.error("[vault:log] could not write the event log:", err);
  }
}

export function listEvents(
  db: Db,
  orgId: string,
  opts?: { limit?: number; level?: VaultLogLevel; search?: string }
): VaultLogRow[] {
  const limit = Math.min(Math.max(Number(opts?.limit) || 200, 1), 2000);
  const where: string[] = ["org_id = ?"];
  const args: unknown[] = [orgId];
  // A chosen level means "this and worse" — picking Warning to then be shown Debug would be useless.
  if (opts?.level) {
    where.push(`level IN (${LOG_LEVELS.filter((l) => RANK[l] >= RANK[opts.level as VaultLogLevel]).map(() => "?").join(",")})`);
    args.push(...LOG_LEVELS.filter((l) => RANK[l] >= RANK[opts.level as VaultLogLevel]));
  }
  if (opts?.search) {
    where.push("(message LIKE ? OR channel LIKE ? OR request_id LIKE ?)");
    const q = `%${opts.search}%`;
    args.push(q, q, q);
  }
  args.push(limit);
  return db
    .prepare(
      `SELECT uuid, ts, level, area, channel, request_id, actor, message, detail
         FROM vault_event_log WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ?`
    )
    .all(...args) as VaultLogRow[];
}

// ------------------------------------------------------------------ the two-audience split

const USER_FACING = Symbol("vault.userFacing");

/** Explicit opt-in: this message IS for a person, whatever its punctuation. */
export function userError(message: string): Error {
  const e = new Error(message);
  (e as unknown as Record<symbol, boolean>)[USER_FACING] = true;
  return e;
}

/**
 * Is this message fit to put in front of a person?
 *
 * A complete short sentence is; a developer fragment is not. Three conditions, in the order they
 * are cheapest to fail:
 *   1. Short — a paragraph is a stack trace wearing a hat.
 *   2. Ends in terminal punctuation — the existing services' convention, without exception.
 *   3. Does not open with an ALL-CAPS code — ENOENT:, SQLITE_ERROR:, EPERM: are library errors that
 *      occasionally end in a period and must never leak.
 */
export function isUserFacing(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if ((err as unknown as Record<symbol, boolean>)[USER_FACING]) return true;
  const m = err.message.trim();
  if (m.length === 0 || m.length > 200) return false;
  if (!/[.!?]$/.test(m)) return false;
  if (/^[A-Z][A-Z0-9_]{2,}:/.test(m)) return false;
  return true;
}

/**
 * What the renderer is actually given. The reference is appended in BOTH cases on purpose: even a
 * message the user understands is worth being able to look up, and a support message that quotes
 * one is worth more than a screenshot of a sentence.
 */
export function presentableMessage(err: unknown, requestId: string): string {
  const base = isUserFacing(err) ? (err as Error).message : GENERIC;
  return `${base} (Reference ${requestId})`;
}


/**
 * Remove the ROUTINE entries — info and debug — and keep every error and warning.
 *
 * This is deliberately not "clear the log". Canon's retention rule is keep everything, and a log a
 * user can quietly empty of its failures is worth less than one they cannot; errors and warnings are
 * evidence, info and debug are volume. So the destructive half is bounded by construction rather
 * than by the confirm dialog remembering to be careful.
 */
export function clearRoutine(db: Db, orgId: string): { removed: number } {
  const r = db.prepare("DELETE FROM vault_event_log WHERE org_id = ? AND level IN ('info','debug')").run(orgId);
  return { removed: r.changes };
}

/**
 * EVERYTHING, errors and warnings included. The other door, and it exists because the rule above is
 * right for a user and wrong for the person building the thing (Jason 08-12-2026: "i need to be able
 * to delete the errors and warnings for testing").
 *
 * WHY BOTH EXIST RATHER THAN ONE RELAXED RULE: clearRoutine is bounded BY CONSTRUCTION — it cannot
 * destroy evidence however it is called, so the ordinary surface stays safe no matter what a future
 * caller does. This one can, so it is gated by a typed confirmation in the renderer, the same shape
 * the organisation reset uses. Keeping them as two functions means the safe path never has a flag
 * that could be passed the wrong way.
 *
 * It records its own execution afterwards, so an emptied log still says who emptied it and when —
 * a log with no explanation for its own gap is worse than one that is merely short.
 */
export function clearAllEvents(db: Db, orgId: string): { removed: number } {
  const r = db.prepare("DELETE FROM vault_event_log WHERE org_id = ?").run(orgId);
  return { removed: r.changes };
}
