/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// What a TimeTracker notes box shows, set against what the database holds for it. The project pad
// and the Session notes box are uncontrolled textareas (NotesEditor.tsx keeps the browser's own
// undo that way), so "is this saved" and "may a re-read replace this text" cannot be read off the
// control. They are decided here, by pure functions the screen calls when text is typed, when a
// write lands and when the stored text is read again (tests/ttnotebox.test.ts). When to write is
// not decided here: that is the shared rule in src/shared/autosave.ts.

export interface NoteBox {
  /** The project id (pad) or the timer session id (Session notes), as the autosave rule keys it. */
  key: string;
  /** The text on screen. */
  text: string;
  /** The text the database is known to hold. The box is unsaved while the two differ. */
  saved: string;
  /** Part of the textarea's React key. It moves only when the text on screen has to be replaced,
      because a remount costs the caret, the focus and the undo history of someone mid-sentence. */
  seed: number;
}

export const noteBoxUnsaved = (box: NoteBox): boolean => box.text !== box.saved;

/** The box in the shape the autosave rule is shown on every render. */
export const noteBoxShown = (box: NoteBox | null): { key: string; value: string; dirty: boolean } | null =>
  box && { key: box.key, value: box.text, dirty: noteBoxUnsaved(box) };

/**
 * The stored text was read, for the first time or again. Unsaved typing outranks a re-read: the
 * text stays, and only `saved` moves, so the box goes on reading unsaved against what the database
 * really holds and the next write puts the typed text there.
 */
export function noteBoxLoaded(box: NoteBox | null, key: string, stored: string): NoteBox {
  if (!box || box.key !== key) return { key, text: stored, saved: stored, seed: 0 };
  // The same object back: a re-read that changed nothing must not re-render or remount anything.
  if (box.saved === stored) return box;
  if (noteBoxUnsaved(box)) return { ...box, saved: stored };
  return { key, text: stored, saved: stored, seed: box.seed + 1 };
}

/** Text was typed. A keystroke that leaves the text as it was (the seeded marker) changes nothing. */
export function noteBoxTyped(box: NoteBox | null, key: string, text: string): NoteBox | null {
  return box && box.key === key && box.text !== text ? { ...box, text } : box;
}

/**
 * A write landed. `saved` follows every write for this box, whether or not the screen still shows
 * what was sent: text typed during the write then still differs from it and reads unsaved, and
 * text taken back to the older saved text during the write is not mistaken for saved.
 */
export function noteBoxSaved(box: NoteBox | null, key: string, sent: string): NoteBox | null {
  return box && box.key === key && box.saved !== sent ? { ...box, saved: sent } : box;
}
