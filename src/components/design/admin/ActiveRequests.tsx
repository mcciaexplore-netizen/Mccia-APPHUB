"use client";

import Link from "next/link";
import { useState } from "react";
import type { TicketCard } from "@/lib/design/tickets";
import { dueHealth, istDate, timeLeft } from "@/lib/design/rules";
import { Badge, Empty, StatusBadge, formatDay } from "../ui";

const FILTERS = {
  all: { label: "All", test: () => true },
  overdue: { label: "Overdue", test: (t: TicketCard) => dueHealth(t.dueAt, t.status) === "overdue" },
  today: { label: "Due Today", test: (t: TicketCard) => !!t.dueAt && istDate(new Date(t.dueAt)) === istDate() },
  review: { label: "In Review", test: (t: TicketCard) => t.status === "in_review" },
  unassigned: { label: "Unassigned", test: (t: TicketCard) => !t.assigneeId },
} as const;
type Filter = keyof typeof FILTERS;

/** On track, due within a day, or late, from the ticket's deadline. */
function Health({ t }: { t: TicketCard }) {
  const h = dueHealth(t.dueAt, t.status);
  if (h === "overdue") return <Badge tone="red">Overdue ⚠</Badge>;
  if (h === "soon") return <Badge tone="amber">Due soon</Badge>;
  if (h === "none") return <span className="ds-muted">No deadline</span>;
  return <Badge tone="green">On track</Badge>;
}

/**
 * Every accepted request still open (leads' dashboard), grouped by the designer it is with, unassigned ones last, each with its status,
 * deadline and whether it is on track; quick filters for overdue, due today, in review and unassigned. A ticket number opens the ticket.
 */
export function ActiveRequests({ tickets }: { tickets: TicketCard[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const shown = tickets.filter(FILTERS[filter].test);
  const groups = new Map<string, { name: string; items: TicketCard[] }>();
  for (const t of shown) {
    const key = t.assigneeId ?? "";
    if (!groups.has(key)) groups.set(key, { name: t.assigneeName ?? "Unassigned", items: [] });
    groups.get(key)!.items.push(t);
  }
  const ordered = [...groups.entries()].sort(([a, x], [b, y]) => (a === "" ? 1 : b === "" ? -1 : x.name.localeCompare(y.name))).map(([, g]) => g);

  return (
    <div>
      <div className="border-b border-[var(--ds-line)] px-5 py-3">
        <div className="ds-tabs" role="tablist" aria-label="Show active requests">
          {(Object.keys(FILTERS) as Filter[]).map((f) => (
            <button key={f} type="button" role="tab" aria-selected={filter === f} className="ds-tab" onClick={() => setFilter(f)} suppressHydrationWarning>
              {FILTERS[f].label} <span className="ds-muted tabular-nums">{tickets.filter(FILTERS[f].test).length}</span>
            </button>
          ))}
        </div>
      </div>
      {ordered.length === 0 ? (
        <Empty title={tickets.length ? "Nothing here" : "No active requests"}>{tickets.length ? "No active request is in this group." : "Requests you accept appear here until they are delivered."}</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[60rem] text-sm">
            <thead>
              <tr className="text-left">
                <th className="ds-label px-5 py-2.5">Ticket</th>
                <th className="ds-label px-3 py-2.5">Title</th>
                <th className="ds-label px-3 py-2.5">Design</th>
                <th className="ds-label px-3 py-2.5">Requested by</th>
                <th className="ds-label px-3 py-2.5">Status</th>
                <th className="ds-label px-3 py-2.5">Due</th>
                <th className="ds-label px-3 py-2.5">Health</th>
                <th className="ds-label px-5 py-2.5 text-right">Time left</th>
              </tr>
            </thead>
            {ordered.map((g) => (
              <tbody key={g.name} className="divide-y divide-[var(--ds-line)] border-t border-[var(--ds-line)]">
                <tr className="bg-[var(--ds-grey-tint)]">
                  <th scope="rowgroup" colSpan={8} className="px-5 py-2 text-left text-[0.82rem] font-bold text-ink">
                    {g.items[0].assigneeId ? `Designer: ${g.name}` : "Unassigned"} <span className="font-normal ds-muted">· {g.items.length}</span>
                  </th>
                </tr>
                {g.items.map((t) => (
                  <tr key={t.id} className="hover:bg-[#fafafa]">
                    <td className="whitespace-nowrap px-5 py-2.5">
                      <Link href={`/design/admin/tickets/${t.id}`} className="font-bold text-[var(--ds-navy)] hover:underline">
                        {t.number}
                      </Link>
                    </td>
                    <td className="max-w-[16rem] truncate px-3 py-2.5 font-medium text-ink" title={t.title}>{t.title}</td>
                    <td className="max-w-[12rem] truncate px-3 py-2.5" title={t.designs.join(", ")}>{t.designs.join(", ") || "–"}</td>
                    <td className="px-3 py-2.5">{t.requesterName ?? "–"}</td>
                    <td className="px-3 py-2.5"><StatusBadge status={t.status} /></td>
                    <td className="whitespace-nowrap px-3 py-2.5">{t.dueAt ? formatDay(t.dueAt) : "–"}</td>
                    <td className="whitespace-nowrap px-3 py-2.5" suppressHydrationWarning><Health t={t} /></td>
                    <td className="whitespace-nowrap px-5 py-2.5 text-right tabular-nums" suppressHydrationWarning>{t.dueAt ? timeLeft(t.dueAt) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </div>
  );
}
