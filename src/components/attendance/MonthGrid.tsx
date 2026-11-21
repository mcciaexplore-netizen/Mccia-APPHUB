import type { ReactNode } from "react";
import { eachDay, monthRange, weekday } from "@/lib/attendance/time";

/** A month as a Monday-first calendar grid; each day's cell is drawn by `cell`. */
export function MonthGrid({ month, today, cell, cellClass }: { month: string; today: string; cell: (day: string) => ReactNode; cellClass?: (day: string) => string }) {
  const { from, to } = monthRange(month);
  const days = eachDay(from, to);
  const lead = (weekday(from) + 6) % 7;
  return (
    <div>
      <div className="att-cal mb-1">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="text-center text-[0.68rem] font-bold uppercase tracking-wider att-muted">
            {d}
          </div>
        ))}
      </div>
      <div className="att-cal">
        {Array.from({ length: lead }, (_, i) => (
          <div key={`lead-${i}`} />
        ))}
        {days.map((d) => (
          <div key={d} className={`att-cal-cell ${cellClass?.(d) ?? ""} ${d === today ? "att-today" : ""}`}>
            <span className="font-bold">{Number(d.slice(8))}</span>
            {cell(d)}
          </div>
        ))}
      </div>
    </div>
  );
}
