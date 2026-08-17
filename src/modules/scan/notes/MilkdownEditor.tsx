/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// The Milkdown editor for Scan Notes — a COPY of src/modules/vault/MilkdownEditor.tsx with the
// encryption removed. Milkdown RENDERS what you TYPE INTO; Markdoc (./markdown.tsx) renders the
// read-only side. Two engines, one document.
//
// WHY THE IMPORTS LOOK LIKE THIS (carried over verbatim, and still true): only `@milkdown/kit/core`,
// the two presets, `/plugin/listener`, `/plugin/history` and `/utils` are pulled in — deliberately
// NOT `@milkdown/react` or `@milkdown/crepe`, both of which depend on `@milkdown/components`, which
// depends on VUE. Milkdown's core is framework-agnostic ProseMirror; the React binding buys nothing
// but weight. No new dependency enters the tree for this file — every import is already installed
// for the Vault lane.
//
// WHAT WAS STRIPPED, and why each is an encryption seam:
//   · the pasted-image → vault attachment store path. Attachments are SQLCipher rows behind a
//     derived key; Scan Notes has no such store. A pasted image now falls through to ProseMirror's
//     ordinary handling. ponytail: skipped an attachment path entirely — add one only if a
//     photographer actually asks to paste screenshots into a folder note, and give it a real home
//     on disk rather than base64 in the shared database.
//   · the vault:// DOM resolver and its MutationObserver sweep — nothing to resolve.
//   · vaultApi().logClient — the vault event log is behind the lock. Failures go to the console and,
//     where the caller can reach it, the Scan Notes feed.
//
// EVERY SWALLOWED FAILURE STILL LEAVES A TRAIL. The catches below are deliberate — a bad paste must
// never take the notes screen down — but silent-AND-unrecorded is how the original's bugs stayed
// invisible for three screenshots. Message and stack only, NEVER note content.
//
// STYLING IS INHERITED, NOT IMPORTED. The presets emit plain semantic HTML — h1, p, ul, code, pre —
// which scannotes.css styles for the preview pane. The editor reuses those rules rather than
// shipping a second stylesheet that would drift from the theme tokens.
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Editor, defaultValueCtx, editorViewCtx, editorViewOptionsCtx, parserCtx, rootCtx, schemaCtx, serializerCtx } from "@milkdown/kit/core";
import { exitCode } from "@milkdown/kit/prose/commands";
import { Slice } from "@milkdown/kit/prose/model";
import { TextSelection } from "@milkdown/kit/prose/state";
import {
  commonmark,
  createCodeBlockCommand,
  insertHrCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from "@milkdown/kit/preset/commonmark";
import { gfm, insertTableCommand, toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { history, redoCommand, undoCommand } from "@milkdown/kit/plugin/history";
import { callCommand, insert } from "@milkdown/kit/utils";
import type { Ctx } from "@milkdown/kit/ctx";
import "@milkdown/kit/prose/view/style/prosemirror.css";

function tell(level: "warn" | "error", message: string, err?: unknown): void {
  if (level === "error") console.error(`[scan-notes:renderer] ${message}`, err ?? "");
  else console.warn(`[scan-notes:renderer] ${message}`, err ?? "");
}

/** Everything the toolbar can ask for. A closed union so a typo is a compile error, not a dead
 *  button. */
export type EditorAction =
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "codeblock"
  | "task"
  | "bullet"
  | "ordered"
  | "quote"
  | "hr"
  | "table"
  | "link"
  | "paragraph"
  | "undo"
  | "redo"
  | { heading: 1 | 2 | 3 }
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
            // `true` = inline, so it lands in the current paragraph rather than opening a block.
            if ("insert" in action) ed.action(insert(action.insert, true));
            else ed.action(callCommand(wrapInHeadingCommand.key, action.heading));
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
          } else if (action === "link") {
            // A placeholder href — there is no link-edit bubble yet.
            // ponytail: a link tooltip UI is the upgrade if this grates.
            ed.action(callCommand(toggleLinkCommand.key, { href: "https://" }));
          } else if (action === "table") {
            ed.action(callCommand(insertTableCommand.key, { row: 3, col: 3 }));
          } else if (action === "codeblock") {
            ed.action(callCommand(createCodeBlockCommand.key, "text"));
          } else {
            const key = {
              bold: toggleStrongCommand.key,
              italic: toggleEmphasisCommand.key,
              strike: toggleStrikethroughCommand.key,
              code: toggleInlineCodeCommand.key,
              bullet: wrapInBulletListCommand.key,
              ordered: wrapInOrderedListCommand.key,
              quote: wrapInBlockquoteCommand.key,
              hr: insertHrCommand.key,
              paragraph: turnIntoTextCommand.key,
              undo: undoCommand.key,
              redo: redoCommand.key,
            }[action];
            if (key) ed.action(callCommand(key));
          }
          ed.action((ctx) => ctx.get(editorViewCtx).focus());
        } catch (err) {
          /* a failed command must not take the notes screen down — but it must be on record */
          tell("warn", `Editor: the "${typeof action === "string" ? action : "insert" in action ? "insert" : "heading"}" toolbar command failed`, err);
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
           * COPY GIVES YOU MARKDOWN. ProseMirror's default text serializer is `textBetween()` — it
           * walks the document collecting characters and knows nothing about the marks around them,
           * so every heading, bullet, fence and bold run arrives stripped. In a WYSIWYG that is the
           * wrong default by definition: the markdown IS the document, and an editor that will not
           * hand it back is a one-way door. Milkdown already owns the serializer that writes the
           * file — the same one autosave uses — so the clipboard goes through it.
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
            } catch (err) {
              tell("warn", "Editor: copying as markdown failed — the copy fell back to plain text", err);
              return plain(); // a serializer that throws must never cost the user their copy
            }
          },

          /**
           * A PASTED MARKDOWN DOCUMENT ARRIVES AS MARKDOWN. A clipboard carries several flavours at
           * once; whatever most sources offer includes `text/html`, and ProseMirror prefers it —
           * which is where non-breaking spaces, bold-instead-of-heading, and doubly-escaped
           * asterisks come from. What is missing generically is a markdown editor saying "in here,
           * the plain-text flavour IS the richer one". That is this handler.
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

          /**
           * SHIFT+ENTER, EVERY TIME. Milkdown binds the key to an insert-hardbreak command, and that
           * command correctly returns FALSE wherever a hard break is not valid content — a heading,
           * a table cell, a code block. Returning false means "not handled", and with nothing behind
           * it the key does nothing at all and looks broken at random.
           *
           * This sits in the view's base props, which ProseMirror consults only AFTER every plugin
           * keymap has declined — so Milkdown still wins wherever it works, and this is purely the
           * floor underneath it. No plugin-ordering fight, no duplicated binding.
           */
          handleKeyDown: (view, event) => {
            if (event.key !== "Enter" || !event.shiftKey || readOnly) return false;
            const { state, dispatch } = view;
            const { $from } = state.selection;
            // In a fence, plain Enter already gives you a new line — so Shift+Enter means the other
            // thing you want there, which is to get OUT of the block.
            if ($from.parent.type.spec.code) return exitCode(state, dispatch);
            // IN A LIST, SHIFT+ENTER MEANS OUT. A hard break INSIDE the list item leaves the caret
            // indented at the marker and mints an invisible line-join that serialises as a trailing
            // backslash. The caret lands in a fresh paragraph after the WHOLE list, at the margin.
            for (let d = 1; d <= $from.depth; d++) {
              const n = $from.node(d);
              if (n.type.name === "bullet_list" || n.type.name === "ordered_list") {
                const para = state.schema.nodes.paragraph;
                if (!para) break;
                const pos = $from.after(d); // after the OUTERMOST list — the margin, not a nest
                const tr = state.tr.insert(pos, para.create());
                tr.setSelection(TextSelection.create(tr.doc, pos + 1)).scrollIntoView();
                dispatch(tr);
                return true;
              }
            }
            const br = state.schema.nodes.hard_break ?? state.schema.nodes.hardbreak;
            if (!br) return false;
            // Ask before inserting — if a hard break cannot live here, say so honestly rather than
            // dispatching a transaction that quietly drops it.
            if (!$from.parent.canReplaceWith($from.index(), $from.index(), br)) return false;
            dispatch(state.tr.replaceSelectionWith(br.create()).scrollIntoView());
            return true;
          },
        }));
        /**
         * THE RESURRECTION GUARD. The listener delivers markdownUpdated asynchronously, so a DYING
         * instance — and every docId change kills one — can fire one final time AFTER the parent has
         * moved to newer text, handing it the OLD document. That silently reverts edits and can
         * bleed one note's text into another on a fast switch. A torn-down instance is mute: only
         * the LIVE editor may speak for the draft.
         */
        ctx.get(listenerCtx).markdownUpdated((_c, md) => { if (!dead) cb.current(md); });
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
      .catch((err: unknown) => {
        tell("error", "Editor: the editor failed to build — the editing pane is empty", err);
      });

    return () => {
      dead = true;
      void editor.current?.destroy();
      editor.current = null;
    };
    // `initial` is deliberately NOT a dependency: it is the seed, and re-seeding on every change
    // would fight the user's typing. Switching documents changes docId, which rebuilds properly.
  }, [docId, readOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div className="scannotes-milkdown" ref={host} />;
});

export default MilkdownEditor;
