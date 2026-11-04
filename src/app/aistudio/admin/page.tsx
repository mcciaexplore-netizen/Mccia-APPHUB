import { ActivityFeed } from "@/components/aistudio/activity-feed";
import { PendingList } from "@/components/aistudio/admin/PendingList";
import { Card, Kpi, PageHeader } from "@/components/aistudio/ui";
import { requireTeam } from "@/lib/aistudio/dal";
import { listTeam } from "@/lib/aistudio/host-adapter";
import { activity, kpis, pendingItems } from "@/lib/aistudio/queries";

export const metadata = { title: "AI Studio Admin · MCCIA App Hub" };

/** The team's dashboard: four numbers (each opens the list on what it counts), the requests waiting for a lead, and recent activity. */
export default async function AiAdminHome() {
  const u = await requireTeam();
  const [k, pending, feed, team] = await Promise.all([kpis(), pendingItems(), activity(), listTeam()]);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Dashboard" subtitle={`Hello ${u.name.split(" ")[0]}.${u.lead ? " Requests waiting for you come first." : ""}`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Total requests" value={k.total} href="/aistudio/admin/requests" />
        <Kpi label="In Progress" value={k.inProgress} href="/aistudio/admin/requests?filter=in_progress" />
        <Kpi label="In Review/Testing" value={k.reviewTesting} tone="purple" href="/aistudio/admin/requests?filter=review_testing" />
        <Kpi label="Delivered this week" value={k.deliveredThisWeek} tone="green" href="/aistudio/admin/requests?filter=delivered" />
      </div>
      <Card
        pad={false}
        title={
          <span className="flex items-center gap-2">
            Pending Review
            {pending.length > 0 && <span className="rounded-full bg-[var(--ai-red)] px-2 py-0.5 text-[0.72rem] font-bold text-white">{pending.length}</span>}
          </span>
        }
      >
        <PendingList items={pending} team={team.map((p) => ({ id: p.id, name: p.name }))} lead={u.lead} limit={10} />
      </Card>
      <ActivityFeed initial={feed} />
    </div>
  );
}
