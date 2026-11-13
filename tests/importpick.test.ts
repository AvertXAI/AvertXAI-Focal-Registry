/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
/* File: tests/importpick.test.ts */
// The import allow-list (VA-02): only a file the open dialog just handed out may be read, and only
// once. Every path here is made up and none is touched on disk — the rule is about paths, and the
// read itself stays in the handler.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { createImportPick } from "../electron/core/services/vault/importPick";

const zone = path.resolve("fake-folder", "fake-zone.txt");
const hosts = path.resolve("fake-folder", "fake-hosts.csv");
const NOT_PICKED = /was not chosen in the file dialog/;

test("a path the dialog never handed out is refused", () => {
  const pick = createImportPick();
  assert.throws(() => pick.take(zone), NOT_PICKED, "nothing has been picked yet");
  pick.remember([zone]);
  assert.throws(() => pick.take(hosts), NOT_PICKED, "a different file from the one picked");
  assert.equal(pick.take(zone), zone, "a refusal does not cost the user their real pick");
});

test("a picked path is read once, and a second read needs a new pick", () => {
  const pick = createImportPick();
  assert.deepEqual(pick.remember([zone]), [zone], "the dialog's answer reaches the page unchanged");
  assert.equal(pick.take(zone), zone);
  assert.throws(() => pick.take(zone), NOT_PICKED);
  pick.remember([zone]);
  assert.equal(pick.take(zone), zone);
});

test("one read spends the whole pick, not just the file that was read", () => {
  const pick = createImportPick();
  pick.remember([zone, hosts]);
  assert.equal(pick.take(hosts), hosts);
  assert.throws(() => pick.take(zone), NOT_PICKED);
});

test("the next pick replaces the last one, and a cancelled dialog leaves nothing readable", () => {
  const pick = createImportPick();
  pick.remember([zone]);
  pick.remember([hosts]);
  assert.throws(() => pick.take(zone), NOT_PICKED);
  pick.remember([]);
  assert.throws(() => pick.take(hosts), NOT_PICKED);
});

test("paths are compared after normalising, and the dialog's own spelling is the one handed on", () => {
  const pick = createImportPick();
  pick.remember([zone]);
  const roundabout = `${path.dirname(zone)}${path.sep}other${path.sep}..${path.sep}fake-zone.txt`;
  assert.notEqual(roundabout, zone);
  assert.equal(pick.take(roundabout), zone);
});

test("two importers do not share a list", () => {
  const vault = createImportPick();
  const other = createImportPick();
  vault.remember([zone]);
  assert.throws(() => other.take(zone), NOT_PICKED);
  assert.equal(vault.take(zone), zone);
});

test("nothing, or something that is not a path, is refused", () => {
  const pick = createImportPick();
  pick.remember([zone]);
  assert.throws(() => pick.take(""), /No file was chosen/);
  assert.throws(() => pick.take(undefined), /No file was chosen/);
  assert.throws(() => pick.take([zone]), /No file was chosen/);
  assert.equal(pick.take(zone), zone);
});
