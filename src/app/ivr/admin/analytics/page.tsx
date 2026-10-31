import Link from "next/link";
import { Kpi, PageHeader } from "@/components/ivr/ui";
import {
  AnswerByHourChart,
  AssignmentTable,
  CallTimeTable,
  CallsByAgentChart,
  CallsPerDayChart,
  CategoryTable,
  DirectionTable,
  DurationChart,
  FunnelChart,
  NumbersTable,
  PickupRateChart,
  StageChart,
} from "@/components/ivr/analytics/charts";
import { CompareView } from "@/components/ivr/analytics/compare";
import { HeatmapChart } from "@/components/ivr/analytics/heatmap";
import { RangeBar } from "@/components/ivr/analytics/range-bar";
import { getAnalytics, isUuid, type Direction } from "@/lib/ivr/analytics";
import { listCategories } from "@/lib/ivr/categories";
import { requireAdmin } from "@/lib/ivr/dal";
import { listAgentUsers } from "@/lib/ivr/leads";
import { formatDuration, resolveRange } from "@/lib/ivr/time";

export const metadata = { title: "Analytics" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AnalyticsPage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requireAdmin();
  const sp = await searchParams;
  const one = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };

  const range = resolveRange({ range: one("range") ?? "week", from: one("from"), to: one("to") });
  const [agents, categories] = await Promise.all([listAgentUsers(), listCategories()]);
  const known = new Set(agents.map((a) => a.id));
  const scopeParam = one("scope");
  const scope = scopeParam && known.has(scopeParam) ? scopeParam : "team";
  const cmpParam = one("compare");
  const compare = scope !== "team" && cmpParam && known.has(cmpParam) && cmpParam !== scope ? cmpParam : "";
  const userIds = scope === "team" ? undefined : compare ? [scope, compare] : [scope];
  const categoryParam = one("category");
  const category = isUuid(categoryParam) && categories.some((c) => c.id === categoryParam) ? categoryParam : "";
  const dirParam = one("direction");
  const direction: Direction | "" = dirParam === "inbound" || dirParam === "outbound" ? dirParam : "";

  const data = await getAnalytics({ from: range.from, to: range.to, userIds, categoryId: category || undefined, direction: direction || undefined }, !!compare);
  const t = data.summary.total;
  const out = data.summary.outbound;
  const scopeName = scope === "team" ? "Whole team" : (agents.find((a) => a.id === scope)?.name ?? "Agent");
  const ordered = compare ? [scope, compare].map((id) => data.agents.find((a) => a.userId === id)).filter((a) => !!a) : [];

  const csv = new URLSearchParams({ range: range.key, from: range.fromStr, to: range.toStr });
  if (scope !== "team") csv.set("scope", scope);
  if (category) csv.set("category", category);
  if (direction) csv.set("direction", direction);
  const csvHref = `/api/ivr/analytics/numbers?${csv.toString()}`;

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Analytics"
        subtitle={`${scopeName}${compare ? ` compared with ${agents.find((a) => a.id === compare)?.name}` : ""} · ${range.fromStr} to ${range.toStr}`}
        actions={
          viewer.role === "super_admin" ? (
            <Link className="btn btn-ghost" href={`/ivr/admin/reports?from=${range.fromStr}&to=${range.toStr}`}>
              PDF report
            </Link>
          ) : undefined
        }
      />

      <RangeBar
        agents={agents}
        categories={categories.map((c) => ({ id: c.id, label: c.label }))}
        state={{ range: range.key, from: range.fromStr, to: range.toStr, scope, compare, category, direction }}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Calls" value={t.calls} hint={`${out.calls} out · ${data.summary.inbound.calls} in`} />
        <Kpi label="Answered" value={t.answered} tone="done" hint="calls picked up" />
        <Kpi label="Answer rate" value={t.rate === null ? "–" : `${t.rate}%`} hint="all calls" />
        <Kpi label="Members called" value={t.members} hint={`${t.membersReached} reached`} />
        <Kpi label="Talk time" value={formatDuration(t.talkSec)} hint={`avg ${formatDuration(t.avgTalkSec)}`} />
        <Kpi label="Allocated" value={data.assignments.totalAssigned} hint="members in this period" />
      </div>

      {compare && ordered.length === 2 && <CompareView agents={ordered} series={data.compare} />}

      <div className="grid gap-4 md:grid-cols-2">
        <DirectionTable summary={data.summary} />
        <CallsPerDayChart data={data.perDay} />
        <PickupRateChart agents={data.agents} />
        <AnswerByHourChart hours={data.byHour} />
        <DurationChart buckets={data.buckets} />
        <CallsByAgentChart agents={data.agents} />
        <CallTimeTable agents={data.agents} />
        <CategoryTable categories={data.categories} />
        <NumbersTable data={data.numbers} csvHref={csvHref} />
        <HeatmapChart grid={data.heatmap} />
        <StageChart stages={data.stages} />
        <FunnelChart steps={data.funnel} />
        <AssignmentTable data={data.assignments} />
      </div>
    </div>
  );
}
