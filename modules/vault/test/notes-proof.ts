// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Proof for the two pure engines added on 08-11-2026, both of which are exactly the
//              kind of code that looks right and is wrong on the fourth edge case:
//
//              1. markdown.tsx preprocess() — rewrites the vault chip and task lists into Markdoc
//                 tags, and MUST NOT touch anything inside a fenced code block. A runbook that
//                 documents this very syntax is the case that breaks a naive global replace.
//              2. log.ts isUserFacing() — decides whether a thrown message is fit to put in front
//                 of a person. Getting this wrong in one direction leaks a stack trace to the user;
//                 in the other it hides "The vault is locked." behind a generic apology.
//
//              Run: npx esbuild modules/vault/test/notes-proof.ts --bundle --platform=node
//                     --format=cjs --external:electron --external:better-sqlite3-multiple-ciphers
//                     --outfile=modules/vault/test/notes-proof.cjs
//                   node modules/vault/test/notes-proof.cjs
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: test/notes-proof.ts
//------------------------------------------------------------
import assert from "node:assert/strict";
import Database from "better-sqlite3-multiple-ciphers";
import { preprocess } from "../../../src/modules/vault/markdown";
import { GENERIC, isUserFacing, newRequestId, presentableMessage, userError } from "../../../electron/core/services/vault/log";
import { parseServers } from "../../../electron/core/services/vault/infra";
import { parseGitRemote } from "../../../electron/core/services/vault/repos";
import { compactDecision } from "../../../electron/core/services/vault/settings";
import { ensureVaultSchema } from "../../../electron/core/services/vault/db";
import { createNote, getNote, updateNote } from "../../../electron/core/services/vault/notes";

let checks = 0;
const check = (name: string, fn: () => void): void => { fn(); checks++; console.log(`  ok  ${name}`); };

console.log("markdown.tsx — preprocess()");

check("a vault chip becomes a self-closing Markdoc tag", () => {
  assert.equal(preprocess("See @[[vault:Hetzner root]] now."), 'See {% vault label="Hetzner root" /%} now.');
});

check("the ESCAPED chip form round-tripped through ProseMirror still matches", () => {
  // ProseMirror's markdown serializer escapes '[' in plain text, so a chip typed into Milkdown can
  // come back out looking like this. If it stopped matching, every chip would break on second save.
  assert.equal(preprocess("A @\\[\\[vault:DB\\]\\] b"), 'A {% vault label="DB" /%} b');
});

check("a label containing a quote cannot break out of the tag attribute", () => {
  const out = preprocess('@[[vault:He said "hi"]]');
  assert.equal(out, '{% vault label="He said \\"hi\\"" /%}');
});

check("task lists become task tags, checked state preserved", () => {
  assert.equal(preprocess("- [ ] open"), "- {% task checked=false %}open{% /task %}");
  assert.equal(preprocess("- [x] done"), "- {% task checked=true %}done{% /task %}");
  assert.equal(preprocess("- [X] done"), "- {% task checked=true %}done{% /task %}", "capital X counts");
});

check("an INDENTED task list keeps its indentation, so nesting survives", () => {
  assert.equal(preprocess("  - [ ] nested"), "  - {% task checked=false %}nested{% /task %}");
});

check("a plain bullet is left alone", () => {
  assert.equal(preprocess("- ordinary"), "- ordinary");
});

// THE case the fence split exists for.
check("NOTHING inside a fenced code block is rewritten", () => {
  const src = ["Before @[[vault:A]]", "```bash", "echo @[[vault:B]]", "- [ ] not a task", "```", "After @[[vault:C]]"].join("\n");
  const out = preprocess(src);
  assert.ok(out.includes('Before {% vault label="A" /%}'), "prose before the fence IS rewritten");
  assert.ok(out.includes("echo @[[vault:B]]"), "the chip inside the fence is untouched");
  assert.ok(out.includes("- [ ] not a task"), "the task line inside the fence is untouched");
  assert.ok(out.includes('After {% vault label="C" /%}'), "prose after the fence IS rewritten");
});

check("an UNCLOSED fence still swallows to the end — a half-typed block never gets rewritten", () => {
  const out = preprocess("```\n@[[vault:X]]\n- [ ] y");
  assert.ok(out.includes("@[[vault:X]]"), "still literal");
  assert.ok(out.includes("- [ ] y"), "still literal");
});

check("a <br /> soft break becomes a real newline and never survives as a tag", () => {
  assert.equal(preprocess("one<br />two"), "one\ntwo");
  assert.equal(preprocess("one<br>two"), "one\ntwo");
});

console.log("log.ts — the two-audience split");

check("a complete sentence is shown to the user", () => {
  // Every one of these is a real message from the services, copied verbatim.
  for (const m of [
    "The vault is locked.",
    "A server needs a host name.",
    "Pick at least one kind of character.",
    "That passphrase does not open this archive — or the file has been altered since it was written.",
  ]) assert.equal(isUserFacing(new Error(m)), true, m);
});

check("a developer fragment is NOT shown to the user", () => {
  for (const m of [
    "Secret not found",
    "Invalid note locator",
    "Unknown vault setting",
    "Vault: no active org",
    "safeStorage unavailable — cannot protect the vault key file",
  ]) assert.equal(isUserFacing(new Error(m)), false, m);
});

check("a library error that happens to end in a period is still hidden", () => {
  // This is the one that would leak a path or a schema name to a photographer.
  assert.equal(isUserFacing(new Error("SQLITE_ERROR: no such column: foo.")), false);
  assert.equal(isUserFacing(new Error("ENOENT: no such file or directory, open 'C:/Users/x/secret.csv'.")), false);
});

check("a paragraph-length message is hidden however it is punctuated", () => {
  assert.equal(isUserFacing(new Error(`${"x".repeat(240)}.`)), false);
});

check("userError() forces a message through whatever its punctuation", () => {
  assert.equal(isUserFacing(userError("no trailing period here")), true);
});

check("a non-Error is never treated as user-facing", () => {
  assert.equal(isUserFacing("a bare string"), false);
  assert.equal(isUserFacing(null), false);
});

check("the reference id is stable in shape and unique per call", () => {
  const ids = new Set(Array.from({ length: 200 }, () => newRequestId()));
  for (const id of ids) assert.match(id, /^VLT-[0-9A-F]{6}$/);
  assert.ok(ids.size > 190, `expected near-unique ids, got ${ids.size}/200`);
});

check("presentableMessage keeps a user sentence but REPLACES a developer one — both referenced", () => {
  const kept = presentableMessage(new Error("The vault is locked."), "VLT-ABC123");
  assert.equal(kept, "The vault is locked. (Reference VLT-ABC123)");

  const hidden = presentableMessage(new Error("SQLITE_ERROR: no such column: secret_value"), "VLT-ABC123");
  assert.equal(hidden, `${GENERIC} (Reference VLT-ABC123)`);
  assert.ok(!hidden.includes("secret_value"), "the technical string must not reach the user");
});


console.log("infra.ts — parseServers()");

check("a CSV with a host column parses, loosely-named headers and all", () => {
  const { servers, skipped } = parseServers("Hostname,IP Address,Cloud,Purpose\navert-core-01,2a01:4f8::2,Hetzner,Coolify\nweb-02,10.0.0.5,Hetzner,nginx");
  assert.equal(servers.length, 2);
  assert.equal(skipped, 0);
  assert.deepEqual(servers[0], { host: "avert-core-01", address: "2a01:4f8::2", provider: "Hetzner", role: "Coolify", notes: "" });
});

check("quoted CSV fields keep their commas", () => {
  const { servers } = parseServers('host,notes\nbox-1,"Frankfurt, DE - primary"');
  assert.equal(servers[0].notes, "Frankfurt, DE - primary");
});

check("a JSON array parses, and {servers:[...]} does too", () => {
  assert.equal(parseServers('[{"host":"a"},{"host":"b"}]').servers.length, 2);
  assert.equal(parseServers('{"servers":[{"hostname":"c","ip":"1.2.3.4"}]}').servers[0].address, "1.2.3.4");
});

// THE case that matters: refusing beats importing a column of nonsense under the name "host".
check("a file with NO recognisable host column imports NOTHING", () => {
  const r = parseServers("colour,size\nred,large\nblue,small");
  assert.equal(r.servers.length, 0, "nothing is invented");
  assert.equal(r.skipped, 2, "and the rows are reported as skipped, not silently dropped");
});

check("rows with a blank host are skipped and counted, never imported as empty", () => {
  const r = parseServers("host,ip\nreal-1,1.1.1.1\n,2.2.2.2\n,3.3.3.3");
  assert.equal(r.servers.length, 1);
  assert.equal(r.skipped, 2);
});

check("malformed JSON falls back to CSV rather than refusing outright", () => {
  const r = parseServers("{host\nx");
  assert.ok(Array.isArray(r.servers), "returns a shape, does not throw");
});

check("empty and comment-only input is empty, not a crash", () => {
  assert.deepEqual(parseServers(""), { servers: [], skipped: 0 });
  assert.deepEqual(parseServers(null), { servers: [], skipped: 0 });
  assert.equal(parseServers("# just a comment").servers.length, 0);
});


console.log("repos.ts — parseGitRemote()");

check("origin wins over any other remote, whatever the order", () => {
  const cfg = ['[remote "upstream"]', "\turl = https://github.com/them/thing.git", '[remote "origin"]', "\turl = git@github.com:me/thing.git"].join("\n");
  assert.equal(parseGitRemote(cfg), "git@github.com:me/thing.git");
});

check("a single non-origin remote is still returned rather than nothing", () => {
  assert.equal(parseGitRemote('[remote "fork"]\n\turl = https://example.com/f.git'), "https://example.com/f.git");
});

// A url= under [core] or [branch] is not a remote, and picking one up would put junk on the row.
check("a url outside any remote section is NOT mistaken for one", () => {
  assert.equal(parseGitRemote('[core]\n\turl = not-a-remote\n[branch "main"]\n\tremote = origin'), "");
});

check("a clone with no remote at all returns empty, and junk does not throw", () => {
  assert.equal(parseGitRemote("[core]\n\tbare = false"), "");
  assert.equal(parseGitRemote(""), "");
  assert.equal(parseGitRemote(null), "");
  assert.equal(parseGitRemote("!!! not ini !!!"), "");
});


console.log("settings.ts — compactDecision()");

const MB = 1048576;
const base = { every: "weekly", absoluteBar: 20 * MB, sinceLastMs: null as number | null };

check("a healthy vault is left alone", () => {
  const v = compactDecision({ ...base, reclaimable: 1 * MB, fileBytes: 200 * MB });
  assert.equal(v.compact, false);
  assert.equal(v.reason, "below-threshold");
});

check("enough absolute dead space triggers it", () => {
  const v = compactDecision({ ...base, reclaimable: 25 * MB, fileBytes: 200 * MB });
  assert.equal(v.compact, true);
  assert.equal(v.why, "absolute");
});

// Jason's "if close to the limit, compact, no harm no foul".
check("WITHIN 80% of the absolute bar still triggers — close is close enough", () => {
  const v = compactDecision({ ...base, reclaimable: 16 * MB, fileBytes: 200 * MB }); // 80% of 20 MB
  assert.equal(v.compact, true, "16 MB against a 20 MB bar is inside the near band");
  const under = compactDecision({ ...base, reclaimable: 15 * MB, fileBytes: 200 * MB });
  assert.equal(under.compact, false, "…but 15 MB is not");
});

check("a SMALL but proportionally rotten vault triggers on ratio, not size", () => {
  // 8 MB dead of 30 MB = 27%. Nowhere near the 20 MB absolute bar, but a quarter of the file.
  const v = compactDecision({ ...base, reclaimable: 8 * MB, fileBytes: 30 * MB });
  assert.equal(v.compact, true);
  assert.equal(v.why, "proportional");
});

check("the ratio rule has a FLOOR — a tiny file is never rebuilt to win crumbs", () => {
  // 2 MB dead of 4 MB is 50% rotten, but 2 MB is not worth a full rewrite.
  const v = compactDecision({ ...base, reclaimable: 2 * MB, fileBytes: 4 * MB });
  assert.equal(v.compact, false, "50% of nothing is still nothing");
});

check("COOLDOWN outranks every trigger — it cannot rebuild in a loop", () => {
  const v = compactDecision({ ...base, reclaimable: 90 * MB, fileBytes: 100 * MB, sinceLastMs: 60_000 });
  assert.equal(v.compact, false);
  assert.equal(v.reason, "cooldown", "even a 90%-dead file waits out the ten minutes");
});

check("off means off, however bloated it is", () => {
  const v = compactDecision({ ...base, every: "off", reclaimable: 90 * MB, fileBytes: 100 * MB });
  assert.equal(v.compact, false);
  assert.equal(v.reason, "off");
});

// THE BUG THIS REPLACED: the first version asked "is it Tuesday?" before "is it bloated?", so a
// rotten vault sat there for a week because the calendar said no.
check("PRESSURE BEATS THE CALENDAR — a bloated vault does not wait for the schedule", () => {
  const v = compactDecision({ ...base, every: "weekly", reclaimable: 60 * MB, fileBytes: 100 * MB, sinceLastMs: 60 * 60 * 1000 });
  assert.equal(v.compact, true, "one hour since the last compact, weekly schedule — pressure still wins");
  assert.equal(v.why, "absolute");
});

check("the schedule is a BACKSTOP, and still refuses when there is nothing to gain", () => {
  const due = 8 * 24 * 60 * 60 * 1000; // over a week
  const worth = compactDecision({ ...base, reclaimable: 6 * MB, fileBytes: 400 * MB, sinceLastMs: due });
  assert.equal(worth.compact, true);
  assert.equal(worth.why, "schedule");
  const notWorth = compactDecision({ ...base, reclaimable: 1 * MB, fileBytes: 400 * MB, sinceLastMs: due });
  assert.equal(notWorth.compact, false, "due, but 1 MB is not worth rewriting 400 MB");
});

check("an empty or unreadable file does not divide by zero", () => {
  const v = compactDecision({ ...base, reclaimable: 0, fileBytes: 0 });
  assert.equal(v.ratio, 0);
  assert.equal(v.compact, false);
});

// ---- + New flushes the draft first (Tier-1 fix 5) ---------------------------------------------
// The renderer's newNote used to jump straight to createNote, so a dirty draft died on the way to
// the fresh note — the ONE record-change route that skipped the flush rule (RULES-40: any editor
// holding user text flushes before the record changes). This replays both call sequences against
// the real services; run under ELECTRON_RUN_AS_NODE like engine-proof (Electron-ABI native module).
console.log("\nnotes.ts — + New flushes before creating");
{
  const db = new Database(":memory:");
  ensureVaultSchema(db);
  const ORG = "flush-org";

  check("the FIXED sequence — flush, then create — keeps the typed body", () => {
    const a = createNote(db, ORG, { kind: "note", title: "Draft in progress", body: "saved text" });
    // The user types; the words exist only in renderer state. + New now sends them first.
    updateNote(db, ORG, a.uuid, { title: "Draft in progress", body: "saved text + the sentence just typed" });
    const b = createNote(db, ORG, { kind: "note", title: "Untitled", body: "" });
    assert.equal(getNote(db, ORG, a.uuid).body, "saved text + the sentence just typed", "the draft survived + New");
    assert.equal(getNote(db, ORG, b.uuid).body, "", "and the new note starts empty");
  });

  check("the OLD sequence — create without flushing — is exactly how the words died", () => {
    const c = createNote(db, ORG, { kind: "note", title: "Another draft", body: "saved text" });
    createNote(db, ORG, { kind: "note", title: "Untitled", body: "" }); // + New, no flush
    assert.equal(getNote(db, ORG, c.uuid).body, "saved text",
      "the database still holds only what was last flushed — the typed words were never sent");
  });
}

console.log(`\n${checks} checks passed.`);
