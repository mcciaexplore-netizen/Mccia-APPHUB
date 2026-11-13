import { MembersView } from "@/components/eru/admin/MembersView";
import { PageHeader } from "@/components/eru/ui";
import { requireAdmin } from "@/lib/eru/dal";
import { appsSetUp, listTeam } from "@/lib/eru/host-adapter";

export const metadata = { title: "Members · ERU Admin · MCCIA App Hub" };

/** The ERU team: add hub users, change member/admin, remove. Writes the hub's own lists for ERU, so Administrator always agrees. */
export default async function Members() {
  const u = await requireAdmin();
  const [members, apps] = await Promise.all([listTeam(), appsSetUp()]);
  return (
    <div>
      <PageHeader title="Members" subtitle="Members work in every domain; admins also manage projects, review tracked changes, the team and settings." />
      <MembersView members={members} meId={u.id} appsReady={apps} />
    </div>
  );
}
