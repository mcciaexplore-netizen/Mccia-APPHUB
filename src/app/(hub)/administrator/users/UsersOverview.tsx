"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { KeyRound, Plus, RefreshCw, ShieldCheck, Upload } from "lucide-react";
import type { Role } from "@/db/schema";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { roleBadge, roleLabel } from "@/lib/format";
import { generatePassword } from "@/lib/generate-password";
import { createUser, resetPassword, setUserActive } from "@/actions/users";
import { useRun } from "../departments/forms";
import { ImportUsers } from "./ImportUsers";

type U = {
  id: string; name: string; email: string; designation: string | null; role: Role; isActive: boolean; department: string | null;
  mainAdmin: boolean; hasPassword: boolean; applications: { app: string; dept: string; active: boolean }[];
};
type Dept = { id: string; name: string };

function PasswordField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="label-xs mb-1.5 block">{label}</span>
      <div className="flex gap-2">
        <input className="input font-mono" value={value} onChange={(e) => onChange(e.target.value)} required minLength={10} maxLength={128} autoComplete="off" />
        <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={() => onChange(generatePassword())}><RefreshCw size={14} /> Generate</button>
      </div>
      <span className="mt-1 block text-xs text-subtle">At least 10 characters with a letter and a number. Give it to the person; they can change it themselves.</span>
    </label>
  );
}

function AddUserForm({ departments, domains, pending, onSubmit }: {
  departments: Dept[]; domains: string; pending: boolean;
  onSubmit: (v: { name: string; email: string; password: string; designation: string; homeDepartmentId: string | null }) => void;
}) {
  const [v, setV] = useState({ name: "", email: "", password: generatePassword(), designation: "", homeDepartmentId: "" });
  const set = (k: keyof typeof v, x: string) => setV((s) => ({ ...s, [k]: x }));
  return (
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); onSubmit({ ...v, homeDepartmentId: v.homeDepartmentId || null }); }}>
      <label className="block"><span className="label-xs mb-1.5 block">Name</span><input className="input" value={v.name} onChange={(e) => set("name", e.target.value)} required maxLength={120} /></label>
      <label className="block"><span className="label-xs mb-1.5 block">Email (the username)</span>
        <input className="input" type="email" value={v.email} onChange={(e) => set("email", e.target.value)} required placeholder={domains ? `name${domains.split(" or ")[0]}` : "name@example.com"} /></label>
      <div className="sm:col-span-2"><PasswordField label="Password" value={v.password} onChange={(x) => set("password", x)} /></div>
      <label className="block"><span className="label-xs mb-1.5 block">Home department (optional)</span>
        <select className="input" value={v.homeDepartmentId} onChange={(e) => set("homeDepartmentId", e.target.value)}>
          <option value="">None</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select></label>
      <label className="block"><span className="label-xs mb-1.5 block">Designation (optional)</span><input className="input" value={v.designation} onChange={(e) => set("designation", e.target.value)} maxLength={120} /></label>
      <div className="sm:col-span-2"><button className="btn btn-primary btn-sm" disabled={pending}>Create user</button></div>
    </form>
  );
}

/** Everyone who can sign in, and the applications each can open. People are added here, one by one or from a CSV. */
export function UsersOverview({ users, departments, meId, domains }: { users: U[]; departments: Dept[]; meId: string; domains: string }) {
  const toast = useToast();
  const { run, pending } = useRun();
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [reset, setReset] = useState<U | null>(null);
  const [resetPw, setResetPw] = useState("");

  const shown = useMemo(() => users.filter((u) => {
    const t = q.trim().toLowerCase();
    const hay = `${u.name} ${u.email} ${u.designation ?? ""} ${u.applications.map((a) => a.app).join(" ")}`.toLowerCase();
    if (t && !hay.includes(t)) return false;
    return !dept || u.department === dept;
  }), [users, q, dept]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Everyone who can sign in, and the applications they can open. Choose each person&apos;s applications under Access.</p>
        <div className="flex gap-2">
          <button className="btn btn-primary btn-sm" onClick={() => setShowAdd((s) => !s)}><Plus size={14} /> Add user</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowImport((s) => !s)}><Upload size={14} /> Bulk import (CSV)</button>
        </div>
      </div>

      {showAdd && (
        <div className="glass p-5 sm:p-6">
          <AddUserForm departments={departments} domains={domains} pending={pending}
            onSubmit={(v) => run(() => createUser(v), "User created. Give them the email and password.", () => setShowAdd(false))} />
        </div>
      )}
      {showImport && <ImportUsers />}

      <div className="flex flex-wrap items-center gap-3">
        <input className="input !w-full sm:!w-72" placeholder="Search name, email or application" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input !w-auto" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Filter by department">
          <option value="">All departments</option>
          {departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
        </select>
        <span className="text-sm text-muted">{shown.length} of {users.length} users</span>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>User</th><th>Department</th><th>Role</th><th>Applications</th><th>Status</th><th className="text-right">Actions</th></tr></thead>
          <tbody>
            {shown.map((u) => (
              <tr key={u.id} className={u.isActive ? "" : "opacity-60"}>
                <td><b>{u.name}</b>{u.designation && <span className="text-xs text-muted"> · {u.designation}</span>}
                  <span className="block text-xs text-muted">{u.email}</span>
                  {u.mainAdmin && <span className="badge badge-neutral mt-1">Main admin · password in settings</span>}
                  {!u.mainAdmin && !u.hasPassword && <span className="badge badge-red mt-1">No password</span>}</td>
                <td>{u.department ?? <span className="text-subtle">—</span>}</td>
                <td><span className={roleBadge[u.role]}>{roleLabel[u.role]}</span></td>
                <td>
                  {u.role === "head_admin" ? <span className="text-xs text-muted">All applications</span>
                    : u.applications.length === 0 ? <span className="text-subtle">None</span>
                    : <span className="flex flex-wrap gap-1.5">{u.applications.map((a) => (
                        <span key={`${a.dept}/${a.app}`} className={`badge ${a.active ? "" : "badge-neutral line-through"}`} title={`${a.dept}${a.active ? "" : " (inactive)"}`}>{a.app}</span>
                      ))}</span>}
                </td>
                <td>
                  <button className={`badge cursor-pointer ${u.isActive ? "badge-green" : "badge-red"}`} disabled={pending || u.mainAdmin || u.id === meId}
                    title={u.mainAdmin || u.id === meId ? "The main admin cannot be deactivated" : u.isActive ? "Click to deactivate" : "Click to activate"}
                    onClick={() => run(() => setUserActive(u.id, !u.isActive), u.isActive ? "User deactivated and signed out" : "User activated")}>
                    {u.isActive ? "Active" : "Inactive"}</button>
                </td>
                <td>
                  <div className="flex justify-end gap-1.5">
                    {u.role !== "head_admin" && (
                      <Link className="chip !p-1.5 text-muted" aria-label={`Manage access for ${u.name}`} title="Manage access" href={`/administrator/access/user/${u.id}`}><ShieldCheck size={14} /></Link>
                    )}
                    {!u.mainAdmin && (
                      <button className="chip !p-1.5 text-muted" aria-label={`Reset password for ${u.name}`} title="Reset password" onClick={() => { setReset(u); setResetPw(generatePassword()); }}><KeyRound size={14} /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={6} className="text-subtle">{users.length ? "No users match." : "No users yet. Use Add user or Bulk import (CSV)."}</td></tr>}
          </tbody>
        </table>
      </div>

      {reset && (
        <Modal title={`Reset password for ${reset.name}`} onClose={() => setReset(null)}>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => resetPassword(reset.id, resetPw), "Password reset. They are signed out and need the new one.", () => { toast.success("Share the new password with them."); setReset(null); }); }}>
            <PasswordField label="New password" value={resetPw} onChange={setResetPw} />
            <button className="btn btn-primary btn-sm" disabled={pending}>Reset password</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
