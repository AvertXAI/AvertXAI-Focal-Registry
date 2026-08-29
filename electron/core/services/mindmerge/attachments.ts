// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Pasted-image attachments for MindMerge documents — the bytes live in the encrypted
//              attachments file (<org_id>.mtd), the document body carries only
//              `![name](mindmerge://<uuid>)` (Jason 08-16-2026, against the base64 wall the
//              data-URL paste produced; the Joplin `:/id` shape). Images only for now — the 08-12
//              ruling covers what a user pastes into their own document; widening to PDFs is its
//              own decision when it is asked for. Transport is base64 because the value crosses the
//              IPC bridge as JSON; at rest it is a real BLOB, not text. VERBATIM copy of
//              electron/core/services/vault/attachments.ts (Phase 5 addendum) — table name and
//              product-name strings are the only deltas.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
//              One further delta the header must own: generateUUIDv7/nowIso import from ./db (the
//              module's self-contained copies) instead of ../utils — same algorithm, verified.
// File: electron/core/services/mindmerge/attachments.ts
//------------------------------------------------------------
import { nowIso, generateUUIDv7, type Db } from "./db";

export interface MindMergeAttachmentMeta {
  uuid: string;
  name: string;
  mime: string;
  byteCount: number;
}

/** Decoded ceiling. A 4K PNG screenshot runs 2–8 MB; 20 MB is headroom, not an invitation —
    an unbounded BLOB column in a file the user carries is a denial-of-service in a paste. */
const MAX_BYTES = 20 * 1024 * 1024;

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

function extFor(mime: string): string {
  const m: Record<string, string> = {
    "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif",
    "image/webp": "webp", "image/svg+xml": "svg", "image/bmp": "bmp",
  };
  return m[mime] ?? "png";
}

export function saveAttachment(
  db: Db,
  orgId: string,
  input: unknown
): MindMergeAttachmentMeta {
  const i = (input ?? {}) as { name?: unknown; mime?: unknown; dataBase64?: unknown };
  const mime = typeof i.mime === "string" ? i.mime.toLowerCase().slice(0, 100) : "";
  if (!mime.startsWith("image/")) throw new Error("Only images can be attached to a note right now.");
  if (typeof i.dataBase64 !== "string" || i.dataBase64 === "") throw new Error("The pasted image arrived empty.");
  const bytes = Buffer.from(i.dataBase64, "base64");
  if (bytes.length === 0) throw new Error("The pasted image arrived empty.");
  if (bytes.length > MAX_BYTES) {
    throw new Error(`That image is ${Math.round(bytes.length / 1048576)} MB — the ceiling for a pasted image is ${MAX_BYTES / 1048576} MB.`);
  }
  const name =
    typeof i.name === "string" && i.name.trim() !== ""
      ? i.name.trim().slice(0, 200)
      : `pasted-image.${extFor(mime)}`;
  const uuid = generateUUIDv7();
  const at = nowIso();
  db.prepare(
    `INSERT INTO mindmerge_attachments (uuid, org_id, name, mime, byte_count, bytes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(uuid, orgId, name, mime, bytes.length, bytes, at);
  return { uuid, name, mime, byteCount: bytes.length };
}

export function getAttachment(
  db: Db,
  orgId: string,
  uuid: unknown
): { name: string; mime: string; dataBase64: string } {
  if (typeof uuid !== "string" || !UUID_RE.test(uuid)) throw new Error("Invalid attachment locator");
  const row = db
    .prepare("SELECT name, mime, bytes FROM mindmerge_attachments WHERE org_id = ? AND uuid = ?")
    .get(orgId, uuid) as { name: string; mime: string; bytes: Buffer } | undefined;
  if (!row) throw new Error("That image is no longer in MindMerge.");
  return { name: row.name, mime: row.mime, dataBase64: Buffer.from(row.bytes).toString("base64") };
}
