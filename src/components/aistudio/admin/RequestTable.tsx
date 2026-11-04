"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp } from "lucide-react";
import { TYPE_LABEL } from "@/lib/aistudio/aistudio.manifest";
import { listHref, type ListQuery, type ListSort } from "@/lib/aistudio/list-query";
import type { RequestCard } from "@/lib/aistudio/queries";
import { PriorityBadge, StatusBadge, formatDay } from "../ui";

const COLUMNS: { label: string; sort: ListSort; className?: string }[] = [
  { label: "AS#", sort: "number", className: "px-5" },
  { label: "Title", sort: "title" },
  { label: "Type", sort: "type" },
  { label: "Requester", sort: "requester" },
  { label: "Assigned to", sort: "assignee" },
  { label: "Priority", sort: "priority" },
  { label: "Status", sort: "status" },
  { label: "Deadline", sort: "deadline" },
  { label: "Submitted", sort: "submitted", className: "px-5" },
];

/**
 * The list view: a click anywhere on a row opens the request; every column header sorts (the sort lives in the address). `today` (IST,
 * YYYY-MM-DD, from the server) marks open requests past their deadline in red.
 */
export function RequestTable({ rows, query, today }: { rows: RequestCard[]; query: ListQuery; today: string }) {
  const router = useRouter();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[64rem] text-sm">
        <thead>
          <tr className="text-left">
            {COLUMNS.map((c) => {
              const on = c.sort === query.sort;
              const next = on ? (query.dir === "asc" ? "desc" : "asc") : c.sort === "submitted" || c.sort === "number" ? "desc" : "asc";
              return (
                <th key={c.label} scope="col" className={`ai-label py-2.5 ${c.className ?? "px-3"}`} aria-sort={on ? (query.dir === "asc" ? "ascending" : "descending") : undefined}>
                  <Link href={listHref(query, { sort: c.sort, dir: next, page: 1 })} className="inline-flex items-center gap-1 hover:text-[var(--ai-navy)]">
                    {c.label}
                    {on && (query.dir === "asc" ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden />)}
                  </Link>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--ai-line)]">
          {rows.map((r) => {
            const late = !!r.deadline && r.deadline < today && ["accepted", "in_progress", "review_testing"].includes(r.status);
            return (
              <tr key={r.id} className="cursor-pointer hover:bg-[#fafafa]" onClick={() => router.push(`/aistudio/admin/requests/${r.id}`)}>
                <td className="whitespace-nowrap px-5 py-2.5">
                  <Link href={`/aistudio/admin/requests/${r.id}`} className="font-bold text-[var(--ai-navy)] hover:underline" onClick={(e) => e.stopPropagation()}>
                    {r.number}
                  </Link>
                </td>
                <td className="max-w-[16rem] truncate px-3 py-2.5 font-medium text-ink" title={r.title}>{r.title}</td>
                <td className="whitespace-nowrap px-3 py-2.5">{TYPE_LABEL[r.requestType]}</td>
                <td className="px-3 py-2.5">{r.requesterName ?? "–"}</td>
                <td className="px-3 py-2.5">{r.assigneeName ?? <span className="ai-muted">Not assigned</span>}</td>
                <td className="px-3 py-2.5"><PriorityBadge priority={r.priority} /></td>
                <td className="px-3 py-2.5"><StatusBadge status={r.status} /></td>
                <td className={`whitespace-nowrap px-3 py-2.5 ${late ? "font-semibold text-[var(--ai-red)]" : ""}`}>{r.deadline ? formatDay(r.deadline) : "–"}</td>
                <td className="whitespace-nowrap px-5 py-2.5 ai-muted">{formatDay(r.createdAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
