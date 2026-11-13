/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// The employee timer's arithmetic, in one place. The main process files hours with it and the
// Employees card ticks its clock with it, so the number on the Stop button and the number that
// lands in the ledger cannot drift apart. Pure, zero imports (the src/shared/ttNotes.ts precedent).

/** The three stored stamps the clock is made of. */
export interface PausableSession {
  started_at: string;
  /** Set while the clock is held; null while it runs. */
  paused_at: string | null;
  /** Whole seconds of pauses that have already ended. */
  paused_seconds: number;
}

/**
 * Milliseconds a session has counted by `atMs`: the time since it started, less every pause.
 * A paused session stops at its pause whatever `atMs` says, which is why a timer stopped while
 * paused files only the time up to the pause. Never negative, even if a clock moved backwards.
 */
export function workedMs(session: PausableSession, atMs: number): number {
  const end = session.paused_at ? Math.min(atMs, Date.parse(session.paused_at)) : atMs;
  return Math.max(0, end - Date.parse(session.started_at) - session.paused_seconds * 1000);
}
