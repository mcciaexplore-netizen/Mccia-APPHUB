"use client";

import type { Key } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  AgentStat,
  AssignmentSummary,
  Bucket,
  CategoryStat,
  DayPoint,
  FunnelStep,
  HourPoint,
  NumberRow,
  StageCount,
  Summary,
} from "@/lib/ivr/analytics";
import { STAGES } from "@/lib/ivr/stage";
import { AXIS, ChartCard, TOOLTIP_STYLE, fmtSec, shortDay } from "./chart-card";

const ANSWERED = "var(--ivr-accent)";
const NOT_ANSWERED = "var(--ivr-missed)";
const GRID = { stroke: "var(--ivr-line)", strokeOpacity: 0.7 } as const;

type DotProps = { cx?: number; cy?: number; index?: number; key?: Key | null };

function endDot(last: number, color: string) {
  const Dot = (p: DotProps) =>
    p.index === last && p.cx !== undefined && p.cy !== undefined ? (
      <circle key={p.key ?? undefined} cx={p.cx} cy={p.cy} r={4} fill={color} stroke="var(--ivr-surface)" strokeWidth={2} />
    ) : (
      <g key={p.key ?? undefined} />
    );
  Dot.displayName = "EndDot";
  return Dot;
}

const pct = (n: number | null) => (n === null ? "–" : `${n}%`);
const hourLabel = (h: number | null) => (h === null ? "–" : `${String(h).padStart(2, "0")}:00`);

/** Inbound against outbound: volume, members reached and call time side by side. */
export function DirectionTable({ summary }: { summary: Summary }) {
  const rows: [string, Summary["total"]][] = [
    ["Outbound", summary.outbound],
    ["Inbound", summary.inbound],
    ["Total", summary.total],
  ];
  return (
    <section className="ivr-card min-w-0 overflow-hidden md:col-span-2" aria-labelledby="dir-title">
      <header className="border-b border-line px-6 py-4">
        <h3 id="dir-title" className="text-[1.02rem]">
          Inbound and outbound
        </h3>
        <p className="text-[12px] text-muted">
          Members counts distinct phone numbers. In the Total row a number that appears in both directions is counted once.
        </p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-[12.5px]">
          <thead>
            <tr>
              <th className="ivr-th">Direction</th>
              <th className="ivr-th text-right">Calls</th>
              <th className="ivr-th text-right">Answered</th>
              <th className="ivr-th text-right">Not answered</th>
              <th className="ivr-th text-right">Answer rate</th>
              <th className="ivr-th text-right">Members</th>
              <th className="ivr-th text-right">Members reached</th>
              <th className="ivr-th text-right">Talk time</th>
              <th className="ivr-th text-right">Avg talk</th>
              <th className="ivr-th text-right">Median talk</th>
              <th className="ivr-th text-right">Avg ring</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, d]) => (
              <tr key={label} className={label === "Total" ? "bg-alt font-semibold" : undefined}>
                <td className="ivr-td">{label}</td>
                <td className="ivr-td tabular-nums text-right">{d.calls}</td>
                <td className="ivr-td tabular-nums text-right text-brand-green-text">{d.answered}</td>
                <td className="ivr-td tabular-nums text-right text-brand-red">{d.notAnswered}</td>
                <td className="ivr-td tabular-nums text-right">{pct(d.rate)}</td>
                <td className="ivr-td tabular-nums text-right">{d.members}</td>
                <td className="ivr-td tabular-nums text-right">{d.membersReached}</td>
                <td className="ivr-td tabular-nums text-right">{fmtSec(d.talkSec)}</td>
                <td className="ivr-td tabular-nums text-right">{fmtSec(d.avgTalkSec)}</td>
                <td className="ivr-td tabular-nums text-right">{fmtSec(d.medianTalkSec)}</td>
                <td className="ivr-td tabular-nums text-right">{fmtSec(d.avgRingSec)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function CallsPerDayChart({ data }: { data: DayPoint[] }) {
  const empty = data.every((d) => d.answered + d.notAnswered === 0);
  const last = data.length - 1;
  return (
    <ChartCard
      title="Calls per day"
      description="Answered and not answered, by Indian Standard Time day."
      legend={[
        { label: "Answered", color: ANSWERED },
        { label: "Not answered", color: NOT_ANSWERED },
      ]}
      empty={empty}
      emptyText="No calls in this period."
      table={{
        columns: ["Day", "Answered", "Not answered"],
        rows: data.map((d) => [shortDay(d.day), d.answered, d.notAnswered]),
      }}
    >
      <div style={{ height: 230 }} role="img" aria-label="Line chart of answered and not answered calls per day">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
            <CartesianGrid vertical={false} {...GRID} />
            <XAxis dataKey="day" tickFormatter={shortDay} tick={AXIS} axisLine={{ stroke: "var(--ivr-line)" }} tickLine={false} minTickGap={28} />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(l) => shortDay(String(l))} cursor={{ stroke: "var(--ivr-line-strong)" }} />
            <Line type="monotone" dataKey="answered" name="Answered" stroke={ANSWERED} strokeWidth={2} dot={endDot(last, ANSWERED)} activeDot={{ r: 4 }} />
            <Line type="monotone" dataKey="notAnswered" name="Not answered" stroke={NOT_ANSWERED} strokeWidth={2} dot={endDot(last, NOT_ANSWERED)} activeDot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

export function CallsByAgentChart({ agents }: { agents: AgentStat[] }) {
  const data = [...agents].sort((a, b) => b.total - a.total);
  const empty = data.every((d) => d.total === 0);
  return (
    <ChartCard
      title="Calls by agent"
      description="Answered and not answered calls each agent handled."
      legend={[
        { label: "Answered", color: ANSWERED },
        { label: "Not answered", color: NOT_ANSWERED },
      ]}
      empty={empty}
      emptyText="No agent calls in this period."
      table={{
        columns: ["Agent", "Outbound", "Inbound", "Answered", "Not answered"],
        rows: data.map((d) => [d.name, d.outbound, d.inbound, d.answered, d.notAnswered]),
      }}
    >
      <div style={{ height: Math.max(180, data.length * 34 + 30) }} role="img" aria-label="Stacked bars of answered and not answered calls per agent">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 28, bottom: 0, left: 0 }} barSize={16}>
            <CartesianGrid horizontal={false} {...GRID} />
            <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="name" width={92} tick={AXIS} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "var(--ivr-surface-2)" }} />
            <Bar dataKey="answered" name="Answered" stackId="c" fill={ANSWERED} stroke="var(--ivr-surface)" strokeWidth={2} />
            <Bar dataKey="notAnswered" name="Not answered" stackId="c" fill={NOT_ANSWERED} stroke="var(--ivr-surface)" strokeWidth={2} radius={[0, 3, 3, 0]}>
              <LabelList dataKey="total" position="right" fill="var(--ivr-muted)" fontSize={11} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

export function PickupRateChart({ agents }: { agents: AgentStat[] }) {
  const ranked = agents
    .filter((a) => a.pickupRate !== null)
    .map((a) => ({ name: a.name, rate: a.pickupRate as number, outbound: a.outbound }))
    .sort((a, b) => b.rate - a.rate);
  const answered = agents.reduce((s, a) => s + Math.round(((a.pickupRate ?? 0) / 100) * a.outbound), 0);
  const total = agents.reduce((s, a) => s + a.outbound, 0);
  const team = total ? Math.round((answered / total) * 100) : 0;
  return (
    <ChartCard
      title="Pick-up rate by agent"
      description={ranked.length ? `Outbound calls the member answered. Dashed line is the team average, ${team}%.` : "Outbound calls the member answered."}
      empty={!ranked.length}
      emptyText="No outbound calls to rank."
      table={{
        columns: ["Agent", "Pick-up rate", "Outbound calls"],
        rows: ranked.map((r) => [r.name, `${r.rate}%`, r.outbound]),
      }}
    >
      <div style={{ height: Math.max(180, ranked.length * 34 + 30) }} role="img" aria-label="Pick-up rate per agent compared with the team average">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <BarChart data={ranked} layout="vertical" margin={{ top: 14, right: 40, bottom: 0, left: 0 }} barSize={16}>
            <CartesianGrid horizontal={false} {...GRID} />
            <XAxis type="number" domain={[0, 100]} unit="%" tick={AXIS} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="name" width={92} tick={AXIS} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "var(--ivr-surface-2)" }} formatter={(v) => [`${v}%`, "Pick-up rate"]} />
            <ReferenceLine x={team} stroke="var(--ivr-fg)" strokeDasharray="4 3" label={{ value: `Team ${team}%`, position: "top", fill: "var(--ivr-muted)", fontSize: 11 }} />
            <Bar dataKey="rate" name="Pick-up rate" fill={ANSWERED} radius={[0, 3, 3, 0]}>
              <LabelList dataKey="rate" position="right" formatter={(v) => `${v}%`} fill="var(--ivr-muted)" fontSize={11} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

export function AnswerByHourChart({ hours }: { hours: HourPoint[] }) {
  const used = hours.filter((h) => h.calls > 0);
  const lo = Math.min(9, used[0]?.hour ?? 9);
  const hi = Math.max(18, used[used.length - 1]?.hour ?? 18);
  const data = hours.filter((h) => h.hour >= lo && h.hour <= hi).map((h) => ({ ...h, label: hourLabel(h.hour), rate: h.rate ?? 0 }));
  const best = [...used].filter((h) => h.calls >= 3 && h.rate !== null).sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))[0];
  return (
    <ChartCard
      title="Best time to call"
      description={best ? `Highest pick-up rate: ${hourLabel(best.hour)} (${best.rate}% of ${best.calls} calls). Hours with under 3 calls are not ranked.` : "Share of calls answered, by hour of day (IST)."}
      empty={!used.length}
      emptyText="No calls in this period."
      table={{
        columns: ["Hour", "Calls", "Answered", "Pick-up rate"],
        rows: used.map((h) => [hourLabel(h.hour), h.calls, h.answered, pct(h.rate)]),
      }}
    >
      <div style={{ height: 230 }} role="img" aria-label="Pick-up rate by hour of day">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid vertical={false} {...GRID} />
            <XAxis dataKey="hour" tick={AXIS} axisLine={{ stroke: "var(--ivr-line)" }} tickLine={false} />
            <YAxis domain={[0, 100]} unit="%" tick={AXIS} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              cursor={{ fill: "var(--ivr-surface-2)" }}
              labelFormatter={(h) => hourLabel(Number(h))}
              formatter={(v, _n, item) => [`${v}% of ${(item?.payload as HourPoint | undefined)?.calls ?? 0} calls`, "Pick-up rate"]}
            />
            <Bar dataKey="rate" name="Pick-up rate" fill={ANSWERED} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

export function DurationChart({ buckets }: { buckets: Bucket[] }) {
  const data = buckets.map((b) => ({ name: b.label, n: b.n, color: ANSWERED }));
  const total = data.reduce((s, d) => s + d.n, 0);
  return (
    <ChartCard
      title="How long calls last"
      description="Answered calls by talk time."
      empty={total === 0}
      emptyText="No answered calls in this period."
      table={{
        columns: ["Talk time", "Calls", "Share"],
        rows: data.map((d) => [d.name, d.n, total ? `${Math.round((d.n / total) * 100)}%` : "–"]),
      }}
    >
      <HBars data={data} labelWidth={84} />
    </ChartCard>
  );
}

export function StageChart({ stages }: { stages: StageCount[] }) {
  const data = stages.map((s) => ({ name: STAGES[s.stage].label, n: s.n, color: STAGES[s.stage].color }));
  return (
    <ChartCard
      title="Members by stage"
      description="Where the work is right now."
      empty={data.every((d) => d.n === 0)}
      emptyText="No members yet."
      table={{ columns: ["Stage", "Members"], rows: data.map((d) => [d.name, d.n]) }}
    >
      <HBars data={data} />
    </ChartCard>
  );
}

export function FunnelChart({ steps }: { steps: FunnelStep[] }) {
  const data = steps.map((s) => ({ name: s.label, n: s.n, color: ANSWERED }));
  return (
    <ChartCard
      title="Member funnel"
      description="Members added in this period and how far they got."
      empty={data[0]?.n === 0}
      emptyText="No members were added in this period."
      table={{
        columns: ["Step", "Members", "Of added"],
        rows: data.map((d) => [d.name, d.n, data[0].n ? `${Math.round((d.n / data[0].n) * 100)}%` : "–"]),
      }}
    >
      <HBars data={data} />
    </ChartCard>
  );
}

export function CategoryTable({ categories }: { categories: CategoryStat[] }) {
  return (
    <ChartCard
      title="Calls by category"
      description="What the calls were about, and how often they were answered."
      empty={!categories.length}
      emptyText="No calls in this period."
      className="md:col-span-2"
      table={{
        columns: ["Category", "Calls", "Answered", "Rate"],
        rows: categories.map((c) => [c.label, c.calls, c.answered, pct(c.rate)]),
      }}
    >
      <div className="overflow-auto rounded-md border border-line">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr>
              <th className="ivr-th">Category</th>
              <th className="ivr-th text-right">Calls</th>
              <th className="ivr-th text-right">Outbound</th>
              <th className="ivr-th text-right">Inbound</th>
              <th className="ivr-th text-right">Answered</th>
              <th className="ivr-th text-right">Answer rate</th>
              <th className="ivr-th text-right">Talk time</th>
              <th className="ivr-th text-right">Avg talk</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.label}>
                <td className="ivr-td py-1.5">{c.label}</td>
                <td className="ivr-td tabular-nums py-1.5 text-right">{c.calls}</td>
                <td className="ivr-td tabular-nums py-1.5 text-right">{c.outbound}</td>
                <td className="ivr-td tabular-nums py-1.5 text-right">{c.inbound}</td>
                <td className="ivr-td tabular-nums py-1.5 text-right">{c.answered}</td>
                <td className="ivr-td tabular-nums py-1.5 text-right">{pct(c.rate)}</td>
                <td className="ivr-td tabular-nums py-1.5 text-right">{fmtSec(c.talkSec)}</td>
                <td className="ivr-td tabular-nums py-1.5 text-right">{fmtSec(c.avgTalkSec)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartCard>
  );
}

/** Call-time analysis per agent: how much time on calls, how long calls last, how long they ring. */
export function CallTimeTable({ agents }: { agents: AgentStat[] }) {
  const rows = [...agents].filter((a) => a.total > 0).sort((a, b) => b.talkSec - a.talkSec);
  return (
    <ChartCard
      title="Call time by agent"
      description="Total talk time, average talk and ring time per answered call, and members called."
      empty={!rows.length}
      emptyText="No calls in this period."
      className="md:col-span-2"
      table={{
        columns: ["Agent", "Talk time", "Avg talk", "Avg ring", "Members called"],
        rows: rows.map((r) => [r.name, fmtSec(r.talkSec), fmtSec(r.avgTalkSec), fmtSec(r.avgRingSec), r.membersCalled]),
      }}
    >
      <div className="overflow-auto rounded-md border border-line">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr>
              <th className="ivr-th">Agent</th>
              <th className="ivr-th text-right">Outbound</th>
              <th className="ivr-th text-right">Inbound</th>
              <th className="ivr-th text-right">Pick-up rate</th>
              <th className="ivr-th text-right">Talk time</th>
              <th className="ivr-th text-right">Avg talk</th>
              <th className="ivr-th text-right">Avg ring</th>
              <th className="ivr-th text-right">Members called</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.userId}>
                <td className="ivr-td py-1.5">{r.name}</td>
                <td className="ivr-td tabular-nums py-1.5 text-right">{r.outbound}</td>
                <td className="ivr-td tabular-nums py-1.5 text-right">{r.inbound}</td>
                <td className="ivr-td tabular-nums py-1.5 text-right">{pct(r.pickupRate)}</td>
                <td className="ivr-td tabular-nums py-1.5 text-right">{fmtSec(r.talkSec)}</td>
                <td className="ivr-td tabular-nums py-1.5 text-right">{fmtSec(r.avgTalkSec)}</td>
                <td className="ivr-td tabular-nums py-1.5 text-right">{fmtSec(r.avgRingSec)}</td>
                <td className="ivr-td tabular-nums py-1.5 text-right">{r.membersCalled}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartCard>
  );
}

/** Answer rate for each phone number called: who picks up, how often, and when. */
export function NumbersTable({ data, csvHref }: { data: { rows: NumberRow[]; truncated: boolean }; csvHref: string }) {
  const rows = data.rows;
  return (
    <ChartCard
      title="Answer rate by number"
      description={`Most-called numbers first.${data.truncated ? " Showing the top 25; download the CSV for all of them." : ""}`}
      empty={!rows.length}
      emptyText="No calls in this period."
      className="md:col-span-2"
      table={{
        columns: ["Number", "Member", "Calls", "Answered", "Rate"],
        rows: rows.map((r) => [r.number, r.member || "–", r.attempts, r.answered, `${r.rate}%`]),
      }}
    >
      <div className="grid gap-2">
        <div className="overflow-auto rounded-md border border-line">
          <table className="w-full min-w-[720px] text-[12.5px]">
            <thead>
              <tr>
                <th className="ivr-th">Number</th>
                <th className="ivr-th">Member</th>
                <th className="ivr-th text-right">Calls</th>
                <th className="ivr-th text-right">Out / In</th>
                <th className="ivr-th text-right">Answered</th>
                <th className="ivr-th text-right">Answer rate</th>
                <th className="ivr-th text-right">Avg talk</th>
                <th className="ivr-th text-right">Best hour</th>
                <th className="ivr-th">Last call</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.number}>
                  <td className="ivr-td py-1.5 font-mono text-[12px]">{r.number}</td>
                  <td className="ivr-td py-1.5">{r.member || <span className="text-muted">–</span>}</td>
                  <td className="ivr-td tabular-nums py-1.5 text-right">{r.attempts}</td>
                  <td className="ivr-td tabular-nums py-1.5 text-right">
                    {r.outbound} / {r.inbound}
                  </td>
                  <td className="ivr-td tabular-nums py-1.5 text-right">{r.answered}</td>
                  <td className={`ivr-td tabular-nums py-1.5 text-right ${r.answered === 0 ? "text-brand-red" : ""}`}>{r.rate}%</td>
                  <td className="ivr-td tabular-nums py-1.5 text-right">{r.avgTalkSec ? fmtSec(r.avgTalkSec) : "–"}</td>
                  <td className="ivr-td tabular-nums py-1.5 text-right">{hourLabel(r.bestHour)}</td>
                  <td className="ivr-td py-1.5 whitespace-nowrap text-muted">{r.lastAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-3 text-[13px]">
          <a className="font-medium text-primary underline underline-offset-2" href={csvHref}>
            Download all numbers (CSV)
          </a>
          <a className="font-medium text-primary underline underline-offset-2" href={`${csvHref}&never=1`}>
            Download numbers that never answered (CSV)
          </a>
        </div>
      </div>
    </ChartCard>
  );
}

type Bar1 = { name: string; n: number; color: string };

function HBars({ data, labelWidth = 84 }: { data: Bar1[]; labelWidth?: number }) {
  return (
    <div style={{ height: Math.max(150, data.length * 34 + 20) }} role="img" aria-label={`Bar chart: ${data.map((d) => `${d.name} ${d.n}`).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 36, bottom: 0, left: 0 }} barSize={18}>
          <CartesianGrid horizontal={false} {...GRID} />
          <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
          <YAxis type="category" dataKey="name" width={labelWidth} tick={AXIS} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "var(--ivr-surface-2)" }} />
          <Bar dataKey="n" name="Count" radius={[0, 3, 3, 0]}>
            {data.map((d) => (
              <Cell key={d.name} fill={d.color} />
            ))}
            <LabelList dataKey="n" position="right" fill="var(--ivr-muted)" fontSize={11} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AssignmentTable({ data }: { data: AssignmentSummary }) {
  const rows = data.rows.filter((r) => r.received || r.reassignedAway);
  return (
    <ChartCard
      title="Allocations and reallocations"
      description={`${data.totalAssigned} member allocations, ${data.totalReassigned} of them reassignments.`}
      empty={!rows.length}
      emptyText="No members were allocated in this period."
      table={{
        columns: ["Agent", "Received", "Moved away"],
        rows: rows.map((r) => [r.name, r.received, r.reassignedAway]),
      }}
    >
      <div className="overflow-auto rounded-md border border-line">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr>
              <th className="ivr-th">Agent</th>
              <th className="ivr-th text-right">Received</th>
              <th className="ivr-th text-right">Moved away</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.userId}>
                <td className="ivr-td py-1.5">{r.name}</td>
                <td className="ivr-td tabular-nums py-1.5 text-right">{r.received}</td>
                <td className="ivr-td tabular-nums py-1.5 text-right">{r.reassignedAway}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartCard>
  );
}
