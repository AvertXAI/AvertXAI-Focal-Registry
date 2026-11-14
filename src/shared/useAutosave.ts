/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// The autosave rule (autosave.ts) for a React notes screen. The screen keeps its own text and its
// own unsaved mark and shows them here on every render; this decides when to write, and tells the
// screen when the store holds exactly what it shows.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  /** Which screen this is ("vault-note"). Fixed for the life of the screen. */
  scope?: string;
  onSaved?: (info: SavedInfo<T>) => void;
  onError?: (message: string, key: string) => void;
}

export function useAutosave<T>(options: AutosaveOptions<T>): { flush: () => Promise<boolean>; discard: (key: string) => void } {
  // save, onSaved and onError are new closures on most renders; a write that lands later must call the newest.
  const latest = useRef(options);
  latest.current = options;

  type Landed = Omit<SavedInfo<T>, "current">;
  const [, redraw] = useState(0);
  const mounted = useRef(false);
  const landed = useRef<Landed[]>([]);

  const saver = useRef<Autosaver<T> | null>(null);
  if (saver.current === null) {
    saver.current = createAutosaver<T>({
      save: (key, value) => latest.current.save(key, value),
      same: (a, b) => (latest.current.same ?? Object.is)(a, b),
      scope: options.scope,
      onSaved: (info) => {
        if (!mounted.current) {
          latest.current.onSaved?.({ ...info, current: false });
          return;
        }
        // Whether the screen still shows what was written cannot be judged here. A keystroke
        // that React has not drawn yet is already on its way to the screen; judged against the
        // last draw, the write would count as current, the screen would clear its mark, and that
        // keystroke would never be written. So it is judged after the next draw.
        landed.current.push(info);
        redraw((n) => n + 1);
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
    const same = latest.current.same ?? Object.is;
    const before = seen.current;
    seen.current = note;
    if (note && !note.dirty) {
      // The screen says the store holds this text: it loaded the note, or its write just landed.
      auto.discard(note.key);
    } else if (note && !(before && before.key === note.key && before.dirty && same(before.value, note.value))) {
      // Only a change is handed over. A screen that never cleared its mark would otherwise be
      // written again on every render.
      auto.edited(note.key, note.value, label ?? "");
    }
    const done = landed.current;
    if (done.length === 0) return;
    landed.current = [];
    for (const info of done) {
      latest.current.onSaved?.({ ...info, current: note !== null && note.key === info.key && same(note.value, info.value) });
    }
  });

  useEffect(() => {
    mounted.current = true;
    // beforeunload cannot wait for an answer, so the writes are only sent.
    const onBye = (): void => auto.flushNow();
    window.addEventListener("beforeunload", onBye);
    return () => {
      mounted.current = false;
      window.removeEventListener("beforeunload", onBye);
      // Writes that landed and were waiting for a draw that will not come now.
      for (const info of landed.current.splice(0)) latest.current.onSaved?.({ ...info, current: false });
      void auto.flush().finally(() => auto.dispose());
    };
  }, [auto]);

  return auto;
}
