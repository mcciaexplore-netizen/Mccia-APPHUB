"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AcceptedItem } from "@/lib/design/admin-queries";
import { FINISHED_STATUSES } from "@/lib/design/rules";
import { DueText, Empty, StatusBadge, formatDateTime } from "../ui";

const FILTERS = {
  all: { label: "All", test: () => true },
  progress: { label: "In Progress", test: (t: AcceptedItem) => ["new", "assigned", "in_progress", "waiting_on_requester"].includes(t.status) },
  review: { label: "In Review", test: (t: AcceptedItem) => t.status === "in_review" },
  delivered: { label: "Delivered", test: (t: AcceptedItem) => FINISHED_STATUSES.includes(t.status) },
  overdue: { label: "Overdue", test: (t: AcceptedItem) => t.isOverdue },
} as const;
type Filter = keyof typeof FILTERS;

/** The requests a lead accepted, newest acceptance first, with where each stands now. A row opens the ticket. */
export function AcceptedList({ items }: { items: AcceptedItem[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const shown = items.filter(FILTERS[filter].test);
  return (
    <div>
      <div className="border-b border-[var(--ds-line)] px-5 py-3">
        <div className="ds-tabs" role="tablist" aria-label="Show requests">
          {(Object.keys(FILTERS) as Filter[]).map((f) => (
            <button key={f} type="button" role="tab" aria-selected={filter === f} className="ds-tab" onClick={() => setFilter(f)}>
              {FILTERS[f].label} <span className="ds-muted tabular-nums">{items.filter(FILTERS[f].test).length}</span>
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? (
        <Empty title={items.length ? "Nothing here" : "No accepted requests yet"}>{items.length ? "No request you accepted is in this group." : "Requests you accept from Pending Review appear here."}</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] text-sm">
            <thead>
              <tr className="text-left">
                <th className="ds-label px-5 py-2.5">Ticket</th>
                <th className="ds-label px-3 py-2.5">Title</th>
                <th className="ds-label px-3 py-2.5">Requested by</th>
                <th className="ds-label px-3 py-2.5">Accepted on</th>
                <th className="ds-label px-3 py-2.5">Assigned to</th>
                <th className="ds-label px-3 py-2.5">Status</th>
                <th className="ds-label px-5 py-2.5">Delivery</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ds-line)]">
              {shown.map((t) => (
                <tr key={t.id} className="cursor-pointer hover:bg-[#fafafa]" onClick={() => router.push(`/design/admin/tickets/${t.id}`)}>
                  <td className="whitespace-nowrap px-5 py-2.5">
                    <Link href={`/design/admin/tickets/${t.id}`} className="font-bold text-[var(--ds-navy)] hover:underline" onClick={(e) => e.stopPropagation()}>
                      {t.number}
                    </Link>
                  </td>
                  <td className="max-w-[18rem] truncate px-3 py-2.5 font-medium text-ink" title={t.title}>{t.title}</td>
                  <td className="px-3 py-2.5">{t.requesterName ?? "–"}</td>
                  <td className="whitespace-nowrap px-3 py-2.5" suppressHydrationWarning>{formatDateTime(t.acceptedAt)}</td>
                  <td className="px-3 py-2.5">{t.assigneeName ?? <span className="ds-muted">Not assigned</span>}</td>
                  <td className="px-3 py-2.5"><StatusBadge status={t.status} /></td>
                  <td className="whitespace-nowrap px-5 py-2.5 text-xs">
                    <DueText dueAt={t.dueAt} status={t.status} />
                    {t.isOverdue && <span className="ml-1.5 rounded-full bg-[var(--ds-red)] px-1.5 py-0.5 text-[0.68rem] font-bold text-white">Overdue</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
