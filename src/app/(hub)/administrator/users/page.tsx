import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { apps, departments, userAppAccess, users } from "@/db/schema";
import { requireHeadAdmin } from "@/lib/permissions";
import { UsersOverview } from "./UsersOverview";

export const metadata = { title: "Users · MCCIA App Hub" };

export default async function Page() {
  await requireHeadAdmin();
  const [list, deps, grants] = await Promise.all([
    db.select().from(users).orderBy(asc(users.name)),
    db.select({ id: departments.id, name: departments.name }).from(departments).orderBy(asc(departments.sortOrder), asc(departments.name)),
    db
      .select({ userId: userAppAccess.userId, app: apps.name, dept: departments.name, active: apps.isActive })
      .from(userAppAccess)
      .innerJoin(apps, eq(apps.id, userAppAccess.appId))
      .innerJoin(departments, eq(departments.id, apps.departmentId))
      .orderBy(asc(departments.name), asc(apps.name)),
  ]);
  const deptName = new Map(deps.map((d) => [d.id, d.name]));
  const byUser = new Map<string, { app: string; dept: string; active: boolean }[]>();
  for (const g of grants) byUser.set(g.userId, [...(byUser.get(g.userId) ?? []), { app: g.app, dept: g.dept, active: g.active }]);

  return (
    <UsersOverview
      departments={deps.map((d) => d.name)}
      users={list.map((u) => ({
        id: u.id, name: u.name, email: u.email, designation: u.designation, role: u.role, isActive: u.isActive,
        department: u.homeDepartmentId ? (deptName.get(u.homeDepartmentId) ?? null) : null,
        applications: byUser.get(u.id) ?? [],
      }))}
    />
  );
}
