// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Proof for the pure engines behind the redesign — SSH randomart derivation, the BIND
//              zone parser, and the import date-resolution order. All three are hand-written and all
//              three are the kind of code that looks right and is wrong on the fourth edge case, so
//              each leaves a check behind.
//
//              Run: npx esbuild modules/vault/test/redesign-proof.ts --bundle --platform=node
//                     --format=cjs --external:electron --external:better-sqlite3-multiple-ciphers
//                     --outfile=modules/vault/test/redesign-proof.cjs
//                   node modules/vault/test/redesign-proof.cjs
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: test/redesign-proof.ts
//------------------------------------------------------------
import assert from "node:assert/strict";
import { deriveSshArt } from "../electron/core/services/vault/sshart";
import { parseZone } from "../electron/core/services/vault/infra";
import { parseImportDates } from "../electron/core/services/vault/notes";

let checks = 0;
const check = (name: string, fn: () => void): void => { fn(); checks++; console.log(`  ok  ${name}`); };

console.log("sshart.ts — fingerprint + randomart");

// A real ed25519 public key (throwaway, generated for this test).
const ED = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEdvWg9N7dW/WZnaVDiQr2lexPRxF9arzJhs2Mq7guYD jason@avertxai";

check("a valid ed25519 key derives a SHA256 fingerprint", () => {
  const a = deriveSshArt(ED);
  assert.equal(a.ok, true);
  assert.match(a.fingerprint ?? "", /^SHA256:[A-Za-z0-9+/]{43}$/); // base64, unpadded, as OpenSSH prints it
});

check("the randomart box is exactly 9 rows between two 19-char borders", () => {
  const a = deriveSshArt(ED);
  const lines = (a.randomart ?? "").split("\n");
  assert.equal(lines.length, 11, "header + 9 rows + footer");
  assert.equal(lines[0].length, 19);
  assert.equal(lines[10].length, 19);
  for (let i = 1; i <= 9; i++) assert.equal(lines[i].length, 19, `row ${i} is 19 chars`);
});

check("the art carries the S start marker and an E end marker", () => {
  const art = deriveSshArt(ED).randomart ?? "";
  assert.ok(art.includes("S"), "start square");
  assert.ok(art.includes("E"), "end square");
});

check("DERIVATION IS STABLE — the same key always draws the same picture", () => {
  // The whole reason it is derived and not stored: it cannot drift.
  assert.equal(deriveSshArt(ED).randomart, deriveSshArt(ED).randomart);
  assert.equal(deriveSshArt(ED).fingerprint, deriveSshArt(ED).fingerprint);
});

check("a DIFFERENT key draws a different picture", () => {
  const other = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAr8pQnJ0eV6xKcT2mWdY9uZbN3sLfHgXvE4iQjRkTpM other@host";
  assert.notEqual(deriveSshArt(ED).fingerprint, deriveSshArt(other).fingerprint);
  assert.notEqual(deriveSshArt(ED).randomart, deriveSshArt(other).randomart);
});

check("junk is refused with a sentence, never a crash", () => {
  assert.equal(deriveSshArt("hello").ok, false);
  assert.equal(deriveSshArt("").ok, false);
  assert.equal(deriveSshArt(null).ok, false);
  assert.equal(deriveSshArt(undefined).ok, false);
});

console.log("\ninfra.ts — BIND zone parser");

// Jason's real Cloudflare export, trimmed to the shapes that matter.
const ZONE = `;;
;; Domain:     avertxai.com.
;; A Records
admin.avertxai.com.\t1\tIN\tA\t178.63.17.184 ; cf_tags=cf-proxied:true
core.avertxai.com.\t1\tIN\tA\t178.63.17.184 ; Coolio Dashboard cf_tags=cf-proxied:true
mcp.avertxai.com.\t1\tIN\tA\t100.78.248.15 ; cf_tags=cf-proxied:false

;; NS Records
avertxai.com.\t86400\tIN\tNS\tjaziel.ns.cloudflare.com.

;; MX Records
avertxai.com.\t1\tIN\tMX\t81 route3.mx.cloudflare.net.

;; TXT Records
_dmarc.avertxai.com.\t1\tIN\tTXT\t"v=DMARC1; p=none;"
cf2024-1._domainkey.avertxai.com.\t1\tIN\tTXT\t"v=DKIM1; h=sha256; k=rsa; p=MIIBIjANBg" "KCAQEAiweykoi"`;

check("comment lines and NS/SOA plumbing are skipped", () => {
  const { records } = parseZone(ZONE);
  assert.ok(!records.some((r) => r.rtype === "NS"), "NS is registrar plumbing, not vault content");
  assert.ok(!records.some((r) => r.name.startsWith(";")));
});

check("A records parse with name, type and content", () => {
  const a = parseZone(ZONE).records.find((r) => r.name === "admin.avertxai.com");
  assert.equal(a?.rtype, "A");
  assert.equal(a?.content, "178.63.17.184");
  assert.equal(a?.ttl, "1");
});

check("the cf-proxied flag is read off the comment", () => {
  const recs = parseZone(ZONE).records;
  assert.equal(recs.find((r) => r.name === "admin.avertxai.com")?.proxied, 1);
  assert.equal(recs.find((r) => r.name === "mcp.avertxai.com")?.proxied, 0);
});

check("a real comment survives while the cf_tags marker is stripped out of it", () => {
  // Cloudflare stores the record comment in the same trailing comment as its own tag — losing it
  // would silently drop the only human context the export carries.
  const core = parseZone(ZONE).records.find((r) => r.name === "core.avertxai.com");
  assert.equal(core?.comment, "Coolio Dashboard");
  assert.equal(core?.proxied, 1);
});

check("MX keeps its priority in the content", () => {
  const mx = parseZone(ZONE).records.find((r) => r.rtype === "MX");
  assert.equal(mx?.content, "81 route3.mx.cloudflare.net");
});

check("a quoted TXT keeps its internal spaces and semicolons", () => {
  // The semicolon inside the quotes must NOT be treated as the start of a comment.
  const dmarc = parseZone(ZONE).records.find((r) => r.name === "_dmarc.avertxai.com");
  assert.equal(dmarc?.content, "v=DMARC1; p=none;");
});

check("a multi-chunk TXT is rejoined into one value", () => {
  // DKIM keys arrive split across quoted chunks; joining them wrong breaks mail silently.
  const dkim = parseZone(ZONE).records.find((r) => r.name.startsWith("cf2024-1"));
  assert.equal(dkim?.content, "v=DKIM1; h=sha256; k=rsa; p=MIIBIjANBgKCAQEAiweykoi");
});

check("DMARC p=none is flagged, never changed", () => {
  const { flagged } = parseZone(ZONE);
  assert.ok(flagged.some((f) => /p=none/.test(f.why)), "surfaced for the human");
});

check("junk in, empty out — no crash", () => {
  assert.deepEqual(parseZone("").records, []);
  assert.deepEqual(parseZone(null).records, []);
  assert.deepEqual(parseZone("nonsense without enough fields").records, []);
});

console.log("\nnotes.ts — an imported file keeps its OWN dates");

// The resolution order importDocs relies on: the author's frontmatter beats the file's timestamps,
// and both beat the clock. Getting this wrong stamps a 2021 runbook with today and throws away the
// only chronology the archive had.
check("a frontmatter created: date wins over the file timestamp", () => {
  const d = parseImportDates({ created: "2023-04-17", birthtimeMs: Date.now() });
  assert.equal(d.createdAt.slice(0, 10), "2023-04-17");
});

check("the file's own timestamp is used when frontmatter has none", () => {
  const when = Date.UTC(2024, 0, 15); // 15 Jan 2024
  const d = parseImportDates({ birthtimeMs: when });
  assert.equal(d.createdAt.slice(0, 10), "2024-01-15");
});

check("AN OLD FILE DOES NOT IMPORT AS TODAY", () => {
  const old = Date.UTC(2021, 5, 2);
  const d = parseImportDates({ birthtimeMs: old, mtimeMs: old });
  assert.equal(d.createdAt.slice(0, 10), "2021-06-02");
  assert.notEqual(d.createdAt.slice(0, 4), String(new Date().getFullYear()));
});

check("updated: is read separately from created:", () => {
  const d = parseImportDates({ created: "2022-01-01", updated: "2025-09-30" });
  assert.equal(d.createdAt.slice(0, 10), "2022-01-01");
  assert.equal(d.updatedAt.slice(0, 10), "2025-09-30");
});

check("unparseable junk falls back to now rather than storing Invalid Date", () => {
  const d = parseImportDates({ created: "not a date", birthtimeMs: "nonsense" });
  assert.ok(!Number.isNaN(new Date(d.createdAt).getTime()));
  assert.equal(d.createdAt.slice(0, 4), String(new Date().getFullYear()));
});

console.log(`\n${checks} checks passed.`);
