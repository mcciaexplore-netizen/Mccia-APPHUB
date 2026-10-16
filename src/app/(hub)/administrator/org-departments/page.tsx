import { asc, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { departments, users } from "@/db/schema";
import { requireArea } from "@/lib/permissions";
import { OrgDepartments } from "./OrgDepartments";

export const metadata = { title: "Departments · MCCIA App Hub" };

/** The organisation's departments: where people sit. Not the groups the applications are arranged in (see Application categories). */
export default async function Page() {
  await requireArea("org");
  const [deps, counts] = await Promise.all([
    db.select().from(departments).where(eq(departments.kind, "organisation")).orderBy(asc(departments.sortOrder), asc(departments.name)),
    db.select({ id: users.homeDepartmentId, n: count() }).from(users).groupBy(users.homeDepartmentId),
  ]);
  const n = new Map(counts.map((r) => [r.id, r.n]));
  return <OrgDepartments departments={deps.map((d) => ({ id: d.id, name: d.name, isActive: d.isActive, users: n.get(d.id) ?? 0 }))} />;
}
