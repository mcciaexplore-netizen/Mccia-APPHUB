"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";

export type RoleHolder = { id: string; name: string; email: string; role: string };
export type AppRoleLists = { admins: string[]; superAdmins: string[] };

export const initialRoleLists = (people: RoleHolder[]): AppRoleLists => ({
  admins: people.filter((p) => p.role === "admin").map((p) => p.id),
  superAdmins: people.filter((p) => p.role === "super_admin").map((p) => p.id),
});

export const sameRoleLists = (a: AppRoleLists, b: AppRoleLists) =>
  [...a.admins].sort().join() === [...b.admins].sort().join() && [...a.superAdmins].sort().join() === [...b.superAdmins].sort().join();

/** One searchable list: the people picked show as chips, and typing finds the rest. */
function RolePicker({ label, people, picked, onChange }: { label: string; people: RoleHolder[]; picked: string[]; onChange: (ids: string[]) => void }) {
  const [q, setQ] = useState("");
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const t = q.trim().toLowerCase();
  const matches = t ? people.filter((p) => !picked.includes(p.id) && `${p.name} ${p.email}`.toLowerCase().includes(t)).slice(0, 8) : [];
  return (
    <div>
      <span className="label-xs mb-1.5 block">{label}</span>
      {picked.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {picked.map((id) => (
            <span key={id} className="badge badge-neutral inline-flex items-center gap-1">
              {byId.get(id)?.name ?? "Unknown"}
              <button type="button" aria-label={`Remove ${byId.get(id)?.name ?? "person"} from ${label}`} onClick={() => onChange(picked.filter((x) => x !== id))}><X size={12} /></button>
            </span>
          ))}
        </div>
      )}
      <input className="input" type="search" placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search people to add to ${label}`} />
      {matches.length > 0 && (
        <ul className="mt-1 max-h-48 overflow-auto rounded-md border border-line">
          {matches.map((p) => (
            <li key={p.id}>
              <button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--c-primary)]/10" onClick={() => { onChange([...picked, p.id]); setQ(""); }}>
                <b>{p.name}</b> <span className="text-xs text-muted">{p.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {t && matches.length === 0 && <p className="mt-1 text-xs text-subtle">Nobody else with access matches.</p>}
    </div>
  );
}

/**
 * The Edit form's App roles, for the Support Admin: who is signed in to this application as an Admin or a Super Admin. Everyone else who
 * has it is a User. Only people who already have the application are listed; a person is in one list at most.
 */
export function AppRoles({ people, value, onChange }: { people: RoleHolder[]; value: AppRoleLists; onChange: (v: AppRoleLists) => void }) {
  return (
    <div className="space-y-3 rounded-md border border-line p-3">
      <p className="text-sm"><b>App roles</b><span className="block text-xs text-muted">
        The role the sign-in token gives each person in this application. Everyone else who has it is a User. Only people who already have the
        application are listed (give access with the shield button first). The Support Admin is always at least an Admin. The application must
        understand a role for it to work there.
      </span></p>
      {people.length === 0 ? <p className="text-xs text-subtle">Nobody has this application yet.</p> : (
        <>
          <RolePicker label="Admins" people={people} picked={value.admins}
            onChange={(admins) => onChange({ admins, superAdmins: value.superAdmins.filter((id) => !admins.includes(id)) })} />
          <RolePicker label="Super Admins" people={people} picked={value.superAdmins}
            onChange={(superAdmins) => onChange({ superAdmins, admins: value.admins.filter((id) => !superAdmins.includes(id)) })} />
        </>
      )}
    </div>
  );
}
