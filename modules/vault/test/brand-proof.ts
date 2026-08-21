// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Proof for brand artwork at rest in the vault, and for label -> domain resolution.
//              Build + run (native module must match Electron's ABI):
//   npx esbuild modules/vault/test/brand-proof.ts --bundle --platform=node --format=cjs \
//     --external:better-sqlite3-multiple-ciphers --outfile=modules/vault/test/brand-proof.cjs \
//     && set ELECTRON_RUN_AS_NODE=1&& npx electron modules/vault/test/brand-proof.cjs
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: modules/vault/test/brand-proof.ts
//------------------------------------------------------------
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3-multiple-ciphers";
import { ensureVaultSchema } from "../../../electron/core/services/vault/db";
import { brandAssetFor, brandPackStatus, importBrandPack } from "../../../electron/core/services/vault/brandAssets";
import { resolveVendor, vendorDomain } from "../../../electron/core/services/vault/vendorMap";

const ORG = "org-brand-proof";
let n = 0;
const ok = (m: string) => { n++; console.log(`  ok ${n} — ${m}`); };

// ---------------------------------------------------------------- label -> domain
assert.deepEqual(resolveVendor("Chase Bank"), { domain: "chase.com", via: "map" });
assert.deepEqual(resolveVendor("Amazon Prime Video"), { domain: "amazon.com", via: "map" });
assert.deepEqual(resolveVendor("Wells Fargo Mobile"), { domain: "wellsfargo.com", via: "map" });
assert.deepEqual(resolveVendor("Qualtrics Survey"), { domain: "qualtrics.com", via: "map" });
ok("a qualifier after the brand does not change the brand");

assert.deepEqual(resolveVendor("https://www.chase.com/login"), { domain: "chase.com", via: "host" });
assert.deepEqual(resolveVendor("H-E-B"), { domain: "heb.com", via: "map" });
assert.deepEqual(resolveVendor("Nowhere Co"), { domain: "nowhereco.com", via: "guess" });
assert.deepEqual(resolveVendor(""), { domain: null, via: null });
assert.deepEqual(resolveVendor(null), { domain: null, via: null });
assert.deepEqual(resolveVendor(undefined), { domain: null, via: null });
ok("urls, punctuation, guesses and empty input all resolve without throwing");

// A guess is NOT a confirmed brand — the caller must be able to tell them apart.
assert.equal(resolveVendor("Some Local Credit Union").via, "guess");
assert.equal(vendorDomain("Chase Bank"), "chase.com");
ok("via distinguishes a curated hit from a guess");

// ---------------------------------------------------------------- pack fixture
const root = fs.mkdtempSync(path.join(os.tmpdir(), "brand-proof-"));
const pack = path.join(root, "pack");
fs.mkdirSync(path.join(pack, "icons"), { recursive: true });
fs.mkdirSync(path.join(pack, "logos"), { recursive: true });

const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"); // PNG magic + a little
const write = (kind: string, file: string, buf: Buffer) => fs.writeFileSync(path.join(pack, kind, file), buf);

write("icons", "chase.com.ico", Buffer.concat([png, Buffer.alloc(300)]));
write("icons", "usaa.com.png", Buffer.concat([png, Buffer.alloc(300)]));
write("logos", "chase.com.svg", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"));
write("logos", "amazon.com.svg", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"));
write("logos", "amazon-light.svg", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")); // bad stem
write("logos", "amazon.com-light.svg", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"));
write("logos", "README.md", Buffer.from("not an image"));
write("logos", "no-extension", Buffer.from("junk"));
write("logos", "..evil.png", Buffer.from("junk"));
write("icons", "empty.com.png", Buffer.alloc(0));

const db = new Database(path.join(root, "vault.db"));
ensureVaultSchema(db as never);

// ---------------------------------------------------------------- import
const r1 = importBrandPack(db as never, ORG, pack, "2026.08.20-1");
assert.equal(r1.imported, 5, "chase icon+logo, usaa icon, amazon logo + its light variant");
assert.ok(r1.skipped >= 4, "README, no-extension, ..evil.png, empty file and the bad stem are skipped");
ok(`imported ${r1.imported}, skipped ${r1.skipped} — junk never reaches the table`);

// ---------------------------------------------------------------- lookup
const logo = brandAssetFor(db as never, ORG, "chase.com", "logo");
assert.equal(logo?.mime, "image/svg+xml");
assert.ok(logo!.dataBase64.length > 0);
ok("a logo comes back as base64 with its mime");

const fallback = brandAssetFor(db as never, ORG, "usaa.com", "logo");
assert.equal(fallback?.kind, "icon", "no logo for usaa — the icon stands in rather than nothing");
ok("a missing logo degrades to the icon, never to a broken tile");

assert.equal(brandAssetFor(db as never, ORG, "amazon.com", "logo", "light")?.variant, "light");
assert.equal(brandAssetFor(db as never, ORG, "amazon.com", "logo", "dark")?.variant, "", "no dark file — default");
ok("variant preference degrades to the default file");

assert.equal(brandAssetFor(db as never, ORG, "never-imported.com", "logo"), null);
assert.equal(brandAssetFor(db as never, ORG, "not a domain", "logo"), null);
assert.equal(brandAssetFor(db as never, ORG, 42, "logo"), null);
assert.equal(brandAssetFor(db as never, "other-org", "chase.com", "logo"), null, "org scoping holds");
ok("unknown, malformed and cross-org lookups return null instead of throwing");

// ---------------------------------------------------------------- re-import
const before = brandPackStatus(db as never, ORG);
const r2 = importBrandPack(db as never, ORG, pack, "2026.08.20-2");
const after = brandPackStatus(db as never, ORG);
assert.equal(r2.imported, before.count, "same pack, same row count");
assert.equal(after.count, before.count, "re-import upserts — it must not duplicate rows");
assert.equal(after.packVersion, "2026.08.20-2", "the stored version moves with the import");
ok("re-import replaces in place; the unique index holds and the version advances");

// A pack that drops a vendor must not leave last month's artwork behind.
fs.rmSync(path.join(pack, "logos", "amazon.com.svg"));
fs.rmSync(path.join(pack, "logos", "amazon.com-light.svg"));
importBrandPack(db as never, ORG, pack, "2026.08.20-3");
assert.equal(brandAssetFor(db as never, ORG, "amazon.com", "logo"), null, "dropped vendor is gone");
ok("whole-pack replace — a removed vendor does not linger");

// ---------------------------------------------------------------- guards
assert.throws(() => importBrandPack(db as never, ORG, pack, ""), /version/);
const emptyDir = path.join(root, "empty");
fs.mkdirSync(emptyDir, { recursive: true });
assert.equal(importBrandPack(db as never, ORG, emptyDir, "v0").imported, 0, "a pack with no folders is not a crash");
assert.equal(brandPackStatus(db as never, ORG).packVersion, null, "no rows — no version claimed");
ok("a versionless import is refused; an empty pack empties the table cleanly");

db.close();
fs.rmSync(root, { recursive: true, force: true });
console.log(`\nbrand proof: ${n}/${n} passed`);
