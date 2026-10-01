import { asc } from "drizzle-orm";
import { db } from "@/db";
import { departments, users } from "@/db/schema";
import { requireHeadAdmin } from "@/lib/permissions";
import { UsersManager } from "./UsersManager";

export const metadata = { title: "Users · MCCIA App Hub" };

export default async function Page() {
  const me = await requireHeadAdmin();
  const [list, deps] = await Promise.all([
    db.select().from(users).orderBy(asc(users.name)),
    db.select().from(departments).orderBy(asc(departments.sortOrder), asc(departments.name)),
  ]);
  return (
    <UsersManager
      meId={me.id}
      domain={process.env.ALLOWED_EMAIL_DOMAIN ?? ""}
      users={list.map((u) => ({
        id: u.id, name: u.name, email: u.email, phone: u.phone, designation: u.designation, role: u.role,
        homeDepartmentId: u.homeDepartmentId, isActive: u.isActive, mustChangePassword: u.mustChangePassword,
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      }))}
      departments={deps.map((d) => ({ id: d.id, name: d.name, isActive: d.isActive }))}
    />
  );
}
