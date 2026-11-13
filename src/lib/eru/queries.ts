import "server-only";
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "./db";
import { auditLogs, documentChanges, documentComments, documents, domains, files, projects, settings, type Priority, type ProjectStatus } from "@/db/eru-schema";
import { isUuid, PRIORITIES, STATUSES } from "./eru.manifest";
import { peopleByIds, type Person } from "./host-adapter";

/** What ERU's pages read. Names of people come from the hub (peopleByIds); a person who has left shows as "Former user". */

const nameOf = (m: Map<string, Person>, id: string | null | undefined) => (id ? (m.get(id)?.name ?? "Former user") : "");

export type DomainCard = { id: string; key: string; name: string; description: string; color: string; icon: string; projects: number; active: number };

/** The active domains with how many projects each has (and how many are active), in their order. */
export async function domainCards(): Promise<DomainCard[]> {
  const rows = await db
    .select({
      id: domains.id,
      key: domains.key,
      name: domains.name,
      description: domains.description,
      color: domains.color,
      icon: domains.icon,
      projects: sql<number>`count(${projects.id})::int`,
      active: sql<number>`count(${projects.id}) filter (where ${projects.status} = 'active')::int`,
    })
    .from(domains)
    .leftJoin(projects, eq(projects.domainId, domains.id))
    .where(eq(domains.isActive, true))
    .groupBy(domains.id)
    .orderBy(asc(domains.sortOrder), asc(domains.name));
  return rows;
}

export async function activeDomains() {
  return db.select({ id: domains.id, key: domains.key, name: domains.name }).from(domains).where(eq(domains.isActive, true)).orderBy(asc(domains.sortOrder), asc(domains.name));
}

export async function domainByKey(key: string) {
  if (!/^[a-z0-9_]{1,60}$/.test(key)) return null;
  const [d] = await db.select().from(domains).where(and(eq(domains.key, key), eq(domains.isActive, true))).limit(1);
  return d ?? null;
}

export type ProjectCard = {
  id: string;
  number: string;
  title: string;
  status: ProjectStatus;
  priority: Priority;
  dueDate: string | null;
  updatedAt: string;
  documents: number;
  assigned: { id: string; name: string }[];
  domain: { key: string; name: string; color: string };
};

async function cards(where: SQL | undefined, order: SQL[] = [desc(projects.updatedAt)], limit = 200): Promise<ProjectCard[]> {
  const rows = await db
    .select({
      id: projects.id,
      number: projects.number,
      title: projects.title,
      status: projects.status,
      priority: projects.priority,
      dueDate: projects.dueDate,
      updatedAt: projects.updatedAt,
      assignedTo: projects.assignedTo,
      documents: sql<number>`(select count(*)::int from eru_documents d where d.project_id = ${projects.id})`,
      domainKey: domains.key,
      domainName: domains.name,
      domainColor: domains.color,
    })
    .from(projects)
    .innerJoin(domains, eq(domains.id, projects.domainId))
    .where(where)
    .orderBy(...order)
    .limit(limit);
  const people = await peopleByIds(rows.flatMap((r) => r.assignedTo));
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    title: r.title,
    status: r.status,
    priority: r.priority,
    dueDate: r.dueDate,
    updatedAt: r.updatedAt.toISOString(),
    documents: r.documents,
    assigned: r.assignedTo.map((id) => ({ id, name: nameOf(people, id) })),
    domain: { key: r.domainKey, name: r.domainName, color: r.domainColor },
  }));
}

/** A domain's projects: open ones first (archived last), most recently updated first. */
export const domainProjects = (domainId: string) => cards(eq(projects.domainId, domainId), [sql`(${projects.status} = 'archived')`, desc(projects.updatedAt)]);

/** The projects a person is assigned to. */
export const myProjects = (userId: string) => cards(sql`${projects.assignedTo} @> ${JSON.stringify([userId])}::jsonb`, [sql`(${projects.status} in ('completed', 'archived'))`, desc(projects.updatedAt)]);

export type DocumentSummary = { id: string; title: string; updatedAt: string; lastEditedBy: string; comments: number; pendingChanges: number; trackChanges: boolean; hasOriginal: boolean };
export type FileSummary = { id: string; fileName: string; size: number; mime: string; uploadedBy: string; uploadedById: string; createdAt: string };
export type ActivityItem = { id: string; action: string; who: string; details: Record<string, unknown>; at: string; projectId: string | null; projectNumber?: string | null };

export async function projectDetail(id: string) {
  if (!isUuid(id)) return null;
  const [p] = await db
    .select({ project: projects, domain: { id: domains.id, key: domains.key, name: domains.name, color: domains.color, icon: domains.icon } })
    .from(projects)
    .innerJoin(domains, eq(domains.id, projects.domainId))
    .where(eq(projects.id, id))
    .limit(1);
  if (!p) return null;
  const [docs, fileRows, log] = await Promise.all([
    db
      .select({
        id: documents.id,
        title: documents.title,
        updatedAt: documents.updatedAt,
        lastEditedBy: documents.lastEditedBy,
        trackChanges: documents.trackChanges,
        originalFileId: documents.originalFileId,
        comments: sql<number>`(select count(*)::int from eru_document_comments c where c.document_id = ${documents.id} and not c.resolved)`,
        pending: sql<number>`(select count(*)::int from eru_document_changes x where x.document_id = ${documents.id} and x.status = 'pending')`,
      })
      .from(documents)
      .where(eq(documents.projectId, id))
      .orderBy(desc(documents.updatedAt)),
    db.select().from(files).where(and(eq(files.projectId, id), isNull(files.documentId), eq(files.attached, true))).orderBy(desc(files.createdAt)),
    db.select().from(auditLogs).where(eq(auditLogs.projectId, id)).orderBy(desc(auditLogs.createdAt)).limit(40),
  ]);
  const people = await peopleByIds([p.project.createdBy, ...p.project.assignedTo, ...docs.map((d) => d.lastEditedBy), ...fileRows.map((f) => f.uploadedBy), ...log.map((l) => l.userId)]);
  return {
    project: { ...p.project, createdByName: nameOf(people, p.project.createdBy), createdAt: p.project.createdAt.toISOString(), updatedAt: p.project.updatedAt.toISOString() },
    domain: p.domain,
    assigned: p.project.assignedTo.map((uid) => ({ id: uid, name: nameOf(people, uid), email: people.get(uid)?.email ?? "" })),
    documents: docs.map(
      (d): DocumentSummary => ({
        id: d.id,
        title: d.title,
        updatedAt: d.updatedAt.toISOString(),
        lastEditedBy: nameOf(people, d.lastEditedBy),
        comments: d.comments,
        pendingChanges: d.pending,
        trackChanges: d.trackChanges,
        hasOriginal: !!d.originalFileId,
      }),
    ),
    files: fileRows.map((f): FileSummary => ({ id: f.id, fileName: f.fileName, size: f.size, mime: f.mime, uploadedBy: nameOf(people, f.uploadedBy), uploadedById: f.uploadedBy, createdAt: f.createdAt.toISOString() })),
    activity: log.map((l): ActivityItem => ({ id: l.id, action: l.action, who: nameOf(people, l.userId), details: l.details, at: l.createdAt.toISOString(), projectId: l.projectId })),
  };
}

export type CommentView = { id: string; userId: string; userName: string; content: string; quote: string; resolved: boolean; resolvedByName: string | null; createdAt: string };

/** Everything the editor page needs. */
export async function documentForEditor(id: string) {
  if (!isUuid(id)) return null;
  const [d] = await db
    .select({ doc: documents, project: { id: projects.id, number: projects.number, title: projects.title } })
    .from(documents)
    .innerJoin(projects, eq(projects.id, documents.projectId))
    .where(eq(documents.id, id))
    .limit(1);
  if (!d) return null;
  const comments = await db.select().from(documentComments).where(eq(documentComments.documentId, id)).orderBy(asc(documentComments.createdAt));
  const people = await peopleByIds([d.doc.lastEditedBy, ...comments.map((c) => c.userId), ...comments.map((c) => c.resolvedBy)]);
  return {
    doc: { id: d.doc.id, title: d.doc.title, content: d.doc.content, version: d.doc.version, trackChanges: d.doc.trackChanges, updatedAt: d.doc.updatedAt.toISOString(), lastEditedBy: nameOf(people, d.doc.lastEditedBy) },
    project: d.project,
    comments: comments.map(
      (c): CommentView => ({
        id: c.id,
        userId: c.userId,
        userName: nameOf(people, c.userId),
        content: c.content,
        quote: c.quote,
        resolved: c.resolved,
        resolvedByName: c.resolvedBy ? nameOf(people, c.resolvedBy) : null,
        createdAt: c.createdAt.toISOString(),
      }),
    ),
  };
}

/** For the .docx export: the stored content and title. */
export async function documentContent(id: string) {
  if (!isUuid(id)) return null;
  const [d] = await db.select({ title: documents.title, content: documents.content }).from(documents).where(eq(documents.id, id)).limit(1);
  return d ?? null;
}

// ── Admin ──────────────────────────────────────────────────────────────────

export async function adminKpis() {
  const monthStart = new Date(Date.now() + 330 * 60_000);
  const istMonth = Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), 1) - 330 * 60_000;
  const [r] = await db
    .select({
      total: count(),
      active: sql<number>`count(*) filter (where ${projects.status} = 'active')::int`,
      inReview: sql<number>`count(*) filter (where ${projects.status} = 'in_review')::int`,
      completedThisMonth: sql<number>`(select count(distinct a.project_id)::int from eru_audit_logs a join eru_projects p on p.id = a.project_id
        where p.status = 'completed' and a.action = 'project.update' and a.details->>'status' = 'Completed' and a.created_at >= ${new Date(istMonth).toISOString()})`,
    })
    .from(projects);
  const [pending] = await db.select({ n: count() }).from(documentChanges).where(eq(documentChanges.status, "pending"));
  return { total: Number(r?.total ?? 0), active: r?.active ?? 0, inReview: r?.inReview ?? 0, completedThisMonth: r?.completedThisMonth ?? 0, pendingChanges: Number(pending?.n ?? 0) };
}

/** Documents with tracked changes waiting for review, most first. */
export async function pendingReviewDocuments(limit = 8) {
  return db
    .select({ id: documents.id, title: documents.title, projectNumber: projects.number, pending: sql<number>`count(${documentChanges.id})::int` })
    .from(documentChanges)
    .innerJoin(documents, eq(documents.id, documentChanges.documentId))
    .innerJoin(projects, eq(projects.id, documents.projectId))
    .where(eq(documentChanges.status, "pending"))
    .groupBy(documents.id, projects.number)
    .orderBy(desc(sql`count(${documentChanges.id})`))
    .limit(limit);
}

export async function projectsByDomain() {
  return db
    .select({ name: domains.name, color: domains.color, projects: sql<number>`count(${projects.id})::int` })
    .from(domains)
    .leftJoin(projects, eq(projects.domainId, domains.id))
    .where(eq(domains.isActive, true))
    .groupBy(domains.id)
    .orderBy(asc(domains.sortOrder));
}

/** The latest history across every project (and module-wide events). */
export async function recentActivity(limit = 15): Promise<ActivityItem[]> {
  const rows = await db
    .select({ log: auditLogs, number: projects.number })
    .from(auditLogs)
    .leftJoin(projects, eq(projects.id, auditLogs.projectId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
  const people = await peopleByIds(rows.map((r) => r.log.userId));
  return rows.map((r) => ({ id: r.log.id, action: r.log.action, who: nameOf(people, r.log.userId), details: r.log.details, at: r.log.createdAt.toISOString(), projectId: r.log.projectId, projectNumber: r.number }));
}

export type ProjectFilters = { q: string; domain: string; status: string; priority: string; page: number };
export const PAGE_SIZE = 25;

export function readFilters(sp: Record<string, string | string[] | undefined>): ProjectFilters {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]) ?? "";
  const status = one("status");
  const priority = one("priority");
  return {
    q: one("q").trim().slice(0, 100),
    domain: /^[a-z0-9_]{1,60}$/.test(one("domain")) ? one("domain") : "",
    status: (STATUSES as string[]).includes(status) ? status : "",
    priority: (PRIORITIES as string[]).includes(priority) ? priority : "",
    page: Math.max(1, Math.min(1000, Math.floor(Number(one("page")) || 1))),
  };
}

/** Every project, filtered, a page at a time (for All Projects). */
export async function allProjects(f: ProjectFilters): Promise<{ rows: ProjectCard[]; total: number }> {
  const conds: SQL[] = [];
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conds.push(or(ilike(projects.title, like), ilike(projects.number, like))!);
  }
  if (f.domain) conds.push(eq(domains.key, f.domain));
  if (f.status) conds.push(eq(projects.status, f.status as ProjectStatus));
  if (f.priority) conds.push(eq(projects.priority, f.priority as Priority));
  const where = conds.length ? and(...conds) : undefined;
  const [{ n }] = await db.select({ n: count() }).from(projects).innerJoin(domains, eq(domains.id, projects.domainId)).where(where);
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .innerJoin(domains, eq(domains.id, projects.domainId))
    .where(where)
    .orderBy(desc(projects.updatedAt))
    .limit(PAGE_SIZE)
    .offset((f.page - 1) * PAGE_SIZE);
  const page = rows.length ? await cards(inArray(projects.id, rows.map((r) => r.id)), [desc(projects.updatedAt)]) : [];
  return { rows: page, total: Number(n) };
}

export async function settingsView() {
  const [all, [s]] = await Promise.all([db.select().from(domains).orderBy(asc(domains.sortOrder), asc(domains.name)), db.select().from(settings).where(eq(settings.id, 1))]);
  return { domains: all, trackChangesDefault: !!s?.trackChangesDefault };
}
