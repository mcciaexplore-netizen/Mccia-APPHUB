"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowLeft, KeyRound, Mail, Power, Trash2 } from "lucide-react";
import { AccessTree } from "@/components/AccessTree";
import { useConfirm } from "@/components/ConfirmDialog";
import { LinksDialog, ResetDialog, type Catalog, type Manager, type Option, type Template } from "@/components/people/PeopleDialogs";
import { useToast } from "@/components/Toast";
import { deletePerson, sendSetupLink, setAdminAreas, setPersonAccess, setPersonActive, updatePerson, type LinkResult } from "@/actions/people";
import { STATUS_BADGE, STATUS_LABEL } from "@/lib/account-status";
import { formatIST, roleBadge, roleLabel } from "@/lib/format";
import type { PersonDetail } from "@/lib/people";
import { ADMIN_AREAS, AREA_LABEL, type AdminArea } from "@/lib/rbac";

export type ProfileCaps = { editPerson: boolean; changeRole: boolean; toggleActive: boolean; remove: boolean; invite: boolean };
export type AuditLine = { id: number; at: Date; actorName: string; action: string; details: unknown };

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="block"><span className="label-xs mb-1.5 block">{label}</span>{children}</label>;
const Fact = ({ label, children }: { label: string; children: React.ReactNode }) => <div className="flex justify-between gap-4 border-b border-line py-2 text-sm last:border-0"><dt className="text-muted">{label}</dt><dd className="text-right">{children}</dd></div>;

/** Describes an audit entry in a sentence: who did what, with the apps or fields involved. */
function describe(a: AuditLine): string {
  const d = (a.details ?? {}) as { added?: string[]; removed?: string[]; changes?: Record<string, { from: unknown; to: unknown }>; delivery?: string };
  if (a.action === "access.change") return [d.added?.length ? `added ${d.added.join(", ")}` : "", d.removed?.length ? `removed ${d.removed.join(", ")}` : ""].filter(Boolean).join("; ") || "changed access";
  if (a.action === "user.update" && d.changes) return `changed ${Object.keys(d.changes).join(", ")}`;
  if (a.action === "user.invite") return `sent a setup link (${d.delivery ?? "created"})`;
  if (a.action === "user.admin_areas") return "changed what this Admin may open";
  return a.action.replace(/^user\./, "").replace(/_/g, " ");
}

/** One person, everything about them on one screen: who they are, where they sit, what they can open, and what changed recently. */
export function ProfileView({ base, person, caps, options, catalog, templates, otherApps, audit, meId, accessEditable, appNames, responsibilities }: {
  base: string; person: PersonDetail; caps: ProfileCaps; options: { branches: Option[]; teams: Option[]; managers: Manager[] };
  catalog: Catalog; templates: Template[]; otherApps: number; audit: AuditLine[] | null; meId: string;
  /** Whether the viewer may change this person's access; when not (for example their own profile), it is shown read only. */
  accessEditable: boolean; appNames: string[];
  /** What this person does in the Approval System, worked out from the Approver Rules (empty for most people). */
  responsibilities: string[];
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [links, setLinks] = useState<LinkResult[] | null>(null);
  const [resetting, setResetting] = useState(false);

  const [f, setF] = useState({
    name: person.name, designation: person.designation ?? "", branchId: person.branchId ?? "",
    teamId: person.teamId ?? "", managerId: person.managerId ?? "", role: person.role,
  });
  const [areas, setAreas] = useState<string[]>(person.adminAreas);
  const areasChanged = areas.length !== person.adminAreas.length || areas.some((a) => !person.adminAreas.includes(a));
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const inCatalog = new Set(catalog.apps.map((a) => a.id));
  const initialApps = person.appIds.filter((id) => inCatalog.has(id));
  const [saved, setSaved] = useState(initialApps);
  const [apps, setApps] = useState(initialApps);
  const [tpl, setTpl] = useState("");
  const dirtyApps = apps.length !== saved.length || apps.some((id) => !saved.includes(id));
  const refresh = () => router.refresh();
  const isHeadAdmin = person.role === "head_admin"; // the Support Admin: their role is never changed here
  const seesAll = isHeadAdmin; // the Support Admin can open every application; the Super Admin and everyone else get the applications assigned to them
  const self = person.id === meId;
  const template = templates.find((t) => t.id === tpl);

  const saveDetails = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await updatePerson(person.id, {
        name: f.name, designation: f.designation, branchId: f.branchId || null, teamId: f.teamId || null, managerId: f.managerId || null,
        role: caps.changeRole && !isHeadAdmin ? f.role : undefined,
      });
      if (r.ok) { toast.success("Details saved"); refresh(); } else toast.error(r.error);
    });
  };
  const saveAreas = () => start(async () => {
    const r = await setAdminAreas(person.id, areas);
    if (r.ok) { toast.success("What this Admin may open is saved and recorded in the audit log"); refresh(); } else toast.error(r.error);
  });
  const saveAccess = () => start(async () => {
    const r = await setPersonAccess(person.id, apps);
    if (r.ok) { setSaved(apps); toast.success(r.data.changed.length ? "Access saved and recorded in the audit log" : "Nothing to change"); refresh(); } else toast.error(r.error);
  });
  const setupLink = () => start(async () => {
    const r = await sendSetupLink(person.id);
    if (!r.ok) return toast.error(r.error);
    if (r.data.ok && r.data.delivery === "sent") toast.success(`Setup link emailed to ${person.email}.`); else setLinks([r.data]);
    refresh();
  });

  return (
    <div className="space-y-6">
      <Link href={base} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-primary"><ArrowLeft size={14} /> Back to people</Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-2xl">{person.name}</h2>
          <p className="text-sm text-muted">{person.email}</p>
          <p className="mt-2 flex flex-wrap items-center gap-2"><span className={roleBadge[person.role]}>{roleLabel[person.role]}</span><span className={STATUS_BADGE[person.status]}>{STATUS_LABEL[person.status]}</span>
            {person.mainAdmin && <span className="badge badge-neutral">{person.role === "head_admin" || person.role === "super_admin" ? "Main admin" : "Main account"}{person.passwordInSettings ? " · password in settings" : ""}</span>}</p>
        </div>
        {((caps.invite && !person.passwordInSettings) || (caps.toggleActive && !self) || (caps.remove && !self)) && (
          <div className="flex flex-wrap gap-2">
            {caps.invite && !person.passwordInSettings && <button className="btn btn-ghost btn-sm" disabled={pending || !person.isActive} onClick={setupLink}><Mail size={14} /> Send setup link</button>}
            {caps.invite && !person.passwordInSettings && <button className="btn btn-ghost btn-sm" aria-label={`Reset password for ${person.name}`} onClick={() => setResetting(true)}><KeyRound size={14} /> Reset password</button>}
            {caps.toggleActive && !self && (
              <button className="btn btn-ghost btn-sm" disabled={pending} onClick={async () => {
                if (person.isActive && !(await confirm({ title: "Deactivate this user?", confirmLabel: "Deactivate", danger: true, message: `${person.name} will be signed out at once and cannot open anything until you activate them again. Their access settings are kept.${person.passwordInSettings ? " This account is set in the environment settings, so it is switched on again at its next sign-in unless you also remove its settings in Vercel." : ""}` }))) return;
                start(async () => { const r = await setPersonActive(person.id, !person.isActive); if (r.ok) { toast.success(person.isActive ? "User deactivated and signed out" : "User activated"); refresh(); } else toast.error(r.error); });
              }}><Power size={14} /> {person.isActive ? "Deactivate" : "Activate"}</button>
            )}
            {caps.remove && !self && (
              <button className="btn btn-danger btn-sm" disabled={pending} onClick={async () => {
                if (!(await confirm({ title: "Delete this user?", confirmLabel: "Delete", danger: true, message: `${person.name} (${person.email}) will be removed for good, with their password and their access to applications. Their past activity stays in the log as an unknown user. To stop someone signing in but keep the account, deactivate them instead.${person.passwordInSettings ? " This account is set in the environment settings, so it comes back at its next sign-in unless you also remove its settings in Vercel." : ""}` }))) return;
                start(async () => { const r = await deletePerson(person.id); if (r.ok) { toast.success("User deleted"); router.push(base); router.refresh(); } else toast.error(r.error); });
              }}><Trash2 size={14} /> Delete</button>
            )}
          </div>
        )}
      </header>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <form className="glass !rounded-md space-y-4 p-5 sm:p-6" onSubmit={saveDetails} aria-label="Details and organisation">
          <h3 className="text-lg">Details and where they sit</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name"><input className="input" value={f.name} onChange={(e) => set("name", e.target.value)} required maxLength={120} disabled={!caps.editPerson} /></Field>
            <Field label="Designation"><input className="input" value={f.designation} onChange={(e) => set("designation", e.target.value)} maxLength={120} disabled={!caps.editPerson} /></Field>
            <Field label="Branch"><select className="input" value={f.branchId} onChange={(e) => set("branchId", e.target.value)} disabled={!caps.editPerson}><option value="">None</option>{options.branches.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
            <Field label="Team"><select className="input" value={f.teamId} onChange={(e) => set("teamId", e.target.value)} disabled={!caps.editPerson}><option value="">None</option>{options.teams.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
            <Field label="Reporting manager"><select className="input" value={f.managerId} onChange={(e) => set("managerId", e.target.value)} disabled={!caps.editPerson}><option value="">None</option>{options.managers.filter((m) => m.id !== person.id).map((d) => <option key={d.id} value={d.id}>{d.name} ({d.email})</option>)}</select></Field>
            <Field label="Role">
              {isHeadAdmin ? <input className="input" value={roleLabel[person.role]} disabled aria-label="Role" /> : (
                <select className="input" value={f.role} onChange={(e) => set("role", e.target.value)} disabled={!caps.changeRole || self || person.passwordInSettings} aria-label="Role"><option value="member">User</option><option value="dept_lead">Team manager</option><option value="admin">Admin</option><option value="super_admin">Super admin</option></select>
              )}
            </Field>
          </div>
          {!caps.editPerson && <p className="text-xs text-subtle">You cannot change these details.</p>}
          {caps.editPerson && !caps.changeRole && <p className="text-xs text-subtle">Only the Support Admin can change a role.</p>}
          {caps.editPerson && <button className="btn btn-primary btn-sm" disabled={pending}>Save details</button>}
        </form>

        <aside className="space-y-6">
          <section className="glass !rounded-md p-5" aria-label="Account">
            <h3 className="mb-2 text-lg">Account</h3>
            <dl>
              <Fact label="Status"><span className={STATUS_BADGE[person.status]}>{STATUS_LABEL[person.status]}</span></Fact>
              <Fact label="Last sign-in">{formatIST(person.lastLoginAt)}</Fact>
              <Fact label="Created">{formatIST(person.createdAt)}</Fact>
              <Fact label="Setup link">{person.invite ? (person.invite.state === "used" ? "Used" : person.invite.state === "expired" ? "Expired" : `Open until ${formatIST(person.invite.expiresAt)}`) : <span className="text-subtle">None</span>}</Fact>
            </dl>
          </section>
          <section className="glass !rounded-md p-5" aria-label="Approval responsibilities">
            <h3 className="mb-2 text-lg">Approval responsibilities</h3>
            {responsibilities.length === 0 ? <p className="text-sm text-subtle">None. They can submit requests but do not approve any.</p> : (
              <ul className="space-y-1.5 text-sm">{responsibilities.map((r) => <li key={r} className="flex items-start gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />{r}</li>)}</ul>
            )}
          </section>
          <section className="glass !rounded-md p-5" aria-label="Recent applications opened">
            <h3 className="mb-2 text-lg">Recently opened</h3>
            {person.launches.length === 0 ? <p className="text-sm text-subtle">Nothing yet.</p> : (
              <ul className="space-y-1.5 text-sm">{person.launches.map((l, i) => <li key={i} className="flex justify-between gap-3"><span>{l.app ?? "Deleted application"}</span><span className="text-xs text-muted">{formatIST(l.at)}</span></li>)}</ul>
            )}
          </section>
        </aside>
      </div>

      {person.role === "admin" && (
        <section className="glass !rounded-md space-y-4 p-5 sm:p-6" aria-label="What this Admin may open">
          <div>
            <h3 className="text-lg">What this Admin may open</h3>
            <p className="mt-1 text-sm text-muted">An Admin can use only the parts of Administrator ticked here. Whatever is ticked, an Admin can never change roles, delete people, or touch the Support Admin, the Super Admin or another Admin.</p>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {ADMIN_AREAS.map((a: AdminArea) => (
              <li key={a}>
                <label className="flex items-start gap-2.5 text-sm">
                  <input type="checkbox" className="mt-1 accent-[var(--c-primary)]" checked={areas.includes(a)} disabled={!caps.changeRole || pending}
                    onChange={(e) => setAreas((cur) => (e.target.checked ? [...cur, a] : cur.filter((x) => x !== a)))} />
                  <span><b>{AREA_LABEL[a].title}</b><span className="block text-xs text-muted">{AREA_LABEL[a].hint}</span></span>
                </label>
              </li>
            ))}
          </ul>
          {caps.changeRole ? (
            <div className="flex flex-wrap items-center gap-3">
              <button className="btn btn-primary btn-sm" disabled={pending || !areasChanged} onClick={saveAreas}>Save what they may open</button>
              <button className="btn btn-ghost btn-sm" disabled={pending || !areasChanged} onClick={() => setAreas(person.adminAreas)}>Discard changes</button>
              <span className="text-sm text-muted">{areas.length === 0 ? "Nothing ticked: they cannot open Administrator yet" : `${areas.length} of ${ADMIN_AREAS.length} ticked`}</span>
            </div>
          ) : <p className="text-xs text-subtle">Only the Support Admin can change this.</p>}
        </section>
      )}

      <section className="glass !rounded-md space-y-4 p-5 sm:p-6" aria-label="Application access">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg">Application access</h3>
          {templates.length > 0 && !seesAll && accessEditable && (
            <div className="flex flex-wrap items-center gap-2">
              <select className="input !w-auto min-w-44 !py-1.5" value={tpl} onChange={(e) => setTpl(e.target.value)} aria-label="Start from a template"><option value="">Start from a template…</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.appIds.length} apps)</option>)}</select>
              <button className="btn btn-ghost btn-sm" disabled={!template} onClick={() => template && setApps([...new Set([...apps, ...template.appIds])])}>Add its apps</button>
              <button className="btn btn-ghost btn-sm" disabled={!template} onClick={() => template && setApps([...template.appIds])}>Replace with its apps</button>
            </div>
          )}
        </div>
        {seesAll ? (
          <div className="space-y-4">
            <p className="text-sm text-muted">The Support Admin can open every application, so there is nothing to assign. This is everything {person.name} can open:</p>
            {catalog.departments.map((d) => {
              const list = catalog.apps.filter((x) => x.departmentId === d.id);
              if (list.length === 0) return null;
              return (
                <div key={d.id}>
                  <p className="label-xs mb-1.5">{d.name}{d.isActive ? "" : " (inactive)"}</p>
                  <p className="flex flex-wrap gap-1.5">{list.map((x) => <span key={x.id} className={`badge ${x.isActive ? "" : "badge-neutral line-through"}`} title={x.isActive ? undefined : "Inactive"}>{x.name}</span>)}</p>
                </div>
              );
            })}
            {catalog.apps.length === 0 && <p className="text-sm text-subtle">No applications are registered yet.</p>}
          </div>
        )
        : !accessEditable ? (
          appNames.length === 0 ? <p className="text-sm text-subtle">No applications assigned.</p>
          : <p className="flex flex-wrap gap-1.5">{appNames.map((n) => <span key={n} className="badge">{n}</span>)}</p>
        ) : (
          <>
            {otherApps > 0 && <p className="text-xs text-muted">{person.name} also has {otherApps} application{otherApps === 1 ? "" : "s"} that only someone with wider access can change.</p>}
            <AccessTree departments={catalog.departments} apps={catalog.apps} value={apps} onChange={setApps} disabled={pending} />
            <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-md border border-line bg-white p-3 shadow-card">
              <button className="btn btn-primary btn-sm" disabled={pending || !dirtyApps} onClick={saveAccess}>Save access</button>
              <button className="btn btn-ghost btn-sm" disabled={pending || apps.length === 0} onClick={() => setApps([])}>Untick all</button>
              <button className="btn btn-ghost btn-sm" disabled={pending || !dirtyApps} onClick={() => setApps(saved)}>Discard changes</button>
              <span className="ml-auto text-sm text-muted">{apps.length} application{apps.length === 1 ? "" : "s"} ticked{dirtyApps ? " · unsaved changes" : ""}</span>
            </div>
          </>
        )}
      </section>

      {audit && (
        <section className="glass !rounded-md p-5 sm:p-6" aria-label="Recent changes">
          <h3 className="mb-3 text-lg">Recent changes</h3>
          {audit.length === 0 ? <p className="text-sm text-subtle">No changes recorded yet.</p> : (
            <ul className="divide-y divide-line text-sm">{audit.map((a) => <li key={a.id} className="flex flex-wrap justify-between gap-2 py-2"><span><b>{a.actorName}</b> {describe(a)}</span><span className="text-xs text-muted">{formatIST(a.at)}</span></li>)}</ul>
          )}
        </section>
      )}

      {resetting && <ResetDialog person={{ id: person.id, name: person.name }} onClose={() => { setResetting(false); refresh(); }} onLinks={setLinks} />}
      {links && <LinksDialog results={links} onClose={() => setLinks(null)} />}
    </div>
  );
}
