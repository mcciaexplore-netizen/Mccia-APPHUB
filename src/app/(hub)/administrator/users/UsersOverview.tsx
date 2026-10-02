"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ShieldCheck, Upload } from "lucide-react";
import type { Role } from "@/db/schema";
import { roleBadge, roleLabel } from "@/lib/format";
import { ImportUsers } from "./ImportUsers";

type U = {
  id: string; name: string; email: string; designation: string | null; role: Role; isActive: boolean;
  department: string | null; applications: { app: string; dept: string; active: boolean }[];
};

/** Read-only map of who can open which application. Users are added in bulk with the CSV import. */
export function UsersOverview({ users, departments }: { users: U[]; departments: string[] }) {
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [showImport, setShowImport] = useState(false);

  const shown = useMemo(() => users.filter((u) => {
    const t = q.trim().toLowerCase();
    const hay = `${u.name} ${u.email} ${u.designation ?? ""} ${u.applications.map((a) => a.app).join(" ")}`.toLowerCase();
    if (t && !hay.includes(t)) return false;
    return !dept || u.department === dept;
  }), [users, q, dept]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Every user and the applications they can open. This view is read-only.</p>
        <button className="btn btn-primary btn-sm" onClick={() => setShowImport((s) => !s)}><Upload size={14} /> Bulk import (CSV)</button>
      </div>

      {showImport && <ImportUsers />}

      <div className="flex flex-wrap items-center gap-3">
        <input className="input !w-full sm:!w-72" placeholder="Search name, email or application" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input !w-auto" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Filter by department">
          <option value="">All departments</option>
          {departments.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <span className="text-sm text-muted">{shown.length} of {users.length} users</span>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>User</th><th>Department</th><th>Role</th><th>Applications</th><th className="text-right">Access</th></tr></thead>
          <tbody>
            {shown.map((u) => (
              <tr key={u.id} className={u.isActive ? "" : "opacity-60"}>
                <td><b>{u.name}</b>{u.designation && <span className="text-xs text-muted"> · {u.designation}</span>}
                  <span className="block text-xs text-muted">{u.email}</span></td>
                <td>{u.department ?? <span className="text-subtle">—</span>}</td>
                <td><span className={roleBadge[u.role]}>{roleLabel[u.role]}</span></td>
                <td>
                  {u.role === "head_admin" ? <span className="text-xs text-muted">All applications</span>
                    : u.applications.length === 0 ? <span className="text-subtle">None</span>
                    : <span className="flex flex-wrap gap-1.5">{u.applications.map((a) => (
                        <span key={`${a.dept}/${a.app}`} className={`badge ${a.active ? "" : "badge-neutral line-through"}`} title={`${a.dept}${a.active ? "" : " (inactive)"}`}>{a.app}</span>
                      ))}</span>}
                </td>
                <td>
                  <div className="flex justify-end gap-1.5">
                    {u.role !== "head_admin" && (
                      <Link className="chip !p-1.5 text-muted" aria-label={`Manage access for ${u.name}`} title="Manage access" href={`/administrator/access/user/${u.id}`}><ShieldCheck size={14} /></Link>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={5} className="text-subtle">{users.length ? "No users match." : "No users yet. Use Bulk import (CSV) to add them."}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
