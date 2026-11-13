// Focal Registry — "Back up everything": the copy itself.
// Description: writes a consistent copy of every database, key file and attached folder into a new
//              dated folder. No Electron import: the caller hands in the open connections and the
//              paths, so every rule here is tested headless against throwaway databases.
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3-multiple-ciphers";
import type { DataCopyResult } from "../../../../src/shared/types";
import { copyVerified } from "../shared/copyVerified";

export interface CopyPlan {
  /** Connections the app already holds. `fileName` is the name the copy gets, which is the name
      the app expects to find when the copy is put back. */
  databases: Array<{ name: string; fileName: string; db: Database.Database }>;
  /** Plain files, copied as they are. `to` is relative to the new folder. */
  files: Array<{ from: string; to: string }>;
  /** Whole folders. `to` is relative to the new folder. */
  folders: Array<{ from: string; to: string }>;
  destinationRoot: string;
  /** The new folder's name, "YYYY-MM-DD HHmm". */
  stamp: string;
  appVersion: string;
  /** Written into the manifest: what was left out, and what a restore needs. */
  notes: string[];
  shouldStop: () => boolean;
  report: (text: string) => void;
}

interface Copied {
  file: string;
  bytes: number;
  database?: string;
}

const INCOMPLETE = " (incomplete)";

class Stopped extends Error {}

const two = (n: number): string => String(n).padStart(2, "0");
const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Local time, year first: the folders sort by date in Explorer and the name is legal on Windows. */
export function stampOf(at: Date): string {
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}${two(at.getMinutes())}`;
}

/** True when `target` is `parent` or anywhere below it. Compared as paths, never as text, so
    "Focal Registry Backups" is not inside "Focal Registry".
    ponytail: the paths are compared as written. A junction or a mapped drive that leads back into
    the data folder is not seen; resolve both with fs.realpathSync if that ever comes up. */
export function isInside(target: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(target));
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel));
}

/**
 * What a backup does when projects have a contract file on record and no contracts folder was
 * found. The databases hold only the paths, so a backup that said nothing would look whole with
 * the files missing from it. A records folder that cannot be reached is usually a drive to plug
 * in, so that run is refused; a folder that is simply not there is said in the manifest.
 */
export function contractsGap(onRecord: number, recordsRoot: string, rootReachable: boolean): { refuse: string } | { note: string } | null {
  if (onRecord <= 0) return null;
  const projects = onRecord === 1 ? "1 project has" : `${onRecord} projects have`;
  return rootReachable
    ? { note: `${projects} a contract file on record, but no contracts folder was found under ${recordsRoot}, so no contract files are in this backup.` }
    : { refuse: `${projects} a contract file on record, but the records folder ${recordsRoot} cannot be reached. If it is on a drive that is not connected, connect it and back up again.` };
}

// Every copy below blocks the thread. Without a turn of the event loop before each file, a
// "Stop safely" from the quit toast could not arrive until the whole backup was over.
async function between(plan: CopyPlan): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  if (plan.shouldStop()) throw new Stopped();
}

/** A name already taken, finished or not, is never reused: the seconds are added instead. */
function freeName(root: string, stamp: string): string {
  const taken = (name: string): boolean =>
    fs.existsSync(path.join(root, name)) || fs.existsSync(path.join(root, name + INCOMPLETE));
  const name = taken(stamp) ? stamp + two(new Date().getSeconds()) : stamp;
  if (taken(name)) throw new Error("A backup made this very second is already in the folder. Try again in a moment.");
  return name;
}

function copyOne(from: string, to: string, shown: string): Copied {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  const copy = copyVerified(from, to);
  if (!copy.ok) throw new Error(`${shown} could not be copied: ${copy.error ?? "unknown error"}`);
  return { file: shown, bytes: copy.bytes };
}

async function copyTree(from: string, to: string, shown: string, plan: CopyPlan, done: Copied[]): Promise<void> {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const name = path.join(shown, entry.name);
    if (entry.isDirectory()) {
      await copyTree(path.join(from, entry.name), path.join(to, entry.name), name, plan, done);
    } else if (entry.isFile()) {
      await between(plan);
      done.push(copyOne(path.join(from, entry.name), path.join(to, entry.name), name));
    }
    // A link is neither: it could point anywhere, and only what is in the folder belongs in the copy.
  }
}

// Windows refuses to rename a folder while a virus scanner or the search indexer still holds one
// of its brand-new files open. That clears in moments, so the rename is tried again for five seconds.
async function renameWhenFree(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= 20 || (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY")) throw err;
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }
  }
}

function writeFailed(folder: string, headline: string, why: string, plan: CopyPlan, done: Copied[]): void {
  const lines = [
    headline,
    "",
    `Why: ${why}`,
    `When: ${new Date().toISOString()}`,
    `App version: ${plan.appVersion}`,
    "",
    done.length > 0 ? "Copied whole before it ended:" : "Nothing was copied before it ended.",
    ...done.map((item) => `  ${item.file} (${item.bytes} bytes)`),
    "",
    "Any other file in this folder is unfinished.",
  ];
  try {
    fs.writeFileSync(path.join(folder, "FAILED.txt"), lines.join("\r\n"), "utf8");
  } catch {
    // A full disk can refuse even this. The folder's own name still says it is incomplete.
  }
}

export async function copyEverything(plan: CopyPlan): Promise<DataCopyResult> {
  const done: Copied[] = [];
  // Set only once this run has made the folder, so a failure never writes into someone else's.
  let made: string | null = null;
  try {
    // A backup folder inside a folder it copies would be copied into itself, without end.
    if (plan.folders.some((folder) => isInside(plan.destinationRoot, folder.from))) {
      throw new Error("The backup folder is inside a folder that is being backed up. Choose another backup folder.");
    }
    try {
      fs.mkdirSync(plan.destinationRoot, { recursive: true });
    } catch (err) {
      // An unplugged drive is the likeliest failure of all, and a bare "ENOENT" does not say so.
      throw new Error(`The backup folder "${plan.destinationRoot}" could not be reached: ${reason(err)}`);
    }
    const finished = path.join(plan.destinationRoot, freeName(plan.destinationRoot, plan.stamp));
    const work = finished + INCOMPLETE;
    // Not recursive on purpose: a folder that is already there is an error, never reused.
    fs.mkdirSync(work);
    made = work;

    for (const [index, source] of plan.databases.entries()) {
      plan.report(`Backup: ${index + 1} of ${plan.databases.length} databases`);
      await between(plan);
      const to = path.join(work, source.fileName);
      try {
        // VACUUM INTO reads one consistent snapshot through the live connection, the write-ahead
        // log included, and writes an encrypted database out encrypted with its own key. A copy
        // of the file itself can miss whatever is still in the log.
        // ponytail: it holds the main process for the whole of one database (a full rebuild of a
        // 76 megabyte vault measured about two seconds). Past a few hundred megabytes the window
        // looks frozen: then copy the unencrypted databases with db.backup(), which works in steps.
        source.db.exec(`VACUUM INTO '${to.replace(/'/g, "''")}'`);
      } catch (err) {
        throw new Error(`${source.name} could not be copied: ${reason(err)}`);
      }
      done.push({ file: source.fileName, bytes: fs.statSync(to).size, database: source.name });
    }

    plan.report("Backup: key files and attachments");
    for (const file of plan.files) {
      await between(plan);
      done.push(copyOne(file.from, path.join(work, file.to), file.to));
    }
    for (const folder of plan.folders) {
      await copyTree(folder.from, path.join(work, folder.to), folder.to, plan, done);
    }

    // The manifest goes in before the rename, so a folder without "(incomplete)" always has one.
    const manifest = {
      app: "Focal Registry",
      appVersion: plan.appVersion,
      finishedAt: new Date().toISOString(),
      complete: true,
      copied: done,
      notes: plan.notes,
    };
    fs.writeFileSync(path.join(work, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

    try {
      await renameWhenFree(work, finished);
    } catch (err) {
      const error = `Everything was copied, but the folder could not be given its final name (${reason(err)}). The copy inside is whole: remove "${INCOMPLETE}" from the folder's name by hand.`;
      writeFailed(work, "This backup is whole, but its folder is still named as incomplete.", error, plan, done);
      return { ok: false, error, path: work };
    }
    return { ok: true, path: finished };
  } catch (err) {
    const error = err instanceof Stopped ? "The backup was stopped before it finished." : reason(err);
    if (made === null) return { ok: false, error };
    writeFailed(made, "This backup did not finish. Do not restore from it.", error, plan, done);
    return { ok: false, error, path: made };
  }
}
