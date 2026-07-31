// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Scan error classifier — turns a logged scan issue (stage + errno code + raw text)
//              into a plain-English line and a likely-cause hint. Renderer-safe (no Node imports):
//              consumed by the Logged-Issues modal AND the report writer. The RAW text is NEVER
//              replaced by this — callers always keep and show error_text as technical detail.
//              Detection is code-based classification, NOT a hand-curated string catalogue: fs
//              errors carry a stable Node/libuv errno token; library-parse errors carry none and
//              fall to a small set of stage/text patterns, then to an honest generic wrapper.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: src/shared/scanErrors.ts
//------------------------------------------------------------

// The ONE category that is evidence of a physically failing/disconnected drive is "disk-read".
// Everything else says NOTHING about drive health — an empty or corrupt file is not a bad disk.
export type ScanErrorCategory =
  | "disk-read"
  | "permission"
  | "locked"
  | "vanished"
  | "path"
  | "resources"
  | "empty"
  | "unreadable-media"
  | "metadata"
  | "write"
  | "other";

export interface ScanErrorExplanation {
  category: ScanErrorCategory;
  plain: string; // one plain-English sentence
  hint: string; // likely cause / what to do
}

// Grouping labels + the drive-failure flag. `diskFailure` is true ONLY for disk-read — the run-level
// "could not read from disk" alarm keys off this and nothing else.
export const CATEGORY_META: Record<ScanErrorCategory, { label: string; diskFailure: boolean }> = {
  "disk-read": { label: "could not read from disk", diskFailure: true },
  permission: { label: "permission denied", diskFailure: false },
  locked: { label: "file in use", diskFailure: false },
  vanished: { label: "vanished mid-scan", diskFailure: false },
  path: { label: "path problem", diskFailure: false },
  resources: { label: "system busy", diskFailure: false },
  empty: { label: "empty file", diskFailure: false },
  "unreadable-media": { label: "unreadable media", diskFailure: false },
  metadata: { label: "metadata unreadable", diskFailure: false },
  write: { label: "report write problem", diskFailure: false },
  other: { label: "other issue", diskFailure: false },
};

// errno tokens a READ-ONLY scan can realistically raise (fs.lstatSync / readdirSync), plus the two
// write-only codes for the report step. Not exhaustive by design — an unmapped code falls through to
// the stage/text patterns then the generic wrapper, and the raw text is always shown regardless.
const CODE_MAP: Record<string, ScanErrorExplanation> = {
  EACCES: { category: "permission", plain: "Permission denied — the operating system blocked read access to this file.", hint: "Usually a system or another-user file; safe to ignore, or run as administrator to include it." },
  EPERM: { category: "permission", plain: "Operation not permitted — the operating system blocked access to this file.", hint: "Typically a protected system file; safe to ignore." },
  EBUSY: { category: "locked", plain: "File is in use — another program has it locked open.", hint: "Close the app using it (editor, sync client, player) and rescan; nothing is wrong with the file." },
  ENOENT: { category: "vanished", plain: "File no longer exists — it was moved or deleted during the scan.", hint: "Normal when files change mid-scan; rescan to capture the current state." },
  ENOTDIR: { category: "path", plain: "A folder in the path is not actually a folder.", hint: "Often a broken junction or reparse point; safe to ignore." },
  EISDIR: { category: "other", plain: "Expected a file but found a folder.", hint: "Rare; safe to ignore." },
  ELOOP: { category: "path", plain: "Symbolic-link loop — the path points back into itself.", hint: "A circular shortcut or junction; the scanner skips it. Safe to ignore." },
  ENAMETOOLONG: { category: "path", plain: "Path is too long for Windows to open (over 260 characters).", hint: "Shorten the folder names or enable long-path support, then rescan." },
  EMFILE: { category: "resources", plain: "Too many files open at once — the scanner hit the open-file limit.", hint: "Transient; rescan and it usually clears on its own." },
  ENFILE: { category: "resources", plain: "The whole system hit its open-file limit.", hint: "Close other programs and rescan." },
  EAGAIN: { category: "resources", plain: "The system was momentarily too busy to read the file.", hint: "Transient; rescan to retry." },
  EIO: { category: "disk-read", plain: "Disk read error — the drive failed to return this file's data.", hint: "This is a hardware read failure. Back up the drive now and check it with the manufacturer's tool." },
  ENXIO: { category: "disk-read", plain: "Device not responding — the drive stopped answering.", hint: "Often a failing or disconnected drive; check the cable or connection and the drive's health." },
  ENODEV: { category: "disk-read", plain: "No such device — the drive disconnected during the scan.", hint: "Reconnect the drive and rescan; if it keeps dropping, the drive or cable may be failing." },
  ENOSPC: { category: "write", plain: "No space left — the report could not be written.", hint: "Free up space on the destination and rescan." },
  EROFS: { category: "write", plain: "Destination is read-only — the report could not be written.", hint: "Choose a writable location for the report." },
  EINVAL: { category: "other", plain: "The system rejected the read as invalid.", hint: "Rare; the technical details below identify the file." },
};

/** Classify a logged scan issue. `code` is the errno token when the source was an fs call (else null);
    library-parse errors carry no code and are matched by stage/text. Never hides the raw text — the
    caller keeps error_text and shows it as a technical-details line. Unmapped input yields an honest
    generic wrapper, so an unclassified error reads no worse than the raw text alone. */
export function explainScanError(
  stage: string | null,
  code: string | null,
  rawText: string | null
): ScanErrorExplanation {
  if (code && CODE_MAP[code]) return CODE_MAP[code];
  const raw = (rawText ?? "").toLowerCase();
  if (/empty \(0 bytes\)|\bis empty\b/.test(raw))
    return { category: "empty", plain: "File is empty (0 bytes) — there is no media data to read.", hint: "Often a leftover stub or an interrupted copy; safe to ignore or delete." };
  if (stage === "media")
    return { category: "unreadable-media", plain: "Could not read this file's media container — it may be corrupt or not real media.", hint: "The metadata could not be parsed; the file itself may still open in a player." };
  if (stage === "exif")
    return { category: "metadata", plain: "Could not read this image's embedded metadata.", hint: "The pixels are unaffected; only the EXIF header could not be parsed." };
  if (stage === "write")
    return { category: "write", plain: "Could not write the scan report to this destination.", hint: "Check the destination is connected and writable, then rescan." };
  return { category: "other", plain: "Could not read this item while scanning.", hint: "See the technical details below to identify it." };
}

// Self-check (ponytail): run with `node --loader ... ` is overkill; assert the load-bearing branches.
// Guarded so it never runs in the bundled app.
export function __scanErrorsSelfCheck(): void {
  const eq = (a: unknown, b: unknown, m: string) => { if (a !== b) throw new Error(`scanErrors self-check: ${m} (got ${String(a)})`); };
  eq(explainScanError("stat", "EIO", "read error").category, "disk-read", "EIO is disk-read");
  eq(CATEGORY_META["disk-read"].diskFailure, true, "disk-read is the drive-failure category");
  eq(CATEGORY_META.empty.diskFailure, false, "empty is NOT drive failure");
  eq(explainScanError("media", null, "file is empty (0 bytes) — no media data to read").category, "empty", "empty text → empty");
  eq(explainScanError("media", null, "unrecognized or unreadable media container").category, "unreadable-media", "media parse → unreadable-media");
  eq(explainScanError("exif", null, "boom").category, "metadata", "exif → metadata");
  eq(explainScanError("stat", "ZZUNKNOWN", "weird").category, "other", "unknown code → other, no throw");
}
