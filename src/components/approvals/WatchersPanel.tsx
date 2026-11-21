"use client";

import { useState } from "react";
import { Eye, Plus, X } from "lucide-react";
import { api, useAction } from "@/components/approvals/api";
import type { AprWatcherForm } from "@/db/approvals-schema";

export type WatcherItem = { id: string; userId: string; name: string; email: string; active: boolean };
export type PersonOption = { id: string; name: string; email: string };

/**
 * The Watchers of one form, on its card in Administrator > Approval Forms: who watches it (each with Remove), and "+ Add watcher", which
 * searches every active hub user by name or email and adds the one picked. A change applies at once.
 */
export function WatchersPanel({ form, label, watchers, people }: { form: AprWatcherForm; label: string; watchers: WatcherItem[]; people: PersonOption[] }) {
  const { run, pending } = useAction();
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const taken = new Set(watchers.map((w) => w.userId));
  const needle = q.trim().toLowerCase();
  const matches = needle
    ? people.filter((p) => !taken.has(p.id) && (p.name.toLowerCase().includes(needle) || p.email.toLowerCase().includes(needle))).slice(0, 8)
    : [];

  const add = (p: PersonOption) =>
    run(() => api("POST", "/api/approvals/watchers", { form, userId: p.id }), `${p.name} now watches the ${label} form`, () => { setQ(""); setAdding(false); });
  const remove = (w: WatcherItem) =>
    run(() => api("DELETE", "/api/approvals/watchers", { form, id: w.id }), `${w.name} no longer watches the ${label} form`);

  return (
    <section className="mt-2 border-t border-line pt-3" aria-label={`Watchers of the ${label} form`} data-testid={`watchers-${form}`}>
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
        <Eye size={15} aria-hidden /> Watchers <span className="text-muted" data-testid={`watchers-${form}-count`}>({watchers.length})</span>
      </h3>
      <p className="mt-0.5 text-xs text-muted">They read, print and export every {label} request, and are told of new ones. They never approve or reject.</p>
      {watchers.length > 0 && (
        <ul className="mt-2 space-y-1">
          {watchers.map((w) => (
            <li key={w.id} className="flex items-center justify-between gap-2 text-sm" data-testid="watcher-row">
              <span className="min-w-0">
                <span className="font-medium text-ink">{w.name}</span>
                {!w.active && <span className="badge badge-neutral ml-1.5">Inactive</span>}
                <span className="block truncate text-xs text-muted">{w.email}</span>
              </span>
              <button type="button" className="btn btn-ghost btn-sm shrink-0" disabled={pending} onClick={() => remove(w)} aria-label={`Remove ${w.name} as a watcher of the ${label} form`}>
                <X size={13} aria-hidden /> Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <div className="mt-2">
          <input
            className="input w-full" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search hub users by name or email"
            aria-label={`Search hub users to watch the ${label} form`} data-testid={`watchers-${form}-search`}
            onKeyDown={(e) => { if (e.key === "Escape") { setAdding(false); setQ(""); } if (e.key === "Enter" && matches[0]) { e.preventDefault(); add(matches[0]); } }}
          />
          {needle && (
            <ul className="mt-1 max-h-56 overflow-auto rounded-md border border-line bg-white" role="listbox" aria-label="Matching hub users">
              {matches.length === 0 && <li className="px-3 py-2 text-sm text-muted">No one matches (or they already watch it).</li>}
              {matches.map((p) => (
                <li key={p.id}>
                  <button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-alt disabled:opacity-60" disabled={pending} onClick={() => add(p)} data-testid="watcher-option">
                    <span className="font-medium text-ink">{p.name}</span> <span className="text-xs text-muted">{p.email}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="btn btn-ghost btn-sm mt-1" onClick={() => { setAdding(false); setQ(""); }}>Cancel</button>
        </div>
      ) : (
        <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={() => setAdding(true)} data-testid={`watchers-${form}-add`}>
          <Plus size={14} aria-hidden /> Add watcher
        </button>
      )}
    </section>
  );
}
