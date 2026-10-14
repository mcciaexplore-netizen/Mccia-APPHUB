"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Download, Search } from "lucide-react";
import { STATUS_FILTERS, toQueryString, type ListParams } from "@/lib/approvals/list-params";
import { STATUS_LABEL } from "@/lib/approvals/calc";

type Opt = { id: string; name: string };

/** Search, date range and filters above a list. The state lives in the address, so a filtered view can be shared and exported. */
export function ListFilters({
  params, categories, branches, showStatus, showBranch, exportHref,
}: { params: ListParams; categories: Opt[]; branches: Opt[]; showStatus: boolean; showBranch: boolean; exportHref: string }) {
  const router = useRouter();
  const path = usePathname();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(params.q);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const apply = (next: Partial<ListParams>) => start(() => router.replace(`${path}${toQueryString({ ...params, ...next, page: 1 })}`));
  const clear = () => { setQ(""); start(() => router.replace(path)); };
  useEffect(() => () => clearTimeout(timer.current), []);
  const typed = (v: string) => { setQ(v); clearTimeout(timer.current); timer.current = setTimeout(() => apply({ q: v }), 350); };
  const dirty = !!(params.q || params.from || params.to || params.status || params.categoryId || params.branchId);

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3" aria-busy={pending}>
      <label className="relative block">
        <span className="sr-only">Search</span>
        <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-[#999]" aria-hidden />
        <input className="input !pl-8 w-56" type="search" placeholder="Search" value={q} onChange={(e) => typed(e.target.value)} />
      </label>
      <label className="block"><span className="label-xs block">From</span><input className="input" type="date" value={params.from} onChange={(e) => apply({ from: e.target.value })} /></label>
      <label className="block"><span className="label-xs block">To</span><input className="input" type="date" value={params.to} onChange={(e) => apply({ to: e.target.value })} /></label>
      <label className="block">
        <span className="label-xs block">Category</span>
        <select className="input w-44" value={params.categoryId} onChange={(e) => apply({ categoryId: e.target.value })}>
          <option value="">All</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      {showBranch && (
        <label className="block">
          <span className="label-xs block">Branch</span>
          <select className="input w-40" value={params.branchId} onChange={(e) => apply({ branchId: e.target.value })}>
            <option value="">All</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      )}
      {showStatus && (
        <label className="block">
          <span className="label-xs block">Status</span>
          <select className="input w-36" value={params.status} onChange={(e) => apply({ status: e.target.value })}>
            <option value="">All</option>
            {STATUS_FILTERS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
      )}
      {dirty && <button type="button" className="btn btn-ghost btn-sm" onClick={clear}>Clear</button>}
      <a className="btn btn-ghost btn-sm ml-auto" href={exportHref} download><Download size={14} /> Export CSV</a>
    </div>
  );
}
