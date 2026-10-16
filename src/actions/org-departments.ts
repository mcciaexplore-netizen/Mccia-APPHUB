"use server";

import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { departments } from "@/db/schema";
import { adminAction, UserError } from "@/lib/action";
import { writeAudit } from "@/lib/audit";
import { slugify, uuid } from "@/lib/validation";

/**
 * The organisation's departments (Finance, IT, AI...): the groups people belong to. They are separate from the application groups that
 * arrange the applications in the hub. Created, renamed and deactivated here (never deleted, so history stays), by anyone who has the
 * "Branches & teams" area (the two top roles always do). A person is placed in a department on their own profile.
 */
const nameInput = z.object({ name: z.string().trim().min(1, "Name is required").max(60, "Keep the name under 60 characters") });

async function sameName(name: string, exceptId?: string) {
  const rows = await db.select({ id: departments.id, name: departments.name }).from(departments).where(and(eq(departments.kind, "organisation"), exceptId ? ne(departments.id, exceptId) : undefined));
  return rows.some((r) => r.name.toLowerCase() === name.toLowerCase());
}

export async function createOrgDepartment(input: unknown) {
  return adminAction("org", async (admin) => {
    const v = nameInput.parse(input);
    if (await sameName(v.name)) throw new UserError("A department with that name already exists.");
    const all = await db.select({ s: departments.sortOrder }).from(departments).where(eq(departments.kind, "organisation"));
    const [made] = await db.insert(departments).values({ kind: "organisation", name: v.name, slug: slugify(v.name), icon: "Building2", sortOrder: all.reduce((m, r) => Math.max(m, r.s), 0) + 10 }).returning({ id: departments.id });
    await writeAudit(admin, [{ action: "department.create", targetType: "department", targetId: made.id, targetLabel: v.name }]);
  });
}

export async function renameOrgDepartment(id: string, input: unknown) {
  return adminAction("org", async (admin) => {
    uuid.parse(id);
    const v = nameInput.parse(input);
    const [cur] = await db.select().from(departments).where(and(eq(departments.id, id), eq(departments.kind, "organisation")));
    if (!cur) throw new UserError("Department not found.");
    if (cur.name === v.name) return;
    if (await sameName(v.name, id)) throw new UserError("A department with that name already exists.");
    await db.update(departments).set({ name: v.name, slug: slugify(v.name) }).where(eq(departments.id, id));
    await writeAudit(admin, [{ action: "department.rename", targetType: "department", targetId: id, targetLabel: v.name, details: { from: cur.name, to: v.name } }]);
  });
}

/** A deactivated department stays on the people already in it but is no longer offered for anyone new. */
export async function setOrgDepartmentActive(id: string, active: boolean) {
  return adminAction("org", async (admin) => {
    uuid.parse(id);
    const [cur] = await db.select().from(departments).where(and(eq(departments.id, id), eq(departments.kind, "organisation")));
    if (!cur) throw new UserError("Department not found.");
    if (cur.isActive === !!active) return;
    await db.update(departments).set({ isActive: !!active }).where(eq(departments.id, id));
    await writeAudit(admin, [{ action: active ? "department.activate" : "department.deactivate", targetType: "department", targetId: id, targetLabel: cur.name }]);
  });
}
