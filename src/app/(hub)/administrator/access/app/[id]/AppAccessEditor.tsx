"use client";

import { useMemo, useState, useTransition } from "react";
import { useToast } from "@/components/Toast";
import { changeAppUsers } from "@/actions/access";

type P = { id: string; name: string; email: string; designation: string | null; isActive: boolean };

export function AppAccessEditor({ appId, people, initial }: { appId: string; people: P[]; initial: string[] }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(initial);
  const [value, setValue] = useState(new Set(initial));
  const [q, setQ] = useState("");
  const [onlyGranted, setOnlyGranted] = useState(false);

  const shown = useMemo(() => people.filter((p) => {
    const t = q.trim().toLowerCase();
    if (t && !`${p.name} ${p.email} ${p.designation ?? ""}`.toLowerCase().includes(t)) return false;
    return !onlyGranted || value.has(p.id);
  }), [people, q, onlyGranted, value]);

  const toAdd = [...value].filter((id) => !saved.includes(id));
  const toRemove = saved.filter((id) => !value.has(id));
  const dirty = toAdd.length + toRemove.length > 0;

  const tick = (ids: string[], on: boolean) => setValue((s) => { const n = new Set(s); ids.forEach((i) => (on ? n.add(i) : n.delete(i))); return n; });

  function save() {
    start(async () => {
      const r = await changeAppUsers(appId, { add: toAdd, remove: toRemove });
      if (r.ok) { setSaved([...value]); toast.success(`Access updated: ${toAdd.length} added, ${toRemove.length} removed`); } else toast.error(r.error);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input className="input !w-full sm:!w-64" placeholder="Search users" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" className="h-4 w-4 accent-[var(--c-primary)]" checked={onlyGranted} onChange={(e) => setOnlyGranted(e.target.checked)} /> Only users with access</label>
        <button className="btn btn-ghost btn-sm" disabled={pending || shown.length === 0} onClick={() => tick(shown.map((p) => p.id), true)}>Tick all shown</button>
        <button className="btn btn-ghost btn-sm" disabled={pending || shown.length === 0} onClick={() => tick(shown.map((p) => p.id), false)}>Untick all shown</button>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th className="w-12">Access</th><th>User</th><th>Status</th></tr></thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id} className={p.isActive ? "" : "opacity-60"}>
                <td><input type="checkbox" aria-label={`Access for ${p.name}`} className="h-4 w-4 accent-[var(--c-primary)]" checked={value.has(p.id)} disabled={pending} onChange={(e) => tick([p.id], e.target.checked)} /></td>
                <td><b>{p.name}</b>{p.designation && <span className="text-xs text-muted"> · {p.designation}</span>}<span className="block text-xs text-muted">{p.email}</span></td>
                <td>{p.isActive ? <span className="badge badge-green">Active</span> : <span className="badge badge-red">Inactive</span>}</td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={3} className="text-subtle">No users match.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-md border border-line bg-white p-3 shadow-card">
        <button className="btn btn-primary btn-sm" disabled={pending || !dirty} onClick={save}>Save access</button>
        <button className="btn btn-ghost btn-sm" disabled={pending || !dirty} onClick={() => setValue(new Set(saved))}>Discard changes</button>
        <span className="ml-auto text-sm text-muted">{value.size} user{value.size === 1 ? "" : "s"} have access{dirty ? ` · +${toAdd.length} / −${toRemove.length} unsaved` : ""}</span>
      </div>
    </div>
  );
}
