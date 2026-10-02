"use client";

import { useState, useTransition } from "react";
import type { Department } from "@/db/schema";
import { IconPicker } from "@/components/IconPicker";
import { AppCard } from "@/components/AppCard";
import { useToast } from "@/components/Toast";
import { DEFAULT_ICON } from "@/lib/icons";

type Res = { ok: true } | { ok: false; error: string };

/** Runs a server action with a pending flag and a success/error toast. */
export function useRun() {
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

export function DepartmentForm({ initial, submitLabel, onSubmit, pending }: {
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

export type AppVals = { departmentId: string; name: string; description: string; url: string; icon: string; appToken: string };

/** An application always belongs to one department. With a single department given, it is fixed and shown as text. */
export function AppForm({ departments, initial, submitLabel, onSubmit, pending }: {
  departments: Pick<Department, "id" | "name">[]; initial?: Partial<AppVals>; submitLabel: string; pending: boolean; onSubmit: (v: AppVals) => void;
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
        {departments.length === 1 ? (
          <p className="text-sm text-muted">Department: <b>{departments[0].name}</b></p>
        ) : (
          <Field label="Department (an app belongs to exactly one)">
            <select className="input" value={v.departmentId} onChange={(e) => set("departmentId", e.target.value)} required>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
        )}
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

export const IconBtn = ({ label, onClick, disabled, children, danger }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode; danger?: boolean }) => (
  <button title={label} aria-label={label} onClick={onClick} disabled={disabled}
    className={`chip !p-1.5 disabled:opacity-40 ${danger ? "text-brand-red" : "text-muted"}`}>{children}</button>
);

export function ActiveToggle({ active, onToggle, disabled }: { active: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button onClick={onToggle} disabled={disabled} title={active ? "Click to deactivate" : "Click to activate"}
      className={`badge ${active ? "badge-green" : "badge-red"} cursor-pointer`}>{active ? "Active" : "Inactive"}</button>
  );
}
