"use client";

import { useState } from "react";
import { ChevronDown, Search, ShieldCheck } from "lucide-react";
import { Icon } from "@/components/Icon";
import type { CatalogApp, CatalogDept } from "@/lib/catalog";

/**
 * A person's application access, grouped by department: search, a department filter, a summary, Assign all / Remove all, and one row per
 * application with its icon, description, status and an on/off switch. `mode`: "edit" changes `value` (saved by the page), "view" only shows
 * it, "inherited" is the Support Admin, who can open everything by their role (nothing to switch). The server decides what may be saved.
 */
export function ApplicationAccess({ departments, apps, value, onChange, mode, disabled }: {
  departments: CatalogDept[]; apps: CatalogApp[]; value: string[]; onChange?: (ids: string[]) => void; mode: "edit" | "view" | "inherited"; disabled?: boolean;
}) {
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const on = new Set(mode === "inherited" ? apps.map((a) => a.id) : value);
  const editable = mode === "edit" && !disabled;
  const t = q.trim().toLowerCase();
  const matches = (a: CatalogApp) => (!dept || a.departmentId === dept) && (!t || `${a.name} ${a.description ?? ""}`.toLowerCase().includes(t));
  const shown = apps.filter(matches);
  const set = (ids: string[], give: boolean) => {
    if (!onChange) return;
    const next = new Set(value);
    for (const id of ids) { if (give) next.add(id); else next.delete(id); }
    onChange([...next]);
  };
  const toggleOpen = (id: string) => setClosed((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="space-y-4">
      {mode === "inherited" && (
        <p className="flex items-center gap-2 rounded-md border border-[#b9dbe3] bg-[#f0f7f9] px-4 py-3 text-sm text-primary">
          <ShieldCheck size={16} aria-hidden /> <b>Full access — inherited from Support Admin role.</b> <span className="text-muted">Nothing to switch on or off.</span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative block w-full sm:w-64">
          <span className="sr-only">Search applications</span>
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
          <input className="input !py-2 !pl-9" placeholder="Search applications" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <select className="input !w-auto !py-2" aria-label="Filter by department" value={dept} onChange={(e) => setDept(e.target.value)}>
          <option value="">All departments</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <span className="text-sm text-muted">{mode === "inherited" ? `All ${apps.length} applications` : `${apps.filter((a) => on.has(a.id)).length} of ${apps.length} applications enabled`}</span>
        {editable && (
          <span className="ml-auto flex gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => set(shown.map((a) => a.id), true)}>Assign all{t || dept ? " shown" : ""}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => set(shown.map((a) => a.id), false)}>Remove all{t || dept ? " shown" : ""}</button>
          </span>
        )}
      </div>

      {departments.map((d) => {
        const list = shown.filter((a) => a.departmentId === d.id);
        if (list.length === 0) return null;
        const enabled = list.filter((a) => on.has(a.id)).length;
        const open = !closed.has(d.id);
        return (
          <div key={d.id} className={`overflow-hidden rounded-[12px] border border-gray-200 bg-white ${d.isActive ? "" : "opacity-70"}`}>
            <button type="button" onClick={() => toggleOpen(d.id)} aria-expanded={open}
              className="flex w-full items-center gap-3 bg-alt px-4 py-3 text-left">
              <span className="grid h-8 w-8 place-items-center rounded-[8px] bg-white text-primary shadow-[0_1px_2px_rgba(15,23,42,0.08)]"><Icon name={d.icon} size={16} /></span>
              <span className="flex-1"><b className="text-sm text-ink">{d.name}</b>{!d.isActive && <span className="badge badge-red ml-2">Inactive</span>}
                <span className="block text-xs text-muted">{list.length} {list.length === 1 ? "application" : "applications"} · {enabled} enabled</span></span>
              {editable && (
                <span className="hidden gap-1.5 sm:flex" onClick={(e) => e.stopPropagation()}>
                  <span role="button" tabIndex={0} className="chip cursor-pointer" onClick={() => set(list.map((a) => a.id), true)} onKeyDown={(e) => e.key === "Enter" && set(list.map((a) => a.id), true)}>All on</span>
                  <span role="button" tabIndex={0} className="chip cursor-pointer" onClick={() => set(list.map((a) => a.id), false)} onKeyDown={(e) => e.key === "Enter" && set(list.map((a) => a.id), false)}>All off</span>
                </span>
              )}
              <ChevronDown size={16} aria-hidden className={`text-muted transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
            {open && (
              <ul className="divide-y divide-line">
                {list.map((a) => {
                  const has = on.has(a.id);
                  return (
                    <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] bg-blue-tint text-primary"><Icon name={a.icon ?? "AppWindow"} size={17} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-ink">{a.name}{!a.isActive && <span className="badge badge-neutral ml-2">Inactive</span>}</span>
                        {a.description && <span className="block truncate text-xs text-muted">{a.description}</span>}
                      </span>
                      <span className={`hidden rounded-pill px-2.5 py-0.5 text-xs font-semibold sm:inline ${has ? "bg-green-tint text-brand-green-text" : "bg-alt text-subtle"}`}>{has ? "Access" : "No access"}</span>
                      <button type="button" role="switch" aria-checked={has} aria-label={`${has ? "Remove" : "Give"} access to ${a.name}`} disabled={!editable}
                        onClick={() => set([a.id], !has)}
                        className={`relative h-6 w-11 shrink-0 rounded-pill transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${has ? "bg-primary" : "bg-gray-300"}`}>
                        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${has ? "left-[22px]" : "left-0.5"}`} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
      {shown.length === 0 && <p className="rounded-md border border-dashed border-line bg-alt px-4 py-6 text-center text-sm text-subtle">{apps.length === 0 ? "No applications are registered yet." : "No applications match your search."}</p>}
    </div>
  );
}
