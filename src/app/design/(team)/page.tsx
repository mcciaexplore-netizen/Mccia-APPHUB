import Link from "next/link";
import { ActivityFeed } from "@/components/design/activity-feed";
import { EmailSwitch } from "@/components/design/team/email-switch";
import { Badge, Card, DueText, Empty, Kpi, PageHeader, PriorityBadge, StatusBadge } from "@/components/design/ui";
import { requireTeam } from "@/lib/design/dal";
import { activity } from "@/lib/design/detail";
import { listTickets } from "@/lib/design/tickets";
import { emailEnabledFor } from "@/lib/design/team-queries";
import { OPEN_STATUSES, dueHealth, istDate } from "@/lib/design/rules";

export const metadata = { title: "My Dashboard · Design Team" };

/** The designer's own queue (soonest deadline first), what changed on their work, and where their emails go. */
export default async function MyDashboard() {
  const u = await requireTeam();
  const [queue, feed, emailOn] = await Promise.all([listTickets({ assigneeId: u.id, statuses: OPEN_STATUSES }), activity(u.id), emailEnabledFor(u.id)]);
  const today = istDate();
  const dueToday = queue.filter((t) => t.dueAt && istDate(new Date(t.dueAt)) === today).length;
  const overdue = queue.filter((t) => dueHealth(t.dueAt, t.status) === "overdue").length;
  const inReview = queue.filter((t) => t.status === "in_review").length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="My Dashboard" subtitle={`Hello ${u.name.split(" ")[0]}. Your design work, soonest deadline first.`} />
      {!u.member && (
        <div className="ds-card px-5 py-4 text-sm">
          You are a design lead without the Design Team application, so nothing is assigned to you here. Every ticket is on the{" "}
          <Link href="/design/admin" className="font-semibold text-[var(--ds-navy)] underline">
            Design Team Admin
          </Link>{" "}
          pages.
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Open" value={queue.length} />
        <Kpi label="Due today" value={dueToday} tone={dueToday ? "navy" : undefined} />
        <Kpi label="Overdue" value={overdue} tone={overdue ? "red" : undefined} />
        <Kpi label="In review" value={inReview} tone="purple" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card title="My queue" pad={false}>
          {queue.length === 0 ? (
            <Empty title="Nothing in your queue">New work appears here as soon as a lead assigns it to you.</Empty>
          ) : (
            <ul className="divide-y divide-[var(--ds-line)]">
              {queue.map((t) => (
                <li key={t.id}>
                  <Link href={`/design/tickets/${t.id}`} className="flex flex-col gap-1.5 px-5 py-3.5 hover:bg-[#fafafa] sm:flex-row sm:items-center sm:gap-4">
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
        <div className="flex flex-col gap-6">
          <ActivityFeed scope="mine" initial={feed} />
          <Card title="Email">
            <EmailSwitch email={u.email} enabled={emailOn} />
          </Card>
        </div>
      </div>
    </div>
  );
}
