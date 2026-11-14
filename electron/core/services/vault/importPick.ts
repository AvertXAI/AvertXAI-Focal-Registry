// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: The one-shot list of files an open dialog just handed out (VA-02).
//
//              readImportText gives a file's text back to the page, so the path it is asked for
//              cannot be taken on trust: a page that could name any path could read any file this
//              Windows user can. The dialog handler records what the operating system returned,
//              and a read is allowed only for a path on that record, once. Every new pick replaces
//              the list — a cancelled dialog included — so an old pick cannot be read later.
//
//              Document and password imports come back to a pick more than once (a folder is
//              listed and then read, an export is previewed and then imported), so they use the
//              scope further down: the same record, not spent by a read, and able to hold folders.
//
//              No Electron import, so the rule is tested without a window
//              (tests/importpick.test.ts, tests/importscope.test.ts).
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/vault/importPick.ts
//------------------------------------------------------------
import path from "node:path";

/** One key per place on disk: `..` resolved, and case folded on Windows, where two spellings that
    differ only in case are the same file. */
function keyOf(p: string): string {
  const full = path.resolve(p);
  return process.platform === "win32" ? full.toLowerCase() : full;
}

/** One list per importer, so a pick made in one module cannot be read through another's channel. */
export function createImportPick() {
  // Keyed by the normalised path. The value is the path exactly as the dialog gave it, because
  // that is the one handed on to be read — never the page's own spelling of it.
  let picked = new Map<string, string>();
  return {
    /** Records the dialog's answer and passes it through unchanged for the page. */
    remember(paths: string[]): string[] {
      picked = new Map(paths.map((p): [string, string] => [keyOf(p), p]));
      return paths;
    },
    /** The dialog's own path for the file the page asks to read. Refused unless it was just picked. */
    take(filePath: unknown): string {
      if (typeof filePath !== "string" || filePath === "") throw new Error("No file was chosen.");
      const real = picked.get(keyOf(filePath));
      if (real === undefined) throw new Error("That file was not chosen in the file dialog. Choose it again.");
      picked = new Map(); // spent: the next read needs a new pick
      return real;
    },
  };
}

/**
 * The files and folders the dialogs handed out to one importer, for imports that come back to a
 * pick more than once: a folder is listed and then read file by file, a password export is
 * previewed and then imported, and a wrong archive passphrase is tried again. So a read does not
 * spend a pick here, and a cancelled dialog does not cost the picks already on the page.
 *
 * What ends a pick is the caller's to say, and each importer says it: clear() when the import is
 * done or the page starts over, and walkRoots() dropping every folder the page has stopped
 * listing. Nothing here outlives the process.
 */
export function createImportScope() {
  // Keyed like the one-shot list above; the value is the dialog's own spelling, the one handed on.
  const files = new Map<string, string>();
  const folders = new Map<string, string>();
  const named = (value: unknown, what: string): string => {
    if (typeof value !== "string" || value === "") throw new Error(`No ${what} was chosen.`);
    return value;
  };
  const keep = (into: Map<string, string>, paths: string[]): string[] => {
    for (const p of paths) into.set(keyOf(p), p);
    return paths;
  };
  /** The dialog's own path for a file the page names. Refused unless that file was picked. */
  const file = (filePath: unknown): string => {
    const real = files.get(keyOf(named(filePath, "file")));
    if (real === undefined) throw new Error("That file was not chosen in the file dialog. Choose it again.");
    return real;
  };
  /** The dialog's own path for a folder the page names. A folder inside a picked one is refused:
      the page lists and records only the folders it was handed. */
  const folder = (dir: unknown): string => {
    const real = folders.get(keyOf(named(dir, "folder")));
    if (real === undefined) throw new Error("That folder was not chosen in the folder dialog. Choose it again.");
    return real;
  };
  /** A file to import: one that was picked, or one inside a folder that was picked. */
  const doc = (filePath: unknown): string => {
    const asked = named(filePath, "file");
    const key = keyOf(asked);
    const picked = files.get(key);
    if (picked !== undefined) return picked;
    for (const root of folders.keys()) {
      // The separator is part of the test: without it "notes-old" would pass as inside "notes".
      if (key.startsWith(root.endsWith(path.sep) ? root : root + path.sep)) return path.resolve(asked);
    }
    throw new Error("That file was not chosen, and it is not inside a folder that was chosen. Choose it again.");
  };
  return {
    /** Both record the dialog's answer and pass it through unchanged for the page. */
    addFiles: (paths: string[]): string[] => keep(files, paths),
    addFolders: (paths: string[]): string[] => keep(folders, paths),
    file,
    folder,
    doc,
    /** The folders to list. The page sends its whole current list every time, so any picked folder
        missing from it has been dropped on the page and stops being readable here. A refusal
        changes nothing. */
    walkRoots(roots: unknown): string[] {
      const listed = (Array.isArray(roots) ? roots : []).map(folder);
      folders.clear();
      return keep(folders, listed);
    },
    clear(): void {
      files.clear();
      folders.clear();
    },
  };
}
