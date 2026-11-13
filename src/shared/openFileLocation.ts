/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Where the open note lives: a module-to-shell signal for the top bar.
//
// Same shape as navigate.ts beside this file, and for the same reason: a module is mounted with no
// props, so it cannot hand the shell anything directly. MindMerge publishes; App listens and passes
// the value to TopBar. It describes what is on screen right now, so it lives in React state only
// and is never persisted.

export const OPEN_FILE_LOCATION_EVENT = "focal:open-file-location";

export interface OpenFileLocation {
  /** The open note. Main resolves the file from this; the renderer never sends a path back. */
  uuid: string;
  /** The file the note was imported from; null for a note written in the app. */
  sourcePath: string | null;
}

/** Publish the open note's location; pass null when no note is open. ALWAYS publish null on unmount. */
export function publishOpenFileLocation(location: OpenFileLocation | null): void {
  window.dispatchEvent(
    new CustomEvent<OpenFileLocation | null>(OPEN_FILE_LOCATION_EVENT, { detail: location })
  );
}
