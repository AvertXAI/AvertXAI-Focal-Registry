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
//              No Electron import, so the rule is tested without a window
//              (tests/importpick.test.ts).
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/vault/importPick.ts
//------------------------------------------------------------
import path from "node:path";

/** One list per importer, so a pick made in one module cannot be read through another's channel. */
export function createImportPick() {
  // Keyed by the normalised path. The value is the path exactly as the dialog gave it, because
  // that is the one handed on to be read — never the page's own spelling of it.
  let picked = new Map<string, string>();
  return {
    /** Records the dialog's answer and passes it through unchanged for the page. */
    remember(paths: string[]): string[] {
      picked = new Map(paths.map((p): [string, string] => [path.resolve(p), p]));
      return paths;
    },
    /** The dialog's own path for the file the page asks to read. Refused unless it was just picked. */
    take(filePath: unknown): string {
      if (typeof filePath !== "string" || filePath === "") throw new Error("No file was chosen.");
      const real = picked.get(path.resolve(filePath));
      if (real === undefined) throw new Error("That file was not chosen in the file dialog. Choose it again.");
      picked = new Map(); // spent: the next read needs a new pick
      return real;
    },
  };
}
