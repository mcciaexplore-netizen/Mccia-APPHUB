"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AgentStat, UserDay } from "@/lib/ivr/analytics";
import { AXIS, ChartCard, TOOLTIP_STYLE, fmtSec, shortDay } from "./chart-card";

const A = "var(--ivr-accent)";
const B = "var(--ivr-purple)";

type Metric = { label: string; get: (s: AgentStat) => number | null; fmt: (n: number | null) => string; higherBetter?: boolean };

const METRICS: Metric[] = [
  { label: "Outbound calls", get: (s) => s.outbound, fmt: (n) => String(n ?? 0) },
  { label: "Inbound calls", get: (s) => s.inbound, fmt: (n) => String(n ?? 0) },
  { label: "Answered calls", get: (s) => s.answered, fmt: (n) => String(n ?? 0), higherBetter: true },
  { label: "Not answered", get: (s) => s.notAnswered, fmt: (n) => String(n ?? 0), higherBetter: false },
  { label: "Pick-up rate", get: (s) => s.pickupRate, fmt: (n) => (n === null ? "–" : `${n}%`), higherBetter: true },
  { label: "Talk time", get: (s) => s.talkSec, fmt: (n) => fmtSec(n ?? 0), higherBetter: true },
  { label: "Avg talk time", get: (s) => s.avgTalkSec, fmt: (n) => fmtSec(n ?? 0) },
  { label: "Avg ring time", get: (s) => s.avgRingSec, fmt: (n) => fmtSec(n ?? 0), higherBetter: false },
  { label: "Members called", get: (s) => s.membersCalled, fmt: (n) => String(n ?? 0), higherBetter: true },
  { label: "Members allocated", get: (s) => s.assigned, fmt: (n) => String(n ?? 0) },
];

/** Two agents side by side: metric table plus a daily answered-calls line for each. */
export function CompareView({ agents, series }: { agents: AgentStat[]; series: UserDay[] }) {
  if (agents.length !== 2 || series.length !== 2) return null;
  const [a, b] = agents;
  const [sa, sb] = series;
  const data = sa.days.map((d, i) => ({ day: d.day, a: d.answered, b: sb.days[i]?.answered ?? 0 }));
  const empty = data.every((d) => d.a + d.b === 0);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard
        title={`${a.name} compared with ${b.name}`}
        description="Same period, same rules. The leading value in each row is bold."
        table={{
          columns: ["Metric", a.name, b.name],
          rows: METRICS.map((m) => [m.label, m.fmt(m.get(a)), m.fmt(m.get(b))]),
        }}
      >
        <div className="overflow-auto rounded-md border border-line">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr>
                <th className="ivr-th">Metric</th>
                <th className="ivr-th text-right">
                  <Swatch color={A} />
                  {a.name}
                </th>
                <th className="ivr-th text-right">
                  <Swatch color={B} />
                  {b.name}
                </th>
              </tr>
            </thead>
            <tbody>
              {METRICS.map((m) => {
                const va = m.get(a);
                const vb = m.get(b);
                const lead =
                  m.higherBetter === undefined || va === null || vb === null || va === vb
                    ? null
                    : (va > vb) === m.higherBetter
                      ? "a"
                      : "b";
                return (
                  <tr key={m.label}>
                    <td className="ivr-td py-1.5 text-muted">{m.label}</td>
                    <td className={`ivr-td tabular-nums py-1.5 text-right ${lead === "a" ? "font-semibold" : ""}`}>{m.fmt(va)}</td>
                    <td className={`ivr-td tabular-nums py-1.5 text-right ${lead === "b" ? "font-semibold" : ""}`}>{m.fmt(vb)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </ChartCard>

      <ChartCard
        title="Answered calls per day"
        description="One line per agent."
        legend={[
          { label: a.name, color: A },
          { label: b.name, color: B },
        ]}
        empty={empty}
        emptyText="Neither agent answered calls in this period."
        table={{
          columns: ["Day", a.name, b.name],
          rows: data.map((d) => [shortDay(d.day), d.a, d.b]),
        }}
      >
        <div style={{ height: 230 }} role="img" aria-label={`Answered calls per day for ${a.name} and ${b.name}`}>
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
              <CartesianGrid vertical={false} stroke="var(--ivr-line)" strokeOpacity={0.7} />
              <XAxis dataKey="day" tickFormatter={shortDay} tick={AXIS} axisLine={{ stroke: "var(--ivr-line)" }} tickLine={false} minTickGap={28} />
              <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(l) => shortDay(String(l))} cursor={{ stroke: "var(--ivr-line-strong)" }} />
              <Line type="monotone" dataKey="a" name={a.name} stroke={A} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              <Line type="monotone" dataKey="b" name={b.name} stroke={B} strokeWidth={2} strokeDasharray="5 3" dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>
    </div>
  );
}

function Swatch({ color }: { color: string }) {
  return <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-[2px] align-middle" style={{ background: color }} aria-hidden />;
}
