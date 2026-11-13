// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Export one MindMerge document to disk — a Markdown file plus a "<name>_files" folder
//              holding its pasted images, linked by relative path so the pair travels as one unit.
//              ELECTRON-FREE on purpose: the save dialog and the attachment store stay in ipc.ts
//              and arrive here as a path and a reader, so this file runs in a plain Node harness.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/mindmerge/exportNote.ts
//------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";

export interface ExportedNote {
  path: string;
  /** Pictures written into the "_files" folder. */
  images: number;
  /** Pictures a link names that are no longer in MindMerge. Their links are left as written. */
  missing: number;
}

export type AttachmentReader = (uuid: string) => { name: string; mime: string; dataBase64: string };

// The locator shape attachments.ts validates. Unanchored and global so the plain, titled and
// angle-bracket link forms all match; the lookahead leaves an over-long id alone rather than
// cutting it down to some other picture's.
const REF_RE = /mindmerge:\/\/([0-9a-fA-F-]{36})(?![0-9a-fA-F-])/g;

// attachments.ts keeps its copy of this map private. The extension comes from the stored type, not
// from the pasted name, so a file never claims a format its bytes are not.
const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif",
  "image/webp": "webp", "image/svg+xml": "svg", "image/bmp": "bmp",
  // The store accepts any image type, so a dropped file can carry one of these. Without an entry
  // it would be written as .png over bytes that are not PNG.
  "image/avif": "avif", "image/tiff": "tif", "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico", "image/heic": "heic", "image/heif": "heif",
};

/**
 * A name Windows will accept as a file name: no reserved characters, no trailing dot or space, no
 * device name. Lone surrogates go too — a name cut mid-emoji makes encodeURIComponent throw.
 */
export function safeFileStem(title: string, fallback = "Untitled"): string {
  const cleaned = title.replace(/\s+/g, " ").replace(/[<>:"\/\\|?*\x00-\x1f\p{Cs}]/gu, "-").trim();
  let stem = Array.from(cleaned).slice(0, 120).join("").replace(/[. ]+$/, "");
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(stem)) stem = `_${stem}`;
  return stem || fallback;
}

/** encodeURIComponent leaves parentheses alone, and a bare one ends a Markdown link early. */
function encodeLinkPart(part: string): string {
  return encodeURIComponent(part).replace(/\(/g, "%28").replace(/\)/g, "%29");
}

function pictureFileName(name: string, mime: string, taken: Set<string>): string {
  const ext = EXT_BY_MIME[mime] ?? "png";
  const stem = safeFileStem(name.replace(/\.[A-Za-z0-9]{1,5}$/, ""), "image");
  let file = `${stem}.${ext}`;
  // Compared lower-cased: "Shot.png" and "shot.png" are one file on Windows.
  for (let n = 2; taken.has(file.toLowerCase()); n += 1) {
    file = `${stem}-${String(n).padStart(2, "0")}.${ext}`;
  }
  taken.add(file.toLowerCase());
  return file;
}

/**
 * Writes the note to `filePath` and its pictures into a sibling "<file name>_files" folder. The
 * stored note and its pictures are only read. An earlier export to the same name is overwritten —
 * the save dialog has asked about the .md by then.
 */
export function exportNoteTo(
  filePath: string,
  note: { title: string; body: string },
  readAttachment: AttachmentReader
): ExportedNote {
  const dir = path.dirname(filePath);
  // From the CHOSEN name, not the title: renaming in the save dialog must rename the folder too.
  const dirName = `${path.basename(filePath, path.extname(filePath))}_files`;
  const links = new Map<string, string | null>(); // uuid as written → relative link, null = missing
  const taken = new Set<string>();
  const filesDir = path.join(dir, dirName);
  // The save dialog only asks about the .md. A "_files" folder with no .md beside it was not made
  // by an earlier export to this name, so its files are stepped around rather than replaced unasked.
  if (!fs.existsSync(filePath) && fs.existsSync(filesDir)) {
    for (const existing of fs.readdirSync(filesDir)) taken.add(existing.toLowerCase());
  }
  let images = 0;
  let missing = 0;
  for (const m of note.body.matchAll(REF_RE)) {
    const uuid = m[1];
    if (links.has(uuid)) continue;
    let found: ReturnType<AttachmentReader>;
    try {
      found = readAttachment(uuid);
    } catch {
      // Nothing ties a picture to its note in the store, so a dangling link is a normal case.
      links.set(uuid, null);
      missing += 1;
      continue;
    }
    const file = pictureFileName(found.name, found.mime, taken);
    // Created only now, so a note with no picture that resolves leaves no empty folder behind.
    if (images === 0) fs.mkdirSync(filesDir, { recursive: true });
    fs.writeFileSync(path.join(filesDir, file), Buffer.from(found.dataBase64, "base64"));
    links.set(uuid, `${encodeLinkPart(dirName)}/${encodeLinkPart(file)}`);
    images += 1;
  }
  const body = note.body.replace(REF_RE, (whole, uuid: string) => links.get(uuid) ?? whole).trim();
  const title = note.title.trim();
  // NotesView's sourceText rule: the title leads as a heading unless the body already opens with one.
  const text = !title || /^#\s/.test(body) ? body : `# ${title}\n\n${body}`;
  fs.writeFileSync(filePath, `${text}\n`, "utf8");
  return { path: filePath, images, missing };
}
