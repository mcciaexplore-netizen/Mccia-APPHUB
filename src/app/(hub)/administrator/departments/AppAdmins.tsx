"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";

export type AdminPerson = { id: string; name: string; email: string };
/** What the Edit form needs for App Admins: everyone who can be picked, who has the application, who is picked, and whether it can be changed. */
export type AppAdminsData = { people: AdminPerson[]; accessIds: string[]; selected: string[]; canEdit: boolean };

/** The words of one such section: App Admins (the default) or App Staff. */
export type AppPeopleCopy = { title: string; access: string };
const ADMINS: AppPeopleCopy = { title: "App Admins", access: "admin" };
export const STAFF: AppPeopleCopy = { title: "App Staff", access: "staff" };

/**
 * The application's App Admins (or, with `copy`, its App Staff): picked people shown as removable tags, and a search to add more. Someone
 * who has not been given the application is marked "no access yet" (being an App Admin does not give access). Only the Support Admin can
 * change it; anyone else who can edit applications sees the list. People in `excludeIds` are not offered in the search.
 */
export function AppAdmins({ data, value, onChange, copy = ADMINS, excludeIds = [] }: {
  data: AppAdminsData; value: string[]; onChange: (ids: string[]) => void; copy?: AppPeopleCopy; excludeIds?: string[];
}) {
  const [q, setQ] = useState("");
  const byId = useMemo(() => new Map(data.people.map((p) => [p.id, p])), [data.people]);
  const access = useMemo(() => new Set(data.accessIds), [data.accessIds]);
  const t = q.trim().toLowerCase();
  const matches = t ? data.people.filter((p) => !value.includes(p.id) && !excludeIds.includes(p.id) && `${p.name} ${p.email}`.toLowerCase().includes(t)).slice(0, 8) : [];
  return (
    <div className="space-y-3 rounded-md border border-line p-3">
      <p className="text-sm"><b>{copy.title}</b><span className="block text-xs text-muted">
        These people get {copy.access} access when signing in to this app. Everyone else gets user access.{data.canEdit ? " They also need the app itself (the shield button) to open it." : " Only the Support Admin can change this."}
      </span></p>
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => {
            const p = byId.get(id);
            return (
              <span key={id} className="badge badge-neutral inline-flex items-center gap-1" title={p?.email}>
                {p?.name ?? "Unknown"}{!access.has(id) && <span className="text-brand-red">· no access yet</span>}
                {data.canEdit && <button type="button" aria-label={`Remove ${p?.name ?? "this person"} from ${copy.title}`} onClick={() => onChange(value.filter((x) => x !== id))}><X size={12} /></button>}
              </span>
            );
          })}
        </div>
      ) : <p className="text-xs text-subtle">No {copy.title}: everyone who opens it gets user access.</p>}
      {data.canEdit && (
        <div>
          <input className="input" type="search" placeholder="Search people to add" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search people to add as ${copy.title}`} />
          {matches.length > 0 && (
            <ul className="mt-1 max-h-48 overflow-auto rounded-md border border-line">
              {matches.map((p) => (
                <li key={p.id}>
                  <button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--c-primary)]/10" onClick={() => { onChange([...value, p.id]); setQ(""); }}>
                    <b>{p.name}</b> <span className="text-xs text-muted">{p.email}</span>{!access.has(p.id) && <span className="ml-1 text-xs text-subtle">(no access yet)</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {t && matches.length === 0 && <p className="mt-1 text-xs text-subtle">Nobody else matches.</p>}
        </div>
      )}
    </div>
  );
}
