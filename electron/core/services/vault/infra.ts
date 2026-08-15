// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Infrastructure — servers and DNS records, plus the BIND zone-file importer. A row
//              here POINTS at credentials (ssh_secret_uuid is a locator) and never contains one.
//              The zone parser is exact — a defined format, no model, no guessing — which is why
//              the paste-a-zone-file path is the primary import and the screenshot path is the
//              fallback for when no export button exists. Nothing is written by parseZone; the
//              caller previews, the human approves, importZone writes.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/vault/infra.ts
//------------------------------------------------------------
import { generateUUIDv7 } from "../utils/uuidv7";
import { nowIso, type Db } from "./db";

export interface VaultServer {
  id: number;
  uuid: string;
  host: string;
  address: string | null;
  provider: string | null;
  role: string | null;
  ssh_secret_uuid: string | null;
  runbook_uuid: string | null;
  notes: string | null;
}

export interface VaultDnsRecord {
  id: number;
  uuid: string;
  domain: string;
  name: string;
  rtype: string;
  content: string;
  proxied: number | null;
  ttl: string | null;
  comment: string | null;
}

export interface ZoneRecord {
  name: string;
  rtype: string;
  content: string;
  ttl: string | null;
  proxied: number | null;
  comment: string | null;
}

const S = (v: unknown, max = 500): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.slice(0, max) : null;

// A record type must be a REAL one, not merely a short uppercase word. Without this, any four-word
// line ("nonsense without enough fields") parses as a record and imports as junk — caught by the
// proof, which is exactly what the proof is for. SOA/NS are recognised so they can be SKIPPED.
const RTYPES = new Set([
  "A", "AAAA", "CNAME", "MX", "TXT", "CAA", "SRV", "NS", "SOA", "PTR", "SPF",
  "DS", "DNSKEY", "TLSA", "SSHFP", "NAPTR", "URI", "CERT", "SVCB", "HTTPS", "ALIAS", "LOC",
]);

// ---------------------------------------------------------------- servers
export function listServers(db: Db, orgId: string): VaultServer[] {
  return db
    .prepare("SELECT id, uuid, host, address, provider, role, ssh_secret_uuid, runbook_uuid, notes FROM vault_servers WHERE org_id = ? ORDER BY host COLLATE NOCASE")
    .all(orgId) as VaultServer[];
}

export function saveServer(db: Db, orgId: string, input: Record<string, unknown>): VaultServer {
  const host = S(input?.host, 200);
  if (!host) throw new Error("A server needs a host name.");
  const at = nowIso();
  if (typeof input?.uuid === "string" && input.uuid) {
    db.prepare(
      "UPDATE vault_servers SET host = ?, address = ?, provider = ?, role = ?, ssh_secret_uuid = ?, runbook_uuid = ?, notes = ?, updated_at = ? WHERE org_id = ? AND uuid = ?"
    ).run(host, S(input.address, 100), S(input.provider, 100), S(input.role, 100), S(input.sshSecretUuid, 40), S(input.runbookUuid, 40), S(input.notes, 2000), at, orgId, input.uuid);
    return db.prepare("SELECT id, uuid, host, address, provider, role, ssh_secret_uuid, runbook_uuid, notes FROM vault_servers WHERE org_id = ? AND uuid = ?").get(orgId, input.uuid) as VaultServer;
  }
  const uuid = generateUUIDv7();
  db.prepare("INSERT INTO vault_servers (uuid, org_id, host, address, provider, role, ssh_secret_uuid, runbook_uuid, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    uuid, orgId, host, S(input.address, 100), S(input.provider, 100), S(input.role, 100), S(input.sshSecretUuid, 40), S(input.runbookUuid, 40), S(input.notes, 2000), at
  );
  return db.prepare("SELECT id, uuid, host, address, provider, role, ssh_secret_uuid, runbook_uuid, notes FROM vault_servers WHERE org_id = ? AND uuid = ?").get(orgId, uuid) as VaultServer;
}

export function deleteServer(db: Db, orgId: string, uuid: unknown): void {
  if (typeof uuid !== "string") throw new Error("Invalid server locator");
  // The pointed-at SSH key is untouched — this row was only ever a pointer.
  db.prepare("DELETE FROM vault_servers WHERE org_id = ? AND uuid = ?").run(orgId, uuid);
}

// ---------------------------------------------------------------- DNS
export function listDns(db: Db, orgId: string, domain?: string): VaultDnsRecord[] {
  return (domain
    ? db.prepare("SELECT id, uuid, domain, name, rtype, content, proxied, ttl, comment FROM vault_dns_records WHERE org_id = ? AND domain = ? ORDER BY rtype, name").all(orgId, domain)
    : db.prepare("SELECT id, uuid, domain, name, rtype, content, proxied, ttl, comment FROM vault_dns_records WHERE org_id = ? ORDER BY domain, rtype, name").all(orgId)) as VaultDnsRecord[];
}

export function saveDnsRecord(db: Db, orgId: string, input: Record<string, unknown>): VaultDnsRecord {
  const domain = S(input?.domain, 200), name = S(input?.name, 300), rtype = S(input?.rtype, 20), content = S(input?.content, 2000);
  if (!domain || !name || !rtype || !content) throw new Error("A record needs a domain, a name, a type and content.");
  const uuid = generateUUIDv7();
  db.prepare("INSERT INTO vault_dns_records (uuid, org_id, domain, name, rtype, content, proxied, ttl, comment, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    uuid, orgId, domain, name, rtype.toUpperCase(), content, input.proxied == null ? null : input.proxied ? 1 : 0, S(input.ttl, 20), S(input.comment, 500), nowIso()
  );
  return db.prepare("SELECT id, uuid, domain, name, rtype, content, proxied, ttl, comment FROM vault_dns_records WHERE org_id = ? AND uuid = ?").get(orgId, uuid) as VaultDnsRecord;
}

export function deleteDnsRecord(db: Db, orgId: string, uuid: unknown): void {
  if (typeof uuid !== "string") throw new Error("Invalid record locator");
  db.prepare("DELETE FROM vault_dns_records WHERE org_id = ? AND uuid = ?").run(orgId, uuid);
}

// ---------------------------------------------------------------- zone parser (exact, no model)
/**
 * Parses a BIND export the way Cloudflare writes one. Handles: `;;` section comments (skipped),
 * `; …` trailing comments (kept — Cloudflare stores the record comment there), the cf_tags proxy
 * marker, quoted TXT bodies with internal spaces, and multi-chunk TXT ("part1" "part2" → joined).
 * PURE — reads a string, returns records, writes nothing.
 */
export function parseZone(text: unknown): { records: ZoneRecord[]; flagged: { record: ZoneRecord; why: string }[] } {
  if (typeof text !== "string") return { records: [], flagged: [] };
  const records: ZoneRecord[] = [];
  const flagged: { record: ZoneRecord; why: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith(";")) continue; // blank, or a file-level comment line
    // split the trailing comment off first — but not inside TXT quotes
    let comment: string | null = null;
    let body = line;
    let inQ = false, cut = -1;
    for (let i = 0; i < body.length; i++) {
      if (body[i] === '"') inQ = !inQ;
      else if (body[i] === ";" && !inQ) { cut = i; break; }
    }
    if (cut >= 0) { comment = body.slice(cut + 1).trim() || null; body = body.slice(0, cut).trim(); }
    // proxy marker rides the comment: cf_tags=cf-proxied:true/false
    let proxied: number | null = null;
    if (comment) {
      const m = comment.match(/cf_tags=cf-proxied:(true|false)/);
      if (m) { proxied = m[1] === "true" ? 1 : 0; comment = comment.replace(m[0], "").trim() || null; }
    }
    // NAME TTL CLASS TYPE CONTENT…  (class IN; TTL may be absent in hand-written files)
    const parts = body.match(/"[^"]*"|\S+/g) ?? [];
    if (parts.length < 4) continue;
    const name = (parts[0] ?? "").replace(/\.$/, "");
    let i = 1;
    let ttl: string | null = null;
    if (/^\d+$/.test(parts[i] ?? "")) { ttl = parts[i] ?? null; i++; }
    if (parts[i] === "IN") i++;
    const rtype = (parts[i] ?? "").toUpperCase(); i++;
    if (!RTYPES.has(rtype)) continue;
    // TXT chunks re-join; everything else joins with spaces as written
    const chunks = parts.slice(i);
    const content = rtype === "TXT"
      ? chunks.map((c) => c.replace(/^"|"$/g, "")).join("")
      : chunks.join(" ").replace(/\.$/, "");
    if (rtype === "SOA" || rtype === "NS") continue; // registrar plumbing — noise in a vault view
    const rec: ZoneRecord = { name, rtype, content, ttl, proxied, comment };
    records.push(rec);
    // the two honest flags from the mockup — surfaced, never acted on
    if (rtype === "TXT" && /v=DMARC1;\s*p=none/i.test(content)) flagged.push({ record: rec, why: "DMARC p=none — records failures without enforcing anything" });
    if (/\.[a-z0-9-]+\.[a-z]{2,}\.[a-z0-9-]+\./i.test(`${name}.`) && name.split(".").length > 4) flagged.push({ record: rec, why: "name looks doubled — a trailing dot may have been left off an FQDN" });
  }
  return { records, flagged };
}

/** THE write. Replaces the domain's stored records with the approved set, one transaction. */
export function importZone(db: Db, orgId: string, domain: unknown, records: unknown): { imported: number; message?: string } {
  const dom = S(domain, 200);
  if (!dom) throw new Error("The domain name is required.");
  const list = Array.isArray(records) ? (records as ZoneRecord[]) : [];
  // TIER-1 FIX 3. "Replace with the approved set" only means anything when a set WAS approved —
  // this DELETE used to run unconditionally, so approving nothing (an empty parse, every row
  // unticked) wiped the domain's stored records and inserted zero. An empty approval is a no-op
  // with a sentence; erasing a domain is its own deliberate act, never the side effect of an
  // import that found nothing.
  if (list.length === 0) {
    return { imported: 0, message: `Nothing was approved, so nothing was changed — the stored records for ${dom} are untouched.` };
  }
  const at = nowIso();
  db.transaction(() => {
    db.prepare("DELETE FROM vault_dns_records WHERE org_id = ? AND domain = ?").run(orgId, dom);
    const ins = db.prepare("INSERT INTO vault_dns_records (uuid, org_id, domain, name, rtype, content, proxied, ttl, comment, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const r of list) {
      if (!r || typeof r.name !== "string" || typeof r.rtype !== "string" || typeof r.content !== "string") continue;
      ins.run(generateUUIDv7(), orgId, dom, r.name.slice(0, 300), r.rtype.slice(0, 20).toUpperCase(), r.content.slice(0, 2000),
        r.proxied == null ? null : r.proxied ? 1 : 0, S(r.ttl, 20), S(r.comment, 500), at);
    }
  })();
  return { imported: list.length };
}

// ---------------------------------------------------------------- server inventory import
/**
 * A HOST INVENTORY, from a CSV or a JSON array (Jason 08-11-2026 — the import destination is now
 * the tab's own, not "make it a note").
 *
 * PURE. Parses and returns; writes nothing. The review table on screen is built from this, and
 * importServers below is the only thing that touches the database — the same choose → parse →
 * review → commit shape the zone importer already uses, for the same reason: a host list that
 * silently half-imported is worse than one that refused.
 *
 * COLUMN NAMES ARE MATCHED LOOSELY on purpose. Every exporter names these differently — "host" vs
 * "hostname" vs "name", "address" vs "ip" vs "ipv4" — and a pinned header is how an importer ends
 * up rejecting a file a human can read perfectly well.
 */
const SERVER_FIELDS: Record<string, string[]> = {
  host: ["host", "hostname", "name", "server", "fqdn"],
  address: ["address", "ip", "ipv4", "ipv6", "addr", "ip_address"],
  provider: ["provider", "vendor", "cloud", "host_provider"],
  role: ["role", "purpose", "type", "function"],
  notes: ["notes", "note", "comment", "description"],
};

function pickField(headers: string[], names: string[]): number {
  for (const n of names) {
    const i = headers.indexOf(n);
    if (i !== -1) return i;
  }
  return -1;
}

/** Minimal RFC-4180-ish row splitter — quoted fields, doubled quotes, commas inside quotes. */
function csvRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export interface ParsedServer {
  host: string;
  address: string;
  provider: string;
  role: string;
  notes: string;
}

export function parseServers(text: unknown): { servers: ParsedServer[]; skipped: number } {
  const raw = typeof text === "string" ? text.trim() : "";
  if (!raw) return { servers: [], skipped: 0 };
  const take = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
  const out: ParsedServer[] = [];
  let skipped = 0;

  // JSON first — an array of objects, or {servers:[…]}. A dump is commoner than a spreadsheet now.
  if (raw.startsWith("[") || raw.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(raw);
      const arr: unknown[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { servers?: unknown })?.servers)
          ? ((parsed as { servers: unknown[] }).servers)
          : [];
      for (const row of arr) {
        if (!row || typeof row !== "object") { skipped++; continue; }
        const r = row as Record<string, unknown>;
        const lower: Record<string, unknown> = {};
        for (const k of Object.keys(r)) lower[k.toLowerCase().replace(/[\s-]/g, "_")] = r[k];
        const get = (names: string[]): string => {
          for (const n of names) if (lower[n] != null) return take(lower[n]);
          return "";
        };
        const host = get(SERVER_FIELDS.host);
        if (!host) { skipped++; continue; } // a row with no host is not a server
        out.push({
          host,
          address: get(SERVER_FIELDS.address),
          provider: get(SERVER_FIELDS.provider),
          role: get(SERVER_FIELDS.role),
          notes: get(SERVER_FIELDS.notes),
        });
      }
      return { servers: out, skipped };
    } catch {
      // Not valid JSON after all — fall through and try it as CSV rather than refusing outright.
    }
  }

  const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== "" && !l.trimStart().startsWith("#"));
  if (lines.length === 0) return { servers: [], skipped: 0 };
  const headers = csvRow(lines[0] ?? "").map((h) => h.toLowerCase().replace(/[\s-]/g, "_"));
  const idx = {
    host: pickField(headers, SERVER_FIELDS.host),
    address: pickField(headers, SERVER_FIELDS.address),
    provider: pickField(headers, SERVER_FIELDS.provider),
    role: pickField(headers, SERVER_FIELDS.role),
    notes: pickField(headers, SERVER_FIELDS.notes),
  };
  // No recognisable host column means this is not a host inventory. Say so by returning nothing
  // rather than importing a column of nonsense under the name "host".
  if (idx.host === -1) return { servers: [], skipped: lines.length - 1 };

  for (let i = 1; i < lines.length; i++) {
    const cells = csvRow(lines[i] ?? "");
    const at = (n: number): string => (n === -1 ? "" : (cells[n] ?? "").trim());
    const host = at(idx.host);
    if (!host) { skipped++; continue; }
    out.push({ host, address: at(idx.address), provider: at(idx.provider), role: at(idx.role), notes: at(idx.notes) });
  }
  return { servers: out, skipped };
}

/** THE write. One transaction, mirroring importZone — a half-imported inventory is not a result. */
export function importServers(db: Db, orgId: string, servers: unknown): { imported: number } {
  const list = Array.isArray(servers) ? (servers as ParsedServer[]) : [];
  if (list.length === 0) return { imported: 0 };
  db.transaction(() => {
    for (const s of list) saveServer(db, orgId, { ...s });
  })();
  return { imported: list.length };
}
