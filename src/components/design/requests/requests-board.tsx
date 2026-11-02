"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { TicketStatus } from "@/db/design-schema";
import { STATUS_LABEL } from "@/lib/design/rules";
import { Badge, DueText, Empty, StatusBadge, Steps, formatDay } from "../ui";

/** The all-requests board: grouped by department, with a search box and status, design and department filters (all in the browser). */

export type BoardRow = { id: string; number: string; title: string; status: TicketStatus; designs: string[]; department: string | null; dueAt: string | null; createdAt: string; deliveredAt: string | null };

const NO_DEPT = "No department";

export function RequestsBoard({ rows }: { rows: BoardRow[] }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [design, setDesign] = useState("");
  const [dept, setDept] = useState("");

  const statuses = useMemo(() => [...new Set(rows.map((r) => r.status))], [rows]);
  const designs = useMemo(() => [...new Set(rows.flatMap((r) => r.designs))].sort(), [rows]);
  const depts = useMemo(() => [...new Set(rows.map((r) => r.department || NO_DEPT))].sort(), [rows]);

  const shown = rows.filter(
    (r) =>
      (!q.trim() || `${r.number} ${r.title}`.toLowerCase().includes(q.trim().toLowerCase())) &&
      (!status || r.status === status) &&
      (!design || r.designs.includes(design)) &&
      (!dept || (r.department || NO_DEPT) === dept),
  );
  const groups = new Map<string, BoardRow[]>();
  for (const r of shown) {
    const k = r.department || NO_DEPT;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const ordered = [...groups].sort(([a], [b]) => (a === NO_DEPT ? 1 : b === NO_DEPT ? -1 : a.localeCompare(b)));

  return (
    <div className="flex flex-col gap-5">
      <div className="ds-card flex flex-wrap items-end gap-3 p-4">
        <label className="relative min-w-[200px] flex-1">
          <span className="sr-only">Search requests</span>
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
          <input className="input w-full pl-9" placeholder="Search by number or title" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <select className="input" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select className="input" aria-label="Design" value={design} onChange={(e) => setDesign(e.target.value)}>
          <option value="">All designs</option>
          {designs.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
        <select className="input" aria-label="Department" value={dept} onChange={(e) => setDept(e.target.value)}>
          <option value="">All departments</option>
          {depts.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
      </div>

      {ordered.length === 0 ? (
        <div className="ds-card">
          <Empty title={rows.length ? "No request matches" : "No requests yet"}>{rows.length ? "Try a different search or filter." : "Accepted requests will appear here."}</Empty>
        </div>
      ) : (
        ordered.map(([name, list]) => (
          <section key={name} aria-label={name}>
            <h2 className="mb-2 flex items-center gap-2 text-[1rem] font-bold text-ink">
              {name} <span className="text-sm font-normal ds-muted">({list.length})</span>
            </h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {list.map((r) => (
                <article key={r.id} className="ds-card ds-card-hover flex flex-col gap-2.5 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-[var(--ds-navy)]">{r.number}</p>
                      <h3 className="text-sm font-semibold leading-snug text-ink">{r.title}</h3>
                    </div>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {r.designs.map((d) => (
                      <Badge key={d} tone="blue">
                        {d}
                      </Badge>
                    ))}
                  </div>
                  <Steps status={r.status} compact />
                  <div className="flex flex-wrap justify-between gap-x-3 text-xs ds-muted">
                    <span>Asked {formatDay(r.createdAt)}</span>
                    {r.deliveredAt ? <span>Delivered {formatDay(r.deliveredAt)}</span> : <span>Due <DueText dueAt={r.dueAt} status={r.status} withLeft={false} /></span>}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
