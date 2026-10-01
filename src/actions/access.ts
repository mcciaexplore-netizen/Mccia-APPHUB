"use server";

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { accessTemplateApps, accessTemplates, apps, userAppAccess, users } from "@/db/schema";
import { adminAction, UserError } from "@/lib/action";
import { uuid, uuidList } from "@/lib/validation";

type Admin = { id: string };

async function currentApps(userId: string) {
  const rows = await db.select({ appId: userAppAccess.appId }).from(userAppAccess).where(eq(userAppAccess.userId, userId));
  return new Set(rows.map((r) => r.appId));
}

async function grant(admin: Admin, userId: string, appIds: string[]) {
  if (appIds.length === 0) return;
  await db
    .insert(userAppAccess)
    .values(appIds.map((appId) => ({ userId, appId, grantedById: admin.id })))
    .onConflictDoNothing();
}

async function revoke(userId: string, appIds: string[]) {
  if (appIds.length === 0) return;
  await db.delete(userAppAccess).where(and(eq(userAppAccess.userId, userId), inArray(userAppAccess.appId, appIds)));
}

/** Makes the user's access exactly `want` (ids that do not exist are rejected). */
async function setExactly(admin: Admin, userId: string, want: string[]) {
  const have = await currentApps(userId);
  const wantSet = new Set(want);
  await revoke(userId, [...have].filter((id) => !wantSet.has(id)));
  await grant(admin, userId, want.filter((id) => !have.has(id)));
}

async function assertAppsExist(ids: string[]) {
  if (ids.length === 0) return;
  const rows = await db.select({ id: apps.id }).from(apps).where(inArray(apps.id, ids));
  if (rows.length !== new Set(ids).size) throw new UserError("One or more applications no longer exist. Reload and try again.");
}

async function assertUsersExist(ids: string[]) {
  if (ids.length === 0) return;
  const rows = await db.select({ id: users.id }).from(users).where(inArray(users.id, ids));
  if (rows.length !== new Set(ids).size) throw new UserError("One or more users no longer exist. Reload and try again.");
}

/** Per-user screen: replace this user's access with the ticked apps. */
export async function setUserAccess(userId: string, appIds: unknown) {
  return adminAction(async (admin) => {
    const id = uuid.parse(userId);
    const want = [...new Set(uuidList.parse(appIds))];
    await assertUsersExist([id]);
    await assertAppsExist(want);
    await setExactly(admin, id, want);
  });
}

const bulkInput = z.object({
  userIds: uuidList.min(1, "Select at least one user"),
  appIds: uuidList,
  mode: z.enum(["add", "remove", "replace"]),
});

/** Apply an access set to several users at once: add to, remove from, or replace what they have. */
export async function bulkAssign(input: unknown) {
  return adminAction(async (admin) => {
    const v = bulkInput.parse(input);
    const userIds = [...new Set(v.userIds)];
    const appIds = [...new Set(v.appIds)];
    if (appIds.length === 0 && v.mode !== "replace") throw new UserError("Select at least one application");
    await assertUsersExist(userIds);
    await assertAppsExist(appIds);
    for (const uid of userIds) {
      if (v.mode === "add") await grant(admin, uid, appIds);
      else if (v.mode === "remove") await revoke(uid, appIds);
      else await setExactly(admin, uid, appIds);
    }
    return { users: userIds.length };
  });
}

/** Per-app screen: add and remove users in bulk. */
export async function changeAppUsers(appId: string, input: unknown) {
  return adminAction(async (admin) => {
    const id = uuid.parse(appId);
    const v = z.object({ add: uuidList, remove: uuidList }).parse(input);
    await assertAppsExist([id]);
    await assertUsersExist([...v.add, ...v.remove]);
    for (const uid of new Set(v.add)) await grant(admin, uid, [id]);
    for (const uid of new Set(v.remove)) await revoke(uid, [id]);
  });
}

const templateInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  appIds: uuidList,
});

export async function createTemplate(input: unknown) {
  return adminAction(async () => {
    const v = templateInput.parse(input);
    const appIds = [...new Set(v.appIds)];
    await assertAppsExist(appIds);
    const [t] = await db.insert(accessTemplates).values({ name: v.name }).returning({ id: accessTemplates.id });
    if (appIds.length) await db.insert(accessTemplateApps).values(appIds.map((appId) => ({ templateId: t.id, appId })));
  });
}

export async function updateTemplate(id: string, input: unknown) {
  return adminAction(async () => {
    const tid = uuid.parse(id);
    const v = templateInput.parse(input);
    const appIds = [...new Set(v.appIds)];
    await assertAppsExist(appIds);
    await db.update(accessTemplates).set({ name: v.name }).where(eq(accessTemplates.id, tid));
    await db.delete(accessTemplateApps).where(eq(accessTemplateApps.templateId, tid));
    if (appIds.length) await db.insert(accessTemplateApps).values(appIds.map((appId) => ({ templateId: tid, appId })));
  });
}

export async function deleteTemplate(id: string) {
  return adminAction(async () => {
    await db.delete(accessTemplates).where(eq(accessTemplates.id, uuid.parse(id)));
  });
}

/** Copies a template onto users. They can be customised afterwards on the per-user screen. */
export async function applyTemplate(input: unknown) {
  return adminAction(async (admin) => {
    const v = z
      .object({ templateId: uuid, userIds: uuidList.min(1, "Select at least one user"), mode: z.enum(["add", "replace"]) })
      .parse(input);
    const rows = await db.select({ appId: accessTemplateApps.appId }).from(accessTemplateApps).where(eq(accessTemplateApps.templateId, v.templateId));
    const appIds = rows.map((r) => r.appId);
    await assertUsersExist(v.userIds);
    for (const uid of new Set(v.userIds)) {
      if (v.mode === "add") await grant(admin, uid, appIds);
      else await setExactly(admin, uid, appIds);
    }
    return { users: new Set(v.userIds).size };
  });
}
