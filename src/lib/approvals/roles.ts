import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { aprAdminAudit, aprApproverRules, aprUserRoles } from "@/db/approvals-schema";
import { recordAudit } from "./audit";
import { ApprovalsError } from "./errors";
import { listUsers, type ApprovalsUser } from "./host-adapter";

export type RoleRow = {
  userId: string;
  name: string;
  email: string;
  headAdmin: boolean; // always an approvals admin, set in the hub
  admin: boolean; // granted here
  viewer: boolean; // granted here
  approver: boolean; // derived: named on step 1 of an active routing rule
  dg: boolean; // derived: named on a later step
};

export async function listRoleAssignments(): Promise<RoleRow[]> {
  const [people, granted, rules] = await Promise.all([
    listUsers(),
    db.select().from(aprUserRoles),
    db.select({ stepNo: aprApproverRules.stepNo, ids: aprApproverRules.approverUserIds }).from(aprApproverRules).where(eq(aprApproverRules.active, true)),
  ]);
  const has = (userId: string, role: string) => granted.some((g) => g.userId === userId && g.role === role);
  const onStep = (userId: string, pick: (n: number) => boolean) => rules.some((r) => pick(r.stepNo) && r.ids.includes(userId));
  return people.map((u) => ({
    userId: u.id, name: u.name, email: u.email, headAdmin: u.headAdmin,
    admin: has(u.id, "approvals_admin"), viewer: has(u.id, "viewer"),
    approver: onStep(u.id, (n) => n === 1), dg: onStep(u.id, (n) => n > 1),
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
