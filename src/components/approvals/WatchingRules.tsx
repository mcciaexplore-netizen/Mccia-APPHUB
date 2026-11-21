"use client";

import { useState } from "react";
import { Eye, Plus, X } from "lucide-react";
import { api, useAction } from "@/components/approvals/api";
import type { AprWatcherForm } from "@/db/approvals-schema";
import { WATCH_FORMS, WATCH_FORM_TITLE, formHasCategories } from "@/lib/approvals/watching";

export type WatchingRuleItem = { id: string; form: AprWatcherForm; categoryId: string | null; categoryName: string | null };

/**
 * "Watching" on a person's page in Administrator > Users, for the Support Admin: the approval types (and, for Expenditure, the expense
 * categories) this person may view without approving. One row per rule; the same type can be added again with another category. "+ Add"
 * opens a new row: picking HR Approval or Budget saves it at once (always "All"); Expenditure asks for the category ("All" or one) and saves
 * on that choice. × removes a row at once.
 */
export function WatchingRules({ userId, personName, rules, categories }: {
  userId: string; personName: string; rules: WatchingRuleItem[] | null; categories: { id: string; name: string }[];
}) {
  const { run, pending } = useAction();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<AprWatcherForm | "">("");

  const save = (f: AprWatcherForm, categoryId: string | null) =>
    run(() => api("POST", "/api/approvals/watchers", { userId, form: f, categoryId }), "Watching saved", () => { setAdding(false); setForm(""); });
  const remove = (r: WatchingRuleItem) => run(() => api("DELETE", "/api/approvals/watchers", { userId, id: r.id }), "Removed from Watching");
  const pickForm = (v: string) => {
    const f = v as AprWatcherForm | "";
    setForm(f);
    if (f && !formHasCategories(f)) save(f, null); // HR and Budget have no category: "All", saved straight away
  };

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
          <div className="table-wrap mt-3">
            <table>
              <thead><tr><th>Approval Type</th><th>Category</th><th className="w-20 text-right">Remove</th></tr></thead>
              <tbody>
                {rules.length === 0 && !adding && <tr><td colSpan={3} className="py-4 text-center text-sm text-subtle">Not watching anything.</td></tr>}
                {rules.map((r) => (
                  <tr key={r.id} data-testid="watching-row">
                    <td>{WATCH_FORM_TITLE[r.form]}</td>
                    <td>{r.categoryName ?? "All"}</td>
                    <td className="text-right">
                      <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => remove(r)} aria-label={`Remove ${WATCH_FORM_TITLE[r.form]} (${r.categoryName ?? "All"})`}>
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
          {!adding && <button type="button" className="btn btn-ghost btn-sm mt-3" onClick={() => setAdding(true)} data-testid="watching-add"><Plus size={14} aria-hidden /> Add</button>}
        </>
      )}
    </section>
  );
}
