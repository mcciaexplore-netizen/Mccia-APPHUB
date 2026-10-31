import Link from "next/link";
import { RangeTabs } from "@/components/ivr/admin/range-tabs";
import { KpiStrip } from "@/components/ivr/kpi-strip";
import { PageHeader } from "@/components/ivr/ui";
import { requireAdmin } from "@/lib/ivr/dal";
import { getAgentTable, getKpis } from "@/lib/ivr/stats";
import { formatDuration, resolveRange } from "@/lib/ivr/time";

export const metadata = { title: "Team overview" };

export default async function AdminPage({ searchParams }: PageProps<"/ivr/admin">) {
  const user = await requireAdmin();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const range = resolveRange({ range: one(sp.range), from: one(sp.from), to: one(sp.to) });

  const [kpis, agents] = await Promise.all([getKpis({ from: range.from, to: range.to, live: false }), getAgentTable(range)]);
  const q =
    range.key === "custom" ? `range=custom&from=${range.fromStr}&to=${range.toStr}` : `range=${range.key}`;
  const label = range.fromStr === range.toStr ? range.fromStr : `${range.fromStr} to ${range.toStr}`;
  const totals = agents.reduce(
    (t, a) => ({
      assigned: t.assigned + a.assigned,
      outbound: t.outbound + a.outbound,
      inbound: t.inbound + a.inbound,
      answered: t.answered + a.answered,
      talkSec: t.talkSec + a.talkSec,
      queue: t.queue + a.queue,
      connected: t.connected + a.connected,
      closed: t.closed + a.closed,
    }),
    { assigned: 0, outbound: 0, inbound: 0, answered: 0, talkSec: 0, queue: 0, connected: 0, closed: 0 },
  );

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Team overview"
        subtitle={`Calls and members across all agents · ${label} (IST)`}
        actions={
          <>
            <Link className="btn btn-ghost" href="/ivr/admin/analytics">
              Analytics
            </Link>
            {user.role === "super_admin" && (
              <Link className="btn btn-ghost" href={`/ivr/admin/reports?from=${range.fromStr}&to=${range.toStr}`}>
                Export PDF
              </Link>
            )}
          </>
        }
      />
      <RangeTabs range={range} basePath="/ivr/admin" />
      <KpiStrip key={q} initial={kpis} query={q} variant="admin" />

      <section className="ivr-card overflow-hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-4">
          <h2 className="text-[1.1rem]">Work by agent</h2>
          <p className="text-[0.78rem] text-muted">
            Calls are for the range. Queue, Connected and Closed are each agent&apos;s current members.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="ivr-th">Agent</th>
                <th className="ivr-th text-right">Assigned</th>
                <th className="ivr-th text-right">Outbound</th>
                <th className="ivr-th text-right">Inbound</th>
                <th className="ivr-th text-right">Answered</th>
                <th className="ivr-th text-right">Pick-up rate</th>
                <th className="ivr-th text-right">Talk time</th>
                <th className="ivr-th text-right">Avg talk</th>
                <th className="ivr-th text-right">Queue</th>
                <th className="ivr-th text-right">Connected</th>
                <th className="ivr-th text-right">Closed</th>
              </tr>
            </thead>
            <tbody>
              {agents.length === 0 && (
                <tr>
                  <td className="ivr-td text-muted" colSpan={11}>
                    No agents yet. Give the IVR-CRM application to the Membership team in the hub.
                  </td>
                </tr>
              )}
              {agents.map((a) => (
                <tr key={a.userId}>
                  <td className="ivr-td font-semibold">
                    <Link href={`/ivr/admin/members?owner=${a.userId}`} className="transition-colors hover:text-primary">
                      {a.name}
                    </Link>
                  </td>
                  <td className="ivr-td tabular-nums text-right">{a.assigned}</td>
                  <td className="ivr-td tabular-nums text-right">{a.outbound}</td>
                  <td className="ivr-td tabular-nums text-right">{a.inbound}</td>
                  <td className="ivr-td tabular-nums text-right text-brand-green-text">{a.answered}</td>
                  <td className="ivr-td tabular-nums text-right">{a.pickupRate === null ? "–" : `${a.pickupRate}%`}</td>
                  <td className="ivr-td tabular-nums text-right">{a.talkSec ? formatDuration(a.talkSec) : "–"}</td>
                  <td className="ivr-td tabular-nums text-right">{a.avgTalkSec ? formatDuration(a.avgTalkSec) : "–"}</td>
                  <td className="ivr-td tabular-nums text-right">{a.queue}</td>
                  <td className="ivr-td tabular-nums text-right">{a.connected}</td>
                  <td className="ivr-td tabular-nums text-right">{a.closed}</td>
                </tr>
              ))}
            </tbody>
            {agents.length > 0 && (
              <tfoot>
                <tr className="bg-alt font-semibold">
                  <td className="ivr-td">Team</td>
                  <td className="ivr-td tabular-nums text-right">{totals.assigned}</td>
                  <td className="ivr-td tabular-nums text-right">{totals.outbound}</td>
                  <td className="ivr-td tabular-nums text-right">{totals.inbound}</td>
                  <td className="ivr-td tabular-nums text-right">{totals.answered}</td>
                  <td className="ivr-td tabular-nums text-right">{kpis.pickupRate === null ? "–" : `${kpis.pickupRate}%`}</td>
                  <td className="ivr-td tabular-nums text-right">{totals.talkSec ? formatDuration(totals.talkSec) : "–"}</td>
                  <td className="ivr-td" />
                  <td className="ivr-td tabular-nums text-right">{totals.queue}</td>
                  <td className="ivr-td tabular-nums text-right">{totals.connected}</td>
                  <td className="ivr-td tabular-nums text-right">{totals.closed}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>
    </div>
  );
}
