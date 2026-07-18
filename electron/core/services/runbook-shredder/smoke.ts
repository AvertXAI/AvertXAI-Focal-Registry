// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: RunBooks — AvertXAI platform shell (baseplate)
// Description: Headless smoke self-check for the Runbook Shredder service — assert-based, no framework.
//              Runs against temp folders + a temp DB dir (NO writes outside runbook-shredder_<org>.db).
//              Drops 3 valid + 1 malformed .md, then proves parse/quarantine, FTS5 search (incl. tag
//              hits), secret-ref POINTER storage, edit→update, delete→gone. Run under Electron's node
//              ABI: `ELECTRON_RUN_AS_NODE=1 electron smoke.cjs` (native module is Electron-built).
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/runbook-shredder/smoke.ts
//------------------------------------------------------------
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { startShredder, ingestFile, removeFile } from "./shredder";
import { listRunbooks, getRunbook, search, listQuarantined } from "./api";
import { defaultSettings } from "../../../../src/modules/runbook-shredder/config.manifest";

const tmp = (prefix: string): string => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const dataDir = tmp("rbs-data-");
const watchDir = tmp("rbs-watch-");
const orgId = "smoke-org";
const p = (name: string): string => path.join(watchDir, name);

// --- fixtures: 3 valid + 1 malformed ---------------------------------------------------------
fs.writeFileSync(
  p("RB-001.md"),
  `---
id: RB-001
title: Restart Core API
type: incident
status: active
severity: high
owner: jason
client: avert
service: core-api
trigger: 5xx spike
version: "1.0"
updated: 2026-07-01
tags: [ssh, restart, core]
secret_refs:
  ssh_key: hetzner/avert-core-01/ssh
---
SSH in and restart the core-api service. Watch the logs.
`
);
fs.writeFileSync(
  p("RB-002.md"),
  `---
id: RB-002
title: Rotate DB credentials
type: maintenance
status: draft
tags: [database, rotate]
---
Rotate the postgres password quarterly.
`
);
fs.writeFileSync(
  p("RB-003.md"),
  `---
id: RB-003
title: Clear CDN cache
tags: [cdn]
---
Purge the CDN cache for the marketing site.
`
);
// malformed: unterminated quote + unclosed flow sequence -> js-yaml throws -> quarantine
fs.writeFileSync(
  p("RB-BROKEN.md"),
  `---
id: RB-BROKEN
title: "unterminated
tags: [a, b
---
this frontmatter is malformed.
`
);

// --- run: standalone, watcher OFF so the check is deterministic (engine driven directly) ------
const settings = defaultSettings();
settings["runbook-shredder.watch_path"] = watchDir;
settings["runbook-shredder.watch_enabled"] = false; // no live fs.watch race during asserts
const h = startShredder({ orgId, baseDir: dataDir, settings });
const db = h.db;

// 1. parse + quarantine
const all = listRunbooks(db);
assert.equal(all.length, 4, "4 rows total (3 ok + 1 quarantined)");
assert.equal(all.filter((r) => r.parse_status === "ok").length, 3, "3 ok rows");
const bad = listQuarantined(db);
assert.equal(bad.length, 1, "1 quarantined row");
assert.ok(bad[0].parse_error && bad[0].parse_error.length > 0, "quarantine carries parse_error text");
assert.equal(bad[0].file_path, p("RB-BROKEN.md"), "quarantined row keyed by file_path");
console.log(`OK parse: 3 ok / 1 quarantined — error: ${JSON.stringify(bad[0].parse_error!.slice(0, 50))}`);

// 2. FTS5 search — body hit + tag hit
assert.ok(search(db, "restart").some((r) => r.runbook_id === "RB-001"), "'restart' -> RB-001");
assert.ok(search(db, "postgres").some((r) => r.runbook_id === "RB-002"), "'postgres' -> RB-002");
assert.ok(search(db, "cdn").some((r) => r.runbook_id === "RB-003"), "'cdn' (tag) -> RB-003");
console.log("OK fts5: restart->RB-001, postgres->RB-002, cdn(tag)->RB-003");

// 3. secret ref stores the POINTER, not a value
const refs = db.prepare("SELECT ref_key, vault_pointer FROM runbook_secret_refs").all() as {
  ref_key: string;
  vault_pointer: string;
}[];
assert.equal(refs.length, 1, "1 secret ref");
assert.equal(refs[0].ref_key, "ssh_key");
assert.equal(refs[0].vault_pointer, "hetzner/avert-core-01/ssh", "pointer stored verbatim");
console.log(`OK secret_ref: ${refs[0].ref_key} -> ${refs[0].vault_pointer} (pointer, not a value)`);

// 4. edit a file -> row updates (+ FTS reflects new body)
fs.writeFileSync(
  p("RB-002.md"),
  `---
id: RB-002
title: Rotate DB credentials (updated)
type: maintenance
status: done
tags: [database, rotate]
---
Rotated. Next review due Q4.
`
);
ingestFile(db, p("RB-002.md"));
const updated = getRunbook(db, "RB-002")!;
assert.equal(updated.title, "Rotate DB credentials (updated)", "title updated");
assert.equal(updated.status, "done", "status updated");
assert.ok(search(db, "Q4").some((r) => r.runbook_id === "RB-002"), "FTS reflects new body");
assert.equal(listRunbooks(db).length, 4, "edit is an upsert, not a new row");
console.log("OK edit: RB-002 title+status+FTS updated in place");

// 5. delete a file -> row + FTS gone
removeFile(db, p("RB-003.md"));
assert.equal(getRunbook(db, "RB-003"), undefined, "RB-003 row removed");
assert.equal(search(db, "cdn").length, 0, "RB-003 FTS entry removed");
console.log("OK delete: RB-003 row + FTS removed");

// 6. isolation — only runbook-shredder_<org>.db (+ WAL/SHM) written in dataDir
const files = fs.readdirSync(dataDir);
assert.ok(
  files.every((f) => f.startsWith("runbook-shredder_")),
  `only runbook-shredder_* files written, got: ${files.join(", ")}`
);
console.log(`OK isolation: dataDir has only [${files.join(", ")}]`);

h.stop();
console.log("\nSMOKE PASSED");
