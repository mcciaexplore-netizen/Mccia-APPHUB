"use server";

import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { apps } from "@/db/schema";
import { adminAction, UserError } from "@/lib/action";
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
  return adminAction(async () => {
    const v = appInput.parse(input);
    await db.insert(apps).values({ ...v, sortOrder: await nextOrder(v.departmentId) });
  });
}

export async function updateApp(id: string, input: unknown) {
  return adminAction(async () => {
    const v = appInput.parse(input);
    const cur = await loadApp(id);
    const sortOrder = cur.departmentId === v.departmentId ? cur.sortOrder : await nextOrder(v.departmentId);
    await db.update(apps).set({ ...v, sortOrder }).where(eq(apps.id, cur.id));
  });
}

/** Apps are never hard-deleted so the activity log keeps its history. */
export async function setAppActive(id: string, active: boolean) {
  return adminAction(async () => {
    const cur = await loadApp(id);
    await db.update(apps).set({ isActive: !!active }).where(eq(apps.id, cur.id));
  });
}

export async function moveApp(id: string, dir: "up" | "down") {
  return adminAction(async () => {
    const cur = await loadApp(id);
    const list = await db.select({ id: apps.id }).from(apps).where(eq(apps.departmentId, cur.departmentId)).orderBy(asc(apps.sortOrder), asc(apps.name));
    const i = list.findIndex((a) => a.id === cur.id);
    const j = dir === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    await Promise.all(list.map((a, k) => db.update(apps).set({ sortOrder: k * 10 }).where(eq(apps.id, a.id))));
  });
}
