/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
/* File: tests/editor.test.ts */
// Runs the MindMerge editor's real parser and serializer without a window. Run with `npm test`.
// Every string here is fake on purpose: the notes hold production credentials and none may be
// copied into a test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Editor, parserCtx, schemaCtx, serializerCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import type { Node as ProseNode, Schema } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
import { faithfulMarkdown, faithfulMarkdownConfig, isSingleValue, placeImage, settlePendingImages, sliceMarkdown, visibleText } from "../src/modules/mindmerge/editorLogic";
import { preprocess } from "../src/modules/mindmerge/markdown";
import { tidyMarkdown } from "../src/modules/mindmerge/tidyMarkdown";

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

async function build() {
  const editor = Editor.make().config(faithfulMarkdownConfig).use(commonmark).use(gfm).use(faithfulMarkdown);
  await editor.create().catch(() => undefined);
  const ctx = editor.ctx;
  const schema: Schema = ctx.get(schemaCtx);
  const parse = (markdown: string): ProseNode => ctx.get(parserCtx)(markdown);
  const write = (doc: ProseNode): string => ctx.get(serializerCtx)(doc);
  /** What the store keeps: the editor's markdown after the save path's tidy. */
  const stored = (doc: ProseNode): string => tidyMarkdown(write(doc)).trim();
  const paragraph = (...content: ProseNode[]): ProseNode => schema.nodes.paragraph.create(null, content);
  const docOf = (...blocks: ProseNode[]): ProseNode => schema.topNodeType.create(null, blocks);
  return { ctx, schema, parse, write, stored, paragraph, docOf };
}
const ready = build();

const runsOf = (text: string): string[] => text.split(/\s+/).filter(Boolean);
const linkCount = (doc: ProseNode): number => {
  let links = 0;
  doc.descendants((node) => { if (node.marks.some((mark) => mark.type.name === "link")) links += 1; });
  return links;
};

test("MM-02: a typed value is stored as one unbroken string", async () => {
  const { schema, stored, paragraph, docOf } = await ready;
  for (const value of [REDIS, POSTGRES]) {
    assert.equal(stored(docOf(paragraph(schema.text(value)))), value);
    assert.equal(stored(docOf(paragraph(schema.text(`key ${value} `), schema.text("end", [schema.marks.strong.create()])))), `key ${value} **end**`);
  }
});

test("MM-02/MM-03: every fake string survives Editor -> save -> reload -> Raw, twice", async () => {
  const { parse, stored } = await ready;
  for (const fake of FAKES) {
    const first = stored(parse(fake));
    assert.equal(first, fake);
    assert.equal(stored(parse(first)), fake);
  }
});

test("MM-02: a value inside a list item and a quote is stored unescaped", async () => {
  const { parse, stored } = await ready;
  for (const markdown of [`* ${REDIS}\n* ${POSTGRES}`, `> ${POSTGRES}`, `1. ${REDIS}`]) {
    assert.equal(stored(parse(markdown)), markdown);
  }
});

test("MM-02: text that needs an escape to survive still gets it", async () => {
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

test("MM-02: the save path never eats a character the unescaped form would expose", async () => {
  const { schema, parse, stored, paragraph, docOf } = await ready;
  // Tidy drops a lone trailing backslash and a bare `=` line, and `* **` is a rule, not a bullet.
  for (const literal of ["fake-value-ending-in-a-backslash\\", "=", "===", "fake\\"]) {
    assert.equal(parse(stored(docOf(paragraph(schema.text("before")), paragraph(schema.text(literal)), paragraph(schema.text("after"))))).textContent, `before${literal}after`, literal);
  }
  const item = docOf(schema.nodes.bullet_list.create(null, schema.nodes.list_item.create(null, paragraph(schema.text("**")))));
  assert.equal(parse(stored(item)).textContent, "**");
  const nested = stored(parse(`* outer\n\n  * ${REDIS}\n\n> * ${POSTGRES}`));
  assert.ok(nested.includes(`  * ${REDIS}`) && nested.endsWith(POSTGRES), nested);
  assert.equal(stored(parse(nested)), nested);
});

test("MM-02: a connection string is not turned into an email link", async () => {
  const { parse } = await ready;
  for (const value of [REDIS, POSTGRES]) assert.equal(linkCount(parse(value)), 0);
  assert.equal(linkCount(parse("<someone@fake.internal>")), 1);
});

test("MM-03: a bold label hard against its value reads back as bold", async () => {
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

test("MM-03: the preview pane reads a bold label the way the editor does", () => {
  assert.equal(preprocess(LABELLED).trim(), "**URL (INTERNAL)**:redis://default:FAKE000@fake.internal:6379/0");
  // MM-10: after a bracket or a quote only a label is bold, exactly as in the editor.
  assert.equal(preprocess("(**Note:**x)").trim(), "(**Note**:x)");
  assert.equal(preprocess('"**Note:**x"').trim(), '"**Note**:x"');
  assert.equal(preprocess("f(**Note:**x)").trim(), "f(**Note**:x)");
  for (const code of ["f(**a,**b)", "g(**opts)", "use **kwargs", "x(**1:**2)", "call(**a=1:**b)", "`(**Note:**x)`"]) {
    assert.equal(preprocess(code).trim(), code);
  }
  for (const untouched of [SENTENCE, REDIS, "**A**: text.**B** end", "2 ** 3 and f(**x)", `\`\`\`\n${LABELLED}\n\`\`\``, "`rm **/build/**tmp` and `echo **KEY:**value`", "**see [docs](https://fake.internal)**now", "**run `npm test`**now", "**a ~~b~~**c", "~~~\necho **WARNING:**disk\n- [ ] not a task\n~~~"]) {
    assert.equal(preprocess(untouched).trim(), untouched);
  }
});

test("MM-02: a pipe typed in a table cell stays inside its cell", async () => {
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

test("MM-02: three backticks in a sentence never reach a later code block", async () => {
  const { schema, parse, stored, paragraph, docOf } = await ready;
  // Tidy protects code by pairing fences across the whole note, so a stray run of three in prose
  // would pair with the next block's opening fence and expose its contents.
  const code = "curl -X POST \\\n  https://fake.internal/hook";
  const doc = docOf(paragraph(schema.text("wrap it in ``` marks")), schema.nodes.code_block.create(null, schema.text(code)));
  const back = parse(stored(doc));
  assert.equal(back.firstChild?.textContent, "wrap it in ``` marks");
  assert.equal(back.lastChild?.textContent, code);
});

test("MM-03: double asterisks that are not a label stay as typed", async () => {
  const { parse } = await ready;
  for (const literal of ["pass f(**kwargs) through to g(**opts)", "(a)**2 + (b)**2", "use **kwargs or call f(**kwargs)", "dict(**a,**b)", "{**a, 'k':**b}"]) {
    assert.equal(parse(literal).textContent, literal, literal);
  }
  // Bold inside bold, as other programs write it, still nests the standard way.
  assert.equal(parse("**a (**b**) c**").textContent, "a (b) c");
  // The label shape still closes in the places a label is written.
  for (const labelled of ["**Host:**fake.internal", "see **Host:**fake.internal now", "* **Host:**fake.internal", "> **Host:**fake.internal", "first line\n**Host:**fake.internal"]) {
    assert.ok(!parse(labelled).textContent.includes("*"), labelled);
  }
});

test("MM-10: a bold label after a bracket or a quote reads as bold; code after a bracket stays as typed", async () => {
  const { schema, parse, stored, paragraph, docOf } = await ready;
  const boldOf = (doc: ProseNode): string => {
    let bold = "";
    doc.descendants((node) => {
      if (node.isText && node.marks.some((mark) => mark.type.name === "strong")) bold += node.text ?? "";
    });
    return bold;
  };
  const labelled: Array<[string, string, string]> = [
    ["(**Note:**x)", "(Note:x)", "Note:"],
    ['"**Note:**x"', '"Note:x"', "Note:"],
    ["see (**Host name:**fake.internal) now", "see (Host name:fake.internal) now", "Host name:"],
    ["[**Port:**6379]", "[Port:6379]", "Port:"],
    ["f(**Note:**x)", "f(Note:x)", "Note:"],
  ];
  for (const [typed, shown, bold] of labelled) {
    const doc = parse(typed);
    assert.equal(doc.textContent, shown, typed);
    assert.equal(boldOf(doc), bold, typed);
  }
  for (const literal of ["f(**a,**b)", "g(**opts)", "use **kwargs", "call(**a=1:**b)", "x(**1:**2)", "(**a(b):**c)", "pass (**kw) and (**x:y)"]) {
    const doc = parse(literal);
    assert.equal(doc.textContent, literal, literal);
    assert.equal(boldOf(doc), "", literal);
  }
  // What the editor writes for that bold is what it reads back.
  const typed = docOf(paragraph(schema.text("("), schema.text("Note:", [schema.marks.strong.create()]), schema.text("x)")));
  assert.equal(stored(typed), "(**Note:**x)");
  assert.equal(stored(parse(stored(typed))), "(**Note:**x)");
});

test("MM-01: text shown in angle brackets is copied with its brackets", async () => {
  const { parse } = await ready;
  const line = "ssh -i <keyfile> admin@fake.internal";
  const doc = parse(line);
  assert.equal(visibleText(doc.slice(1, doc.content.size - 1)), line);
});

test("MM-01: copying gives the visible text; Copy as Markdown gives the markdown", async () => {
  const { ctx, parse } = await ready;
  for (const [markdown, shown] of [[REDIS, REDIS], [POSTGRES, POSTGRES], [LABELLED, "URL (INTERNAL):redis://default:FAKE000@fake.internal:6379/0"], [SENTENCE, "BOLD and italic and a normal sentence."]]) {
    const doc = parse(markdown);
    const whole = doc.slice(1, doc.content.size - 1);
    assert.equal(visibleText(whole), shown);
    assert.equal(sliceMarkdown(ctx, whole), markdown);
  }
  const two = parse(`first\n\n${REDIS}`);
  assert.equal(visibleText(two.slice(0, two.content.size)), `first\n\n${REDIS}`);
  assert.equal(visibleText(two.slice(two.content.size - 1 - REDIS.length, two.content.size - 1)), REDIS);
});

test("MM-02: a pasted value with no spaces is taken literally", () => {
  for (const value of [REDIS, POSTGRES, "abc*def*ghi", "back\\$slash", " padded-token\n"]) assert.ok(isSingleValue(value), value);
  for (const text of ["two words", "[docs](https://fake.internal)", "![shot](mindmerge://x)", "line\nline", "  "]) assert.ok(!isSingleValue(text), text);
});

test("MM-04: a pasted picture lands at the caret", async () => {
  const { schema, parse, write, paragraph, docOf } = await ready;
  const image = schema.nodes.image.create({ src: "mindmerge-pending:test", alt: "shot.png" });
  const at = (doc: ProseNode, pos: number): string => {
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, pos) });
    return write(state.apply(placeImage(state, image)).doc).trim();
  };
  const shot = "![shot.png](mindmerge-pending:test)";
  assert.equal(at(parse("one two\n\nthree"), 5), `one ${shot}two\n\nthree`, "mid-line");
  const broken = docOf(paragraph(schema.text("one"), schema.nodes.hardbreak.create(), schema.text("two")));
  assert.equal(at(broken, 5), `one\\\n${shot}two`, "after Shift+Enter");
  assert.equal(at(docOf(paragraph(schema.text("one")), paragraph(), paragraph(schema.text("two"))), 6), `one\n\n${shot}\n\ntwo`, "on a new line");
  assert.equal(at(parse("one\n\ntwo"), 1), `${shot}one\n\ntwo`, "at the top");
  assert.equal(at(parse("# Title\n\nbody"), 1), `${shot}\n\n# Title\n\nbody`, "at the start of a heading");
  assert.equal(at(parse("# Title\n\nbody"), 4), `# Title\n\n${shot}\n\nbody`, "inside a heading");
});

test("MM-05: a dropped picture lands at the drop point, wherever the caret is", async () => {
  const { schema, parse, write } = await ready;
  const image = schema.nodes.image.create({ src: "mindmerge-pending:test", alt: "shot.png" });
  const doc = parse("one two\n\nthree four");
  const state = EditorState.create({ doc, selection: TextSelection.create(doc, 1) });
  assert.equal(write(state.apply(placeImage(state, image, 16)).doc).trim(), "one two\n\nthree ![shot.png](mindmerge-pending:test)four");
});

test("MM-04: a finished save swaps the pending picture; a refused one removes it", async () => {
  const { parse, write } = await ready;
  const doc = parse("a ![one.png](mindmerge-pending:1) b ![two.png](mindmerge-pending:2) c ![three.png](mindmerge-pending:3)");
  const state = EditorState.create({ doc });
  const tr = settlePendingImages(state, new Map([["mindmerge-pending:1", null], ["mindmerge-pending:2", "mindmerge://00000000-0000-4000-8000-000000000000"]]));
  assert.ok(tr);
  assert.equal(write(state.apply(tr).doc).trim(), "a  b ![two.png](mindmerge://00000000-0000-4000-8000-000000000000) c ![three.png](mindmerge-pending:3)");
  assert.equal(settlePendingImages(state, new Map()), null);
});

test("Tidy never alters a run of non-space text in the fake strings", () => {
  for (const fake of FAKES) {
    for (const text of [fake, `${fake}\n\n${fake}`, `- ${fake}\n- ${fake}`, `label\n${fake}\\\nnext`, `    ${fake}`]) {
      const tidied = runsOf(tidyMarkdown(text));
      for (const run of runsOf(fake)) assert.ok(tidied.includes(run), `${run} in ${JSON.stringify(text)}`);
    }
  }
});
