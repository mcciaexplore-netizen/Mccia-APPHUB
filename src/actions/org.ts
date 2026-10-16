"use server";

import { count, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { branches, teams, users } from "@/db/schema";
import { adminAction, UserError } from "@/lib/action";
import { writeAudit } from "@/lib/audit";
import { uuid } from "@/lib/validation";

/** Branches and teams: the organisation people are placed in. Super administrator only, and every change is audited. */
const name = z.string().trim().min(1, "Name is required").max(80);
const optionalId = uuid.nullish().transform((v) => v ?? null);

export async function createBranch(input: unknown) {
  return adminAction("org", async (admin) => {
    const n = name.parse(input);
    const [b] = await db.insert(branches).values({ name: n }).returning({ id: branches.id });
    await writeAudit(admin, [{ action: "branch.create", targetType: "branch", targetId: b.id, targetLabel: n }]);
  });
}

export async function renameBranch(id: string, input: unknown) {
  return adminAction("org", async (admin) => {
    const n = name.parse(input);
    const [cur] = await db.select({ name: branches.name }).from(branches).where(eq(branches.id, uuid.parse(id)));
    if (!cur) throw new UserError("Branch not found.");
    await db.update(branches).set({ name: n }).where(eq(branches.id, id));
    await writeAudit(admin, [{ action: "branch.update", targetType: "branch", targetId: id, targetLabel: n, details: { from: cur.name, to: n } }]);
  });
}

export async function setBranchActive(id: string, active: boolean) {
  return adminAction("org", async (admin) => {
    const [cur] = await db.select({ name: branches.name }).from(branches).where(eq(branches.id, uuid.parse(id)));
    if (!cur) throw new UserError("Branch not found.");
    await db.update(branches).set({ isActive: !!active }).where(eq(branches.id, id));
    await writeAudit(admin, [{ action: active ? "branch.activate" : "branch.deactivate", targetType: "branch", targetId: id, targetLabel: cur.name }]);
  });
}

/** Only an unused branch can be deleted. Deactivating hides it from new choices and keeps the people in it. */
export async function deleteBranch(id: string) {
  return adminAction("org", async (admin) => {
    const [cur] = await db.select({ name: branches.name }).from(branches).where(eq(branches.id, uuid.parse(id)));
    if (!cur) throw new UserError("Branch not found.");
    const [[u], [t]] = await Promise.all([
      db.select({ n: count() }).from(users).where(eq(users.branchId, id)),
      db.select({ n: count() }).from(teams).where(eq(teams.branchId, id)),
    ]);
    if (u.n > 0) throw new UserError(`${u.n} ${u.n === 1 ? "person is" : "people are"} in this branch. Move them first, or deactivate the branch instead.`);
    if (t.n > 0) throw new UserError(`${t.n} ${t.n === 1 ? "team belongs" : "teams belong"} to this branch. Move or delete them first, or deactivate the branch instead.`);
    await db.delete(branches).where(eq(branches.id, id));
    await writeAudit(admin, [{ action: "branch.delete", targetType: "branch", targetId: id, targetLabel: cur.name }]);
  });
}

const teamInput = z.object({ name, branchId: optionalId });

export async function createTeam(input: unknown) {
  return adminAction("org", async (admin) => {
    const v = teamInput.parse(input);
    const [t] = await db.insert(teams).values({ name: v.name, branchId: v.branchId }).returning({ id: teams.id });
    await writeAudit(admin, [{ action: "team.create", targetType: "team", targetId: t.id, targetLabel: v.name }]);
  });
}

export async function updateTeam(id: string, input: unknown) {
  return adminAction("org", async (admin) => {
    const v = teamInput.parse(input);
    const [cur] = await db.select({ name: teams.name, branchId: teams.branchId }).from(teams).where(eq(teams.id, uuid.parse(id)));
    if (!cur) throw new UserError("Team not found.");
    await db.update(teams).set({ name: v.name, branchId: v.branchId }).where(eq(teams.id, id));
    await writeAudit(admin, [{ action: "team.update", targetType: "team", targetId: id, targetLabel: v.name, details: { renamedFrom: cur.name !== v.name ? cur.name : undefined, branchChanged: cur.branchId !== v.branchId } }]);
  });
}

export async function setTeamActive(id: string, active: boolean) {
  return adminAction("org", async (admin) => {
    const [cur] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, uuid.parse(id)));
    if (!cur) throw new UserError("Team not found.");
    await db.update(teams).set({ isActive: !!active }).where(eq(teams.id, id));
    await writeAudit(admin, [{ action: active ? "team.activate" : "team.deactivate", targetType: "team", targetId: id, targetLabel: cur.name }]);
  });
}

export async function deleteTeam(id: string) {
  return adminAction("org", async (admin) => {
    const [cur] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, uuid.parse(id)));
    if (!cur) throw new UserError("Team not found.");
    const [u] = await db.select({ n: count() }).from(users).where(eq(users.teamId, id));
    if (u.n > 0) throw new UserError(`${u.n} ${u.n === 1 ? "person is" : "people are"} in this team. Move them first, or deactivate the team instead.`);
    await db.delete(teams).where(eq(teams.id, id));
    await writeAudit(admin, [{ action: "team.delete", targetType: "team", targetId: id, targetLabel: cur.name }]);
  });
}
