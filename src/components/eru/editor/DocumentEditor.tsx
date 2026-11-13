"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { ArrowLeft, Download, GitCompareArrows, Loader2, MessageSquare, MessageSquarePlus, Save } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { useToast } from "@/components/Toast";
import { addCommentAction, deleteCommentAction, resolveCommentAction, reviewChangesAction, saveDocumentAction, setTrackChangesAction } from "@/lib/eru/actions/workspace";
import { AUTOSAVE_MS, DOCUMENT_TITLE_MAX } from "@/lib/eru/eru.manifest";
import { eruExtensions, plainContent } from "@/lib/eru/editor/extensions";
import { collectChanges, setTracking, SKIP_TRACKING, type ChangeInfo } from "@/lib/eru/editor/track-changes";
import { COMMENT, commentAnchors, setCommentView } from "@/lib/eru/editor/comments";
import type { CommentView } from "@/lib/eru/queries";
import { exportHref, formatDateTime } from "../ui";
import { Toolbar } from "./Toolbar";
import { CommentsPanel, type Draft } from "./CommentsPanel";
import { ChangesPanel } from "./ChangesPanel";

export type EditorProps = {
  doc: { id: string; title: string; content: Record<string, unknown>; version: number; trackChanges: boolean; updatedAt: string; lastEditedBy: string };
  project: { id: string; number: string; title: string };
  comments: CommentView[];
  me: { id: string; name: string; admin: boolean };
};

type Side = "comments" | "changes" | null;

/** Runs a ProseMirror transaction on the editor, untracked and outside the undo history (comment marks, reviewed content). */
function quietly(editor: Editor, fn: (tr: Editor["state"]["tr"]) => void) {
  const tr = editor.state.tr;
  fn(tr);
  editor.view.dispatch(tr.setMeta(SKIP_TRACKING, true).setMeta("addToHistory", false));
}

/**
 * The document editor: a Word-like page with formatting, autosave every 30 seconds (and Save / Ctrl+S), track changes, comments beside the
 * text, the review of tracked changes (ERU admins), and the .docx download. Saving sends the version the editor started from; when someone
 * else saved in between, the save is refused and the page offers a reload instead of overwriting their work.
 */
export default function DocumentEditor({ doc, project, comments: initialComments, me }: EditorProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const [title, setTitle] = useState(doc.title);
  const [trackOn, setTrackOn] = useState(doc.trackChanges);
  const [comments, setComments] = useState(initialComments);
  const [side, setSide] = useState<Side>(initialComments.some((c) => !c.resolved) ? "comments" : null);
  const [activeComment, setActiveComment] = useState<string | null>(null);
  const [activeChange, setActiveChange] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [changes, setChanges] = useState<ChangeInfo[]>([]);
  const [tops, setTops] = useState<Record<string, number>>({});
  const [paperHeight, setPaperHeight] = useState(0);
  const [selTop, setSelTop] = useState<number | null>(null);
  const [aligned, setAligned] = useState(true);
  const [saveState, setSaveState] = useState<{ saving: boolean; savedAt: string | null; error: string | null; conflict: boolean }>({ saving: false, savedAt: doc.updatedAt, error: null, conflict: false });
  const [busy, setBusy] = useState(false);

  const version = useRef(doc.version);
  const edits = useRef(0); // goes up on every edit (and title change)
  const savedEdits = useRef(0); // the edit count the last successful save carried
  const saving = useRef<Promise<boolean> | null>(null);
  const conflict = useRef(false);
  const titleRef = useRef(doc.title);
  const paper = useRef<HTMLDivElement>(null);

  const extensions = useMemo(() => eruExtensions(), []);
  const editor = useEditor({
    extensions,
    content: doc.content,
    immediatelyRender: false,
    editorProps: { attributes: { class: "eru-prose", "aria-label": "Document text", spellcheck: "true" } },
    onUpdate: ({ transaction }) => {
      if (transaction.docChanged && !transaction.getMeta("eruReloaded")) edits.current++;
    },
  });

  const dirty = () => edits.current !== savedEdits.current;

  // ── Saving ────────────────────────────────────────────────────────────
  const save = useCallback(async (): Promise<boolean> => {
    if (!editor || conflict.current) return false;
    if (saving.current) await saving.current;
    if (!dirty()) return true;
    const run = (async () => {
      const sent = edits.current;
      setSaveState((s) => ({ ...s, saving: true, error: null }));
      const r = await saveDocumentAction(doc.id, { content: plainContent(editor.getJSON()), title: titleRef.current, baseVersion: version.current });
      if (!r.ok) {
        const isConflict = /changed by someone else/i.test(r.error);
        conflict.current = isConflict;
        setSaveState((s) => ({ ...s, saving: false, error: r.error, conflict: isConflict }));
        if (!isConflict) toast.error(r.error);
        return false;
      }
      version.current = r.data.version;
      savedEdits.current = sent;
      setSaveState({ saving: false, savedAt: r.data.savedAt, error: null, conflict: false });
      return true;
    })();
    saving.current = run;
    try {
      return await run;
    } finally {
      saving.current = null;
    }
  }, [editor, doc.id, toast]);

  useEffect(() => {
    const t = setInterval(() => void save(), AUTOSAVE_MS);
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    const leave = (e: BeforeUnloadEvent) => {
      if (dirty()) e.preventDefault();
    };
    window.addEventListener("keydown", key);
    window.addEventListener("beforeunload", leave);
    return () => {
      clearInterval(t);
      window.removeEventListener("keydown", key);
      window.removeEventListener("beforeunload", leave);
    };
  }, [save]);

  // ── Track changes ─────────────────────────────────────────────────────
  useEffect(() => {
    if (editor) setTracking(editor.state, editor.view.dispatch, trackOn, { id: me.id, name: me.name });
  }, [editor, trackOn, me.id, me.name]);

  async function toggleTracking() {
    const next = !trackOn;
    if (!next && !me.admin) return;
    setBusy(true);
    const r = await setTrackChangesAction(doc.id, next);
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    setTrackOn(next);
    if (r.message) toast.success(r.message);
    if (next) setSide("changes");
  }

  async function decide(ids: string[] | null, decision: "accept" | "reject") {
    if (!editor) return;
    if (ids === null && !(await confirm({ title: decision === "accept" ? "Accept every change?" : "Reject every change?", message: `${changes.length} tracked change${changes.length === 1 ? "" : "s"} will be ${decision === "accept" ? "accepted" : "rejected"}.`, confirmLabel: decision === "accept" ? "Accept all" : "Reject all", danger: decision === "reject" })))
      return;
    setBusy(true);
    try {
      if (!(await save())) return;
      const r = await reviewChangesAction(doc.id, { baseVersion: version.current, ids, decision });
      if (!r.ok) return toast.error(r.error);
      version.current = r.data.version;
      const at = editor.state.selection.from;
      editor.chain().setMeta(SKIP_TRACKING, true).setMeta("addToHistory", false).setMeta("eruReloaded", true).setContent(r.data.content, { emitUpdate: true }).run();
      quietly(editor, (tr) => tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(at, tr.doc.content.size)))));
      setSaveState((s) => ({ ...s, savedAt: new Date().toISOString() }));
      toast.success(`${r.data.decided} change${r.data.decided === 1 ? "" : "s"} ${decision === "accept" ? "accepted" : "rejected"}`);
    } finally {
      setBusy(false);
    }
  }

  // ── Following the document: changes, comment positions, the selection ──
  const measure = useCallback(() => {
    if (!editor || !paper.current) return;
    const base = paper.current.getBoundingClientRect().top;
    const anchors = commentAnchors(editor.state.doc);
    const next: Record<string, number> = {};
    for (const [id, a] of anchors) {
      try {
        next[id] = editor.view.coordsAtPos(a.from).top - base;
      } catch {
        // a position the view cannot place yet
      }
    }
    setTops((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    setPaperHeight(paper.current.offsetHeight);
    const sel = editor.state.selection;
    setSelTop(sel.empty ? null : editor.view.coordsAtPos(sel.from).top - base);
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const onTx = () => {
      setChanges(collectChanges(editor.state.doc));
      measure();
    };
    const onSel = () => {
      measure();
      const here = editor.state.selection.$head;
      const marks = [...(here.nodeBefore?.marks ?? []), ...(here.nodeAfter?.marks ?? [])];
      const c = marks.find((m) => m.type.name === COMMENT);
      if (c && editor.state.selection.empty) {
        setActiveComment(c.attrs.id as string);
        setSide((s) => s ?? "comments");
      }
    };
    onTx();
    editor.on("update", onTx);
    editor.on("selectionUpdate", onSel);
    const ro = new ResizeObserver(() => measure());
    if (paper.current) ro.observe(paper.current);
    const mq = window.matchMedia("(min-width: 1280px)");
    const onMq = () => setAligned(mq.matches);
    onMq();
    mq.addEventListener("change", onMq);
    return () => {
      editor.off("update", onTx);
      editor.off("selectionUpdate", onSel);
      ro.disconnect();
      mq.removeEventListener("change", onMq);
    };
  }, [editor, measure]);

  // The highlighter: unresolved comments yellow, the one being looked at stronger.
  useEffect(() => {
    if (!editor) return;
    setCommentView(editor.state, editor.view.dispatch, { open: new Set(comments.filter((c) => !c.resolved).map((c) => c.id)), active: activeComment });
  }, [editor, comments, activeComment]);

  // ── Comments ──────────────────────────────────────────────────────────
  function startComment() {
    if (!editor) return;
    const { from, to, empty } = editor.state.selection;
    if (empty) return toast.error("Select the text you want to comment on first.");
    const base = paper.current?.getBoundingClientRect().top ?? 0;
    setDraft({ from, to, quote: editor.state.doc.textBetween(from, to, " ", " ").slice(0, 500), top: editor.view.coordsAtPos(from).top - base });
    setSide("comments");
  }

  async function submitComment(text: string) {
    if (!editor || !draft) return;
    setBusy(true);
    const r = await addCommentAction(doc.id, { content: text, from: draft.from, to: draft.to, quote: draft.quote });
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    const type = editor.schema.marks[COMMENT];
    quietly(editor, (tr) => tr.addMark(Math.min(draft.from, tr.doc.content.size), Math.min(draft.to, tr.doc.content.size), type.create({ id: r.data.id })));
    edits.current++;
    setComments((cs) => [...cs, { id: r.data.id, userId: me.id, userName: me.name, content: text.trim(), quote: draft.quote, resolved: false, resolvedByName: null, createdAt: r.data.createdAt }]);
    setActiveComment(r.data.id);
    setDraft(null);
    void save();
  }

  async function resolve(id: string, resolved: boolean) {
    setBusy(true);
    const r = await resolveCommentAction(id, resolved);
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    setComments((cs) => cs.map((c) => (c.id === id ? { ...c, resolved, resolvedByName: resolved ? me.name : null } : c)));
    if (resolved && activeComment === id) setActiveComment(null);
  }

  async function removeComment(id: string) {
    if (!editor || !(await confirm({ title: "Delete this comment?", message: "It is deleted for good.", confirmLabel: "Delete", danger: true }))) return;
    setBusy(true);
    const r = await deleteCommentAction(id);
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    const type = editor.schema.marks[COMMENT];
    quietly(editor, (tr) => tr.removeMark(0, tr.doc.content.size, type.create({ id })));
    edits.current++;
    setComments((cs) => cs.filter((c) => c.id !== id));
    void save();
  }

  function focusRange(from: number, to: number) {
    if (!editor) return;
    const size = editor.state.doc.content.size;
    editor.chain().focus().setTextSelection({ from: Math.min(from, size), to: Math.min(to, size) }).scrollIntoView().run();
  }

  function activateComment(id: string) {
    setActiveComment(id);
    const a = editor && commentAnchors(editor.state.doc).get(id);
    if (a) focusRange(a.from, a.to);
  }

  // ── Layout ────────────────────────────────────────────────────────────
  const openComments = comments.filter((c) => !c.resolved).length;
  const status = saveState.saving ? "Saving…" : saveState.error ? "Not saved" : saveState.savedAt ? `Saved ${formatDateTime(saveState.savedAt)}` : "";

  return (
    <div className="eru-root flex flex-col gap-3">
      <div className="eru-editor-bar">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--eru-line)] px-3 py-2">
          <Link href={`/eru/projects/${project.id}`} className="eru-tool" title={`Back to ${project.number}`} aria-label={`Back to ${project.number}`} onClick={() => void save()}>
            <ArrowLeft size={16} aria-hidden />
          </Link>
          <span className="hidden font-mono text-xs font-bold text-[var(--eru-navy)] sm:inline">{project.number}</span>
          <input
            className="min-w-[10rem] flex-1 rounded-md border border-transparent px-2 py-1 text-[1.05rem] font-bold text-ink hover:border-[var(--eru-line)] focus:border-[var(--eru-navy)] focus:outline-none"
            value={title}
            maxLength={DOCUMENT_TITLE_MAX}
            aria-label="Document title"
            onChange={(e) => {
              setTitle(e.target.value);
              titleRef.current = e.target.value;
              edits.current++;
            }}
            onBlur={() => void save()}
          />
          <span className={`text-xs ${saveState.error ? "font-bold text-[var(--eru-red)]" : "eru-muted"}`} aria-live="polite" data-testid="eru-save-status">
            {saveState.saving && <Loader2 size={12} className="mr-1 inline animate-spin" aria-hidden />}
            {status}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void save()} disabled={saveState.saving || saveState.conflict}>
            <Save size={14} aria-hidden /> Save
          </button>
          <button
            type="button"
            className={`btn btn-sm ${trackOn ? "eru-btn-green" : "btn-ghost"}`}
            aria-pressed={trackOn}
            disabled={busy || (trackOn && !me.admin)}
            title={trackOn && !me.admin ? "Only an ERU admin can switch track changes off" : trackOn ? "Every edit is tracked. Click to switch off." : "Track every edit from now on"}
            onClick={toggleTracking}
          >
            <GitCompareArrows size={14} aria-hidden /> Track Changes {trackOn ? "on" : "off"}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" aria-pressed={side === "changes"} onClick={() => setSide((s) => (s === "changes" ? null : "changes"))}>
            Changes ({changes.length})
          </button>
          <button type="button" className="btn btn-ghost btn-sm" aria-pressed={side === "comments"} onClick={() => setSide((s) => (s === "comments" ? null : "comments"))}>
            <MessageSquare size={14} aria-hidden /> Comments ({openComments})
          </button>
          <a
            href={exportHref(doc.id)}
            className="btn btn-ghost btn-sm"
            onClick={async (e) => {
              if (!dirty()) return;
              e.preventDefault();
              if (await save()) window.location.href = exportHref(doc.id);
            }}
          >
            <Download size={14} aria-hidden /> Download .docx
          </a>
        </div>
        {editor && <Toolbar editor={editor} onComment={startComment} />}
      </div>

      {saveState.conflict && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-[rgba(220,38,38,0.3)] bg-[var(--eru-red-tint)] px-4 py-3 text-sm text-[#991b1b]">
          <span className="flex-1">{saveState.error}</span>
          <button type="button" className="btn eru-btn-red btn-sm" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      )}
      {trackOn && (
        <p className="text-xs eru-muted">
          Track changes is on: insertions show <span className="font-semibold text-[#15803d] underline">green</span>, deletions <span className="font-semibold text-[#b91c1c] line-through">red</span>.
          {me.admin ? " Review them under Changes." : " An ERU admin reviews them."}
        </p>
      )}

      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="eru-desk min-w-0 flex-1">
          <div ref={paper} className="eru-paper" onKeyDown={(e) => e.key.toLowerCase() === "m" && (e.metaKey || e.ctrlKey) && e.altKey && (e.preventDefault(), startComment())}>
            {editor ? <EditorContent editor={editor} /> : <p className="eru-muted">Loading the editor…</p>}
            {selTop !== null && !draft && (
              <button
                type="button"
                className="btn eru-btn-navy btn-sm absolute right-2 shadow-md xl:-right-4"
                style={{ top: Math.max(0, selTop - 4) }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={startComment}
                data-testid="eru-add-comment"
              >
                <MessageSquarePlus size={14} aria-hidden /> Add comment
              </button>
            )}
          </div>
        </div>
        {side && (
          <aside className="eru-side w-full xl:w-80" aria-label={side === "comments" ? "Comments" : "Tracked changes"}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[0.95rem] font-bold text-ink">{side === "comments" ? `Comments (${openComments})` : `Tracked changes (${changes.length})`}</h2>
              <button type="button" className="eru-tool" aria-label="Close panel" onClick={() => setSide(null)}>
                ×
              </button>
            </div>
            {side === "comments" ? (
              <CommentsPanel
                comments={comments}
                tops={tops}
                aligned={aligned}
                height={paperHeight}
                active={activeComment}
                draft={draft}
                me={me}
                busy={busy}
                onActivate={activateComment}
                onSubmitDraft={submitComment}
                onCancelDraft={() => setDraft(null)}
                onResolve={resolve}
                onDelete={removeComment}
              />
            ) : (
              <ChangesPanel
                changes={changes}
                admin={me.admin}
                busy={busy}
                active={activeChange}
                onFocus={(c) => {
                  setActiveChange(c.id);
                  focusRange(c.from, c.to);
                }}
                onDecide={decide}
              />
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
