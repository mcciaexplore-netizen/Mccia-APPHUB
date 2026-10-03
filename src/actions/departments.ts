"use server";

import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { departments } from "@/db/schema";
import { adminAction } from "@/lib/action";
import { departmentInput, slugify, uuid } from "@/lib/validation";

/** A new department goes to the end of the list unless an explicit sort order is given. */
async function nextOrder() {
  const rows = await db.select({ s: departments.sortOrder }).from(departments);
  return rows.reduce((m, r) => Math.max(m, r.s), 0) + 10;
}

export async function createDepartment(input: unknown) {
  return adminAction(async () => {
    const v = departmentInput.parse(input);
    await db.insert(departments).values({ name: v.name, slug: slugify(v.name), icon: v.icon, sortOrder: v.sortOrder || (await nextOrder()) });
  });
}

export async function updateDepartment(id: string, input: unknown) {
  return adminAction(async () => {
    const v = departmentInput.parse(input);
    await db.update(departments).set({ name: v.name, slug: slugify(v.name), icon: v.icon }).where(eq(departments.id, uuid.parse(id)));
  });
}

/** Departments are never hard-deleted so the activity log keeps its history. */
export async function setDepartmentActive(id: string, active: boolean) {
  return adminAction(async () => {
    await db.update(departments).set({ isActive: !!active }).where(eq(departments.id, uuid.parse(id)));
  });
}

export async function moveDepartment(id: string, dir: "up" | "down") {
  return adminAction(async () => {
    uuid.parse(id);
    const list = await db.select({ id: departments.id }).from(departments).orderBy(asc(departments.sortOrder), asc(departments.name));
    const i = list.findIndex((d) => d.id === id);
    const j = dir === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    await Promise.all(list.map((d, k) => db.update(departments).set({ sortOrder: k * 10 }).where(eq(departments.id, d.id))));
  });
}
