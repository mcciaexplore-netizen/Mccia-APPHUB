import { PendingList } from "@/components/aistudio/admin/PendingList";
import { Card, PageHeader } from "@/components/aistudio/ui";
import { requireTeam } from "@/lib/aistudio/dal";
import { listTeam } from "@/lib/aistudio/host-adapter";
import { pendingItems } from "@/lib/aistudio/queries";

export const metadata = { title: "Pending Review · AI Studio Admin" };

/** Every request waiting to be accepted or declined, oldest first (a lead decides; the rest of the team can see what is coming). */
export default async function PendingPage() {
  const u = await requireTeam();
  const [items, team] = await Promise.all([pendingItems(), listTeam()]);
  return (
    <div>
      <PageHeader title="Pending Review" subtitle={u.lead ? "Accept a request (assign it, set its deadline and priority) or decline it with a reason." : "Requests waiting for an AI Studio lead."} />
      <Card pad={false}>
        <PendingList items={items} team={team.map((p) => ({ id: p.id, name: p.name }))} lead={u.lead} />
      </Card>
    </div>
  );
}
