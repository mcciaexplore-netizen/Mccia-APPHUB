"use client";

import { useState } from "react";
import { BarChart3, Table2 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { colorOf } from "@/lib/eru/eru.manifest";

/** Projects by domain, as bars in each domain's colour, with a table view of the same numbers (for screen readers and exact values). */
export function DomainChart({ data }: { data: { name: string; color: string; projects: number }[] }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const empty = data.every((d) => d.projects === 0);
  return (
    <section className="eru-card flex min-w-0 flex-col gap-3 p-5" aria-labelledby="eru-by-domain">
      <header className="flex items-start justify-between gap-3">
        <h2 id="eru-by-domain" className="text-[1.02rem] font-bold text-ink">
          Projects by domain
        </h2>
        {!empty && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setView((v) => (v === "chart" ? "table" : "chart"))}>
            {view === "chart" ? <Table2 size={14} aria-hidden /> : <BarChart3 size={14} aria-hidden />}
            {view === "chart" ? "Table" : "Chart"}
          </button>
        )}
      </header>
      {empty ? (
        <p className="py-10 text-center text-sm eru-muted">No projects yet.</p>
      ) : view === "chart" ? (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: -16 }}>
              <CartesianGrid stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} interval={0} tickFormatter={(n: string) => (n.length > 14 ? `${n.slice(0, 13)}…` : n)} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} />
              <Tooltip cursor={{ fill: "rgba(15,76,117,0.05)" }} contentStyle={{ borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 12 }} />
              <Bar dataKey="projects" name="Projects" radius={[6, 6, 0, 0]}>
                {data.map((d) => (
                  <Cell key={d.name} fill={colorOf(d.color).accent} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left eru-label">
              <th className="py-1.5">Domain</th>
              <th className="py-1.5 text-right">Projects</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.name} className="border-t border-[var(--eru-line)]">
                <td className="py-1.5">{d.name}</td>
                <td className="py-1.5 text-right tabular-nums">{d.projects}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
