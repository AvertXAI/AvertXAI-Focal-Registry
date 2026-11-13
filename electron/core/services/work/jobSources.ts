// Focal Registry — the long jobs, announced to the quit guard.
// Description: one work source per engine: Scan, Rename, Migrate search and bundle export. A source
//              lists a line only while its engine is really running, and "Stop safely" sets the
//              stop flag that engine already reads between files or folders. Also lists the jobs a
//              crash or a power cut left marked as running. No Electron import: tested headless.
import path from "node:path";
import type Database from "better-sqlite3-multiple-ciphers";
import { getDb } from "../db";
import * as migrate from "../migrate/engine";
import * as rename from "../rename";
import * as scan from "../scan";
import { registerWorkSource, type WorkAction, type WorkLine } from "./registry";

type Db = Database.Database;

// What is safe to do after a job is cut short. A safe stop always lands between two files.
const NEXT = {
  scan: "Open Scan and press Resume: folders already saved are skipped.",
  count: "Open Scan and start the scan again: counting saves nothing, so nothing is lost.",
  rename: "Run the same rename again: copies already made are skipped, never overwritten.",
  revert: "Run the revert again with the same folders: files already restored are skipped, never overwritten.",
  search: "Open Migrate and run the search again: a search only reads, so nothing was changed.",
  bundle:
    "Export the bundle again to the same drive: on the same day it carries on in the same folder and skips files already copied; later it starts a fresh folder.",
};
// A crash or a power cut is not a safe stop: it can land part way through one file.
const CHECK_LAST = " The last file it wrote may be incomplete: compare it with its original first.";

const n = (value: number): string => value.toLocaleString("en-US");
// A line id is "<engine>:<row id>", and the row id is all an engine needs to find its stop flag.
const rowId = (id: string): number => Number(id.slice(id.indexOf(":") + 1));
// The toast gives each job one line, so a long folder name is cut instead of wrapping.
const short = (name: string): string => (name.length > 32 ? `${name.slice(0, 31)}…` : name);
const renameLabel = (kind: string): string => (kind === "revert" ? "Revert" : "Rename");

// ---- Scan -------------------------------------------------------------------------------------
interface ScanFacts {
  root_path: string;
  scan_unit: string;
  files_recorded: number;
  total_files_expected: number | null;
  estimated_files: number | null;
}

function scanTarget(run: ScanFacts): string {
  if (run.scan_unit === "drive") return `drive ${path.parse(run.root_path).root.slice(0, 2)}`;
  return `folder ${short(path.basename(run.root_path) || run.root_path)}`;
}

function scanProgress(run: ScanFacts): string {
  const total = run.total_files_expected ?? run.estimated_files;
  return total
    ? `${Math.min(100, Math.floor((100 * run.files_recorded) / total))} percent`
    : `${n(run.files_recorded)} files`;
}

function scanLines(db: () => Db): WorkLine[] {
  const runId = scan.activeRunId();
  if (runId === null) return [];
  const run = scan.getRun(db(), runId);
  const counting = run.status === "counting";
  return [
    {
      id: `scan:${runId}`,
      kind: "job",
      text: `Scan: ${scanTarget(run)} · ${counting ? "counting files" : scanProgress(run)}`,
      actions: ["finish", "stopSafely"],
      next: counting ? NEXT.count : NEXT.scan,
    },
  ];
}

function stopScan(db: () => Db): void {
  const runId = scan.activeRunId();
  if (runId === null) return;
  // A count has saved nothing, so it is dropped. A scan is paused instead: every folder it saved
  // stays, and Resume carries on from there.
  if (scan.getRun(db(), runId).status === "counting") scan.requestAbort(db(), runId);
  else scan.requestPause(runId);
}

// ---- Rename and Revert ------------------------------------------------------------------------
function renameLines(): WorkLine[] {
  return rename.renameWork().map(
    (w): WorkLine => ({
      id: `rename:${w.batchId}`,
      kind: "job",
      text: `${renameLabel(w.kind)}: ${n(w.done)} of ${n(w.total)} files`,
      actions: ["finish", "stopSafely"],
      next: w.kind === "revert" ? NEXT.revert : NEXT.rename,
    })
  );
}

// ---- Migrate ----------------------------------------------------------------------------------
interface SearchFacts {
  status: string;
  folders_walked: number;
  total_folders_expected: number | null;
}
const stillCounting = (job: SearchFacts): boolean => job.status === "counting" || !job.total_folders_expected;
const foldersDone = (job: SearchFacts): string =>
  `${n(job.folders_walked)} of ${n(job.total_folders_expected ?? 0)} folders`;

function searchLines(db: () => Db): WorkLine[] {
  const jobId = migrate.activeSearchJob();
  const job = jobId === null ? null : migrate.getJob(db(), jobId);
  if (!job) return [];
  const queued = (
    db().prepare("SELECT COUNT(*) AS n FROM migrate_jobs WHERE org_id = ? AND status = 'queued'").get(job.org_id) as {
      n: number;
    }
  ).n;
  return [
    {
      // One line for the whole queue, so "Finish" waits for every queued search and "Stop safely"
      // holds them all, instead of the guard asking again each time a queued search starts.
      id: "migrate:search",
      kind: "job",
      text: `Migrate search: ${stillCounting(job) ? "counting folders" : foldersDone(job)}${queued > 0 ? ` · ${n(queued)} more queued` : ""}`,
      actions: ["finish", "stopSafely"],
      next: NEXT.search,
    },
  ];
}

function bundleLines(): WorkLine[] {
  return migrate.bundleWork().map(
    (w): WorkLine => ({
      id: `bundle:${w.bundleId}`,
      kind: "job",
      text: `Bundle export: ${n(w.done)} of ${n(w.total)} files`,
      actions: ["finish", "stopSafely"],
      next: NEXT.bundle,
    })
  );
}

// ---- registration -----------------------------------------------------------------------------
// "Finish" asks nothing of a job: the guard just waits for its line to go.
const onStop =
  (stop: (id: string) => void) =>
  (id: string, action: WorkAction): void => {
    if (action === "stopSafely") stop(id);
  };

/** Called once, after the IPC handlers are registered. Only the tests pass their own database. */
export function registerJobSources(db: () => Db = getDb): void {
  registerWorkSource({ list: () => scanLines(db), act: onStop(() => stopScan(db)) });
  registerWorkSource({ list: renameLines, act: onStop((id) => rename.requestAbort(rowId(id))) });
  registerWorkSource({ list: () => searchLines(db), act: onStop(() => migrate.stopSearchSafely()) });
  registerWorkSource({ list: bundleLines, act: onStop((id) => migrate.requestStopBundle(rowId(id))) });
}

// ---- jobs a crash left behind -----------------------------------------------------------------
export interface LeftRunning {
  text: string;
  /** What is safe to do next. */
  next: string;
  /** The last sign of life the row has, as an ISO time. Now, when it has none. */
  at: string;
}

interface Stamped {
  at: string | null;
}

// SQLite's CURRENT_TIMESTAMP is UTC with no zone marker. Handing it on as an ISO time stops it
// being read as local time.
function isoTime(stamp: string | null): string {
  const t = stamp ? Date.parse(stamp.includes("T") ? stamp : `${stamp.replace(" ", "T")}Z`) : NaN;
  return new Date(Number.isNaN(t) ? Date.now() : t).toISOString();
}

// This runs while the app is starting, where a throw would cost the whole launch. A table that
// cannot be read lists nothing.
function collect<Row extends Stamped>(
  db: Db,
  sql: string,
  into: LeftRunning[],
  describe: (row: Row) => { text: string; next: string }
): void {
  try {
    for (const row of db.prepare(sql).all() as Row[]) into.push({ ...describe(row), at: isoTime(row.at) });
  } catch (err) {
    console.error("[work] could not read the jobs left running:", err);
  }
}

/**
 * Jobs a crash or a power cut left marked as running. Call it once per launch BEFORE the engines
 * relabel those rows as crashed: after that, a fresh crash cannot be told from an old one.
 */
export function jobsLeftRunning(db: Db): LeftRunning[] {
  const left: LeftRunning[] = [];
  // A cut-short count is left out on purpose. Nothing relabels a "counting" scan row, so it would
  // be listed again at every launch, and a count has saved nothing to go back to.
  collect<ScanFacts & Stamped>(
    db,
    `SELECT root_path, scan_unit, COALESCE(files_recorded, 0) AS files_recorded, total_files_expected,
            estimated_files, COALESCE(updated_at, started_at, created_at) AS at
       FROM scan_runs WHERE status = 'running'`,
    left,
    (r) => ({
      text: `Scan of ${scanTarget(r)} stopped at ${scanProgress(r)}`,
      // Not NEXT.scan: the Scan page offers Resume for a paused run only, never for a crashed one.
      next: "Open Scan and scan it again: what the stopped scan saved is kept, and nothing on the drive was changed.",
    })
  );
  // The ledger is written twenty-five rows at a time, so the count is the least that was copied.
  collect<{ kind: string; recorded: number } & Stamped>(
    db,
    `SELECT b.kind, (SELECT COUNT(*) FROM rename_files f WHERE f.batch_id = b.id) AS recorded,
            COALESCE((SELECT MAX(f.created_at) FROM rename_files f WHERE f.batch_id = b.id),
                     b.started_at, b.created_at) AS at
       FROM rename_batches b WHERE b.status = 'running'`,
    left,
    (r) => ({
      text: `${renameLabel(r.kind)} stopped after ${n(r.recorded)} recorded files`,
      next: (r.kind === "revert" ? NEXT.revert : NEXT.rename) + CHECK_LAST,
    })
  );
  collect<SearchFacts & Stamped>(
    db,
    `SELECT status, COALESCE(folders_walked, 0) AS folders_walked, total_folders_expected,
            COALESCE(updated_at, started_at, created_at) AS at
       FROM migrate_jobs WHERE status IN ('running', 'counting')`,
    left,
    (r) => ({
      text: `Migrate search stopped ${stillCounting(r) ? "while counting folders" : `at ${foldersDone(r)}`}`,
      next: NEXT.search,
    })
  );
  collect<{ done: number; total: number } & Stamped>(
    db,
    `SELECT COALESCE(items_copied, 0) + COALESCE(items_failed, 0) AS done, COALESCE(item_count, 0) AS total,
            COALESCE(updated_at, started_at, created_at) AS at
       FROM migrate_bundles WHERE status = 'running'`,
    left,
    (r) => ({ text: `Bundle export stopped at ${n(r.done)} of ${n(r.total)} files`, next: NEXT.bundle + CHECK_LAST })
  );
  return left;
}
