import { PageHeader } from "@/components/ivr/ui";
import { ReportBuilder } from "@/components/ivr/analytics/report-builder";
import { requireAdmin } from "@/lib/ivr/dal";
import { listAgentUsers } from "@/lib/ivr/leads";
import { addDays, istDayStart, parseIstDate, toIstDateString } from "@/lib/ivr/time";

export const metadata = { title: "PDF reports" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const sp = await searchParams;
  const one = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const today = istDayStart();
  const from = parseIstDate(one("from")) ?? addDays(today, -6);
  const to = parseIstDate(one("to")) ?? today;
  const agents = await listAgentUsers();

  return (
    <div className="grid gap-4">
      <PageHeader
        title="PDF reports"
        subtitle="Download team or per-agent performance as a PDF."
      />
      <ReportBuilder
        agents={agents.map((a) => ({ id: a.id, name: a.name }))}
        today={toIstDateString(today)}
        initialFrom={toIstDateString(from)}
        initialTo={toIstDateString(to < from ? from : to)}
      />
    </div>
  );
}
