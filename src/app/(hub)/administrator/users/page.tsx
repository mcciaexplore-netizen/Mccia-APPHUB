import { asc } from "drizzle-orm";
import { db } from "@/db";
import { departments, users } from "@/db/schema";
import { requireHeadAdmin } from "@/lib/permissions";
import { domainsLabel } from "@/lib/domains";
import { UsersManager } from "./UsersManager";

export const metadata = { title: "Users · MCCIA App Hub" };

export default async function Page() {
  await requireHeadAdmin();
  const [list, deps] = await Promise.all([
    db.select().from(users).orderBy(asc(users.name)),
    db.select().from(departments).orderBy(asc(departments.sortOrder), asc(departments.name)),
  ]);
  return (
    <UsersManager
      domain={domainsLabel()}
      users={list.map((u) => ({
        id: u.id, name: u.name, email: u.email, phone: u.phone, designation: u.designation, role: u.role,
        homeDepartmentId: u.homeDepartmentId, isActive: u.isActive,
      }))}
      departments={deps.map((d) => ({ id: d.id, name: d.name, isActive: d.isActive }))}
    />
  );
}
