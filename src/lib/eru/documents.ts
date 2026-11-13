import "server-only";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import type { Node as PMNode } from "@tiptap/pm/model";
import { db } from "./db";
import { auditLogs, documentChanges, documentComments, documents, files, projects, settings } from "@/db/eru-schema";
import { EruError, type SessionUser } from "./dal";
import { audit } from "./audit";
import { claimFile, deleteFiles } from "./files";
import { can, cleanDocumentTitle, isUuid, MAX_CONTENT_BYTES } from "./eru.manifest";
import { EMPTY_DOC, eruSchema } from "./editor/extensions";
import { collectChanges, decidedDoc } from "./editor/track-changes";
import { notify } from "./host-adapter";

/**
 * Documents: creating (blank, or imported from .docx in the browser), saving, track changes and their review, comments, deleting.
 *
 * Every save sends the version it was made from; a save from an older version is refused ("reload"), so two people never overwrite each
 * other unseen. On every save the change records (eru_document_changes) are brought in line with the change marks in the content:
 *   - a new change must be the saver's own;
 *   - a pending change that disappeared is withdrawn, but only if it was the saver's own (they undid or deleted their own edit) or the saver
 *     is an ERU admin; otherwise the save is refused, so tracked changes cannot be removed without review.
 * Reviews (accept / reject) are applied here, on the stored document, by an ERU admin only.
 */

/** Reads and checks a document's content as sent by the editor: the editor's JSON, of a sane size, valid for the schema. */
function parseContent(json: unknown): PMNode {
  if (!json || typeof json !== "object" || (json as { type?: unknown }).type !== "doc") throw new EruError("The document could not be read. Please reload and try again.");
  if (JSON.stringify(json).length > MAX_CONTENT_BYTES) throw new EruError("The document is too large to save (about 2.5 MB of text). Split it into two documents.");
  try {
    const node = eruSchema().nodeFromJSON(json);
    node.check();
    return node;
  } catch {
    throw new EruError("The document contains something the editor does not support. Please reload and try again.");
  }
}

async function projectOf(projectId: string) {
  if (!isUuid(projectId)) throw new EruError("That project no longer exists.");
  const [p] = await db.select({ id: projects.id, number: projects.number, title: projects.title, assignedTo: projects.assignedTo }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!p) throw new EruError("That project no longer exists.");
  return p;
}

async function documentRow(id: string) {
  if (!isUuid(id)) throw new EruError("That document no longer exists.");
  const [d] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!d) throw new EruError("That document no longer exists.");
  return d;
}

/** A new document in a project: blank, or with content the browser converted from a .docx (whose original upload is kept with it). */
export async function createDocument(u: SessionUser, projectId: string, input: { title: string; content?: unknown; originalFileId?: string | null }): Promise<{ id: string }> {
  if (!can.editDocument(u.roles)) throw new EruError("ERU team members only.");
  const p = await projectOf(projectId);
  const content = input.content ? parseContent(input.content).toJSON() : EMPTY_DOC;
  const [s] = await db.select({ trackChangesDefault: settings.trackChangesDefault }).from(settings).where(eq(settings.id, 1));
  const [d] = await db
    .insert(documents)
    .values({ projectId: p.id, title: cleanDocumentTitle(input.title), content, createdBy: u.id, lastEditedBy: u.id, trackChanges: !!s?.trackChangesDefault })
    .returning({ id: documents.id });
  if (input.originalFileId) {
    if (!isUuid(input.originalFileId)) throw new EruError("The uploaded file could not be found. Please upload it again.");
    const f = await claimFile(u.id, input.originalFileId, { projectId: p.id, documentId: d.id });
    await db.update(documents).set({ originalFileId: f.id }).where(eq(documents.id, d.id));
  }
  await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, p.id));
  await audit(p.id, u.id, input.originalFileId ? "document.import" : "document.create", { documentId: d.id, title: cleanDocumentTitle(input.title) });
  return d;
}

/** Brings the change records in line with the content (see the header). Throws, before anything is written, when the save must be refused. */
async function planChangeSync(u: SessionUser, documentId: string, doc: PMNode) {
  const live = collectChanges(doc);
  const liveIds = new Set(live.map((c) => c.id));
  const rows = await db.select().from(documentChanges).where(eq(documentChanges.documentId, documentId));
  const known = new Map(rows.map((r) => [r.id, r]));
  const added = live.filter((c) => !known.has(c.id));
  for (const c of added) {
    if (!isUuid(c.id)) throw new EruError("The document could not be read. Please reload and try again.");
    if (c.userId !== u.id) throw new EruError("Someone else's tracked change appeared in your copy. Please reload the document.");
  }
  const updated = live.filter((c) => known.get(c.id)?.status === "pending");
  const gone = rows.filter((r) => r.status === "pending" && !liveIds.has(r.id));
  const othersGone = gone.filter((r) => r.userId !== u.id);
  if (othersGone.length && !can.reviewChanges(u.roles))
    throw new EruError("This save would remove tracked changes made by others. Only an ERU admin can accept or reject them: undo that edit, or reload the document.");
  return { added, updated, gone };
}

const changeValues = (documentId: string, c: ReturnType<typeof collectChanges>[number]) => ({
  documentId,
  userId: c.userId,
  changeType: c.type,
  fromContent: c.type === "deletion" ? c.text.slice(0, 5000) : "",
  toContent: c.type === "insertion" ? c.text.slice(0, 5000) : "",
  selectionFrom: c.from,
  selectionTo: c.to,
});

/** Saves the editor's content (and title). Refused when the document changed since `baseVersion`. */
export async function saveDocument(u: SessionUser, id: string, input: { content: unknown; title?: string; baseVersion: number }): Promise<{ version: number; savedAt: string }> {
  if (!can.editDocument(u.roles)) throw new EruError("ERU team members only.");
  const d = await documentRow(id);
  if (d.version !== input.baseVersion) throw new EruError(CONFLICT);
  const doc = parseContent(input.content);
  const plan = await planChangeSync(u, id, doc);
  const now = new Date();
  const [saved] = await db
    .update(documents)
    .set({ content: doc.toJSON(), title: input.title === undefined ? d.title : cleanDocumentTitle(input.title), version: d.version + 1, lastEditedBy: u.id, updatedAt: now })
    .where(and(eq(documents.id, id), eq(documents.version, input.baseVersion)))
    .returning({ version: documents.version });
  if (!saved) throw new EruError(CONFLICT);
  if (plan.added.length) await db.insert(documentChanges).values(plan.added.map((c) => ({ id: c.id, ...changeValues(id, c) }))).onConflictDoNothing();
  for (const c of plan.updated) {
    const v = changeValues(id, c);
    await db.update(documentChanges).set({ fromContent: v.fromContent, toContent: v.toContent, selectionFrom: v.selectionFrom, selectionTo: v.selectionTo }).where(and(eq(documentChanges.id, c.id), eq(documentChanges.status, "pending")));
  }
  if (plan.gone.length) await db.delete(documentChanges).where(and(inArray(documentChanges.id, plan.gone.map((g) => g.id)), eq(documentChanges.status, "pending")));
  await db.update(projects).set({ updatedAt: now }).where(eq(projects.id, d.projectId));
  await auditEdit(d.projectId, u.id, id, d.title);
  return { version: saved.version, savedAt: now.toISOString() };
}

const CONFLICT = "This document was changed by someone else since you opened it. Copy anything you need to keep, then reload the page to get their version.";

/** One "edited" line in the history per person and document every half hour, not one per autosave. */
async function auditEdit(projectId: string, userId: string, documentId: string, title: string) {
  const since = new Date(Date.now() - 30 * 60_000);
  const [recent] = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(and(eq(auditLogs.projectId, projectId), eq(auditLogs.userId, userId), eq(auditLogs.action, "document.edit"), gt(auditLogs.createdAt, since), sql`${auditLogs.details}->>'documentId' = ${documentId}`))
    .limit(1);
  if (!recent) await audit(projectId, userId, "document.edit", { documentId, title });
}

/** Switches track changes on (anyone in the team) or off (ERU admins only). */
export async function setTrackChanges(u: SessionUser, id: string, on: boolean): Promise<void> {
  if (!can.setTrackChanges(u.roles, on)) throw new EruError(on ? "ERU team members only." : "Only an ERU admin can switch track changes off.");
  const d = await documentRow(id);
  if (d.trackChanges === on) return;
  await db.update(documents).set({ trackChanges: on }).where(eq(documents.id, id));
  await audit(d.projectId, u.id, on ? "document.track_on" : "document.track_off", { documentId: id, title: d.title });
}

/**
 * Accepts or rejects tracked changes (`ids` null: all of them) on the stored document, as an ERU admin. The admin's editor saves first, then
 * asks for this with the version it saved; the reviewed content comes back for the editor to show.
 */
export async function reviewChanges(u: SessionUser, id: string, input: { baseVersion: number; ids: string[] | null; decision: "accept" | "reject" }): Promise<{ content: Record<string, unknown>; version: number; decided: number }> {
  if (!can.reviewChanges(u.roles)) throw new EruError("Only an ERU admin can accept or reject tracked changes.");
  if (input.decision !== "accept" && input.decision !== "reject") throw new EruError("Choose accept or reject.");
  const d = await documentRow(id);
  if (d.version !== input.baseVersion) throw new EruError(CONFLICT);
  const ids = input.ids ? new Set(input.ids.filter(isUuid)) : null;
  const { doc, decided } = decidedDoc(parseContent(d.content), ids, input.decision);
  if (!decided.length) return { content: d.content, version: d.version, decided: 0 };
  const now = new Date();
  const content = doc.toJSON() as Record<string, unknown>;
  const [saved] = await db
    .update(documents)
    .set({ content, version: d.version + 1, lastEditedBy: u.id, updatedAt: now })
    .where(and(eq(documents.id, id), eq(documents.version, input.baseVersion)))
    .returning({ version: documents.version });
  if (!saved) throw new EruError(CONFLICT);
  const status = input.decision === "accept" ? "accepted" : "rejected";
  const reviewed = await db
    .update(documentChanges)
    .set({ status, reviewedBy: u.id, reviewedAt: now })
    .where(and(eq(documentChanges.documentId, id), inArray(documentChanges.id, decided), eq(documentChanges.status, "pending")))
    .returning({ userId: documentChanges.userId });
  await audit(d.projectId, u.id, `changes.${status}`, { documentId: id, title: d.title, count: decided.length });
  const authors = [...new Set(reviewed.map((r) => r.userId))].filter((a) => a !== u.id);
  await notify(
    authors.map((a) => ({
      userId: a,
      title: `Your tracked changes were ${status}`,
      body: `${u.name} ${status} changes in "${d.title}".`,
      link: `/eru/documents/${id}`,
      key: `review:${id}:${saved.version}:${a}`,
    })),
  );
  return { content, version: saved.version, decided: decided.length };
}

/** Deletes a document, its comments and change records, and its original upload (ERU admins). */
export async function deleteDocument(u: SessionUser, id: string): Promise<{ projectId: string }> {
  if (!can.deleteDocument(u.roles)) throw new EruError("Only an ERU admin can delete a document.");
  const d = await documentRow(id);
  const originals = await db.select({ id: files.id }).from(files).where(eq(files.documentId, id));
  await db.delete(documents).where(eq(documents.id, id));
  await deleteFiles(originals.map((f) => f.id));
  await audit(d.projectId, u.id, "document.delete", { title: d.title });
  return { projectId: d.projectId };
}

// ── Comments ───────────────────────────────────────────────────────────────

/** A new comment on a document. The editor then marks the commented text with its id and saves. */
export async function addComment(u: SessionUser, documentId: string, input: { content: string; from: number; to: number; quote: string }): Promise<{ id: string; createdAt: string }> {
  if (!can.editDocument(u.roles)) throw new EruError("ERU team members only.");
  const d = await documentRow(documentId);
  const content = String(input.content ?? "").replace(/\r\n/g, "\n").trim();
  if (!content) throw new EruError("Write the comment first.");
  if (content.length > 4000) throw new EruError("The comment is too long (4,000 characters at most).");
  const from = Math.max(0, Math.floor(Number(input.from) || 0));
  const to = Math.max(from, Math.floor(Number(input.to) || 0));
  const [c] = await db
    .insert(documentComments)
    .values({ documentId, userId: u.id, content, selectionFrom: from, selectionTo: to, quote: String(input.quote ?? "").slice(0, 500) })
    .returning({ id: documentComments.id, createdAt: documentComments.createdAt });
  await audit(d.projectId, u.id, "comment.add", { documentId, title: d.title });
  if (d.createdBy !== u.id)
    await notify([{ userId: d.createdBy, title: `New comment on "${d.title}"`, body: `${u.name}: ${content.slice(0, 140)}`, link: `/eru/documents/${documentId}`, key: `comment:${c.id}` }]);
  return { id: c.id, createdAt: c.createdAt.toISOString() };
}

async function commentRow(id: string) {
  if (!isUuid(id)) throw new EruError("That comment no longer exists.");
  const [c] = await db.select().from(documentComments).where(eq(documentComments.id, id)).limit(1);
  if (!c) throw new EruError("That comment no longer exists.");
  return c;
}

/** Resolves or reopens a comment: its author or an ERU admin. */
export async function resolveComment(u: SessionUser, id: string, resolved: boolean): Promise<void> {
  const c = await commentRow(id);
  if (c.userId !== u.id && !can.reviewChanges(u.roles)) throw new EruError("Only the comment's author or an ERU admin can resolve it.");
  await db.update(documentComments).set({ resolved, resolvedBy: resolved ? u.id : null, resolvedAt: resolved ? new Date() : null, updatedAt: new Date() }).where(eq(documentComments.id, id));
}

/** Deletes a comment: its author or an ERU admin. The editor removes its mark. */
export async function deleteComment(u: SessionUser, id: string): Promise<void> {
  const c = await commentRow(id);
  if (c.userId !== u.id && !can.reviewChanges(u.roles)) throw new EruError("Only the comment's author or an ERU admin can delete it.");
  await db.delete(documentComments).where(eq(documentComments.id, id));
}
