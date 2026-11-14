/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// The autosave rule (autosave.ts) for a React notes screen. The screen keeps its own text and its
// own unsaved mark and shows them here on every render; this decides when to write, and tells the
// screen when the store holds exactly what it shows.
import { useEffect, useLayoutEffect, useRef } from "react";
import { createAutosaver, type Autosaver } from "./autosave";

export interface SavedInfo<T> {
  key: string;
  /** Exactly what was sent. */
  value: T;
  /** What save() resolved with. */
  result: unknown;
  /** The screen still shows this note and this text: only then may it clear its unsaved mark. */
  current: boolean;
  /** The pause wrote it, not a flush. */
  idle: boolean;
}

export interface AutosaveOptions<T> {
  /** What is on screen now, or null when nothing is open. */
  note: { key: string; value: T; dirty: boolean } | null;
  /** Writes one note. Rejects when the write failed. */
  save: (key: string, value: T) => Promise<unknown>;
  same?: (a: T, b: T) => boolean;
  /** The note's title. Shown only by the quit toast, when its write fails. */
  label?: string;
  onSaved?: (info: SavedInfo<T>) => void;
  onError?: (message: string, key: string) => void;
}

export function useAutosave<T>(options: AutosaveOptions<T>): { flush: () => Promise<boolean>; discard: (key: string) => void } {
  // save, onSaved and onError are new closures on most renders; a write that lands later must call the newest.
  const latest = useRef(options);
  latest.current = options;

  const saver = useRef<Autosaver<T> | null>(null);
  if (saver.current === null) {
    const same = (a: T, b: T): boolean => (latest.current.same ?? Object.is)(a, b);
    saver.current = createAutosaver<T>({
      save: (key, value) => latest.current.save(key, value),
      same,
      onSaved: ({ key, value, result, idle }) => {
        const shown = latest.current.note;
        const current = shown !== null && shown.key === key && same(shown.value, value);
        latest.current.onSaved?.({ key, value, result, current, idle });
      },
      onError: (message, key) => latest.current.onError?.(message, key),
    });
  }
  const auto = saver.current;

  // A layout effect, not a passive one: a click that switches notes right after a keystroke must
  // find that keystroke already handed over, and passive effects can run after the click.
  const seen = useRef<AutosaveOptions<T>["note"]>(null);
  useLayoutEffect(() => {
    const { note, label } = latest.current;
    const before = seen.current;
    seen.current = note;
    if (!note) return;
    if (!note.dirty) {
      // The screen says the store holds this text: it loaded the note, or its write just landed.
      auto.discard(note.key);
      return;
    }
    // Only a change is handed over. A screen that never cleared its mark would otherwise be
    // written again on every render.
    const same = latest.current.same ?? Object.is;
    if (before && before.key === note.key && before.dirty && same(before.value, note.value)) return;
    auto.edited(note.key, note.value, label ?? "");
  });

  useEffect(() => {
    // beforeunload cannot wait for an answer, so the writes are only sent.
    const onBye = (): void => auto.flushNow();
    window.addEventListener("beforeunload", onBye);
    return () => {
      window.removeEventListener("beforeunload", onBye);
      void auto.flush().finally(() => auto.dispose());
    };
  }, [auto]);

  return auto;
}
