import { asc, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { apps, departments } from "@/db/schema";
import { requireArea } from "@/lib/permissions";
import { DepartmentsList } from "./DepartmentsList";

export const metadata = { title: "Application categories · MCCIA App Hub" };

export default async function Page() {
  await requireArea("apps");
  const [deps, appCounts] = await Promise.all([
    db.select().from(departments).where(eq(departments.kind, "application")).orderBy(asc(departments.sortOrder), asc(departments.name)),
    db.select({ id: apps.departmentId, n: count() }).from(apps).groupBy(apps.departmentId),
  ]);
  const appN = new Map(appCounts.map((r) => [r.id, r.n]));
  return (
    <DepartmentsList
      departments={deps.map((d) => ({ id: d.id, name: d.name, icon: d.icon, sortOrder: d.sortOrder, isActive: d.isActive, apps: appN.get(d.id) ?? 0 }))}
    />
  );
}
