import "server-only";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { apps, departments } from "@/db/schema";

export type CatalogDept = { id: string; name: string; icon: string; isActive: boolean };
export type CatalogApp = { id: string; name: string; departmentId: string; isActive: boolean };

/** Every department and app (including inactive ones) for the access checklists. Head-admin screens only. */
export async function getCatalog(): Promise<{ departments: CatalogDept[]; apps: CatalogApp[] }> {
  const [deps, list] = await Promise.all([
    db.select({ id: departments.id, name: departments.name, icon: departments.icon, isActive: departments.isActive })
      .from(departments).orderBy(asc(departments.sortOrder), asc(departments.name)),
    db.select({ id: apps.id, name: apps.name, departmentId: apps.departmentId, isActive: apps.isActive })
      .from(apps).orderBy(asc(apps.sortOrder), asc(apps.name)),
  ]);
  return { departments: deps, apps: list };
}
