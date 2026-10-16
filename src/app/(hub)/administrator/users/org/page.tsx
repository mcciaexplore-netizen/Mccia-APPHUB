import { asc, count } from "drizzle-orm";
import { db } from "@/db";
import { branches, teams, users } from "@/db/schema";
import { requireArea } from "@/lib/permissions";
import { OrgManager } from "./OrgManager";

export const metadata = { title: "Branches & teams · MCCIA App Hub" };

export default async function Page() {
  await requireArea("org");
  const [brs, tms, byBranch, byTeam, teamsPerBranch] = await Promise.all([
    db.select().from(branches).orderBy(asc(branches.name)),
    db.select().from(teams).orderBy(asc(teams.name)),
    db.select({ id: users.branchId, n: count() }).from(users).groupBy(users.branchId),
    db.select({ id: users.teamId, n: count() }).from(users).groupBy(users.teamId),
    db.select({ id: teams.branchId, n: count() }).from(teams).groupBy(teams.branchId),
  ]);
  const n = (rows: { id: string | null; n: number }[]) => new Map(rows.map((r) => [r.id, r.n]));
  const pb = n(byBranch), pt = n(byTeam), tb = n(teamsPerBranch);
  return (
    <OrgManager
      branches={brs.map((b) => ({ id: b.id, name: b.name, isActive: b.isActive, people: pb.get(b.id) ?? 0, teams: tb.get(b.id) ?? 0 }))}
      teams={tms.map((t) => ({ id: t.id, name: t.name, branchId: t.branchId, isActive: t.isActive, people: pt.get(t.id) ?? 0 }))}
    />
  );
}
