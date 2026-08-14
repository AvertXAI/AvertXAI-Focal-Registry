/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// The Milkdown editor — WYSIWYG markdown you type directly into (Jason ruled 08-11-2026, and
// re-confirmed it on 08-11 when Markdoc came up: Markdoc RENDERS, Milkdown is what you TYPE INTO).
//
// WHY THE IMPORTS LOOK LIKE THIS. Only `@milkdown/kit/core`, the two presets, `/plugin/listener`,
// `/plugin/history` and `/utils` are pulled in — deliberately NOT `@milkdown/react` or
// `@milkdown/crepe`, both of which depend on `@milkdown/components`, which depends on VUE. Milkdown's
// core is framework-agnostic ProseMirror, so the React binding buys nothing but weight.
//
// GFM IS ON (08-11-2026) and it is not a nicety: the toolbar has a CHECKLIST button, and task lists
// are GFM, not CommonMark. Without the preset the button had nothing to call. It also brings tables
// and strikethrough, both of which the Markdoc preview already renders — verified, not assumed.
//
// THE IMPERATIVE HANDLE IS THE BUG FIX. Every toolbar button used to call setDraft(), mutating a
// STRING that shadowed the editor's real document. So a click appeared in the right-hand pane and
// never in the editor, and could not be undone — Jason, 08-11-2026: "i clicked on the checkbox,
// bold, </> etc and it added it on the 'preview' side but not in the editor, so once i clicked on
// it, i couldnt remove it." The buttons now drive the DOCUMENT through Milkdown's own commands, so
// there is one source of truth, the change lands where the cursor is, and Ctrl+Z undoes it.
//
// STYLING IS INHERITED, NOT IMPORTED. The presets emit plain semantic HTML — h1, p, ul, code, pre —
// which vault.css already styles for the preview pane. The editor reuses those rules rather than
// shipping a second stylesheet that would drift from the theme tokens.
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Editor, defaultValueCtx, editorViewCtx, editorViewOptionsCtx, parserCtx, rootCtx, schemaCtx, serializerCtx } from "@milkdown/kit/core";
import { exitCode } from "@milkdown/kit/prose/commands";
import { Slice } from "@milkdown/kit/prose/model";
import {
  commonmark,
  createCodeBlockCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
} from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { history } from "@milkdown/kit/plugin/history";
import { callCommand, insert } from "@milkdown/kit/utils";
import type { Ctx } from "@milkdown/kit/ctx";
import "@milkdown/kit/prose/view/style/prosemirror.css";

/** Everything the toolbar can ask for. A closed union so a typo is a compile error, not a dead button. */
export type EditorAction =
  | "bold"
  | "italic"
  | "heading"
  | "code"
  | "codeblock"
  | "task"
  | "bullet"
  | { insert: string };

export interface MilkdownHandle {
  /** Runs the action against the live document at the cursor. No-op if the editor is not ready. */
  run: (action: EditorAction) => void;
  /** Puts the caret back after a toolbar click, so typing continues where it left off. */
  focus: () => void;
}

export interface MilkdownEditorProps {
  /** Identity of the open document. A CHANGE HERE REBUILDS THE EDITOR — see the effect below. */
  docId: string;
  initial: string;
  onChange: (markdown: string) => void;
  readOnly?: boolean;
}

/**
 * Turn the current block into a task list item, or back again.
 *
 * Written as a raw transaction rather than composed from macros because GFM ships a task-list INPUT
 * RULE and no command — input rules only fire on real typing, so a button has nothing to call. The
 * `checked` attribute is what makes a list_item a task item (null = an ordinary bullet), which is
 * the same attribute the GFM serializer reads when writing "- [ ] " back out.
 */
function toggleTask(ctx: Ctx): void {
  const view = ctx.get(editorViewCtx);
  const { state, dispatch } = view;
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "list_item") {
      dispatch(
        state.tr.setNodeMarkup($from.before(d), undefined, {
          ...node.attrs,
          checked: node.attrs.checked == null ? false : null,
        })
      );
      return;
    }
  }
}

const MilkdownEditor = forwardRef<MilkdownHandle, MilkdownEditorProps>(function MilkdownEditor(
  { docId, initial, onChange, readOnly = false },
  ref
) {
  const host = useRef<HTMLDivElement | null>(null);
  const editor = useRef<Editor | null>(null);
  // The callback lives in a ref so the editor is NOT rebuilt every time the parent re-renders —
  // rebuilding on each keystroke would drop the cursor, which is the classic way this integration
  // goes wrong.
  const cb = useRef(onChange);
  cb.current = onChange;

  useImperativeHandle(
    ref,
    (): MilkdownHandle => ({
      focus: () => {
        try {
          editor.current?.action((ctx) => ctx.get(editorViewCtx).focus());
        } catch {
          /* an editor mid-teardown must not throw out of a toolbar click */
        }
      },
      run: (action) => {
        const ed = editor.current;
        if (!ed || readOnly) return;
        try {
          if (typeof action === "object") {
            // Markdown text — the vault chip. `true` = inline, so it lands in the current paragraph
            // rather than opening a block of its own.
            ed.action(insert(action.insert, true));
          } else if (action === "task") {
            // Not in a list yet? Make one first, then tick it — two steps because "checklist" is a
            // list item WITH an attribute, and you cannot set the attribute on a paragraph.
            ed.action((ctx) => {
              const inList = (() => {
                const { $from } = ctx.get(editorViewCtx).state.selection;
                for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === "list_item") return true;
                return false;
              })();
              if (!inList) callCommand(wrapInBulletListCommand.key)(ctx);
              toggleTask(ctx);
            });
          } else {
            const key = {
              bold: toggleStrongCommand.key,
              italic: toggleEmphasisCommand.key,
              code: toggleInlineCodeCommand.key,
              bullet: wrapInBulletListCommand.key,
            }[action as "bold" | "italic" | "code" | "bullet"];
            if (key) ed.action(callCommand(key));
            else if (action === "heading") ed.action(callCommand(wrapInHeadingCommand.key, 2));
            else if (action === "codeblock") ed.action(callCommand(createCodeBlockCommand.key, "bash"));
          }
          ed.action((ctx) => ctx.get(editorViewCtx).focus());
        } catch {
          /* a failed command must not take the notes screen down */
        }
      },
    }),
    [readOnly]
  );

  useEffect(() => {
    if (!host.current) return;
    let dead = false;

    void Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, host.current as HTMLElement);
        ctx.set(defaultValueCtx, initial);
        ctx.update(editorViewOptionsCtx, (prev) => ({
          ...prev,
          editable: () => !readOnly,

          /**
           * COPY GIVES YOU MARKDOWN (Jason 08-12-2026: "i assumed everything was in md coding, and
           * it wasnt copied that way. it was all plain text").
           *
           * It was not plain text by choice. ProseMirror's default text serializer is
           * `textBetween()` — it walks the document collecting characters and knows nothing about
           * the marks around them, so every heading, bullet, fence and bold run arrived stripped.
           * In a WYSIWYG that is the wrong default by definition: the markdown IS the document, and
           * an editor that will not hand it back is a one-way door.
           *
           * Milkdown already owns the serializer that writes the file — the same one autosave uses —
           * so the clipboard now goes through it instead of a second, worse one.
           */
          clipboardTextSerializer: (slice) => {
            const plain = (): string => slice.content.textBetween(0, slice.content.size, "\n\n");
            try {
              const schema = ctx.get(schemaCtx);
              const serialize = ctx.get(serializerCtx);
              // A selection inside one paragraph is INLINE content, which a doc node cannot hold.
              // Wrap it in a paragraph first; a block selection needs no wrapping.
              let doc;
              try {
                doc = schema.topNodeType.create(null, slice.content);
              } catch {
                doc = schema.topNodeType.create(null, schema.nodes.paragraph.create(null, slice.content));
              }
              return serialize(doc).trim() || plain();
            } catch {
              return plain(); // a serializer that throws must never cost the user their copy
            }
          },

          /**
           * SHIFT+ENTER, EVERY TIME (Jason 08-12-2026: "hitting shift + enter is buggy, sometimes it
           * works sometimes it doesnt").
           *
           * Both halves of "sometimes" are explained by where the caret was. Milkdown binds the key
           * to an insert-hardbreak command, and that command correctly returns FALSE wherever a
           * hard break is not valid content — a heading, a table cell, a code block. Returning false
           * means "not handled", and nothing was behind it to handle it, so the key did nothing at
           * all and looked broken at random.
           *
           * This sits in the view's base props, which ProseMirror consults only AFTER every plugin
           * keymap has declined. So Milkdown still wins wherever it works, and this is purely the
           * floor underneath it — no plugin-ordering fight, no duplicated binding.
           */
          /**
           * A PASTED MARKDOWN DOCUMENT ARRIVES AS MARKDOWN (Jason 08-13-2026, pasting a 551-line
           * design document: "it got the spacing wrong… i have to re-edit it in the editor after i
           * already went through it once").
           *
           * WHAT WAS ACTUALLY HAPPENING, from diffing his source against the row the vault stored:
           *   · every run of spaces in his ASCII diagrams came back as U+00A0 NON-BREAKING SPACE
           *   · `## 1. Unified Peer Agent Architecture` was stored as **bold text**, not a heading
           *   · `**bold**` was stored as `**\*\*bold\*\***` — the marks applied AND the literal
           *     asterisks kept, then escaped on the way back out
           *   · `---` became `\---`
           *   · 551 lines became 1,089
           *
           * Every one of those is the signature of an HTML paste. A clipboard carries several
           * flavours at once, and whatever he copied from offered `text/html`; ProseMirror prefers
           * it, parsed it as HTML — which is where the non-breaking spaces and the bold-instead-of-
           * heading come from — and the markdown serializer then dutifully escaped the literal
           * asterisks that had survived as plain characters. Double-encoded, and unreadable.
           *
           * THIS IS NOT A MILKDOWN FAULT AND TIPTAP WOULD DO THE SAME. Both are ProseMirror, and
           * this is ProseMirror's generic paste path doing exactly what it is documented to do. What
           * was missing is a markdown editor saying "in here, the plain-text flavour IS the richer
           * one" — which is this handler, and it is fifteen lines rather than an editor migration.
           *
           * INSIDE A FENCE IT STANDS ASIDE: there, a paste is literal text, and parsing it as
           * markdown would eat the very characters you are trying to store.
           */
          handlePaste: (view, event) => {
            if (readOnly) return false;
            const text = event.clipboardData?.getData("text/plain");
            if (!text || text.trim() === "") return false;
            const { state } = view;
            if (state.selection.$from.parent.type.spec.code) return false;
            try {
              const doc = ctx.get(parserCtx)(text);
              if (!doc || doc.content.size === 0) return false;
              const frag = doc.content;
              // A single paragraph pastes INLINE — open on both sides — so dropping a sentence into
              // the middle of a line does not split it into three blocks. Anything richer keeps its
              // own block structure.
              const inline = frag.childCount === 1 && frag.firstChild?.type.name === "paragraph";
              view.dispatch(state.tr.replaceSelection(new Slice(frag, inline ? 1 : 0, inline ? 1 : 0)).scrollIntoView());
              return true;
            } catch {
              return false; // a document the parser chokes on still pastes the ordinary way
            }
          },

          handleKeyDown: (view, event) => {
            if (event.key !== "Enter" || !event.shiftKey || readOnly) return false;
            const { state, dispatch } = view;
            const { $from } = state.selection;
            // In a fence, plain Enter already gives you a new line — so Shift+Enter means the other
            // thing you want there, which is to get OUT of the block. That is ProseMirror's own
            // convention and exitCode is its own command for it.
            if ($from.parent.type.spec.code) return exitCode(state, dispatch);
            const br = state.schema.nodes.hard_break ?? state.schema.nodes.hardbreak;
            if (!br) return false;
            // Ask before inserting. This is the check the failing cases were missing: if a hard
            // break cannot live here, say so honestly rather than dispatching a transaction that
            // quietly drops it.
            if (!$from.parent.canReplaceWith($from.index(), $from.index(), br)) return false;
            dispatch(state.tr.replaceSelectionWith(br.create()).scrollIntoView());
            return true;
          },
        }));
        ctx.get(listenerCtx).markdownUpdated((_c, md) => cb.current(md));
      })
      .use(commonmark)
      .use(gfm)
      .use(listener)
      .use(history)
      .create()
      .then((made) => {
        // The component can unmount while create() is still in flight; not destroying then leaks a
        // detached ProseMirror view into the DOM.
        if (dead) { void made.destroy(); return; }
        editor.current = made;
      })
      .catch(() => undefined); // a failed editor must not take the notes screen down with it

    return () => {
      dead = true;
      void editor.current?.destroy();
      editor.current = null;
    };
    // `initial` is deliberately NOT a dependency: it is the seed, and re-seeding on every change
    // would fight the user's typing. Switching documents changes docId, which rebuilds properly.
  }, [docId, readOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div className="vault-milkdown" ref={host} />;
});

export default MilkdownEditor;
