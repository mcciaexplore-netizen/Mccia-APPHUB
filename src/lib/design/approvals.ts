import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { approvalRequests, attachments, designTypes, proofVersions, tickets, type ApprovalStatus, type Ticket } from "@/db/design-schema";
import { audit } from "./audit";
import { DesignError, type SessionUser } from "./dal";
import { claimFiles, filesByIds, type StoredFile } from "./files";
import { getSettings, typeNames, workingDeadline } from "./config";
import { statusAfterDecision } from "./deliverables";
import { itemStatesOf } from "./deliverables-data";
import { peopleByIds } from "./host-adapter";
import * as notice from "./notify";
import { getTicket, ticketForRequester, ticketForTeam } from "./tickets";
import { changeCutoff, REVIEW_FILE_GRACE_DAYS, REVIEW_TTL_HOURS, revisionTags, versionNumber, baseNumber, LAST_MINUTE_TAG } from "./rules";
import { hashToken, newReviewToken } from "./tokens";

/**
 * Proofs and reviews. A designer uploads a proof (V1, V2 ...) and sends it for review: the requester is emailed a link that works for two
 * days (only its hash is stored) and can also decide from My Requests. Approving delivers the ticket and opens its edit window; asking for
 * changes closes this version as superseded and opens the next one (DF-0001-V2) for the same designer. If nobody answers in two days the
 * scheduled jobs close the ticket without approval.
 *
 * Per-item tickets (tickets.per_item, see deliverables.ts) work item by item instead: each proof is for one deliverable, and its review
 * link only stands for that one. Approving an item leaves the ticket open until every item is approved (then it is Delivered, and the
 * requester closes it); asking for changes on an item sends that item back to the designer on the same ticket, with no new version, so the
 * items already approved stay approved.
 */

export type ProofDto = {
  id: string;
  version: number;
  /** The deliverable it is for (per-item tickets), else null. */
  itemKey: string | null;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
  file: { id: string; fileName: string; mime: string; size: number };
  requests: { id: string; status: ApprovalStatus; expiresAt: string; decidedAt: string | null; decidedByName: string | null; comment: string | null; createdAt: string; emailedTo: string | null }[];
};

const effective = (r: { status: ApprovalStatus; expiresAt: Date }): ApprovalStatus => (r.status === "pending" && +r.expiresAt < Date.now() ? "expired" : r.status);

export async function proofsFor(ticketId: string): Promise<ProofDto[]> {
  const [proofs, reqs] = await Promise.all([
    db.select().from(proofVersions).where(eq(proofVersions.ticketId, ticketId)).orderBy(desc(proofVersions.version)),
    db.select().from(approvalRequests).where(eq(approvalRequests.ticketId, ticketId)).orderBy(desc(approvalRequests.createdAt)),
  ]);
  const [fs, people] = await Promise.all([filesByIds(proofs.map((p) => p.fileId)), peopleByIds(proofs.map((p) => p.createdBy))]);
  return proofs
    .filter((p) => fs.has(p.fileId))
    .map((p) => {
      const f = fs.get(p.fileId)!;
      return {
        id: p.id,
        version: p.version,
        itemKey: p.itemKey,
        note: p.note,
        createdAt: p.createdAt.toISOString(),
        createdBy: people.get(p.createdBy)?.name ?? null,
        file: { id: f.id, fileName: f.fileName, mime: f.mime, size: f.size },
        requests: reqs
          .filter((r) => r.proofVersionId === p.id)
          .map((r) => ({
            id: r.id,
            status: effective(r),
            expiresAt: r.expiresAt.toISOString(),
            decidedAt: r.decidedAt?.toISOString() ?? null,
            decidedByName: r.decidedByName,
            comment: r.decisionComment,
            createdAt: r.createdAt.toISOString(),
            emailedTo: r.recipientEmail,
          })),
      };
    });
}

/** Puts a proof in front of the requester: withdraws any open link, makes a new one, moves the ticket to In review and emails them. */
async function openReview(u: SessionUser, t: Ticket, proof: { id: string; version: number; itemKey: string | null }): Promise<{ link: string; emailedTo: string | null }> {
  // On a per-item ticket only this item's open link is withdrawn: the other items' reviews carry on.
  const open = await db
    .select({ id: approvalRequests.id, itemKey: proofVersions.itemKey })
    .from(approvalRequests)
    .innerJoin(proofVersions, eq(proofVersions.id, approvalRequests.proofVersionId))
    .where(and(eq(approvalRequests.ticketId, t.id), eq(approvalRequests.status, "pending")));
  const withdraw = open.filter((r) => !t.perItem || r.itemKey === proof.itemKey).map((r) => r.id);
  if (withdraw.length) await db.update(approvalRequests).set({ status: "revoked" }).where(and(inArray(approvalRequests.id, withdraw), eq(approvalRequests.status, "pending")));
  const token = newReviewToken();
  const [req] = await db
    .insert(approvalRequests)
    .values({ ticketId: t.id, proofVersionId: proof.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + REVIEW_TTL_HOURS * 3_600_000), createdBy: u.id })
    .returning({ id: approvalRequests.id });
  if (t.status !== "in_review" && t.status !== "delivered") await db.update(tickets).set({ status: "in_review", updatedAt: new Date() }).where(eq(tickets.id, t.id));
  const link = notice.reviewUrl(token);
  const item = proof.itemKey ? ((await typeNames()).get(proof.itemKey) ?? proof.itemKey) : null;
  await audit(t.id, u.id, "Sent for review", { proof_version: proof.version, ...(item ? { item } : {}) });
  const emailedTo = await notice.proofSent(t, proof.version, link, item);
  if (emailedTo) await db.update(approvalRequests).set({ recipientEmail: emailedTo }).where(eq(approvalRequests.id, req.id));
  return { link, emailedTo };
}

export async function addProof(u: SessionUser, ticketId: string, fileId: string, note: string, send: boolean, itemKey: string | null = null): Promise<{ version: number; link: string | null; emailedTo: string | null }> {
  const t = await ticketForTeam(u, ticketId);
  if (t.isLocked) throw new DesignError("This version is closed. Upload the design on the newest version of the request.");
  if (t.status === "pending_review" || t.status === "declined") throw new DesignError("Accept the request first.");
  if (t.perItem) {
    if (!itemKey || !t.requirements.includes(itemKey)) throw new DesignError("Choose which design this proof is for.");
    if ((await itemStatesOf(t)).get(itemKey) === "approved") throw new DesignError("That design is already approved.");
  } else itemKey = null;
  const [f] = await claimFiles(u.id, [fileId], "proof");
  const [last] = await db.select({ v: proofVersions.version }).from(proofVersions).where(eq(proofVersions.ticketId, ticketId)).orderBy(desc(proofVersions.version)).limit(1);
  const version = (last?.v ?? 0) + 1;
  const [proof] = await db.insert(proofVersions).values({ ticketId, version, fileId: f.id, itemKey, note: note.trim().slice(0, 1000) || null, createdBy: u.id }).returning();
  await audit(ticketId, u.id, "Uploaded proof", { version, file_name: f.fileName, ...(itemKey ? { item: (await typeNames()).get(itemKey) ?? itemKey } : {}) });
  if (!send) return { version, link: null, emailedTo: null };
  const r = await openReview(u, t, proof);
  return { version, ...r };
}

export async function sendForReview(u: SessionUser, proofId: string): Promise<{ link: string; emailedTo: string | null }> {
  const [p] = await db.select().from(proofVersions).where(eq(proofVersions.id, proofId)).limit(1);
  if (!p) throw new DesignError("That proof was not found.");
  const t = await ticketForTeam(u, p.ticketId);
  if (t.isLocked) throw new DesignError("This version is closed.");
  if (t.perItem && p.itemKey && (await itemStatesOf(t)).get(p.itemKey) === "approved") throw new DesignError("That design is already approved.");
  return openReview(u, t, p);
}

export async function revokeReview(u: SessionUser, requestId: string): Promise<void> {
  const [r] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, requestId)).limit(1);
  if (!r) throw new DesignError("That review link was not found.");
  await ticketForTeam(u, r.ticketId);
  const [done] = await db.update(approvalRequests).set({ status: "revoked" }).where(and(eq(approvalRequests.id, requestId), eq(approvalRequests.status, "pending"))).returning({ id: approvalRequests.id });
  if (!done) throw new DesignError("That link is no longer open.");
  await audit(r.ticketId, u.id, "Withdrew review link", {});
}

// ── Decisions ────────────────────────────────────────────────────────────────

/** Closes `parent` as superseded and opens the next version for whoever made its last proof (else its designer). */
async function openNextVersion(parent: Ticket, reason: string): Promise<Ticket> {
  const [lastProof] = await db.select({ by: proofVersions.createdBy }).from(proofVersions).where(eq(proofVersions.ticketId, parent.id)).orderBy(desc(proofVersions.version)).limit(1);
  const assigneeId = lastProof?.by ?? parent.assigneeId;
  const version = parent.versionNumber + 1;
  const s = await getSettings();
  const tags = revisionTags(parent.tags, version, s.maxFreeRevisions, parent.dueAt);
  const [type] = await db.select({ sla: designTypes.slaHours }).from(designTypes).where(eq(designTypes.id, parent.designTypeId)).limit(1);
  const dueAt = await workingDeadline(type?.sla ?? 24, parent.priority);
  const [child] = await db
    .insert(tickets)
    .values({
      number: versionNumber(baseNumber(parent.number), version),
      title: parent.title,
      brief: parent.brief,
      designTypeId: parent.designTypeId,
      requirements: parent.requirements,
      details: parent.details,
      eventName: parent.eventName,
      eventDate: parent.eventDate,
      deliveryDate: parent.deliveryDate,
      department: parent.department,
      referenceLinks: parent.referenceLinks,
      clientChanges: parent.clientChanges,
      tags,
      priority: parent.priority,
      status: assigneeId ? "assigned" : "new",
      requesterId: parent.requesterId,
      assigneeId,
      figmaUrl: parent.figmaUrl,
      dueAt,
      parentId: parent.id,
      versionNumber: version,
      reasonForChange: reason,
      estimateHours: parent.estimateHours,
    })
    .returning();
  // The requester's original files travel with the request (the same stored file, no copy).
  const atts = await db.select().from(attachments).where(eq(attachments.ticketId, parent.id));
  if (atts.length) await db.insert(attachments).values(atts.map((a) => ({ ticketId: child.id, fileId: a.fileId, uploadedBy: a.uploadedBy })));
  await db.update(tickets).set({ status: "superseded", isLocked: true, editWindowEndsAt: null, updatedAt: new Date() }).where(eq(tickets.id, parent.id));
  await audit(parent.id, null, "Superseded", { new_version: child.number, reason }, "System");
  await audit(child.id, null, "Created", { revision_of: parent.number, reason }, "System");
  if (tags.includes(LAST_MINUTE_TAG)) await notice.lastMinute(child);
  return child;
}

type Decision = { decision: "approve" | "request_changes"; comment?: string };

/** Records the requester's decision, once: a double click or a second tab cannot record two. */
async function applyDecision(reqId: string, body: Decision, by: { name: string; userId: string | null; via: string }): Promise<{ status: "approved" | "changes_requested"; newNumber: string | null }> {
  const [req] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, reqId)).limit(1);
  if (!req) throw new DesignError("This review link is not valid.");
  const state = effective(req);
  if (state !== "pending") {
    throw new DesignError(
      { approved: "This design was already approved.", changes_requested: "Changes were already requested.", revoked: "This review link was withdrawn.", expired: "This review has closed. Ask the design team for a new one." }[state] ?? "Already decided.",
    );
  }
  const comment = (body.comment ?? "").trim().slice(0, 2000);
  if (body.decision === "request_changes" && !comment) throw new DesignError("Please describe what needs to change.");
  const t = await getTicket(req.ticketId);
  if (!t || t.isLocked || (t.status !== "in_review" && t.status !== "delivered")) throw new DesignError("This design is no longer waiting for your review.");
  if (body.decision === "request_changes") {
    const cut = changeCutoff(t);
    if (cut && Date.now() >= +cut) throw new DesignError(`Changes can't be requested within 12 hours of the event. Please contact the design team directly.`);
  }
  const status = body.decision === "approve" ? "approved" : "changes_requested";
  const [claimed] = await db
    .update(approvalRequests)
    .set({ status, decidedAt: new Date(), decidedByName: by.name, decisionComment: comment || null })
    .where(and(eq(approvalRequests.id, req.id), eq(approvalRequests.status, "pending")))
    .returning({ id: approvalRequests.id });
  if (!claimed) throw new DesignError("A decision has already been recorded.");
  const [proof] = await db.select({ version: proofVersions.version, itemKey: proofVersions.itemKey }).from(proofVersions).where(eq(proofVersions.id, req.proofVersionId)).limit(1);
  if (t.perItem) return decideItem(t, status, comment, proof ?? null, by);
  let child: Ticket | null = null;
  if (status === "approved") {
    const s = await getSettings();
    const [type] = await db.select({ w: designTypes.editWindowHours }).from(designTypes).where(eq(designTypes.id, t.designTypeId)).limit(1);
    const now = new Date();
    await db
      .update(tickets)
      .set({ status: "delivered", deliveredAt: t.deliveredAt ?? now, editWindowEndsAt: t.editWindowEndsAt ?? new Date(+now + (type?.w ?? s.editWindowHours) * 3_600_000), updatedAt: now })
      .where(eq(tickets.id, t.id));
  } else child = await openNextVersion(t, comment);
  await audit(t.id, by.userId, status === "approved" ? "Requester approved" : "Requester asked for changes", { proof_version: proof?.version ?? null, comment: comment || null }, `${by.name} (${by.via})`);
  await notice.decided(t, status === "approved", by.name, child);
  if (child?.assigneeId) await notice.assigned(child, null);
  return { status, newNumber: child?.number ?? null };
}

/**
 * A decision on one item of a per-item ticket (the link is already marked decided). The ticket moves on from the items' states: Delivered
 * once all are approved, In review while another item waits, else back to In progress. A change request is noted in the ticket's
 * "Changes from the requester" for the designer, and tagged as an extra revision past the free allowance for that item.
 */
async function decideItem(
  t: Ticket,
  status: "approved" | "changes_requested",
  comment: string,
  proof: { version: number; itemKey: string | null } | null,
  by: { name: string; userId: string | null; via: string },
): Promise<{ status: "approved" | "changes_requested"; newNumber: string | null }> {
  const key = proof?.itemKey ?? "";
  const item = (await typeNames()).get(key) ?? (key || "Design");
  const states = await itemStatesOf(t);
  const next = statusAfterDecision(states);
  const now = new Date();
  const patch: Partial<Ticket> = { updatedAt: now };
  if (next !== t.status) patch.status = next;
  if (next === "delivered") patch.deliveredAt = t.deliveredAt ?? now;
  if (status === "changes_requested") {
    const s = await getSettings();
    const asked = await db
      .select({ id: approvalRequests.id })
      .from(approvalRequests)
      .innerJoin(proofVersions, eq(proofVersions.id, approvalRequests.proofVersionId))
      .where(and(eq(approvalRequests.ticketId, t.id), eq(approvalRequests.status, "changes_requested"), eq(proofVersions.itemKey, key)));
    const added = revisionTags([], asked.length + 1, s.maxFreeRevisions, t.dueAt).filter((x) => !t.tags.includes(x));
    if (added.length) patch.tags = [...t.tags, ...added];
    patch.clientChanges = [...t.clientChanges, { text: `${item}: ${comment}`, at: now.toISOString(), by: by.name }];
  }
  const [done] = await db.update(tickets).set(patch).where(eq(tickets.id, t.id)).returning();
  await audit(t.id, by.userId, status === "approved" ? "Requester approved" : "Requester asked for changes", { item, proof_version: proof?.version ?? null, comment: comment || null }, `${by.name} (${by.via})`);
  if (next === "delivered" && t.status !== "delivered") await audit(t.id, null, "All designs approved", { items: states.size }, "System");
  await notice.decided(done ?? t, status === "approved", by.name, null, item);
  if (patch.tags?.includes(LAST_MINUTE_TAG)) await notice.lastMinute(done ?? t);
  return { status, newNumber: null };
}

/** The requester closes a per-item ticket once every design on it is approved. */
export async function closeAsRequester(u: SessionUser, ticketId: string): Promise<void> {
  const t = await ticketForRequester(u, ticketId);
  if (!t.perItem) throw new DesignError("This request closes by itself.");
  const states = await itemStatesOf(t);
  if (t.status !== "delivered" || ![...states.values()].every((s) => s === "approved")) throw new DesignError("Every design must be approved before you can close the request.");
  const [done] = await db
    .update(tickets)
    .set({ status: "closed", isLocked: true, editWindowEndsAt: null, updatedAt: new Date() })
    .where(and(eq(tickets.id, t.id), eq(tickets.status, "delivered")))
    .returning({ id: tickets.id });
  if (!done) throw new DesignError("This request has already been closed.");
  await audit(t.id, u.id, "Closed by requester", {}, `${u.name} (App Hub)`);
}

/** The public review page's data, or null when the link is not one of ours. */
export async function reviewByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const [req] = await db.select().from(approvalRequests).where(eq(approvalRequests.tokenHash, hashToken(token))).limit(1);
  if (!req) return null;
  const [t] = await db.select().from(tickets).where(eq(tickets.id, req.ticketId)).limit(1);
  const [proof] = await db.select().from(proofVersions).where(eq(proofVersions.id, req.proofVersionId)).limit(1);
  if (!t || !proof) return null;
  const f = (await filesByIds([proof.fileId])).get(proof.fileId) ?? null;
  const item = proof.itemKey ? ((await typeNames()).get(proof.itemKey) ?? proof.itemKey) : null;
  return {
    requestId: req.id,
    status: effective(req),
    expiresAt: req.expiresAt.toISOString(),
    decidedAt: req.decidedAt?.toISOString() ?? null,
    comment: req.decisionComment,
    ticket: { number: t.number, title: t.title, requesterId: t.requesterId },
    // The designer's note on a proof is for the team; the requester sees only the design.
    proof: { version: proof.version, fileName: f?.fileName ?? null, mime: f?.mime ?? null, item },
    file: f,
    fileAllowed: fileAllowed(req),
  };
}

function fileAllowed(req: { status: ApprovalStatus; expiresAt: Date; decidedAt: Date | null }): boolean {
  const now = Date.now();
  if (req.status === "pending") return +req.expiresAt > now;
  if ((req.status === "approved" || req.status === "changes_requested") && req.decidedAt) return +req.decidedAt + REVIEW_FILE_GRACE_DAYS * 86_400_000 > now;
  return false;
}

export async function reviewFileByToken(token: string): Promise<StoredFile | null> {
  const r = await reviewByToken(token);
  return r && r.fileAllowed ? r.file : null;
}

export async function decideByToken(token: string, body: Decision) {
  const r = await reviewByToken(token);
  if (!r) throw new DesignError("This review link is not valid.");
  const who = (await peopleByIds([r.ticket.requesterId])).get(r.ticket.requesterId);
  return applyDecision(r.requestId, body, { name: who?.name ?? "The requester", userId: null, via: "review link" });
}

/** The requester deciding from My Requests while signed in. */
export async function decideAsRequester(u: SessionUser, ticketId: string, body: Decision, itemKey: string | null = null) {
  const t = await ticketForRequester(u, ticketId);
  const open = await db
    .select({ id: approvalRequests.id, itemKey: proofVersions.itemKey })
    .from(approvalRequests)
    .innerJoin(proofVersions, eq(proofVersions.id, approvalRequests.proofVersionId))
    .where(and(eq(approvalRequests.ticketId, t.id), eq(approvalRequests.status, "pending")))
    .orderBy(desc(approvalRequests.createdAt));
  // A per-item ticket can have several designs waiting at once: the decision is for the one named.
  const req = t.perItem ? open.find((r) => r.itemKey === itemKey) : open[0];
  if (!req) throw new DesignError("This design is not waiting for your review.");
  return applyDecision(req.id, body, { name: u.name, userId: u.id, via: "App Hub" });
}

/** For My Requests: per ticket, the proof waiting for the requester (if any) and the newest approved proof. */
export async function requesterProofs(ticketIds: string[]): Promise<Map<string, { pending: { proofId: string; version: number; fileId: string; expiresAt: string } | null; approved: { proofId: string; version: number; fileId: string } | null }>> {
  const out = new Map<string, { pending: { proofId: string; version: number; fileId: string; expiresAt: string } | null; approved: { proofId: string; version: number; fileId: string } | null }>();
  if (!ticketIds.length) return out;
  const reqs = await db.select().from(approvalRequests).where(inArray(approvalRequests.ticketId, ticketIds)).orderBy(asc(approvalRequests.createdAt));
  const proofs = await db.select().from(proofVersions).where(inArray(proofVersions.ticketId, ticketIds));
  const byId = new Map(proofs.map((p) => [p.id, p]));
  for (const id of ticketIds) out.set(id, { pending: null, approved: null });
  for (const r of reqs) {
    const p = byId.get(r.proofVersionId);
    if (!p) continue;
    const slot = out.get(r.ticketId)!;
    if (effective(r) === "pending") slot.pending = { proofId: p.id, version: p.version, fileId: p.fileId, expiresAt: r.expiresAt.toISOString() };
    if (r.status === "approved") slot.approved = { proofId: p.id, version: p.version, fileId: p.fileId };
  }
  return out;
}

