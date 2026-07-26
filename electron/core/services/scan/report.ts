// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Scan report writer — THE ONLY write this product ever makes to a user drive, into
//              [drive]:\_FocalRegistry-Reports\ so the report travels with a shelved archive.
//              NEVER overwrites, NEVER appends to an existing file: name collisions get -02, -03.
//              YAML frontmatter (gray-matter/MindMerge ingestible) + numbers-and-lists body.
//              A copy lands in MindMerge's watch folder when one is configured. A write failure
//              is reported and the run STAYS completed — the data is already committed.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/scan/report.ts
//------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";
import type { Db } from "./db";
import type { ScanDriveRow, ScanRunRow } from "./drives";
import { formatStamp } from "../../../../src/shared/datetime";
import { defaultMediaExtensions } from "../shared/assetRegistry";
import * as storage from "../storage";

export const REPORTS_FOLDER_NAME = "_FocalRegistry-Reports";

export interface ReportWriteResult {
  ok: boolean; // true if the report landed in AT LEAST ONE location
  path?: string; // the drive copy (or the local copy if the drive write failed) — for the UI toast
  drivePath?: string | null; // [drive]:\_FocalRegistry-Reports\… — null if that write failed
  localPath?: string | null; // <root>\MissionControl\Focal-Registry\Scan\… — null if that write failed
  driveError?: string;
  localError?: string;
  secureNoteCopy?: string | null;
  error?: string;
}

/** Stream the report to ONE target (positioned writes — the body is never one in-memory string; wx
    refuses to overwrite). Returns per-target success so drive and local writes stay independent. */
function streamReportTo(
  targetPath: string,
  header: string,
  topFolders: Array<{ id: number; path: string; media_files: number; total_files: number; image_count: number; video_count: number; audio_count: number; unreadable_count: number; total_bytes: number; date_min: string | null; date_max: string | null; top_camera: string | null }>,
  formatsByFolder: Map<number, Array<{ key: string; n: number }>>
): { ok: boolean; path?: string; error?: string } {
  try {
    const fd = fs.openSync(targetPath, "wx");
    try {
      fs.writeSync(fd, header);
      for (const f of topFolders) {
        const fmts = formatsByFolder.get(f.id) ?? [];
        const fmtLine = fmts.length > 0 ? fmts.map((x) => `${x.key || "(none)"}: ${x.n}`).join(" · ") : "—";
        const section =
          `## ${f.path}\n\n` +
          `- Media files: ${f.media_files.toLocaleString()} of ${f.total_files.toLocaleString()} seen (stills ${f.image_count}, video ${f.video_count}, audio ${f.audio_count}, unreadable ${f.unreadable_count})\n` +
          `- Size: ${fmtBytes(f.total_bytes)}\n` +
          `- Formats: ${fmtLine}\n` +
          `- Capture range: ${fmtDate(f.date_min)} → ${fmtDate(f.date_max)}${f.top_camera ? ` · Top camera: ${f.top_camera}` : ""}\n\n`;
        fs.writeSync(fd, section);
      }
    } finally {
      fs.closeSync(fd);
    }
    return { ok: true, path: targetPath };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function sanitizeLabel(label: string | null, fallback: string): string {
  const cleaned = (label ?? "").replace(/[^A-Za-z0-9 _-]/g, "").trim().replace(/\s+/g, "-");
  return cleaned !== "" ? cleaned : fallback;
}

/** First free name in dir: base.md, base-02.md, base-03.md … Never returns an existing path. */
function collisionFreePath(dir: string, base: string): string {
  let candidate = path.join(dir, `${base}.md`);
  for (let n = 2; fs.existsSync(candidate); n += 1) {
    candidate = path.join(dir, `${base}-${String(n).padStart(2, "0")}.md`);
  }
  return candidate;
}

/** Folder + filename stem for a run's on-drive artifacts, so a .pdf/.csv export lands beside the
    .md report with the same name. Reuses report_path when present; else rebuilds the canonical name. */
export function reportStem(db: Db, runId: number): { dir: string; base: string } {
  const run = db.prepare("SELECT * FROM scan_runs WHERE id = ?").get(runId) as ScanRunRow | undefined;
  if (!run) throw new Error(`scan run ${runId} not found`);
  if (run.report_path) return { dir: path.dirname(run.report_path), base: path.basename(run.report_path, ".md") };
  const drive = run.drive_id != null
    ? (db.prepare("SELECT volume_label, volume_serial FROM scan_drives WHERE id = ?").get(run.drive_id) as { volume_label: string | null; volume_serial: string } | undefined)
    : undefined;
  const label = sanitizeLabel(drive?.volume_label ?? null, drive?.volume_serial ?? `run-${runId}`);
  // LOCAL date in the filename (fileStamp) — never UTC, so the file lands under the day Paul scanned.
  const stampSrc = run.finished_at ?? run.started_at;
  const dateStamp = stampSrc ? formatStamp(stampSrc, "fileStamp") : new Date(0).toISOString().slice(0, 10);
  const driveRoot = path.parse(path.resolve(run.root_path)).root;
  return { dir: path.join(driveRoot, REPORTS_FOLDER_NAME), base: `SCAN-${label}-${dateStamp}` };
}

function yamlList(pairs: Array<{ key: string; n: number }>): string {
  if (pairs.length === 0) return "{}";
  return `{ ${pairs.map((p) => `"${p.key}": ${p.n}`).join(", ")} }`;
}

// ---- coverage wording (wizard, Phase B) -------------------------------------------------------
/** True when a run's selected set EQUALS the full default media set (Photos+Video+Audio, every
 *  format) — such a run is equivalent to the pre-wizard always-everything behaviour. */
function isDefaultMediaSet(selectedJson: string | null): boolean {
  if (!selectedJson) return false;
  try {
    const sel = new Set((JSON.parse(selectedJson) as string[]).map((e) => e.toLowerCase()));
    const def = defaultMediaExtensions();
    return sel.size === def.length && def.every((e) => sel.has(e));
  } catch {
    return false;
  }
}
export function coverageKind(selectedJson: string | null): "everything" | "all-media" | "selected" {
  if (!selectedJson) return "everything";
  return isDefaultMediaSet(selectedJson) ? "all-media" : "selected";
}
function coverageLine(selectedJson: string | null): string {
  const kind = coverageKind(selectedJson);
  if (kind === "everything") return "_This run covered every format Scan understood at the time it ran._";
  if (kind === "all-media") return "_This run covered all media formats._";
  const sel = JSON.parse(selectedJson as string) as string[];
  return `_This run reported ONLY the formats selected when it was started (${sel.length} formats: ${sel.map((e) => `.${e}`).join(" ")}). Files outside that selection were not recorded — two reports of the same drive may differ if their selections differed._`;
}

// Body capture ranges are human display → LOCAL date-only through the shared formatter (frontmatter
// keeps machine ISO separately). "—" when absent.
function fmtDate(value: string | null): string {
  return formatStamp(value, "dateOnly") || "—";
}

function fmtBytes(n: number): string {
  if (n >= 1024 ** 4) return `${(n / 1024 ** 4).toFixed(2)} TB`;
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${n} B`;
}

/**
 * Write the run's report to the scanned drive (or, for tests, to reportRootOverride — an injection
 * point for the harness so proving the writer never touches a real drive root; production callers
 * omit it and the report lands beside the archive it describes).
 */
export function writeScanReport(db: Db, runId: number, reportRootOverride?: string): ReportWriteResult {
  try {
    const run = db.prepare("SELECT * FROM scan_runs WHERE id = ?").get(runId) as ScanRunRow | undefined;
    if (!run) return { ok: false, error: `run ${runId} not found` };
    const drive = run.drive_id
      ? (db.prepare("SELECT * FROM scan_drives WHERE id = ?").get(run.drive_id) as ScanDriveRow | undefined)
      : undefined;

    // ---- aggregates (all read from the committed rows — the report never re-walks the disk) ----
    const one = <T>(sql: string, ...args: unknown[]): T => (db.prepare(sql).get(...args) as { v: T }).v;
    const kindCount = (kind: string): number =>
      one<number>("SELECT COUNT(*) AS v FROM scan_files WHERE run_id = ? AND kind = ?", runId, kind);
    const stills = kindCount("image");
    const video = kindCount("video");
    const audio = kindCount("audio");
    const unknown = kindCount("unreadable") + kindCount("other") + kindCount("sidecar");
    const files = run.files_recorded;
    const folders = run.folders_committed;
    const oldest = one<string | null>(
      "SELECT MIN(captured_at) AS v FROM scan_files WHERE run_id = ? AND kind IN ('image','video','audio')", runId);
    const newest = one<string | null>(
      "SELECT MAX(captured_at) AS v FROM scan_files WHERE run_id = ? AND kind IN ('image','video','audio')", runId);
    const formatsFor = (kind: string): Array<{ key: string; n: number }> =>
      (db.prepare(
        "SELECT LOWER(extension) AS key, COUNT(*) AS n FROM scan_files WHERE run_id = ? AND kind = ? GROUP BY LOWER(extension) ORDER BY n DESC"
      ).all(runId, kind) as Array<{ key: string; n: number }>);
    const formatsOther = (db.prepare(
      "SELECT LOWER(extension) AS key, COUNT(*) AS n FROM scan_files WHERE run_id = ? AND kind IN ('other','sidecar','unreadable') GROUP BY LOWER(extension) ORDER BY n DESC"
    ).all(runId) as Array<{ key: string; n: number }>);
    const grouped = (col: string, where = ""): Array<{ key: string; n: number }> =>
      (db.prepare(
        `SELECT ${col} AS key, COUNT(*) AS n FROM scan_files WHERE run_id = ? AND ${col} IS NOT NULL ${where} GROUP BY ${col} ORDER BY n DESC`
      ).all(runId) as Array<{ key: string; n: number }>);
    const cameras = grouped("camera_model");
    const videoCodecs = grouped("video_codec", "AND kind = 'video'");
    const audioCodecs = grouped("audio_codec", "AND kind IN ('video','audio')");
    const totalVideoDuration = one<number | null>(
      "SELECT SUM(duration_seconds) AS v FROM scan_files WHERE run_id = ? AND kind = 'video'", runId) ?? 0;
    // TOP 100 folders by media file count — NEVER one section per folder (Defect C: 123,928 folders
    // exhausted memory as one string). Full per-folder detail stays queryable in scan_folders.
    const TOP_FOLDERS = 100;
    const topFolders = db.prepare(
      `SELECT id, path, media_files, total_files, image_count, video_count, audio_count,
              unreadable_count, total_bytes, date_min, date_max, top_camera
       FROM scan_folders WHERE run_id = ? ORDER BY media_files DESC, total_bytes DESC LIMIT ?`
    ).all(runId, TOP_FOLDERS) as Array<{ id: number; path: string; media_files: number; total_files: number; image_count: number; video_count: number; audio_count: number; unreadable_count: number; total_bytes: number; date_min: string | null; date_max: string | null; top_camera: string | null }>;
    // Per-format breakdown ONLY for the top folders (bounded), not the whole 1.28M-row table.
    const formatsByFolder = new Map<number, Array<{ key: string; n: number }>>();
    if (topFolders.length > 0) {
      const ph = topFolders.map(() => "?").join(",");
      const ff = db.prepare(
        `SELECT folder_id, LOWER(extension) AS key, COUNT(*) AS n FROM scan_files
         WHERE run_id = ? AND folder_id IN (${ph}) GROUP BY folder_id, LOWER(extension)`
      ).all(runId, ...topFolders.map((f) => f.id)) as Array<{ folder_id: number; key: string; n: number }>;
      for (const r of ff) {
        if (!formatsByFolder.has(r.folder_id)) formatsByFolder.set(r.folder_id, []);
        formatsByFolder.get(r.folder_id)!.push({ key: r.key, n: r.n });
      }
    }

    const label = sanitizeLabel(drive?.volume_label ?? null, drive?.volume_serial ?? `run-${runId}`);
    const scannedAt = run.finished_at ?? run.started_at ?? "";
    const dateStamp = scannedAt ? formatStamp(scannedAt, "fileStamp") : new Date(0).toISOString().slice(0, 10);

    // ---- destination: the SCANNED drive's root, the one sanctioned user-drive write ----
    const driveRoot = reportRootOverride ?? path.parse(path.resolve(run.root_path)).root;
    const reportsDir = path.join(driveRoot, REPORTS_FOLDER_NAME);
    fs.mkdirSync(reportsDir, { recursive: true });
    const baseName = `SCAN-${label}-${dateStamp}`;
    const reportPath = collisionFreePath(reportsDir, baseName);

    const fm = [
      "---",
      `title: "Scan report — ${label} — ${dateStamp}"`,
      "type: scan-report",
      `drive_label: "${(drive?.volume_label ?? "").replace(/"/g, "'")}"`,
      `volume_serial: "${drive?.volume_serial ?? ""}"`,
      `scanned_at: "${formatStamp(scannedAt, "iso")}"`,
      `run_id: ${runId}`,
      `folders: ${folders}`,
      `files: ${files}`,
      `stills: ${stills}`,
      `video: ${video}`,
      `audio: ${audio}`,
      `unknown: ${unknown}`,
      `oldest_capture: "${formatStamp(oldest, "iso")}"`,
      `newest_capture: "${formatStamp(newest, "iso")}"`,
      `coverage: ${coverageKind(run.selected_extensions)}`,
      `formats_selected: [${run.selected_extensions ? (JSON.parse(run.selected_extensions) as string[]).map((e) => `"${e}"`).join(", ") : ""}]`,
      `formats_stills: ${yamlList(formatsFor("image"))}`,
      `formats_video: ${yamlList(formatsFor("video"))}`,
      `formats_audio: ${yamlList(formatsFor("audio"))}`,
      `formats_other: ${yamlList(formatsOther)}`,
      `cameras: ${yamlList(cameras)}`,
      `video_codecs: ${yamlList(videoCodecs)}`,
      `audio_codecs: ${yamlList(audioCodecs)}`,
      `total_video_duration: ${Math.round(totalVideoDuration)}`,
      `errors: ${run.errors_logged}`,
      "tags: [scan-report, focal-registry]",
      "---",
    ].join("\n");

    const summary = [
      "",
      `# Scan report — ${drive?.volume_label || label}`,
      "",
      "| | |",
      "|---|---|",
      `| Root | \`${run.root_path}\` |`,
      `| Volume serial | ${drive?.volume_serial ?? "—"} |`,
      `| Scanned | ${formatStamp(scannedAt, "eventTime") || "—"} |`,
      `| Folders | ${folders.toLocaleString()} |`,
      `| Media files | ${files.toLocaleString()} |`,
      `| Stills | ${stills.toLocaleString()} |`,
      `| Video | ${video.toLocaleString()} |`,
      `| Audio | ${audio.toLocaleString()} |`,
      `| Other / unreadable | ${unknown.toLocaleString()} |`,
      `| Capture range | ${fmtDate(oldest)} → ${fmtDate(newest)} |`,
      `| Errors logged | ${run.errors_logged.toLocaleString()} |`,
      "",
      // Coverage statement (wizard, Phase B): a report only speaks for what the run was ASKED to
      // cover. A DEFAULT run (the full media set — Photos+Video+Audio, every format) carries NO
      // caveat: its set equals the pre-wizard always-everything behaviour, so default reports stay
      // comparable. Only a genuinely narrowed run gets the "reported ONLY" wording.
      coverageLine(run.selected_extensions),
      "",
      `_Showing the top ${Math.min(TOP_FOLDERS, topFolders.length)} folders by media file count. Full per-folder detail for all ${folders.toLocaleString()} folders is queryable in the Focal Registry database (\`scan_folders\` / \`scan_files\` for run ${runId})._`,
      "",
    ].join("\n");

    const header = `${fm}\n${summary}\n`;

    // DOUBLE-SAVE (Phase 3). The report is written TWICE, INDEPENDENTLY:
    //   1. onto the scanned drive — it travels with a shelved archive.
    //   2. into the app-managed Markdown tree — because an archive drive gets UNPLUGGED, and Paul
    //      wants the report whether or not that drive is connected.
    // Either write can fail on its own; the other still happens, and neither failure fails the scan
    // (the data is already committed). We record which succeeded.
    const driveResult = streamReportTo(reportPath, header, topFolders, formatsByFolder);

    let localResult: { ok: boolean; path?: string; error?: string };
    try {
      const root = storage.resolveMarkdownRoot();
      storage.ensureManagedTree(root);
      const localPath = collisionFreePath(storage.scanMarkdownDir(root), baseName);
      localResult = streamReportTo(localPath, header, topFolders, formatsByFolder);
    } catch (e) {
      localResult = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    // ---- MindMerge handoff: a COPY into the watch folder when configured. Best-effort, isolated —
    //      a handoff failure never turns a written report into a failure result. Copies from whichever
    //      of the two reports actually landed. ----
    let secureNoteCopy: string | null = null;
    const anyPath = driveResult.path ?? localResult.path;
    try {
      const watch = (db.prepare("SELECT value FROM app_settings WHERE key = 'mindmerge.watch_path'").get() as
        | { value: string }
        | undefined)?.value;
      if (anyPath && watch && fs.existsSync(watch)) {
        const copyTarget = collisionFreePath(watch, path.basename(anyPath, ".md"));
        fs.copyFileSync(anyPath, copyTarget, fs.constants.COPYFILE_EXCL);
        secureNoteCopy = copyTarget;
      }
    } catch {
      secureNoteCopy = null;
    }

    db.prepare("UPDATE scan_runs SET report_path = ?, report_local_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(driveResult.ok ? reportPath : null, localResult.ok ? (localResult.path ?? null) : null, runId);
    if (run.drive_id != null) {
      db.prepare("UPDATE scan_drives SET last_scanned_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(run.drive_id);
    }

    const ok = driveResult.ok || localResult.ok; // a report exists if EITHER write succeeded
    const bothFailed = !driveResult.ok && !localResult.ok;
    return {
      ok,
      path: anyPath,
      drivePath: driveResult.ok ? reportPath : null,
      localPath: localResult.ok ? (localResult.path ?? null) : null,
      driveError: driveResult.ok ? undefined : driveResult.error,
      localError: localResult.ok ? undefined : localResult.error,
      secureNoteCopy,
      error: bothFailed ? `drive: ${driveResult.error ?? "?"}; local: ${localResult.error ?? "?"}` : undefined,
    };
  } catch (e) {
    // The run stays COMPLETED — the data is already committed. The failure is surfaced, not retried.
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
