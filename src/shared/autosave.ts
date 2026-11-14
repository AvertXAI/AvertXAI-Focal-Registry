/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// The one autosave rule every notes screen follows (Jason's ruling, 11-14-2026): text is written
// one second after typing stops, and a note counts as saved only while the store holds exactly
// what is on screen. Pure: the screen hands in how to write, so the rule is tested with no window
// (tests/autosave.test.ts). The React side is useAutosave.ts.

export const AUTOSAVE_MS = 1000;

export interface AutosaverDeps<T> {
  /** Writes one note. Rejects when the write failed. */
  save: (key: string, value: T) => Promise<unknown>;
  same: (a: T, b: T) => boolean;
  onSaved?: (info: { key: string; value: T; result: unknown; idle: boolean }) => void;
  onError?: (message: string, key: string) => void;
  /** Which screen's notes these are, so two screens that number their notes alike are told apart. */
  scope?: string;
  /** Tests hand in their own clock. */
  timers?: { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void };
}

export interface Autosaver<T> {
  /** The text of `key` changed on screen. `label` is what the quit toast calls it if it cannot be written. */
  edited(key: string, value: T, label?: string): void;
  /** Writes everything unsaved now. False when a write failed. */
  flush(): Promise<boolean>;
  /** For a page that is going away and cannot wait: the writes are sent, not awaited. */
  flushNow(): void;
  /** Forgets unsaved text on purpose: the note was deleted, or the screen reloaded it from the store. */
  discard(key: string): void;
  unsaved(): number;
  dispose(): void;
}

interface Registered {
  unsaved(): number;
  settle(): Promise<string[]>;
  superseded(scope: string, key: string): void;
}

const live = new Set<Registered>();
let report: ((unsaved: number) => void) | null = null;
let reported = -1;

function countChanged(): void {
  let total = 0;
  for (const saver of live) total += saver.unsaved();
  if (total === reported) return;
  reported = total;
  report?.(total);
}

/**
 * The shell is told how many notes hold text the store does not have, so a quit can wait for
 * them. Told once straight away: after a page reload main still holds the old page's count.
 */
export function onUnsavedCount(fn: ((unsaved: number) => void) | null): void {
  report = fn;
  reported = -1;
  countChanged();
}

/** Writes every screen's unsaved text. Resolves with the names of the notes that could not be written. */
export async function flushAllNotes(): Promise<string[]> {
  return (await Promise.all([...live].map((saver) => saver.settle()))).flat();
}

export function createAutosaver<T>(deps: AutosaverDeps<T>): Autosaver<T> {
  const timers = deps.timers ?? {
    set: (fn: () => void, ms: number): unknown => setTimeout(fn, ms),
    clear: (handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  // More than one note is held only around a switch of notes or after a write that failed.
  const held = new Map<string, { value: T; label: string }>();
  const scope = deps.scope ?? "";
  let timer: unknown = null;
  let edits = 0;
  let disposed = false;
  // One write at a time, in the order asked: a slow write can never land on top of a newer one.
  let tail: Promise<unknown> = Promise.resolve();

  function stopTimer(): void {
    if (timer !== null) timers.clear(timer);
    timer = null;
  }

  function settled(): void {
    countChanged();
    // A screen that closed with a write still failing stays listed, so the quit can still name it.
    if (disposed && held.size === 0) live.delete(self);
  }

  async function write(key: string, idle: boolean): Promise<boolean> {
    const entry = held.get(key);
    if (!entry) return true;
    const sent = entry.value;
    let result: unknown;
    try {
      result = await deps.save(key, sent);
    } catch (err) {
      deps.onError?.(err instanceof Error ? err.message : String(err), key);
      return false;
    }
    // Text typed while this write was on its way is not in the store. It stays held, so the note
    // is not called saved and its own pause writes it.
    const now = held.get(key);
    if (now && deps.same(now.value, sent)) held.delete(key);
    settled();
    deps.onSaved?.({ key, value: sent, result, idle });
    return true;
  }

  function pass(idle: boolean, stamp: number): Promise<boolean> {
    const run = async (): Promise<boolean> => {
      // He typed again after this pause ran out, so a newer pause is counting and it will write.
      if (idle && stamp !== edits) return true;
      let ok = true;
      for (const key of [...held.keys()]) ok = (await write(key, idle)) && ok;
      return ok;
    };
    // A screen's own callback that throws must not stop later writes, or look like a saved note.
    const done = tail.then(run).catch(() => false);
    tail = done;
    return done;
  }

  const self: Autosaver<T> & Registered = {
    edited(key, value, label = "") {
      const entry = held.get(key);
      if (entry && deps.same(entry.value, value)) {
        // A re-render, not typing: restarting the pause here would put the write off for ever.
        entry.label = label;
        return;
      }
      held.set(key, { value, label });
      // React's development mode unmounts and remounts a screen once: the remounted screen is
      // the same saver, and it has to be listed again or a quit would not wait for it.
      disposed = false;
      live.add(self);
      for (const other of live) if (other !== self) other.superseded(scope, key);
      edits += 1;
      countChanged();
      stopTimer();
      const stamp = edits;
      timer = timers.set(() => {
        timer = null;
        void pass(true, stamp);
      }, AUTOSAVE_MS);
    },
    flush() {
      stopTimer();
      return pass(false, edits);
    },
    flushNow() {
      for (const [key, entry] of held) {
        try {
          void Promise.resolve(deps.save(key, entry.value)).catch(() => undefined);
        } catch {
          /* the page is going: there is nobody left to tell */
        }
      }
    },
    discard(key) {
      if (held.delete(key)) settled();
    },
    unsaved: () => held.size,
    superseded(otherScope, key) {
      // A screen that closed while a write was failing still holds that text for the quit. Once
      // the note is typed in again on a reopened screen, the older text must not be written over
      // the newer at quit.
      if (disposed && otherScope === scope) self.discard(key);
    },
    async settle() {
      // Text typed while a write was on its way needs one more pass. Three is plenty for someone
      // who is quitting, and it cannot loop for ever on a screen that keeps changing its text.
      for (let i = 0; i < 3 && held.size > 0; i++) if (!(await self.flush())) break;
      return [...held.values()].map((entry) => entry.label);
    },
    dispose() {
      disposed = true;
      stopTimer();
      if (held.size === 0) live.delete(self);
    },
  };
  live.add(self);
  return self;
}
