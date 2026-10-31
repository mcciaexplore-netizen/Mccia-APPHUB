import Link from "next/link";
import { cx as clsx } from "@/lib/ivr/cx";
import type { DateRange } from "@/lib/ivr/time";

const PRESETS = [
  { key: "today", label: "Today" },
  { key: "week", label: "7 days" },
  { key: "month", label: "30 days" },
] as const;

/** Daily / weekly / monthly presets plus a custom from–to form. Plain GET, so it works without client JS. */
export function RangeTabs({ range, basePath }: { range: DateRange; basePath: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex gap-1 rounded-[12px] border border-line bg-[var(--ivr-card)] p-1 backdrop-blur-md" role="group" aria-label="Date range">
        {PRESETS.map((p) => (
          <Link
            key={p.key}
            href={`${basePath}?range=${p.key}`}
            className={clsx(
              "rounded-[8px] px-3.5 py-1.5 text-[0.82rem] font-medium transition-colors",
              range.key === p.key ? "bg-[var(--ivr-tint-blue)] font-semibold text-primary" : "text-muted hover:bg-[var(--ivr-tint-blue)] hover:text-primary",
            )}
          >
            {p.label}
          </Link>
        ))}
      </div>
      <form action={basePath} className="flex flex-wrap items-center gap-2 text-[13px]">
        <input type="hidden" name="range" value="custom" />
        <label className="flex items-center gap-1.5 text-muted">
          From
          <input type="date" name="from" defaultValue={range.fromStr} className="input w-auto" required />
        </label>
        <label className="flex items-center gap-1.5 text-muted">
          To
          <input type="date" name="to" defaultValue={range.toStr} className="input w-auto" required />
        </label>
        <button className={clsx("btn btn-ghost btn-sm", range.key === "custom" && "border-primary text-primary")}>Apply</button>
      </form>
    </div>
  );
}
