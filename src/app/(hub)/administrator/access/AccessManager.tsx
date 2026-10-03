"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { AccessTree } from "@/components/AccessTree";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { applyTemplate, bulkAssign, createTemplate, deleteTemplate, updateTemplate } from "@/actions/access";
import type { CatalogApp, CatalogDept } from "@/lib/catalog";

type Person = { id: string; name: string; email: string; designation: string | null; isActive: boolean; homeDepartmentId: string | null; appCount: number };
type Template = { id: string; name: string; appIds: string[] };
type Tab = "users" | "apps" | "templates";
type Res<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const TABS: { id: Tab; label: string }[] = [
  { id: "users", label: "By user & bulk assign" },
  { id: "apps", label: "By application" },
  { id: "templates", label: "Templates" },
];

export function AccessManager({ initialTab, catalog, people, appCounts, templates }: {
  initialTab: Tab; catalog: { departments: CatalogDept[]; apps: CatalogApp[] }; people: Person[];
  appCounts: Record<string, number>; templates: Template[];
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [tab, setTab] = useState<Tab>(initialTab);

  function run<T>(fn: () => Promise<Res<T>>, okMsg: string | ((d: T) => string), after?: (d: T) => void) {
    start(async () => {
      const r = await fn();
      if (r.ok) { toast.success(typeof okMsg === "function" ? okMsg(r.data) : okMsg); after?.(r.data); } else toast.error(r.error);
    });
  }

  // ---- bulk assign state ----
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [bulkApps, setBulkApps] = useState<string[]>([]);
  const [mode, setMode] = useState<"add" | "remove" | "replace">("add");
  const [tpl, setTpl] = useState("");
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return people.filter((p) => !t || `${p.name} ${p.email} ${p.designation ?? ""}`.toLowerCase().includes(t));
  }, [people, q]);
  const allShownPicked = shown.length > 0 && shown.every((p) => picked.includes(p.id));

  // ---- template editor state ----
  const [editing, setEditing] = useState<Template | "new" | null>(null);
  const [tName, setTName] = useState("");
  const [tApps, setTApps] = useState<string[]>([]);
  const openEditor = (t: Template | "new") => {
    setEditing(t);
    setTName(t === "new" ? "" : t.name);
    setTApps(t === "new" ? [] : t.appIds);
  };
  const deptName = new Map(catalog.departments.map((d) => [d.id, d.name]));

  return (
    <div className="space-y-6">
      <nav className="flex gap-2 overflow-x-auto" aria-label="Access sections">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} aria-current={tab === t.id ? "page" : undefined}
            className={`whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-all duration-200 ${tab === t.id ? "bg-blue-tint text-primary" : "text-muted hover:bg-blue-tint hover:text-primary"}`}>
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "users" && (
        <div className="space-y-8">
          <p className="text-sm text-muted">Open a user to tick exactly which applications they can see. To change several people at once, tick them here and use the panel below.</p>
          <div className="flex flex-wrap items-center gap-3">
            <input className="input !w-full sm:!w-64" placeholder="Search users" value={q} onChange={(e) => setQ(e.target.value)} />
            <span className="text-sm text-muted">{picked.length} selected</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th className="w-12"><input type="checkbox" aria-label="Select all shown" className="h-4 w-4 accent-[var(--c-primary)]" checked={allShownPicked}
                  onChange={(e) => setPicked((s) => e.target.checked ? [...new Set([...s, ...shown.map((p) => p.id)])] : s.filter((id) => !shown.some((p) => p.id === id)))} /></th>
                <th>User</th><th>Home department</th><th>Applications</th><th className="text-right">Access</th>
              </tr></thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id} className={p.isActive ? "" : "opacity-60"}>
                    <td><input type="checkbox" aria-label={`Select ${p.name}`} className="h-4 w-4 accent-[var(--c-primary)]" checked={picked.includes(p.id)}
                      onChange={(e) => setPicked((s) => e.target.checked ? [...s, p.id] : s.filter((id) => id !== p.id))} /></td>
                    <td><b>{p.name}</b>{!p.isActive && <span className="badge badge-red ml-2">Inactive</span>}
                      <span className="block text-xs text-muted">{p.email}{p.designation ? ` · ${p.designation}` : ""}</span></td>
                    <td>{p.homeDepartmentId ? deptName.get(p.homeDepartmentId) : <span className="text-subtle">—</span>}</td>
                    <td>{p.appCount === 0 ? <span className="text-subtle">None</span> : p.appCount}</td>
                    <td className="text-right"><Link className="btn btn-ghost btn-sm" href={`/administrator/access/user/${p.id}`}>Manage</Link></td>
                  </tr>
                ))}
                {shown.length === 0 && <tr><td colSpan={5} className="text-subtle">{people.length === 0 ? "No users yet. Use Bulk import under Users." : "No users match."}</td></tr>}
              </tbody>
            </table>
          </div>

          <section className="glass !rounded-md space-y-5 p-5 sm:p-6">
            <h3 className="text-xl">Bulk assign to {picked.length} selected user{picked.length === 1 ? "" : "s"}</h3>
            {templates.length > 0 && (
              <div className="flex flex-wrap items-end gap-3">
                <label className="block"><span className="label-xs mb-1.5 block">Use a template</span>
                  <select className="input !w-auto min-w-52" value={tpl} onChange={(e) => setTpl(e.target.value)}>
                    <option value="">Choose a template…</option>
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.appIds.length} apps)</option>)}
                  </select></label>
                <button className="btn btn-ghost btn-sm" disabled={pending || !tpl || picked.length === 0}
                  onClick={() => run(() => applyTemplate({ templateId: tpl, userIds: picked, mode: "add" }), (d) => `Template added for ${d.users} user(s)`)}>Add template to selected</button>
                <button className="btn btn-ghost btn-sm" disabled={pending || !tpl || picked.length === 0}
                  onClick={async () => { if (await confirm({ title: "Replace access?", message: "Each selected user's current access will be replaced by this template.", confirmLabel: "Replace" }))
                    run(() => applyTemplate({ templateId: tpl, userIds: picked, mode: "replace" }), (d) => `Template applied to ${d.users} user(s)`); }}>Replace with template</button>
              </div>
            )}
            <p className="text-sm text-muted">Or pick applications by hand:</p>
            <AccessTree departments={catalog.departments} apps={catalog.apps} value={bulkApps} onChange={setBulkApps} disabled={pending} />
            <div className="flex flex-wrap items-center gap-3">
              <select className="input !w-auto" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} aria-label="How to apply">
                <option value="add">Add these apps to what they have</option>
                <option value="remove">Remove these apps from what they have</option>
                <option value="replace">Replace their access with exactly these apps</option>
              </select>
              <button className="btn btn-primary btn-sm" disabled={pending || picked.length === 0 || (mode !== "replace" && bulkApps.length === 0)}
                onClick={async () => {
                  if (mode === "replace" && !(await confirm({ title: "Replace access?", message: `${picked.length} user(s) will have only the ${bulkApps.length} ticked application(s).`, confirmLabel: "Replace", danger: true }))) return;
                  run(() => bulkAssign({ userIds: picked, appIds: bulkApps, mode }), (d) => `Access updated for ${d.users} user(s)`);
                }}>Apply to selected</button>
            </div>
          </section>
        </div>
      )}

      {tab === "apps" && (
        <div className="space-y-4">
          <p className="text-sm text-muted">Open an application to see who can use it and add or remove people in bulk.</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Application</th><th>Department</th><th>Users with access</th><th className="text-right">Access</th></tr></thead>
              <tbody>
                {catalog.apps.map((a) => (
                  <tr key={a.id} className={a.isActive ? "" : "opacity-60"}>
                    <td><b>{a.name}</b>{!a.isActive && <span className="badge badge-red ml-2">Inactive</span>}</td>
                    <td>{deptName.get(a.departmentId)}</td>
                    <td>{appCounts[a.id] ?? 0}</td>
                    <td className="text-right"><Link className="btn btn-ghost btn-sm" href={`/administrator/access/app/${a.id}`}>Manage</Link></td>
                  </tr>
                ))}
                {catalog.apps.length === 0 && <tr><td colSpan={4} className="text-subtle">No applications yet. Add some under Departments.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "templates" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted">A template is a reusable set of applications (for example “Finance Staff”). Apply it to users, then customise each person if needed.</p>
            <button className="btn btn-primary btn-sm shrink-0" onClick={() => openEditor("new")}><Plus size={14} /> New template</button>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Template</th><th>Applications</th><th className="text-right">Actions</th></tr></thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id}>
                    <td><b>{t.name}</b></td>
                    <td>{t.appIds.length}</td>
                    <td><div className="flex justify-end gap-1.5">
                      <button className="chip !p-1.5 text-muted" aria-label="Edit" title="Edit" onClick={() => openEditor(t)}><Pencil size={14} /></button>
                      <button className="chip !p-1.5 text-brand-red" aria-label="Delete" title="Delete" onClick={async () => {
                        if (await confirm({ title: "Delete template?", message: `“${t.name}” will be removed. Users who already received it keep their access.`, confirmLabel: "Delete", danger: true }))
                          run(() => deleteTemplate(t.id), "Template deleted");
                      }}><Trash2 size={14} /></button>
                    </div></td>
                  </tr>
                ))}
                {templates.length === 0 && <tr><td colSpan={3} className="text-subtle">No templates yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing && (
        <Modal title={editing === "new" ? "New template" : "Edit template"} onClose={() => setEditing(null)}>
          <form className="space-y-4" onSubmit={(e) => {
            e.preventDefault();
            const payload = { name: tName, appIds: tApps };
            run(() => (editing === "new" ? createTemplate(payload) : updateTemplate(editing.id, payload)), "Template saved", () => setEditing(null));
          }}>
            <label className="block"><span className="label-xs mb-1.5 block">Name</span>
              <input className="input" value={tName} onChange={(e) => setTName(e.target.value)} required maxLength={80} placeholder="e.g. Finance Staff" /></label>
            <AccessTree departments={catalog.departments} apps={catalog.apps} value={tApps} onChange={setTApps} disabled={pending} />
            <button className="btn btn-primary btn-sm" disabled={pending}>Save template</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
