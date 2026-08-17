// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Finds the export FILE a browser or password manager just wrote, so the user does not
//              have to remember where it landed. This is the achievable half of "auto-import" —
//              locating the plaintext CSV the user already exported, NOT reaching into a live vault.
//
//              WHY IT STOPS AT LOCATING, on purpose:
//              - Password managers (1Password, Bitwarden, LastPass, …) are encrypted vaults with no
//                readable file on disk — their data leaves only through their own export. There is
//                nothing here to read until the user exports.
//              - Chromium's saved passwords are DPAPI-encrypted and, since 2024, App-Bound-Encrypted
//                so that ONLY chrome.exe can read them. Reading them from another process is what
//                Chrome classifies as malware. This module never touches a browser profile — it only
//                looks for a CSV the user deliberately exported.
//
//              THE SCAN READS FILENAMES AND STAT, NEVER CONTENTS. A candidate's bytes are read only
//              when the user picks it and importPreview runs. Nothing here decrypts anything, and no
//              network call exists in this file.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/vault/sources.ts
//------------------------------------------------------------
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

type Dir = "downloads" | "desktop" | "documents";

interface SourceDef {
  /** Where this exporter drops its file by default, best-guess order. */
  dirs: Dir[];
  /** Filename needles (lowercased substring). A hit here is a STRONG match. Empty = any file of the
      right extension counts (used by "Other / CSV" and the archive picker). */
  needles: string[];
  exts: string[];
}

// The twelve import sources, plus the archive. Needles are deliberately loose substrings rather than
// exact names: every vendor renames its export between versions, and a substring survives that where
// a pinned filename does not. The generic pass (below) catches anything password-shaped we missed.
const SOURCES: Record<string, SourceDef> = {
  chrome: { dirs: ["downloads", "desktop"], needles: ["chrome password", "chrome-password"], exts: ["csv"] },
  edge: { dirs: ["downloads", "desktop"], needles: ["edge password", "edge-password"], exts: ["csv"] },
  brave: { dirs: ["downloads", "desktop"], needles: ["brave password", "brave-password"], exts: ["csv"] },
  firefox: { dirs: ["downloads", "desktop", "documents"], needles: ["firefox", "logins"], exts: ["csv"] },
  "1password": { dirs: ["downloads", "desktop"], needles: ["1password", "1passwordexport"], exts: ["csv"] },
  bitwarden: { dirs: ["downloads", "desktop"], needles: ["bitwarden"], exts: ["csv", "json"] },
  lastpass: { dirs: ["downloads", "desktop"], needles: ["lastpass"], exts: ["csv"] },
  dashlane: { dirs: ["downloads", "desktop"], needles: ["dashlane"], exts: ["csv"] },
  keepass: { dirs: ["downloads", "desktop", "documents"], needles: ["keepass"], exts: ["csv"] },
  keeper: { dirs: ["downloads", "desktop"], needles: ["keeper"], exts: ["csv"] },
  roboform: { dirs: ["downloads", "desktop"], needles: ["roboform"], exts: ["csv"] },
  csv: { dirs: ["downloads", "desktop"], needles: [], exts: ["csv", "txt"] },
  archive: { dirs: ["downloads", "desktop"], needles: [], exts: ["json", "avxvault"] },
};

// Words that make a stray CSV look like a password export even when it does not match the chosen
// vendor — surfaced as WEAK matches so "I exported from Chrome but the file is oddly named" still
// turns up, without dredging up every spreadsheet in Downloads.
const PASSWORD_HINTS = ["password", "passwords", "logins", "credential", "vault", "_export", "export-"];

export interface ExportCandidate {
  name: string;
  path: string;
  dir: Dir;
  mtimeMs: number;
  size: number;
  /** True when the filename matches the CHOSEN vendor; false when it merely looks password-shaped. */
  strong: boolean;
}

interface RawFile {
  name: string;
  path: string;
  dir: Dir;
  mtimeMs: number;
  size: number;
}

/** How this file relates to the chosen source. Pure — no filesystem — so it is the part under test. */
export function classify(fileName: string, def: SourceDef): "strong" | "weak" | null {
  const lower = fileName.toLowerCase();
  const ext = path.extname(lower).slice(1);
  if (!def.exts.includes(ext)) return null;
  // Archive and "Other / CSV" have no vendor to match — any file of the right extension is a match,
  // but only a real match, never a weak/hint one (there is no vendor to be unsure about).
  if (def.needles.length === 0) return "strong";
  if (def.needles.some((n) => lower.includes(n))) return "strong";
  if (PASSWORD_HINTS.some((h) => lower.includes(h))) return "weak";
  return null;
}

/** Ranks located files: real matches first, then most-recently-written first. Pure and capped. */
export function rankCandidates(files: RawFile[], def: SourceDef, limit = 8): ExportCandidate[] {
  return files
    .map((f) => ({ f, kind: classify(f.name, def) }))
    .filter((x): x is { f: RawFile; kind: "strong" | "weak" } => x.kind !== null)
    .sort((a, b) => (a.kind === b.kind ? b.f.mtimeMs - a.f.mtimeMs : a.kind === "strong" ? -1 : 1))
    .slice(0, limit)
    .map(({ f, kind }) => ({ ...f, strong: kind === "strong" }));
}

function dirPath(dir: Dir): string | null {
  try {
    return app.getPath(dir);
  } catch {
    return null; // a machine without a Desktop/Documents redirect target — skip it, do not throw
  }
}

/** The directory the "Choose a file" dialog should open in for this source — its first existing
    default location, or Downloads as the universal fallback. */
export function exportDirFor(kind: string): string | undefined {
  const def = SOURCES[kind] ?? SOURCES.csv;
  for (const d of def.dirs) {
    const p = dirPath(d);
    if (p && fs.existsSync(p)) return p;
  }
  return dirPath("downloads") ?? undefined;
}

// ---------------------------------------------------------------- import
/**
 * WHAT EACH TAB ACTUALLY IMPORTS (Jason 08-11-2026 — the first cut had this backwards and pushed a
 * folder picker at every surface):
 *   • Infrastructure — SINGLE FILES. A zone export, a JSON dump, a spreadsheet, a PDF. You point at
 *     the file you just downloaded; there is no folder of them.
 *   • Notes — files OR a folder. One old .md you want to keep, or a whole notes directory.
 *   • Repos — folders. A repo IS a directory, so walking is the right shape there and only there.
 */
export const FILE_FILTERS: Record<string, { name: string; extensions: string[] }[]> = {
  infra: [
    { name: "Infrastructure files", extensions: ["json", "csv", "txt", "zone", "md", "pdf", "xlsx", "xls"] },
    { name: "Zone / DNS exports", extensions: ["txt", "zone", "csv"] },
    { name: "Data", extensions: ["json", "csv", "xlsx", "xls"] },
    { name: "All files", extensions: ["*"] },
  ],
  notes: [
    { name: "Notes and documents", extensions: ["md", "markdown", "txt", "pdf", "json", "jsonl", "csv", "doc", "docx", "xls", "xlsx", "xlsm"] },
    { name: "Text and markdown", extensions: ["md", "markdown", "txt"] },
    { name: "Data", extensions: ["json", "jsonl", "csv"] },
    { name: "All files", extensions: ["*"] },
  ],
  repos: [
    { name: "Documents", extensions: ["md", "txt", "pdf"] },
    { name: "All files", extensions: ["*"] },
  ],
};

/** ONLY these are read on a FOLDER walk. A walk that accepts everything drags in node_modules,
    images and binaries, and the review list stops being reviewable. Everything else is REPORTED as
    skipped, never silently ignored. A file the user picked BY HAND is always accepted — they chose
    it, so second-guessing the extension would be the tool arguing with them. */
/**
 * What a FOLDER WALK will pick up (Jason 08-11-2026 added json, jsonl, doc and the Excel family).
 *
 * Two tiers, and the difference is honesty about what lands in the note:
 *   · READ AS TEXT   — .md .markdown .txt .json .jsonl .csv .zone : the real content is stored.
 *   · STORED AS A STUB — .pdf .doc .docx .xls .xlsx .xlsm : these are binary or zipped-XML formats
 *     that need a parser this product does not carry, and adding one is a dependency decision
 *     (§2.10), not a quiet import. The note says so in its own body rather than pretending the
 *     file came across clean. See the importDocs branch in ipc.ts for the exact wording.
 *
 * A file the user picked BY HAND always imports whatever its extension — they chose it, and
 * second-guessing that would be the tool arguing with them. This list governs the WALK only.
 */
const DOC_EXTS = new Set([
  ".md", ".markdown", ".txt", ".json", ".jsonl", ".csv", ".zone",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".xlsm",
]);
// Folders that are never worth walking — they are machine output, not documents.
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "dist-electron", "release", "out", "build", ".next", "coverage", ".cache"]);

export interface WalkedFile {
  path: string;
  name: string;
  rel: string;
  ext: string;
  size: number;
  /** THE FILE'S OWN DATES, carried through to the note (Jason 08-11-2026). Importing a 2023 runbook
   *  and stamping it "today" throws away the only chronology the archive had. */
  mtimeMs: number;
  birthtimeMs: number;
}

export interface WalkResult {
  files: WalkedFile[];
  /** Counted, not listed — the point is "you skipped 412", not 412 rows of noise. */
  skipped: number;
  skippedDirs: string[];
  truncated: boolean;
}

/**
 * Walks chosen folders for documents. Depth- and count-capped so a wrong folder choice cannot hang
 * the app on a 200k-file tree — and when the cap bites it says so (`truncated`) rather than quietly
 * returning a short list, which would read as "that's all there is".
 *
 * THE CAP WAS 2,000 AND IT BIT A LEGITIMATE IMPORT (Jason 08-11-2026, picking D:\dev\_source).
 * That number was a guess, not a measurement. It is now 25,000 by default and a SETTING
 * (`import.max_files`), because the right ceiling depends on the tree and nobody should need a new
 * build to raise it.
 *
 * WHY A CEILING STILL EXISTS: the walk itself is cheap, but the review list and the import that
 * follows are not — importDocs reads every chosen file. A cap is the difference between "this is
 * taking a while" and a window that stops painting. Depth stays at 6: a documents folder nested
 * deeper than that is almost always a source tree that slipped past SKIP_DIRS.
 */
export function walkForDocs(roots: unknown, maxFiles = 25_000, maxDepth = 6): WalkResult {
  const list = Array.isArray(roots) ? roots.filter((r): r is string => typeof r === "string" && r !== "") : [];
  const out: WalkResult = { files: [], skipped: 0, skippedDirs: [], truncated: false };
  for (const root of list) {
    const base = path.basename(root);
    const walk = (dir: string, depth: number): void => {
      if (out.files.length >= maxFiles) { out.truncated = true; return; }
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (out.files.length >= maxFiles) { out.truncated = true; return; }
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) {
            if (!out.skippedDirs.includes(e.name)) out.skippedDirs.push(e.name);
            continue;
          }
          if (depth < maxDepth) walk(full, depth + 1);
          continue;
        }
        const ext = path.extname(e.name).toLowerCase();
        if (!DOC_EXTS.has(ext)) { out.skipped++; continue; }
        try {
          const st = fs.statSync(full);
          out.files.push({
            path: full, name: e.name, rel: path.join(base, path.relative(root, full)), ext, size: st.size,
            mtimeMs: st.mtimeMs, birthtimeMs: st.birthtimeMs || st.mtimeMs,
          });
        } catch { /* vanished or locked between readdir and stat */ }
      }
    };
    try { if (fs.statSync(root).isDirectory()) walk(root, 0); } catch { /* unreadable root — skip it */ }
  }
  out.files.sort((a, b) => a.rel.localeCompare(b.rel));
  return out;
}

/**
 * Files the user picked BY HAND. No extension filtering — the dialog already narrowed it and they
 * chose deliberately, so refusing one here would be the tool second-guessing the person. Dates come
 * from the file, not from the clock.
 */
export function statPickedFiles(paths: unknown): WalkResult {
  const list = Array.isArray(paths) ? paths.filter((p): p is string => typeof p === "string" && p !== "") : [];
  const out: WalkResult = { files: [], skipped: 0, skippedDirs: [], truncated: false };
  for (const full of list) {
    try {
      const st = fs.statSync(full);
      if (!st.isFile()) continue;
      const name = path.basename(full);
      out.files.push({
        path: full, name, rel: name, ext: path.extname(name).toLowerCase(), size: st.size,
        mtimeMs: st.mtimeMs, birthtimeMs: st.birthtimeMs || st.mtimeMs,
      });
    } catch { /* unreadable — skip rather than fail the whole pick */ }
  }
  return out;
}

/** Scans the source's default directories for its export file. Reads names and stat only; a missing
    or unreadable directory is skipped, never fatal — a broken Desktop path must not hide a good
    Downloads hit. */
export function locateExports(kind: string): ExportCandidate[] {
  const def = SOURCES[kind] ?? SOURCES.csv;
  const seen = new Set<string>();
  const files: RawFile[] = [];
  for (const d of def.dirs) {
    const base = dirPath(d);
    if (!base) continue;
    let names: string[];
    try {
      names = fs.readdirSync(base);
    } catch {
      continue;
    }
    for (const name of names) {
      const full = path.join(base, name);
      if (seen.has(full)) continue;
      seen.add(full);
      try {
        const st = fs.statSync(full);
        if (!st.isFile()) continue;
        files.push({ name, path: full, dir: d, mtimeMs: st.mtimeMs, size: st.size });
      } catch {
        // a file that vanished or is locked between readdir and stat — ignore it
      }
    }
  }
  return rankCandidates(files, def);
}
