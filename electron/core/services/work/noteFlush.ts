// Focal Registry — unsaved notes at quit.
// Description: the page tells main how many notes hold text the store does not have yet. A quit
//              waits while the page writes them, and a note that could not be written is listed by
//              the quit guard with Retry and Quit anyway. No Electron import: tested headless.
import type { WorkLine, WorkSource } from "./registry";

export interface NoteFlushDeps {
  /**
   * Asks the page to write every unsaved note. Resolves with the names of the ones it could not
   * write, and rejects when the page did not answer.
   */
  ask: () => Promise<string[]>;
  /**
   * After `ask` rejected: whether the page at least took the request. A page that did not is not
   * running its script, so it cannot show the quit toast either, and a line about its notes
   * would hold the quit with nobody able to answer it.
   */
  heard: () => boolean;
}

export interface NoteFlush {
  /** The page's count of notes with unsaved text. */
  report(unsaved: number): void;
  /** A quit has to wait for the page to write its notes first. */
  mustFlush(): boolean;
  /** One round of writing. Notes that could not be written become lines for the quit guard. */
  flush(): Promise<void>;
  /** The quit was cancelled, and the lines belonged to it. */
  clear(): void;
  source: WorkSource;
}

export function createNoteFlush(deps: NoteFlushDeps): NoteFlush {
  let unsaved = 0;
  let lines: WorkLine[] = [];
  let round = 0;
  // He chose to quit without the notes that could not be written, so the quit that follows must
  // not ask the page again and list them a second time.
  let waived = false;
  let running: Promise<void> | null = null;

  function flush(): Promise<void> {
    running ??= deps
      .ask()
      .then(
        (names) => names.map((name) => (name ? `Note not saved: ${name}` : "Note not saved")),
        () => (deps.heard() ? ["Notes may not be saved: the window did not answer."] : [])
      )
      .then((texts) => {
        round += 1;
        // A new id each round: a note that failed again is a new question, and the guard only
        // asks again about a line it has not seen.
        lines = texts.map((text, i) => ({ id: `note:${round}:${i}`, kind: "note", text, actions: ["retry", "quitAnyway"] }));
        // The page's own count can arrive after its answer; a clean round is the newer fact.
        if (texts.length === 0) unsaved = 0;
        running = null;
      });
    return running;
  }

  return {
    report(count) {
      unsaved = count;
      // What he waived was the notes as they were. Text typed since is a new question.
      waived = false;
      if (count === 0) lines = [];
    },
    mustFlush: () => unsaved > 0 && !waived,
    flush,
    clear() {
      lines = [];
      waived = false;
    },
    source: {
      list: () => lines,
      act(id, action) {
        if (action === "retry") {
          void flush();
          return;
        }
        if (action !== "quitAnyway") return;
        lines = lines.filter((line) => line.id !== id);
        if (lines.length === 0) waived = true;
      },
    },
  };
}
