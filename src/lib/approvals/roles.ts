import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { aprAdminAudit, aprUserRoles } from "@/db/approvals-schema";
import { recordAudit } from "./audit";
import { ApprovalsError } from "./errors";
import { listUsers, roleApprovers, type ApprovalsUser } from "./host-adapter";

export type RoleRow = {
  userId: string;
  name: string;
  email: string;
  headAdmin: boolean; // always an approvals admin, set in the hub
  admin: boolean; // granted here
  viewer: boolean; // granted here
  approver: boolean; // from the hub role: the HR Admin or the Expense Admin
  dg: boolean; // from the hub role: the Super Admin
};

export async function listRoleAssignments(): Promise<RoleRow[]> {
  const [people, granted, who] = await Promise.all([listUsers(), db.select().from(aprUserRoles), roleApprovers()]);
  const has = (userId: string, role: string) => granted.some((g) => g.userId === userId && g.role === role);
  return people.map((u) => ({
    userId: u.id, name: u.name, email: u.email, headAdmin: u.headAdmin,
    admin: has(u.id, "approvals_admin"), viewer: has(u.id, "viewer"),
    approver: u.id === who.hr?.id || u.id === who.expense?.id, dg: u.id === who.superAdmin?.id,
  }));
}

export async function setRole(userId: string, role: "viewer" | "approvals_admin", granted: boolean, actor: ApprovalsUser): Promise<void> {
  const person = (await listUsers()).find((u) => u.id === userId);
  if (!person) throw new ApprovalsError("That person is not an active user of the hub.", 404);
  const label = role === "viewer" ? "viewer" : "Approvals admin";
  if (granted) {
    await db.insert(aprUserRoles).values({ userId, role, grantedById: actor.id }).onConflictDoNothing();
  } else {
    await db.delete(aprUserRoles).where(and(eq(aprUserRoles.userId, userId), eq(aprUserRoles.role, role)));
  }
  const summary = granted ? `Made ${person.name} (${person.email}) ${label}` : `Removed ${label} from ${person.name} (${person.email})`;
  await recordAudit(actor, "role", userId, granted ? "grant" : "revoke", summary, null, { userId, role, granted });
}

export async function listAudit(limit = 200) {
  return db.select().from(aprAdminAudit).orderBy(desc(aprAdminAudit.createdAt)).limit(limit);
}
