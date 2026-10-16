import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { apps, departments } from "@/db/schema";
import { isApprovalsUrl } from "@/lib/approvals/approvals.manifest";

export type CatalogDept = { id: string; name: string; icon: string; isActive: boolean };
export type CatalogApp = { id: string; name: string; departmentId: string; isActive: boolean };

/** Every department and app (including inactive ones) for the access checklists. Head-admin screens only. */
export async function getCatalog(): Promise<{ departments: CatalogDept[]; apps: CatalogApp[] }> {
  const [allDeps, all] = await Promise.all([
    db.select({ id: departments.id, name: departments.name, icon: departments.icon, isActive: departments.isActive })
      .from(departments).where(eq(departments.kind, "application")).orderBy(asc(departments.sortOrder), asc(departments.name)),
    db.select({ id: apps.id, name: apps.name, departmentId: apps.departmentId, isActive: apps.isActive, url: apps.url })
      .from(apps).orderBy(asc(apps.sortOrder), asc(apps.name)),
  ]);
  // The Approval System is not an application to tick: its rows (the old /approvals card) are left out, and so is a category that holds nothing else.
  const list = all.filter((a) => !isApprovalsUrl(a.url)).map((a) => ({ id: a.id, name: a.name, departmentId: a.departmentId, isActive: a.isActive }));
  const hidden = new Set(all.filter((a) => isApprovalsUrl(a.url)).map((a) => a.departmentId));
  const shown = new Set(list.map((a) => a.departmentId));
  return { departments: allDeps.filter((d) => !hidden.has(d.id) || shown.has(d.id)), apps: list };
}
