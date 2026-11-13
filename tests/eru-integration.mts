/**
 * Integration test of the ERU module's server code against a real Postgres, calling its functions directly (no browser, no web server):
 * projects and their numbers, who may change what, documents (create, save, version conflicts, the change records kept in step with the
 * content, the guard against removing other people's tracked changes, reviews), comments, track changes on/off, and the Members page's
 * changes to the hub's own lists for ERU (with their access audit).
 *
 * It WRITES to the database, so point it at a scratch database, never the live one:
 *   INTEGRATION_DB_CONFIRM=yes INTEGRATION_DATABASE_URL=postgres://localhost:5432/scratch npm run test:integration:eru
 * The scratch database needs every migration applied first (npx drizzle-kit migrate, with DATABASE_URL pointing at it). Everything it
 * creates is named "ZZE"/"zze-" and is removed when it finishes (and at the start, if an earlier run was interrupted). The project's own
 * .env is NOT read, so it cannot reach the live database by accident. File uploads need storage and are covered by the browser test.
 */
import { randomUUID } from "node:crypto";

const url = process.env.INTEGRATION_DATABASE_URL;
if (process.env.INTEGRATION_DB_CONFIRM !== "yes" || !url) {
  console.error("Set INTEGRATION_DATABASE_URL to a scratch database and INTEGRATION_DB_CONFIRM=yes (this test writes to it).");
  process.exit(2);
}
if (/neon\.tech|supabase\.co/i.test(url) && process.env.INTEGRATION_ALLOW_REMOTE !== "yes") {
  console.error("Refusing: that looks like a hosted database. Use a local scratch database (or INTEGRATION_ALLOW_REMOTE=yes for a test branch).");
  process.exit(2);
}
process.env.DATABASE_URL = url;
process.env.DB_DRIVER = process.env.INTEGRATION_DB_DRIVER ?? "pg";
process.env.ERU_ENABLED = "true";
delete process.env.SMTP_HOST;

const { and, eq, inArray, like, sql } = await import("drizzle-orm");
const { db } = await import("../src/db");
const H = await import("../src/db/schema");
const T = await import("../src/db/eru-schema");
const P = await import("../src/lib/eru/projects");
const D = await import("../src/lib/eru/documents");
const A = await import("../src/lib/eru/admin");
const { listTeam } = await import("../src/lib/eru/host-adapter");
const { projectDetail, documentForEditor, allProjects, readFilters } = await import("../src/lib/eru/queries");
const { isAdmin, isMember, isSuperAdmin } = await import("../src/lib/eru/eru.manifest");

type Roles = ("eru_member" | "eru_admin" | "eru_super_admin")[];
let ok = 0;
let bad = 0;
const check = (name: string, pass: unknown, extra: unknown = "") => {
  if (pass) ok++;
  else bad++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || extra === "" ? "" : `  -> ${JSON.stringify(extra).slice(0, 300)}`}`);
};
const refused = async (fn: () => Promise<unknown>, pattern: RegExp) => {
  try {
    await fn();
    return "not refused";
  } catch (e) {
    return pattern.test((e as Error).message) ? true : (e as Error).message;
  }
};

async function cleanup() {
  const people = (await db.select({ id: H.users.id }).from(H.users).where(like(H.users.email, "zze-%"))).map((u) => u.id);
  if (people.length) {
    const projects = await db.select({ id: T.projects.id }).from(T.projects).where(sql`${T.projects.createdBy} in ${people}`);
    if (projects.length) await db.delete(T.projects).where(inArray(T.projects.id, projects.map((p) => p.id)));
    await db.delete(T.auditLogs).where(inArray(T.auditLogs.userId, people));
    await db.delete(T.files).where(inArray(T.files.uploadedBy, people));
    await db.delete(H.hubNotifications).where(inArray(H.hubNotifications.userId, people));
    await db.delete(H.accessAudit).where(inArray(H.accessAudit.actorId, people));
  }
  await db.delete(H.users).where(like(H.users.email, "zze-%"));
  await db.delete(H.apps).where(like(H.apps.name, "ZZE%"));
  await db.delete(H.departments).where(like(H.departments.name, "ZZE%"));
  await db.update(T.domains).set({ isActive: true }).where(eq(T.domains.key, "quality_check"));
}

type Who = { id: string; name: string; email: string; hubRole: "member"; roles: Roles };
const session = (u: Who) => ({ ...u, member: isMember(u.roles), admin: isAdmin(u.roles), superAdmin: isSuperAdmin(u.roles) });

await cleanup();
try {
  // ── The hub side: two applications and three people ──────────────────
  const [dept] = await db.insert(H.departments).values({ name: `ZZE Research ${randomUUID().slice(0, 6)}`, icon: "book" }).returning();
  const [eruApp] = await db.insert(H.apps).values({ departmentId: dept.id, name: "ZZE ERU", url: "/eru", icon: "book" }).returning();
  const [eruAdminApp] = await db.insert(H.apps).values({ departmentId: dept.id, name: "ZZE ERU Admin", url: "/eru/admin", icon: "book" }).returning();
  const mk = async (tag: string, name: string) => (await db.insert(H.users).values({ name, email: `zze-${tag}-${randomUUID().slice(0, 6)}@mcciapune.com`, role: "member" }).returning())[0];
  const [mem, other, adm, newbie] = [await mk("member", "ZZE Asha Member"), await mk("other", "ZZE Ravi Other"), await mk("admin", "ZZE Meera Admin"), await mk("new", "ZZE Kiran New")];
  for (const u of [mem, other, adm]) await db.insert(H.userAppAccess).values({ userId: u.id, appId: eruApp.id });
  await db.insert(H.appStaff).values([{ appId: eruApp.id, userId: mem.id }, { appId: eruApp.id, userId: other.id }]);
  await db.insert(H.appAdmins).values({ appId: eruApp.id, userId: adm.id });
  const who = (u: typeof mem, roles: Roles): Who => ({ id: u.id, name: u.name, email: u.email, hubRole: "member", roles });
  const M = session(who(mem, ["eru_member"]));
  const O = session(who(other, ["eru_member"]));
  const AD = session(who(adm, ["eru_member", "eru_admin"]));

  const team = await listTeam();
  const mine = team.filter((t) => [mem.id, other.id, adm.id].includes(t.id));
  check("team: App Staff and App Admins of ERU who hold it, with their role", mine.length === 3 && mine.find((t) => t.id === adm.id)?.role === "admin" && mine.find((t) => t.id === mem.id)?.role === "member", mine);

  // ── Projects ──────────────────────────────────────────────────────────
  const domains = await db.select().from(T.domains);
  check("domains: the five seeded domains are there", ["policy_research", "primary_service", "research_papers", "quality_check", "internal_support"].every((k) => domains.some((d) => d.key === k)), domains.map((d) => d.key));
  const policy = domains.find((d) => d.key === "policy_research")!;
  const p1 = await P.createProject(M, { title: "ZZE Credit survey", domainId: policy.id, priority: "high", tags: ["msme"], referenceLinks: ["https://example.org/a"] });
  const p2 = await P.createProject(M, { title: "ZZE Second project", domainId: policy.id });
  check("projects: numbered ERU-NNNN, one after the other", /^ERU-\d{4,}$/.test(p1.number) && Number(p2.number.slice(4)) === Number(p1.number.slice(4)) + 1, [p1.number, p2.number]);
  const [row1] = await db.select().from(T.projects).where(eq(T.projects.id, p1.id));
  check("projects: the creator is assigned, status active, priority as chosen", JSON.stringify(row1.assignedTo) === JSON.stringify([mem.id]) && row1.status === "active" && row1.priority === "high", row1);
  await db.update(T.domains).set({ isActive: false }).where(eq(T.domains.key, "quality_check"));
  const qc = domains.find((d) => d.key === "quality_check")!;
  check("projects: not in a domain that is switched off", await refused(() => P.createProject(M, { title: "ZZE Hidden", domainId: qc.id }), /not available/));
  await db.update(T.domains).set({ isActive: true }).where(eq(T.domains.key, "quality_check"));
  await P.updateDetails(M, p1.id, { title: "ZZE Credit survey 2026", description: "Scope", tags: ["msme", "credit"], referenceLinks: [] });
  check("projects: a member edits the details", (await db.select().from(T.projects).where(eq(T.projects.id, p1.id)))[0].title === "ZZE Credit survey 2026");
  check("projects: a member cannot change status or who is assigned", (await refused(() => P.manageProject(M, p1.id, { status: "completed" }), /ERU admin/)) === true && (await refused(() => P.setAssignees(M, p1.id, [mem.id, other.id]), /ERU admin/)) === true);
  check("projects: only people in the team can be assigned", await refused(() => P.setAssignees(AD, p1.id, [mem.id, newbie.id]), /Only members of the ERU team/));
  await P.setAssignees(AD, p1.id, [mem.id, other.id]);
  await P.manageProject(AD, p1.id, { status: "in_review", priority: "urgent", dueDate: "2026-12-31" });
  const [row1b] = await db.select().from(T.projects).where(eq(T.projects.id, p1.id));
  check("projects: an admin assigns, and changes status, priority and due date", row1b.assignedTo.length === 2 && row1b.status === "in_review" && row1b.priority === "urgent" && row1b.dueDate === "2026-12-31", row1b);
  const notices = await db.select().from(H.hubNotifications).where(eq(H.hubNotifications.userId, other.id));
  check("projects: the newly assigned person is told (hub bell)", notices.some((n) => n.kind === "eru" && /assigned/i.test(n.title)), notices);
  const found = await allProjects({ ...readFilters({ q: p1.number }), page: 1 });
  check("All Projects: search by number finds it", found.rows.some((r) => r.id === p1.id), found.total);

  // ── Documents ─────────────────────────────────────────────────────────
  const d1 = await D.createDocument(M, p1.id, { title: "ZZE Policy note" });
  const [doc1] = await db.select().from(T.documents).where(eq(T.documents.id, d1.id));
  check("documents: a new blank document, version 1, tracking off by default", doc1.version === 1 && doc1.trackChanges === false && (doc1.content as { type: string }).type === "doc", doc1);
  const text = (t: string, marks?: unknown[]) => ({ type: "text", text: t, ...(marks ? { marks } : {}) });
  const para = (...c: unknown[]) => ({ type: "paragraph", content: c });
  const plain = { type: "doc", content: [para(text("The economy grew "), text("fast", [{ type: "bold" }]), text(" this year."))] };
  const s1 = await D.saveDocument(M, d1.id, { content: plain, title: "ZZE Policy note v2", baseVersion: 1 });
  check("documents: saving moves the version on and keeps the title", s1.version === 2 && (await documentForEditor(d1.id))?.doc.title === "ZZE Policy note v2", s1);
  check("documents: a save from an older version is refused (no silent overwrite)", await refused(() => D.saveDocument(O, d1.id, { content: plain, baseVersion: 1 }), /changed by someone else/));
  check("documents: content the editor does not support is refused", await refused(() => D.saveDocument(M, d1.id, { content: { type: "doc", content: [{ type: "iframe" }] }, baseVersion: 2 }), /does not support/));
  check("documents: something that is not a document is refused", await refused(() => D.saveDocument(M, d1.id, { content: "<p>hi</p>", baseVersion: 2 }), /could not be read/));

  // Track changes: on by a member, off only by an admin
  await D.setTrackChanges(M, d1.id, true);
  check("track changes: a member switches it on, but cannot switch it off", (await db.select().from(T.documents).where(eq(T.documents.id, d1.id)))[0].trackChanges && (await refused(() => D.setTrackChanges(M, d1.id, false), /Only an ERU admin/)) === true);
  const insId = randomUUID();
  const delId = randomUUID();
  const ins = (id: string, u: { id: string; name: string }) => ({ type: "eruInsertion", attrs: { id, userId: u.id, userName: u.name, at: new Date().toISOString() } });
  const del = (id: string, u: { id: string; name: string }) => ({ type: "eruDeletion", attrs: { id, userId: u.id, userName: u.name, at: new Date().toISOString() } });
  const tracked = { type: "doc", content: [para(text("The economy grew "), text("fast", [{ type: "bold" }, del(delId, mem)]), text("steadily", [ins(insId, mem)]), text(" this year."))] };
  const s2 = await D.saveDocument(M, d1.id, { content: tracked, baseVersion: 2 });
  const changes = await db.select().from(T.documentChanges).where(eq(T.documentChanges.documentId, d1.id));
  check("change records: one per tracked change, pending, with who and what", changes.length === 2 && changes.every((c) => c.status === "pending" && c.userId === mem.id) && changes.some((c) => c.changeType === "insertion" && c.toContent === "steadily") && changes.some((c) => c.changeType === "deletion" && c.fromContent === "fast"), changes);
  const forged = { type: "doc", content: [para(text("The economy grew "), text("fast", [{ type: "bold" }, del(delId, mem)]), text("steadily", [ins(insId, mem)]), text(" really", [ins(randomUUID(), mem)]), text(" this year."))] };
  check("change records: a new change must be the saver's own (no changes in someone else's name)", await refused(() => D.saveDocument(O, d1.id, { content: forged, baseVersion: s2.version }), /Someone else's tracked change/));
  check("change records: a member cannot remove someone else's pending changes by saving without them", await refused(() => D.saveDocument(O, d1.id, { content: plain, baseVersion: s2.version }), /Only an ERU admin can accept or reject/));
  const ownId = randomUUID();
  const s3 = await D.saveDocument(O, d1.id, { content: { type: "doc", content: [...tracked.content, para(text("Ravi's line", [ins(ownId, other)]))] }, baseVersion: s2.version });
  const s4 = await D.saveDocument(O, d1.id, { content: tracked, baseVersion: s3.version });
  check("change records: withdrawing your own pending change (undo) removes its record", (await db.select().from(T.documentChanges).where(eq(T.documentChanges.id, ownId))).length === 0 && s4.version === s3.version + 1);

  // Review
  check("review: a member cannot accept or reject", await refused(() => D.reviewChanges(M, d1.id, { baseVersion: s4.version, ids: null, decision: "accept" }), /Only an ERU admin/));
  check("review: refused when the admin's copy is out of date", await refused(() => D.reviewChanges(AD, d1.id, { baseVersion: s4.version - 1, ids: [insId], decision: "accept" }), /changed by someone else/));
  const r1 = await D.reviewChanges(AD, d1.id, { baseVersion: s4.version, ids: [insId], decision: "accept" });
  const textOf = (c: unknown) => JSON.stringify(c).match(/"text":"[^"]*"/g)?.map((m) => m.slice(8, -1)).join("") ?? "";
  const afterAccept = await db.select().from(T.documentChanges).where(eq(T.documentChanges.documentId, d1.id));
  check("review: accepting one insertion keeps its text, unmarked; the deletion stays pending", r1.decided === 1 && r1.version === s4.version + 1 && textOf(r1.content) === "The economy grew faststeadily this year." && !JSON.stringify(r1.content).includes(insId) && JSON.stringify(r1.content).includes(delId) && afterAccept.find((c) => c.id === insId)?.status === "accepted" && afterAccept.find((c) => c.id === delId)?.status === "pending", { r1, afterAccept });
  const r2 = await D.reviewChanges(AD, d1.id, { baseVersion: r1.version, ids: null, decision: "reject" });
  const afterReject = await db.select().from(T.documentChanges).where(eq(T.documentChanges.id, delId));
  check("review: rejecting the deletion brings the text back; the record says who reviewed it", textOf(r2.content) === "The economy grew faststeadily this year." && afterReject[0].status === "rejected" && afterReject[0].reviewedBy === adm.id, { r2, afterReject });
  const told = await db.select().from(H.hubNotifications).where(eq(H.hubNotifications.userId, mem.id));
  check("review: the author is told their changes were accepted / rejected", told.some((n) => /accepted/.test(n.title)) && told.some((n) => /rejected/.test(n.title)), told.map((n) => n.title));
  await D.setTrackChanges(AD, d1.id, false);
  check("track changes: an admin switches it off", !(await db.select().from(T.documents).where(eq(T.documents.id, d1.id)))[0].trackChanges);

  // Comments
  const c1 = await D.addComment(O, d1.id, { content: "Source for this figure?", from: 1, to: 12, quote: "The economy" });
  check("comments: added, with the quoted text; the document's author is told", (await documentForEditor(d1.id))?.comments.some((c) => c.id === c1.id && c.quote === "The economy" && c.userName === other.name) && (await db.select().from(H.hubNotifications).where(eq(H.hubNotifications.userId, mem.id))).some((n) => /comment/i.test(n.title)));
  check("comments: an empty comment is refused", await refused(() => D.addComment(O, d1.id, { content: "  ", from: 1, to: 2, quote: "" }), /Write the comment/));
  check("comments: only the author or an admin resolves", await refused(() => D.resolveComment(M, c1.id, true), /author or an ERU admin/));
  await D.resolveComment(O, c1.id, true);
  const [cr] = await db.select().from(T.documentComments).where(eq(T.documentComments.id, c1.id));
  check("comments: resolved by its author, with who and when", cr.resolved && cr.resolvedBy === other.id && !!cr.resolvedAt, cr);
  await D.deleteComment(AD, c1.id);
  check("comments: an admin deletes", (await db.select().from(T.documentComments).where(eq(T.documentComments.id, c1.id))).length === 0);

  const detail = await projectDetail(p1.id);
  check("project page: documents with their counts, and the history", detail?.documents.length === 1 && detail.documents[0].title === "ZZE Policy note v2" && detail.activity.some((a) => a.action === "changes.accepted") && detail.activity.some((a) => a.action === "project.create"), detail?.activity.map((a) => a.action));

  // ── The Members page: the hub's own lists ─────────────────────────────
  await A.setMemberRole(AD, newbie.id, "member");
  const staffRow = await db.select().from(H.appStaff).where(and(eq(H.appStaff.appId, eruApp.id), eq(H.appStaff.userId, newbie.id)));
  const grant = await db.select().from(H.userAppAccess).where(and(eq(H.userAppAccess.userId, newbie.id), eq(H.userAppAccess.appId, eruApp.id)));
  check("members: adding someone makes them App Staff of ERU and gives them ERU", staffRow.length === 1 && grant.length === 1);
  await A.setMemberRole(AD, newbie.id, "admin");
  const adminRow = await db.select().from(H.appAdmins).where(and(eq(H.appAdmins.appId, eruApp.id), eq(H.appAdmins.userId, newbie.id)));
  const adminGrant = await db.select().from(H.userAppAccess).where(and(eq(H.userAppAccess.userId, newbie.id), eq(H.userAppAccess.appId, eruAdminApp.id)));
  const stillStaff = await db.select().from(H.appStaff).where(and(eq(H.appStaff.appId, eruApp.id), eq(H.appStaff.userId, newbie.id)));
  check("members: making them admin moves them to App Admins and gives them ERU Admin", adminRow.length === 1 && adminGrant.length === 1 && stillStaff.length === 0);
  await A.setMemberRole(AD, newbie.id, "member");
  check("members: back to member takes ERU Admin away again", (await db.select().from(H.userAppAccess).where(and(eq(H.userAppAccess.userId, newbie.id), eq(H.userAppAccess.appId, eruAdminApp.id)))).length === 0);
  await A.removeMember(AD, newbie.id);
  const left = await db.select().from(H.userAppAccess).where(and(eq(H.userAppAccess.userId, newbie.id), inArray(H.userAppAccess.appId, [eruApp.id, eruAdminApp.id])));
  check("members: removing takes both lists and both applications away", left.length === 0 && (await listTeam()).every((t) => t.id !== newbie.id));
  const audits = await db.select().from(H.accessAudit).where(and(eq(H.accessAudit.actorId, adm.id), eq(H.accessAudit.action, "eru.members")));
  check("members: every change is in the hub's access audit", audits.length === 4, audits.length);
  check("members: an admin cannot demote or remove themselves", (await refused(() => A.setMemberRole(AD, adm.id, "member"), /your own admin role/)) === true && (await refused(() => A.removeMember(AD, adm.id), /cannot remove yourself/)) === true);
  check("members: a member cannot manage the team", await refused(() => A.setMemberRole(M, newbie.id, "member"), /admins only/));

  // ── Deleting ──────────────────────────────────────────────────────────
  check("delete: a member cannot delete a document or a project", (await refused(() => D.deleteDocument(M, d1.id), /Only an ERU admin/)) === true && (await refused(() => P.deleteProject(M, p1.id), /Only an ERU admin/)) === true);
  await D.deleteDocument(AD, d1.id);
  check("delete: the document goes with its comments and change records", (await db.select().from(T.documentChanges).where(eq(T.documentChanges.documentId, d1.id))).length === 0 && (await db.select().from(T.documents).where(eq(T.documents.id, d1.id))).length === 0);
  const d2 = await D.createDocument(M, p2.id, { title: "ZZE To go" });
  await P.deleteProject(AD, p2.id);
  check("delete: deleting a project takes its documents too", (await db.select().from(T.documents).where(eq(T.documents.id, d2.id))).length === 0);
} catch (e) {
  bad++;
  console.error("FAIL crashed:", e);
} finally {
  await cleanup();
}
console.log(`\n${ok}/${ok + bad} ERU integration checks passed`);
process.exit(bad ? 1 : 0);
