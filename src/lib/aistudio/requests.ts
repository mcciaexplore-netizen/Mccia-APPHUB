import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, rowsOf } from "./db";
import { attachments, files, notes, requests, settings, type Priority, type Request, type RequestStatus } from "@/db/aistudio-schema";
import { PRIORITIES, STATUS_LABEL, canMove, checkRequest, formatRequestNumber, type RequestInput } from "./aistudio.manifest";
import { audit } from "./audit";
import { AiStudioError, type SessionUser } from "./dal";
import { claimFiles, deleteFiles, releaseFiles } from "./files";
import { listTeam } from "./host-adapter";
import * as notice from "./notify";

/**
 * Requests: making them from the form, who may see and change them, the Pending Review decisions, moving them along, notes and
 * deliverables, and deleting. The production driver has no transactions: each write is one statement, ordered so a half-done step is
 * harmless (files are claimed before the request that uses them, and given back if it cannot be saved).
 */

const UUID = /^[0-9a-f-]{36}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function getRequest(id: string): Promise<Request | null> {
  if (!UUID.test(id)) return null;
  const [r] = await db.select().from(requests).where(eq(requests.id, id)).limit(1);
  return r ?? null;
}

/** The person's own request, or "not found" (so ids of other people's requests cannot be probed). */
export async function requestForRequester(u: SessionUser, id: string): Promise<Request> {
  const r = await getRequest(id);
  if (!r || r.requesterId !== u.id) throw new AiStudioError("That request was not found.");
  return r;
}

/** Any request, for the AI Studio team. */
export async function requestForTeam(u: SessionUser, id: string): Promise<Request> {
  const r = await getRequest(id);
  if (!r || !u.member) throw new AiStudioError("That request was not found.");
  return r;
}

async function nextNumber(): Promise<string> {
  const [row] = rowsOf<{ n: string | number }>(await db.execute(sql`select nextval('aistudio_request_seq') as n`));
  return formatRequestNumber(Number(row.n));
}

/** The request form: one request, waiting in Pending Review for a lead. Its files are claimed first, all or none. */
export async function createRequest(u: SessionUser, input: RequestInput): Promise<{ id: string; number: string }> {
  const checked = checkRequest(input);
  if (!checked.ok) throw new AiStudioError(checked.error);
  const v = checked.value;
  const claimed = await claimFiles(u.id, v.fileIds, "attachment");
  try {
    const [r] = await db
      .insert(requests)
      .values({
        number: await nextNumber(),
        title: v.title,
        description: v.description,
        requestType: v.requestType,
        department: v.department ?? u.department,
        requesterId: u.id,
        referenceLinks: v.referenceLinks,
        content: v.content,
      })
      .returning();
    if (claimed.length) await db.insert(attachments).values(claimed.map((f) => ({ requestId: r.id, fileId: f.id, uploadedBy: u.id })));
    await audit(r.id, u.id, "Submitted", { type: v.requestType, files: claimed.length });
    await notice.newRequest(r, u.name);
    return { id: r.id, number: r.number };
  } catch (e) {
    await releaseFiles(claimed.map((f) => f.id));
    throw e;
  }
}

async function checkAssignee(id: string | null): Promise<void> {
  if (id && !(await listTeam()).some((p) => p.id === id)) throw new AiStudioError("Choose someone on the AI Studio team.");
}
const checkDeadline = (d: string | null) => {
  if (d && !DAY.test(d)) throw new AiStudioError("Choose a valid deadline.");
};
const checkPriority = (p: string | null) => {
  if (p && !PRIORITIES.includes(p as Priority)) throw new AiStudioError("Choose a priority.");
};

/** A lead accepts a pending request: who works on it, by when, how urgent, and an optional note the requester sees. */
export async function acceptRequest(u: SessionUser, id: string, p: { assigneeId: string | null; deadline: string | null; priority: Priority | null; note?: string }): Promise<void> {
  if (!u.lead) throw new AiStudioError("Only an AI Studio lead can accept requests.");
  await checkAssignee(p.assigneeId);
  checkDeadline(p.deadline);
  checkPriority(p.priority);
  const [done] = await db
    .update(requests)
    .set({ status: "accepted", assigneeId: p.assigneeId, deadline: p.deadline, priority: p.priority, updatedAt: new Date() })
    .where(and(eq(requests.id, id), eq(requests.status, "pending_review")))
    .returning();
  if (!done) throw new AiStudioError("This request has already been reviewed.");
  await audit(id, u.id, "Accepted", { assignee: p.assigneeId, deadline: p.deadline, priority: p.priority });
  const note = p.note?.trim();
  if (note) await db.insert(notes).values({ requestId: id, userId: u.id, body: note.slice(0, 5000), isInternal: false });
  await notice.accepted(done);
  if (note) await notice.noteShared(done, note);
  await notice.assigned(done, p.assigneeId, u.name);
}

/** A lead declines a pending request, with the reason the requester is told. */
export async function declineRequest(u: SessionUser, id: string, reason: string): Promise<void> {
  if (!u.lead) throw new AiStudioError("Only an AI Studio lead can decline requests.");
  const why = reason.trim().slice(0, 1000);
  if (!why) throw new AiStudioError("Give the reason (the requester is told).");
  const [done] = await db
    .update(requests)
    .set({ status: "declined", declineReason: why, updatedAt: new Date() })
    .where(and(eq(requests.id, id), eq(requests.status, "pending_review")))
    .returning();
  if (!done) throw new AiStudioError("This request has already been reviewed.");
  await audit(id, u.id, "Declined", { reason: why });
  await notice.declined(done, why);
}

export type RequestPatch = { status?: RequestStatus; assigneeId?: string | null; deadline?: string | null; priority?: Priority | null };

async function hasDeliverable(id: string): Promise<boolean> {
  const [x] = await db
    .select({ id: attachments.id })
    .from(attachments)
    .innerJoin(files, eq(files.id, attachments.fileId))
    .where(and(eq(attachments.requestId, id), eq(files.purpose, "deliverable")))
    .limit(1);
  return !!x;
}

/**
 * The team moves a request along and sets its deadline and priority; only a lead assigns it (see canMove for who may move it where).
 * Delivering needs at least one deliverable.
 */
export async function updateRequest(u: SessionUser, id: string, p: RequestPatch): Promise<Request> {
  const r = await requestForTeam(u, id);
  if ("assigneeId" in p && p.assigneeId !== r.assigneeId) {
    if (!u.lead) throw new AiStudioError("Only an AI Studio lead can assign a request.");
    await checkAssignee(p.assigneeId ?? null);
  }
  if ("deadline" in p) checkDeadline(p.deadline ?? null);
  if ("priority" in p) checkPriority(p.priority ?? null);
  if (p.status && p.status !== r.status) {
    if (!canMove(u.lead ? "lead" : "member", r.status, p.status)) throw new AiStudioError(`A request that is ${STATUS_LABEL[r.status].toLowerCase()} cannot be moved to ${STATUS_LABEL[p.status].toLowerCase()} here.`);
    if (p.status === "delivered" && !(await hasDeliverable(id))) throw new AiStudioError("Upload at least one deliverable before marking it delivered.");
  }
  const set: Partial<Request> = { updatedAt: new Date() };
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const note = <K extends keyof RequestPatch>(k: K, col: keyof Request) => {
    if (k in p && p[k] !== r[col]) {
      (set as Record<string, unknown>)[col] = p[k] ?? null;
      changes[k] = { from: r[col], to: p[k] ?? null };
    }
  };
  note("status", "status");
  note("assigneeId", "assigneeId");
  note("deadline", "deadline");
  note("priority", "priority");
  if (!Object.keys(changes).length) return r;
  // Only from the state that was read, so two people changing it at once cannot both win.
  const [done] = await db.update(requests).set(set).where(and(eq(requests.id, id), eq(requests.status, r.status))).returning();
  if (!done) throw new AiStudioError("Someone else changed this request just now. Reload the page and try again.");
  await audit(id, u.id, "Updated", changes);
  if (changes.status?.to === "in_progress") await notice.inProgress(done);
  if (changes.status?.to === "delivered") await notice.delivered(done);
  if (changes.assigneeId) await notice.assigned(done, done.assigneeId, u.name);
  return done;
}

/** A note: internal (the team only) or shared with the requester, who is then told. */
export async function addNote(u: SessionUser, id: string, body: string, internal: boolean): Promise<void> {
  const r = await requestForTeam(u, id);
  const text = body.trim().slice(0, 5000);
  if (!text) throw new AiStudioError("Write the note first.");
  await db.insert(notes).values({ requestId: id, userId: u.id, body: text, isInternal: internal });
  await audit(id, u.id, internal ? "Internal note added" : "Note shared with the requester", {});
  if (!internal) await notice.noteShared(r, text);
}

/** Files the team made for the requester (up to 50 MB each). They see them once the request is delivered. */
export async function addDeliverables(u: SessionUser, id: string, fileIds: string[]): Promise<void> {
  const r = await requestForTeam(u, id);
  if (r.status === "pending_review" || r.status === "declined") throw new AiStudioError("Accept the request first.");
  const claimed = await claimFiles(u.id, fileIds.slice(0, 10), "deliverable");
  if (!claimed.length) throw new AiStudioError("Choose a file to upload.");
  await db.insert(attachments).values(claimed.map((f) => ({ requestId: id, fileId: f.id, uploadedBy: u.id })));
  await audit(id, u.id, "Deliverable uploaded", { files: claimed.map((f) => f.fileName) });
}

/** Removes a deliverable (its uploader or a lead), while the request is not yet delivered. */
export async function removeDeliverable(u: SessionUser, attachmentId: string): Promise<void> {
  if (!UUID.test(attachmentId)) throw new AiStudioError("That file was not found.");
  const [a] = await db
    .select({ id: attachments.id, requestId: attachments.requestId, fileId: attachments.fileId, uploadedBy: attachments.uploadedBy, purpose: files.purpose, name: files.fileName })
    .from(attachments)
    .innerJoin(files, eq(files.id, attachments.fileId))
    .where(eq(attachments.id, attachmentId))
    .limit(1);
  if (!a || a.purpose !== "deliverable") throw new AiStudioError("That file was not found.");
  const r = await requestForTeam(u, a.requestId);
  if (!u.lead && a.uploadedBy !== u.id) throw new AiStudioError("Only the person who uploaded it, or a lead, can remove it.");
  if (r.status === "delivered" || r.status === "closed") throw new AiStudioError("It has been delivered: the requester may already have it.");
  await db.delete(attachments).where(eq(attachments.id, attachmentId));
  await deleteFiles([a.fileId]);
  await audit(r.id, u.id, "Deliverable removed", { file_name: a.name });
}

/** "Mark as Delivered": needs a deliverable; the delivery note (optional) is kept and the requester is told. */
export async function markDelivered(u: SessionUser, id: string, deliveryNotes: string): Promise<void> {
  const r = await requestForTeam(u, id);
  if (!canMove(u.lead ? "lead" : "member", r.status, "delivered")) throw new AiStudioError(`A request that is ${STATUS_LABEL[r.status].toLowerCase()} cannot be delivered.`);
  if (!(await hasDeliverable(id))) throw new AiStudioError("Upload at least one deliverable before marking it delivered.");
  const notesText = deliveryNotes.trim().slice(0, 5000) || null;
  const [done] = await db
    .update(requests)
    .set({ status: "delivered", deliveryNotes: notesText, updatedAt: new Date() })
    .where(and(eq(requests.id, id), eq(requests.status, r.status)))
    .returning();
  if (!done) throw new AiStudioError("Someone else changed this request just now. Reload the page and try again.");
  await audit(id, u.id, "Updated", { status: { from: r.status, to: "delivered" }, ...(notesText ? { delivery_notes: notesText.slice(0, 300) } : {}) });
  await notice.delivered(done);
}

/** Deletes requests with their notes, history, files and the stored objects (leads; "delete all" for the Support Admin). */
async function deleteRequestsAndFiles(ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const fileIds = (await db.select({ fileId: attachments.fileId }).from(attachments).where(inArray(attachments.requestId, ids))).map((a) => a.fileId);
  await db.delete(requests).where(inArray(requests.id, ids)); // attachments, notes and history go with it (on delete cascade)
  await deleteFiles(fileIds);
  return ids.length;
}

export async function deleteRequest(u: SessionUser, id: string): Promise<void> {
  if (!u.lead) throw new AiStudioError("Only an AI Studio lead can delete a request.");
  const r = await getRequest(id);
  if (!r) throw new AiStudioError("That request was not found.");
  await deleteRequestsAndFiles([id]);
}

/** Settings → "Delete all data" (the Support Admin): every request and every stored file. Numbering carries on. */
export async function deleteAllData(u: SessionUser, confirm: string): Promise<{ requests: number }> {
  if (!u.superAdmin) throw new AiStudioError("The Support Admin only.");
  if (confirm.trim() !== "DELETE") throw new AiStudioError("Type DELETE to confirm.");
  const all = (await db.select({ id: requests.id }).from(requests)).map((r) => r.id);
  let n = 0;
  for (let i = 0; i < all.length; i += 200) n += await deleteRequestsAndFiles(all.slice(i, i + 200));
  const rest = (await db.select({ id: files.id }).from(files)).map((f) => f.id);
  for (let i = 0; i < rest.length; i += 200) await deleteFiles(rest.slice(i, i + 200));
  return { requests: n };
}

/** Settings → Slack: the webhook (or none). Only Slack's own incoming-webhook addresses are accepted. */
export async function saveSlack(u: SessionUser, webhook: string): Promise<void> {
  if (!u.lead) throw new AiStudioError("Only an AI Studio lead can change Settings.");
  const hook = webhook.trim();
  if (hook && !/^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/.test(hook)) throw new AiStudioError("That is not a Slack incoming-webhook address (https://hooks.slack.com/services/...).");
  await db
    .insert(settings)
    .values({ id: 1, slackWebhook: hook || null })
    .onConflictDoUpdate({ target: settings.id, set: { slackWebhook: hook || null, updatedAt: new Date() } });
}

/**
 * Who may open a stored file: the AI Studio team, any file on a request; the requester, their own request's attachments, and its
 * deliverables once it is delivered (or closed).
 */
export async function canOpenFile(u: SessionUser, fileId: string): Promise<boolean> {
  if (!UUID.test(fileId)) return false;
  const [row] = await db
    .select({ purpose: files.purpose, requesterId: requests.requesterId, status: requests.status })
    .from(attachments)
    .innerJoin(files, eq(files.id, attachments.fileId))
    .innerJoin(requests, eq(requests.id, attachments.requestId))
    .where(eq(attachments.fileId, fileId))
    .limit(1);
  if (!row) return false;
  if (u.member) return true;
  if (row.requesterId !== u.id) return false;
  return row.purpose === "attachment" || row.status === "delivered" || row.status === "closed";
}
