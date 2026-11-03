"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { TicketCard } from "@/lib/design/tickets";
import { listHref, type ListQuery, type ListSort } from "@/lib/design/ticket-list";
import { dueHealth } from "@/lib/design/rules";
import { Badge, PriorityBadge, StatusBadge, formatDay } from "../ui";

const COLUMNS: { label: string; sort?: ListSort; className?: string }[] = [
  { label: "Ticket #", sort: "number", className: "px-5" },
  { label: "Title", sort: "title" },
  { label: "Requested by" },
  { label: "Design type" },
  { label: "Assigned to" },
  { label: "Priority", sort: "priority" },
  { label: "Status", sort: "status" },
  { label: "Delivery date", sort: "due" },
  { label: "Created", sort: "created", className: "px-5" },
];

/** The All Tickets table: a click anywhere on a row opens the ticket; sortable column headers are links (the sort lives in the address). */
export function TicketTable({ rows, query }: { rows: TicketCard[]; query: ListQuery }) {
  const router = useRouter();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[68rem] text-sm">
        <thead>
          <tr className="text-left">
            {COLUMNS.map((c) => {
              const on = c.sort === query.sort;
              const next = on ? (query.dir === "asc" ? "desc" : "asc") : c.sort === "created" ? "desc" : "asc";
              return (
                <th key={c.label} scope="col" className={`ds-label py-2.5 ${c.className ?? "px-3"}`} aria-sort={on ? (query.dir === "asc" ? "ascending" : "descending") : undefined}>
                  {c.sort ? (
                    <Link href={listHref(query, { sort: c.sort, dir: next, page: 1 })} className="inline-flex items-center gap-1 hover:text-[var(--ds-navy)]">
                      {c.label}
                      {on && (query.dir === "asc" ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden />)}
                    </Link>
                  ) : (
                    c.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--ds-line)]">
          {rows.map((t) => {
            const late = dueHealth(t.dueAt, t.status) === "overdue";
            return (
              <tr key={t.id} className={`cursor-pointer hover:bg-[#fafafa] ${late ? "bg-[rgba(220,38,38,0.04)]" : ""}`} onClick={() => router.push(`/design/admin/tickets/${t.id}`)}>
                <td className="whitespace-nowrap px-5 py-2.5">
                  <Link href={`/design/admin/tickets/${t.id}`} className="font-bold text-[var(--ds-navy)] hover:underline" onClick={(e) => e.stopPropagation()}>
                    {t.number}
                  </Link>
                </td>
                <td className="max-w-[16rem] truncate px-3 py-2.5 font-medium text-ink" title={t.title}>{t.title}</td>
                <td className="px-3 py-2.5">{t.requesterName ?? "–"}</td>
                <td className="max-w-[11rem] truncate px-3 py-2.5" title={t.designs.join(", ")}>{t.designs.join(", ") || "–"}</td>
                <td className="px-3 py-2.5">{t.assigneeName ?? <span className="ds-muted">Not assigned</span>}</td>
                <td className="px-3 py-2.5"><PriorityBadge priority={t.priority} /></td>
                <td className="px-3 py-2.5"><StatusBadge status={t.status} /></td>
                <td className="whitespace-nowrap px-3 py-2.5" suppressHydrationWarning>
                  <span className={late ? "font-semibold text-[var(--ds-red)]" : ""}>{t.dueAt ? formatDay(t.dueAt) : "–"}</span>
                  {late && <span className="ml-1.5"><Badge tone="red">Overdue</Badge></span>}
                </td>
                <td className="whitespace-nowrap px-5 py-2.5 ds-muted">{formatDay(t.createdAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
