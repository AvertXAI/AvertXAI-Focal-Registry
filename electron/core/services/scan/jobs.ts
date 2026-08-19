// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Cancellation for in-flight media work. One monotonic token; anything older than the
//              newest is abandoned at the earliest safe point.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/scan/jobs.ts
//------------------------------------------------------------
//
// WHY THIS EXISTS. The renderer's `live` flags only suppressed the STATE WRITE — the inter-process
// call ran to completion regardless, reading the file, decoding it and encoding a JPEG for a folder
// nobody was looking at any more. Clicking through five folders queued five folders' worth of work
// and served the last one late. The recon found this and it is a problem TODAY, before any
// background warm-up multiplies it by folder size.
//
// THE MODEL IS DELIBERATELY ONE COUNTER, NOT A SET. Only one folder is ever on screen, so "current"
// is a single value and everything below it is dead. A registry of live tokens would let two folders
// be current at once, which is not a state this module can be in — and a cancellation scheme that
// can disagree with itself is worse than none.
//
// PARTIAL WORK IS STILL BANKED. A thumbnail that was already generated when its folder went stale is
// CORRECT — it is simply no longer needed on screen — so it is written to the cache before the job
// is dropped. Throwing it away would mean regenerating it the next time that folder is opened, which
// is the opposite of the point.

/** The newest token issued. Anything below it is stale by definition. */
let latest = 0;

/** Counters for the proof the work order asks for — a number, not an assurance. Reset on demand so
 *  a measurement run reads a clean window rather than the whole session. */
let started = 0;
let abandoned = 0;
let completed = 0;

/**
 * Issue a new token and thereby cancel everything older.
 *
 * Called on folder change, on module change and on teardown. The renderer does not have to know
 * what is outstanding — bumping the counter is the cancellation.
 */
export function nextToken(): number {
  latest += 1;
  return latest;
}

/** A job's token is stale the moment a newer one has been issued. Token 0 means "no token given" —
 *  treated as never stale, so an older caller that has not been taught tokens still works. */
export function stale(token: unknown): boolean {
  const t = Number(token);
  return Number.isFinite(t) && t > 0 && t < latest;
}

export function markStarted(): void {
  started += 1;
}

/** Two outcomes, counted separately, because the useful number is how much work was thrown away. */
export function markDone(wasAbandoned: boolean): void {
  if (wasAbandoned) abandoned += 1;
  else completed += 1;
}

export function stats(): { started: number; abandoned: number; completed: number; latest: number } {
  return { started, abandoned, completed, latest };
}

export function resetStats(): void {
  started = 0;
  abandoned = 0;
  completed = 0;
}
