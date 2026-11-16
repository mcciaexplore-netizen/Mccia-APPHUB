import { Extension, Mark } from "@tiptap/core";
import { Fragment, Slice, type MarkType, type Node as PMNode, type NodeType, type Schema } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { ReplaceAroundStep, ReplaceStep, Transform, type Mapping } from "@tiptap/pm/transform";
import { isHistoryTransaction } from "@tiptap/pm/history";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

/**
 * Track changes, as editor marks. While tracking is on, the plugin rewrites every edit as it happens (appendTransaction):
 *   - typed or pasted text gets an eruInsertion mark (shown green, underlined);
 *   - deleted text is put back with an eruDeletion mark (shown red, struck through) instead of disappearing;
 *   - deleting your own still-pending insertion really removes it (you are just correcting yourself);
 *   - each change carries an id, who made it and when; typing on from your own change continues it (same id).
 * Formatting, paragraph splits and joins, list and heading changes are applied straight away, not tracked. Undo removes a tracked edit
 * together with its marks (the rewrite is part of the same undo step). Code blocks cannot carry marks, so while tracking is on they cannot be
 * edited at all (see "Code blocks while tracking" below).
 *
 * Accepting an insertion removes its mark; rejecting it removes the text. Accepting a deletion removes the text; rejecting it removes the
 * mark. decideChanges() does this on any Transform, so the server applies reviews to the stored document with exactly the same code.
 *
 * Pure ProseMirror (no DOM), so it runs in the browser, on the server and in the unit tests.
 */

const INSERTION = "eruInsertion";
const DELETION = "eruDeletion";
/** Set on a transaction that must not be tracked (loading a document, applying a review). */
export const SKIP_TRACKING = "eruSkipTracking";

export type TrackUser = { id: string; name: string };
type ChangeType = "insertion" | "deletion";
type ChangeAttrs = { id: string; userId: string; userName: string; at: string };

const changeAttributes = {
  id: { default: null },
  userId: { default: null },
  userName: { default: "" },
  at: { default: null },
};

const attrsFrom = (el: HTMLElement) => ({
  id: el.getAttribute("data-change-id"),
  userId: el.getAttribute("data-user-id"),
  userName: el.getAttribute("data-user-name") ?? "",
  at: el.getAttribute("data-at"),
});

const domAttrs = (a: Record<string, unknown>, cls: string, verb: string) => ({
  class: cls,
  "data-change-id": a.id,
  "data-user-id": a.userId,
  "data-user-name": a.userName,
  "data-at": a.at,
  title: `${verb} by ${a.userName || "someone"}`,
});

/** Inserted text: green, underlined. Not inclusive: text typed next to it is tracked (or not) on its own. */
export const InsertionMark = Mark.create({
  name: INSERTION,
  inclusive: false,
  excludes: "",
  addAttributes: () => changeAttributes,
  parseHTML: () => [{ tag: "ins[data-change-id]", getAttrs: (el) => attrsFrom(el as HTMLElement) }],
  renderHTML: ({ HTMLAttributes }) => ["ins", domAttrs(HTMLAttributes, "eru-ins", "Inserted"), 0],
});

/** Deleted text, kept until reviewed: red, struck through. */
export const DeletionMark = Mark.create({
  name: DELETION,
  inclusive: false,
  excludes: "",
  addAttributes: () => changeAttributes,
  parseHTML: () => [{ tag: "del[data-change-id]", getAttrs: (el) => attrsFrom(el as HTMLElement) }],
  renderHTML: ({ HTMLAttributes }) => ["del", domAttrs(HTMLAttributes, "eru-del", "Deleted"), 0],
});

// ── The plugin ─────────────────────────────────────────────────────────────

type TrackState = { enabled: boolean; user: TrackUser | null };
const trackKey = new PluginKey<TrackState>("eruTrack");

const newId = () => globalThis.crypto.randomUUID();

/** The change attrs on a text node, by mark type name. */
function changeMark(node: PMNode | null | undefined, type: MarkType) {
  return node?.isText ? node.marks.find((m) => m.type === type) : undefined;
}

/**
 * The attrs for a change at [from, to): those of the same user's adjacent change of the same type (so typing on continues one change, as one
 * run of marked text), or new ones.
 */
function attrsNear(doc: PMNode, from: number, to: number, type: MarkType, user: TrackUser, makeId: () => string, at: string): ChangeAttrs {
  const before = from > 0 ? changeMark(doc.resolve(from).nodeBefore, type) : undefined;
  if (before && before.attrs.userId === user.id && before.attrs.id) return before.attrs as ChangeAttrs;
  const after = to < doc.content.size ? changeMark(doc.resolve(to).nodeAfter, type) : undefined;
  if (after && after.attrs.userId === user.id && after.attrs.id) return after.attrs as ChangeAttrs;
  return { id: makeId(), userId: user.id, userName: user.name, at };
}

/**
 * The deleted content, ready to put back: text gets the deletion mark (text already deleted keeps its own), the user's own pending
 * insertions are dropped (they really go). Null when nothing worth keeping is left (only structure, or only the user's own insertions).
 */
function markDeleted(slice: Slice, rootParent: NodeType, schema: Schema, attrs: ChangeAttrs): Slice | null {
  const del = schema.marks[DELETION];
  const ins = schema.marks[INSERTION];
  let keptText = false;
  const walk = (frag: Fragment, parent: NodeType): Fragment => {
    const out: PMNode[] = [];
    frag.forEach((child) => {
      if (child.isText) {
        const own = child.marks.find((m) => m.type === ins && m.attrs.userId === attrs.userId);
        if (own) return;
        keptText = true;
        if (child.marks.some((m) => m.type === del) || !parent.allowsMarkType(del)) out.push(child);
        else out.push(child.mark(del.create(attrs).addToSet(child.marks)));
      } else if (child.isLeaf) {
        out.push(child);
      } else {
        out.push(child.copy(walk(child.content, child.type)));
      }
    });
    return Fragment.from(out);
  };
  const content = walk(slice.content, rootParent);
  return keptText ? new Slice(content, slice.openStart, slice.openEnd) : null;
}

type Removed = { pos: number; slice: Slice; backspace: boolean };

/**
 * The tracking rewrite for a set of transactions just applied (see the header). Exported for the unit tests; the plugin below calls it.
 * Returns the transaction to append, or null when there is nothing to track.
 */
export function trackTransactions(transactions: readonly Transaction[], oldState: EditorState, newState: EditorState, user: TrackUser, makeId: () => string = newId, now = () => new Date().toISOString()): Transaction | null {
  const schema = newState.schema;
  const ins = schema.marks[INSERTION];
  if (!ins || !schema.marks[DELETION]) return null;
  const inserted: { from: number; to: number }[] = [];
  const removed: Removed[] = [];
  transactions.forEach((tr, k) => {
    if (!tr.docChanged || tr.getMeta(SKIP_TRACKING) || tr.getMeta("appendedTransaction") || isHistoryTransaction(tr)) return;
    // Positions after this transaction, mapped on through the ones after it.
    const later: Mapping[] = transactions.slice(k + 1).map((t) => t.mapping);
    const mapOn = (pos: number, assoc: number) => later.reduce((p, m) => m.map(p, assoc), pos);
    const selBefore = k === 0 ? oldState.selection : transactions[k - 1].selection;
    tr.steps.forEach((step, i) => {
      if (!(step instanceof ReplaceStep)) return; // structure (ReplaceAroundStep) and formatting are applied, not tracked
      const { from, to, slice } = step as unknown as { from: number; to: number; slice: Slice };
      const after = tr.mapping.slice(i + 1);
      if (slice.size > 0) {
        const a = mapOn(after.map(from, -1), -1);
        const b = mapOn(after.map(from + slice.size, 1), 1);
        if (b > a) inserted.push({ from: a, to: b });
      }
      if (to > from) {
        const backspace = tr.steps.length === 1 && selBefore.empty && selBefore.head === to;
        removed.push({ pos: mapOn(after.map(from, -1), -1), slice: tr.docs[i].slice(from, to), backspace });
      }
    });
  });
  if (!inserted.length && !removed.length) return null;

  const at = now();
  const rt = newState.tr;
  // 1. Inserted text: drop any change marks it came with (pasted from tracked text), then mark it as this user's insertion.
  for (const r of inserted) {
    const from = Math.max(0, r.from);
    const to = Math.min(rt.doc.content.size, r.to);
    if (to <= from || !rt.doc.textBetween(from, to, "", "").length) continue;
    rt.removeMark(from, to, ins);
    rt.removeMark(from, to, schema.marks[DELETION]);
    rt.addMark(from, to, ins.create(attrsNear(rt.doc, from, to, ins, user, makeId, at)));
  }
  // 2. Deleted text goes back in, marked, from the end of the document backwards so earlier positions stay right.
  let caret: number | null = null;
  const del = schema.marks[DELETION];
  for (const r of [...removed].sort((x, y) => y.pos - x.pos)) {
    const pos = Math.min(r.pos, rt.doc.content.size);
    const $pos = rt.doc.resolve(pos);
    const marked = markDeleted(r.slice, $pos.parent.type, schema, attrsNear(rt.doc, pos, pos, del, user, makeId, at));
    if (!marked) continue;
    const before = rt.doc.content.size;
    try {
      rt.replace(pos, pos, marked);
    } catch {
      continue; // could not be put back here: the deletion stands
    }
    if (removed.length === 1 && !inserted.length) caret = r.backspace ? pos : pos + (rt.doc.content.size - before);
  }
  if (!rt.docChanged) return null;
  if (caret !== null) rt.setSelection(TextSelection.create(rt.doc, Math.max(0, Math.min(caret, rt.doc.content.size))));
  return rt.setMeta(SKIP_TRACKING, true);
}

// ── Code blocks while tracking ─────────────────────────────────────────────
// A code block cannot carry marks, so its text cannot be marked inserted or deleted. Rather than let edits there slip past review (or, for
// deletions, be silently put back), they are refused while tracking is on, with a message saying why.

export const CODE_LOCKED_MESSAGE = "Code blocks cannot be edited while track changes is on. Turn off track changes to edit code blocks.";
/** The DOM event the editor's element fires when an edit is refused (detail: { message }), for the page to show. */
export const BLOCKED_EVENT = "eru-edit-blocked";

/** Whether [from, to] lies in a code block or takes in any part of one. */
export function touchesCodeBlock(doc: PMNode, from: number, to: number): boolean {
  const size = doc.content.size;
  const a = Math.max(0, Math.min(from, size));
  const b = Math.max(a, Math.min(to, size));
  const inCode = (pos: number) => {
    const $p = doc.resolve(pos);
    for (let d = $p.depth; d > 0; d--) if ($p.node(d).type.spec.code) return true;
    return false;
  };
  if (inCode(a) || inCode(b)) return true;
  let found = false;
  if (b > a)
    doc.nodesBetween(a, b, (n) => {
      if (found) return false;
      if (n.isBlock && n.type.spec.code) found = true;
    });
  return found;
}

/** Whether a transaction changes a code block's content or structure (formatting and our own rewrites aside). */
export function editsCodeBlock(tr: Transaction): boolean {
  if (!tr.docChanged || tr.getMeta(SKIP_TRACKING)) return false;
  return tr.steps.some((step, i) => {
    if (!(step instanceof ReplaceStep || step instanceof ReplaceAroundStep)) return false;
    const { from, to } = step as unknown as { from: number; to: number };
    return touchesCodeBlock(tr.docs[i], from, to);
  });
}

const lockedDecorations = new WeakMap<PMNode, DecorationSet>();
/** Code blocks shown as locked (dimmed, with the message as their tooltip) while tracking is on. */
function lockedCodeBlocks(doc: PMNode): DecorationSet {
  let set = lockedDecorations.get(doc);
  if (!set) {
    const decos: Decoration[] = [];
    doc.descendants((node, pos) => {
      if (node.isBlock && node.type.spec.code) {
        decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "eru-code-locked", title: CODE_LOCKED_MESSAGE }));
        return false;
      }
    });
    set = DecorationSet.create(doc, decos);
    lockedDecorations.set(doc, set);
  }
  return set;
}

/**
 * The browser's own selection in the editor, as document positions. Right after a click or an arrow key the editor's selection can lag the
 * browser's for a moment; the guards below look at both, so a keystroke is judged by where the caret really is.
 */
function liveSelection(v: EditorView): { from: number; to: number } | null {
  const sel = v.dom.ownerDocument.getSelection();
  if (!sel?.anchorNode || !sel.focusNode || !v.dom.contains(sel.anchorNode) || !v.dom.contains(sel.focusNode)) return null;
  try {
    const a = v.posAtDOM(sel.anchorNode, sel.anchorOffset);
    const f = v.posAtDOM(sel.focusNode, sel.focusOffset);
    return { from: Math.min(a, f), to: Math.max(a, f) };
  } catch {
    return null;
  }
}

/** The single character before (or after) a position in its own text block, or 0 when there is none: 2 for a surrogate pair. */
function charSize(doc: PMNode, pos: number, back: boolean): number {
  const $p = doc.resolve(pos);
  if (back ? $p.parentOffset === 0 : $p.parentOffset === $p.parent.content.size) return 0;
  const node = back ? $p.nodeBefore : $p.nodeAfter;
  if (!node?.isText || !node.text) return 0;
  const offset = back ? $p.textOffset || node.nodeSize : $p.textOffset;
  const code = node.text.charCodeAt(back ? offset - 1 : offset);
  const pair = back ? code >= 0xdc00 && code <= 0xdfff : code >= 0xd800 && code <= 0xdbff;
  return pair && (back ? offset >= 2 : offset + 1 < node.text.length) ? 2 : 1;
}

/**
 * Backspace / Delete of one character while tracking, done by the editor rather than left to the browser. The browser, deleting inside a
 * struck-through (deleted) word, rebuilds the formatting around it, which reads back as a different edit; and stepping over text that is
 * already deleted is what the person wants anyway. So: next to deleted text the caret steps over it; otherwise one character is deleted, as
 * a tracked edit. Returns false (let the editor's own commands run) at the edge of a paragraph, where Backspace/Delete join paragraphs.
 */
function trackedDeleteKey(v: EditorView, back: boolean, pos: number): boolean {
  const { state } = v;
  const del = state.schema.marks[DELETION];
  const size = charSize(state.doc, pos, back);
  if (!size) return false;
  const sync = state.selection.empty && state.selection.head === pos ? null : state.tr.setSelection(TextSelection.create(state.doc, pos));
  if (sync) v.dispatch(sync.setMeta("addToHistory", false));
  const at = (p: number) => (back ? v.state.doc.resolve(p).nodeBefore : v.state.doc.resolve(p).nodeAfter);
  if (at(pos)?.marks.some((m) => m.type === del)) {
    let p = pos;
    for (let n = charSize(v.state.doc, p, back); n && at(p)?.marks.some((m) => m.type === del); n = charSize(v.state.doc, p, back)) p += back ? -n : n;
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, p)).scrollIntoView());
    return true;
  }
  v.dispatch(v.state.tr.delete(back ? pos - size : pos, back ? pos : pos + size).scrollIntoView());
  return true;
}

function trackPlugin(): Plugin<TrackState> {
  let view: EditorView | null = null;
  const refuse = () => {
    view?.dom.dispatchEvent(new CustomEvent(BLOCKED_EVENT, { bubbles: true, detail: { message: CODE_LOCKED_MESSAGE } }));
    return true;
  };
  const tracking = (state: EditorState) => !!trackKey.getState(state)?.enabled;
  const selectionInCode = (v: EditorView) => {
    const live = liveSelection(v);
    return touchesCodeBlock(v.state.doc, v.state.selection.from, v.state.selection.to) || (!!live && touchesCodeBlock(v.state.doc, live.from, live.to));
  };
  return new Plugin<TrackState>({
    key: trackKey,
    view(v) {
      view = v;
      return { destroy: () => void (view = null) };
    },
    state: {
      init: () => ({ enabled: false, user: null }),
      apply: (tr, value) => {
        const meta = tr.getMeta(trackKey) as Partial<TrackState> | undefined;
        return meta ? { ...value, ...meta } : value;
      },
    },
    // The last word: whatever the source of an edit (typing, paste, drop, undo, a toolbar command), none reaches a code block while tracking.
    filterTransaction(tr, state) {
      if (!tracking(state) || !editsCodeBlock(tr)) return true;
      refuse();
      return false;
    },
    props: {
      // Stopped before the browser changes the page (typing, deleting, Enter, paste, drop all announce themselves with beforeinput). Letting
      // the browser change the page and refusing the edit afterwards would leave the page and the document out of step, and the editor's
      // next reading of the page could then make up an edit.
      handleDOMEvents: {
        beforeinput: (v, e) => {
          if (!tracking(v.state) || !selectionInCode(v)) return false;
          e.preventDefault();
          return refuse();
        },
      },
      handleTextInput: (v, from, to) => tracking(v.state) && touchesCodeBlock(v.state.doc, from, to) && refuse(),
      handleKeyDown: (v, e) => {
        if (!tracking(v.state)) return false;
        if (["Backspace", "Delete", "Enter", "Tab"].includes(e.key) && selectionInCode(v)) return refuse();
        // A plain Backspace / Delete with nothing selected: the editor does it (see trackedDeleteKey).
        if ((e.key === "Backspace" || e.key === "Delete") && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
          const live = liveSelection(v) ?? { from: v.state.selection.from, to: v.state.selection.to };
          if (live.from !== live.to || !v.state.selection.empty) return false;
          return trackedDeleteKey(v, e.key === "Backspace", live.from);
        }
        return false;
      },
      handlePaste: (v) => tracking(v.state) && selectionInCode(v) && refuse(),
      handleDrop: (v) => tracking(v.state) && selectionInCode(v) && refuse(),
      decorations: (state) => (tracking(state) ? lockedCodeBlocks(state.doc) : null),
    },
    appendTransaction(transactions, oldState, newState) {
      const s = trackKey.getState(newState);
      if (!s?.enabled || !s.user) return null;
      return trackTransactions(transactions, oldState, newState, s.user);
    },
  });
}

/** The editor extension that tracks edits while switched on (see setTracking). */
export const TrackChanges = Extension.create({
  name: "eruTrackChanges",
  addProseMirrorPlugins() {
    return [trackPlugin()];
  },
});

/** Switches tracking on or off for this editor (state), attributing tracked edits to `user`. Not an edit: not tracked, not undoable. */
export function setTracking(state: EditorState, dispatch: (tr: Transaction) => void, enabled: boolean, user: TrackUser): void {
  dispatch(state.tr.setMeta(trackKey, { enabled, user }).setMeta(SKIP_TRACKING, true).setMeta("addToHistory", false));
}

// ── Reading and deciding changes ───────────────────────────────────────────

export type ChangeInfo = { id: string; type: ChangeType; userId: string; userName: string; at: string | null; text: string; from: number; to: number };

/** Every tracked change in the document, in document order (an id's text joined across the places it covers). */
export function collectChanges(doc: PMNode): ChangeInfo[] {
  const byId = new Map<string, ChangeInfo>();
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const m of node.marks) {
      const type: ChangeType | null = m.type.name === INSERTION ? "insertion" : m.type.name === DELETION ? "deletion" : null;
      if (!type || !m.attrs.id) continue;
      const key = `${type}:${m.attrs.id}`;
      const c = byId.get(key);
      if (c) {
        c.text += node.text ?? "";
        c.to = pos + node.nodeSize;
      } else byId.set(key, { id: m.attrs.id, type, userId: m.attrs.userId ?? "", userName: m.attrs.userName ?? "", at: m.attrs.at ?? null, text: node.text ?? "", from: pos, to: pos + node.nodeSize });
    }
  });
  return [...byId.values()].sort((a, b) => a.from - b.from);
}

/**
 * Accepts or rejects tracked changes on a Transform (an editor transaction, or a Transform on the stored document on the server).
 * `ids` null means every change. Returns the ids decided.
 */
function decideChanges(tr: Transform, ids: ReadonlySet<string> | null, decision: "accept" | "reject"): string[] {
  const unmark: { from: number; to: number; mark: import("@tiptap/pm/model").Mark }[] = [];
  const drop: [number, number][] = [];
  const decided = new Set<string>();
  tr.doc.descendants((node, pos) => {
    if (!node.isText) return;
    let remove = false;
    for (const m of node.marks) {
      const isIns = m.type.name === INSERTION;
      if (!isIns && m.type.name !== DELETION) continue;
      if (ids && !ids.has(m.attrs.id)) continue;
      decided.add(m.attrs.id);
      const goes = decision === "accept" ? !isIns : isIns;
      if (goes) remove = true;
      else unmark.push({ from: pos, to: pos + node.nodeSize, mark: m });
    }
    if (remove) drop.push([pos, pos + node.nodeSize]);
  });
  for (const u of unmark) tr.removeMark(u.from, u.to, u.mark);
  // Neighbouring pieces become one range; delete from the end backwards so earlier positions stay right.
  const merged: [number, number][] = [];
  for (const r of drop.sort((a, b) => a[0] - b[0])) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  for (let i = merged.length - 1; i >= 0; i--) tr.delete(merged[i][0], merged[i][1]);
  return [...decided];
}

/** The document with the decision applied (for the server and the export). */
export function decidedDoc(doc: PMNode, ids: ReadonlySet<string> | null, decision: "accept" | "reject"): { doc: PMNode; decided: string[] } {
  const tr = new Transform(doc);
  const decided = decideChanges(tr, ids, decision);
  return { doc: tr.doc, decided };
}
