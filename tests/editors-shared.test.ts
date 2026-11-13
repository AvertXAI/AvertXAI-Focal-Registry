/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
/* File: tests/editors-shared.test.ts */
// The Vault and Scan Notes editors read and write markdown by MindMerge's rules (editorLogic.ts).
// These are the cases of tests/editor.test.ts, run against each of those two editors' own setup,
// built without a window. Run with `npm test`. Every string here is fake on purpose: the notes
// hold production credentials and none may be copied into a test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Editor, parserCtx, schemaCtx, serializerCtx } from "@milkdown/kit/core";
import type { Node as ProseNode, Schema } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
import { isSingleValue, placeImage, selectionMarkdown, settlePendingImages, sliceMarkdown, visibleText } from "../src/modules/mindmerge/editorLogic";
import { scanNotesMarkdownSetup } from "../src/modules/scan/notes/MilkdownEditor";
import { vaultMarkdownSetup } from "../src/modules/vault/MilkdownEditor";
import { tidyMarkdown as vaultTidy } from "../src/modules/vault/tidyMarkdown";

const REDIS = "redis://default:FAKEPASSWORD0000000000000000000000000000000000000000@fake-cache.internal:6379/0";
const POSTGRES = "postgres://fakeuser:FAKEPW00000000000000000000@fake-db.internal:5432/fakeapp";
const LABELLED = "**URL (INTERNAL):**redis://default:FAKE000@fake.internal:6379/0";
const SENTENCE = "**BOLD** and *italic* and a normal sentence.";
const FAKES = [REDIS, POSTGRES, LABELLED, SENTENCE];

// Milkdown signals readiness through window events and its view needs a real page; Node has
// neither. An event bus stands in for the first. The view simply fails to mount — the parser and
// serializer are built before it, which is all these tests use.
const bus = new EventTarget();
Object.assign(globalThis, {
  addEventListener: bus.addEventListener.bind(bus),
  removeEventListener: bus.removeEventListener.bind(bus),
  dispatchEvent: bus.dispatchEvent.bind(bus),
  document: { body: {} },
});

interface Setup {
  name: string;
  /** The function the editor's own component builds from, so the test cannot drift from the app. */
  configure: (editor: Editor) => Editor;
  /** What that module's save path does to the text on its way to storage. */
  tidy: (markdown: string) => string;
}
const VAULT: Setup = { name: "Vault", configure: vaultMarkdownSetup, tidy: vaultTidy };
// Scan Notes stores a note exactly as the editor wrote it (electron/core/services/scan/notes.ts).
const SCAN_NOTES: Setup = { name: "Scan Notes", configure: scanNotesMarkdownSetup, tidy: (markdown) => markdown };

async function build(setup: Setup) {
  const editor = setup.configure(Editor.make());
  await editor.create().catch(() => undefined);
  const ctx = editor.ctx;
  const schema: Schema = ctx.get(schemaCtx);
  const parse = (markdown: string): ProseNode => ctx.get(parserCtx)(markdown);
  const write = (doc: ProseNode): string => ctx.get(serializerCtx)(doc);
  /** What the store keeps: the editor's markdown after that module's save path. */
  const stored = (doc: ProseNode): string => setup.tidy(write(doc)).trim();
  const paragraph = (...content: ProseNode[]): ProseNode => schema.nodes.paragraph.create(null, content);
  const docOf = (...blocks: ProseNode[]): ProseNode => schema.topNodeType.create(null, blocks);
  return { ctx, schema, parse, write, stored, paragraph, docOf };
}
// One after the other: both editors announce readiness on the same stand-in event bus.
const vault = build(VAULT);
const scanNotes = vault.then(() => build(SCAN_NOTES));

const runsOf = (text: string): string[] => text.split(/\s+/).filter(Boolean);
const linkCount = (doc: ProseNode): number => {
  let links = 0;
  doc.descendants((node) => { if (node.marks.some((mark) => mark.type.name === "link")) links += 1; });
  return links;
};

for (const [setup, ready] of [[VAULT, vault], [SCAN_NOTES, scanNotes]] as const) {
  const named = (what: string): string => `${setup.name} editor, ${what}`;

  test(named("MM-02: a typed value is stored as one unbroken string"), async () => {
    const { schema, stored, paragraph, docOf } = await ready;
    for (const value of [REDIS, POSTGRES]) {
      assert.equal(stored(docOf(paragraph(schema.text(value)))), value);
      assert.equal(stored(docOf(paragraph(schema.text(`key ${value} `), schema.text("end", [schema.marks.strong.create()])))), `key ${value} **end**`);
    }
  });

  test(named("MM-02/MM-03: every fake string survives Editor -> save -> reload -> Raw, twice"), async () => {
    const { parse, stored } = await ready;
    for (const fake of FAKES) {
      const first = stored(parse(fake));
      assert.equal(first, fake);
      assert.equal(stored(parse(first)), fake);
    }
  });

  test(named("MM-02: a value inside a list item and a quote is stored unescaped"), async () => {
    const { parse, stored } = await ready;
    for (const markdown of [`* ${REDIS}\n* ${POSTGRES}`, `> ${POSTGRES}`, `1. ${REDIS}`]) {
      assert.equal(stored(parse(markdown)), markdown);
    }
  });

  test(named("MM-02: text that needs an escape to survive still gets it"), async () => {
    const { schema, parse, write, paragraph, docOf } = await ready;
    for (const literal of ["2*3*4", "_under_", "<div>", "[ ] not a checkbox", "a\\*b", "[x]: http://fake.internal", "~gone~", "> not a quote"]) {
      const reread = parse(write(docOf(paragraph(schema.text(literal)))));
      assert.equal(reread.textContent, literal, literal);
      assert.equal(reread.firstChild?.type.name, "paragraph", literal);
    }
    const item = docOf(schema.nodes.bullet_list.create(null, schema.nodes.list_item.create(null, paragraph(schema.text("[ ] not a checkbox")))));
    const reread = parse(write(item));
    assert.equal(reread.textContent, "[ ] not a checkbox");
    assert.equal(reread.firstChild?.firstChild?.attrs.checked ?? null, null);
  });

  test(named("MM-02: the save path never eats a character the unescaped form would expose"), async () => {
    const { schema, parse, stored, paragraph, docOf } = await ready;
    // The Vault's tidy drops a lone trailing backslash and a bare `=` line; Scan Notes has no tidy
    // and has to come out the same. `* **` is a rule, not a bullet, in both.
    for (const literal of ["fake-value-ending-in-a-backslash\\", "=", "===", "fake\\"]) {
      assert.equal(parse(stored(docOf(paragraph(schema.text("before")), paragraph(schema.text(literal)), paragraph(schema.text("after"))))).textContent, `before${literal}after`, literal);
    }
    const item = docOf(schema.nodes.bullet_list.create(null, schema.nodes.list_item.create(null, paragraph(schema.text("**")))));
    assert.equal(parse(stored(item)).textContent, "**");
    const nested = stored(parse(`* outer\n\n  * ${REDIS}\n\n> * ${POSTGRES}`));
    assert.ok(nested.includes(`  * ${REDIS}`) && nested.endsWith(POSTGRES), nested);
    assert.equal(stored(parse(nested)), nested);
  });

  test(named("MM-02: a connection string is not turned into an email link"), async () => {
    const { parse } = await ready;
    for (const value of [REDIS, POSTGRES]) assert.equal(linkCount(parse(value)), 0);
    assert.equal(linkCount(parse("<someone@fake.internal>")), 1);
  });

  test(named("MM-03: a bold label hard against its value reads back as bold"), async () => {
    const { schema, parse, stored, paragraph, docOf } = await ready;
    const typed = docOf(paragraph(schema.text("URL (INTERNAL):", [schema.marks.strong.create()]), schema.text("redis://default:FAKE000@fake.internal:6379/0")));
    assert.equal(stored(typed), LABELLED);
    const reread = parse(LABELLED).firstChild as ProseNode;
    assert.equal(reread.childCount, 2);
    assert.equal(reread.child(0).text, "URL (INTERNAL):");
    assert.ok(reread.child(0).marks.some((mark) => mark.type.name === "strong"));
    assert.equal(reread.child(1).text, "redis://default:FAKE000@fake.internal:6379/0");
    assert.equal(reread.child(1).marks.length, 0);
    assert.equal(parse("a **b:**c and **d:**e").textContent, "a b:c and d:e");
    assert.equal(parse("2 ** 3 and f(**x)").textContent, "2 ** 3 and f(**x)");
  });

  test(named("MM-02: a pipe typed in a table cell stays inside its cell"), async () => {
    const { parse, stored } = await ready;
    const table = "| Service | Password |\n| ------- | -------- |\n| db      | pa\\|ss   |";
    const cells = (doc: ProseNode): string[] => {
      const found: string[] = [];
      doc.descendants((node) => { if (node.type.name === "table_cell" || node.type.name === "table_header") found.push(node.textContent); });
      return found;
    };
    assert.deepEqual(cells(parse(table)), ["Service", "Password", "db", "pa|ss"]);
    assert.deepEqual(cells(parse(stored(parse(table)))), ["Service", "Password", "db", "pa|ss"]);
  });

  test(named("MM-02: three backticks in a sentence never reach a later code block"), async () => {
    const { schema, parse, stored, paragraph, docOf } = await ready;
    const code = "curl -X POST \\\n  https://fake.internal/hook";
    const doc = docOf(paragraph(schema.text("wrap it in ``` marks")), schema.nodes.code_block.create(null, schema.text(code)));
    const back = parse(stored(doc));
    assert.equal(back.firstChild?.textContent, "wrap it in ``` marks");
    assert.equal(back.lastChild?.textContent, code);
  });

  test(named("MM-03: double asterisks that are not a label stay as typed"), async () => {
    const { parse } = await ready;
    for (const literal of ["pass f(**kwargs) through to g(**opts)", "(a)**2 + (b)**2", "use **kwargs or call f(**kwargs)", "dict(**a,**b)", "{**a, 'k':**b}", "f(**a,**b)"]) {
      assert.equal(parse(literal).textContent, literal, literal);
    }
    // Bold inside bold, as other programs write it, still nests the standard way.
    assert.equal(parse("**a (**b**) c**").textContent, "a (b) c");
    // The label shape still closes in the places a label is written, a bracket included (MM-10).
    for (const labelled of ["**Host:**fake.internal", "see **Host:**fake.internal now", "* **Host:**fake.internal", "> **Host:**fake.internal", "first line\n**Host:**fake.internal", "(**Note:**x)"]) {
      assert.ok(!parse(labelled).textContent.includes("*"), labelled);
    }
  });

  test(named("MM-01: text shown in angle brackets is copied with its brackets"), async () => {
    const { parse } = await ready;
    const line = "ssh -i <keyfile> admin@fake.internal";
    const doc = parse(line);
    assert.equal(visibleText(doc.slice(1, doc.content.size - 1)), line);
  });

  test(named("MM-01: copying gives the visible text; Copy as Markdown gives the markdown"), async () => {
    const { ctx, schema, parse, docOf } = await ready;
    for (const [markdown, shown] of [[REDIS, REDIS], [POSTGRES, POSTGRES], [LABELLED, "URL (INTERNAL):redis://default:FAKE000@fake.internal:6379/0"], [SENTENCE, "BOLD and italic and a normal sentence."]]) {
      const doc = parse(markdown);
      const whole = doc.slice(1, doc.content.size - 1);
      assert.equal(visibleText(whole), shown);
      assert.equal(sliceMarkdown(ctx, whole), markdown);
    }
    const two = parse(`first\n\n${REDIS}`);
    assert.equal(visibleText(two.slice(0, two.content.size)), `first\n\n${REDIS}`);
    assert.equal(visibleText(two.slice(two.content.size - 1 - REDIS.length, two.content.size - 1)), REDIS);

    // What the right-click hands over, from a selection as the editor holds it.
    const note = parse(`first\n\n${LABELLED}`);
    assert.equal(selectionMarkdown(ctx, EditorState.create({ doc: note })), null, "nothing selected");
    const all = EditorState.create({ doc: note, selection: TextSelection.create(note, 1, note.content.size - 1) });
    assert.equal(selectionMarkdown(ctx, all), `first\n\n${LABELLED}`);
    // Inside a code block the text is handed over as it stands, with no fence and no escapes.
    const code = "echo **KEY:**value";
    const block = docOf(schema.nodes.code_block.create(null, schema.text(code)));
    const inCode = EditorState.create({ doc: block, selection: TextSelection.create(block, 1, 1 + code.length) });
    assert.equal(selectionMarkdown(ctx, inCode), code);
  });
}

test("each editor judges an escape by what its own save path keeps", async () => {
  const v = await vault;
  const s = await scanNotes;
  const lineStarts = ["# not a heading", "1. not a list", "- not a list"];
  // The Vault's save path removes an escape at the start of a line, so its editor does not write
  // one: the text the editor holds is the text the store keeps.
  for (const literal of lineStarts) {
    assert.equal(v.write(v.docOf(v.paragraph(v.schema.text(literal)))).trim(), literal, literal);
  }
  // Scan Notes stores the text as written. Without the escape the line would come back as a
  // heading, a list or a rule.
  for (const literal of [...lineStarts, "+ not a list", "---"]) {
    const typed = s.docOf(s.paragraph(s.schema.text("before")), s.paragraph(s.schema.text(literal)), s.paragraph(s.schema.text("after")));
    const reread = s.parse(s.stored(typed));
    assert.equal(reread.childCount, 3, literal);
    assert.equal(reread.child(1).type.name, "paragraph", literal);
    assert.equal(reread.child(1).textContent, literal, literal);
  }
});

test("Vault: tidy never alters a run of non-space text in the fake strings", () => {
  for (const fake of FAKES) {
    for (const text of [fake, `${fake}\n\n${fake}`, `- ${fake}\n- ${fake}`, `label\n${fake}\\\nnext`, `    ${fake}`]) {
      const tidied = runsOf(vaultTidy(text));
      for (const run of runsOf(fake)) assert.ok(tidied.includes(run), `${run} in ${JSON.stringify(text)}`);
    }
  }
});

// Pictures: the Vault only. Scan Notes has no picture store, so its editor has no picture path.

test("Vault: a pasted picture reference is still read as markdown, a pasted value is not", () => {
  for (const value of [REDIS, POSTGRES, "abc*def*ghi", "back\\$slash"]) assert.ok(isSingleValue(value), value);
  assert.ok(!isSingleValue("![shot](vault://00000000-0000-4000-8000-000000000000)"));
});

test("Vault: a pasted picture lands at the caret", async () => {
  const { schema, parse, write, paragraph, docOf } = await vault;
  const image = schema.nodes.image.create({ src: "vault-pending:test", alt: "shot.png" });
  const at = (doc: ProseNode, pos: number): string => {
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, pos) });
    return write(state.apply(placeImage(state, image)).doc).trim();
  };
  const shot = "![shot.png](vault-pending:test)";
  assert.equal(at(parse("one two\n\nthree"), 5), `one ${shot}two\n\nthree`, "mid-line");
  const broken = docOf(paragraph(schema.text("one"), schema.nodes.hardbreak.create(), schema.text("two")));
  assert.equal(at(broken, 5), `one\\\n${shot}two`, "after Shift+Enter");
  assert.equal(at(docOf(paragraph(schema.text("one")), paragraph(), paragraph(schema.text("two"))), 6), `one\n\n${shot}\n\ntwo`, "on a new line");
  assert.equal(at(parse("one\n\ntwo"), 1), `${shot}one\n\ntwo`, "at the top");
  assert.equal(at(parse("# Title\n\nbody"), 1), `${shot}\n\n# Title\n\nbody`, "at the start of a heading");
  assert.equal(at(parse("# Title\n\nbody"), 4), `# Title\n\n${shot}\n\nbody`, "inside a heading");
});

test("Vault: a dropped picture lands at the drop point, wherever the caret is", async () => {
  const { schema, parse, write } = await vault;
  const image = schema.nodes.image.create({ src: "vault-pending:test", alt: "shot.png" });
  const doc = parse("one two\n\nthree four");
  const state = EditorState.create({ doc, selection: TextSelection.create(doc, 1) });
  assert.equal(write(state.apply(placeImage(state, image, 16)).doc).trim(), "one two\n\nthree ![shot.png](vault-pending:test)four");
});

test("Vault: a finished save swaps the pending picture; a refused one removes it", async () => {
  const { parse, write } = await vault;
  const doc = parse("a ![one.png](vault-pending:1) b ![two.png](vault-pending:2) c ![three.png](vault-pending:3)");
  const state = EditorState.create({ doc });
  const tr = settlePendingImages(state, new Map([["vault-pending:1", null], ["vault-pending:2", "vault://00000000-0000-4000-8000-000000000000"]]));
  assert.ok(tr);
  assert.equal(write(state.apply(tr).doc).trim(), "a  b ![two.png](vault://00000000-0000-4000-8000-000000000000) c ![three.png](vault-pending:3)");
  assert.equal(settlePendingImages(state, new Map()), null);
});
