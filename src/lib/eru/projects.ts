import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, rowsOf } from "./db";
import { domains, files, projects, type Priority, type ProjectStatus } from "@/db/eru-schema";
import { EruError, type SessionUser } from "./dal";
import { audit } from "./audit";
import { claimFile, deleteFiles } from "./files";
import { can, checkProject, cleanTags, formatProjectNumber, isUuid, MAX_ASSIGNEES, PRIORITIES, STATUSES, PRIORITY_LABEL, STATUS_LABEL, type ProjectInput } from "./eru.manifest";
import { listTeam, notify } from "./host-adapter";

/**
 * Projects. Anyone in the ERU team creates projects and edits their description, tags and links; ERU admins also change the status,
 * priority, due date and who is assigned, and delete projects. The person who creates a project is assigned to it.
 */

async function projectRow(id: string) {
  if (!isUuid(id)) throw new EruError("That project no longer exists.");
  const [p] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!p) throw new EruError("That project no longer exists.");
  return p;
}

async function activeDomain(id: string) {
  const [d] = await db.select({ id: domains.id, key: domains.key }).from(domains).where(and(eq(domains.id, id), eq(domains.isActive, true))).limit(1);
  if (!d) throw new EruError("That domain is not available. Choose another.");
  return d;
}

/** Only people in the ERU team can be assigned. */
async function checkAssignees(ids: string[]): Promise<string[]> {
  const want = [...new Set(ids.filter(isUuid))];
  if (want.length > MAX_ASSIGNEES) throw new EruError(`Assign at most ${MAX_ASSIGNEES} people.`);
  if (!want.length) return [];
  const team = new Set((await listTeam()).map((t) => t.id));
  const outside = want.filter((w) => !team.has(w));
  if (outside.length) throw new EruError("Only members of the ERU team can be assigned. Add them on the Members page first.");
  return want;
}

export async function createProject(u: SessionUser, input: ProjectInput & { assignedTo?: string[] }): Promise<{ id: string; number: string; domainKey: string }> {
  if (!can.createProject(u.roles)) throw new EruError("ERU team members only.");
  const r = checkProject(input);
  if (!r.ok) throw new EruError(r.error);
  const d = await activeDomain(r.value.domainId);
  const others = u.admin ? await checkAssignees(input.assignedTo ?? []) : [];
  const assignedTo = [u.id, ...others.filter((o) => o !== u.id)];
  const seq = rowsOf<{ n: string }>(await db.execute(sql`select nextval('eru_project_seq') as n`))[0];
  const number = formatProjectNumber(Number(seq.n));
  const [p] = await db
    .insert(projects)
    .values({ ...r.value, status: r.value.status === "archived" || r.value.status === "completed" ? "active" : r.value.status, number, createdBy: u.id, assignedTo })
    .returning({ id: projects.id });
  await audit(p.id, u.id, "project.create", { number, title: r.value.title });
  await notifyAssigned(u, p.id, number, r.value.title, others.filter((o) => o !== u.id));
  return { id: p.id, number, domainKey: d.key };
}

async function notifyAssigned(u: SessionUser, projectId: string, number: string, title: string, people: string[]) {
  await notify(people.map((userId) => ({ userId, title: `You were assigned to ${number}`, body: `${u.name} assigned you to "${title}".`, link: `/eru/projects/${projectId}`, key: `assign:${projectId}:${userId}:${Date.now()}` })));
}

/** Title, description, tags and links: anyone in the team. */
export async function updateDetails(u: SessionUser, id: string, input: { title: string; description: string; tags: string[]; referenceLinks: string[] }): Promise<void> {
  if (!can.editProjectDetails(u.roles)) throw new EruError("ERU team members only.");
  const p = await projectRow(id);
  const r = checkProject({ ...input, domainId: p.domainId, priority: p.priority, status: p.status, dueDate: p.dueDate });
  if (!r.ok) throw new EruError(r.error);
  await db
    .update(projects)
    .set({ title: r.value.title, description: r.value.description, tags: cleanTags(input.tags), referenceLinks: r.value.referenceLinks, updatedAt: new Date() })
    .where(eq(projects.id, id));
  await audit(id, u.id, "project.details", { title: r.value.title });
}

export type ManagePatch = { status?: ProjectStatus; priority?: Priority; dueDate?: string | null; domainId?: string };

/** Status, priority, due date and domain: ERU admins. */
export async function manageProject(u: SessionUser, id: string, patch: ManagePatch): Promise<void> {
  if (!can.manageProject(u.roles)) throw new EruError("Only an ERU admin can change this.");
  const p = await projectRow(id);
  const set: Partial<typeof projects.$inferInsert> = {};
  const changed: Record<string, string> = {};
  if (patch.status !== undefined && patch.status !== p.status) {
    if (!STATUSES.includes(patch.status)) throw new EruError("Choose a status.");
    set.status = patch.status;
    changed.status = STATUS_LABEL[patch.status];
  }
  if (patch.priority !== undefined && patch.priority !== p.priority) {
    if (!PRIORITIES.includes(patch.priority)) throw new EruError("Choose a priority.");
    set.priority = patch.priority;
    changed.priority = PRIORITY_LABEL[patch.priority];
  }
  if (patch.dueDate !== undefined && patch.dueDate !== p.dueDate) {
    if (patch.dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(patch.dueDate) || Number.isNaN(Date.parse(patch.dueDate)))) throw new EruError("The due date is not a valid date.");
    set.dueDate = patch.dueDate || null;
    changed.dueDate = patch.dueDate || "none";
  }
  if (patch.domainId !== undefined && patch.domainId !== p.domainId) {
    if (!isUuid(patch.domainId)) throw new EruError("Choose a domain.");
    const d = await activeDomain(patch.domainId);
    set.domainId = d.id;
    changed.domain = d.key;
  }
  if (!Object.keys(set).length) return;
  await db.update(projects).set({ ...set, updatedAt: new Date() }).where(eq(projects.id, id));
  await audit(id, u.id, "project.update", changed);
}

/** Who is assigned: ERU admins. Newly assigned people are told. */
export async function setAssignees(u: SessionUser, id: string, userIds: string[]): Promise<void> {
  if (!can.manageProject(u.roles)) throw new EruError("Only an ERU admin can change who is assigned.");
  const p = await projectRow(id);
  const next = await checkAssignees(userIds);
  const before = new Set(p.assignedTo);
  const added = next.filter((x) => !before.has(x));
  const removed = p.assignedTo.filter((x) => !next.includes(x));
  if (!added.length && !removed.length) return;
  await db.update(projects).set({ assignedTo: next, updatedAt: new Date() }).where(eq(projects.id, id));
  await audit(id, u.id, "project.assignees", { added: added.length, removed: removed.length });
  await notifyAssigned(u, id, p.number, p.title, added.filter((a) => a !== u.id));
}

/** A file uploaded to a project (not a document). */
export async function addProjectFile(u: SessionUser, projectId: string, fileId: string): Promise<void> {
  if (!can.editDocument(u.roles)) throw new EruError("ERU team members only.");
  const p = await projectRow(projectId);
  if (!isUuid(fileId)) throw new EruError("The uploaded file could not be found. Please upload it again.");
  const f = await claimFile(u.id, fileId, { projectId: p.id });
  await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, p.id));
  await audit(p.id, u.id, "file.upload", { fileName: f.fileName });
}

/** Removes a project file: whoever uploaded it, or an ERU admin. A document's original upload goes with the document, not here. */
export async function removeProjectFile(u: SessionUser, fileId: string): Promise<{ projectId: string }> {
  if (!isUuid(fileId)) throw new EruError("That file no longer exists.");
  const [f] = await db.select().from(files).where(and(eq(files.id, fileId), isNull(files.documentId))).limit(1);
  if (!f || !f.projectId) throw new EruError("That file no longer exists.");
  if (f.uploadedBy !== u.id && !can.manageProject(u.roles)) throw new EruError("Only whoever uploaded it, or an ERU admin, can remove this file.");
  await deleteFiles([f.id]);
  await audit(f.projectId, u.id, "file.remove", { fileName: f.fileName });
  return { projectId: f.projectId };
}

/** Deletes a project with its documents, comments, change records and files (ERU admins). */
export async function deleteProject(u: SessionUser, id: string): Promise<{ domainKey: string }> {
  if (!can.deleteProject(u.roles)) throw new EruError("Only an ERU admin can delete a project.");
  const p = await projectRow(id);
  const [d] = await db.select({ key: domains.key }).from(domains).where(eq(domains.id, p.domainId));
  const owned = await db.select({ id: files.id }).from(files).where(eq(files.projectId, id));
  await db.delete(projects).where(eq(projects.id, id));
  await deleteFiles(owned.map((f) => f.id));
  await audit(null, u.id, "project.delete", { number: p.number, title: p.title });
  return { domainKey: d?.key ?? "" };
}
