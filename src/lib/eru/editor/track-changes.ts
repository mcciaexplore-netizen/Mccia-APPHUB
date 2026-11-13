import { Extension, Mark } from "@tiptap/core";
import { Fragment, Slice, type MarkType, type Node as PMNode, type NodeType, type Schema } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { ReplaceStep, Transform, type Mapping } from "@tiptap/pm/transform";
import { isHistoryTransaction } from "@tiptap/pm/history";

/**
 * Track changes, as editor marks. While tracking is on, the plugin rewrites every edit as it happens (appendTransaction):
 *   - typed or pasted text gets an eruInsertion mark (shown green, underlined);
 *   - deleted text is put back with an eruDeletion mark (shown red, struck through) instead of disappearing;
 *   - deleting your own still-pending insertion really removes it (you are just correcting yourself);
 *   - each change carries an id, who made it and when; typing on from your own change continues it (same id).
 * Formatting, paragraph splits and joins, list and heading changes are applied straight away, not tracked. Undo removes a tracked edit
 * together with its marks (the rewrite is part of the same undo step).
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

function trackPlugin(): Plugin<TrackState> {
  return new Plugin<TrackState>({
    key: trackKey,
    state: {
      init: () => ({ enabled: false, user: null }),
      apply: (tr, value) => {
        const meta = tr.getMeta(trackKey) as Partial<TrackState> | undefined;
        return meta ? { ...value, ...meta } : value;
      },
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
