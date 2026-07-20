// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Scan export helpers — collision-safe file naming shared by the PDF/CSV exports, and
//              the streaming CSV writer for a run's folder rows. The CSV pulls ALL media-bearing
//              folders (not the report's top-100) one row at a time from the DB iterator straight
//              into a write stream: a 100k+ row export is never assembled in memory. RFC 4180 quoting.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/scan/export.ts
//------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";
import type { Db } from "./db";

/** First free name in dir: base.ext, base-02.ext, base-03.ext … Never returns an existing path
    (ext includes the leading dot). Mirrors the report writer's .md collision rule for exports. */
export function collisionFreeName(dir: string, base: string, ext: string): string {
  let candidate = path.join(dir, `${base}${ext}`);
  for (let n = 2; fs.existsSync(candidate); n += 1) {
    candidate = path.join(dir, `${base}-${String(n).padStart(2, "0")}${ext}`);
  }
  return candidate;
}

const CSV_HEADER =
  "folder_path,file_count,stills,video,audio,total_bytes,oldest_capture,newest_capture,top_camera,formats";

// ALL media-bearing folders, alphabetical. formats is a per-folder extension histogram built by a
// correlated subquery — cheap because scan_files is indexed on (run_id, folder_id) — so it streams
// with the outer rows and never materializes a join in memory.
const CSV_SQL =
  `SELECT fo.path AS folder_path, fo.file_count, fo.image_count AS stills, fo.video_count AS video,
          fo.audio_count AS audio, fo.total_bytes, fo.date_min AS oldest_capture,
          fo.date_max AS newest_capture, fo.top_camera,
          (SELECT GROUP_CONCAT(pair, ' ') FROM (
             SELECT LOWER(extension) || ':' || COUNT(*) AS pair FROM scan_files fi
             WHERE fi.run_id = fo.run_id AND fi.folder_id = fo.id AND fi.kind IN ('image','video','audio')
             GROUP BY LOWER(extension) ORDER BY COUNT(*) DESC)) AS formats
   FROM scan_folders fo WHERE fo.run_id = ? AND fo.file_count > 0 ORDER BY fo.path`;

// RFC 4180: a field is quoted iff it contains a comma, double-quote, CR or LF; interior quotes double.
function csvField(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Stream every media-bearing folder row of a run to a CSV file. Rows are pulled one at a time from
    the better-sqlite3 iterator and written straight to the stream — the whole document is never held
    in memory. Resolves on flush; rejects (leaving nothing half-trusted) on any DB or write error. */
export function exportFoldersCsv(db: Db, runId: number, outPath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(outPath, { encoding: "utf8" });
    out.on("error", reject);
    out.on("finish", () => resolve());
    try {
      out.write(CSV_HEADER + "\r\n");
      const iter = db.prepare(CSV_SQL).iterate(runId) as IterableIterator<Record<string, unknown>>;
      for (const r of iter) {
        out.write(
          [r.folder_path, r.file_count, r.stills, r.video, r.audio, r.total_bytes,
            r.oldest_capture, r.newest_capture, r.top_camera, r.formats].map(csvField).join(",") + "\r\n"
        );
      }
      out.end();
    } catch (e) {
      out.destroy();
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}
