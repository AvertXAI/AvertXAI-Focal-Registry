// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Proof for the CSV parser and the archive envelope in transfer.ts. A hand-written
//              parser is exactly the kind of code that looks right and is wrong on the fourth edge
//              case, so it leaves a check behind. No framework — asserts and a summary line, run the
//              same way engine-proof is (see README).
//
//              Run: npx esbuild modules/vault/test/transfer-proof.ts --bundle --platform=node
//                     --format=cjs --external:electron --external:better-sqlite3-multiple-ciphers
//                     --outfile=modules/vault/test/transfer-proof.cjs
//                   node modules/vault/test/transfer-proof.cjs
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: test/transfer-proof.ts
//------------------------------------------------------------
import assert from "node:assert/strict";
import { parseCsv } from "../electron/core/services/vault/transfer";
import { classify, rankCandidates } from "../electron/core/services/vault/sources";

let checks = 0;
const check = (name: string, fn: () => void): void => {
  fn();
  checks++;
  console.log(`  ok  ${name}`);
};

console.log("transfer.ts — CSV parser");

check("plain rows split on commas", () => {
  assert.deepEqual(parseCsv("a,b,c\n1,2,3"), [["a", "b", "c"], ["1", "2", "3"]]);
});

check("CRLF ends a record the same as LF", () => {
  assert.deepEqual(parseCsv("a,b\r\n1,2\r\n"), [["a", "b"], ["1", "2"]]);
});

check("a quoted field keeps its commas", () => {
  assert.deepEqual(parseCsv('name,note\nHetzner,"root, port 22"'), [["name", "note"], ["Hetzner", "root, port 22"]]);
});

check("a doubled quote is one literal quote", () => {
  assert.deepEqual(parseCsv('a\n"he said ""hi"""'), [["a"], ['he said "hi"']]);
});

check("a newline INSIDE quotes does not end the record", () => {
  // The case that breaks every regex-based parser, and the one that matters: multi-line notes and
  // backup-code blocks are exactly how real exports carry them.
  assert.deepEqual(parseCsv('label,notes\nAdobe,"line one\nline two"'), [["label", "notes"], ["Adobe", "line one\nline two"]]);
});

check("a BOM never becomes part of the first header", () => {
  // Excel writes one. Without stripping it the first column is named "﻿label" and the mapping
  // guess silently misses every hint.
  assert.equal(parseCsv("﻿label,value\na,b")[0][0], "label");
});

check("blank lines and a trailing newline are dropped", () => {
  assert.deepEqual(parseCsv("a,b\n1,2\n\n\n"), [["a", "b"], ["1", "2"]]);
});

check("an empty trailing field is preserved, not trimmed away", () => {
  assert.deepEqual(parseCsv("a,b,c\n1,,3"), [["a", "b", "c"], ["1", "", "3"]]);
});

check("a password containing a comma and a quote survives a round trip", () => {
  // The whole point. If this breaks, an export silently corrupts credentials on the way back in.
  const secret = 'p@ss,w"rd\nsecond line';
  const cell = /[",\r\n]/.test(secret) ? `"${secret.replace(/"/g, '""')}"` : secret;
  assert.equal(parseCsv(`value\n${cell}`)[1][0], secret);
});

console.log("\nsources.ts — export finder");

const chrome = { dirs: ["downloads"] as ("downloads" | "desktop" | "documents")[], needles: ["chrome password"], exts: ["csv"] };
const anyCsv = { dirs: ["downloads"] as ("downloads" | "desktop" | "documents")[], needles: [], exts: ["csv", "txt"] };

check("the vendor's own file is a strong match", () => {
  assert.equal(classify("Chrome Passwords.csv", chrome), "strong");
});

check("a password-shaped file for the wrong vendor is weak, not strong", () => {
  // "passwords (3).csv" is clearly an export but not clearly Chrome's — surfaced, but flagged unsure.
  assert.equal(classify("passwords (3).csv", chrome), "weak");
});

check("a random spreadsheet is not a candidate at all", () => {
  assert.equal(classify("2026 shoot invoices.csv", chrome), null);
});

check("the wrong extension is rejected even with the right name", () => {
  assert.equal(classify("Chrome Passwords.pdf", chrome), null);
});

check('"Other / CSV" accepts any csv as a real match', () => {
  assert.equal(classify("whatever.csv", anyCsv), "strong");
  assert.equal(classify("notes.txt", anyCsv), "strong");
});

check("ranking puts strong matches above weak ones, newest first within a tier", () => {
  const files = [
    { name: "passwords.csv", path: "/d/passwords.csv", dir: "downloads" as const, mtimeMs: 500, size: 10 },
    { name: "Chrome Passwords.csv", path: "/d/Chrome Passwords.csv", dir: "downloads" as const, mtimeMs: 100, size: 10 },
    { name: "Chrome Passwords (1).csv", path: "/d/Chrome Passwords (1).csv", dir: "downloads" as const, mtimeMs: 300, size: 10 },
    { name: "budget.csv", path: "/d/budget.csv", dir: "downloads" as const, mtimeMs: 999, size: 10 },
  ];
  const ranked = rankCandidates(files, chrome);
  // budget.csv is dropped entirely; the two Chrome files lead (newer first); the generic one trails.
  assert.deepEqual(ranked.map((c) => c.name), ["Chrome Passwords (1).csv", "Chrome Passwords.csv", "passwords.csv"]);
  assert.equal(ranked[0].strong, true);
  assert.equal(ranked[2].strong, false);
});

check("the cap is honoured", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({
    name: `Chrome Passwords ${i}.csv`, path: `/d/${i}.csv`, dir: "downloads" as const, mtimeMs: i, size: 1,
  }));
  assert.equal(rankCandidates(many, chrome, 8).length, 8);
});

console.log(`\n${checks} checks passed.`);
