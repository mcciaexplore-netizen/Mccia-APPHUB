"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { KeyRound, Pencil, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import type { Role } from "@/db/schema";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { formatIST, roleBadge, roleLabel } from "@/lib/format";
import { generatePassword } from "@/lib/generate-password";
import { createUser, resetPassword, setUserActive, updateUser } from "@/actions/users";

type U = {
  id: string; name: string; email: string; phone: string | null; designation: string | null; role: Role;
  homeDepartmentId: string | null; isActive: boolean; mustChangePassword: boolean; lastLoginAt: string | null;
};
type D = { id: string; name: string; isActive: boolean };
type Res = { ok: true } | { ok: false; error: string };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="label-xs mb-1.5 block">{label}</span>{children}</label>;
}

function PasswordField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <Field label={label}>
      <div className="flex gap-2">
        <input className="input font-mono" value={value} onChange={(e) => onChange(e.target.value)} required minLength={10} maxLength={72} autoComplete="off" />
        <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={() => onChange(generatePassword())}><RefreshCw size={14} /> Generate</button>
      </div>
      <span className="mt-1 block text-xs text-subtle">At least 10 characters with a letter and a number. Share it with the user; they must change it at first login.</span>
    </Field>
  );
}

type FormVals = { name: string; email: string; phone: string; designation: string; role: Role; homeDepartmentId: string | null; tempPassword: string };

function UserForm({ departments, domain, initial, onSubmit, pending, label }: {
  departments: D[]; domain: string; initial?: U; pending: boolean; label: string; onSubmit: (v: FormVals) => void;
}) {
  const [v, setV] = useState<FormVals>({
    name: initial?.name ?? "", email: initial?.email ?? "", phone: initial?.phone ?? "", designation: initial?.designation ?? "",
    role: initial?.role ?? "member", homeDepartmentId: initial?.homeDepartmentId ?? null, tempPassword: initial ? "" : generatePassword(),
  });
  const set = <K extends keyof FormVals>(k: K, val: FormVals[K]) => setV((s) => ({ ...s, [k]: val }));
  // Department admin is reserved for later; only offer it if this user already has it.
  const roles = (["head_admin", "member"] as Role[]).concat(initial?.role === "dept_lead" ? ["dept_lead"] : []);
  return (
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); onSubmit(v); }}>
      <Field label="Name"><input className="input" value={v.name} onChange={(e) => set("name", e.target.value)} required maxLength={120} /></Field>
      <Field label="Email"><input className="input" type="email" value={v.email} disabled={!!initial} placeholder={domain ? `name@${domain}` : "name@example.com"} onChange={(e) => set("email", e.target.value)} required /></Field>
      <Field label="Phone"><input className="input" type="tel" value={v.phone} onChange={(e) => set("phone", e.target.value)} maxLength={30} /></Field>
      <Field label="Designation"><input className="input" value={v.designation} onChange={(e) => set("designation", e.target.value)} maxLength={120} /></Field>
      <Field label="Home department">
        <select className="input" value={v.homeDepartmentId ?? ""} onChange={(e) => set("homeDepartmentId", e.target.value || null)}>
          <option value="">None</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </Field>
      <Field label="Role">
        <select className="input" value={v.role} onChange={(e) => set("role", e.target.value as Role)}>
          {roles.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
        </select>
      </Field>
      {!initial && <div className="sm:col-span-2"><PasswordField label="Temporary password" value={v.tempPassword} onChange={(x) => set("tempPassword", x)} /></div>}
      {v.role === "head_admin" && <p className="text-xs text-subtle sm:col-span-2">Head admins see every application and can open Administrator.</p>}
      <div className="sm:col-span-2"><button className="btn btn-primary btn-sm" disabled={pending}>{label}</button></div>
    </form>
  );
}

export function UsersManager({ meId, domain, users, departments }: { meId: string; domain: string; users: U[]; departments: D[] }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");
  const [fRole, setFRole] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [edit, setEdit] = useState<U | null>(null);
  const [reset, setReset] = useState<U | null>(null);
  const [resetPw, setResetPw] = useState("");

  const deptName = new Map(departments.map((d) => [d.id, d.name]));
  const shown = useMemo(() => users.filter((u) => {
    const t = q.trim().toLowerCase();
    if (t && !`${u.name} ${u.email} ${u.designation ?? ""}`.toLowerCase().includes(t)) return false;
    if (fRole && u.role !== fRole) return false;
    return true;
  }), [users, q, fRole]);

  function run(fn: () => Promise<Res>, okMsg: string, after?: () => void) {
    start(async () => {
      const r = await fn();
      if (r.ok) { toast.success(okMsg); after?.(); } else toast.error(r.error);
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        <button className="btn btn-primary btn-sm" onClick={() => setShowAdd((s) => !s)}><Plus size={14} /> Add user</button>
      </div>

      {showAdd && (
        <div className="glass p-5 sm:p-6">
          <UserForm departments={departments} domain={domain} pending={pending} label="Create user"
            onSubmit={(v) => run(() => createUser({ ...v, phone: v.phone || null, designation: v.designation || null }), "User created. Share the temporary password with them.", () => setShowAdd(false))} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <input className="input !w-full sm:!w-64" placeholder="Search name, email or designation" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input !w-auto" value={fRole} onChange={(e) => setFRole(e.target.value)} aria-label="Filter by role">
          <option value="">All roles</option><option value="head_admin">{roleLabel.head_admin}</option><option value="member">{roleLabel.member}</option>
        </select>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>User</th><th>Department</th><th>Role</th><th>Last login</th><th>Active</th><th className="text-right">Actions</th></tr></thead>
          <tbody>
            {shown.map((u) => (
              <tr key={u.id} className={u.isActive ? "" : "opacity-60"}>
                <td><b>{u.name}</b>{u.designation && <span className="text-xs text-muted"> · {u.designation}</span>}
                  <span className="block text-xs text-muted">{u.email}{u.phone ? ` · ${u.phone}` : ""}</span>
                  {u.mustChangePassword && <span className="badge badge-neutral mt-1">Temporary password</span>}</td>
                <td>{u.homeDepartmentId ? deptName.get(u.homeDepartmentId) : <span className="text-subtle">—</span>}</td>
                <td><span className={roleBadge[u.role]}>{roleLabel[u.role]}</span></td>
                <td className="whitespace-nowrap text-xs">{formatIST(u.lastLoginAt)}</td>
                <td>
                  <button className={`badge cursor-pointer ${u.isActive ? "badge-green" : "badge-red"}`} disabled={pending || (u.id === meId && u.isActive)}
                    title={u.id === meId ? "You cannot deactivate yourself" : undefined}
                    onClick={() => run(() => setUserActive(u.id, !u.isActive), u.isActive ? "User deactivated" : "User reactivated")}>
                    {u.isActive ? "Active" : "Inactive"}</button>
                </td>
                <td>
                  <div className="flex justify-end gap-1.5">
                    {u.role !== "head_admin" && (
                      <Link className="chip !p-1.5 text-muted" aria-label="Manage access" title="Manage access" href={`/administrator/access/user/${u.id}`}><ShieldCheck size={14} /></Link>
                    )}
                    <button className="chip !p-1.5 text-muted" aria-label="Reset password" title="Reset password" onClick={() => { setReset(u); setResetPw(generatePassword()); }}><KeyRound size={14} /></button>
                    <button className="chip !p-1.5 text-muted" aria-label="Edit" title="Edit" onClick={() => setEdit(u)}><Pencil size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={6} className="text-subtle">No users match.</td></tr>}
          </tbody>
        </table>
      </div>

      {edit && (
        <Modal title={`Edit ${edit.name}`} onClose={() => setEdit(null)}>
          <UserForm initial={edit} departments={departments} domain={domain} pending={pending} label="Save"
            onSubmit={(v) => run(() => updateUser(edit.id, { ...v, phone: v.phone || null, designation: v.designation || null }), "User saved", () => setEdit(null))} />
        </Modal>
      )}
      {reset && (
        <Modal title={`Reset password for ${reset.name}`} onClose={() => setReset(null)}>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => resetPassword(reset.id, resetPw), "Password reset. Share the temporary password with the user.", () => setReset(null)); }}>
            <PasswordField label="New temporary password" value={resetPw} onChange={setResetPw} />
            <p className="text-xs text-subtle">This also unlocks the account if it was locked after failed attempts.</p>
            <button className="btn btn-primary btn-sm" disabled={pending}>Reset password</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
