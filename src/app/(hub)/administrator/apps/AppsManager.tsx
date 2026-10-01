"use client";

import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus } from "lucide-react";
import type { App, Department } from "@/db/schema";
import { Icon } from "@/components/Icon";
import { IconPicker } from "@/components/IconPicker";
import { Modal } from "@/components/Modal";
import { AppCard } from "@/components/AppCard";
import { useToast } from "@/components/Toast";
import { createDepartment, moveDepartment, setDepartmentActive, updateDepartment } from "@/actions/departments";
import { createApp, moveApp, setAppActive, updateApp } from "@/actions/apps";
import { DEFAULT_ICON } from "@/lib/icons";

type Res = { ok: true } | { ok: false; error: string };

function useRun() {
  const toast = useToast();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Res>, okMsg: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) { toast.success(okMsg); after?.(); } else toast.error(r.error);
    });
  return { run, pending };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="label-xs mb-1.5 block">{label}</span>{children}</label>;
}

function DepartmentForm({ initial, submitLabel, onSubmit, pending }: {
  initial?: { name: string; icon: string; sortOrder?: number }; submitLabel: string; pending: boolean;
  onSubmit: (v: { name: string; icon: string; sortOrder: number }) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [icon, setIcon] = useState(initial?.icon ?? "Building2");
  const [sortOrder, setSortOrder] = useState(String(initial?.sortOrder ?? 0));
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onSubmit({ name, icon, sortOrder: Number(sortOrder) || 0 }); }}>
      <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} /></Field>
      {initial?.sortOrder === undefined && (
        <Field label="Sort order"><input className="input" type="number" min={0} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></Field>
      )}
      <Field label="Icon"><IconPicker value={icon} onChange={setIcon} /></Field>
      <button className="btn btn-primary btn-sm" disabled={pending}>{submitLabel}</button>
    </form>
  );
}

type AppVals = { departmentId: string; name: string; description: string; url: string; icon: string; appToken: string };
function AppForm({ departments, initial, submitLabel, onSubmit, pending }: {
  departments: Department[]; initial?: Partial<AppVals>; submitLabel: string; pending: boolean; onSubmit: (v: AppVals) => void;
}) {
  const [v, setV] = useState<AppVals>({
    departmentId: initial?.departmentId ?? departments[0]?.id ?? "", name: initial?.name ?? "",
    description: initial?.description ?? "", url: initial?.url ?? "https://", icon: initial?.icon ?? DEFAULT_ICON, appToken: initial?.appToken ?? "",
  });
  const set = <K extends keyof AppVals>(k: K, val: AppVals[K]) => setV((s) => ({ ...s, [k]: val }));
  const urlBad = v.url.length > 8 && !/^https:\/\/\S+$/.test(v.url);
  return (
    <div className="grid gap-6 md:grid-cols-[1fr_11rem]">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onSubmit(v); }}>
        <Field label="Name"><input className="input" value={v.name} onChange={(e) => set("name", e.target.value)} required maxLength={80} /></Field>
        <Field label="Description (one line)"><input className="input" value={v.description} onChange={(e) => set("description", e.target.value)} maxLength={140} /></Field>
        <Field label="URL (https)">
          <input className="input" type="url" value={v.url} onChange={(e) => set("url", e.target.value)} required />
          {urlBad && <span className="mt-1 block text-xs text-brand-red">Must start with https://</span>}
        </Field>
        <Field label="Department (an app belongs to exactly one)">
          <select className="input" value={v.departmentId} onChange={(e) => set("departmentId", e.target.value)} required>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Icon"><IconPicker value={v.icon} onChange={(i) => set("icon", i)} /></Field>
        <Field label="App token (optional, for future single sign-on)">
          <input className="input" value={v.appToken} onChange={(e) => set("appToken", e.target.value)} maxLength={500} autoComplete="off" />
        </Field>
        <button className="btn btn-primary btn-sm" disabled={pending || departments.length === 0}>{submitLabel}</button>
      </form>
      <div className="hidden md:block">
        <p className="label-xs mb-1.5">Preview</p>
        <div className="pointer-events-none"><AppCard app={{ id: "preview", name: v.name || "App name", description: v.description || null, icon: v.icon }} /></div>
      </div>
    </div>
  );
}

const IconBtn = ({ label, onClick, disabled, children, danger }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode; danger?: boolean }) => (
  <button title={label} aria-label={label} onClick={onClick} disabled={disabled}
    className={`chip !p-1.5 disabled:opacity-40 ${danger ? "text-brand-red" : "text-muted"}`}>{children}</button>
);

function ActiveToggle({ active, onToggle, disabled }: { active: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button onClick={onToggle} disabled={disabled} title={active ? "Click to deactivate" : "Click to activate"}
      className={`badge ${active ? "badge-green" : "badge-red"} cursor-pointer`}>{active ? "Active" : "Inactive"}</button>
  );
}

export function AppsManager({ departments, apps }: { departments: Department[]; apps: App[] }) {
  const { run, pending } = useRun();
  const [editDept, setEditDept] = useState<Department | null>(null);
  const [editApp, setEditApp] = useState<App | null>(null);
  const [showDept, setShowDept] = useState(false);
  const [showApp, setShowApp] = useState(false);

  return (
    <div className="space-y-12">
      <section>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-2xl">Departments</h2>
          <button className="btn btn-primary btn-sm" onClick={() => setShowDept((s) => !s)}><Plus size={14} /> Add department</button>
        </div>
        {showDept && (
          <div className="glass mb-5 p-5 sm:p-6">
            <DepartmentForm submitLabel="Create department" pending={pending}
              onSubmit={(v) => run(() => createDepartment(v), "Department created", () => setShowDept(false))} />
          </div>
        )}
        <div className="table-wrap">
          <table>
            <thead><tr><th>Department</th><th>Apps</th><th>Status</th><th className="text-right">Actions</th></tr></thead>
            <tbody>
              {departments.map((d, i) => (
                <tr key={d.id}>
                  <td><span className="flex items-center gap-3"><span className="icon-tile !h-9 !w-9"><Icon name={d.icon} size={16} /></span><b>{d.name}</b></span></td>
                  <td>{apps.filter((a) => a.departmentId === d.id).length}</td>
                  <td><ActiveToggle active={d.isActive} disabled={pending} onToggle={() => run(() => setDepartmentActive(d.id, !d.isActive), d.isActive ? "Department deactivated" : "Department activated")} /></td>
                  <td>
                    <div className="flex justify-end gap-1.5">
                      <IconBtn label="Move up" disabled={i === 0 || pending} onClick={() => run(() => moveDepartment(d.id, "up"), "Reordered")}><ArrowUp size={14} /></IconBtn>
                      <IconBtn label="Move down" disabled={i === departments.length - 1 || pending} onClick={() => run(() => moveDepartment(d.id, "down"), "Reordered")}><ArrowDown size={14} /></IconBtn>
                      <IconBtn label="Edit" onClick={() => setEditDept(d)}><Pencil size={14} /></IconBtn>
                    </div>
                  </td>
                </tr>
              ))}
              {departments.length === 0 && <tr><td colSpan={4} className="text-subtle">No departments yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-2xl">Applications</h2>
          <button className="btn btn-primary btn-sm" onClick={() => setShowApp((s) => !s)} disabled={departments.length === 0}><Plus size={14} /> Add application</button>
        </div>
        {showApp && (
          <div className="glass mb-5 p-5 sm:p-6">
            <AppForm departments={departments} submitLabel="Create application" pending={pending}
              onSubmit={(v) => run(() => createApp(v), "Application created", () => setShowApp(false))} />
          </div>
        )}
        <div className="space-y-6">
          {departments.map((d) => {
            const list = apps.filter((a) => a.departmentId === d.id);
            return (
              <div key={d.id}>
                <h3 className="label-xs mb-2 flex items-center gap-2"><Icon name={d.icon} size={14} /> {d.name}</h3>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Application</th><th>URL</th><th>Status</th><th className="text-right">Actions</th></tr></thead>
                    <tbody>
                      {list.map((a, i) => (
                        <tr key={a.id}>
                          <td><span className="flex items-center gap-3"><span className="icon-tile !h-9 !w-9"><Icon name={a.icon} size={16} /></span>
                            <span><b>{a.name}</b>{a.description && <span className="block text-xs text-muted">{a.description}</span>}</span></span></td>
                          <td className="max-w-[14rem] truncate text-xs text-muted" title={a.url}>{a.url}</td>
                          <td><ActiveToggle active={a.isActive} disabled={pending} onToggle={() => run(() => setAppActive(a.id, !a.isActive), a.isActive ? "Application deactivated" : "Application activated")} /></td>
                          <td>
                            <div className="flex justify-end gap-1.5">
                              <IconBtn label="Move up" disabled={i === 0 || pending} onClick={() => run(() => moveApp(a.id, "up"), "Reordered")}><ArrowUp size={14} /></IconBtn>
                              <IconBtn label="Move down" disabled={i === list.length - 1 || pending} onClick={() => run(() => moveApp(a.id, "down"), "Reordered")}><ArrowDown size={14} /></IconBtn>
                              <IconBtn label="Edit" onClick={() => setEditApp(a)}><Pencil size={14} /></IconBtn>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {list.length === 0 && <tr><td colSpan={4} className="text-subtle">No applications in this department.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {editDept && (
        <Modal title="Edit department" onClose={() => setEditDept(null)}>
          <DepartmentForm initial={{ name: editDept.name, icon: editDept.icon, sortOrder: editDept.sortOrder }} submitLabel="Save" pending={pending}
            onSubmit={(v) => run(() => updateDepartment(editDept.id, v), "Department saved", () => setEditDept(null))} />
        </Modal>
      )}
      {editApp && (
        <Modal title="Edit application" onClose={() => setEditApp(null)}>
          <AppForm departments={departments} submitLabel="Save" pending={pending}
            initial={{ departmentId: editApp.departmentId, name: editApp.name, description: editApp.description ?? "", url: editApp.url, icon: editApp.icon, appToken: editApp.appToken ?? "" }}
            onSubmit={(v) => run(() => updateApp(editApp.id, v), "Application saved", () => setEditApp(null))} />
        </Modal>
      )}
    </div>
  );
}
