import { asc } from "drizzle-orm";
import { db } from "@/db";
import { departments, users } from "@/db/schema";
import { requireHeadAdmin } from "@/lib/permissions";
import { domainsLabel } from "@/lib/domains";
import { UsersManager } from "./UsersManager";

export const metadata = { title: "Users · MCCIA App Hub" };
// CSV import calls a server action per batch of rows; give each call room to hash passwords.
export const maxDuration = 60;

export default async function Page() {
  const me = await requireHeadAdmin();
  const [list, deps] = await Promise.all([
    db.select().from(users).orderBy(asc(users.name)),
    db.select().from(departments).orderBy(asc(departments.sortOrder), asc(departments.name)),
  ]);
  return (
    <UsersManager
      meId={me.id}
      domain={domainsLabel()}
      users={list.map((u) => ({
        id: u.id, name: u.name, email: u.email, phone: u.phone, designation: u.designation, role: u.role,
        homeDepartmentId: u.homeDepartmentId, isActive: u.isActive, mustChangePassword: u.mustChangePassword,
        status: u.status, signupSource: u.signupSource, hasPassword: !!u.passwordHash, createdAt: u.createdAt.toISOString(),
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      }))}
      departments={deps.map((d) => ({ id: d.id, name: d.name, isActive: d.isActive }))}
    />
  );
}
