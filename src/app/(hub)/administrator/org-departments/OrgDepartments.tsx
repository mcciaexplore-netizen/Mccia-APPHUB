"use client";

import Link from "next/link";
import { useState } from "react";
import { Pencil, Plus, Users } from "lucide-react";
import { createOrgDepartment, renameOrgDepartment, setOrgDepartmentActive } from "@/actions/org-departments";
import { Modal } from "@/components/Modal";
import { ActiveToggle, IconBtn, useRun } from "../departments/forms";

type Row = { id: string; name: string; isActive: boolean; users: number };

export function OrgDepartments({ departments }: { departments: Row[] }) {
  const { run, pending } = useRun();
  const [name, setName] = useState("");
  const [edit, setEdit] = useState<Row | null>(null);
  const [newName, setNewName] = useState("");

  return (
    <div className="space-y-6">
      <p className="max-w-2xl text-sm text-muted">
        The departments of the organisation: where people sit. A person is placed in a department on their own profile, and you can filter the
        people by department. These are separate from <Link href="/administrator/departments" className="text-primary hover:underline">Application categories</Link>, which only arrange the applications in the hub.
      </p>

      <form className="glass flex flex-wrap items-end gap-3 !rounded-md p-4 sm:p-5" onSubmit={(e) => { e.preventDefault(); run(() => createOrgDepartment({ name }), "Department added", () => setName("")); }}>
        <label className="block min-w-56 flex-1">
          <span className="label-xs mb-1.5 block">New department</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="For example Finance" maxLength={60} required aria-label="New department name" />
        </label>
        <button className="btn btn-primary btn-sm" disabled={pending || !name.trim()}><Plus size={14} /> Add department</button>
      </form>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Department</th><th>People</th><th>Status</th><th className="text-right">Actions</th></tr></thead>
          <tbody>
            {departments.map((d) => (
              <tr key={d.id} className={d.isActive ? "" : "opacity-60"}>
                <td><b>{d.name}</b></td>
                <td>
                  <Link href={`/administrator/users?dept=${d.id}`} className="inline-flex items-center gap-1.5 text-primary hover:underline" title={`See the people in ${d.name}`}>
                    <Users size={14} /> {d.users}
                  </Link>
                </td>
                <td><ActiveToggle active={d.isActive} disabled={pending} onToggle={() => run(() => setOrgDepartmentActive(d.id, !d.isActive), d.isActive ? "Department deactivated" : "Department activated")} /></td>
                <td><div className="flex justify-end gap-1.5"><IconBtn label={`Rename ${d.name}`} onClick={() => { setEdit(d); setNewName(d.name); }}><Pencil size={14} /></IconBtn></div></td>
              </tr>
            ))}
            {departments.length === 0 && <tr><td colSpan={4} className="text-subtle">No departments yet. Add the first one above.</td></tr>}
          </tbody>
        </table>
      </div>

      {edit && (
        <Modal title={`Rename ${edit.name}`} onClose={() => setEdit(null)}>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => renameOrgDepartment(edit.id, { name: newName }), "Department renamed", () => setEdit(null)); }}>
            <label className="block"><span className="label-xs mb-1.5 block">Name</span><input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={60} required autoFocus aria-label={`Name of ${edit.name}`} /></label>
            <button className="btn btn-primary btn-sm" disabled={pending || !newName.trim()}>Save name</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
