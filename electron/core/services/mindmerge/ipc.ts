// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: MindMerge AUTHORED-DOCUMENT IPC registration — the mindmerge:*Doc* handlers that
//              resolve the active org and the module's own PLAIN SQLite connection, then call the
//              note services with (db, orgId, …). These handlers are a COPY of the vault's
//              secured-notes handlers (electron/core/services/vault/ipc.ts), channel-renamed per
//              reports/PHASE3-CONTRACT.md and with every `gated()` / lock check DROPPED: MindMerge
//              has no master password and no lock state, so there is nothing here for a gate to
//              protect. Every validation, every message and every returned count is the vault's.
//
//              THE INGEST CHANNELS ARE NOT HERE. mindmerge:ensure/list/get/search/listQuarantined/
//              pickWatchFolder/rescan/progress stay in electron/core/ipc.ts where they have always
//              lived. These are the AUTHORED side — a document a person is writing, not a markdown
//              file found on disk — and they land BESIDE the ingest set, never instead of it.
//
//              Module-local safeHandle, for the same reason vault/ipc.ts carries one: a cross-import
//              of core/ipc.ts's registrar would make core/ipc.ts and this file circular.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/mindmerge/ipc.ts
//------------------------------------------------------------
import { BrowserWindow, app, clipboard, dialog, ipcMain } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import { getDb } from "../db";
import { getActiveOrg } from "../db/registry";
import { enforceFeature } from "../licensing";
import { openMindMergeDb, type Db } from "./db";
import * as notes from "./notes";
import * as noteFolders from "./noteFolders";
import * as attachments from "./attachments";
import { openAttachmentsDb } from "./attachDb";
import { deriveAttachKey, getOrCreateAttachSecret } from "./attachCrypto";
// READ-ONLY, LOCAL, AND NOT VAULT DATA. codeThemes.ts opens the machine's Visual Studio Code
// extensions folder and the user's own settings file — it imports nothing from the vault database
// and touches no secret (see its header). Copying the file into this directory would have produced
// a second implementation of the same disk walk, so the handler below calls the existing one.
import { findVsCodeThemes, readVsCodeTheme } from "../vault/codeThemes";
// SAME CLASS OF REUSE as codeThemes above. sources.ts imports only electron's app, node:fs and
// node:path — no vault database, no secret. FILE_FILTERS is a static dialog-filter table and the
// two walk functions read directory NAMES and stats, never contents. Copying the file here would
// have produced a second implementation of the same disk walk, so the import-machinery handlers
// below call the existing one.
import { FILE_FILTERS, statPickedFiles, walkForDocs } from "../vault/sources";

/**
 * Module-local copy of core/ipc.ts's resilient registrar (it is module-local there; a cross-import
 * would make core/ipc.ts and this file circular). Same semantics: one failed registration never
 * silently kills the rest, and the failure is logged LOUDLY with its channel name.
 */
function safeHandle(channel: string, listener: Parameters<typeof ipcMain.handle>[1]): void {
  try {
    ipcMain.handle(channel, listener);
  } catch (e) {
    console.error(`[ipc] FAILED to register handler '${channel}':`, e);
  }
}

/**
 * THE PARENT WINDOW FOR NATIVE DIALOGS, and it is not optional on Windows.
 *
 * An unparented common-file-dialog is owned by nothing, so the shell's preview pane and its
 * namespace extensions run with no window to pump their messages — which is how you get the
 * "(Not Responding)" title bar Jason hit on the Infrastructure import (08-11-2026) with no way out
 * but killing the app. Passing the requesting window also makes the dialog properly modal, so a
 * second one cannot be opened behind the first.
 */
function parentOf(event: { sender: Electron.WebContents }): Electron.BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow();
}

/** Every native OPEN in this file goes through here, so no future handler can forget the parent. */
function showOpen(
  event: { sender: Electron.WebContents },
  opts: Electron.OpenDialogOptions
): Promise<Electron.OpenDialogReturnValue> {
  const win = parentOf(event);
  // The unparented overload stays as the fallback ONLY for the case where the window has already
  // gone (a dialog asked for during teardown) — never as the normal path.
  return win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts);
}

// Every log row born on this bridge says so. The page cannot claim to be anyone else.
const RENDERER_CALLER = "renderer";

type DocLogLevel = "debug" | "info" | "warn" | "error";

/**
 * THE DESTRUCTIVE-OPERATION RECORD, and why it is a console line rather than a table row.
 *
 * The vault handlers this file copies write to `vault_event_log` through vault/log.ts — doctrine
 * since Jason 08-12-2026 ("no where is this being tracked as it should be"). MindMerge has NO event
 * log: there is no log table in mindmerge/db.ts and this lane does not own that file, so inventing
 * one here would be exactly the redesign the phase contract forbids. Dropping the lines silently
 * would be worse — it would restore the gap Jason closed.
 *
 * So the CALL SHAPE and every MESSAGE STRING are kept byte-for-byte, routed to the console. When a
 * MindMerge event log lands, this one function changes and no handler moves.
 */
function logDocEvent(
  _db: Db | null,
  _orgId: string | null,
  entry: { level: DocLogLevel; area: string; channel?: string | null; requestId?: string; actor: string; message: string; detail?: string | null }
): void {
  const line = `[mindmerge:${entry.area}]${entry.channel ? ` ${entry.channel}` : ""}${entry.requestId ? ` ${entry.requestId}` : ""} ${entry.message}`;
  const detail = entry.detail ? `\n  ${entry.detail}` : "";
  if (entry.level === "error") console.error(line + detail);
  else if (entry.level === "warn") console.warn(line + detail);
  else console.log(line + detail);
}

/** Same id shape as the vault's newRequestId, MM-prefixed so a reference cannot be mistaken. */
function newRequestId(): string {
  return `MM-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

/**
 * A document's title for the log line, read BEFORE it is destroyed. Never throws: a logging helper
 * that can fail the operation it was added to observe is a defect, and by the time this is wrong the
 * document is being deleted anyway — a record saying "(untitled)" beats no record and beats a crash.
 */
function titleOf(db: Db, orgId: string, uuid: unknown): string {
  try {
    const row = db.prepare("SELECT title FROM mindmerge_docs WHERE org_id = ? AND uuid = ?").get(orgId, String(uuid)) as
      | { title?: string }
      | undefined;
    return row?.title?.trim() || "(untitled)";
  } catch {
    return "(untitled)";
  }
}

/** Same idea for a folder — read the name while the row still exists. Never throws. */
function folderNameOf(db: Db, orgId: string, id: unknown): string {
  try {
    const row = db.prepare("SELECT name FROM mindmerge_doc_folders WHERE org_id = ? AND id = ?").get(orgId, Number(id)) as
      | { name?: string }
      | undefined;
    return row?.name?.trim() || "(unnamed)";
  } catch {
    return "(unnamed)";
  }
}

/**
 * THE CONTEXT — resolved exactly the way `ensureMindMerge()` in electron/core/ipc.ts resolves it:
 * the active org from the registry, and this module's own database under userData. SYNCHRONOUS,
 * unlike the vault's, because there is no key to derive — the file is PLAIN (see db.ts).
 *
 * `openMindMergeDb` keeps a name->handle registry keyed `mindmerge:<orgId>`, so this returns the
 * SAME handle the ingest engine already holds; it never opens a second file beside the real one.
 *
 * THE ORG ID IS NEVER ACCEPTED FROM THE RENDERER. A page that could name its own org could read
 * another tenant's documents, so the value only ever comes from here.
 *
 * THE ENTITLEMENT GATE LIVES HERE, and here only (Jason 08-21-2026: "make sure to keep some sort of
 * entitlement on that"). Every one of these handlers already funnels through this one function, so
 * one line refuses all of them — twenty-six copies of the same check would be twenty-six chances to
 * forget one. It is the MAIN-SIDE half of the two-layer gate; MindMergeModule hiding the Documents
 * tab is the renderer half, and a hidden control is not a control.
 *
 * The licence lives in the SHARED org DB's app_settings, which is `getDb()` — not the MindMerge
 * file opened below. Same source resolveTier() serves TimeTracker's caps and the Employees cap, so
 * one key governs everything (the whole point of moving licensing to core on 08-06).
 */
function mindMergeCtx(): { db: Db; orgId: string } {
  const org = getActiveOrg();
  if (!org) throw new Error("MindMerge: no active org");
  enforceFeature(getDb(), "mindmergeBrain");
  return { db: openMindMergeDb(org.org_id, app.getPath("userData")), orgId: org.org_id };
}

export function registerMindMergeDocsIpc(): void {
  // ---- Authored documents. Bodies are content, not credentials — see notes.ts for why reads are
  // ---- not access-logged and why lists carry an excerpt, never the body.
  safeHandle("mindmerge:listDocs", async (_e, kind: unknown, archived: unknown, folderId: unknown, limit: unknown, offset: unknown) => {
    const { db, orgId } = mindMergeCtx();
    // folderId: undefined = every folder · null = Unfiled · number = that folder. The renderer used
    // to do this cut in JavaScript over every row; doing it here is the whole performance fix.
    const folder = folderId === null ? null : typeof folderId === "number" ? folderId : undefined;
    return notes.listNotes(
      db, orgId,
      typeof kind === "string" && kind ? kind : undefined,
      archived === true, folder,
      typeof limit === "number" ? limit : 60,
      typeof offset === "number" ? offset : 0
    );
  });
  /** Search titles and bodies main-side, capped. Replaces holding the whole corpus in the renderer. */
  safeHandle("mindmerge:searchDocs", async (_e, q: unknown, limit: unknown) => {
    const { db, orgId } = mindMergeCtx();
    return notes.searchNotes(db, orgId, q, typeof limit === "number" ? limit : 40);
  });
  safeHandle("mindmerge:restoreDoc", async (_e, uuid: unknown) => {
    const { db, orgId } = mindMergeCtx();
    const r = notes.restoreNote(db, orgId, uuid);
    // Logged for the same reason archive is: a shelf move is only auditable if BOTH directions are
    // recorded. An archive with no matching restore reads as a note that never came back.
    logDocEvent(db, orgId, {
      level: "info", area: "notes", channel: "mindmerge:restoreDoc", actor: RENDERER_CALLER,
      message: `Restored from the archive: ${r.title}`,
    });
    return r;
  });
  // Hard delete — refused unless the note is already archived (see notes.destroyNote).
  //
  // The TITLE is read BEFORE the row goes, because after the delete there is nothing left to name it
  // with and "deleted note 0f3a-…" is not a record anybody can use. Levels are deliberate: a hard
  // delete is `warn` because it cannot be undone, an archive is `info` because it can.
  safeHandle("mindmerge:destroyDoc", async (_e, uuid: unknown) => {
    const { db, orgId } = mindMergeCtx();
    const title = titleOf(db, orgId, uuid);
    notes.destroyNote(db, orgId, uuid);
    logDocEvent(db, orgId, {
      level: "warn", area: "notes", channel: "mindmerge:destroyDoc", actor: RENDERER_CALLER,
      message: `Deleted for good: ${title}`,
    });
    return { ok: true };
  });
  safeHandle("mindmerge:getDoc", async (_e, uuid: unknown) => {
    const { db, orgId } = mindMergeCtx();
    return notes.getNote(db, orgId, uuid);
  });
  safeHandle("mindmerge:createDoc", async (_e, input: unknown) => {
    const { db, orgId } = mindMergeCtx();
    return notes.createNote(db, orgId, (input ?? {}) as never);
  });
  safeHandle("mindmerge:updateDoc", async (_e, uuid: unknown, patch: unknown) => {
    const { db, orgId } = mindMergeCtx();
    return notes.updateNote(db, orgId, uuid, (patch ?? {}) as never);
  });
  safeHandle("mindmerge:archiveDoc", async (_e, uuid: unknown) => {
    const { db, orgId } = mindMergeCtx();
    const title = titleOf(db, orgId, uuid);
    notes.archiveNote(db, orgId, uuid);
    logDocEvent(db, orgId, {
      level: "info", area: "notes", channel: "mindmerge:archiveDoc", actor: RENDERER_CALLER,
      message: `Archived: ${title}`,
    });
    return { ok: true };
  });

  // ---- Document folder tree (Jason ruled the shape 08-11-2026: separate tree, one folder per
  // ---- note, shared by Notes/Runbooks/Snippets). A container is not its contents — deleting a
  // ---- folder never deletes a note; see noteFolders.ts.
  safeHandle("mindmerge:listDocFolders", async () => {
    const { db, orgId } = mindMergeCtx();
    return {
      folders: noteFolders.listNoteFolders(db, orgId),
      counts: noteFolders.noteFolderCounts(db, orgId),
      unfiled: noteFolders.unfiledNoteCount(db, orgId),
    };
  });
  safeHandle("mindmerge:createDocFolder", async (_e, name: unknown, parentId: unknown) => {
    const { db, orgId } = mindMergeCtx();
    return noteFolders.createNoteFolder(db, orgId, name, parentId);
  });
  safeHandle("mindmerge:renameDocFolder", async (_e, id: unknown, name: unknown) => {
    const { db, orgId } = mindMergeCtx();
    return noteFolders.renameNoteFolder(db, orgId, id, name);
  });
  safeHandle("mindmerge:moveDocFolder", async (_e, id: unknown, parentId: unknown) => {
    const { db, orgId } = mindMergeCtx();
    return noteFolders.moveNoteFolder(db, orgId, id, parentId);
  });
  /** What a delete WOULD take. Pure — the confirm is built from this. */
  safeHandle("mindmerge:docFolderSubtree", async (_e, id: unknown) => {
    const { db, orgId } = mindMergeCtx();
    return noteFolders.noteFolderSubtree(db, orgId, id);
  });
  /** Keeps every note, unfiles the whole subtree, leaves the folders standing. */
  safeHandle("mindmerge:emptyDocFolder", async (_e, id: unknown) => {
    const { db, orgId } = mindMergeCtx();
    const name = folderNameOf(db, orgId, id);
    const r = noteFolders.emptyNoteFolder(db, orgId, id);
    logDocEvent(db, orgId, {
      level: "info", area: "notes", channel: "mindmerge:emptyDocFolder", actor: RENDERER_CALLER,
      message: `Emptied folder "${name}" — ${r.movedNotes} note${r.movedNotes === 1 ? "" : "s"} moved to Unfiled, nothing deleted`,
    });
    return r;
  });
  /**
   * Deletes the folder, every folder beneath it, and every note in any of them.
   *
   * WARN, not info: this is the one note path with no way back, and the log is the only place the
   * count survives after the confirm dialog closes.
   */
  safeHandle("mindmerge:deleteDocFolder", async (_e, id: unknown) => {
    const { db, orgId } = mindMergeCtx();
    const name = folderNameOf(db, orgId, id);
    const r = noteFolders.deleteNoteFolder(db, orgId, id);
    logDocEvent(db, orgId, {
      level: "warn", area: "notes", channel: "mindmerge:deleteDocFolder", actor: RENDERER_CALLER,
      message: `Deleted folder "${name}" — ${r.deletedNotes} note${r.deletedNotes === 1 ? "" : "s"} and ${r.deletedFolders} folder${r.deletedFolders === 1 ? "" : "s"} erased`,
      detail: "Permanent. The notes were not archived.",
    });
    return r;
  });
  /** The third door: every note to the Archived shelf, the folders removed. Restorable. */
  safeHandle("mindmerge:archiveDocFolder", async (_e, id: unknown) => {
    const { db, orgId } = mindMergeCtx();
    const name = folderNameOf(db, orgId, id);
    const r = noteFolders.archiveNoteFolder(db, orgId, id);
    logDocEvent(db, orgId, {
      level: "info", area: "notes", channel: "mindmerge:archiveDocFolder", actor: RENDERER_CALLER,
      message: `Archived folder "${name}" — ${r.archivedNotes} note${r.archivedNotes === 1 ? "" : "s"} moved to the Archived shelf, ${r.deletedFolders} folder${r.deletedFolders === 1 ? "" : "s"} removed`,
    });
    return r;
  });
  /** Clear every note and folder. Confirm-gated in the UI; the count is said out loud first. */
  safeHandle("mindmerge:purgeDocs", async () => {
    const { db, orgId } = mindMergeCtx();
    const r = notes.purgeAllNotes(db, orgId);
    // The vault also writes a secrets.logAccess row here. There is no secret store and no access log
    // in MindMerge — the module holds documents, not credentials — so that call has no counterpart.
    logDocEvent(db, orgId, {
      level: "warn", area: "notes", channel: "mindmerge:purgeDocs", actor: RENDERER_CALLER,
      message: `Purged ${r.notes} notes and ${r.folders} folders`,
    });
    return r;
  });
  safeHandle("mindmerge:setDocFolder", async (_e, uuid: unknown, folderId: unknown) => {
    const { db, orgId } = mindMergeCtx();
    const title = titleOf(db, orgId, uuid);
    noteFolders.setNoteFolder(db, orgId, uuid, folderId);
    // A move is not destructive, but it is the operation most likely to be reported as "my note
    // disappeared" — so where it went is worth a line.
    logDocEvent(db, orgId, {
      level: "info", area: "notes", channel: "mindmerge:setDocFolder", actor: RENDERER_CALLER,
      message: `Filed "${title}" into ${folderId == null || folderId === "" ? "Unfiled" : `"${folderNameOf(db, orgId, folderId)}"`}`,
    });
    return { ok: true };
  });
  /** Pure — what folders an import WOULD create. Writes nothing; drives the preview. */
  // The one authored-document channel that does NOT go through mindMergeCtx(), because it is PURE —
  // it opens no database and only rewrites strings the renderer already holds. It still takes the
  // entitlement check directly: nothing leaks either way, but a feature gate with one documented
  // exception stops being a feature gate, and the next pure handler would inherit the exemption.
  safeHandle("mindmerge:previewDocFolderPaths", async (_e, rels: unknown) => {
    enforceFeature(getDb(), "mindmergeBrain");
    return noteFolders.previewFolderPaths(rels);
  });

  // ---- Folder import (Phase 4). Choose folders → walk for .md/.txt/.pdf → review → import.
  // The dialog is main-side and multi-select; the renderer never names a path it was not given.
  // Like previewDocFolderPaths above, these open no MindMerge db — so no mindMergeCtx() — but the
  // entitlement check comes first on every one (the two-layer gate has no exemptions).
  safeHandle("mindmerge:chooseFolders", async (e) => {
    enforceFeature(getDb(), "mindmergeBrain");
    const r = await showOpen(e, {
      title: "Choose one or more folders",
      properties: ["openDirectory", "multiSelections"],
    });
    return r.canceled ? [] : r.filePaths;
  });
  // FILES — one old .md you want to keep, not a directory of them. Filters are per target; see
  // FILE_FILTERS. Only the "notes" target is meaningful here (the vault's infra/repos surfaces do
  // not cross into MindMerge), and "notes" is already the default when no target is given.
  safeHandle("mindmerge:chooseFiles", async (e, target: unknown) => {
    enforceFeature(getDb(), "mindmergeBrain");
    const key = typeof target === "string" && FILE_FILTERS[target] ? target : "notes";
    const r = await showOpen(e, {
      title: "Choose one or more files",
      properties: ["openFile", "multiSelections"],
      filters: FILE_FILTERS[key],
    });
    return r.canceled ? [] : r.filePaths;
  });
  /**
   * Read a chosen file's TEXT so the renderer can run it through a parser and show a review table
   * before anything is written (Jason 08-11-2026 — imports are destination-first now).
   *
   * WHY THIS IS SAFE TO HAND THE RENDERER when importDocs deliberately reads main-side: this returns
   * the contents of a file the USER just picked in a native dialog, and it is text they are about to
   * be shown on screen anyway. It is not a credential, and no path is accepted that the renderer
   * invented — see the guard. Capped so a mispicked 2 GB file cannot take the window down.
   */
  safeHandle("mindmerge:readImportText", async (_e, filePath: unknown) => {
    enforceFeature(getDb(), "mindmergeBrain");
    const p = typeof filePath === "string" ? filePath : "";
    if (!p) throw new Error("No file was chosen.");
    const stat = fs.statSync(p);
    const MAX = 8 * 1024 * 1024;
    if (stat.size > MAX) throw new Error("That file is too large to read here — it is over 8 megabytes.");
    return fs.readFileSync(p, "utf8");
  });
  /** Stat hand-picked files. No extension filtering — the dialog narrowed it and the user chose. */
  safeHandle("mindmerge:statFiles", async (_e, paths: unknown) => {
    enforceFeature(getDb(), "mindmergeBrain");
    return statPickedFiles(paths);
  });
  // Names and stat only — WRITES NOTHING, reads no file contents. The review list comes from this.
  safeHandle("mindmerge:walkFolders", async (_e, roots: unknown) => {
    enforceFeature(getDb(), "mindmergeBrain");
    // The vault reads its ceiling from a per-org vault setting here ("import.max_files", default
    // 25,000 — a SETTING because the old hardcoded 2,000 refused a real import). This handler opens
    // no db (see above) and no MindMerge counterpart of that setting has been ruled, so the
    // walker's own default — the same 25,000 — applies. When a setting lands, thread it here.
    return walkForDocs(roots);
  });

  // THE write. Reads each chosen file main-side (a .pdf is stored as a stub note pending a text
  // extractor — flagged in the body rather than pretending it imported clean).
  safeHandle("mindmerge:importDocs", async (_e, files: unknown, opts: unknown) => {
    const { db, orgId } = mindMergeCtx();
    const list = Array.isArray(files) ? files : [];
    /**
     * NO MORE SILENT BLANKS, NO MORE SILENT CUTS (Jason 08-16-2026: blank notes from his _source
     * import, a rare truncated one, and "no error logs for that side"). The old catches stored
     * `""` — a note row that exists, opens empty, and left no trace anywhere. Now:
     *   · a file that cannot be read imports as a PLACEHOLDER naming the actual error — visible
     *     in the note, retryable by re-importing (the duplicate guard fills placeholder rows);
     *   · a file a cap genuinely cuts carries a TRUNCATION NOTICE at the top, above the fence;
     *   · both are counted here and logged after the run, files named.
     */
    const readFailures: string[] = [];
    const truncated: string[] = [];
    const FENCE_CAP = 200_000;
    const failText = (p: string, rel: string, err: unknown): string => {
      const reason = err instanceof Error ? err.message : String(err);
      readFailures.push(`${rel}: ${reason}`);
      return `> [import failure] This file could not be read when it was imported — this note is a placeholder, not the file's contents. Re-import the folder to retry it.\n>\n> File: ${p}\n> Reason: ${reason}\n`;
    };
    const capNote = (rel: string, total: number, kept: number): string => {
      truncated.push(`${rel}: ${total.toLocaleString()} characters, ${kept.toLocaleString()} kept`);
      return `> [truncated at import] This file is ${total.toLocaleString()} characters; only the first ${kept.toLocaleString()} were stored.\n\n`;
    };
    const loaded = list.map((f) => {
      const rec = f as { path?: unknown; name?: unknown; rel?: unknown; ext?: unknown; birthtimeMs?: unknown; mtimeMs?: unknown };
      const p = typeof rec?.path === "string" ? rec.path : "";
      const ext = typeof rec?.ext === "string" ? rec.ext : "";
      const rel = typeof rec?.rel === "string" ? rec.rel : (typeof rec?.name === "string" ? rec.name : p);
      let text = "";
      if (ext === ".pdf") {
        text = `> This PDF was imported as a placeholder — MindMerge has no PDF text extractor yet.\n>\n> File: ${p}\n`;
      } else if (ext === ".xlsx" || ext === ".xls" || ext === ".xlsm") {
        // A spreadsheet needs a parser this product does not carry, and adding one is a dependency
        // decision (§2.10), not a quiet import. Say so in the note rather than storing binary noise.
        text = `> This spreadsheet was imported as a placeholder — MindMerge has no spreadsheet reader.\n>\n> Export it as CSV and import that for the real contents.\n>\n> File: ${p}\n`;
      } else if (ext === ".doc" || ext === ".docx") {
        // .doc is a binary OLE container and .docx is zipped XML — neither is readable without a
        // parser. Same rule as the spreadsheets: say so, keep the row, never store binary noise.
        text = `> This Word document was imported as a placeholder — MindMerge has no Word reader.\n>\n> Save it as Markdown or plain text and import that for the real contents.\n>\n> File: ${p}\n`;
      } else if (ext === ".jsonl") {
        // LINE-delimited JSON: each line is its own document. Pretty-printing would destroy the one
        // property that defines the format, so it is kept verbatim in a fence.
        try {
          const raw = fs.readFileSync(p, "utf8");
          const head = raw.length > FENCE_CAP ? capNote(rel, raw.length, FENCE_CAP) : "";
          text = head + "```jsonl\n" + raw.slice(0, FENCE_CAP) + "\n```\n";
        } catch (err) { text = failText(p, rel, err); }
      } else if (ext === ".json") {
        // Pretty-print so a dumped config is readable as a note instead of one enormous line.
        try {
          const rawText = fs.readFileSync(p, "utf8");
          const pretty = JSON.stringify(JSON.parse(rawText), null, 2);
          const head = pretty.length > FENCE_CAP ? capNote(rel, pretty.length, FENCE_CAP) : "";
          text = head + "```json\n" + pretty.slice(0, FENCE_CAP) + "\n```\n";
        } catch {
          // Not valid JSON (or unreadable): keep it verbatim if it can be read at all.
          try {
            const raw = fs.readFileSync(p, "utf8");
            const head = raw.length > FENCE_CAP ? capNote(rel, raw.length, FENCE_CAP) : "";
            text = head + "```\n" + raw.slice(0, FENCE_CAP) + "\n```\n";
          } catch (err2) { text = failText(p, rel, err2); }
        }
      } else if (ext === ".csv" || ext === ".zone") {
        // Kept verbatim in a fence — a zone file or CSV is exact text, and reflowing it as prose
        // would destroy the alignment that makes it readable.
        try {
          const raw = fs.readFileSync(p, "utf8");
          const head = raw.length > FENCE_CAP ? capNote(rel, raw.length, FENCE_CAP) : "";
          text = head + "```\n" + raw.slice(0, FENCE_CAP) + "\n```\n";
        } catch (err) { text = failText(p, rel, err); }
      } else {
        try {
          const raw = fs.readFileSync(p, "utf8");
          // createNote hard-caps at one megabyte — when that will genuinely cut, say so AT THE
          // TOP, where the notice survives the cut.
          const head = raw.length > 1_000_000 ? capNote(rel, raw.length, 1_000_000) : "";
          text = head + raw;
        } catch (err) { text = failText(p, rel, err); }
      }
      // `path` now travels too — it is what the duplicate guard matches on. It never reaches the
      // renderer; this object is built main-side and consumed main-side.
      return { name: rec?.name, rel: rec?.rel, path: p, text, birthtimeMs: rec?.birthtimeMs, mtimeMs: rec?.mtimeMs };
    });
    const r = notes.importDocs(db, orgId, loaded, (opts ?? {}) as never);
    // (The vault's secrets.logAccess("import", …) row has no counterpart here — see purgeDocs.)
    // THE FULL ARITHMETIC, in the log, where it can be checked after the modal is gone. This is the
    // line that answers "the import said 2,083 and the folder says 2,078" without anyone having to
    // reproduce the import to see the numbers again.
    logDocEvent(db, orgId, {
      level: "info", area: "import", channel: "mindmerge:importDocs", actor: RENDERER_CALLER,
      message: `Imported ${r.created} of ${r.scanned} files — ${r.skipped} already in MindMerge, ${r.repaired} blank rows filled, ${r.failed} could not be stored`,
      detail: [
        `Already here: ${r.skippedFiled} filed, ${r.skippedUnfiled} unfiled, ${r.skippedArchived} archived.`,
        r.warned > 0 ? `${r.warned} had unreadable frontmatter and were imported anyway.` : null,
      ].filter(Boolean).join(" "),
    });
    // The failures and the cuts get their own WARN lines — level info is what "Clear routine
    // entries" deletes, and these two are evidence, not routine.
    if (readFailures.length > 0) {
      logDocEvent(db, orgId, {
        level: "warn", area: "import", channel: "mindmerge:importDocs", actor: RENDERER_CALLER,
        message: `${readFailures.length} file(s) could not be read and were imported as placeholders — re-import the folder to retry them`,
        detail: readFailures.slice(0, 100).join("\n"),
      });
    }
    if (truncated.length > 0) {
      logDocEvent(db, orgId, {
        level: "warn", area: "import", channel: "mindmerge:importDocs", actor: RENDERER_CALLER,
        message: `${truncated.length} file(s) were larger than the import cap and were stored truncated, with a notice at the top of each note`,
        detail: truncated.slice(0, 100).join("\n"),
      });
    }
    return r;
  });

  /**
   * ---- Pasted-image attachments. WIRED (Phase 5) — the key question was ANSWERED.
   *
   * Jason 08-21-2026: "it doesnt have to lock, per say, just be encrypted." So the bytes land in
   * the module's OWN SQLCipher file (<org_id>.mtd — attachDb.ts), never this plain docs db and
   * never the vault. The key is machine-held: a per-org safeStorage-protected secret
   * (<org_id>.mxd) stretched by Argon2id (attachCrypto.ts) — the vault's envelope, copied, with
   * its own salt. NEVER PROMPTS.
   *
   * THE HONEST LIMIT: this protects the file AT REST — a copied db, a stolen drive, a walked
   * backup. It does NOT protect against code already running as this user: the app opens it
   * unattended, so anything running as the user can too. Right trade for screenshots pasted into
   * documents; wrong trade for credentials — which is why the vault still locks.
   *
   * The PROMISE is cached per org, not the resolved hex, so two concurrent first pastes cannot
   * double-run Argon2id (the vaultCtx precedent); a failed derivation clears the cache so a
   * transient failure isn't pinned for the session. Argon2 therefore runs once per org per run.
   */
  const attachKeyCache = new Map<string, Promise<string>>();
  function attachKeyFor(orgId: string): Promise<string> {
    const cached = attachKeyCache.get(orgId);
    if (cached) return cached;
    const p = deriveAttachKey(getOrCreateAttachSecret(orgId)).catch((e: unknown) => {
      attachKeyCache.delete(orgId);
      throw e;
    });
    attachKeyCache.set(orgId, p);
    return p;
  }
  /** Org resolved main-side exactly like mindMergeCtx (same error message), entitlement enforced
      first — but the ATTACHMENTS db is opened, not the plain docs db. */
  async function attachCtx(): Promise<{ db: Db; orgId: string }> {
    const org = getActiveOrg();
    if (!org) throw new Error("MindMerge: no active org");
    enforceFeature(getDb(), "mindmergeBrain");
    const keyHex = await attachKeyFor(org.org_id);
    return { db: openAttachmentsDb(org.org_id, app.getPath("userData"), keyHex), orgId: org.org_id };
  }
  safeHandle("mindmerge:saveAttachment", async (_e, input: unknown) => {
    const { db, orgId } = await attachCtx();
    return attachments.saveAttachment(db, orgId, input);
  });
  safeHandle("mindmerge:getAttachment", async (_e, uuid: unknown) => {
    const { db, orgId } = await attachCtx();
    return attachments.getAttachment(db, orgId, uuid);
  });

  /**
   * ---- The clipboard funnel. Every copy in the module lands here.
   *
   * THE VAULT'S DEFERRED CLEAR HAS NO COUNTERPART HERE, and that is not an omission. copyWithClear
   * exists to honour the vault's "Clear clipboard after N seconds" SECRET-hygiene setting, read live
   * from vault settings on every call. MindMerge has no such setting (none is in RENDERER_KEYS) and
   * document text is not a credential — and the vault's own contract is explicit that `seconds <= 0`
   * means never clear, which reduces copyWithClear to exactly `clip.write(value)`. So this is that
   * one line, and the shape is kept so a setting can be threaded through later if one is ever ruled.
   */
  // DELIBERATELY UNGATED, by the vault's own precedent: its copyText runs while LOCKED because
  // "the error log's Copy-for-support must work" — same here for entitlement. Text travels INTO
  // the clipboard; nothing is read out of MindMerge. logClient below is ungated for the same
  // reason: a non-entitled user's renderer crash must still leave a trail — gating DIAGNOSTICS
  // is how a support case arrives with no evidence. These two are the boundary of the gate, not
  // holes in it (ruled in triage 08-22-2026; the gate verifier flagged them, this is the answer).
  safeHandle("mindmerge:copyText", async (_e, text: unknown) => {
    clipboard.writeText(typeof text === "string" ? text : String(text ?? ""));
    return true;
  });

  /**
   * The Visual Studio Code themes installed on this machine, and the raw text of one.
   *
   * These touch no MindMerge data at all — they read a public extensions folder, which is the same
   * class of thing as asking the operating system for a font list.
   */
  // Code themes exist ONLY to paint the Documents editor, so they take the Documents gate — unlike
  // copyText/logClient below, nothing about them needs to work for a user who has no Documents.
  safeHandle("mindmerge:findCodeThemes", async () => {
    enforceFeature(getDb(), "mindmergeBrain");
    return findVsCodeThemes();
  });
  safeHandle("mindmerge:readCodeTheme", async (_e, file: unknown) => {
    enforceFeature(getDb(), "mindmergeBrain");
    return readVsCodeTheme(file);
  });

  /**
   * THE RENDERER'S OWN FAILURES. A crash in a React surface never reaches safeHandle — it happens
   * on the other side of the bridge — so without this channel the log would record only main-side
   * problems and quietly imply the renderer never breaks. Level is CLAMPED and the actor is stamped
   * here, never accepted from the page.
   */
  safeHandle("mindmerge:logClient", async (_e, level: unknown, message: unknown, detail: unknown) => {
    const lvl = typeof level === "string" && ["debug", "info", "warn", "error"].includes(level)
      ? (level as DocLogLevel)
      : "error";
    const requestId = newRequestId();
    logDocEvent(null, null, {
      level: lvl,
      area: "renderer",
      channel: null,
      requestId,
      actor: RENDERER_CALLER,
      message: typeof message === "string" ? message : String(message),
      detail: typeof detail === "string" ? detail : null,
    });
    return requestId;
  });
}
