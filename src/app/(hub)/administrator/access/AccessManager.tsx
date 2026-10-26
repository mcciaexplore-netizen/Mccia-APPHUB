"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { AccessTree } from "@/components/AccessTree";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { createTemplate, deleteTemplate, updateTemplate } from "@/actions/access";
import type { CatalogApp, CatalogDept } from "@/lib/catalog";

type Template = { id: string; name: string; appIds: string[] };
type Tab = "apps" | "templates";
type Res<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const TABS: { id: Tab; label: string }[] = [
  { id: "apps", label: "By application" },
  { id: "templates", label: "Templates" },
];

export function AccessManager({ initialTab, catalog, appCounts, templates }: {
  initialTab: Tab; catalog: { departments: CatalogDept[]; apps: CatalogApp[] };
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
      <p className="text-sm text-muted">
        To give or take away someone&apos;s applications, open <Link className="text-primary underline" href="/administrator/users">Users</Link>. This page shows access from the application&apos;s side, and holds reusable templates.
      </p>
      <nav className="flex gap-2 overflow-x-auto" aria-label="Access sections">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} aria-current={tab === t.id ? "page" : undefined}
            className={`whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-all duration-200 ${tab === t.id ? "bg-blue-tint text-primary" : "text-muted hover:bg-blue-tint hover:text-primary"}`}>
            {t.label}
          </button>
        ))}
      </nav>

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
