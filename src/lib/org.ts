import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { branches, teams, users } from "@/db/schema";
import { UserError } from "@/lib/user-error";

/**
 * The organisation a person sits in: branch, team and reporting manager. One function checks that a
 * combination makes sense, and is used by the profile editor, the single add form and the bulk import alike.
 */
export type OrgFields = { branchId: string | null; teamId: string | null; managerId: string | null };

/**
 * Throws a plain-language error when the combination is not valid, otherwise returns the fields to save (a team's branch fills in a
 * blank branch). `selfId` is the person being edited, so they cannot be their own manager or sit above their own manager.
 * Anything already set that is now inactive may stay; only newly choosing an inactive branch, team or manager is refused.
 */
export async function checkOrg(f: OrgFields, selfId: string | null, current?: Partial<OrgFields>): Promise<OrgFields> {
  let { branchId } = f;
  if (branchId) {
    const [b] = await db.select({ id: branches.id, name: branches.name, isActive: branches.isActive }).from(branches).where(eq(branches.id, branchId));
    if (!b) throw new UserError("That branch no longer exists.");
    if (!b.isActive && branchId !== current?.branchId) throw new UserError(`Branch "${b.name}" is inactive.`);
  }
  if (f.teamId) {
    const [t] = await db.select({ id: teams.id, name: teams.name, branchId: teams.branchId, isActive: teams.isActive }).from(teams).where(eq(teams.id, f.teamId));
    if (!t) throw new UserError("That team no longer exists.");
    if (!t.isActive && f.teamId !== current?.teamId) throw new UserError(`Team "${t.name}" is inactive.`);
    if (t.branchId && branchId && t.branchId !== branchId) {
      const [tb] = await db.select({ name: branches.name }).from(branches).where(eq(branches.id, t.branchId));
      throw new UserError(`Team "${t.name}" belongs to branch "${tb?.name ?? "another branch"}", not the branch you chose.`);
    }
    if (t.branchId && !branchId) branchId = t.branchId;
  }
  if (f.managerId) {
    if (selfId && f.managerId === selfId) throw new UserError("A person cannot be their own reporting manager.");
    const [m] = await db.select({ id: users.id, name: users.name, isActive: users.isActive, status: users.status }).from(users).where(eq(users.id, f.managerId));
    if (!m) throw new UserError("That reporting manager no longer exists.");
    if ((!m.isActive || m.status !== "approved") && f.managerId !== current?.managerId) throw new UserError(`${m.name} is inactive and cannot be a reporting manager.`);
    if (selfId && (await managerChainReaches(f.managerId, selfId))) throw new UserError(`${m.name} already reports (directly or indirectly) to this person, which would make a loop.`);
  }
  return { branchId, teamId: f.teamId, managerId: f.managerId };
}

/** Whether walking up from `startId` through reporting managers reaches `targetId`. One recursive query; a loop already in the data cannot hang it. */
export async function managerChainReaches(startId: string, targetId: string): Promise<boolean> {
  const res = (await db.execute(sql`
    with recursive chain(id, manager_id) as (
      select id, reporting_manager_id from users where id = ${startId}::uuid
      union
      select u.id, u.reporting_manager_id from users u join chain c on u.id = c.manager_id
    )
    select 1 as hit from chain where id = ${targetId}::uuid limit 1`)) as unknown as { rows: unknown[] };
  return res.rows.length > 0;
}
