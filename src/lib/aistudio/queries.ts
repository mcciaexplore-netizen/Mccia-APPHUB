import "server-only";
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { db, rowsOf } from "./db";
import { attachments, auditLogs, files, notes, requests, type Priority, type Request, type RequestStatus, type RequestType } from "@/db/aistudio-schema";
import { STATUS_LABEL, STEPS } from "./aistudio.manifest";
import { LIST_TABS, PAGE_SIZE, type ListQuery, type ListTab } from "./list-query";
import { listTeam, peopleByIds, peopleNamedLike, userNameOf, type Person } from "./host-adapter";
import type { SessionUser } from "./dal";
import { requestForRequester, requestForTeam } from "./requests";

/** Everything the module's pages read: cards, the requester's own lists, the dashboard, the paged list, and one request in full. */

export type RequestCard = {
  id: string;
  number: string;
  title: string;
  requestType: RequestType;
  status: RequestStatus;
  priority: Priority | null;
  deadline: string | null;
  department: string | null;
  requesterName: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function toCards(rows: Request[]): Promise<RequestCard[]> {
  const people = await peopleByIds(rows.flatMap((r) => [r.requesterId, r.assigneeId]));
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    title: r.title,
    requestType: r.requestType,
    status: r.status,
    priority: r.priority,
    deadline: r.deadline,
    department: r.department,
    requesterName: people.get(r.requesterId)?.name ?? null,
    assigneeId: r.assigneeId,
    assigneeName: r.assigneeId ? (people.get(r.assigneeId)?.name ?? "Former team member") : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export type FileDto = { attachmentId: string; fileId: string; fileName: string; mime: string; size: number; at: string; by: string | null };

async function filesOf(requestIds: string[], purpose?: "attachment" | "deliverable"): Promise<Map<string, FileDto[]>> {
  const out = new Map<string, FileDto[]>();
  if (!requestIds.length) return out;
  const rows = await db
    .select({ a: attachments, f: files })
    .from(attachments)
    .innerJoin(files, eq(files.id, attachments.fileId))
    .where(and(inArray(attachments.requestId, requestIds), purpose ? eq(files.purpose, purpose) : undefined))
    .orderBy(asc(attachments.createdAt));
  const people = await peopleByIds(rows.map((r) => r.a.uploadedBy));
  for (const { a, f } of rows) {
    const list = out.get(a.requestId) ?? [];
    list.push({ attachmentId: a.id, fileId: f.id, fileName: f.fileName, mime: f.mime, size: f.size, at: a.createdAt.toISOString(), by: people.get(a.uploadedBy)?.name ?? null });
    out.set(a.requestId, list);
  }
  return out;
}

/** When each of the requester's steps was reached, from the request's history (a step can be reached again after going back). */
async function stepTimes(requestIds: string[]): Promise<Map<string, Partial<Record<RequestStatus, string>>>> {
  const out = new Map<string, Partial<Record<RequestStatus, string>>>();
  if (!requestIds.length) return out;
  const rows = await db.select().from(auditLogs).where(inArray(auditLogs.requestId, requestIds)).orderBy(asc(auditLogs.createdAt));
  for (const l of rows) {
    const m = out.get(l.requestId) ?? {};
    const at = l.createdAt.toISOString();
    if (l.action === "Submitted") m.pending_review = at;
    if (l.action === "Accepted") m.accepted = at;
    const to = (l.details as { status?: { to?: RequestStatus } }).status?.to;
    if (l.action === "Updated" && to) m[to] = at;
    out.set(l.requestId, m);
  }
  return out;
}

export type Step = { label: string; at: string | null; done: boolean; current: boolean };

/** The five steps for a request, with the time each was reached. */
export function stepsFor(status: RequestStatus, times: Partial<Record<RequestStatus, string>>): Step[] {
  const keys: RequestStatus[] = ["pending_review", "accepted", "in_progress", "review_testing", "delivered"];
  const reached = status === "closed" ? 4 : status === "declined" ? 0 : keys.indexOf(status);
  return STEPS.map((label, i) => ({ label, at: times[keys[i]] ?? null, done: i < reached || (i === reached && (status === "delivered" || status === "closed")), current: i === reached && status !== "delivered" && status !== "closed" }));
}

// ── The requester ──────────────────────────────────────────────────────────

/** A request as its requester sees it: no assignee, and deliverables only once delivered. */
export type MyRequest = Omit<RequestCard, "assigneeId" | "assigneeName" | "requesterName"> & { declineReason: string | null; steps: Step[]; deliverables: FileDto[] };

const delivered = (s: RequestStatus) => s === "delivered" || s === "closed";

export async function myRequests(u: SessionUser): Promise<MyRequest[]> {
  const rows = await db.select().from(requests).where(eq(requests.requesterId, u.id)).orderBy(desc(requests.createdAt)).limit(500);
  const ids = rows.map((r) => r.id);
  const [cards, times, deliverables] = await Promise.all([toCards(rows), stepTimes(ids), filesOf(rows.filter((r) => delivered(r.status)).map((r) => r.id), "deliverable")]);
  return cards.map((c, i) => {
    const { assigneeId, assigneeName, requesterName, ...rest } = c;
    void assigneeId;
    void assigneeName;
    void requesterName;
    return { ...rest, declineReason: rows[i].declineReason, steps: stepsFor(c.status, times.get(c.id) ?? {}), deliverables: deliverables.get(c.id) ?? [] };
  });
}

export type MyRequestDetail = MyRequest & {
  description: string;
  referenceLinks: string[];
  content: string | null;
  deliveryNotes: string | null;
  attachments: FileDto[];
  /** Notes shared with the requester, signed by the team (never by a person). */
  notes: { id: string; body: string; at: string }[];
};

export async function myRequestDetail(u: SessionUser, id: string): Promise<MyRequestDetail> {
  const r = await requestForRequester(u, id);
  const [[base], atts, shared] = await Promise.all([
    myRequests(u).then((all) => all.filter((x) => x.id === r.id)),
    filesOf([r.id], "attachment"),
    db.select().from(notes).where(and(eq(notes.requestId, r.id), eq(notes.isInternal, false))).orderBy(asc(notes.createdAt)),
  ]);
  return {
    ...base,
    description: r.description,
    referenceLinks: r.referenceLinks,
    content: r.content,
    deliveryNotes: delivered(r.status) ? r.deliveryNotes : null,
    attachments: atts.get(r.id) ?? [],
    notes: shared.map((n) => ({ id: n.id, body: n.body, at: n.createdAt.toISOString() })),
  };
}

// ── The team: dashboard ────────────────────────────────────────────────────

export type Kpis = { total: number; inProgress: number; reviewTesting: number; deliveredThisWeek: number; pending: number };

/** Today's date in IST (YYYY-MM-DD), for marking requests past their deadline. */
export const istToday = (now = Date.now()) => new Date(now + 330 * 60_000).toISOString().slice(0, 10);

/** Monday 00:00 IST of this week. */
function istWeekStart(now = new Date()): Date {
  const ist = new Date(now.getTime() + 330 * 60_000);
  const day = (ist.getUTCDay() + 6) % 7;
  const monday = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - day);
  return new Date(monday - 330 * 60_000);
}

export async function kpis(): Promise<Kpis> {
  const [r] = rowsOf<{ total: number; in_progress: number; review: number; pending: number }>(
    await db.execute(sql`
      select count(*)::int as total,
        count(*) filter (where status = 'in_progress')::int as in_progress,
        count(*) filter (where status = 'review_testing')::int as review,
        count(*) filter (where status = 'pending_review')::int as pending
      from aistudio_requests`),
  );
  // Delivered this week: requests whose move to Delivered happened since Monday (from their history).
  const [d] = rowsOf<{ n: number }>(
    await db.execute(sql`
      select count(distinct l.request_id)::int as n from aistudio_audit_logs l join aistudio_requests r on r.id = l.request_id
      where l.action = 'Updated' and l.details->'status'->>'to' = 'delivered' and l.created_at >= ${istWeekStart().toISOString()}::timestamptz
        and r.status in ('delivered', 'closed')`),
  );
  return { total: r?.total ?? 0, inProgress: r?.in_progress ?? 0, reviewTesting: r?.review ?? 0, deliveredThisWeek: d?.n ?? 0, pending: r?.pending ?? 0 };
}

export async function pendingCount(): Promise<number> {
  const [r] = rowsOf<{ n: number }>(await db.execute(sql`select count(*)::int as n from aistudio_requests where status = 'pending_review'`));
  return r?.n ?? 0;
}

/** Requests waiting in Pending Review, oldest first, each with the start of its description. */
export async function pendingItems(): Promise<(RequestCard & { excerpt: string })[]> {
  const rows = await db.select().from(requests).where(eq(requests.status, "pending_review")).orderBy(asc(requests.createdAt)).limit(200);
  const cards = await toCards(rows);
  return cards.map((c, i) => ({ ...c, excerpt: rows[i].description.replace(/\s+/g, " ").trim().slice(0, 220) }));
}

export type ActivityItem = { id: string; at: string; requestId: string; number: string; title: string; text: string };

const activityText = (action: string, details: Record<string, unknown>, who: string): string => {
  const to = (details.status as { to?: RequestStatus } | undefined)?.to;
  if (action === "Updated" && to) return `moved to ${STATUS_LABEL[to]} by ${who}`;
  if (action === "Updated" && details.assigneeId) return `assigned by ${who}`;
  if (action === "Updated") return `updated by ${who}`;
  if (action === "Submitted") return `new request from ${who}`;
  return `${action.toLowerCase()} · ${who}`;
};

/** The newest events across every request (the dashboard's feed, refreshed every 15 seconds). */
export async function activity(limit = 30): Promise<ActivityItem[]> {
  const rows = await db
    .select({ a: auditLogs, number: requests.number, title: requests.title })
    .from(auditLogs)
    .innerJoin(requests, eq(requests.id, auditLogs.requestId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
  const people = await peopleByIds(rows.map((r) => r.a.userId));
  return rows.map((r) => {
    const who = r.a.actorLabel ?? (r.a.userId ? (people.get(r.a.userId)?.name ?? "Someone") : "System");
    return { id: r.a.id, at: r.a.createdAt.toISOString(), requestId: r.a.requestId, number: r.number, title: r.title, text: activityText(r.a.action, r.a.details, who) };
  });
}

// ── The team: All Requests ─────────────────────────────────────────────────

function filters(q: ListQuery): SQL[] {
  const where: SQL[] = [];
  if (q.type) where.push(eq(requests.requestType, q.type));
  if (q.priority) where.push(eq(requests.priority, q.priority));
  if (q.assignee === "unassigned") where.push(isNull(requests.assigneeId));
  else if (q.assignee) where.push(eq(requests.assigneeId, q.assignee));
  if (q.q.trim()) {
    const like = `%${q.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(or(ilike(requests.number, like), ilike(requests.title, like), sql`${requests.requesterId} in (${peopleNamedLike(like)})`)!);
  }
  return where;
}
const tabWhere = (t: ListTab): SQL | undefined => {
  const st = LIST_TABS[t].statuses;
  return st ? inArray(requests.status, st) : undefined;
};

/** How many requests each tab holds, under the same search and filters. */
async function tabCounts(where: SQL[]): Promise<Record<ListTab, number>> {
  const tabs = Object.keys(LIST_TABS) as ListTab[];
  const [row] = await db
    .select(Object.fromEntries(tabs.map((t) => [t, sql<number>`count(*) filter (where ${tabWhere(t) ?? sql`true`})::int`])) as Record<ListTab, SQL<number>>)
    .from(requests)
    .where(where.length ? and(...where) : undefined);
  return row;
}

/** One page of the list view (25), with the total and the tab counts. */
export async function listPage(q: ListQuery): Promise<{ rows: RequestCard[]; total: number; counts: Record<ListTab, number> }> {
  const where = filters(q);
  const order = {
    submitted: requests.createdAt,
    number: requests.createdAt, // the numbers rise with time
    title: sql`lower(${requests.title})`,
    type: requests.requestType,
    requester: sql`lower(${userNameOf(sql`${requests.requesterId}`)})`,
    assignee: sql`lower(${userNameOf(sql`${requests.assigneeId}`)})`,
    priority: sql`array_position(array['urgent','high','normal','low']::text[], ${requests.priority}::text)`,
    status: sql`array_position(array['pending_review','accepted','in_progress','review_testing','delivered','closed','declined']::text[], ${requests.status}::text)`,
    deadline: requests.deadline,
  }[q.sort];
  const own = tabWhere(q.tab);
  const [counts, rows] = await Promise.all([
    tabCounts(where),
    db
      .select()
      .from(requests)
      .where(and(...where, ...(own ? [own] : [])))
      .orderBy(q.dir === "asc" ? sql`${order} asc nulls last` : sql`${order} desc nulls last`, desc(requests.createdAt))
      .limit(PAGE_SIZE)
      .offset((q.page - 1) * PAGE_SIZE),
  ]);
  return { rows: await toCards(rows), total: counts[q.tab], counts };
}

/** The card view: the requests on the chosen tab (up to 300), grouped by status in the workflow's order, with the tab counts. */
export async function cardGroups(q: ListQuery): Promise<{ groups: { status: RequestStatus; cards: RequestCard[] }[]; counts: Record<ListTab, number> }> {
  const where = filters(q);
  const own = tabWhere(q.tab);
  const [counts, rows] = await Promise.all([
    tabCounts(where),
    db
      .select()
      .from(requests)
      .where(and(...where, ...(own ? [own] : [])))
      .orderBy(sql`${requests.deadline} asc nulls last`, desc(requests.createdAt))
      .limit(300),
  ]);
  const cards = await toCards(rows);
  const order: RequestStatus[] = ["pending_review", "accepted", "in_progress", "review_testing", "delivered", "closed", "declined"];
  return { groups: order.map((status) => ({ status, cards: cards.filter((c) => c.status === status) })).filter((g) => g.cards.length), counts };
}

// ── The team: one request ──────────────────────────────────────────────────

export type NoteDto = { id: string; body: string; internal: boolean; by: string | null; at: string };
export type AuditDto = { id: string; at: string; who: string; action: string; details: Record<string, unknown> };

export type AdminDetail = {
  card: RequestCard;
  description: string;
  referenceLinks: string[];
  content: string | null;
  declineReason: string | null;
  deliveryNotes: string | null;
  requesterEmail: string | null;
  attachments: FileDto[];
  deliverables: FileDto[];
  notes: NoteDto[];
  steps: Step[];
  audit: AuditDto[];
  team: Person[];
};

export async function adminDetail(u: SessionUser, id: string): Promise<AdminDetail> {
  const r = await requestForTeam(u, id);
  const [[card], atts, dels, ns, logs, times, team] = await Promise.all([
    toCards([r]),
    filesOf([r.id], "attachment"),
    filesOf([r.id], "deliverable"),
    db.select().from(notes).where(eq(notes.requestId, r.id)).orderBy(desc(notes.createdAt)),
    db.select().from(auditLogs).where(eq(auditLogs.requestId, r.id)).orderBy(desc(auditLogs.createdAt)).limit(200),
    stepTimes([r.id]),
    listTeam(),
  ]);
  const people = await peopleByIds([r.requesterId, ...ns.map((n) => n.userId), ...logs.map((l) => l.userId)]);
  return {
    card,
    description: r.description,
    referenceLinks: r.referenceLinks,
    content: r.content,
    declineReason: r.declineReason,
    deliveryNotes: r.deliveryNotes,
    requesterEmail: people.get(r.requesterId)?.email ?? null,
    attachments: atts.get(r.id) ?? [],
    deliverables: dels.get(r.id) ?? [],
    notes: ns.map((n) => ({ id: n.id, body: n.body, internal: n.isInternal, by: n.userId ? (people.get(n.userId)?.name ?? "Former user") : null, at: n.createdAt.toISOString() })),
    steps: stepsFor(r.status, times.get(r.id) ?? {}),
    audit: logs.map((l) => ({ id: l.id, at: l.createdAt.toISOString(), who: l.actorLabel ?? (l.userId ? (people.get(l.userId)?.name ?? "Former user") : "System"), action: l.action, details: l.details })),
    team,
  };
}
