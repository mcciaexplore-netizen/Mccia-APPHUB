"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus } from "lucide-react";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { createApp, moveApp, setAppActive, updateApp } from "@/actions/apps";
import { ActiveToggle, AppForm, IconBtn, useRun } from "../forms";

type AppRow = { id: string; name: string; description: string | null; url: string; icon: string; appToken: string | null; isActive: boolean };

/** Applications of one department. Everything added here belongs to this department only. */
export function DepartmentApps({ department, apps }: { department: { id: string; name: string }; apps: AppRow[] }) {
  const { run, pending } = useRun();
  const [showAdd, setShowAdd] = useState(false);
  const [edit, setEdit] = useState<AppRow | null>(null);
  const dept = [department];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Applications listed here appear only under {department.name}.</p>
        <button className="btn btn-primary btn-sm" onClick={() => setShowAdd((s) => !s)}><Plus size={14} /> Add application</button>
      </div>

      {showAdd && (
        <div className="glass p-5 sm:p-6">
          <AppForm departments={dept} initial={{ departmentId: department.id }} submitLabel="Add application" pending={pending}
            onSubmit={(v) => run(() => createApp({ ...v, departmentId: department.id }), "Application added", () => setShowAdd(false))} />
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead><tr><th>Application</th><th>URL</th><th>Status</th><th className="text-right">Actions</th></tr></thead>
          <tbody>
            {apps.map((a, i) => (
              <tr key={a.id} className={a.isActive ? "" : "opacity-60"}>
                <td><span className="flex items-center gap-3"><span className="icon-tile !h-9 !w-9"><Icon name={a.icon} size={16} /></span>
                  <span><b>{a.name}</b>{a.description && <span className="block text-xs text-muted">{a.description}</span>}</span></span></td>
                <td className="max-w-[14rem] truncate text-xs text-muted" title={a.url}>{a.url}</td>
                <td><ActiveToggle active={a.isActive} disabled={pending} onToggle={() => run(() => setAppActive(a.id, !a.isActive), a.isActive ? "Application deactivated" : "Application activated")} /></td>
                <td>
                  <div className="flex justify-end gap-1.5">
                    <IconBtn label="Move up" disabled={i === 0 || pending} onClick={() => run(() => moveApp(a.id, "up"), "Reordered")}><ArrowUp size={14} /></IconBtn>
                    <IconBtn label="Move down" disabled={i === apps.length - 1 || pending} onClick={() => run(() => moveApp(a.id, "down"), "Reordered")}><ArrowDown size={14} /></IconBtn>
                    <IconBtn label="Edit" onClick={() => setEdit(a)}><Pencil size={14} /></IconBtn>
                  </div>
                </td>
              </tr>
            ))}
            {apps.length === 0 && <tr><td colSpan={4} className="text-subtle">No applications in {department.name} yet. Use “Add application”.</td></tr>}
          </tbody>
        </table>
      </div>

      {edit && (
        <Modal title="Edit application" onClose={() => setEdit(null)}>
          <AppForm departments={dept} submitLabel="Save" pending={pending}
            initial={{ departmentId: department.id, name: edit.name, description: edit.description ?? "", url: edit.url, icon: edit.icon, appToken: edit.appToken ?? "", isActive: edit.isActive }}
            onSubmit={(v) => run(() => updateApp(edit.id, { ...v, departmentId: department.id }), "Application saved", () => setEdit(null))} />
        </Modal>
      )}
    </div>
  );
}
