import Link from "next/link";
import { ActivityFeed } from "@/components/design/activity-feed";
import { PendingList } from "@/components/design/admin/PendingList";
import { Card, Kpi, PageHeader } from "@/components/design/ui";
import { pendingItems } from "@/lib/design/admin-queries";
import { requireLead } from "@/lib/design/dal";
import { activity } from "@/lib/design/detail";
import { openByDesigner, overview } from "@/lib/design/reports";

/** Team overview: the four numbers that matter, the requests waiting for a lead, what is happening now, and who holds the open work. */
export default async function DesignAdminHome() {
  const u = await requireLead();
  const [o, pending, feed, byDesigner] = await Promise.all([overview(), pendingItems(), activity(null), openByDesigner()]);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Team overview" subtitle={`Hello ${u.name.split(" ")[0]}. Requests waiting for you come first.`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Open tickets" value={o.open} />
        <Kpi label="Overdue" value={o.overdue} tone={o.overdue ? "red" : undefined} />
        <Kpi label="In review" value={o.inReview} tone="purple" />
        <Kpi label="Delivered this week" value={o.deliveredThisWeek} tone="green" />
      </div>
      <Card
        pad={false}
        title={
          <span className="flex items-center gap-2">
            Pending review
            {pending.length > 0 && <span className="rounded-full bg-[var(--ds-red)] px-2 py-0.5 text-[0.72rem] font-bold text-white">{pending.length}</span>}
          </span>
        }
        actions={
          <Link href="/design/admin/pending" className="text-sm font-semibold text-[var(--ds-navy)] hover:underline">
            Open the queue
          </Link>
        }
      >
        <PendingList items={pending} limit={5} />
      </Card>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <ActivityFeed scope="all" initial={feed} />
        <Card title="Open work by designer" pad={false}>
          {byDesigner.length === 0 ? (
            <p className="px-5 py-6 text-sm ds-muted">No open work is assigned.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th className="ds-label px-5 py-2.5">Designer</th>
                  <th className="ds-label px-3 py-2.5 text-right">Open</th>
                  <th className="ds-label px-5 py-2.5 text-right">Overdue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ds-line)]">
                {byDesigner.map((d) => (
                  <tr key={d.id}>
                    <td className="px-5 py-2.5 font-medium text-ink">{d.name}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{d.open}</td>
                    <td className={`px-5 py-2.5 text-right tabular-nums ${d.overdue ? "font-bold text-[var(--ds-red)]" : "ds-muted"}`}>{d.overdue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="border-t border-[var(--ds-line)] px-5 py-3 text-sm">
            <Link href="/design/admin/workload" className="font-semibold text-[var(--ds-navy)] hover:underline">
              See the workload by day →
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
