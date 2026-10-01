"use client";

import { useState, useTransition } from "react";
import { AccessTree } from "@/components/AccessTree";
import { useToast } from "@/components/Toast";
import { setUserAccess } from "@/actions/access";
import type { CatalogApp, CatalogDept } from "@/lib/catalog";

type Template = { id: string; name: string; appIds: string[] };

export function UserAccessEditor({ userId, catalog, initial, templates }: {
  userId: string; catalog: { departments: CatalogDept[]; apps: CatalogApp[] }; initial: string[]; templates: Template[];
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(initial);
  const [value, setValue] = useState(initial);
  const [tpl, setTpl] = useState("");

  const dirty = value.length !== saved.length || value.some((id) => !saved.includes(id));
  const template = templates.find((t) => t.id === tpl);

  function save() {
    start(async () => {
      const r = await setUserAccess(userId, value);
      if (r.ok) { setSaved(value); toast.success("Access saved"); } else toast.error(r.error);
    });
  }

  return (
    <div className="space-y-5">
      {templates.length > 0 && (
        <div className="glass !rounded-md flex flex-wrap items-end gap-3 p-4">
          <label className="block">
            <span className="label-xs mb-1.5 block">Start from a template</span>
            <select className="input !w-auto min-w-52" value={tpl} onChange={(e) => setTpl(e.target.value)}>
              <option value="">Choose a template…</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.appIds.length} apps)</option>)}
            </select>
          </label>
          <button className="btn btn-ghost btn-sm" disabled={!template} onClick={() => template && setValue([...new Set([...value, ...template.appIds])])}>Add its apps</button>
          <button className="btn btn-ghost btn-sm" disabled={!template} onClick={() => template && setValue([...template.appIds])}>Replace with its apps</button>
          <span className="text-xs text-subtle">Changes are only applied when you press Save, so you can customise first.</span>
        </div>
      )}

      <AccessTree departments={catalog.departments} apps={catalog.apps} value={value} onChange={setValue} disabled={pending} />

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-md border border-line bg-white p-3 shadow-card">
        <button className="btn btn-primary btn-sm" disabled={pending || !dirty} onClick={save}>Save access</button>
        <button className="btn btn-ghost btn-sm" disabled={pending || value.length === 0} onClick={() => setValue([])}>Untick all</button>
        <button className="btn btn-ghost btn-sm" disabled={pending || !dirty} onClick={() => setValue(saved)}>Discard changes</button>
        <span className="ml-auto text-sm text-muted">{value.length} application{value.length === 1 ? "" : "s"} ticked{dirty ? " · unsaved changes" : ""}</span>
      </div>
    </div>
  );
}
