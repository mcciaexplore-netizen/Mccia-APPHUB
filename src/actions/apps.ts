"use server";

import { asc, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { appChecks, apps, userAppAccess, type AppStatus } from "@/db/schema";
import { adminAction, UserError } from "@/lib/action";
import { checkUrl } from "@/lib/app-checks";
import { writeAudit } from "@/lib/audit";
import { isApprovalsUrl } from "@/lib/approvals/approvals.manifest";
import { appInput, uuid } from "@/lib/validation";

async function nextOrder(departmentId: string) {
  const rows = await db.select({ s: apps.sortOrder }).from(apps).where(eq(apps.departmentId, departmentId));
  return rows.reduce((m, r) => Math.max(m, r.s), 0) + 10;
}

async function loadApp(id: string) {
  const [a] = await db.select().from(apps).where(eq(apps.id, uuid.parse(id)));
  if (!a) throw new UserError("Application not found.");
  return a;
}

export async function createApp(input: unknown) {
  return adminAction("apps", async (admin) => {
    const v = appInput.parse(input);
    const [a] = await db.insert(apps).values({ ...v, sortOrder: await nextOrder(v.departmentId) }).returning({ id: apps.id });
    await writeAudit(admin, [{ action: "app.create", targetType: "app", targetId: a.id, targetLabel: v.name, details: { status: v.status ?? "active", visible: v.isActive ?? true } }]);
  });
}

export async function updateApp(id: string, input: unknown) {
  return adminAction("apps", async (admin) => {
    const v = appInput.parse(input);
    const cur = await loadApp(id);
    const sortOrder = cur.departmentId === v.departmentId ? cur.sortOrder : await nextOrder(v.departmentId);
    await db.update(apps).set({ ...v, sortOrder }).where(eq(apps.id, cur.id));
    const changes: string[] = [];
    if (cur.name !== v.name) changes.push("name");
    if (cur.url !== v.url) changes.push("address"); // the address itself is not recorded
    if (cur.departmentId !== v.departmentId) changes.push("department");
    if (v.status && cur.status !== v.status) changes.push(`status ${cur.status} → ${v.status}`);
    if (v.isActive !== undefined && cur.isActive !== v.isActive) changes.push(v.isActive ? "shown in hub" : "hidden from hub");
    if (changes.length) await writeAudit(admin, [{ action: "app.update", targetType: "app", targetId: cur.id, targetLabel: v.name, details: { changed: changes } }]);
  });
}

/** Apps are never hard-deleted so the activity log keeps its history. */
export async function setAppActive(id: string, active: boolean) {
  return adminAction("apps", async (admin) => {
    const cur = await loadApp(id);
    await db.update(apps).set({ isActive: !!active }).where(eq(apps.id, cur.id));
    await writeAudit(admin, [{ action: active ? "app.show" : "app.hide", targetType: "app", targetId: cur.id, targetLabel: cur.name }]);
  });
}

/** What the administrator says the application is: working, still being tested, or down. Shown on its card; "unavailable" cannot be opened. */
export async function setAppStatus(id: string, status: AppStatus) {
  return adminAction("apps", async (admin) => {
    if (!["active", "testing", "unavailable"].includes(status)) throw new UserError("Choose Active, Under testing or Unavailable.");
    const cur = await loadApp(id);
    if (cur.status === status) return;
    await db.update(apps).set({ status }).where(eq(apps.id, cur.id));
    await writeAudit(admin, [{ action: "app.status", targetType: "app", targetId: cur.id, targetLabel: cur.name, details: { from: cur.status, to: status } }]);
  });
}

export async function moveApp(id: string, dir: "up" | "down") {
  return adminAction("apps", async () => {
    const cur = await loadApp(id);
    const list = await db.select({ id: apps.id }).from(apps).where(eq(apps.departmentId, cur.departmentId)).orderBy(asc(apps.sortOrder), asc(apps.name));
    const i = list.findIndex((a) => a.id === cur.id);
    const j = dir === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    await Promise.all(list.map((a, k) => db.update(apps).set({ sortOrder: k * 10 }).where(eq(apps.id, a.id))));
  });
}

/**
 * Permanently removes an application. People lose access to it and templates drop it; launches already logged stay in the
 * activity history as "Deleted application". To hide an application without losing any of that, deactivate it instead.
 */
export async function deleteApp(id: string) {
  return adminAction("apps", async (admin) => {
    const cur = await loadApp(id);
    const [{ n }] = await db.select({ n: count() }).from(userAppAccess).where(eq(userAppAccess.appId, cur.id));
    await db.delete(apps).where(eq(apps.id, cur.id));
    await writeAudit(admin, [{ action: "app.delete", targetType: "app", targetId: cur.id, targetLabel: cur.name, details: { peopleWhoLostAccess: n } }]);
  });
}

export type CheckOutcome = { id: string; name: string; ok: boolean; detail: string; httpStatus: number | null; durationMs: number };

async function checkOne(adminId: string, id: string): Promise<CheckOutcome> {
  const a = await loadApp(id);
  if (isApprovalsUrl(a.url) || a.url.startsWith("/")) throw new UserError(`"${a.name}" is a page inside the hub, not an external address, so there is nothing to check from outside.`);
  const r = await checkUrl(a.url);
  await db.insert(appChecks).values({ appId: a.id, checkedById: adminId, ok: r.ok, httpStatus: r.httpStatus, durationMs: r.durationMs, detail: r.detail });
  return { id: a.id, name: a.name, ok: r.ok, detail: r.detail, httpStatus: r.httpStatus, durationMs: r.durationMs };
}

/** Checks that one application's address answers over a valid secure connection. This proves the link works, not the application's features. */
export async function checkApp(id: string) {
  return adminAction("apps", async (admin) => {
    const r = await checkOne(admin.id, id);
    await writeAudit(admin, [{ action: "app.check", targetType: "app", targetId: r.id, targetLabel: r.name, details: { ok: r.ok, httpStatus: r.httpStatus } }]);
    return r;
  });
}

/** The same for every external application, a few at a time. */
export async function checkAllApps() {
  return adminAction("apps", async (admin): Promise<CheckOutcome[]> => {
    const list = await db.select({ id: apps.id, url: apps.url }).from(apps);
    const todo = list.filter((a) => !a.url.startsWith("/")).slice(0, 200);
    const out: CheckOutcome[] = [];
    for (let i = 0; i < todo.length; i += 4) out.push(...(await Promise.all(todo.slice(i, i + 4).map((a) => checkOne(admin.id, a.id)))));
    await writeAudit(admin, [{ action: "app.check", targetType: "system", targetLabel: `${out.length} applications`, details: { passed: out.filter((o) => o.ok).length, failed: out.filter((o) => !o.ok).length } }]);
    return out;
  });
}
