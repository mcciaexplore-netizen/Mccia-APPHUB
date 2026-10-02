"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronRight, Pencil, Plus } from "lucide-react";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { createDepartment, moveDepartment, setDepartmentActive, updateDepartment } from "@/actions/departments";
import { ActiveToggle, DepartmentForm, IconBtn, useRun } from "./forms";

type Row = { id: string; name: string; icon: string; sortOrder: number; isActive: boolean; apps: number; users: number };

export function DepartmentsList({ departments }: { departments: Row[] }) {
  const { run, pending } = useRun();
  const [showAdd, setShowAdd] = useState(false);
  const [edit, setEdit] = useState<Row | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Open a department to manage its applications and see its users.</p>
        <button className="btn btn-primary btn-sm" onClick={() => setShowAdd((s) => !s)}><Plus size={14} /> Add department</button>
      </div>

      {showAdd && (
        <div className="glass p-5 sm:p-6">
          <DepartmentForm submitLabel="Create department" pending={pending}
            onSubmit={(v) => run(() => createDepartment(v), "Department created", () => setShowAdd(false))} />
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead><tr><th>Department</th><th>Applications</th><th>Users</th><th>Status</th><th className="text-right">Actions</th></tr></thead>
          <tbody>
            {departments.map((d, i) => (
              <tr key={d.id} className={d.isActive ? "" : "opacity-60"}>
                <td>
                  <Link href={`/administrator/departments/${d.id}`} className="group flex items-center gap-3 hover:text-primary">
                    <span className="icon-tile !h-9 !w-9"><Icon name={d.icon} size={16} /></span>
                    <b>{d.name}</b>
                    <ChevronRight size={14} className="text-subtle transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </td>
                <td>{d.apps}</td>
                <td>{d.users}</td>
                <td><ActiveToggle active={d.isActive} disabled={pending} onToggle={() => run(() => setDepartmentActive(d.id, !d.isActive), d.isActive ? "Department deactivated" : "Department activated")} /></td>
                <td>
                  <div className="flex justify-end gap-1.5">
                    <IconBtn label="Move up" disabled={i === 0 || pending} onClick={() => run(() => moveDepartment(d.id, "up"), "Reordered")}><ArrowUp size={14} /></IconBtn>
                    <IconBtn label="Move down" disabled={i === departments.length - 1 || pending} onClick={() => run(() => moveDepartment(d.id, "down"), "Reordered")}><ArrowDown size={14} /></IconBtn>
                    <IconBtn label="Edit" onClick={() => setEdit(d)}><Pencil size={14} /></IconBtn>
                  </div>
                </td>
              </tr>
            ))}
            {departments.length === 0 && <tr><td colSpan={5} className="text-subtle">No departments yet. Add the first one above.</td></tr>}
          </tbody>
        </table>
      </div>

      {edit && (
        <Modal title="Edit department" onClose={() => setEdit(null)}>
          <DepartmentForm initial={{ name: edit.name, icon: edit.icon, sortOrder: edit.sortOrder }} submitLabel="Save" pending={pending}
            onSubmit={(v) => run(() => updateDepartment(edit.id, v), "Department saved", () => setEdit(null))} />
        </Modal>
      )}
    </div>
  );
}
