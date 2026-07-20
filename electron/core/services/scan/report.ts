// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Scan report writer — THE ONLY write this product ever makes to a user drive, into
//              [drive]:\_FocalRegistry-Reports\ so the report travels with a shelved archive.
//              NEVER overwrites, NEVER appends to an existing file: name collisions get -02, -03.
//              YAML frontmatter (gray-matter/Secure Note ingestible) + numbers-and-lists body.
//              A copy lands in Secure Note's watch folder when one is configured. A write failure
//              is reported and the run STAYS completed — the data is already committed.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/scan/report.ts
//------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";
import type { Db } from "./db";
import type { ScanDriveRow, ScanRunRow } from "./drives";

export const REPORTS_FOLDER_NAME = "_FocalRegistry-Reports";

export interface ReportWriteResult {
  ok: boolean;
  path?: string;
  secureNoteCopy?: string | null;
  error?: string;
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

function yamlList(pairs: Array<{ key: string; n: number }>): string {
  if (pairs.length === 0) return "{}";
  return `{ ${pairs.map((p) => `"${p.key}": ${p.n}`).join(", ")} }`;
}

function fmtDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "—";
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
    const dateStamp = (scannedAt || new Date(0).toISOString()).slice(0, 10);

    // ---- destination: the SCANNED drive's root, the one sanctioned user-drive write ----
    const driveRoot = reportRootOverride ?? path.parse(path.resolve(run.root_path)).root;
    const reportsDir = path.join(driveRoot, REPORTS_FOLDER_NAME);
    fs.mkdirSync(reportsDir, { recursive: true });
    const reportPath = collisionFreePath(reportsDir, `SCAN-${label}-${dateStamp}`);

    const fm = [
      "---",
      `title: "Scan report — ${label} — ${dateStamp}"`,
      "type: scan-report",
      `drive_label: "${(drive?.volume_label ?? "").replace(/"/g, "'")}"`,
      `volume_serial: "${drive?.volume_serial ?? ""}"`,
      `scanned_at: "${scannedAt}"`,
      `run_id: ${runId}`,
      `folders: ${folders}`,
      `files: ${files}`,
      `stills: ${stills}`,
      `video: ${video}`,
      `audio: ${audio}`,
      `unknown: ${unknown}`,
      `oldest_capture: "${oldest ?? ""}"`,
      `newest_capture: "${newest ?? ""}"`,
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
      `| Scanned | ${scannedAt} |`,
      `| Folders | ${folders.toLocaleString()} |`,
      `| Media files | ${files.toLocaleString()} |`,
      `| Stills | ${stills.toLocaleString()} |`,
      `| Video | ${video.toLocaleString()} |`,
      `| Audio | ${audio.toLocaleString()} |`,
      `| Other / unreadable | ${unknown.toLocaleString()} |`,
      `| Capture range | ${fmtDate(oldest)} → ${fmtDate(newest)} |`,
      `| Errors logged | ${run.errors_logged.toLocaleString()} |`,
      "",
      `_Showing the top ${Math.min(TOP_FOLDERS, topFolders.length)} folders by media file count. Full per-folder detail for all ${folders.toLocaleString()} folders is queryable in the Focal Registry database (\`scan_folders\` / \`scan_files\` for run ${runId})._`,
      "",
    ].join("\n");

    // Stream the document with positioned writes — the body is NEVER assembled as one in-memory
    // string. wx refuses to overwrite an existing file, ever.
    const fd = fs.openSync(reportPath, "wx");
    try {
      fs.writeSync(fd, `${fm}\n${summary}\n`);
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

    // ---- Secure Note handoff: a COPY into the watch folder when configured. OPTIONAL and isolated:
    //      the report is already on disk and the run is complete — a handoff failure (no watch
    //      folder set, no app_settings, an unwritable target) must NEVER turn a written report into
    //      a failure result. It is best-effort, swallowed to null. ----
    let secureNoteCopy: string | null = null;
    try {
      const watch = (db.prepare("SELECT value FROM app_settings WHERE key = 'runbook-shredder.watch_path'").get() as
        | { value: string }
        | undefined)?.value;
      if (watch && fs.existsSync(watch)) {
        const copyTarget = collisionFreePath(watch, path.basename(reportPath, ".md"));
        fs.copyFileSync(reportPath, copyTarget, fs.constants.COPYFILE_EXCL);
        secureNoteCopy = copyTarget;
      }
    } catch {
      secureNoteCopy = null; // handoff is a nice-to-have; the report and the run stand regardless
    }

    db.prepare("UPDATE scan_runs SET report_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(reportPath, runId);
    if (run.drive_id != null) {
      db.prepare("UPDATE scan_drives SET last_scanned_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(run.drive_id);
    }
    return { ok: true, path: reportPath, secureNoteCopy };
  } catch (e) {
    // The run stays COMPLETED — the data is already committed. The failure is surfaced, not retried.
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
