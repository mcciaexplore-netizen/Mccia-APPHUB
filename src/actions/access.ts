"use server";

import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { accessTemplateApps, accessTemplates, apps } from "@/db/schema";
import { applyAppRoles, applyAppUserChange, applyAppUserRole } from "@/lib/access-ops";
import { adminAction, UserError } from "@/lib/action";
import { writeAudit } from "@/lib/audit";
import { SSO_ROLES } from "@/lib/sso-rules";
import { uuid, uuidList } from "@/lib/validation";

/**
 * The per-application screen and the access templates. Changing a person's access (one person, many people, a team) lives in
 * people.ts; everything here goes through src/lib/access-ops.ts too, so it is atomic, scoped and audited.
 */

async function assertAppsExist(ids: string[]) {
  if (ids.length === 0) return;
  const rows = await db.select({ id: apps.id }).from(apps).where(inArray(apps.id, ids));
  if (rows.length !== new Set(ids).size) throw new UserError("One or more applications no longer exist. Reload and try again.");
}
const appNames = async (ids: string[]) => (ids.length ? (await db.select({ name: apps.name }).from(apps).where(inArray(apps.id, ids))).map((a) => a.name).sort() : []);

/** Per-app screen: add and remove users in bulk, all in one statement. */
export async function changeAppUsers(appId: string, input: unknown) {
  return adminAction("people", async (admin) => {
    const id = uuid.parse(appId);
    const v = z.object({ add: uuidList, remove: uuidList }).parse(input);
    return applyAppUserChange(admin, { appId: id, add: v.add, remove: v.remove, source: "application" });
  });
}

/**
 * A person's role in a single sign-on application: User, Admin or Super Admin. Only the Support Admin (no area, unlike the rest of this file), because
 * it decides what the person can do inside that application.
 */
export async function setAppUserRole(appId: string, userId: string, role: string) {
  return adminAction(async (admin) => {
    const v = z.object({ appId: uuid, userId: uuid, role: z.enum(SSO_ROLES, { error: "Choose User, Admin or Super Admin." }) }).parse({ appId, userId, role });
    return applyAppUserRole(admin, v);
  });
}

/** The Edit form's App roles: who is an Admin and who is a Super Admin of a single sign-on application. Support Admin only, like the above. */
export async function setAppRoles(appId: string, input: unknown) {
  return adminAction(async (admin) => {
    const v = z.object({ admins: uuidList, superAdmins: uuidList }).parse(input);
    return applyAppRoles(admin, { appId: uuid.parse(appId), admins: [...new Set(v.admins)], superAdmins: [...new Set(v.superAdmins)] });
  });
}

const templateInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  appIds: uuidList,
});

export async function createTemplate(input: unknown) {
  return adminAction("people", async (admin) => {
    const v = templateInput.parse(input);
    const appIds = [...new Set(v.appIds)];
    await assertAppsExist(appIds);
    const [t] = await db.insert(accessTemplates).values({ name: v.name }).returning({ id: accessTemplates.id });
    if (appIds.length) await db.insert(accessTemplateApps).values(appIds.map((appId) => ({ templateId: t.id, appId })));
    await writeAudit(admin, [{ action: "template.create", targetType: "template", targetId: t.id, targetLabel: v.name, details: { applications: await appNames(appIds) } }]);
  });
}

export async function updateTemplate(id: string, input: unknown) {
  return adminAction("people", async (admin) => {
    const tid = uuid.parse(id);
    const v = templateInput.parse(input);
    const appIds = [...new Set(v.appIds)];
    await assertAppsExist(appIds);
    const before = await db.select({ appId: accessTemplateApps.appId }).from(accessTemplateApps).where(eq(accessTemplateApps.templateId, tid));
    await db.update(accessTemplates).set({ name: v.name }).where(eq(accessTemplates.id, tid));
    await db.delete(accessTemplateApps).where(eq(accessTemplateApps.templateId, tid));
    if (appIds.length) await db.insert(accessTemplateApps).values(appIds.map((appId) => ({ templateId: tid, appId })));
    await writeAudit(admin, [{ action: "template.update", targetType: "template", targetId: tid, targetLabel: v.name, details: { before: await appNames(before.map((b) => b.appId)), after: await appNames(appIds) } }]);
  });
}

export async function deleteTemplate(id: string) {
  return adminAction("people", async (admin) => {
    const tid = uuid.parse(id);
    const [t] = await db.select({ name: accessTemplates.name }).from(accessTemplates).where(eq(accessTemplates.id, tid));
    await db.delete(accessTemplates).where(eq(accessTemplates.id, tid));
    await writeAudit(admin, [{ action: "template.delete", targetType: "template", targetId: tid, targetLabel: t?.name ?? "" }]);
  });
}
