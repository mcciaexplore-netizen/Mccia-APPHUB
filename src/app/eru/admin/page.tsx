import Link from "next/link";
import { DomainChart } from "@/components/eru/admin/DomainChart";
import { Badge, Card, describeActivity, formatDateTime, Kpi, PageHeader } from "@/components/eru/ui";
import { requireAdmin } from "@/lib/eru/dal";
import { adminKpis, pendingReviewDocuments, projectsByDomain, recentActivity } from "@/lib/eru/queries";

export const metadata = { title: "ERU Admin · MCCIA App Hub" };

/** ERU Admin's dashboard: four numbers, the tracked changes waiting for review, projects by domain, and recent activity. */
export default async function EruAdminHome() {
  const u = await requireAdmin();
  const [k, pending, byDomain, feed] = await Promise.all([adminKpis(), pendingReviewDocuments(), projectsByDomain(), recentActivity(15)]);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Dashboard" subtitle={`Hello ${u.name.split(" ")[0]}. The Economic Research Unit at a glance.`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Total projects" value={k.total} href="/eru/admin/projects" />
        <Kpi label="Active" value={k.active} href="/eru/admin/projects?status=active" />
        <Kpi label="In review" value={k.inReview} tone="purple" href="/eru/admin/projects?status=in_review" />
        <Kpi label="Completed this month" value={k.completedThisMonth} tone="green" href="/eru/admin/projects?status=completed" />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card
          pad={false}
          title={
            <span className="flex items-center gap-2">
              Tracked changes to review
              {k.pendingChanges > 0 && <Badge tone="purple">{k.pendingChanges}</Badge>}
            </span>
          }
        >
          {pending.length ? (
            <ul className="divide-y divide-[var(--eru-line)]">
              {pending.map((d) => (
                <li key={d.id}>
                  <Link href={`/eru/documents/${d.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--eru-navy-tint)]">
                    <span className="font-mono text-xs font-bold text-[var(--eru-navy)]">{d.projectNumber}</span>
                    <span className="min-w-0 flex-1 truncate font-semibold text-ink">{d.title}</span>
                    <Badge tone="purple">{d.pending} pending</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-8 text-center text-sm eru-muted">Nothing waiting for review.</p>
          )}
        </Card>
        <DomainChart data={byDomain} />
      </div>
      <Card title="Recent activity" pad={false}>
        {feed.length ? (
          <ol className="divide-y divide-[var(--eru-line)]">
            {feed.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-x-2 px-5 py-2.5 text-sm">
                {a.projectNumber && a.projectId ? (
                  <Link href={`/eru/projects/${a.projectId}`} className="font-mono text-xs font-bold text-[var(--eru-navy)] hover:underline">
                    {a.projectNumber}
                  </Link>
                ) : null}
                <span className="font-semibold text-ink">{a.who || "Someone"}</span>
                <span className="min-w-0 flex-1 text-ink">{describeActivity(a.action, a.details)}</span>
                <span className="text-xs eru-muted">{formatDateTime(a.at)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="px-5 py-8 text-center text-sm eru-muted">Nothing yet.</p>
        )}
      </Card>
    </div>
  );
}
