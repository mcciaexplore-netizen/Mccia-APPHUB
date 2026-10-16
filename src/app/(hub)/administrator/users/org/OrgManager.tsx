"use client";

import { useState, useTransition } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { useToast } from "@/components/Toast";
import { createBranch, createTeam, deleteBranch, deleteTeam, renameBranch, setBranchActive, setTeamActive, updateTeam } from "@/actions/org";

type Branch = { id: string; name: string; isActive: boolean; people: number; teams: number };
type Team = { id: string; name: string; branchId: string | null; isActive: boolean; people: number };
type Res = { ok: true } | { ok: false; error: string };

/** Branches (office locations) and teams (groups under a manager): the organisation people are placed in. */
export function OrgManager({ branches, teams }: { branches: Branch[]; teams: Team[] }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [newBranch, setNewBranch] = useState("");
  const [newTeam, setNewTeam] = useState({ name: "", branchId: "" });
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const run = (fn: () => Promise<Res>, ok: string, after?: () => void) => start(async () => { const r = await fn(); if (r.ok) { toast.success(ok); after?.(); } else toast.error(r.error); });

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <section className="min-w-0 space-y-3" aria-label="Branches">
        <h2 className="text-xl">Branches</h2>
        <p className="text-sm text-muted">Office locations. A person belongs to at most one. These are separate from Departments (where people sit) and from Application categories (which arrange the applications).</p>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(() => createBranch(newBranch), "Branch added", () => setNewBranch("")); }}>
          <input className="input" placeholder="New branch name" value={newBranch} onChange={(e) => setNewBranch(e.target.value)} required maxLength={80} aria-label="New branch name" />
          <button className="btn btn-primary btn-sm shrink-0" disabled={pending}><Plus size={14} /> Add branch</button>
        </form>
        <div className="table-wrap"><table>
          <thead><tr><th>Branch</th><th>People</th><th>Teams</th><th>Status</th><th className="text-right">Actions</th></tr></thead>
          <tbody>
            {branches.map((b) => (
              <tr key={b.id} className={b.isActive ? "" : "opacity-60"}>
                <td>{editing?.id === b.id ? (
                  <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); run(() => renameBranch(b.id, editing.name), "Branch renamed", () => setEditing(null)); }}>
                    <input className="input !py-1" value={editing.name} onChange={(e) => setEditing({ id: b.id, name: e.target.value })} required maxLength={80} aria-label={`Name of ${b.name}`} autoFocus />
                    <button className="chip !p-1.5" aria-label="Save name"><Check size={14} /></button><button type="button" className="chip !p-1.5" aria-label="Cancel" onClick={() => setEditing(null)}><X size={14} /></button>
                  </form>) : <b>{b.name}</b>}</td>
                <td>{b.people}</td><td>{b.teams}</td>
                <td><button className={`badge cursor-pointer ${b.isActive ? "badge-green" : "badge-red"}`} disabled={pending} onClick={() => run(() => setBranchActive(b.id, !b.isActive), b.isActive ? "Branch deactivated" : "Branch activated")}>{b.isActive ? "Active" : "Inactive"}</button></td>
                <td><div className="flex justify-end gap-1.5">
                  <button className="chip !p-1.5 text-muted" aria-label={`Rename ${b.name}`} title="Rename" onClick={() => setEditing({ id: b.id, name: b.name })}><Pencil size={14} /></button>
                  <button className="chip !p-1.5 text-brand-red" aria-label={`Delete ${b.name}`} title="Delete" disabled={pending} onClick={async () => { if (await confirm({ title: "Delete this branch?", confirmLabel: "Delete", danger: true, message: `“${b.name}” will be removed. A branch that still has people or teams cannot be deleted; deactivate it instead.` })) run(() => deleteBranch(b.id), "Branch deleted"); }}><Trash2 size={14} /></button>
                </div></td>
              </tr>
            ))}
            {branches.length === 0 && <tr><td colSpan={5} className="text-subtle">No branches yet.</td></tr>}
          </tbody>
        </table></div>
      </section>

      <section className="min-w-0 space-y-3" aria-label="Teams">
        <h2 className="text-xl">Teams</h2>
        <p className="text-sm text-muted">A group of people under a manager. A team can belong to a branch; a person in the team then gets that branch.</p>
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); run(() => createTeam({ name: newTeam.name, branchId: newTeam.branchId || null }), "Team added", () => setNewTeam({ name: "", branchId: "" })); }}>
          <input className="input !w-auto min-w-48 flex-1" placeholder="New team name" value={newTeam.name} onChange={(e) => setNewTeam({ ...newTeam, name: e.target.value })} required maxLength={80} aria-label="New team name" />
          <select className="input !w-auto" value={newTeam.branchId} onChange={(e) => setNewTeam({ ...newTeam, branchId: e.target.value })} aria-label="Branch of the new team"><option value="">No branch</option>{branches.filter((b) => b.isActive).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          <button className="btn btn-primary btn-sm shrink-0" disabled={pending}><Plus size={14} /> Add team</button>
        </form>
        <div className="table-wrap"><table>
          <thead><tr><th>Team</th><th>Branch</th><th>People</th><th>Status</th><th className="text-right">Actions</th></tr></thead>
          <tbody>
            {teams.map((t) => (
              <tr key={t.id} className={t.isActive ? "" : "opacity-60"}>
                <td><b>{t.name}</b></td>
                <td><select className="input !w-auto !py-1" value={t.branchId ?? ""} disabled={pending} aria-label={`Branch of ${t.name}`} onChange={(e) => run(() => updateTeam(t.id, { name: t.name, branchId: e.target.value || null }), "Team saved")}>
                  <option value="">No branch</option>{branches.filter((b) => b.isActive || b.id === t.branchId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
                  <span className="sr-only">{t.branchId ? branchName.get(t.branchId) : "No branch"}</span></td>
                <td>{t.people}</td>
                <td><button className={`badge cursor-pointer ${t.isActive ? "badge-green" : "badge-red"}`} disabled={pending} onClick={() => run(() => setTeamActive(t.id, !t.isActive), t.isActive ? "Team deactivated" : "Team activated")}>{t.isActive ? "Active" : "Inactive"}</button></td>
                <td><div className="flex justify-end gap-1.5">
                  <button className="chip !p-1.5 text-brand-red" aria-label={`Delete ${t.name}`} title="Delete" disabled={pending} onClick={async () => { if (await confirm({ title: "Delete this team?", confirmLabel: "Delete", danger: true, message: `“${t.name}” will be removed. A team that still has people cannot be deleted; deactivate it instead.` })) run(() => deleteTeam(t.id), "Team deleted"); }}><Trash2 size={14} /></button>
                </div></td>
              </tr>
            ))}
            {teams.length === 0 && <tr><td colSpan={5} className="text-subtle">No teams yet.</td></tr>}
          </tbody>
        </table></div>
      </section>
    </div>
  );
}
