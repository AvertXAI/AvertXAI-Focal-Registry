// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Brand icons and logos, at rest inside the encrypted vault file (Jason 08-20-2026).
//              The WHOLE pack is imported, not a per-vault selection: the pack is identical for
//              every install, so nothing about it identifies this user, and a vendor added months
//              later already has its artwork — offline, instantly, with no lookup that could ever
//              phone out. Bytes arrive from a pack the SHELL downloads and unpacks; the vault
//              itself makes no network call for artwork and never learns where the pack came from.
//              Transport to the renderer is base64 because the value crosses the IPC bridge as
//              JSON; at rest it is a real BLOB, matching vault_attachments.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/vault/brandAssets.ts
//------------------------------------------------------------
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { nowIso, type Db } from "./db";
import { generateUUIDv7 } from "../utils/uuidv7";

export type BrandKind = "icon" | "logo";
/** A brand ships light- and dark-background artwork; the wrong one is invisible on a card. */
export type BrandVariant = "light" | "dark" | "";

/** One asset must never be a denial-of-service in a pack import. A 512px PNG runs well under this. */
const MAX_BYTES = 2 * 1024 * 1024;
/** Guard against a corrupt or hostile pack directory. Real packs run ~2,000 files. */
const MAX_FILES = 20000;

const DOMAIN_RE = /^[a-z0-9][a-z0-9.-]{0,252}\.[a-z]{2,}$/;

const MIME_BY_EXT: Record<string, string> = {
  svg: "image/svg+xml", png: "image/png", ico: "image/x-icon",
  jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
};

export interface BrandAsset {
  domain: string;
  kind: BrandKind;
  variant: BrandVariant;
  mime: string;
  dataBase64: string;
}

export interface PackImportResult {
  packVersion: string;
  imported: number;
  skipped: number;
  bytes: number;
}

/**
 * Filenames are `<domain>.<ext>` or `<domain>-<variant>.<ext>`, matching the shape the
 * brand-icons manifest already uses ("amazon-light.svg"). Anything else is skipped rather
 * than guessed at — a mis-parsed name silently renders the wrong company's mark.
 */
function parseAssetName(file: string): { domain: string; variant: BrandVariant; mime: string } | null {
  const dot = file.lastIndexOf(".");
  if (dot <= 0) return null;
  const mime = MIME_BY_EXT[file.slice(dot + 1).toLowerCase()];
  if (!mime) return null;

  let stem = file.slice(0, dot).toLowerCase();
  let variant: BrandVariant = "";
  for (const v of ["light", "dark"] as const) {
    if (stem.endsWith(`-${v}`)) { variant = v; stem = stem.slice(0, -(v.length + 1)); break; }
  }
  return DOMAIN_RE.test(stem) ? { domain: stem, variant, mime } : null;
}

/**
 * Replace the stored pack with the one unpacked at `packDir`. Whole-pack replace, not a merge:
 * a partial overlay leaves last month's artwork for any vendor the new pack dropped, and there
 * is no cheap way to tell that apart from a fresh import that simply skipped a bad file.
 *
 * Runs in ONE transaction — a half-imported pack would render a card grid with holes in it.
 * `packDir` holds `icons/` and `logos/`; either may be absent.
 */
export function importBrandPack(
  db: Db,
  orgId: string,
  packDir: string,
  packVersion: string
): PackImportResult {
  if (typeof packVersion !== "string" || packVersion.trim() === "") {
    throw new Error("A brand pack must carry a version.");
  }

  type Row = [string, string, string, BrandKind, BrandVariant, string, number, Buffer, string, string];
  const rows: Row[] = [];
  let skipped = 0;
  let bytes = 0;
  let seen = 0;

  for (const kind of ["icon", "logo"] as const) {
    const dir = join(packDir, kind === "icon" ? "icons" : "logos");
    let files: string[];
    try { files = readdirSync(dir); } catch { continue; }   // a pack may ship only one of the two

    for (const file of files) {
      if (++seen > MAX_FILES) throw new Error("That brand pack holds an implausible number of files.");
      const parsed = parseAssetName(file);
      if (!parsed) { skipped++; continue; }

      const full = join(dir, file);
      let buf: Buffer;
      try {
        if (!statSync(full).isFile()) { skipped++; continue; }
        buf = readFileSync(full);
      } catch { skipped++; continue; }

      if (buf.length === 0 || buf.length > MAX_BYTES) { skipped++; continue; }
      bytes += buf.length;
      rows.push([
        generateUUIDv7(), orgId, parsed.domain, kind, parsed.variant,
        parsed.mime, buf.length, buf, packVersion, nowIso(),
      ]);
    }
  }

  const insert = db.prepare(
    `INSERT INTO vault_brand_assets
       (uuid, org_id, domain, kind, variant, mime, byte_count, bytes, pack_version, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (org_id, domain, kind, variant) DO UPDATE SET
       mime = excluded.mime, byte_count = excluded.byte_count, bytes = excluded.bytes,
       pack_version = excluded.pack_version, updated_at = excluded.created_at`
  );
  const wipe = db.prepare("DELETE FROM vault_brand_assets WHERE org_id = ?");

  db.transaction(() => {
    wipe.run(orgId);
    for (const r of rows) insert.run(...r);
  })();

  return { packVersion, imported: rows.length, skipped, bytes };
}

/**
 * The render lookup. `logo` falls back to the icon, because a card showing the small mark beats
 * a card showing nothing — a missing asset is cosmetic here, never a broken tile.
 * Variant preference degrades to the unvariant file, which every pack entry has.
 */
export function brandAssetFor(
  db: Db,
  orgId: string,
  domain: unknown,
  kind: BrandKind = "logo",
  prefer: BrandVariant = ""
): BrandAsset | null {
  if (typeof domain !== "string" || !DOMAIN_RE.test(domain)) return null;

  const kinds: BrandKind[] = kind === "logo" ? ["logo", "icon"] : ["icon", "logo"];
  const variants: BrandVariant[] = prefer ? [prefer, ""] : [""];

  const stmt = db.prepare(
    `SELECT domain, kind, variant, mime, bytes FROM vault_brand_assets
      WHERE org_id = ? AND domain = ? AND kind = ? AND variant = ? LIMIT 1`
  );
  for (const k of kinds) {
    for (const v of variants) {
      const row = stmt.get(orgId, domain, k, v) as
        | { domain: string; kind: BrandKind; variant: BrandVariant; mime: string; bytes: Buffer }
        | undefined;
      if (row) {
        return {
          domain: row.domain, kind: row.kind, variant: row.variant, mime: row.mime,
          dataBase64: Buffer.from(row.bytes).toString("base64"),
        };
      }
    }
  }
  return null;
}

/** What the shell compares against the published pack version to decide whether to download. */
export function brandPackStatus(db: Db, orgId: string): { packVersion: string | null; count: number; bytes: number } {
  const row = db
    .prepare(
      `SELECT pack_version AS packVersion, COUNT(*) AS count, COALESCE(SUM(byte_count), 0) AS bytes
         FROM vault_brand_assets WHERE org_id = ?`
    )
    .get(orgId) as { packVersion: string | null; count: number; bytes: number } | undefined;
  return row?.count ? row : { packVersion: null, count: 0, bytes: 0 };
}
