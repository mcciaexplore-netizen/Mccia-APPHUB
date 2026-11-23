"use client";

import { useMemo, useState } from "react";
import { Eye, Plus, Search, X } from "lucide-react";
import { api, useAction } from "@/components/approvals/api";
import type { AprWatcherForm } from "@/db/approvals-schema";
import { WATCH_FORMS, WATCH_FORM_TITLE, formHasCategories } from "@/lib/approvals/watching";

export type WatchingRuleItem = { id: string; form: AprWatcherForm; categoryId: string | null; categoryName: string | null };
export type WatchedUserItem = { id: string; userId: string; name: string; email: string; active: boolean };
type Person = { id: string; name: string; email: string };

/**
 * "Watching" on a person's page in Administrator > Users, for the Support Admin. Two kinds of rule, both read only for the watcher:
 *   By approval type: the approval types (and, for Expenditure, the expense categories) this person may view. "+ Add approval type" opens a
 *     new row: HR Approval or Budget saves at once ("All"); Expenditure asks for the category ("All" or one) and saves on that choice.
 *   By user: every request a chosen person submits, of any type. "+ Add user" opens a search over the hub's people (name or email); picking
 *     one adds them at once, and several can be added in a row.
 * × removes a rule at once.
 */
export function WatchingRules({ userId, personName, rules, categories, people }: {
  userId: string;
  personName: string;
  rules: { types: WatchingRuleItem[]; users: WatchedUserItem[] | null } | null;
  categories: { id: string; name: string }[];
  people: Person[];
}) {
  const { run, pending } = useAction();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<AprWatcherForm | "">("");
  const [addingUser, setAddingUser] = useState(false);
  const [q, setQ] = useState("");

  const save = (f: AprWatcherForm, categoryId: string | null) =>
    run(() => api("POST", "/api/approvals/watchers", { userId, form: f, categoryId }), "Watching saved", () => { setAdding(false); setForm(""); });
  const remove = (id: string) => run(() => api("DELETE", "/api/approvals/watchers", { userId, id }), "Removed from Watching");
  const watchUser = (p: Person) =>
    run(() => api("POST", "/api/approvals/watchers", { userId, watchedUserId: p.id }), `Watching all approvals from ${p.name}`, () => setQ(""));
  const pickForm = (v: string) => {
    const f = v as AprWatcherForm | "";
    setForm(f);
    if (f && !formHasCategories(f)) save(f, null); // HR and Budget have no category: "All", saved straight away
  };

  const watchedUsers = rules?.users ?? null;
  const term = q.trim().toLowerCase();
  const hits = useMemo(() => {
    if (term.length < 2) return [];
    const taken = new Set((watchedUsers ?? []).map((u) => u.userId));
    return people.filter((p) => p.id !== userId && !taken.has(p.id) && (p.name.toLowerCase().includes(term) || p.email.toLowerCase().includes(term))).slice(0, 8);
  }, [term, people, watchedUsers, userId]);

  return (
    <section className="glass !rounded-md p-5 sm:p-6" aria-labelledby="watching-title" data-testid="watching-rules">
      <h3 id="watching-title" className="flex items-center gap-2 text-lg"><Eye size={18} aria-hidden /> Watching</h3>
      <p className="mt-1 text-sm text-muted">
        Approvals {personName} may view without approving them: they see these requests under All Approvals, can open, print and export them, and are told of new ones.
      </p>
      {rules === null ? (
        <p className="mt-3 text-sm text-subtle">Watching cannot be set yet: the database update for watchers (apply-0043) has not been run.</p>
      ) : (
        <>
          <h4 className="mt-5 text-xs font-bold uppercase tracking-wider text-subtle">By approval type</h4>
          <div className="table-wrap mt-2">
            <table>
              <thead><tr><th>Approval Type</th><th>Category</th><th className="w-20 text-right">Remove</th></tr></thead>
              <tbody>
                {rules.types.length === 0 && !adding && <tr><td colSpan={3} className="py-4 text-center text-sm text-subtle">No approval types.</td></tr>}
                {rules.types.map((r) => (
                  <tr key={r.id} data-testid="watching-row">
                    <td>{WATCH_FORM_TITLE[r.form]}</td>
                    <td>{r.categoryName ?? "All"}</td>
                    <td className="text-right">
                      <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => remove(r.id)} aria-label={`Remove ${WATCH_FORM_TITLE[r.form]} (${r.categoryName ?? "All"})`}>
                        <X size={14} aria-hidden />
                      </button>
                    </td>
                  </tr>
                ))}
                {adding && (
                  <tr data-testid="watching-new">
                    <td>
                      <select className="input" value={form} onChange={(e) => pickForm(e.target.value)} disabled={pending} aria-label="Approval type" data-testid="watching-form" autoFocus>
                        <option value="">Choose…</option>
                        {WATCH_FORMS.map((f) => <option key={f} value={f}>{WATCH_FORM_TITLE[f]}</option>)}
                      </select>
                    </td>
                    <td>
                      {form && formHasCategories(form) ? (
                        <select className="input" defaultValue="" onChange={(e) => e.target.value && save(form, e.target.value === "all" ? null : e.target.value)} disabled={pending} aria-label="Category" data-testid="watching-category">
                          <option value="">Choose…</option>
                          <option value="all">All</option>
                          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      ) : <span className="text-sm text-subtle">{form ? "All" : "—"}</span>}
                    </td>
                    <td className="text-right">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setAdding(false); setForm(""); }} aria-label="Cancel"><X size={14} aria-hidden /></button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {!adding && <button type="button" className="btn btn-ghost btn-sm mt-3" onClick={() => setAdding(true)} data-testid="watching-add"><Plus size={14} aria-hidden /> Add approval type</button>}

          <h4 className="mt-6 text-xs font-bold uppercase tracking-wider text-subtle">By user</h4>
          {watchedUsers === null ? (
            <p className="mt-2 text-sm text-subtle">Watching by user cannot be set yet: the database update for it (apply-0047) has not been run.</p>
          ) : (
            <div className="mt-2" data-testid="watching-users">
              <p className="text-sm text-muted">Watch all approvals from:</p>
              <ul className="mt-2 divide-y divide-line rounded-md border border-line">
                {watchedUsers.length === 0 && <li className="px-3 py-3 text-center text-sm text-subtle">Nobody yet.</li>}
                {watchedUsers.map((u) => (
                  <li key={u.id} className="flex items-center gap-3 px-3 py-2" data-testid="watching-user-row">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-ink">{u.name}</span>
                      <span className="block truncate text-xs text-subtle">{u.email}{u.active ? "" : " · no longer active"}</span>
                    </span>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => remove(u.id)} aria-label={`Stop watching ${u.name}`}>
                      <X size={14} aria-hidden /> Remove
                    </button>
                  </li>
                ))}
              </ul>
              {addingUser ? (
                <div className="mt-3 max-w-md">
                  <div className="flex items-center gap-2">
                    <span className="relative flex-1">
                      <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
                      <input
                        className="input !pl-8"
                        type="search"
                        placeholder="Search by name or email"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        aria-label="Search for a person to watch"
                        data-testid="watching-user-search"
                        autoFocus
                      />
                    </span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setAddingUser(false); setQ(""); }} aria-label="Done adding people"><X size={14} aria-hidden /></button>
                  </div>
                  {term.length >= 2 && (
                    <ul className="mt-1 overflow-hidden rounded-md border border-line bg-card" aria-label="Matching people">
                      {hits.length === 0 && <li className="px-3 py-2 text-sm text-subtle">No one found.</li>}
                      {hits.map((p) => (
                        <li key={p.id}>
                          <button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-alt" disabled={pending} onClick={() => watchUser(p)} data-testid="watching-user-hit">
                            <span className="font-semibold text-ink">{p.name}</span> <span className="text-xs text-subtle">{p.email}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {term.length < 2 && <p className="mt-1 text-xs text-subtle">Type at least two letters.</p>}
                </div>
              ) : (
                <button type="button" className="btn btn-ghost btn-sm mt-3" onClick={() => setAddingUser(true)} data-testid="watching-add-user"><Plus size={14} aria-hidden /> Add user</button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
