"use client";

import type { RoleHolder } from "@/components/people/RoleOptions";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, KeyRound, Mail, Plus, Search, ShieldCheck, Trash2, Upload, Users, X } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { AddPersonDialog, AssignDialog, LinksDialog, ResetDialog, type Catalog, type Manager, type Option, type Template } from "@/components/people/PeopleDialogs";
import { useToast } from "@/components/Toast";
import { deletePerson, sendSetupLinks, setPersonActive, type LinkResult } from "@/actions/people";
import { STATUS_BADGE, STATUS_LABEL } from "@/lib/account-status";
import { formatIST, roleBadge, roleLabel } from "@/lib/format";
import type { PeopleFilters, PersonRow } from "@/lib/people";

type Capabilities = { create: boolean; importPeople: boolean; changeRole: boolean; toggleActive: boolean; remove: boolean; invite: boolean; assign: boolean };
export type DirectoryProps = {
  /** Where the profile pages live: /administrator/users or /team. */
  base: string;
  result: { rows: PersonRow[]; total: number; pages: number; page: number };
  filters: PeopleFilters;
  options: { branches: Option[]; teams: Option[]; apps: Option[]; managers: Manager[]; roleHolders?: RoleHolder[] };
  catalog: Catalog;
  templates: Template[];
  caps: Capabilities;
  domains: string;
  meId: string;
};

const PAGE = 25;
const SORT_LABEL: Record<PeopleFilters["sort"], string> = { name: "Name", email: "Email", lastLogin: "Last sign-in", created: "Newest" };

/** The people directory: search, filters, sorting and paging are all done by the server, so it stays quick with thousands of people. */
export function PeopleDirectory({ base, result, filters, options, catalog, templates, caps, domains, meId }: DirectoryProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const toast = useToast();
  const confirm = useConfirm();
  const [navigating, startNav] = useTransition();
  const [busy, startBusy] = useTransition();
  const [selected, setSelected] = useState<string[]>([]);
  const [allMatching, setAllMatching] = useState(false);
  const [adding, setAdding] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [resetting, setResetting] = useState<{ id: string; name: string } | null>(null);
  const [links, setLinks] = useState<LinkResult[] | null>(null);
  const [q, setQ] = useState(filters.q ?? "");

  const query = params.toString();
  const push = (mutate: (p: URLSearchParams) => void) => {
    const p = new URLSearchParams(params.toString());
    mutate(p);
    p.delete("page");
    startNav(() => router.push(`${pathname}${p.toString() ? `?${p}` : ""}`));
  };
  const setParam = (k: string, v: string) => push((p) => (v ? p.set(k, v) : p.delete(k)));

  // The search box waits for a pause in typing before asking the server.
  const lastQ = useRef(filters.q ?? "");
  useEffect(() => {
    if (q.trim() === lastQ.current) return;
    const t = setTimeout(() => { lastQ.current = q.trim(); setParam("q", q.trim()); }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  useEffect(() => { setSelected([]); setAllMatching(false); }, [query]);

  const gotoPage = (n: number) => startNav(() => { const p = new URLSearchParams(params.toString()); p.set("page", String(n)); router.push(`${pathname}?${p}`); });
  const sortBy = (key: PeopleFilters["sort"]) => push((p) => { p.set("sort", key); p.set("dir", filters.sort === key && filters.dir === "asc" ? "desc" : "asc"); });
  const active = ["q", "branch", "dept", "team", "role", "status", "app", "manager"].filter((k) => params.get(k));

  const rows = result.rows;
  const pageIds = rows.map((r) => r.id);
  const allOnPage = rows.length > 0 && pageIds.every((id) => selected.includes(id));
  const count = allMatching ? result.total : selected.length;
  const refresh = () => router.refresh();

  // Temporary passwords go to the people ticked on this page (for a new person, or to reset a password). Not available for "everyone matching".
  const sendLinks = () => startBusy(async () => {
    const r = await sendSetupLinks(selected);
    if (!r.ok) return toast.error(r.error);
    setLinks(r.data);
    refresh();
  });

  const th = (label: string, key: PeopleFilters["sort"]) => (
    <th aria-sort={filters.sort === key ? (filters.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="inline-flex items-center gap-1 font-bold uppercase tracking-[0.08em]" onClick={() => sortBy(key)}>
        {label}{filters.sort === key && (filters.dir === "asc" ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden />)}
      </button>
    </th>
  );
  const select = (label: string, key: string, value: string | undefined, list: Option[], all: string) => (
    <select className="input !w-auto !py-2" aria-label={label} value={value ?? ""} onChange={(e) => setParam(key, e.target.value)}>
      <option value="">{all}</option>{list.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Everyone who can sign in, where they sit and which applications they can open. Open a person to see and change everything about them in one place.</p>
        <div className="flex flex-wrap gap-2">
          {caps.create && <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}><Plus size={14} /> Add user</button>}
          {caps.importPeople && <Link className="btn btn-primary btn-sm" href={`${base}/import`}><Upload size={14} /> Bulk add users</Link>}
          {caps.assign && <button className="btn btn-ghost btn-sm" onClick={() => setAssigning(true)}><ShieldCheck size={14} /> Assign applications</button>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="search">
        <label className="relative block w-full sm:w-72">
          <span className="sr-only">Search people</span>
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-subtle" />
          <input className="input !py-2 !pl-10" placeholder="Search name, email or designation" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {select("Filter by branch", "branch", filters.branchId, options.branches, "All branches")}
        {select("Filter by team", "team", filters.teamId, options.teams, "All teams")}
        <select className="input !w-auto !py-2" aria-label="Filter by role" value={filters.role ?? ""} onChange={(e) => setParam("role", e.target.value)}>
          <option value="">All roles</option><option value="super_admin">Super admin</option><option value="expense_admin">Expense admin</option><option value="hr_admin">HR admin</option><option value="admin">Admin</option><option value="member">User</option><option value="dept_lead">Team manager</option><option value="head_admin">Support admin</option>
        </select>
        <select className="input !w-auto !py-2" aria-label="Filter by status" value={filters.status ?? ""} onChange={(e) => setParam("status", e.target.value)}>
          <option value="">Any status</option><option value="active">Active</option><option value="pending">Pending invitation</option><option value="inactive">Inactive</option>
        </select>
        {select("Filter by application", "app", filters.appId, options.apps, "Any application")}
        {active.length > 0 && <button className="btn btn-ghost btn-sm" onClick={() => { setQ(""); lastQ.current = ""; startNav(() => router.push(pathname)); }}><X size={14} /> Clear filters</button>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted" aria-live="polite">
        <span>{navigating ? "Updating…" : `${result.total} ${result.total === 1 ? "person" : "people"}${active.length ? " match" : ""}`}</span>
        <label className="flex items-center gap-2">Sort by
          <select className="input !w-auto !py-1.5" value={filters.sort} onChange={(e) => sortBy(e.target.value as PeopleFilters["sort"])} aria-label="Sort by">
            {(Object.keys(SORT_LABEL) as PeopleFilters["sort"][]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
          </select></label>
      </div>

      {count > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-nav-active px-4 py-2.5 text-sm" role="region" aria-label="Actions for the selected people">
          <b>{count} selected</b>
          {caps.assign && <button className="btn btn-primary btn-sm" onClick={() => setAssigning(true)}><ShieldCheck size={14} /> Assign applications</button>}
          {caps.invite && <button className="btn btn-ghost btn-sm" disabled={busy || allMatching || selected.length === 0} onClick={sendLinks}><Mail size={14} /> Email temporary passwords</button>}
          <button className="btn btn-ghost btn-sm" onClick={() => { setSelected([]); setAllMatching(false); }}>Clear selection</button>
          {allOnPage && !allMatching && result.total > rows.length && (
            <button className="ml-auto text-primary underline" onClick={() => setAllMatching(true)}>Select all {result.total} people matching</button>
          )}
          {allMatching && <span className="ml-auto text-muted">All {result.total} matching people are selected.</span>}
        </div>
      )}

      <div className={`table-wrap ${navigating ? "opacity-60" : ""}`} aria-busy={navigating}>
        <table>
          <thead><tr>
            {(caps.assign || caps.invite) && (
              <th className="w-10"><input type="checkbox" className="h-4 w-4 accent-[var(--c-primary)]" aria-label="Select everyone on this page" checked={allOnPage}
                onChange={(e) => { setAllMatching(false); setSelected(e.target.checked ? [...new Set([...selected, ...pageIds])] : selected.filter((id) => !pageIds.includes(id))); }} /></th>
            )}
            {th("Person", "name")}<th>Role</th><th>Where they sit</th><th>Applications</th><th>Status</th>{th("Last sign-in", "lastLogin")}<th className="text-right">Actions</th>
          </tr></thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className={u.isActive ? "" : "opacity-60"} data-email={u.email}>
                {(caps.assign || caps.invite) && (
                  <td><input type="checkbox" className="h-4 w-4 accent-[var(--c-primary)]" aria-label={`Select ${u.name}`} checked={allMatching || selected.includes(u.id)} disabled={allMatching}
                    onChange={(e) => setSelected((s) => (e.target.checked ? [...s, u.id] : s.filter((id) => id !== u.id)))} /></td>
                )}
                <td>
                  <Link href={`${base}/${u.id}`} className="font-bold text-ink hover:text-primary">{u.name}</Link>{u.designation && <span className="text-xs text-muted"> · {u.designation}</span>}
                  <span className="block text-xs text-muted">{u.email}</span>
                  {u.mainAdmin && u.role !== "head_admin" && <span className="badge badge-neutral mt-1">{u.role === "super_admin" ? "Main admin" : "Main account"}{u.passwordInSettings ? " · password in settings" : ""}</span>}
                </td>
                <td><span className={roleBadge[u.role]}>{roleLabel[u.role]}</span></td>
                <td className="text-xs">
                  {[u.branch, u.team].filter(Boolean).length === 0 && !u.manager ? <span className="text-subtle">—</span> : (
                    <>
                      <span className="block">{u.branch || <span className="text-subtle">—</span>}</span>
                      {u.team && <span className="block text-muted">Team: {u.team}</span>}
                      {u.manager && <span className="block text-muted">Reports to {u.manager}</span>}
                    </>
                  )}
                </td>
                <td>
                  {u.role === "head_admin" ? <span className="text-xs text-muted">All applications</span>
                    : u.apps.length === 0 ? <span className="text-subtle">None</span>
                    : <span className="flex flex-wrap gap-1.5">
                        {u.apps.slice(0, 3).map((a) => <span key={a.id} className={`badge ${a.active ? "" : "badge-neutral line-through"}`} title={a.active ? undefined : "Inactive"}>{a.name}</span>)}
                        {u.apps.length > 3 && <span className="badge badge-neutral" title={u.apps.slice(3).map((a) => a.name).join(", ")}>+{u.apps.length - 3} more</span>}
                      </span>}
                </td>
                <td>
                  {caps.toggleActive && u.id !== meId ? (
                    <button className={`${STATUS_BADGE[u.status]} cursor-pointer`} disabled={busy} title={u.isActive ? "Click to deactivate" : "Click to activate"}
                      onClick={async () => {
                        if (u.isActive && !(await confirm({ title: "Deactivate this user?", confirmLabel: "Deactivate", danger: true, message: `${u.name} will be signed out at once and cannot open anything until you activate them again. Their access settings are kept.${u.passwordInSettings ? " This account is set in the environment settings, so it is switched on again at its next sign-in unless you also remove its settings in Vercel." : ""}` }))) return;
                        startBusy(async () => { const r = await setPersonActive(u.id, !u.isActive); if (r.ok) { toast.success(u.isActive ? "User deactivated and signed out" : "User activated"); refresh(); } else toast.error(r.error); });
                      }}>{STATUS_LABEL[u.status]}</button>
                  ) : <span className={STATUS_BADGE[u.status]} title={u.id === meId ? "You cannot deactivate yourself" : undefined}>{STATUS_LABEL[u.status]}</span>}
                </td>
                <td className="whitespace-nowrap text-xs text-muted">{formatIST(u.lastLoginAt)}</td>
                <td>
                  <div className="flex justify-end gap-1.5">
                    <Link className="chip !p-1.5 text-muted" aria-label={`Manage access for ${u.name}`} title="Open profile and access" href={`${base}/${u.id}`}><ShieldCheck size={14} /></Link>
                    {caps.invite && !u.passwordInSettings && (
                      <button className="chip !p-1.5 text-muted" aria-label={`Reset password for ${u.name}`} title="Reset password" onClick={() => setResetting({ id: u.id, name: u.name })}><KeyRound size={14} /></button>
                    )}
                    {caps.remove && u.id !== meId && (
                      <button className="chip !p-1.5 text-brand-red" aria-label={`Delete ${u.name}`} title="Delete" disabled={busy}
                        onClick={async () => {
                          if (await confirm({ title: "Delete this user?", confirmLabel: "Delete", danger: true,
                            message: `${u.name} (${u.email}) will be removed for good, with their password and their access to applications. Their past activity stays in the log as an unknown user. To stop someone signing in but keep the account, deactivate them instead.${u.passwordInSettings ? " This account is set in the environment settings, so it comes back at its next sign-in unless you also remove its settings in Vercel." : ""}` }))
                            startBusy(async () => { const r = await deletePerson(u.id); if (r.ok) { toast.success("User deleted"); refresh(); } else toast.error(r.error); });
                        }}><Trash2 size={14} /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={9} className="!py-10 text-center text-subtle">
                <Users size={22} className="mx-auto mb-2" aria-hidden />
                {active.length ? "No one matches these filters." : caps.create ? "No users yet. Use Add user or Bulk add users." : "No one is in your team yet."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <nav className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted" aria-label="Pages">
        <span>{result.total === 0 ? "0 people" : `Showing ${(result.page - 1) * PAGE + 1}–${Math.min(result.page * PAGE, result.total)} of ${result.total}`}</span>
        <span className="flex items-center gap-2">
          <button className="btn btn-ghost btn-sm" disabled={result.page <= 1 || navigating} onClick={() => gotoPage(result.page - 1)}>Previous</button>
          <span>Page {result.page} of {result.pages}</span>
          <button className="btn btn-ghost btn-sm" disabled={result.page >= result.pages || navigating} onClick={() => gotoPage(result.page + 1)}>Next</button>
        </span>
      </nav>

      {adding && (
        <AddPersonDialog options={options} catalog={catalog} domains={domains} canPromote={caps.changeRole} onClose={() => setAdding(false)}
          onDone={(r) => {
            setAdding(false);
            if (r.delivery === "manual" || r.delivery === "failed") setLinks([{ id: r.id, name: r.name, email: r.email, ok: true, delivery: r.delivery, link: r.link, message: r.delivery === "failed" ? "The email could not be sent. Pass the link on yourself." : "No email is set up. Pass the link on yourself." }]);
            toast.success(r.delivery === "sent" ? `User created. Their sign-in details were emailed to ${r.email}.` : r.delivery === "none" ? "User created." : "User created. Pass on their temporary password.");
            refresh();
          }} />
      )}
      {assigning && (
        <AssignDialog selection={{ ids: selected, allMatching, filterQuery: query, count }} options={options} catalog={catalog} templates={templates}
          onClose={() => setAssigning(false)} onDone={() => { setAssigning(false); setSelected([]); setAllMatching(false); refresh(); }} />
      )}
      {resetting && <ResetDialog person={resetting} onClose={() => { setResetting(null); refresh(); }} onLinks={setLinks} />}
      {links && <LinksDialog results={links} onClose={() => setLinks(null)} />}
    </div>
  );
}
