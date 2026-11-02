"use client";

import { useId, useState, type ReactNode } from "react";
import { BarChart3, Table2 } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Report } from "@/lib/design/reports";

/**
 * The reports page's charts. Each has a table view (the same numbers as text), for screen readers and for reading exact values. Colours
 * come from DesignDesk's palette: navy, green, amber, purple and grey.
 */

const NAVY = "#003F8A";
const GREEN = "#10B981";
const GRID = { stroke: "#e5e7eb" } as const;
const AXIS = { fontSize: 11, fill: "#64748b" } as const;
const TOOLTIP = { borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 12 } as const;
const STATUS_COLORS: Record<string, string> = { "Pending review": "#d97706", Open: NAVY, "In review": "#7c3aed", Delivered: GREEN, Other: "#94a3b8" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (day: string) => `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;

function ChartCard({ title, description, table, empty, children }: { title: string; description?: string; table: { columns: string[]; rows: (string | number)[][] }; empty: boolean; children: ReactNode }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const id = useId();
  return (
    <section className="ds-card flex min-w-0 flex-col gap-3 p-5" aria-labelledby={`${id}-t`}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`${id}-t`} className="text-[1.02rem] font-bold text-ink">
            {title}
          </h2>
          {description && <p className="text-xs ds-muted">{description}</p>}
        </div>
        {!empty && (
          <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={() => setView((v) => (v === "chart" ? "table" : "chart"))} aria-label={view === "chart" ? `Show ${title} as a table` : `Show ${title} as a chart`}>
            {view === "chart" ? <Table2 size={14} /> : <BarChart3 size={14} />}
            {view === "chart" ? "Table" : "Chart"}
          </button>
        )}
      </header>
      {empty ? (
        <p className="grid h-48 place-items-center text-sm ds-muted">Nothing in this period.</p>
      ) : view === "chart" ? (
        <div className="h-64 w-full">{children}</div>
      ) : (
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {table.columns.map((c) => (
                  <th key={c} className="ds-label px-2 py-1.5 text-left">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ds-line)]">
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((v, j) => (
                    <td key={j} className="px-2 py-1.5 tabular-nums">
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function ReportCharts({ report: r }: { report: Report }) {
  const sla = r.sla.map((w) => ({ week: short(w.week), rate: w.rate, delivered: w.delivered }));
  const status = r.statusOverTime.map((w) => ({ ...w, week: short(String(w.week)) }));
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <ChartCard
        title="Deadlines met"
        description="Share of designs delivered on or before their deadline, by week"
        empty={!r.sla.some((w) => w.delivered)}
        table={{ columns: ["Week of", "Delivered", "On time"], rows: r.sla.map((w) => [w.week, w.delivered, w.rate == null ? "–" : `${w.rate}%`]) }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={sla} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
            <CartesianGrid {...GRID} vertical={false} />
            <XAxis dataKey="week" tick={AXIS} tickLine={false} axisLine={false} />
            <YAxis domain={[0, 100]} tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}%`} />
            <Tooltip contentStyle={TOOLTIP} formatter={(v) => [v == null ? "–" : `${v}%`, "On time"]} />
            <Line type="monotone" dataKey="rate" stroke={GREEN} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard
        title="Average turnaround by design"
        description="Hours from request to delivery"
        empty={!r.turnaround.length}
        table={{ columns: ["Design", "Delivered", "Average hours"], rows: r.turnaround.map((t) => [t.design, t.count, t.hours]) }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={r.turnaround} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
            <CartesianGrid {...GRID} horizontal={false} />
            <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} unit="h" />
            <YAxis type="category" dataKey="design" tick={AXIS} tickLine={false} axisLine={false} width={120} />
            <Tooltip contentStyle={TOOLTIP} formatter={(v) => [`${v} hours`, "Average"]} />
            <Bar dataKey="hours" fill={NAVY} radius={[0, 6, 6, 0]} maxBarSize={22} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard
        title="Revisions by department"
        description="New requests and change versions made in the period"
        empty={!r.revisionsByDept.length}
        table={{ columns: ["Department", "Requests", "Revisions"], rows: r.revisionsByDept.map((d) => [d.department, d.requests, d.revisions]) }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={r.revisionsByDept} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
            <CartesianGrid {...GRID} vertical={false} />
            <XAxis dataKey="department" tick={AXIS} tickLine={false} axisLine={false} interval={0} />
            <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={TOOLTIP} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="requests" name="Requests" fill={NAVY} radius={[6, 6, 0, 0]} maxBarSize={28} />
            <Bar dataKey="revisions" name="Revisions" fill="#d97706" radius={[6, 6, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard
        title="Hours by designer"
        description="Time logged on tickets in the period"
        empty={!r.hoursByDesigner.length}
        table={{ columns: ["Designer", "Hours"], rows: r.hoursByDesigner.map((h) => [h.name, h.hours]) }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={r.hoursByDesigner} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
            <CartesianGrid {...GRID} horizontal={false} />
            <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} unit="h" />
            <YAxis type="category" dataKey="name" tick={AXIS} tickLine={false} axisLine={false} width={120} />
            <Tooltip contentStyle={TOOLTIP} formatter={(v) => [`${v} hours`, "Logged"]} />
            <Bar dataKey="hours" fill={GREEN} radius={[0, 6, 6, 0]} maxBarSize={22} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <div className="lg:col-span-2">
        <ChartCard
          title="Requests by status over time"
          description="Requests made each week, by where they stand now"
          empty={!r.statusOverTime.some((w) => r.statusKeys.some((k) => Number(w[k]) > 0))}
          table={{ columns: ["Week of", ...r.statusKeys], rows: r.statusOverTime.map((w) => [String(w.week), ...r.statusKeys.map((k) => Number(w[k]))]) }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={status} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis dataKey="week" tick={AXIS} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={TOOLTIP} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {r.statusKeys.map((k) => (
                <Area key={k} type="monotone" dataKey={k} stackId="s" stroke={STATUS_COLORS[k] ?? "#94a3b8"} fill={STATUS_COLORS[k] ?? "#94a3b8"} fillOpacity={0.35} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}
