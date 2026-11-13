// The repair screen's rules, on fake notes: each kind of damage is found, code is never mistaken
// for damage, and what the screen shows as After is exactly what the editor's own save would store
// for the repaired note. Every string here is made up: no real note or credential may sit in a test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Editor, parserCtx, serializerCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { faithfulMarkdown, faithfulMarkdownConfig } from "../src/modules/mindmerge/editorLogic";
import { damageKinds } from "../src/modules/mindmerge/noteDamage";
import { changedLines, createRepairer } from "../src/modules/mindmerge/repairText";
import { tidyMarkdown } from "../src/modules/mindmerge/tidyMarkdown";

const REDIS = "redis://default:FAKEPASSWORD0000000000000000000000000000000000000000@fake-cache.internal:6379/0";
const DAMAGED_REDIS = "redis\\://default:FAKEPASSWORD0000000000000000000000000000000000000000\\@fake-cache.internal:6379/0";
const DAMAGED_LABEL = "\\*\\*Host:\\*\\*fake.internal";
const PENDING = "![shot.png](mindmerge-pending:fake1)";
const CODE = "```\nkeep \\@ and https\\://fake.internal and \\*\\*this:\\*\\*x as typed\n```";

// Milkdown signals readiness through window events and its view needs a real page; Node has
// neither. An event bus stands in for the first, and the view simply fails to mount: the reader
// and the writer are built before it. Same stand-ins as tests/editor.test.ts.
const bus = new EventTarget();
Object.assign(globalThis, {
  addEventListener: bus.addEventListener.bind(bus),
  removeEventListener: bus.removeEventListener.bind(bus),
  dispatchEvent: bus.dispatchEvent.bind(bus),
  document: { body: {} },
});

// The yardstick is a second editor, built the way tests/editor.test.ts builds one, that knows
// nothing about repairs. If the repair ever stored something the editor's save would not, the
// two disagree here.
async function build() {
  const editor = Editor.make().config(faithfulMarkdownConfig).use(commonmark).use(gfm).use(faithfulMarkdown);
  await editor.create().catch(() => undefined);
  const parse = (markdown: string): ProseNode => editor.ctx.get(parserCtx)(markdown);
  /** What a save from the editor stores for this text: read, write, then the save path's Tidy. */
  const saved = (markdown: string): string => tidyMarkdown(editor.ctx.get(serializerCtx)(parse(markdown)));
  return { parse, saved, repairer: await createRepairer() };
}
const ready = build();

test("each of the four kinds of damage is found in a fake stored note", () => {
  assert.deepEqual(damageKinds(DAMAGED_REDIS), ["scheme", "at"]);
  assert.deepEqual(damageKinds("see https\\://fake.internal/page"), ["scheme"]);
  assert.deepEqual(damageKinds("write to fake\\@fake.internal today"), ["at"]);
  assert.deepEqual(damageKinds(DAMAGED_LABEL), ["label"]);
  assert.deepEqual(damageKinds(`before\n\n${PENDING}\n\nafter`), ["picture"]);
  assert.deepEqual(damageKinds(`\\*\\*Cache:\\*\\*${DAMAGED_REDIS}\n\n${PENDING}`), ["scheme", "at", "label", "picture"]);
});

test("a clean note is not listed, and neither is one whose backslashes sit in code", () => {
  assert.deepEqual(damageKinds(`**Cache:**${REDIS}\n\nmail fake@fake.internal`), []);
  assert.deepEqual(damageKinds(CODE), []);
  assert.deepEqual(damageKinds("~~~sh\necho fake\\@fake.internal\n~~~\n\nrun `sed s/\\@/at/` first"), []);
  assert.deepEqual(damageKinds("- step one\n\n  ```\n  curl https\\://fake.internal\n  ```"), []);
});

test("a backslash before :// and before @ is repaired to exactly what the editor's save stores", async () => {
  const { saved, repairer } = await ready;
  const after = repairer.repair(DAMAGED_REDIS);
  assert.equal(after, saved(REDIS));
  assert.equal(after.trim(), REDIS);
  assert.deepEqual(damageKinds(after), []);
  assert.equal(repairer.repair(after), after, "a second repair changes nothing");
});

test("a damaged label gets its bold back, exactly as the editor saves that bold", async () => {
  const { parse, saved, repairer } = await ready;
  const after = repairer.repair(DAMAGED_LABEL);
  assert.equal(after, saved("**Host:**fake.internal"));
  assert.equal(after.trim(), "**Host:**fake.internal");
  const label = parse(after).firstChild?.firstChild;
  assert.equal(label?.text, "Host:");
  assert.equal(label?.marks.some((mark) => mark.type.name === "strong"), true);
  assert.deepEqual(damageKinds(after), []);
  assert.equal(repairer.repair(after), after, "a second repair changes nothing");
});

test("a label that holds a bracket is repaired at the start of a line, to the editor's own text", async () => {
  const { saved, repairer } = await ready;
  const LABELLED = "**URL (INTERNAL):**redis://default:FAKE000@fake.internal:6379/0";
  const stored = "\\*\\*URL (INTERNAL):\\*\\*redis\\://default:FAKE000\\@fake.internal:6379/0";
  assert.deepEqual(damageKinds(stored), ["scheme", "at", "label"]);
  const after = repairer.repair(stored);
  assert.equal(after, saved(LABELLED));
  assert.equal(after.trim(), LABELLED);
  assert.deepEqual(damageKinds(after), []);
});

test("right after a bracket, an escaped pair that is not a label is never made bold", async () => {
  const { parse, saved, repairer } = await ready;
  const stored = "call f(\\*\\*a(b):\\*\\*c) here";
  assert.deepEqual(damageKinds(stored), ["label"]);
  const after = repairer.repair(stored);
  assert.equal(after, saved(stored), "nothing but the editor's own round trip was applied");
  // The editor shows these asterisks as typed, so its save stores them without the backslashes.
  assert.equal(after.trim(), "call f(**a(b):**c) here");
  assert.equal(parse(after).textContent, "call f(**a(b):**c) here", "the asterisks are text, not bold");
});

test("the broken picture goes only when its box is ticked", async () => {
  const { saved, repairer } = await ready;
  const stored = `before\n\n${PENDING}\n\nafter`;
  assert.equal(repairer.repair(stored).includes("mindmerge-pending:"), true, "left alone until asked");
  const after = repairer.repair(stored, true);
  assert.equal(after, saved("before\n\nafter"), "the picture's own line goes with it");
  assert.deepEqual(damageKinds(after), []);
  assert.equal(repairer.repair(after, true), after, "a second repair changes nothing");
  assert.equal(repairer.repair(`one ${PENDING} two`, true), saved("one  two"), "a picture inside a sentence leaves the sentence");
});

test("a note with every kind of damage: After is what a save of the repaired note stores, and code is untouched", async () => {
  const { saved, repairer } = await ready;
  const stored = `# Fake service\n\n\\*\\*Cache:\\*\\*${DAMAGED_REDIS}\n\n- mail fake\\@fake.internal\n\n${PENDING}\n\n${CODE}\n`;
  const repaired = `# Fake service\n\n**Cache:**${REDIS}\n\n- mail fake@fake.internal\n\n${CODE}\n`;
  const after = repairer.repair(stored, true);
  assert.equal(after, saved(repaired));
  assert.equal(after.includes(CODE), true, "the code block is character for character what was stored");
  assert.deepEqual(damageKinds(after), []);
  assert.equal(repairer.repair(after, true), after, "a second repair changes nothing");
});

test("the Before and After boxes hold only the changed lines, each with one line around it", () => {
  assert.deepEqual(changedLines("a\nb\nc\nd\ne", "a\nb\nX\nd\ne"), { before: "⋯\nb\nc\nd\n⋯", after: "⋯\nb\nX\nd\n⋯" });
  assert.deepEqual(changedLines("a\nb\nc", "a\nc"), { before: "a\nb\nc", after: "a\nc" });
  assert.deepEqual(changedLines("a\r\nb", "a\nb"), { before: "", after: "" }, "line endings alone are not a change");
});
