/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// TimeTracker error classifier — turns whatever a main-side handler threw into ONE plain sentence a
// photographer can act on, plus a likely-cause hint. Mirrors src/shared/scanErrors.ts: code-based
// classification (stable SQLite tokens), never a hand-curated string catalog, and THE RAW TEXT IS
// NEVER REPLACED — callers keep it and send it to the console. A database string must never reach
// a dialog body: "SqliteError: no such table: timetracker_projects" tells the user nothing they can
// do, and reads as if the app is broken beyond repair.
//
// PASS-THROUGH IS DELIBERATE: the service layer already writes human sentences for the things a user
// actually hits — tier caps ("Cap reached: the Free tier allows 3 projects…") and validator refusals
// ("A note explaining the adjustment is required"). Those are better than anything this file could
// invent, so anything carrying no technical marker is returned untouched.

export interface TimeTrackerErrorExplanation {
  /** One plain sentence. Never contains a SQL token, a channel name, or a stack frame. */
  plain: string;
  /** Likely cause / what to do next. Empty when the message already says everything. */
  hint: string;
}

/** Markers that prove a message came from the database or the IPC plumbing, not from a person. */
const TECHNICAL = /sqlite|no such table|no such column|constraint failed|database is locked|SQLITE_|Error invoking remote method|\bat [A-Za-z]+\.[A-Za-z]+ \(/i;

export function explainTimeTrackerError(raw: string): TimeTrackerErrorExplanation {
  const text = (raw ?? "").trim();
  if (text === "") {
    return { plain: "Something went wrong saving this project.", hint: "Try again; if it keeps happening, restart Focal Registry." };
  }

  // The first-run-session schema gap (fixed 08-01-2026 in ttCtx, kept here because a missing table
  // must NEVER show a user a SQL string — and because the same shape can return from any new module).
  if (/no such table/i.test(text)) {
    return {
      plain: "TimeTracker's storage isn't ready in this session yet.",
      hint: "Close Focal Registry completely and open it again — this clears itself on the next start.",
    };
  }
  if (/no such column/i.test(text)) {
    return {
      plain: "TimeTracker's storage is a version behind what this screen expects.",
      hint: "Close Focal Registry completely and open it again so the update can finish.",
    };
  }
  if (/UNIQUE constraint failed/i.test(text)) {
    return { plain: "That name is already taken.", hint: "Pick a different project or group name and try again." };
  }
  if (/NOT NULL constraint failed/i.test(text)) {
    return { plain: "Something required was left blank.", hint: "Check the project name and client, then try again." };
  }
  if (/FOREIGN KEY constraint failed/i.test(text)) {
    return { plain: "The client or group this points at no longer exists.", hint: "Pick an existing group, or create a new one, and try again." };
  }
  if (/CHECK constraint failed/i.test(text)) {
    return { plain: "One of the values isn't allowed here.", hint: "Check the rate and amount fields — they must be numbers of zero or more." };
  }
  if (/database is locked|SQLITE_BUSY/i.test(text)) {
    return { plain: "The database was busy and couldn't finish the save.", hint: "Wait a moment and try again — nothing was changed." };
  }
  if (/readonly|SQLITE_READONLY/i.test(text)) {
    return { plain: "The database is read-only, so nothing could be saved.", hint: "Check that the app's data folder isn't on a locked or full drive." };
  }
  if (/disk|SQLITE_FULL|SQLITE_IOERR/i.test(text)) {
    return { plain: "The drive holding your data wouldn't accept the write.", hint: "Check free space on the system drive, then try again." };
  }
  if (/no active org/i.test(text)) {
    return { plain: "No workspace is open.", hint: "Restart Focal Registry; if the setup screen appears, finish it first." };
  }

  // Not technical → the service already said it in plain words (tier caps, validators). Pass through.
  if (!TECHNICAL.test(text)) return { plain: text, hint: "" };

  // Technical but unrecognised: say so honestly rather than paraphrasing something we can't read.
  return {
    plain: "Couldn't save the project.",
    hint: "Try again; if it keeps happening, restart Focal Registry. The technical detail is in the developer console.",
  };
}
