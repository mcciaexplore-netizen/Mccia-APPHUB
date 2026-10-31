"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";

const WHEN = [
  { v: "all", label: "All time" },
  { v: "today", label: "Today" },
  { v: "week", label: "Last 7 days" },
  { v: "month", label: "Last 30 days" },
];

/** URL-driven filters: every change rewrites the query string, so the server re-renders the table. */
export function LeadFilters({
  owners,
  categories,
  showWhen = true,
  showUnassigned,
}: {
  owners?: { id: string; name: string }[];
  categories?: { id: string; label: string }[];
  showWhen?: boolean;
  showUnassigned?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");

  const push = (patch: Record<string, string | null>) => {
    const n = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") n.delete(k);
      else n.set(k, v);
    }
    n.delete("page");
    const s = n.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };

  useEffect(() => {
    // Only navigate when the typed text differs from what the URL already has (also avoids a strict-mode double fire).
    if ((sp.get("q") ?? "") === q) return;
    const t = setTimeout(() => push({ q }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative min-w-[240px] flex-1 sm:max-w-sm">
        <span className="sr-only">Search members</span>
        <Search className="pointer-events-none absolute top-2 left-2.5 h-4 w-4 text-muted" />
        <input
          className="input pl-8"
          placeholder="Search name, number, organisation or member code"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      {showWhen && (
        <select
          className="input w-auto"
          aria-label="Date range"
          value={sp.get("when") ?? "all"}
          onChange={(e) => push({ when: e.target.value === "all" ? null : e.target.value })}
        >
          {WHEN.map((w) => (
            <option key={w.v} value={w.v}>
              {w.label}
            </option>
          ))}
        </select>
      )}
      {owners && (
        <select
          className="input w-auto"
          aria-label="Agent"
          value={sp.get("owner") ?? ""}
          onChange={(e) => push({ owner: e.target.value || null, unassigned: null })}
        >
          <option value="">All agents</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      )}
      {categories && (
        <select className="input w-auto" aria-label="Category" value={sp.get("cat") ?? ""} onChange={(e) => push({ cat: e.target.value || null })}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      )}
      {showUnassigned && (
        <label className="flex items-center gap-1.5 text-[13px]">
          <input
            type="checkbox"
            checked={sp.get("unassigned") === "1"}
            onChange={(e) => push({ unassigned: e.target.checked ? "1" : null, owner: null })}
          />
          Unassigned only
        </label>
      )}
    </div>
  );
}
