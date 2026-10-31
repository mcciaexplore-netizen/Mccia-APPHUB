"use client";

import { useId, useState, type ReactNode } from "react";
import { BarChart3, Table2 } from "lucide-react";

export type LegendItem = { label: string; color: string };
export type TableData = { columns: string[]; rows: (string | number)[][] };

/** Shared frame for every analytics chart: title, legend, empty state and an accessible table view. */
export function ChartCard({
  title,
  description,
  legend,
  table,
  empty,
  emptyText = "No data for this period.",
  className = "",
  children,
}: {
  title: string;
  description?: string;
  legend?: LegendItem[];
  table: TableData;
  empty?: boolean;
  emptyText?: string;
  className?: string;
  children: ReactNode;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const id = useId();
  return (
    <section className={`ivr-card flex min-w-0 flex-col gap-3 p-6 ${className}`} aria-labelledby={`${id}-t`}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`${id}-t`} className="text-[1.02rem]">
            {title}
          </h3>
          {description && <p className="text-[12px] text-muted">{description}</p>}
        </div>
        {!empty && (
          <button
            type="button"
            className="btn btn-ghost btn-sm shrink-0"
            aria-pressed={view === "table"}
            onClick={() => setView(view === "chart" ? "table" : "chart")}
          >
            {view === "chart" ? <Table2 className="h-3.5 w-3.5" /> : <BarChart3 className="h-3.5 w-3.5" />}
            {view === "chart" ? "Table" : "Chart"}
          </button>
        )}
      </header>
      {legend && legend.length > 1 && view === "chart" && !empty && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted" aria-label="Legend">
          {legend.map((l) => (
            <li key={l.label} className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: l.color }} aria-hidden />
              {l.label}
            </li>
          ))}
        </ul>
      )}
      {empty ? (
        <div className="grid min-h-40 place-items-center rounded-[12px] border border-dashed border-line px-4 py-8 text-center text-[13px] text-muted">
          {emptyText}
        </div>
      ) : view === "chart" ? (
        children
      ) : (
        <div className="max-h-72 overflow-auto rounded-[12px] border border-line">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr>
                {table.columns.map((c, i) => (
                  <th key={c} className={`ivr-th ${i > 0 ? "text-right" : ""}`}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((v, i) => (
                    <td key={i} className={`ivr-td tabular-nums py-1.5 ${i > 0 ? "text-right" : ""}`}>
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

export const AXIS = { fill: "var(--ivr-muted)", fontSize: 11 } as const;

export const TOOLTIP_STYLE = {
  background: "var(--ivr-surface)",
  border: "1px solid var(--ivr-line)",
  borderRadius: 12,
  fontSize: 12,
  color: "var(--ivr-fg)",
  boxShadow: "var(--ivr-shadow-card-hover)",
} as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-04" -> "Oct 4" */
export function shortDay(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}`;
}

export function fmtSec(sec: number): string {
  if (!sec) return "0s";
  if (sec >= 3600) return `${Math.floor(sec / 3600)}h ${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}m`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}
