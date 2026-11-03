import "server-only";
import { and, asc, desc, eq, ilike, inArray, isNull, notInArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "./db";
import {
  approvalRequests,
  attachments,
  auditLogs,
  cdrDownloads,
  cdrRequests,
  designTypes,
  leaves,
  pinpoints,
  profiles,
  proofVersions,
  subtasks,
  tickets,
  timeEntries,
  libraryItems,
  type Priority,
  type Ticket,
  type TicketStatus,
} from "@/db/design-schema";
import { audit } from "./audit";
import { DesignError, type SessionUser } from "./dal";
import { claimFiles, deleteFiles, releaseFiles } from "./files";
import { answerLines, checkRequest, ticketTitle, type RequestInput } from "./form";
import { formTypes, getHolidays, getSchedule, getSettings, nextTicketSeq, typeNames, workingDeadline } from "./config";
import { isAssignable, listDesigners, peopleByIds } from "./host-adapter";
import * as notice from "./notify";
import { remainingHours, suggestAssignee, workingDays, HORIZON_DAYS, type CapDesigner, type CapTicket } from "./capacity";
import { ACTIVE_STATUSES, FINISHED_STATUSES, OFF_BOARD_STATUSES, PRIORITIES, deliveryDueAt, formatTicketNumber, istDate, priorityFor, STATUS_LABEL } from "./rules";

/**
 * Tickets: making them from the request form, who may see and change them, the Pending Review decisions, moving them along, and the small
 * pieces on a ticket (subtasks, client changes, files). Proofs and reviews are in approvals.ts.
 */

// ── What the pages get ──────────────────────────────────────────────────────

export type TicketCard = {
  id: string;
  number: string;
  title: string;
  status: TicketStatus;
  priority: Priority;
  dueAt: string | null;
  isOverdue: boolean;
  assigneeId: string | null;
  assigneeName: string | null;
  requesterId: string;
  requesterName: string | null;
  department: string | null;
  designs: string[];
  tags: string[];
  versionNumber: number;
  deliveryDate: string | null;
  eventDate: string | null;
  createdAt: string;
  updatedAt: string;
  deliveredAt: string | null;
  isLocked: boolean;
};

export type TicketFilter = {
  assigneeId?: string;
  requesterId?: string;
  statuses?: TicketStatus[];
  excludeStatuses?: TicketStatus[];
  search?: string;
  priority?: Priority;
  typeKey?: string;
  department?: string;
  overdue?: boolean;
  unassigned?: boolean;
  limit?: number;
};

export async function listTickets(f: TicketFilter = {}): Promise<TicketCard[]> {
  const where: SQL[] = [];
  if (f.assigneeId) where.push(eq(tickets.assigneeId, f.assigneeId));
  if (f.unassigned) where.push(isNull(tickets.assigneeId));
  if (f.requesterId) where.push(eq(tickets.requesterId, f.requesterId));
  if (f.statuses?.length) where.push(inArray(tickets.status, f.statuses));
  if (f.excludeStatuses?.length) where.push(notInArray(tickets.status, f.excludeStatuses));
  if (f.priority) where.push(eq(tickets.priority, f.priority));
  if (f.typeKey) where.push(sql`${tickets.requirements} ? ${f.typeKey}`);
  if (f.department) where.push(eq(tickets.department, f.department));
  if (f.overdue) where.push(sql`${tickets.dueAt} < now() and ${tickets.status} in ('new','assigned','in_progress','waiting_on_requester','in_review')`);
  if (f.search?.trim()) {
    const like = `%${f.search.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(or(ilike(tickets.number, like), ilike(tickets.title, like), ilike(tickets.department, like))!);
  }
  const rows = await db
    .select()
    .from(tickets)
    .where(where.length ? and(...where) : undefined)
    .orderBy(sql`${tickets.dueAt} asc nulls last`, desc(tickets.createdAt))
    .limit(f.limit ?? 1000);
  return toCards(rows);
}

export async function toCards(rows: Ticket[]): Promise<TicketCard[]> {
  const [people, names] = await Promise.all([peopleByIds(rows.flatMap((r) => [r.assigneeId, r.requesterId])), typeNames()]);
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    title: r.title,
    status: r.status,
    priority: r.priority,
    dueAt: r.dueAt?.toISOString() ?? null,
    isOverdue: r.isOverdue || (!!r.dueAt && +r.dueAt < Date.now() && !FINISHED_STATUSES.includes(r.status) && r.status !== "superseded" && r.status !== "declined" && r.status !== "pending_review"),
    assigneeId: r.assigneeId,
    assigneeName: r.assigneeId ? (people.get(r.assigneeId)?.name ?? "Former team member") : null,
    requesterId: r.requesterId,
    requesterName: people.get(r.requesterId)?.name ?? null,
    department: r.department,
    designs: r.requirements.map((k) => names.get(k) ?? k),
    tags: r.tags,
    versionNumber: r.versionNumber,
    deliveryDate: r.deliveryDate,
    eventDate: r.eventDate,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    deliveredAt: r.deliveredAt?.toISOString() ?? null,
    isLocked: r.isLocked,
  }));
}

export async function getTicket(id: string): Promise<Ticket | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [t] = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  return t ?? null;
}

/**
 * Which tickets the creative team sees: a lead (and the Support Admin) every ticket; a designer only the tickets assigned to them, never
 * an unassigned one. Every team page, action, file link and feed asks one of these two.
 */
export const canWork = (u: SessionUser, t: Pick<Ticket, "assigneeId">) => u.member && (u.lead || (!!t.assigneeId && t.assigneeId === u.id));
/** A ticket list's filter, narrowed to what this person may see (see canWork). */
export const teamFilter = (u: SessionUser, f: TicketFilter = {}): TicketFilter => (u.lead ? f : { ...f, assigneeId: u.id, unassigned: false });

/** The ticket for team pages and actions, or a 404-style error (so ids cannot be probed). */
export async function ticketForTeam(u: SessionUser, id: string): Promise<Ticket> {
  const t = await getTicket(id);
  if (!t || !canWork(u, t)) throw new DesignError("That ticket was not found.");
  return t;
}

/** The ticket for its requester (My Requests), or an error. */
export async function ticketForRequester(u: SessionUser, id: string): Promise<Ticket> {
  const t = await getTicket(id);
  if (!t || t.requesterId !== u.id) throw new DesignError("That request was not found.");
  return t;
}

const assertOpen = (t: Ticket) => {
  if (t.isLocked) throw new DesignError("This version is closed. Work on the newest version of the request.");
};

// ── Making a request ─────────────────────────────────────────────────────────

/** The request form: one ticket for every design chosen, waiting in Pending Review for a lead. Files are claimed first, all or none. */
export async function createRequest(u: SessionUser, input: RequestInput): Promise<{ id: string; number: string; trackingUrl: string }> {
  const types = await formTypes();
  const checked = checkRequest(input, types);
  if (!checked.ok) throw new DesignError(checked.error);
  const r = checked.value;
  const claimed = await claimFiles(u.id, r.fileIds, "attachment");
  try {
    const names = new Map([...types.values()].map((t) => [t.key, t.name]));
    const number = formatTicketNumber(await nextTicketSeq());
    const first = types.get(r.requirements[0])!;
    const [t] = await db
      .insert(tickets)
      .values({
        number,
        title: ticketTitle(r, names),
        brief: r.brief,
        designTypeId: first.id,
        requirements: r.requirements,
        details: r.details,
        eventName: r.eventName,
        eventDate: r.eventDate,
        deliveryDate: r.deliveryDate,
        department: r.department ?? u.department,
        referenceLinks: r.referenceLinks,
        priority: priorityFor(r.deliveryDate),
        status: "pending_review",
        requesterId: u.id,
        dueAt: deliveryDueAt(r.deliveryDate),
        tags: ["request-form"],
      })
      .returning();
    if (claimed.length) await db.insert(attachments).values(claimed.map((f) => ({ ticketId: t.id, fileId: f.id, uploadedBy: u.id })));
    await audit(t.id, u.id, "Created", { via: "request form", designs: r.requirements.map((k) => names.get(k) ?? k) });
    const summary = answerLines(r.requirements, r.details, types)
      .map((a) => [a.design, ...a.lines.map((l) => `  ${l}`)].join("\n"))
      .join("\n");
    await Promise.all([
      notice.newRequest(t, u.name, `${summary}\nNeeded by: ${r.deliveryDate}${t.department ? `\nDepartment: ${t.department}` : ""}`),
      notice.requestReceived(t),
    ]);
    return { id: t.id, number: t.number, trackingUrl: notice.trackingUrl(t.number) };
  } catch (e) {
    await releaseFiles(claimed.map((f) => f.id));
    throw e;
  }
}

// ── Assignment ───────────────────────────────────────────────────────────────

/** Designers with their hours a day and leave, and the remaining work on every active ticket: what the capacity rules need. */
export async function capacityData(): Promise<{ designers: CapDesigner[]; open: CapTicket[]; days: string[]; today: string }> {
  const designers = await listDesigners();
  const ids = designers.map((d) => d.id);
  const [profs, leaveRows, openRows, types, schedule, hols] = await Promise.all([
    ids.length ? db.select().from(profiles).where(inArray(profiles.userId, ids)) : Promise.resolve([]),
    ids.length ? db.select().from(leaves).where(inArray(leaves.userId, ids)) : Promise.resolve([]),
    db.select().from(tickets).where(inArray(tickets.status, [...ACTIVE_STATUSES, "waiting_on_requester", "in_review"] as TicketStatus[])),
    db.select({ id: designTypes.id, effort: designTypes.effortHours }).from(designTypes),
    getSchedule(),
    getHolidays(),
  ]);
  const effort = new Map(types.map((t) => [t.id, t.effort]));
  const today = istDate();
  return {
    designers: designers.map((d) => ({
      id: d.id,
      name: d.name,
      dailyHours: profs.find((p) => p.userId === d.id)?.dailyCapacityHours ?? 8,
      leaves: leaveRows.filter((l) => l.userId === d.id).map((l) => ({ start: l.startDate, end: l.endDate })),
    })),
    open: openRows
      .filter((t) => ACTIVE_STATUSES.includes(t.status))
      .map((t) => ({
        id: t.id,
        number: t.number,
        title: t.title,
        assigneeId: t.assigneeId,
        dueDay: t.dueAt ? istDate(t.dueAt) : null,
        remainingHours: remainingHours(t.estimateHours, effort.get(t.designTypeId) ?? null, t.timeSpentSeconds),
      })),
    days: workingDays(today, HORIZON_DAYS, schedule, hols),
    today,
  };
}

/** The designer with the most room over the next week, or null when there are none. */
export async function autoAssignee(): Promise<string | null> {
  const c = await capacityData();
  return suggestAssignee(c.designers, c.open, c.days)?.id ?? null;
}

/** For the Accept dialog: each assignable person with their open hours this week and their weekly capacity. */
export async function assigneeOptions(): Promise<{ id: string; name: string; openHours: number; capacityHours: number; designer: boolean; suggested: boolean }[]> {
  const { listAssignable } = await import("./host-adapter");
  const [people, c] = await Promise.all([listAssignable(), capacityData()]);
  const best = suggestAssignee(c.designers, c.open, c.days)?.id ?? null;
  return people.map((p) => {
    const d = c.designers.find((x) => x.id === p.id);
    return {
      id: p.id,
      name: p.name,
      openHours: Math.round(c.open.filter((t) => t.assigneeId === p.id).reduce((s, t) => s + t.remainingHours, 0) * 10) / 10,
      capacityHours: d ? c.days.filter((day) => !d.leaves.some((l) => l.start <= day && day <= l.end)).length * d.dailyHours : 0,
      designer: !!d,
      suggested: p.id === best,
    };
  });
}

// ── Pending Review decisions (leads) ─────────────────────────────────────────

export async function acceptRequest(u: SessionUser, id: string, assigneeId: string | "auto"): Promise<Ticket> {
  const t = await getTicket(id);
  if (!t) throw new DesignError("That request was not found.");
  if (t.status !== "pending_review") throw new DesignError("This request has already been reviewed.");
  let who: string | null = assigneeId === "auto" ? await autoAssignee() : assigneeId;
  if (who && assigneeId !== "auto" && !(await isAssignable(who))) throw new DesignError("Choose someone on the design team.");
  if (assigneeId === "auto" && !who) who = null;
  const [done] = await db
    .update(tickets)
    .set({ status: who ? "assigned" : "new", assigneeId: who, updatedAt: new Date() })
    .where(and(eq(tickets.id, id), eq(tickets.status, "pending_review")))
    .returning();
  if (!done) throw new DesignError("This request has already been reviewed.");
  await audit(id, u.id, "Accepted", { assignee: who, auto: assigneeId === "auto" });
  if (who) await notice.assigned(done, assigneeId === "auto" ? null : u.name);
  return done;
}

export async function declineRequest(u: SessionUser, id: string, reason: string): Promise<void> {
  const why = reason.trim();
  if (!why) throw new DesignError("Say why the request is declined: the requester is told.");
  const [done] = await db
    .update(tickets)
    .set({ status: "declined", declineReason: why.slice(0, 500), updatedAt: new Date() })
    .where(and(eq(tickets.id, id), eq(tickets.status, "pending_review")))
    .returning();
  if (!done) throw new DesignError("This request has already been reviewed.");
  await audit(id, u.id, "Declined", { reason: why });
  await notice.declined(done, why);
}

/** Asks the requester a question by email (and the bell). The request stays where it is; it is noted in its history. */
export async function askQuestion(u: SessionUser, id: string, text: string): Promise<void> {
  const q = text.trim();
  if (!q) throw new DesignError("Write the question.");
  const t = await getTicket(id);
  if (!t || !canWork(u, t)) throw new DesignError("That request was not found.");
  await audit(id, u.id, "Question asked", { question: q.slice(0, 1000) });
  await notice.question(t, q.slice(0, 1000), u.name);
}

// ── Moving a ticket along ────────────────────────────────────────────────────

/** Changes every status change needs, wherever it happens: the waiting clock, the edit window, and withdrawing stale review links. */
async function statusSideEffects(t: Ticket, to: TicketStatus): Promise<Partial<Ticket>> {
  const now = new Date();
  const patch: Partial<Ticket> = {};
  if (to === "waiting_on_requester" && t.status !== "waiting_on_requester") patch.pausedAt = now;
  if (t.status === "waiting_on_requester" && to !== "waiting_on_requester" && t.pausedAt) {
    const paused = Math.floor((+now - +t.pausedAt) / 1000);
    patch.pausedSeconds = t.pausedSeconds + paused;
    patch.pausedAt = null;
    if (t.dueAt) patch.dueAt = new Date(+t.dueAt + paused * 1000);
  }
  if (to === "delivered") {
    const s = await getSettings();
    const [type] = await db.select({ w: designTypes.editWindowHours }).from(designTypes).where(eq(designTypes.id, t.designTypeId)).limit(1);
    patch.deliveredAt = t.deliveredAt ?? now;
    patch.editWindowEndsAt = t.editWindowEndsAt ?? new Date(+now + (type?.w ?? s.editWindowHours) * 3_600_000);
  } else patch.editWindowEndsAt = null;
  if (to === "closed" || to === "closed_without_approval") patch.isLocked = true;
  if (to !== "in_review" && to !== "delivered") {
    await db.update(approvalRequests).set({ status: "revoked" }).where(and(eq(approvalRequests.ticketId, t.id), eq(approvalRequests.status, "pending")));
  }
  return patch;
}

export type TicketPatch = {
  status?: TicketStatus;
  assigneeId?: string | null;
  priority?: Priority;
  dueAt?: string | null;
  figmaUrl?: string | null;
  estimateHours?: number | null;
  tags?: string[];
};

const MOVABLE: TicketStatus[] = ["new", "assigned", "in_progress", "waiting_on_requester", "in_review", "delivered", "closed", "closed_without_approval"];

export async function updateTicket(u: SessionUser, id: string, p: TicketPatch): Promise<Ticket> {
  const t = await ticketForTeam(u, id);
  if (t.status === "pending_review" || t.status === "declined") throw new DesignError("Accept the request first.");
  if (!u.lead && ("assigneeId" in p || "priority" in p || "dueAt" in p)) throw new DesignError("Only a design lead can change who it is assigned to, its priority or its deadline.");
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  let patch: Partial<Ticket> = {};
  if (p.status && p.status !== t.status) {
    assertOpen(t);
    if (!MOVABLE.includes(p.status)) throw new DesignError("That status cannot be chosen.");
    if (p.status === "in_review") {
      const [pending] = await db.select({ id: approvalRequests.id }).from(approvalRequests).where(and(eq(approvalRequests.ticketId, id), eq(approvalRequests.status, "pending"))).limit(1);
      if (!pending) throw new DesignError("Send a proof for review (Proofs & approval) to move it to In review.");
    }
    patch = { ...patch, ...(await statusSideEffects(t, p.status)), status: p.status };
    changes.status = { from: STATUS_LABEL[t.status], to: STATUS_LABEL[p.status] };
  }
  if ("assigneeId" in p && p.assigneeId !== t.assigneeId) {
    if (p.assigneeId && !(await isAssignable(p.assigneeId))) throw new DesignError("Choose someone on the design team.");
    patch.assigneeId = p.assigneeId ?? null;
    if (p.assigneeId && t.status === "new" && !p.status) patch.status = "assigned";
    changes.assignee = { from: t.assigneeId, to: p.assigneeId ?? null };
  }
  if (p.priority && p.priority !== t.priority) {
    if (!PRIORITIES.includes(p.priority)) throw new DesignError("Choose a priority from the list.");
    patch.priority = p.priority;
    changes.priority = { from: t.priority, to: p.priority };
  }
  if ("dueAt" in p) {
    const d = p.dueAt ? new Date(p.dueAt) : null;
    if (d && Number.isNaN(+d)) throw new DesignError("Choose a valid deadline.");
    patch.dueAt = d;
    patch.isOverdue = !!d && +d < Date.now() && t.isOverdue;
    changes.deadline = { from: t.dueAt?.toISOString() ?? null, to: d?.toISOString() ?? null };
  }
  if ("figmaUrl" in p) {
    const v = p.figmaUrl?.trim() || null;
    if (v && !/^https:\/\/(www\.)?figma\.com\//.test(v)) throw new DesignError("Paste a figma.com link.");
    patch.figmaUrl = v;
    changes.figma = { from: t.figmaUrl, to: v };
  }
  if ("estimateHours" in p) {
    const v = p.estimateHours;
    if (v != null && !(v > 0 && v <= 500)) throw new DesignError("The estimate must be between 0 and 500 hours.");
    patch.estimateHours = v ?? null;
    changes.estimate = { from: t.estimateHours, to: v ?? null };
  }
  if (p.tags) {
    const tags = [...new Set(p.tags.map((x) => x.trim().slice(0, 30)).filter(Boolean))].slice(0, 15);
    patch.tags = tags;
    changes.tags = { from: t.tags, to: tags };
  }
  if (!Object.keys(changes).length) return t;
  const [done] = await db.update(tickets).set({ ...patch, updatedAt: new Date() }).where(eq(tickets.id, id)).returning();
  await audit(id, u.id, "Updated", changes);
  if (patch.assigneeId && patch.assigneeId !== t.assigneeId) await notice.assigned(done, u.name);
  return done;
}

/** Several tickets at once (board selection): move, assign or reprioritise. Locked tickets are skipped. Leads only for assign/priority. */
export async function bulkUpdate(u: SessionUser, ids: string[], p: Pick<TicketPatch, "status" | "assigneeId" | "priority">): Promise<{ updated: number; skipped: number }> {
  const want = [...new Set(ids)].slice(0, 100);
  if (!want.length) throw new DesignError("Select some tickets first.");
  let updated = 0;
  let skipped = 0;
  for (const id of want) {
    try {
      const before = await getTicket(id);
      const after = await updateTicket(u, id, p);
      if (before && after.updatedAt > before.updatedAt) updated++;
    } catch {
      skipped++;
    }
  }
  return { updated, skipped };
}

// ── Pieces of a ticket ───────────────────────────────────────────────────────

export async function addSubtask(u: SessionUser, ticketId: string, title: string) {
  const t = await ticketForTeam(u, ticketId);
  assertOpen(t);
  const v = title.trim().slice(0, 200);
  if (!v) throw new DesignError("Write the subtask.");
  await db.insert(subtasks).values({ ticketId, title: v });
}

export async function setSubtask(u: SessionUser, subtaskId: string, done: boolean | null) {
  const [s] = await db.select().from(subtasks).where(eq(subtasks.id, subtaskId)).limit(1);
  if (!s) throw new DesignError("That subtask was not found.");
  await ticketForTeam(u, s.ticketId);
  if (done === null) await db.delete(subtasks).where(eq(subtasks.id, subtaskId));
  else await db.update(subtasks).set({ done }).where(eq(subtasks.id, subtaskId));
}

/** A change the requester asked for outside the app (call, email, meeting), written down for the designer. */
export async function addClientChange(u: SessionUser, ticketId: string, text: string) {
  const t = await ticketForTeam(u, ticketId);
  assertOpen(t);
  const v = text.trim().slice(0, 2000);
  if (!v) throw new DesignError("Write what the requester wants changed.");
  const entry = { text: v, at: new Date().toISOString(), by: u.name };
  await db.update(tickets).set({ clientChanges: sql`${tickets.clientChanges} || ${JSON.stringify([entry])}::jsonb`, updatedAt: new Date() }).where(eq(tickets.id, ticketId));
  await audit(ticketId, u.id, "Client changes added", { text: v });
  if (t.assigneeId && t.assigneeId !== u.id) await notice.assigned({ ...t, title: `New changes from the requester: ${v.slice(0, 120)}` }, u.name);
}

export async function addAttachments(u: SessionUser, ticketId: string, fileIds: string[]) {
  const t = await ticketForTeam(u, ticketId);
  assertOpen(t);
  const claimed = await claimFiles(u.id, fileIds, "attachment");
  if (claimed.length) await db.insert(attachments).values(claimed.map((f) => ({ ticketId, fileId: f.id, uploadedBy: u.id })));
  await audit(ticketId, u.id, "Files added", { files: claimed.map((f) => f.fileName) });
}

/** The uploader or a lead may remove a file from a ticket. The stored file goes too, unless another ticket (a later version) still has it. */
export async function removeAttachment(u: SessionUser, attachmentId: string) {
  const [a] = await db.select().from(attachments).where(eq(attachments.id, attachmentId)).limit(1);
  if (!a) throw new DesignError("That file was not found.");
  await ticketForTeam(u, a.ticketId);
  if (!u.lead && a.uploadedBy !== u.id) throw new DesignError("Only the person who added a file, or a design lead, can remove it.");
  await db.delete(attachments).where(eq(attachments.id, attachmentId));
  const [still] = await db.select({ id: attachments.id }).from(attachments).where(eq(attachments.fileId, a.fileId)).limit(1);
  if (!still) await deleteFiles([a.fileId]);
  await audit(a.ticketId, u.id, "File removed", {});
}

// ── Deleting ─────────────────────────────────────────────────────────────────

/** Deletes tickets and everything that exists only for them, including stored files no other row still points at. */
export async function deleteTicketsAndParts(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const proofs = await db.select({ id: proofVersions.id, fileId: proofVersions.fileId }).from(proofVersions).where(inArray(proofVersions.ticketId, ids));
  const atts = await db.select({ fileId: attachments.fileId }).from(attachments).where(inArray(attachments.ticketId, ids));
  const cdrs = await db.select({ id: cdrRequests.id, fileId: cdrRequests.fileId }).from(cdrRequests).where(inArray(cdrRequests.ticketId, ids));
  await db.delete(approvalRequests).where(inArray(approvalRequests.ticketId, ids));
  await db.delete(pinpoints).where(inArray(pinpoints.ticketId, ids));
  await db.delete(attachments).where(inArray(attachments.ticketId, ids));
  await db.delete(proofVersions).where(inArray(proofVersions.ticketId, ids));
  if (cdrs.length) await db.delete(cdrDownloads).where(inArray(cdrDownloads.cdrRequestId, cdrs.map((c) => c.id)));
  await db.delete(cdrRequests).where(inArray(cdrRequests.ticketId, ids));
  await db.delete(subtasks).where(inArray(subtasks.ticketId, ids));
  await db.delete(timeEntries).where(inArray(timeEntries.ticketId, ids));
  await db.delete(auditLogs).where(inArray(auditLogs.ticketId, ids));
  await db.update(libraryItems).set({ ticketId: null }).where(inArray(libraryItems.ticketId, ids));
  await db.update(tickets).set({ parentId: null }).where(inArray(tickets.parentId, ids));
  await db.delete(tickets).where(inArray(tickets.id, ids));
  const candidates = [...proofs.map((p) => p.fileId), ...atts.map((a) => a.fileId), ...cdrs.map((c) => c.fileId).filter((x): x is string => !!x)];
  if (candidates.length) {
    const still = new Set((await db.select({ fileId: attachments.fileId }).from(attachments).where(inArray(attachments.fileId, candidates))).map((r) => r.fileId));
    await deleteFiles(candidates.filter((f) => !still.has(f)));
  }
}

export async function deleteTicket(u: SessionUser, id: string): Promise<void> {
  if (!u.lead) throw new DesignError("Only a design lead can delete a ticket.");
  const t = await getTicket(id);
  if (!t) throw new DesignError("That ticket was not found.");
  await deleteTicketsAndParts([id]);
}

// ── Small lists ──────────────────────────────────────────────────────────────

export async function pendingCount(): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(tickets).where(eq(tickets.status, "pending_review"));
  return r?.n ?? 0;
}

/** All accepted requests, for everyone in the hub (/design/requests): what a tracking link shows, nothing more. */
export async function allRequests(): Promise<TicketCard[]> {
  const rows = await db
    .select()
    .from(tickets)
    .where(and(notInArray(tickets.status, [...OFF_BOARD_STATUSES, "superseded"] as TicketStatus[]), sql`(${tickets.status} not in ('delivered','closed','closed_without_approval') or coalesce(${tickets.deliveredAt}, ${tickets.updatedAt}) > now() - interval '90 days')`))
    .orderBy(desc(tickets.createdAt))
    .limit(500);
  return toCards(rows);
}

/** A ticket's versions, oldest first (DF-0001, DF-0001-V2 ...). */
export async function versionChain(t: Ticket): Promise<{ id: string; number: string; status: TicketStatus; versionNumber: number }[]> {
  const base = t.number.split("-V")[0];
  return db
    .select({ id: tickets.id, number: tickets.number, status: tickets.status, versionNumber: tickets.versionNumber })
    .from(tickets)
    .where(or(eq(tickets.number, base), ilike(tickets.number, `${base}-V%`)))
    .orderBy(asc(tickets.versionNumber));
}

export { workingDeadline };
