"use client";

import { useEffect, useRef } from "react";
import { Icon } from "@/components/Icon";
import type { CatalogApp, CatalogDept } from "@/lib/catalog";

function DeptCheckbox({ checked, indeterminate, onChange, disabled, label }: {
  checked: boolean; indeterminate: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate; }, [indeterminate]);
  return (
    <input ref={ref} type="checkbox" className="h-4 w-4 accent-[var(--c-primary)]" checked={checked} disabled={disabled}
      aria-label={label} onChange={(e) => onChange(e.target.checked)} />
  );
}

/**
 * Departments with their apps as a checklist. Ticking a department ticks all of its apps; individual apps
 * can then be unticked. `value` is the list of ticked app ids.
 */
export function AccessTree({ departments, apps, value, onChange, disabled }: {
  departments: CatalogDept[]; apps: CatalogApp[]; value: string[]; onChange: (ids: string[]) => void; disabled?: boolean;
}) {
  const on = new Set(value);
  const set = (ids: string[], tick: boolean) => {
    const next = new Set(on);
    for (const id of ids) tick ? next.add(id) : next.delete(id);
    onChange([...next]);
  };

  return (
    <div className="space-y-4">
      {departments.map((d) => {
        const list = apps.filter((a) => a.departmentId === d.id);
        const ticked = list.filter((a) => on.has(a.id)).length;
        return (
          <div key={d.id} className={`rounded-md border border-line bg-white ${d.isActive ? "" : "opacity-60"}`}>
            <label className="flex cursor-pointer items-center gap-3 border-b border-line bg-blue-tint/40 px-4 py-3">
              <DeptCheckbox label={`Select all in ${d.name}`} disabled={disabled || list.length === 0}
                checked={list.length > 0 && ticked === list.length} indeterminate={ticked > 0 && ticked < list.length}
                onChange={(v) => set(list.map((a) => a.id), v)} />
              <Icon name={d.icon} size={16} />
              <b className="flex-1 text-sm">{d.name}</b>
              {!d.isActive && <span className="badge badge-red">Inactive</span>}
              <span className="text-xs text-subtle">{ticked}/{list.length}</span>
            </label>
            <ul className="divide-y divide-line">
              {list.map((a) => (
                <li key={a.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 pl-10 text-sm hover:bg-blue-tint/30">
                    <input type="checkbox" className="h-4 w-4 accent-[var(--c-primary)]" checked={on.has(a.id)} disabled={disabled}
                      onChange={(e) => set([a.id], e.target.checked)} />
                    <span className="flex-1">{a.name}</span>
                    {!a.isActive && <span className="badge badge-red">Inactive</span>}
                  </label>
                </li>
              ))}
              {list.length === 0 && <li className="px-4 py-2.5 pl-10 text-xs text-subtle">No applications in this department.</li>}
            </ul>
          </div>
        );
      })}
      {departments.length === 0 && <p className="text-sm text-subtle">No departments yet.</p>}
    </div>
  );
}
