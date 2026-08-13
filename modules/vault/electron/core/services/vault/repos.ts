// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Repos and the package ledger. A repo row is metadata plus a PASTED readme snapshot —
//              the vault never fetches it: the product's promise is that exactly two features touch
//              the internet and both live on Health behind a switch. Refreshing a snapshot is a
//              paste, not a pull, until Jason rules otherwise (open question 6, 08-10-2026).
//              The package ledger SCANS the installed tree main-side and rules on licences with the
//              §2.10 lists — green passed without asking, red already decided, amber is the inbox.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/vault/repos.ts
//------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";
import { generateUUIDv7 } from "../utils/uuidv7";
import { nowIso, type Db } from "./db";

export interface VaultRepo {
  id: number;
  uuid: string;
  name: string;
  description: string | null;
  visibility: string | null;
  language: string | null;
  license: string | null;
  stars: string | null;
  version: string | null;
  local_path: string | null;
  remote_url: string | null;
  deploy_secret_uuid: string | null;
  readme_md: string | null;
  updated_at: string | null;
}

const S = (v: unknown, max = 500): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.slice(0, max) : null;

const COLS = "id, uuid, name, description, visibility, language, license, stars, version, local_path, remote_url, deploy_secret_uuid, readme_md, updated_at";

export function listRepos(db: Db, orgId: string): VaultRepo[] {
  return db.prepare(`SELECT ${COLS} FROM vault_repos WHERE org_id = ? ORDER BY name COLLATE NOCASE`).all(orgId) as VaultRepo[];
}

export function saveRepo(db: Db, orgId: string, input: Record<string, unknown>): VaultRepo {
  const name = S(input?.name, 200);
  if (!name) throw new Error("A repo needs a name.");
  const at = nowIso();
  const vals = [
    name, S(input.description, 500), S(input.visibility, 20), S(input.language, 50), S(input.license, 100),
    S(input.stars, 20), S(input.version, 50), S(input.localPath, 500), S(input.remoteUrl, 500),
    S(input.deploySecretUuid, 40), typeof input.readmeMd === "string" ? input.readmeMd.slice(0, 500_000) : null,
  ];
  if (typeof input?.uuid === "string" && input.uuid) {
    db.prepare(`UPDATE vault_repos SET name = ?, description = ?, visibility = ?, language = ?, license = ?, stars = ?, version = ?, local_path = ?, remote_url = ?, deploy_secret_uuid = ?, readme_md = COALESCE(?, readme_md), updated_at = ? WHERE org_id = ? AND uuid = ?`)
      .run(...vals, at, orgId, input.uuid);
    return db.prepare(`SELECT ${COLS} FROM vault_repos WHERE org_id = ? AND uuid = ?`).get(orgId, input.uuid) as VaultRepo;
  }
  const uuid = generateUUIDv7();
  db.prepare(`INSERT INTO vault_repos (uuid, org_id, name, description, visibility, language, license, stars, version, local_path, remote_url, deploy_secret_uuid, readme_md, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(uuid, orgId, ...vals, at);
  return db.prepare(`SELECT ${COLS} FROM vault_repos WHERE org_id = ? AND uuid = ?`).get(orgId, uuid) as VaultRepo;
}

export function deleteRepo(db: Db, orgId: string, uuid: unknown): void {
  if (typeof uuid !== "string") throw new Error("Invalid repo locator");
  db.prepare("DELETE FROM vault_repos WHERE org_id = ? AND uuid = ?").run(orgId, uuid);
}

// ---------------------------------------------------------------- package ledger
export interface PackageRow {
  name: string;
  version: string;
  license: string;
  sizeMb: number;
  verdict: "approved" | "banned" | "needs_ruling";
  why: string;
}

// §2.10 verbatim. "Industry standard" is not a licence.
const ALLOWED = /^(MIT|BSD-2-Clause|BSD-3-Clause|Apache-2\.0|ISC|Unlicense|CC0(-1\.0)?|0BSD|BlueOak-1\.0\.0)$/i;
const BANNED = /GPL|AGPL|LGPL|SSPL|BUSL|PolyForm|Elastic|CC-BY-NC|Commons-Clause/i;

function dirSizeMb(dir: string): number {
  // Shallow-ish walk with a cap — the number is a caption, not an audit; 2 levels catches the bulk.
  let bytes = 0;
  const walk = (d: string, depth: number): void => {
    let names: fs.Dirent[];
    try { names = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const n of names) {
      const p = path.join(d, n.name);
      if (n.isDirectory()) { if (depth < 3) walk(p, depth + 1); }
      else { try { bytes += fs.statSync(p).size; } catch { /* locked file — skip */ } }
    }
  };
  walk(dir, 0);
  return Math.round((bytes / 1_048_576) * 10) / 10;
}

/**
 * Reads the app's OWN package.json + node_modules, rules per §2.10/§2.11. Direct dependencies only —
 * the transitive tree is thousands of rows of noise; the licence obligation attaches at what we
 * chose to install. Main-side fs, nothing stored: the ledger is a live reading of the tree.
 */
export function scanPackages(appRoot: string): { packages: PackageRow[]; totalMb: number } {
  const out: PackageRow[] = [];
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8"));
  } catch {
    return { packages: [], totalMb: 0 };
  }
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  let totalMb = 0;
  for (const name of Object.keys(deps).sort()) {
    const dir = path.join(appRoot, "node_modules", ...name.split("/"));
    let license = "?";
    let version = deps[name];
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
      version = meta.version ?? version;
      license = typeof meta.license === "string" ? meta.license : meta.license?.type ?? "?";
    } catch { /* not installed — licence stays "?" and the verdict says so */ }
    const sizeMb = fs.existsSync(dir) ? dirSizeMb(dir) : 0;
    totalMb += sizeMb;
    let verdict: PackageRow["verdict"];
    let why: string;
    if (BANNED.test(license)) { verdict = "banned"; why = `${license} — §2.10 stops the line`; }
    else if (ALLOWED.test(license)) { verdict = "approved"; why = "Permissive, auto-passed"; }
    else { verdict = "needs_ruling"; why = license === "?" ? "Licence undeterminable — §2.10 stops the line" : `${license} — not on the allowed list`; }
    if (verdict === "approved" && sizeMb > 20) why += ` · over 20 MB (§2.11)`;
    out.push({ name, version, license, sizeMb, verdict, why });
  }
  return { packages: out, totalMb: Math.round(totalMb) };
}

// ---------------------------------------------------------------- local clone discovery
/**
 * WALK A FOLDER FOR GIT CLONES (Jason 08-11-2026 — "i want to know what I have locally").
 *
 * ENTIRELY LOCAL. No network, ever. `.git/config` already records the remote a clone was made from,
 * so the Repos list can show BOTH origin icons — on this drive, and has a remote — without the Vault
 * calling anything. Reading a repository from the internet is MindMerge's job, deliberately.
 *
 * Depth-limited and it does NOT descend into a repo once found: a clone contains node_modules,
 * vendor trees and sometimes submodules, and walking those turns a two-second scan into a minute.
 */
const SCAN_MAX_DEPTH = 3;
const SCAN_SKIP = new Set(["node_modules", ".git", "dist", "build", "out", "vendor", ".next", "target", "__pycache__"]);

export interface FoundRepo {
  name: string;
  localPath: string;
  remoteUrl: string;
  branch: string;
}

/** Pull the origin fetch URL out of a .git/config. Plain INI — no parser dependency for ~15 lines. */
export function parseGitRemote(configText: unknown): string {
  const text = typeof configText === "string" ? configText : "";
  if (!text) return "";
  const lines = text.split(/\r?\n/);
  // TWO flags, not one. `inRemote` is what makes a url countable at all — a `url =` under [core] or
  // any other section is NOT a remote, and treating it as one puts junk on the repo row. Caught by
  // notes-proof, which is exactly the fourth-edge-case this parser was going to get wrong.
  let inRemote = false;
  let inOrigin = false;
  let firstAny = "";
  for (const raw of lines) {
    const line = raw.trim();
    const section = line.match(/^\[remote\s+"([^"]+)"\]$/);
    if (section) { inRemote = true; inOrigin = section[1] === "origin"; continue; }
    if (line.startsWith("[")) { inRemote = false; inOrigin = false; continue; }
    if (!inRemote) continue;
    const url = line.match(/^url\s*=\s*(.+)$/);
    if (url) {
      const v = (url[1] ?? "").trim();
      if (inOrigin) return v;          // origin wins outright
      if (!firstAny) firstAny = v;     // otherwise remember the first remote we saw
    }
  }
  return firstAny;
}

/** The checked-out branch, read from .git/HEAD. Cosmetic, and absent on a detached head. */
function headBranch(gitDir: string): string {
  try {
    const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    const m = head.match(/^ref:\s*refs\/heads\/(.+)$/);
    return m ? (m[1] ?? "") : "";
  } catch {
    return "";
  }
}

export function scanLocalRepos(root: unknown): { found: FoundRepo[]; scanned: number } {
  const start = typeof root === "string" ? root : "";
  const found: FoundRepo[] = [];
  let scanned = 0;
  if (!start || !fs.existsSync(start)) return { found, scanned };

  const walk = (dir: string, depth: number): void => {
    if (depth > SCAN_MAX_DEPTH || found.length >= 500) return;
    scanned++;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }

    const gitDir = path.join(dir, ".git");
    if (entries.some((e) => e.name === ".git")) {
      let remote = "";
      try { remote = parseGitRemote(fs.readFileSync(path.join(gitDir, "config"), "utf8")); } catch { remote = ""; }
      found.push({ name: path.basename(dir), localPath: dir, remoteUrl: remote, branch: headBranch(gitDir) });
      return; // a clone is a leaf — never descend into one
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".") || SCAN_SKIP.has(e.name)) continue;
      walk(path.join(dir, e.name), depth + 1);
    }
  };
  walk(start, 0);
  return { found, scanned };
}

/**
 * Upsert what the scan found. MATCHED BY local_path, so rescanning the same drive updates rows
 * instead of duplicating them — and an existing row's description, licence and README snapshot are
 * left alone, because the scan knows the path and the remote and nothing else. It must never
 * overwrite something a human typed with a blank.
 */
export function importLocalRepos(db: Db, orgId: string, repos: unknown): { added: number; updated: number } {
  const list = Array.isArray(repos) ? (repos as FoundRepo[]) : [];
  let added = 0;
  let updated = 0;
  db.transaction(() => {
    for (const r of list) {
      if (!r?.name || !r?.localPath) continue;
      const existing = db.prepare("SELECT uuid FROM vault_repos WHERE org_id = ? AND local_path = ?")
        .get(orgId, r.localPath) as { uuid?: string } | undefined;
      if (existing?.uuid) {
        db.prepare("UPDATE vault_repos SET remote_url = COALESCE(NULLIF(?, ''), remote_url), updated_at = ? WHERE org_id = ? AND uuid = ?")
          .run(r.remoteUrl, nowIso(), orgId, existing.uuid);
        updated++;
      } else {
        saveRepo(db, orgId, { name: r.name, localPath: r.localPath, remoteUrl: r.remoteUrl });
        added++;
      }
    }
  })();
  return { added, updated };
}
