// Focal Registry — the quit guard.
// Description: holds a quit while work is running, collects one answer per line, and only then lets
//              the quit go ahead. Pure: the caller hands in how to list work, act on it, show the
//              toast and finish the quit, so every rule here is tested headless.
import type { WorkAction, WorkLine } from "./registry";

export interface GuardLine extends WorkLine {
  answer: WorkAction | null;
}

export interface GuardState {
  lines: GuardLine[];
  /** Every line is answered and the answers are carried out: only jobs still finishing are left. */
  waiting: boolean;
  /** What asked for the quit, so the toast can say it. */
  reason: string;
}

export interface GuardDeps {
  running: () => WorkLine[];
  act: (id: string, action: WorkAction) => void;
  /** Shows, refreshes (state) or hides (null) the toast. */
  publish: (state: GuardState | null) => void;
  /** Starts a repeating check and returns how to stop it. */
  every: (fn: () => void, ms: number) => () => void;
}

export interface QuitGuard {
  /**
   * A quit was asked for. False: nothing is running, go ahead. True: the quit is held, and
   * `proceed` runs later, once every line is answered and every job has ended.
   */
  request(reason: string, proceed: () => void): boolean;
  answer(id: string, action: WorkAction): void;
  /** Keeps the app open. Whatever is still running keeps running. */
  cancel(): void;
  state(): GuardState | null;
}

export function createQuitGuard(deps: GuardDeps): QuitGuard {
  let held: { reason: string; proceed: () => void } | null = null;
  const answers = new Map<string, WorkAction>();
  const acted = new Set<string>();
  /** An answer of his was carried out during this hold, so the quit is his to have once work ends. */
  let answered = false;
  let stopChecking: (() => void) | null = null;

  const snapshot = (lines: WorkLine[]): GuardState => ({
    lines: lines.map((line) => ({ ...line, answer: answers.get(line.id) ?? null })),
    waiting: lines.length > 0 && lines.every((line) => acted.has(line.id)),
    reason: held?.reason ?? "",
  });

  function close(): void {
    stopChecking?.();
    stopChecking = null;
    held = null;
    answers.clear();
    acted.clear();
    answered = false;
    deps.publish(null);
  }

  function check(): void {
    if (!held) return;
    // A copy: acting on a line can take it off its source's own list while this loop is on it.
    const lines = [...deps.running()];
    // A line that went away and comes back is new work and needs its own answer: a timer he
    // paused here and then resumed while a job finishes. Remembered as acted, it would be listed
    // with no buttons and the quit would wait on it for ever.
    for (const id of [...answers.keys(), ...acted]) {
      if (lines.some((line) => line.id === id)) continue;
      answers.delete(id);
      acted.delete(id);
    }
    if (lines.length === 0) {
      // Work that ended by itself before he answered is not an answer: the app stays open, and
      // he quits again if he still wants to. Only a quit he answered for goes ahead.
      const { proceed } = held;
      const go = answered;
      close();
      if (go) proceed();
      return;
    }
    // Nothing is carried out until the last line has its answer, so Cancel can still keep it all.
    if (lines.every((line) => answers.has(line.id))) {
      for (const line of lines) {
        if (acted.has(line.id)) continue;
        acted.add(line.id);
        answered = true;
        // A line that cannot be acted on stays listed, so the quit keeps waiting and he can Cancel.
        try {
          deps.act(line.id, answers.get(line.id) as WorkAction);
        } catch (err) {
          console.error("[quit guard] could not act on", line.id, err);
        }
      }
    }
    deps.publish(snapshot(lines));
  }

  return {
    request(reason, proceed) {
      if (deps.running().length === 0) {
        // This quit goes ahead now, so an earlier one still held has nothing left to wait for.
        // Left open, its next check would start a second quit on top of this one.
        if (held) close();
        return false;
      }
      const fresh = held === null;
      held = { reason, proceed };
      if (fresh) stopChecking = deps.every(check, 1000);
      check();
      return true;
    },
    answer(id, action) {
      if (!held || acted.has(id)) return;
      const line = deps.running().find((l) => l.id === id);
      if (!line || !line.actions.includes(action)) return;
      answers.set(id, action);
      check();
    },
    cancel() {
      if (held) close();
    },
    state() {
      return held ? snapshot(deps.running()) : null;
    },
  };
}

/** A job (or a timer at a Windows shutdown) that was stopped before it finished. */
export interface CutShortJob {
  text: string;
  next: string;
  at: string;
  /** Written while Windows was ending the session. */
  forced?: boolean;
}

/** The rows to remember for lines that are being cut short. */
export function cutShortRows(lines: WorkLine[], at: string, forced: boolean, note = ""): CutShortJob[] {
  return lines.map((line) => ({ text: line.text + note, next: line.next ?? "", at, ...(forced ? { forced } : {}) }));
}

/**
 * What the next launch lists. Rows written while Windows was ending the session already describe
 * the jobs that boot then finds still marked as running, so those are not listed twice.
 */
export function jobsToReport(saved: CutShortJob[], foundAtBoot: CutShortJob[]): CutShortJob[] {
  return saved.some((job) => job.forced) ? saved : [...saved, ...foundAtBoot];
}
