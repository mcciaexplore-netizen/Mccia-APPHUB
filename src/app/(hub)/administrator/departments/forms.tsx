"use client";

import { useState, useTransition } from "react";
import type { Department } from "@/db/schema";
import { IconPicker } from "@/components/IconPicker";
import { AppCard } from "@/components/AppCard";
import { useToast } from "@/components/Toast";
import { DEFAULT_ICON } from "@/lib/icons";
import { callbackProblem, slugProblem } from "@/lib/sso-rules";

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
        <Field label="Sort order (0 or empty adds it at the end)"><input className="input" type="number" min={0} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></Field>
      )}
      <Field label="Icon"><IconPicker value={icon} onChange={setIcon} /></Field>
      <button className="btn btn-primary btn-sm" disabled={pending}>{submitLabel}</button>
    </form>
  );
}

export type AppVals = {
  departmentId: string; name: string; description: string; url: string; icon: string; appToken: string; isActive: boolean; status: "active" | "testing" | "unavailable";
  ssoEnabled: boolean; ssoSlug: string; ssoCallbackUrl: string;
};

/** An application always belongs to one department. With a single department given, it is fixed and shown as text. */
export function AppForm({ departments, initial, submitLabel, onSubmit, pending }: {
  departments: Pick<Department, "id" | "name">[]; initial?: Partial<AppVals>; submitLabel: string; pending: boolean; onSubmit: (v: AppVals) => void;
}) {
  const [v, setV] = useState<AppVals>({
    departmentId: initial?.departmentId ?? departments[0]?.id ?? "", name: initial?.name ?? "",
    description: initial?.description ?? "", url: initial?.url ?? "https://", icon: initial?.icon ?? DEFAULT_ICON, appToken: initial?.appToken ?? "", isActive: initial?.isActive ?? true, status: initial?.status ?? "active",
    ssoEnabled: initial?.ssoEnabled ?? false, ssoSlug: initial?.ssoSlug ?? "", ssoCallbackUrl: initial?.ssoCallbackUrl ?? "",
  });
  const set = <K extends keyof AppVals>(k: K, val: AppVals[K]) => setV((s) => ({ ...s, [k]: val }));
  const urlBad = v.url.length > 8 && !/^(https:\/\/\S+|\/(?!\/)\S*)$/.test(v.url);
  // The same rules the server applies (src/lib/sso-rules.ts), shown while typing. Only once something has been typed.
  const slugBad = v.ssoEnabled && v.ssoSlug.trim() ? slugProblem(v.ssoSlug.trim().toLowerCase()) : null;
  const callbackBad = v.ssoEnabled && v.ssoCallbackUrl.trim() ? callbackProblem(v.ssoCallbackUrl.trim(), v.url.trim()) : null;
  return (
    <div className="grid gap-6 md:grid-cols-[1fr_11rem]">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onSubmit(v); }}>
        <Field label="Name"><input className="input" value={v.name} onChange={(e) => set("name", e.target.value)} required maxLength={80} /></Field>
        <Field label="Description (one line)"><input className="input" value={v.description} onChange={(e) => set("description", e.target.value)} maxLength={140} /></Field>
        <Field label="URL (https, or a path on this site such as /approvals)">
          <input className="input" type="text" inputMode="url" value={v.url} onChange={(e) => set("url", e.target.value)} required />
          {urlBad && <span className="mt-1 block text-xs text-brand-red">Must start with https:// (or be a path like /approvals)</span>}
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
        <div className="space-y-3 rounded-md border border-line p-3">
          <label className="flex cursor-pointer items-start gap-2.5">
            <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={v.ssoEnabled} onChange={(e) => set("ssoEnabled", e.target.checked)} />
            <span className="text-sm"><b>Single sign-on</b><span className="block text-xs text-muted">The card signs people in to this application with their hub account (a short-lived signed token is sent to the callback URL). The application must be set up to accept it.</span></span>
          </label>
          {v.ssoEnabled && (
            <>
              <Field label="SSO slug (lowercase letters, numbers and hyphens, for example mccia-search)">
                <input className="input" value={v.ssoSlug} onChange={(e) => set("ssoSlug", e.target.value)} maxLength={80} autoComplete="off" spellCheck={false} required />
                {slugBad && <span className="mt-1 block text-xs text-brand-red">{slugBad}</span>}
              </Field>
              <Field label="Callback URL (on the same site as the URL above)">
                <input className="input" type="text" inputMode="url" value={v.ssoCallbackUrl} onChange={(e) => set("ssoCallbackUrl", e.target.value)} maxLength={2000} autoComplete="off" spellCheck={false} required />
                {callbackBad && <span className="mt-1 block text-xs text-brand-red">{callbackBad}</span>}
              </Field>
            </>
          )}
        </div>
        <Field label="Availability label">
          <select className="input" value={v.status} onChange={(e) => set("status", e.target.value as AppVals["status"])}>
            <option value="active">Active (working)</option><option value="testing">Under testing (shown with a label)</option><option value="unavailable">Unavailable (shown, cannot be opened)</option>
          </select>
        </Field>
        <label className="flex cursor-pointer items-start gap-2.5">
          <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={v.isActive} onChange={(e) => set("isActive", e.target.checked)} />
          <span className="text-sm"><b>Active</b><span className="block text-xs text-muted">Only active applications are shown in the hub. Untick to hide it without deleting.</span></span>
        </label>
        <button className="btn btn-primary btn-sm" disabled={pending || departments.length === 0}>{submitLabel}</button>
      </form>
      <div className="hidden md:block">
        <p className="label-xs mb-1.5">Preview</p>
        <div className="pointer-events-none"><AppCard app={{ id: "preview", name: v.name || "App name", description: v.description || null, icon: v.icon, status: v.status }} /></div>
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
