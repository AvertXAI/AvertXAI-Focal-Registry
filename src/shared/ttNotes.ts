/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// TimeTracker note FORMAT — the single source of truth for markers, session-note packing, and the
// on-stop merge. Pure functions, zero imports: the renderer uses it for the editor's keyboard
// behaviour and the main process uses it for the merge, so the two can never disagree about what a
// block looks like (src/shared/scanErrors.ts precedent — renderer-safe, imported by both sides).
//
// STORAGE SHAPE of timetracker_active_sessions.note while a timer runs (Jason ruling 2 — newline
// packed into the EXISTING column, no new table, no migration):
//
//     [2026-08-01T17:10:22.481Z]
//     ∙ first quick note
//     ∙ second quick note
//
// Line 1 is the ISO stamp of the FIRST quick note (ruling 6: the live block header carries that
// time, not the timer's start). A session written before this feature — or by any other path —
// simply has no stamp line, and parse() treats the whole value as note text. Nothing migrates.

/** The default marker. A bare one resets a numbered/lettered run back to bullets (ruling 8). */
export const BULLET = "∙";

export interface SessionNotes {
  /** ISO stamp of the first quick note, or null for a legacy/plain note with no stamp line. */
  firstAt: string | null;
  /** One entry per line, markers included. Never contains the stamp line. */
  lines: string[];
}

const STAMP = /^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\]$/;

/** Read the packed column. Never throws; unknown shapes degrade to plain lines. */
export function parseSessionNotes(raw: string | null | undefined): SessionNotes {
  const text = (raw ?? "").replace(/\r\n/g, "\n");
  if (text.trim() === "") return { firstAt: null, lines: [] };
  const all = text.split("\n");
  const m = STAMP.exec(all[0].trim());
  if (m) return { firstAt: m[1], lines: all.slice(1).filter((l) => l.trim() !== "") };
  return { firstAt: null, lines: all.filter((l) => l.trim() !== "") };
}

/** Write the packed column. Empty lines collapse to null so the column stays NULL, not "". */
export function packSessionNotes(notes: SessionNotes): string | null {
  const lines = notes.lines.filter((l) => l.trim() !== "");
  if (lines.length === 0) return null;
  const stamp = notes.firstAt ? `[${notes.firstAt}]\n` : "";
  return `${stamp}${lines.join("\n")}`;
}

/**
 * Append one captured quick note. The marker continues whatever the previous line used, so a
 * numbered session keeps numbering (ruling 8). `atIso` stamps the FIRST note only — later notes
 * never move it, and individual notes carry no time of their own (ruling 6).
 */
export function appendQuickNote(raw: string | null | undefined, text: string, atIso: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "") return raw ?? null;
  const current = parseSessionNotes(raw);
  const marker = current.lines.length === 0 ? `${BULLET} ` : nextMarker(current.lines[current.lines.length - 1]);
  return packSessionNotes({
    firstAt: current.firstAt ?? atIso,
    lines: [...current.lines, `${marker}${trimmed}`],
  });
}

// ---- markers -------------------------------------------------------------------------------

/** Opening markers a user may type to switch a list's style (ruling 8). Captures: value, gap, punctuation. */
const MARKER = /^([0-9]+|[A-Za-z]+)(\s?)([.\-])(\s*)/;

/** Spreadsheet-style letter increment: A→B, Z→AA, AZ→BA. Case is preserved. */
function nextLetters(seq: string): string {
  const upper = seq === seq.toUpperCase();
  const chars = seq.toUpperCase().split("");
  let i = chars.length - 1;
  for (;;) {
    if (chars[i] !== "Z") {
      chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
      break;
    }
    chars[i] = "A";
    if (i === 0) {
      chars.unshift("A");
      break;
    }
    i -= 1;
  }
  const out = chars.join("");
  return upper ? out : out.toLowerCase();
}

/**
 * The marker the NEXT line should open with, given the line the caret is leaving.
 * Bullets stay bullets; numbers and letters count on; anything else starts a fresh bullet.
 * The user's own spacing around the punctuation is preserved ("1 -" continues as "2 -").
 */
export function nextMarker(previousLine: string): string {
  const line = previousLine ?? "";
  if (line.trimStart().startsWith(BULLET)) return `${BULLET} `;
  const m = MARKER.exec(line.trimStart());
  if (!m) return `${BULLET} `;
  const [, value, gap, punct] = m;
  // Letters only qualify as a marker when they are a plain A-Z run — "Note." must not become "Notf."
  if (/^[0-9]+$/.test(value)) return `${Number(value) + 1}${gap}${punct} `;
  if (/^[A-Za-z]{1,3}$/.test(value)) return `${nextLetters(value)}${gap}${punct} `;
  return `${BULLET} `;
}

// ---- dated blocks --------------------------------------------------------------------------

/** "Aug 01, 2026 · 5:10 PM" — month-first everywhere a human reads it (canon). */
export function formatBlockHeader(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
  const day = String(d.getDate()).padStart(2, "0");
  let h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${month} ${day}, ${d.getFullYear()} · ${h}:${String(d.getMinutes()).padStart(2, "0")} ${ampm}`;
}
