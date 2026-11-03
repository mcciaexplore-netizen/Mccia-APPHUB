import "server-only";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { db } from "./db";
import { attachments, auditLogs, cdrRequests, pinpoints, proofVersions, savedViews, subtasks, tickets, type Ticket } from "@/db/design-schema";
import { DesignError, type SessionUser } from "./dal";
import { filesByIds } from "./files";
import { formTypes, typeNames } from "./config";
import { listAssignable, peopleByIds } from "./host-adapter";
import { answerLines } from "./form";
import { proofsFor, type ProofDto } from "./approvals";
import { cdrFor, type CdrDto } from "./cdr";
import { runningTimer, timeFor, type TimeDto } from "./time";
import { canWork, ticketForTeam, toCards, versionChain, type TicketCard } from "./tickets";
import { isLibraryFile } from "./library";
import { isPostImage } from "./campaigns";
import { changeCutoff } from "./rules";

/** Everything the ticket page shows, in one load. */

export type AuditDto = { id: string; at: string; who: string; action: string; details: Record<string, unknown> };
export type PinDto = { id: string; proofVersionId: string; xPct: number; yPct: number; content: string; resolved: boolean; author: string | null; at: string };
export type TicketDetail = {
  card: TicketCard;
  brief: string;
  eventName: string | null;
  referenceLinks: string[];
  answers: { design: string; lines: string[] }[];
  clientChanges: { text: string; at: string; by: string }[];
  figmaUrl: string | null;
  estimateHours: number | null;
  timeSpentSeconds: number;
  reasonForChange: string | null;
  declineReason: string | null;
  editWindowEndsAt: string | null;
  changeCutoff: string | null;
  requesterEmail: string | null;
  subtasks: { id: string; title: string; done: boolean }[];
  attachments: { id: string; fileId: string; fileName: string; mime: string; size: number; uploadedBy: string | null; uploadedById: string; at: string }[];
  proofs: ProofDto[];
  cdr: CdrDto[];
  time: TimeDto[];
  running: { ticketId: string; startedAt: string } | null;
  pins: PinDto[];
  audit: AuditDto[];
  versions: { id: string; number: string; status: string; versionNumber: number }[];
  assignable: { id: string; name: string }[];
};

export async function ticketDetail(u: SessionUser, id: string): Promise<TicketDetail> {
  const t = await ticketForTeam(u, id);
  const [card] = await toCards([t]);
  const [types, subs, atts, proofs, cdr, time, running, pins, logs, versions, assignable] = await Promise.all([
    formTypes(),
    db.select().from(subtasks).where(eq(subtasks.ticketId, id)).orderBy(asc(subtasks.createdAt)),
    db.select().from(attachments).where(eq(attachments.ticketId, id)).orderBy(asc(attachments.createdAt)),
    proofsFor(id),
    cdrFor([id]),
    timeFor(id),
    runningTimer(u.id),
    db.select().from(pinpoints).where(eq(pinpoints.ticketId, id)).orderBy(asc(pinpoints.createdAt)),
    db.select().from(auditLogs).where(eq(auditLogs.ticketId, id)).orderBy(desc(auditLogs.createdAt)).limit(200),
    versionChain(t),
    u.lead ? listAssignable() : Promise.resolve([]),
  ]);
  const fs = await filesByIds(atts.map((a) => a.fileId));
  const people = await peopleByIds([t.requesterId, ...atts.map((a) => a.uploadedBy), ...pins.map((p) => p.authorId), ...logs.map((l) => l.userId)]);
  const allTypes = new Map([...types.values()].map((x) => [x.key, x]));
  const names = await typeNames();
  for (const [k, n] of names) if (!allTypes.has(k)) allTypes.set(k, { key: k, name: n, questions: [], id: "", slaHours: 0, effortHours: 0 });
  const cut = changeCutoff(t);
  return {
    card,
    brief: t.brief,
    eventName: t.eventName,
    referenceLinks: t.referenceLinks,
    answers: answerLines(t.requirements, t.details, allTypes),
    clientChanges: t.clientChanges,
    figmaUrl: t.figmaUrl,
    estimateHours: t.estimateHours,
    timeSpentSeconds: t.timeSpentSeconds,
    reasonForChange: t.reasonForChange,
    declineReason: t.declineReason,
    editWindowEndsAt: t.editWindowEndsAt?.toISOString() ?? null,
    changeCutoff: cut?.toISOString() ?? null,
    requesterEmail: people.get(t.requesterId)?.email ?? null,
    subtasks: subs.map((s) => ({ id: s.id, title: s.title, done: s.done })),
    attachments: atts
      .filter((a) => fs.has(a.fileId))
      .map((a) => {
        const f = fs.get(a.fileId)!;
        return { id: a.id, fileId: f.id, fileName: f.fileName, mime: f.mime, size: f.size, uploadedBy: people.get(a.uploadedBy)?.name ?? null, uploadedById: a.uploadedBy, at: a.createdAt.toISOString() };
      }),
    proofs,
    cdr,
    time,
    running,
    pins: pins.map((p) => ({ id: p.id, proofVersionId: p.proofVersionId, xPct: p.xPct, yPct: p.yPct, content: p.content, resolved: p.resolved, author: people.get(p.authorId)?.name ?? null, at: p.createdAt.toISOString() })),
    audit: logs.map((l) => ({ id: l.id, at: l.createdAt.toISOString(), who: l.actorLabel ?? (l.userId ? (people.get(l.userId)?.name ?? "Former user") : "System"), action: l.action, details: l.details })),
    versions,
    assignable: assignable.map((p) => ({ id: p.id, name: p.name })),
  };
}

// ── Pins on proofs ───────────────────────────────────────────────────────────

export async function addPin(u: SessionUser, proofId: string, xPct: number, yPct: number, content: string): Promise<void> {
  const [p] = await db.select().from(proofVersions).where(eq(proofVersions.id, proofId)).limit(1);
  if (!p) throw new DesignError("That proof was not found.");
  await ticketForTeam(u, p.ticketId);
  const text = content.trim().slice(0, 1000);
  if (!text) throw new DesignError("Write what to change at this spot.");
  if (!(xPct >= 0 && xPct <= 100 && yPct >= 0 && yPct <= 100)) throw new DesignError("Click on the image to place the pin.");
  await db.insert(pinpoints).values({ ticketId: p.ticketId, proofVersionId: p.id, authorId: u.id, xPct, yPct, content: text });
}

export async function setPin(u: SessionUser, pinId: string, resolved: boolean | null): Promise<void> {
  const [pin] = await db.select().from(pinpoints).where(eq(pinpoints.id, pinId)).limit(1);
  if (!pin) throw new DesignError("That pin was not found.");
  await ticketForTeam(u, pin.ticketId);
  if (resolved === null) {
    if (pin.authorId !== u.id && !u.lead) throw new DesignError("Only the person who placed a pin, or a design lead, can remove it.");
    await db.delete(pinpoints).where(eq(pinpoints.id, pinId));
  } else await db.update(pinpoints).set({ resolved }).where(eq(pinpoints.id, pinId));
}

// ── Activity feed ────────────────────────────────────────────────────────────

export type ActivityDto = { id: string; at: string; ticketId: string; number: string; title: string; text: string };

const activityText = (action: string, d: Record<string, unknown>, who: string): string => {
  const status = d.status as { to?: string } | undefined;
  if (action === "Updated" && status?.to) return `moved → ${status.to}`;
  if (action === "Updated" && d.assignee) return `assigned by ${who}`;
  if (action === "Created") return d.revision_of ? `new version (changes requested)` : `new request from ${who}`;
  if (action === "Requester approved") return `approved by ${who.replace(/ \(.*\)$/, "")}`;
  if (action === "Requester asked for changes") return `changes requested by ${who.replace(/ \(.*\)$/, "")}`;
  if (action === "Sent for review") return `V${d.proof_version ?? "?"} sent for review by ${who}`;
  if (action === "Accepted") return `accepted by ${who}`;
  if (action === "Auto-closed") return `closed (${String(d.reason ?? "automatically")})`;
  return `${action.toLowerCase()} · ${who}`;
};

const FEED_ACTIONS = ["Created", "Updated", "Requester approved", "Requester asked for changes", "Sent for review", "Accepted", "Declined", "Client changes added", "Auto-closed", "Uploaded proof"];

/** The newest events: every ticket, or only one designer's (`mine`). */
export async function activity(mine: string | null, limit = 30): Promise<ActivityDto[]> {
  const rows = await db
    .select({ a: auditLogs, number: tickets.number, title: tickets.title, assigneeId: tickets.assigneeId })
    .from(auditLogs)
    .innerJoin(tickets, eq(tickets.id, auditLogs.ticketId))
    .where(and(inArray(auditLogs.action, FEED_ACTIONS), mine ? eq(tickets.assigneeId, mine) : undefined))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
  const people = await peopleByIds(rows.map((r) => r.a.userId));
  return rows.map((r) => {
    const who = r.a.actorLabel ?? (r.a.userId ? (people.get(r.a.userId)?.name ?? "Someone") : "System");
    return { id: r.a.id, at: r.a.createdAt.toISOString(), ticketId: r.a.ticketId, number: r.number, title: r.title, text: activityText(r.a.action, r.a.details, who) };
  });
}

// ── Saved board views ────────────────────────────────────────────────────────

export type ViewDto = { id: string; name: string; filters: Record<string, string>; isShared: boolean; mine: boolean; owner: string | null };

const VIEW_KEYS = new Set(["search", "assignee", "type", "priority", "overdue", "group"]);

export async function listViews(u: SessionUser): Promise<ViewDto[]> {
  const rows = await db.select().from(savedViews).where(or(eq(savedViews.userId, u.id), eq(savedViews.isShared, true))).orderBy(asc(savedViews.name));
  const people = await peopleByIds(rows.map((r) => r.userId));
  return rows.map((r) => ({ id: r.id, name: r.name, filters: r.filters, isShared: r.isShared, mine: r.userId === u.id, owner: people.get(r.userId)?.name ?? null }));
}

export async function saveView(u: SessionUser, name: string, filters: Record<string, string>, isShared: boolean): Promise<void> {
  const n = name.trim().slice(0, 60);
  if (!n) throw new DesignError("Name the view.");
  const clean = Object.fromEntries(Object.entries(filters).filter(([k, v]) => VIEW_KEYS.has(k) && typeof v === "string" && v.length <= 200));
  await db.insert(savedViews).values({ userId: u.id, name: n, filters: clean, isShared });
}

export async function deleteView(u: SessionUser, id: string): Promise<void> {
  const [v] = await db.select().from(savedViews).where(eq(savedViews.id, id)).limit(1);
  if (!v || (v.userId !== u.id && !u.lead)) throw new DesignError("That view was not found.");
  await db.delete(savedViews).where(eq(savedViews.id, id));
}

// ── Who may open a stored file ───────────────────────────────────────────────

/**
 * A stored file opens for: the team on its ticket (a lead, or the designer it is assigned to), the requester of that ticket (their own
 * files and the proofs sent to them), the team for library files, and every signed-in user for campaign post images.
 */
export async function canOpenFile(u: SessionUser, fileId: string): Promise<boolean> {
  const viaTicket = async (ticketIds: string[], requesterToo: boolean) => {
    if (!ticketIds.length) return false;
    const ts = await db.select().from(tickets).where(inArray(tickets.id, ticketIds));
    return ts.some((t: Ticket) => canWork(u, t) || (requesterToo && t.requesterId === u.id));
  };
  const [att, proof, cdr] = await Promise.all([
    db.select({ ticketId: attachments.ticketId }).from(attachments).where(eq(attachments.fileId, fileId)),
    db.select({ ticketId: proofVersions.ticketId }).from(proofVersions).where(eq(proofVersions.fileId, fileId)),
    db.select({ ticketId: cdrRequests.ticketId }).from(cdrRequests).where(eq(cdrRequests.fileId, fileId)),
  ]);
  if (await viaTicket(att.map((a) => a.ticketId), true)) return true;
  if (await viaTicket(proof.map((p) => p.ticketId), true)) return true;
  if (await viaTicket(cdr.map((c) => c.ticketId), false)) return true;
  if (u.member && (await isLibraryFile(fileId))) return true;
  return isPostImage(fileId);
}

