import { asc, count } from "drizzle-orm";
import { db } from "@/db";
import { apps, departments, users } from "@/db/schema";
import { requireHeadAdmin } from "@/lib/permissions";
import { DepartmentsList } from "./DepartmentsList";

export const metadata = { title: "Departments · MCCIA App Hub" };

export default async function Page() {
  await requireHeadAdmin();
  const [deps, appCounts, userCounts] = await Promise.all([
    db.select().from(departments).orderBy(asc(departments.sortOrder), asc(departments.name)),
    db.select({ id: apps.departmentId, n: count() }).from(apps).groupBy(apps.departmentId),
    db.select({ id: users.homeDepartmentId, n: count() }).from(users).groupBy(users.homeDepartmentId),
  ]);
  const appN = new Map(appCounts.map((r) => [r.id, r.n]));
  const userN = new Map(userCounts.map((r) => [r.id, r.n]));
  return (
    <DepartmentsList
      departments={deps.map((d) => ({ id: d.id, name: d.name, icon: d.icon, sortOrder: d.sortOrder, isActive: d.isActive, apps: appN.get(d.id) ?? 0, users: userN.get(d.id) ?? 0 }))}
    />
  );
}
