import Link from "next/link";
import { ActivityFeed } from "@/components/design/activity-feed";
import { PendingList } from "@/components/design/admin/PendingList";
import { EmailSwitch } from "@/components/design/team/email-switch";
import { Badge, Card, DueText, Empty, Kpi, PageHeader, PriorityBadge, StatusBadge } from "@/components/design/ui";
import { listTickets } from "@/lib/design/tickets";
import { emailEnabledFor } from "@/lib/design/team-queries";
import { OPEN_STATUSES } from "@/lib/design/rules";
import { pendingItems } from "@/lib/design/admin-queries";
import { requireTeam } from "@/lib/design/dal";
import { activity } from "@/lib/design/detail";
import { openByDesigner, overview } from "@/lib/design/reports";

/**
 * The creative team's dashboard: the four numbers that matter, the requests waiting for a lead (leads only: they accept and assign), the
 * person's own queue, what is happening now, who holds the open work (leads only), and where their emails go. A lead sees the whole
 * team's numbers and activity; a designer only those of the tickets assigned to them.
 */
export default async function DesignAdminHome() {
  const u = await requireTeam();
  const [o, pending, feed, byDesigner, queue, emailOn] = await Promise.all([
    overview(u.lead ? undefined : u.id),
    u.lead ? pendingItems() : Promise.resolve([]),
    activity(u.lead ? null : u.id),
    u.lead ? openByDesigner() : Promise.resolve([]),
    listTickets({ assigneeId: u.id, statuses: OPEN_STATUSES }),
    emailEnabledFor(u.id),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Team overview" subtitle={`Hello ${u.name.split(" ")[0]}.${u.lead ? " Requests waiting for you come first." : " Your work at a glance."}`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Open tickets" value={o.open} />
        <Kpi label="Overdue" value={o.overdue} tone={o.overdue ? "red" : undefined} />
        <Kpi label="In review" value={o.inReview} tone="purple" />
        <Kpi label="Delivered this week" value={o.deliveredThisWeek} tone="green" />
      </div>
      {u.lead && (
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
      )}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card title="My queue" pad={false}>
          {queue.length === 0 ? (
            <Empty title="Nothing in your queue">New work appears here as soon as a lead assigns it to you.</Empty>
          ) : (
            <ul className="divide-y divide-[var(--ds-line)]">
              {queue.map((t) => (
                <li key={t.id}>
                  <Link href={`/design/admin/tickets/${t.id}`} className="flex flex-col gap-1.5 px-5 py-3.5 hover:bg-[#fafafa] sm:flex-row sm:items-center sm:gap-4">
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-[var(--ds-navy)]">{t.number}</span>
                        <StatusBadge status={t.status} />
                        <PriorityBadge priority={t.priority} />
                      </span>
                      <span className="mt-0.5 block truncate text-sm font-semibold text-ink">{t.title}</span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {t.designs.map((d) => (
                          <Badge key={d}>{d}</Badge>
                        ))}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs sm:text-right">
                      <span className="ds-label block">Due</span>
                      <DueText dueAt={t.dueAt} status={t.status} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Email">
          <EmailSwitch email={u.email} enabled={emailOn} />
        </Card>
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <ActivityFeed scope={u.lead ? "all" : "mine"} initial={feed} />
        {u.lead && (
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
        )}
      </div>
    </div>
  );
}
