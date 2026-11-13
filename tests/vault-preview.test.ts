/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
/* File: tests/vault-preview.test.ts */
// Goes with optional/preview-parity.patch and fails without it: the Vault's preview pane reads a
// bold label the way its editor does. Run with `npm test`. Every string here is fake on purpose.
import assert from "node:assert/strict";
import { test } from "node:test";
import { preprocess } from "../src/modules/vault/markdown";

const LABELLED = "**URL (INTERNAL):**redis://default:FAKE000@fake.internal:6379/0";

test("Vault: the preview pane reads a bold label the way the editor does", () => {
  assert.equal(preprocess(LABELLED).trim(), "**URL (INTERNAL)**:redis://default:FAKE000@fake.internal:6379/0");
  assert.equal(preprocess("(**Note:**x)").trim(), "(**Note**:x)");
  for (const untouched of ["f(**a,**b)", "2 ** 3 and f(**x)", `\`\`\`\n${LABELLED}\n\`\`\``]) {
    assert.equal(preprocess(untouched).trim(), untouched);
  }
});

test("Vault: the preview still turns a credential chip and a task into their tags", () => {
  assert.equal(preprocess("see @[[vault:Fake Key]] now"), 'see {% vault label="Fake Key" /%} now');
  assert.equal(preprocess("- [x] done"), "- {% task checked=true %}done{% /task %}");
  // Inside a code fence both stay as typed.
  const fenced = "```\n@[[vault:Fake Key]]\n- [ ] not a task\n```";
  assert.equal(preprocess(fenced), fenced);
});
