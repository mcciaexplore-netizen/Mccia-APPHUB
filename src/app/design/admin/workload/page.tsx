import Link from "next/link";
import { Avatar, Card, Empty, PageHeader, formatDay } from "@/components/design/ui";
import { requireLead } from "@/lib/design/dal";
import { loadTone } from "@/lib/design/capacity";
import { workload } from "@/lib/design/reports";
import { weekdayOf } from "@/lib/design/rules";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TONE_TEXT = { free: "Has room", full: "Nearly full", over: "Overloaded", off: "On leave" } as const;

/**
 * Who has room, day by day: each open ticket's remaining hours are spread over the working days before its deadline (all of it today when
 * it is late), against each designer's daily hours. Hover or tab to a day to see which tickets fill it. The hours are always written in
 * the cell, so the colour is never the only signal.
 */
export default async function WorkloadPage() {
  await requireLead();
  const { rows, days } = await workload();
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Team workload" subtitle="Hours of open work per designer for the next working days, against what they can do in a day." />
      <div className="flex flex-wrap items-center gap-3 text-xs" aria-label="Legend">
        {(["free", "full", "over", "off"] as const).map((t) => (
          <span key={t} className={`ds-load-${t} rounded-md px-2.5 py-1 font-semibold`}>
            {t === "free" ? "Under 6h" : t === "full" ? "6–8h" : t === "over" ? "Over 8h" : "On leave"} · {TONE_TEXT[t]}
          </span>
        ))}
      </div>
      {rows.length === 0 ? (
        <Card>
          <Empty title="No designers yet">Give designers the Design Admin application and add them to its App Staff (Administrator → Applications → Edit) and they appear here.</Empty>
        </Card>
      ) : (
        <div className="ds-card overflow-x-auto">
          <table className="w-full min-w-[760px] border-separate border-spacing-1 text-sm">
            <thead>
              <tr>
                <th className="ds-label sticky left-0 z-[1] bg-white px-3 py-2 text-left">Designer</th>
                {days.map((d) => (
                  <th key={d} className="ds-label px-1 py-2 text-center font-bold">
                    <span className="block">{DAY_NAMES[weekdayOf(d)]}</span>
                    <span className="block font-normal normal-case tracking-normal">{formatDay(d).replace(/ \d{4}$/, "")}</span>
                  </th>
                ))}
                <th className="ds-label px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.designer.id}>
                  <th scope="row" className="sticky left-0 z-[1] bg-white px-3 py-2 text-left font-normal">
                    <span className="flex items-center gap-2">
                      <Avatar name={r.designer.name} size={26} />
                      <span>
                        <span className="block font-semibold text-ink">{r.designer.name}</span>
                        <span className="block text-xs ds-muted">
                          {r.designer.dailyHours}h a day
                          {r.lateTickets > 0 && <span className="font-semibold text-[var(--ds-red)]"> · {r.lateTickets} late</span>}
                        </span>
                      </span>
                    </span>
                  </th>
                  {r.cells.map((c) => {
                    const tone = loadTone(c.hours, c.capacity);
                    return (
                      <td key={c.day} className="p-0 align-top">
                        <div tabIndex={0} className={`ds-load-${tone} group relative rounded-md px-1 py-2 text-center outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-navy)]`} aria-label={`${r.designer.name}, ${formatDay(c.day)}: ${c.hours} of ${c.capacity} hours, ${TONE_TEXT[tone]}`}>
                          <span className="block text-[0.82rem] font-bold tabular-nums">{c.capacity === 0 && c.hours === 0 ? "Off" : `${c.hours}h`}</span>
                          <span className="block text-[0.66rem] opacity-80">/ {c.capacity}h</span>
                          {c.tickets.length > 0 && (
                            <div className="absolute left-1/2 top-full z-20 mt-1 hidden w-64 -translate-x-1/2 rounded-lg border border-[var(--ds-line)] bg-white p-3 text-left text-ink shadow-lg group-hover:block group-focus-within:block">
                              <p className="ds-label mb-1.5">{formatDay(c.day)}</p>
                              <ul className="flex flex-col gap-1.5">
                                {c.tickets.map((t) => (
                                  <li key={t.id} className="flex items-start justify-between gap-2 text-xs">
                                    <Link href={`/design/admin/tickets/${t.id}`} className="min-w-0 flex-1 hover:underline">
                                      <span className="font-bold text-[var(--ds-navy)]">{t.number}</span> <span className="line-clamp-2">{t.title}</span>
                                    </Link>
                                    <span className="shrink-0 font-semibold tabular-nums">{t.hours}h</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right font-bold tabular-nums text-ink">{r.totalHours}h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
