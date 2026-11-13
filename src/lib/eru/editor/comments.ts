import { Extension, Mark } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { SKIP_TRACKING } from "./track-changes";

/**
 * Comments, anchored to the text they are about by an eruComment mark carrying the comment's id (the comment itself, its author and whether
 * it is resolved, is a row in eru_document_comments). Several comments may cover the same text. A small plugin highlights the text of the
 * unresolved comments (yellow) and the one being looked at (stronger), from a set of ids the page hands it, so resolving a comment does not
 * change the document.
 */

export const COMMENT = "eruComment";

export const CommentMark = Mark.create({
  name: COMMENT,
  inclusive: false,
  excludes: "",
  addAttributes: () => ({ id: { default: null } }),
  parseHTML: () => [{ tag: "span[data-comment-id]", getAttrs: (el) => ({ id: (el as HTMLElement).getAttribute("data-comment-id") }) }],
  renderHTML: ({ HTMLAttributes }) => ["span", { "data-comment-id": HTMLAttributes.id, class: "eru-comment" }, 0],
});

type CommentState = { open: ReadonlySet<string>; active: string | null; decorations: DecorationSet };
const commentKey = new PluginKey<CommentState>("eruComments");

function decorate(doc: PMNode, open: ReadonlySet<string>, active: string | null): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const m of node.marks) {
      if (m.type.name !== COMMENT || !open.has(m.attrs.id)) continue;
      decos.push(Decoration.inline(pos, pos + node.nodeSize, { class: m.attrs.id === active ? "eru-comment-open eru-comment-active" : "eru-comment-open" }));
    }
  });
  return DecorationSet.create(doc, decos);
}

export const Comments = Extension.create({
  name: "eruComments",
  addProseMirrorPlugins() {
    return [
      new Plugin<CommentState>({
        key: commentKey,
        state: {
          init: (_, state) => ({ open: new Set(), active: null, decorations: DecorationSet.create(state.doc, []) }),
          apply: (tr, value) => {
            const meta = tr.getMeta(commentKey) as { open?: ReadonlySet<string>; active?: string | null } | undefined;
            if (!meta && !tr.docChanged) return value;
            const open = meta?.open ?? value.open;
            const active = meta && "active" in meta ? (meta.active ?? null) : value.active;
            return { open, active, decorations: decorate(tr.doc, open, active) };
          },
        },
        props: { decorations: (state) => commentKey.getState(state)?.decorations },
      }),
    ];
  },
});

/** Tells the highlighter which comments are unresolved and which one is being looked at. */
export function setCommentView(state: EditorState, dispatch: (tr: Transaction) => void, view: { open?: ReadonlySet<string>; active?: string | null }): void {
  dispatch(state.tr.setMeta(commentKey, view).setMeta(SKIP_TRACKING, true).setMeta("addToHistory", false));
}

/** Where each comment's text is in the document (first to last position it covers), by comment id. */
export function commentAnchors(doc: PMNode): Map<string, { from: number; to: number; text: string }> {
  const out = new Map<string, { from: number; to: number; text: string }>();
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const m of node.marks) {
      if (m.type.name !== COMMENT || !m.attrs.id) continue;
      const a = out.get(m.attrs.id);
      if (a) {
        a.to = pos + node.nodeSize;
        a.text += node.text ?? "";
      } else out.set(m.attrs.id, { from: pos, to: pos + node.nodeSize, text: node.text ?? "" });
    }
  });
  return out;
}
