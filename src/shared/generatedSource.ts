/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Which files Focal Registry itself writes and keeps rewriting, told from the path alone.
//
// The Scan Notes sync rebuilds two files per mirrored folder from the database on every run
// (syncDrive in electron/core/services/scan/notes.ts writes both names). A note opened from one of
// them is a copy of a mirror: anything typed into the file is gone at the next sync, so the editors
// label it. The path decides, so nothing has to be written into the note to mark it.
//
// Scan reports (SCAN-*.md) are left out on purpose. A finished report is written once and never
// rewritten, so "rewritten on every sync" would be untrue of it.
//
// No Node imports: the renderer and the tests both read this file.

// Lower case because Windows does not tell file names apart by letter case.
const REWRITTEN_ON_SYNC = ["folder-notes.md", "folder-report.md"];

/**
 * ponytail: the file name alone decides, in any folder. Ceiling: a file somebody made by hand with
 * one of these two names is labelled too. If that ever misleads, also require the Scan Notes tree
 * or the _FocalRegistry-Reports folder in the path.
 */
export function isGeneratedSource(sourcePath: string | null | undefined): boolean {
  if (!sourcePath) return false;
  const name = sourcePath.split(/[\\/]/).pop() ?? "";
  return REWRITTEN_ON_SYNC.includes(name.toLowerCase());
}
