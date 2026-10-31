"use client";

import { ChartCard } from "./chart-card";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** Calls by weekday and hour (IST). Darker means more; each non-empty cell also prints its count. */
export function HeatmapChart({ grid }: { grid: number[][] }) {
  let max = 0;
  let first = 24;
  let last = -1;
  const slots: { day: string; hour: number; n: number }[] = [];
  grid.forEach((row, d) =>
    row.forEach((n, h) => {
      if (n > 0) {
        max = Math.max(max, n);
        first = Math.min(first, h);
        last = Math.max(last, h);
        slots.push({ day: DAYS[d], hour: h, n });
      }
    }),
  );
  const lo = Math.min(8, first === 24 ? 8 : first);
  const hi = Math.max(19, last);
  const hours = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const top = slots.sort((a, b) => b.n - a.n).slice(0, 12);

  return (
    <ChartCard
      title="Busiest hours"
      description="Calls by weekday and hour. Use it to plan shifts."
      empty={max === 0}
      emptyText="No calls in this period."
      className="md:col-span-2"
      table={{
        columns: ["Slot", "Calls"],
        rows: top.map((s) => [`${s.day} ${hourLabel(s.hour)}–${hourLabel(s.hour + 1)}`, s.n]),
      }}
    >
      <div className="overflow-x-auto" role="img" aria-label="Heatmap of call volume by weekday and hour">
        <div className="grid min-w-[560px] gap-[2px]" style={{ gridTemplateColumns: `34px repeat(${hours.length}, minmax(0, 1fr))` }}>
          <span />
          {hours.map((h) => (
            <span key={h} className="tabular-nums text-center text-[10px] text-muted">
              {h}
            </span>
          ))}
          {DAYS.map((day, d) => (
            <Row key={day} day={day} cells={hours.map((h) => grid[d][h])} hours={hours} max={max} />
          ))}
        </div>
        <p className="mt-2 flex items-center gap-2 text-[11px] text-muted">
          Fewer
          {[0.12, 0.35, 0.6, 0.8, 1].map((p) => (
            <span
              key={p}
              className="inline-block h-3 w-5 rounded-[3px]"
              style={{ background: `color-mix(in srgb, var(--ivr-accent) ${Math.round(p * 100)}%, var(--ivr-surface))` }}
              aria-hidden
            />
          ))}
          More. Hour of day, 24-hour clock.
        </p>
      </div>
    </ChartCard>
  );
}

function Row({ day, cells, hours, max }: { day: string; cells: number[]; hours: number[]; max: number }) {
  return (
    <>
      <span className="pr-1 text-right text-[11px] leading-6 text-muted">{day}</span>
      {cells.map((n, i) => {
        const pct = n ? Math.round(12 + (88 * n) / max) : 0;
        return (
          <span
            key={hours[i]}
            title={`${day} ${hourLabel(hours[i])}–${hourLabel(hours[i] + 1)}: ${n} call${n === 1 ? "" : "s"}`}
            className="tabular-nums grid h-6 place-items-center rounded-[3px] text-[10px]"
            style={{
              background: n ? `color-mix(in srgb, var(--ivr-accent) ${pct}%, var(--ivr-surface))` : "var(--ivr-surface-2)",
              color: pct > 55 ? "var(--ivr-accent-ink)" : "var(--ivr-fg)",
            }}
          >
            {n || ""}
          </span>
        );
      })}
    </>
  );
}
