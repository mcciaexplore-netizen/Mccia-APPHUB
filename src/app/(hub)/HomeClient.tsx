"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Inbox, Search } from "lucide-react";
import { AppCard, type CardApp } from "@/components/AppCard";

type Dept = { id: string; name: string };
type Row = CardApp & { departmentId: string };
const KEY = "hub:lastDepartment";

export function HomeClient({ departments, apps, isAdmin }: { departments: Dept[]; apps: Row[]; isAdmin: boolean }) {
  const router = useRouter();
  const param = useSearchParams().get("d");
  const [q, setQ] = useState("");
  const valid = (id: string | null) => !!id && departments.some((d) => d.id === id);
  const selected = valid(param) ? param! : departments[0]?.id;

  // Restore the last-selected department when arriving without one in the URL.
  useEffect(() => {
    if (param) return;
    try {
      const saved = localStorage.getItem(KEY);
      if (saved && valid(saved) && saved !== departments[0]?.id) router.replace(`/?d=${saved}`);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try { if (valid(param)) localStorage.setItem(KEY, param!); } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [param]);

  const deptName = useMemo(() => new Map(departments.map((d) => [d.id, d.name])), [departments]);
  const searching = q.trim().length > 0;
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t) return apps.filter((a) => `${a.name} ${a.description ?? ""}`.toLowerCase().includes(t));
    return apps.filter((a) => a.departmentId === selected);
  }, [apps, q, selected]);

  if (departments.length === 0) {
    return (
      <div className="alert mx-auto mt-10 max-w-lg"><Inbox size={18} className="mt-0.5 shrink-0" />
        <span>{isAdmin ? "No departments have been set up yet. Add some in the Administrator area." : "No applications have been assigned to you yet. Please ask the administrator for access."}</span></div>
    );
  }

  const title = searching ? "Search results" : deptName.get(selected!) ?? "";
  return (
    <div>
      <header className="mb-6 flex flex-col gap-4 border-b border-line pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl text-primary sm:text-2xl">{title}</h1>
          <p className="mt-1 text-sm text-subtle">{shown.length} {shown.length === 1 ? "application" : "applications"} {searching ? "found" : "available"}</p>
        </div>
        <label className="relative block w-full sm:w-72">
          <span className="sr-only">Search applications</span>
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-subtle" />
          <input className="input !pl-10" placeholder="Search applications" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </header>

      {shown.length === 0 ? (
        <div className="alert"><Inbox size={18} className="mt-0.5 shrink-0" />
          <span>{searching ? "No applications match your search." : "No applications here yet."}</span></div>
      ) : (
        <div key={searching ? `s-${q}` : selected} className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-4">
          {shown.map((a, i) => (
            <AppCard key={a.id} app={a} index={i} deptName={searching ? deptName.get(a.departmentId) : undefined} />
          ))}
        </div>
      )}
    </div>
  );
}
