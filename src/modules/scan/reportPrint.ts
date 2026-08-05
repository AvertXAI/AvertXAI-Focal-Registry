// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: PDF export presentation — a DEDICATED print renderer + stylesheet, deliberately
//              SEPARATE from the on-screen Reading view (renderReport in ScanModule). Changing the
//              Reading view can never silently change the PDF, and vice-versa. Parses the report .md
//              (our own generated format) into a print-optimized document: title block, a two-column
//              drive-summary table with rules, rollup tables (formats / cameras / codecs), and one
//              break-inside-avoid section per folder with a monospace path heading that breaks on
//              path separators, not mid-word. Page header (drive label) and footer ("Page N of M")
//              are added by printToPDF in the main process, not here.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: src/modules/scan/reportPrint.ts
//------------------------------------------------------------
import { formatStamp } from "../../shared/datetime";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// Insert a zero-width break opportunity AFTER each backslash so a long path wraps ONLY on separators
// (with word-break:keep-all in the CSS), never mid-word.
const pathBreaks = (p: string): string => esc(p).replace(/\\/g, "\\<wbr>").replace(/\//g, "/<wbr>");
const stripQuotes = (s: string): string => s.replace(/^"|"$/g, "");

/** Frontmatter as a key→raw-value map (values are raw strings, incl. JSON blobs and quoted strings). */
function frontmatter(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") return out;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") break;
    const idx = lines[i].indexOf(":");
    if (idx > 0) out[lines[i].slice(0, idx).trim()] = lines[i].slice(idx + 1).trim();
  }
  return out;
}

/** "{ "png": 11037, ... }" → [[png,11037], …], most first. Empty/{}=[]. */
function jsonPairs(raw: string): Array<[string, string]> {
  if (!raw || !raw.startsWith("{")) return [];
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    return Object.entries(o).map(([k, v]) => [k, typeof v === "number" ? v.toLocaleString() : String(v)]);
  } catch {
    return [];
  }
}

/** The drive label for the running page header — main process reads this off the frontmatter. */
export function reportDriveLabel(content: string): string {
  return stripQuotes(frontmatter(content).drive_label ?? "");
}

function rollupTable(title: string, pairs: Array<[string, string]>): string {
  if (pairs.length === 0) return "";
  const rows = pairs.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${esc(v)}</td></tr>`).join("");
  return `<h2 class="pr-h">${esc(title)}</h2><table class="pr-tbl roll"><tbody>${rows}</tbody></table>`;
}

/** Build the print HTML for the PDF from the report .md content. */
export function renderReportPrintHtml(content: string): string {
  const fm = frontmatter(content);
  const label = stripQuotes(fm.drive_label ?? "");
  const title = stripQuotes(fm.title ?? `Scan report — ${label}`);
  const scanned = fm.scanned_at ? formatStamp(stripQuotes(fm.scanned_at), "eventTime") : "—";

  // 3.1 title block
  const titleBlock =
    `<div class="pr-titleblock">` +
    `<div class="pr-title">${esc(title)}</div>` +
    `<div class="pr-meta-row">` +
    `Drive <b>${esc(label || "—")}</b> &nbsp;·&nbsp; Volume serial <b>${esc(stripQuotes(fm.volume_serial ?? "—"))}</b> ` +
    `&nbsp;·&nbsp; Scanned <b>${esc(scanned)}</b> &nbsp;·&nbsp; Run <b>#${esc(fm.run_id ?? "—")}</b>` +
    `</div></div>`;

  // 3.2 drive summary as a real two-column table (reuse the body's already-formatted summary table).
  const body = content.split(/\n---\n/).slice(1).join("\n---\n") || content;
  const summaryRows: string[] = [];
  const tableLines = body.split("\n").filter((l) => l.trim().startsWith("|"));
  for (const l of tableLines) {
    const cells = l.replace(/^\s*\||\|\s*$/g, "").split("|").map((c) => c.trim());
    if (cells.length !== 2 || cells[0] === "" || /^-+$/.test(cells[0])) continue; // skip header/sep/empty
    summaryRows.push(`<tr><td>${esc(cells[0])}</td><td>${esc(cells[1].replace(/`/g, ""))}</td></tr>`);
  }
  const summary = summaryRows.length
    ? `<h2 class="pr-h">Drive summary</h2><table class="pr-tbl kv"><tbody>${summaryRows.join("")}</tbody></table>`
    : "";

  // 3.3 rollups as tables
  const rollups =
    rollupTable("Formats — stills", jsonPairs(fm.formats_stills ?? "")) +
    rollupTable("Formats — video", jsonPairs(fm.formats_video ?? "")) +
    rollupTable("Formats — audio", jsonPairs(fm.formats_audio ?? "")) +
    rollupTable("Cameras", jsonPairs(fm.cameras ?? "")) +
    rollupTable("Video codecs", jsonPairs(fm.video_codecs ?? "")) +
    rollupTable("Audio codecs", jsonPairs(fm.audio_codecs ?? ""));

  // 3.4 folder sections. RESTRUCTURED 08-05-2026: the drive location is the title, and its stats
  // read as two prose lines beneath it instead of one long run of chips:
  //     line 1 — capture range · size · top camera   (WHEN and HOW BIG: the orienting facts)
  //     line 2 — media files · formats               (WHAT is in there: the detail)
  // The source markdown emits them in a different order (media, size, formats, capture), so each
  // line is picked out BY LABEL rather than by position — a reordering upstream cannot silently
  // scramble the output. "Top camera" arrives appended to the capture-range line, so it rides
  // along with it for free.
  const sections: string[] = [];
  const parts = body.split(/\n## /).slice(1); // everything after the first "## "
  for (const part of parts) {
    const lines = part.split("\n");
    const p = lines[0].trim();
    const stats = lines
      .slice(1)
      .filter((l) => l.trim().startsWith("- "))
      .map((l) => l.trim().replace(/^- /, "").replace(/`/g, ""));
    const pick = (label: string): string | null =>
      stats.find((l) => l.toLowerCase().startsWith(label.toLowerCase())) ?? null;
    const line1 = [pick("Capture range"), pick("Size")].filter(Boolean).join(" · ");
    const line2 = [pick("Media files"), pick("Formats")].filter(Boolean).join(" · ");
    // Anything the two lines did not claim still prints, so a future stat cannot vanish silently.
    const claimed = ["capture range", "size", "media files", "formats"];
    const rest = stats.filter((l) => !claimed.some((c) => l.toLowerCase().startsWith(c)));
    sections.push(
      `<div class="pr-folder"><div class="pr-path">${pathBreaks(p)}</div>` +
        (line1 ? `<p class="pr-stats">${esc(line1)}</p>` : "") +
        (line2 ? `<p class="pr-stats">${esc(line2)}</p>` : "") +
        rest.map((l) => `<p class="pr-stats">${esc(l)}</p>`).join("") +
        `</div>`
    );
  }
  const foldersHeading = sections.length ? `<h2 class="pr-h">Folders — top level</h2>` : "";

  // TWO COLUMNS. Each .pr-folder is break-inside:avoid, so an entry flows to the next column rather
  // than splitting across it. If long paths crowd, the column rule and the path's own break
  // behaviour absorb it — and one column per page is an acceptable outcome if they do not fit.
  const foldersBlock = sections.length ? `<div class="pr-folders">${sections.join("")}</div>` : "";

  return titleBlock + summary + rollups + foldersHeading + foldersBlock;
}

// 3.6/3.7 — the print stylesheet lives HERE, in its own file, never shared with the Reading view.
// Letter body 10.5pt, generous leading; tables ruled; folder sections never orphan a heading.
export const PRINT_STYLESHEET = `
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { font: 10.5pt/1.5 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #1a1a1a; }
  .pr-titleblock { border-bottom: 2px solid #333; padding-bottom: 10pt; margin-bottom: 14pt; }
  .pr-title { font-size: 20pt; font-weight: 700; margin: 0 0 4pt; line-height: 1.2; }
  .pr-meta-row { font-size: 9.5pt; color: #444; }
  h2.pr-h { font-size: 13pt; font-weight: 700; margin: 16pt 0 6pt; border-bottom: 1px solid #bbb;
            padding-bottom: 3pt; break-after: avoid; page-break-after: avoid; }
  table.pr-tbl { border-collapse: collapse; width: 100%; margin: 2pt 0 12pt; font-size: 10pt; }
  table.pr-tbl td, table.pr-tbl th { text-align: left; padding: 4pt 8pt; border-bottom: 1px solid #ddd;
            vertical-align: top; }
  table.pr-tbl.kv td:first-child { color: #555; width: 32%; white-space: nowrap; }
  table.pr-tbl.roll td:first-child { width: 70%; }
  table.pr-tbl .num, table.pr-tbl.roll td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
  .pr-folder { break-inside: avoid; page-break-inside: avoid; margin: 0 0 11pt; }
  .pr-path { font-family: ui-monospace, Consolas, "Courier New", monospace; font-size: 10pt; font-weight: 700;
            word-break: keep-all; overflow-wrap: normal; margin: 0 0 3pt; color: #111; }
  .pr-stats { font-size: 9.5pt; color: #333; margin: 0 0 1pt; line-height: 1.35; }
  .pr-stats span { margin-right: 12pt; white-space: nowrap; }
  /* Two columns for the folder list. column-fill:auto fills the first column before starting the
     second, which reads top-to-bottom like a list rather than balancing into two short stubs. */
  .pr-folders { column-count: 2; column-gap: 18pt; column-rule: 1px solid #e2e2e2; column-fill: auto; }
`;
