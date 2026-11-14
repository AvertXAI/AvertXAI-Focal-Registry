/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
/* File: tests/importscope.test.ts */
// The reusable import record (SEC-01): the password import and the document import read only what
// a dialog (or the export scan) handed out, as often as the page legitimately asks, and nothing
// the page names itself. Each test follows the order the page really calls the channels in. The
// files and folders are made up and live in a throwaway folder under the temp directory.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createImportPick, createImportScope } from "../electron/core/services/vault/importPick";

// Resolved once here so every fake path below is already in the spelling the guard hands back.
const tmp = path.resolve(fs.mkdtempSync(path.join(os.tmpdir(), "fr-importscope-")));
process.on("exit", () => fs.rmSync(tmp, { recursive: true, force: true }));

const chosen = path.join(tmp, "fake-notes");
const second = path.join(tmp, "fake-runbooks");
// Starts with the chosen folder's whole name, which is what a prefix test without a separator lets through.
const sibling = path.join(tmp, "fake-notes-other");
const inside = path.join(chosen, "sub", "deeper", "fake-note.md");
const inSecond = path.join(second, "fake-runbook.md");
const inSibling = path.join(sibling, "fake-private.md");
const loose = path.join(tmp, "fake-loose.txt");
const exportCsv = path.join(tmp, "fake-export.csv");
const otherCsv = path.join(tmp, "fake-other.csv");
const fakes: [string, string][] = [
  [inside, "# Fake Person\n"],
  [inSecond, "1. Fake step\n"],
  [inSibling, "000-00-1234\n"],
  [loose, "fake loose file\n"],
  [exportCsv, "name,password\nFake Site,fake-password\n"],
  [otherCsv, "name,password\nFake Other,fake-password\n"],
];
for (const [file, text] of fakes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

const FILE_NOT_PICKED = /was not chosen in the file dialog/;
const FOLDER_NOT_PICKED = /was not chosen in the folder dialog/;
const NOT_IN_A_PICK = /not inside a folder that was chosen/;
// Spelled by hand: path.join would tidy the ".." away before the guard ever saw it.
const upAndOver = (from: string, ...rest: string[]): string => [from, "..", ...rest].join(path.sep);

// ---- vault:importPreview / vault:importCsv / vault:importArchive

test("password import: the picked file is previewed, imported, and tried again after a wrong passphrase", () => {
  const pick = createImportScope();
  assert.throws(() => pick.file(exportCsv), FILE_NOT_PICKED, "nothing has been picked yet");
  assert.deepEqual(pick.addFiles([exportCsv]), [exportCsv], "the dialog's answer reaches the page unchanged");
  assert.equal(pick.file(exportCsv), exportCsv, "the preview");
  assert.equal(pick.file(exportCsv), exportCsv, "the import");
  assert.equal(pick.file(exportCsv), exportCsv, "the second try");
  assert.match(fs.readFileSync(pick.file(exportCsv), "utf8"), /Fake Site/);
});

test("password import: any other path is refused, and the refusal does not cost the real pick", () => {
  const pick = createImportScope();
  pick.addFiles([exportCsv]);
  assert.throws(() => pick.file(otherCsv), FILE_NOT_PICKED, "a file next to the picked one");
  assert.throws(() => pick.file(upAndOver(exportCsv, "fake-other.csv")), FILE_NOT_PICKED, "another file reached through ..");
  assert.throws(() => pick.file(tmp), FILE_NOT_PICKED, "the folder the picked file is in");
  assert.throws(() => pick.file(""), /No file was chosen/);
  assert.throws(() => pick.file(undefined), /No file was chosen/);
  assert.throws(() => pick.file([exportCsv]), /No file was chosen/);
  assert.equal(pick.file(exportCsv), exportCsv);
});

test("password import: a roundabout spelling of the picked file reads the dialog's own path", () => {
  const pick = createImportScope();
  pick.addFiles([exportCsv]);
  assert.equal(pick.file(upAndOver(chosen, "fake-export.csv")), exportCsv);
});

test("password import: a cancelled dialog keeps the file on screen, and a new source starts over", () => {
  const pick = createImportScope();
  pick.addFiles([otherCsv, exportCsv]); // what the scan found
  pick.addFiles([]); // "Choose a file", then Cancel
  assert.equal(pick.file(exportCsv), exportCsv, "a found file is still usable after a cancelled dialog");
  pick.addFiles([loose]); // "Choose a different file"
  assert.equal(pick.file(loose), loose);
  pick.clear(); // the next source click
  assert.throws(() => pick.file(exportCsv), FILE_NOT_PICKED);
  assert.throws(() => pick.file(loose), FILE_NOT_PICKED);
});

// ---- vault:walkFolders / mindmerge:walkFolders

test("folder import: only picked folders are listed, in the dialog's own spelling", () => {
  const pick = createImportScope();
  assert.throws(() => pick.walkRoots([chosen]), FOLDER_NOT_PICKED, "nothing has been picked yet");
  assert.deepEqual(pick.addFolders([chosen, second]), [chosen, second], "several folders in one dialog");
  assert.deepEqual(pick.walkRoots([chosen, second]), [chosen, second]);
  assert.deepEqual(pick.walkRoots([upAndOver(sibling, "fake-notes"), second]), [chosen, second]);
});

test("folder import: a folder that was not picked is not listed, and the refusal changes nothing", () => {
  const pick = createImportScope();
  pick.addFolders([chosen]);
  assert.throws(() => pick.walkRoots([chosen, sibling]), FOLDER_NOT_PICKED, "a sibling that starts with the same name");
  assert.throws(() => pick.walkRoots([upAndOver(chosen, "fake-notes-other")]), FOLDER_NOT_PICKED, "out through ..");
  assert.throws(() => pick.walkRoots([tmp]), FOLDER_NOT_PICKED, "the parent of the picked folder");
  assert.throws(() => pick.walkRoots([path.join(chosen, "sub")]), FOLDER_NOT_PICKED, "a folder the page made up inside the picked one");
  assert.throws(() => pick.walkRoots([42]), /No folder was chosen/);
  assert.deepEqual(pick.walkRoots([chosen]), [chosen]);
  assert.equal(pick.doc(inside), inside);
});

test("folder import: a second dialog adds to the list, and a folder dropped from the list stops being readable", () => {
  const pick = createImportScope();
  pick.addFolders([chosen]);
  pick.walkRoots([chosen]);
  pick.addFolders([second]); // "choose a whole folder" again
  assert.deepEqual(pick.walkRoots([chosen, second]), [chosen, second]);
  assert.equal(pick.doc(inSecond), inSecond);
  pick.walkRoots([chosen]); // the second folder's chip is removed on the page
  assert.throws(() => pick.doc(inSecond), NOT_IN_A_PICK);
  assert.throws(() => pick.walkRoots([chosen, second]), FOLDER_NOT_PICKED);
  assert.equal(pick.doc(inside), inside, "the folder still listed is untouched");
});

// ---- vault:importDocs / mindmerge:importDocs

test("document import: every file under a picked folder is read, at any depth, more than once", () => {
  const pick = createImportScope();
  pick.addFolders([chosen, second]);
  pick.walkRoots([chosen, second]);
  assert.equal(pick.doc(inside), inside);
  assert.equal(pick.doc(inSecond), inSecond);
  assert.equal(pick.doc(inside), inside, "a failed import is tried again with the same list");
  assert.match(fs.readFileSync(pick.doc(inside), "utf8"), /Fake Person/);
});

test("document import: a path outside every picked folder is refused", () => {
  const pick = createImportScope();
  assert.throws(() => pick.doc(inside), NOT_IN_A_PICK, "nothing has been picked yet");
  pick.addFolders([chosen]);
  assert.throws(() => pick.doc(inSibling), NOT_IN_A_PICK, "a sibling folder that starts with the same name");
  assert.throws(() => pick.doc(upAndOver(chosen, "fake-notes-other", "fake-private.md")), NOT_IN_A_PICK, "out through ..");
  assert.throws(() => pick.doc(upAndOver(path.join(chosen, "sub"), "..", "fake-loose.txt")), NOT_IN_A_PICK, "out through two ..");
  assert.throws(() => pick.doc(loose), NOT_IN_A_PICK, "a file next to the picked folder");
  assert.throws(() => pick.doc(chosen), NOT_IN_A_PICK, "the picked folder itself is not a file in it");
  assert.throws(() => pick.doc(""), /No file was chosen/);
  assert.throws(() => pick.doc(undefined), /No file was chosen/);
  assert.equal(pick.doc(inside), inside, "a refusal does not cost the real pick");
});

test("document import: a path that leaves the picked folder and comes back is read by its plain spelling", () => {
  const pick = createImportScope();
  pick.addFolders([chosen]);
  assert.equal(pick.doc(upAndOver(path.join(chosen, "sub"), "sub", "deeper", "fake-note.md")), inside);
});

test("document import: hand-picked files add up across dialogs and are read beside a picked folder", () => {
  const pick = createImportScope();
  pick.addFolders([chosen]);
  pick.addFiles([loose]);
  pick.addFiles([]); // a cancelled second dialog
  pick.addFiles([exportCsv]);
  assert.equal(pick.doc(loose), loose);
  assert.equal(pick.doc(exportCsv), exportCsv);
  assert.equal(pick.doc(inside), inside);
  assert.throws(() => pick.doc(otherCsv), NOT_IN_A_PICK, "a file next to a hand-picked one");
});

test("document import: a finished import spends every pick", () => {
  const pick = createImportScope();
  pick.addFolders([chosen]);
  pick.addFiles([loose]);
  pick.clear();
  assert.throws(() => pick.doc(inside), NOT_IN_A_PICK);
  assert.throws(() => pick.doc(loose), NOT_IN_A_PICK);
  assert.throws(() => pick.file(loose), FILE_NOT_PICKED);
  assert.throws(() => pick.folder(chosen), FOLDER_NOT_PICKED);
});

// ---- vault:statFiles / mindmerge:statFiles

test("hand-picked files: only the files the dialog handed out are looked at", () => {
  const pick = createImportScope();
  pick.addFolders([chosen]);
  pick.addFiles([loose]);
  assert.deepEqual([loose].map(pick.file), [loose]);
  assert.throws(() => [loose, otherCsv].map(pick.file), FILE_NOT_PICKED);
  assert.throws(() => pick.file(inside), FILE_NOT_PICKED, "a file in a picked folder was not hand-picked");
});

// ---- mindmerge:importDocs, the roots it records for the refresh and the watcher

test("recorded roots: only a picked folder is written down to be re-read later", () => {
  const pick = createImportScope();
  pick.addFolders([chosen]);
  assert.equal(pick.folder(chosen), chosen);
  assert.equal(pick.folder(upAndOver(sibling, "fake-notes")), chosen, "the dialog's own spelling is the one recorded");
  assert.throws(() => pick.folder(sibling), FOLDER_NOT_PICKED);
  assert.throws(() => pick.folder(upAndOver(chosen, "fake-notes-other")), FOLDER_NOT_PICKED);
  assert.throws(() => pick.folder(path.join(chosen, "sub")), FOLDER_NOT_PICKED);
  assert.throws(() => pick.folder(inside), FOLDER_NOT_PICKED, "a file is not a folder");
  assert.throws(() => pick.folder(undefined), /No folder was chosen/);
});

// ---- every channel

test("two importers do not share a record", () => {
  const vault = createImportScope();
  const mindmerge = createImportScope();
  vault.addFolders([chosen]);
  vault.addFiles([loose]);
  assert.throws(() => mindmerge.doc(inside), NOT_IN_A_PICK);
  assert.throws(() => mindmerge.file(loose), FILE_NOT_PICKED);
  assert.throws(() => mindmerge.walkRoots([chosen]), FOLDER_NOT_PICKED);
  assert.equal(vault.doc(inside), inside);
});

test("a path that differs only in case is the same path on Windows, and a different one elsewhere", () => {
  const scope = createImportScope();
  scope.addFolders([chosen]);
  scope.addFiles([exportCsv]);
  const oneShot = createImportPick();
  oneShot.remember([exportCsv]);
  const shoutedCsv = exportCsv.toUpperCase();
  const shoutedNote = inside.toUpperCase();
  assert.notEqual(shoutedCsv, exportCsv);
  if (process.platform === "win32") {
    assert.equal(scope.file(shoutedCsv), exportCsv);
    assert.equal(scope.folder(chosen.toUpperCase()), chosen);
    assert.equal(scope.doc(shoutedNote), shoutedNote);
    assert.throws(() => scope.doc(inSibling.toUpperCase()), NOT_IN_A_PICK);
    assert.equal(oneShot.take(shoutedCsv), exportCsv);
  } else {
    assert.throws(() => scope.file(shoutedCsv), FILE_NOT_PICKED);
    assert.throws(() => scope.folder(chosen.toUpperCase()), FOLDER_NOT_PICKED);
    assert.throws(() => scope.doc(shoutedNote), NOT_IN_A_PICK);
    assert.throws(() => oneShot.take(shoutedCsv), FILE_NOT_PICKED);
  }
});
