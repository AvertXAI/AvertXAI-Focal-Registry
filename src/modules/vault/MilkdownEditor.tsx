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
import { vaultApi } from "./vaultApi";
import { isVaultSrc, resolveAttachmentSrc } from "./attachmentSrc";

/** Bytes for images pasted moments ago, keyed by their pending token — the on-screen preview
 *  while the encrypted save is in flight. Session-lived, tiny, and cleared when the save lands. */
const pendingPreview = new Map<string, string>();

/**
 * EVERY SWALLOWED FAILURE LEAVES A TRAIL (Jason 08-16-2026: "the errors arent appearing in the
 * logs, so how are we suppose to know whats working or breaking"). The catches in this file are
 * deliberate — a bad paste must never take the notes screen down — but silent-AND-unrecorded is
 * how the same bug got screenshotted three times. This routes them to the vault event log
 * (actor stamped "renderer" main-side). Message and stack only, NEVER note content. The logger
 * itself may never throw a second failure into the path it is reporting on.
 */
function tell(level: "warn" | "error", message: string, err?: unknown): void {
  try {
    void vaultApi().logClient(level, message, err instanceof Error ? (err.stack ?? err.message) : err === undefined ? undefined : String(err));
  } catch { /* a dead bridge: the console still gets it below */ }
  if (level === "error") console.error(`[vault:renderer] ${message}`, err ?? "");
  else console.warn(`[vault:renderer] ${message}`, err ?? "");
}

/** One log line per failing image reference, not one per MutationObserver sweep. */
const toldSrcFailures = new Set<string>();

/** Everything the toolbar can ask for. A closed union so a typo is a compile error, not a dead
 *  button. The same union drives BOTH engines: Milkdown commands here, plain-text insertion in
 *  rawFormat.ts — one action vocabulary, two renderings of it. */
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
  | "image"
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
  /** A direct click on an image node (Jason 08-15-2026): pasted screenshots render CAPPED in the
   *  editing surface, so the click is the way to the full-size view — the parent opens the modal. */
  onImageClick?: (src: string) => void;
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
  { docId, initial, onChange, readOnly = false, onImageClick },
  ref
) {
  const host = useRef<HTMLDivElement | null>(null);
  const editor = useRef<Editor | null>(null);
  // The callback lives in a ref so the editor is NOT rebuilt every time the parent re-renders —
  // rebuilding on each keystroke would drop the cursor, which is the classic way this integration
  // goes wrong.
  const cb = useRef(onChange);
  cb.current = onChange;
  // Same ref treatment, same reason.
  const imgClick = useRef(onImageClick);
  imgClick.current = onImageClick;

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
            if ("insert" in action) {
              // Markdown text — the vault chip. `true` = inline, so it lands in the current
              // paragraph rather than opening a block of its own.
              ed.action(insert(action.insert, true));
            } else {
              // The paragraph-style dropdown's three heading levels.
              ed.action(callCommand(wrapInHeadingCommand.key, action.heading));
            }
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
            // A placeholder href — the WYSIWYG has no link-edit bubble yet, so the address itself
            // is edited in Raw. ponytail: a link tooltip UI is the upgrade if this grates.
            ed.action(callCommand(toggleLinkCommand.key, { href: "https://" }));
          } else if (action === "table") {
            ed.action(callCommand(insertTableCommand.key, { row: 3, col: 3 }));
          } else if (action === "codeblock") {
            ed.action(callCommand(createCodeBlockCommand.key, "bash"));
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
              image: undefined, // disabled in the WYSIWYG — pasting is the image path there
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
          /**
           * CLICK AN IMAGE, SEE THE IMAGE (Jason 08-15-2026). Pasted screenshots render capped by
           * CSS so they cannot blast the pane; the full-size view is one click away, in a modal the
           * parent owns. `direct` only — a click on text that merely lands near an image must not
           * hijack the caret. Returning true stops ProseMirror turning the click into a node
           * selection, which is the right trade: selecting an image you cannot really see is not
           * a thing anyone wants; deleting one still works from either side with the keyboard.
           */
          handleClickOn: (_view, _pos, node, _nodePos, _event, direct) => {
            if (direct && node.type.name === "image" && typeof node.attrs.src === "string" && node.attrs.src && imgClick.current) {
              imgClick.current(node.attrs.src);
              return true;
            }
            return false;
          },

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
            /**
             * AN IMAGE ON THE CLIPBOARD (Jason 08-16-2026: "it spits out a garage of text… joplin
             * does this: ![name](:/id)"). Without this branch, Chromium's HTML flavour carried the
             * screenshot as a 200,000-character base64 data URL straight into the note body — it
             * rendered, but the Raw view was a wall and every autosave shipped the whole wall
             * again. Now the BYTES go to the vault's attachment store and the document gets one
             * readable line: ![pasted-image.png](vault://<uuid>). The insert happens when the save
             * lands (a beat later, not blocking the paste), at the selection that was active.
             */
            const imageFile = Array.from(event.clipboardData?.items ?? [])
              .find((i) => i.kind === "file" && i.type.startsWith("image/"))
              ?.getAsFile();
            if (imageFile) {
              /**
               * THE POSITION IS CAPTURED NOW — at the paste, at the selection the user is looking
               * at (Jason 08-16-2026 PM: "im trying to add it where the cursor is, but somehow it
               * always jumps 5-6 rows/lines under the cursor"). The old flow inserted only after
               * FileReader + IPC + the encrypted write had all completed, and read the selection
               * as it stood BY THEN — an async gap the caret could drift across. Joplin's editor
               * is the model here (researched 08-16-2026): it drops the `![](:/id)` reference at
               * the caret synchronously and fills the resource in behind. Same shape: a pending
               * image node lands NOW; its real vault:// id is swapped in when the save returns;
               * a refused save removes the node rather than leaving a corpse.
               */
              const { state } = view;
              const imgType = state.schema.nodes.image;
              const paraType = state.schema.nodes.paragraph;
              if (!imgType) return true;
              const nonce = `vault-pending:${Math.random().toString(36).slice(2)}`;
              const node = imgType.create({ src: nonce, alt: imageFile.name || "image.png" });
              /**
               * A SCREENSHOT IS A BLOCK, NEVER A DECORATION: the image node is INLINE, so dropped
               * at the caret it joins whatever block the caret is in — inside a heading, the
               * serializer must then write that heading setext-style with escapes, which is the
               * `====` damage. Into the paragraph only when the caret is already in a plain
               * paragraph; anywhere else (heading, list item, quote) the image gets its OWN
               * paragraph immediately after the current block — one line below the caret, not
               * five.
               */
              const $from = state.selection.$from;
              if ($from.parent.type === paraType || !paraType) {
                view.dispatch(state.tr.replaceSelectionWith(node).scrollIntoView());
              } else {
                const after = $from.after(Math.max(1, $from.depth));
                view.dispatch(state.tr.insert(after, paraType.create(null, node)).scrollIntoView());
              }
              /** Swap the pending node to its final src wherever it sits NOW (the user may have
               *  kept typing), or remove it if the save was refused. Position is re-found by the
               *  nonce, never remembered — remembered positions are how the jump bug happened. */
              const finish = (src: string | null): void => {
                try {
                  const st = view.state;
                  let pos = -1;
                  st.doc.descendants((n, p) => {
                    if (pos >= 0) return false;
                    if (n.type.name === "image" && n.attrs.src === nonce) { pos = p; return false; }
                    return true;
                  });
                  if (pos < 0) return; // they deleted it while it saved — their call stands
                  if (src) view.dispatch(st.tr.setNodeMarkup(pos, undefined, { ...st.doc.nodeAt(pos)!.attrs, src }));
                  else view.dispatch(st.tr.delete(pos, pos + 1));
                } catch (err) {
                  tell("warn", "Editor: a pasted image's reference could not be finalised in the document", err);
                }
              };
              const reader = new FileReader();
              reader.onload = () => {
                const dataUrl = typeof reader.result === "string" ? reader.result : "";
                const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
                if (!base64) { finish(null); return; }
                // The bytes render on screen immediately through the sweep below — the DOCUMENT
                // keeps only the pending token, so no base64 wall can ever reach a save.
                pendingPreview.set(nonce, dataUrl);
                void vaultApi()
                  .saveAttachment({ name: imageFile.name || undefined, mime: imageFile.type, dataBase64: base64 })
                  .then((meta) => finish(`vault://${meta.uuid}`))
                  .catch((err: unknown) => {
                    // Refused (locked, oversize): the paste is lost, never the note — and SAID SO.
                    tell("error", "Editor: a pasted image could not be saved to the vault — the paste was removed", err);
                    finish(null);
                  })
                  .finally(() => pendingPreview.delete(nonce));
              };
              // Adversarial review (08-16-2026) found the one hole in "always swapped or
              // deleted": a FileReader failure fired neither, orphaning the pending node in the
              // document forever. It now removes itself, on record.
              reader.onerror = () => {
                tell("error", "Editor: the pasted image could not be read from the clipboard — the paste was removed", reader.error);
                finish(null);
              };
              reader.readAsDataURL(imageFile);
              return true; // consumed — the base64 wall never enters the document
            }
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
            /**
             * IN A LIST, SHIFT+ENTER MEANS OUT (Jason 08-16-2026: "i cant go past the '-'…it
             * wont go to the beginning of the newline…so its pretty fucked"). The old behaviour
             * inserted a hard break INSIDE the list item — the caret stayed indented at the
             * marker, and every press minted one of the invisible line-joins that serialise as
             * a trailing backslash. Now the caret lands in a fresh paragraph after the WHOLE
             * list, at the margin. Plain Enter still continues the list; Enter on an empty item
             * still lifts out — those are unchanged.
             */
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
            // Ask before inserting. This is the check the failing cases were missing: if a hard
            // break cannot live here, say so honestly rather than dispatching a transaction that
            // quietly drops it.
            if (!$from.parent.canReplaceWith($from.index(), $from.index(), br)) return false;
            dispatch(state.tr.replaceSelectionWith(br.create()).scrollIntoView());
            return true;
          },
        }));
        /**
         * THE RESURRECTION BUG (Jason 08-16-2026 evening: "the '\' still exists… nothing has
         * changed" — after a Tidy that had VISIBLY worked). The listener delivers
         * markdownUpdated asynchronously, so a DYING instance — and every docId change kills
         * one: Tidy, the Split raw-sync, switching notes — could fire one final time AFTER the
         * parent had already moved to newer text, handing it the OLD document. That un-tidied
         * the note (the damage "coming back"), could revert raw-pane edits, and could bleed one
         * note's text into another on a fast switch. The guard makes a torn-down instance mute:
         * only the LIVE editor may speak for the draft.
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
        // A failed editor must not take the notes screen down with it — but an empty pane with
        // an empty log is undiagnosable, which is how this file's bugs stayed invisible.
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

  /**
   * RESOLVE vault:// IMAGES IN THE EDITOR'S DOM. The document node keeps `vault://<uuid>` as its
   * src — that is what serialises back into the markdown — but a browser cannot load that scheme,
   * so the on-screen <img> element gets its src swapped to the resolved data URL. A DOM swap, not
   * a node change: the serializer reads node attrs, never the DOM, so the stored text is
   * untouched. ProseMirror may redraw the element on nearby edits and re-stamp vault://; the
   * observer just swaps it again from the session cache.
   * ponytail: a MutationObserver sweep, not a ProseMirror nodeview — a nodeview through Milkdown's
   * plugin surface is the upgrade path if the swap ever visibly flickers.
   */
  useEffect(() => {
    const root = host.current;
    if (!root) return;
    const sweep = (): void => {
      root.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
        const raw = img.getAttribute("src");
        // A just-pasted image still saving: show its bytes from the pending map, DOM-only.
        if (raw?.startsWith("vault-pending:")) {
          const url = pendingPreview.get(raw);
          if (url && img.src !== url) img.src = url;
          return;
        }
        if (!isVaultSrc(raw)) return;
        void resolveAttachmentSrc(raw as string)
          .then((url) => {
            // Re-check before writing — the node may have been edited while the bytes crossed.
            if (img.getAttribute("src") === raw) img.src = url;
          })
          .catch((err: unknown) => {
            // Locked or gone: the broken-image glyph is the honest state here. Logged ONCE per
            // reference — the sweep re-fires on every redraw and a locked vault is not a flood.
            if (!toldSrcFailures.has(raw as string)) {
              toldSrcFailures.add(raw as string);
              tell("warn", "Editor: a pasted image could not be loaded from the vault", err);
            }
          });
      });
    };
    const mo = new MutationObserver(sweep);
    mo.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
    sweep();
    return () => mo.disconnect();
  }, [docId]);

  return <div className="vault-milkdown" ref={host} />;
});

export default MilkdownEditor;
