"use client";

import Link from "next/link";
import { useState } from "react";
import { api, useAction } from "@/components/approvals/api";
import { MoneyInput } from "@/components/approvals/FormFields";
import { formatINR, parseINR } from "@/lib/approvals/format";

export type BudgetLine = { categoryId: string; name: string; allocatedPaise: number | null; usedPaise: number; pendingPaise: number; updatedByName: string | null };

const money = (p: number) => formatINR(p, { symbol: true });

/**
 * The Budgets page: every expense category with the budget set for the year, what approved requests have used, what waits for approval,
 * and what is left. The Director General (and the Support Admin) type a budget and save it; used and left are worked out, never typed.
 */
export function BudgetsEditor({ financialYear, years, lines }: { financialYear: string; years: string[]; lines: BudgetLine[] }) {
  const { run, pending } = useAction();
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.categoryId, l.allocatedPaise == null ? "" : formatINR(l.allocatedPaise)])));
  const [filter, setFilter] = useState("");
  const save = (l: BudgetLine) => {
    const text = (draft[l.categoryId] ?? "").trim();
    const paise = text ? parseINR(text) : null;
    if (text && paise === null) return;
    run(() => api("PUT", "/api/approvals/budgets", { financialYear, categoryId: l.categoryId, allocatedPaise: paise }), paise == null ? "Budget removed" : "Budget saved");
  };
  const shown = lines.filter((l) => !filter.trim() || l.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const totals = lines.reduce((t, l) => ({ allocated: t.allocated + (l.allocatedPaise ?? 0), used: t.used + l.usedPaise, pending: t.pending + l.pendingPaise }), { allocated: 0, used: 0, pending: 0 });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block"><span className="label-xs mb-1 block">Financial year</span>
          <span className="flex flex-wrap gap-2">
            {years.map((y) => <Link key={y} href={`/approvals/budgets?fy=${y}`} className={`btn btn-sm ${y === financialYear ? "btn-primary" : "btn-ghost"}`}>{y}</Link>)}
          </span>
        </label>
        <label className="ml-auto block"><span className="sr-only">Find a category</span>
          <input className="input w-64" type="search" placeholder="Find a category" value={filter} onChange={(e) => setFilter(e.target.value)} /></label>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="glass !rounded-md p-4"><p className="label-xs">Total budget {financialYear}</p><p className="mt-1 text-xl font-bold text-ink">{money(totals.allocated)}</p></div>
        <div className="glass !rounded-md p-4"><p className="label-xs">Used (approved)</p><p className="mt-1 text-xl font-bold text-ink">{money(totals.used)}</p></div>
        <div className="glass !rounded-md p-4"><p className="label-xs">Waiting for approval</p><p className="mt-1 text-xl font-bold text-ink">{money(totals.pending)}</p></div>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Category</th><th>Budget</th><th className="text-right">Used</th><th className="hidden text-right md:table-cell">Waiting</th><th className="text-right">Left</th><th className="hidden md:table-cell">Used so far</th></tr></thead>
          <tbody>
            {shown.map((l) => {
              const left = l.allocatedPaise == null ? null : l.allocatedPaise - l.usedPaise;
              const pct = l.allocatedPaise ? Math.min(100, Math.round((l.usedPaise / l.allocatedPaise) * 100)) : 0;
              const changed = (draft[l.categoryId] ?? "") !== (l.allocatedPaise == null ? "" : formatINR(l.allocatedPaise));
              return (
                <tr key={l.categoryId}>
                  <td className="font-semibold">{l.name}{l.updatedByName && <span className="block text-xs font-normal text-[var(--z-muted)]">set by {l.updatedByName}</span>}</td>
                  <td className="min-w-56">
                    <span className="flex items-center gap-2">
                      <MoneyInput id={`budget-${l.categoryId}`} value={draft[l.categoryId] ?? ""} onChange={(v) => setDraft((d) => ({ ...d, [l.categoryId]: v }))} />
                      <button type="button" className="btn btn-primary btn-sm" disabled={pending || !changed} onClick={() => save(l)}>Save</button>
                    </span>
                  </td>
                  <td className="whitespace-nowrap text-right">{money(l.usedPaise)}</td>
                  <td className="hidden whitespace-nowrap text-right md:table-cell">{money(l.pendingPaise)}</td>
                  <td className={`whitespace-nowrap text-right font-bold ${left != null && left < 0 ? "zf-neg" : ""}`}>{left == null ? <span className="font-normal text-[var(--z-muted)]">No budget</span> : money(left)}</td>
                  <td className="hidden min-w-32 md:table-cell">{l.allocatedPaise ? <span className="zbar" data-level={pct >= 100 ? "over" : pct >= 80 ? "warn" : undefined}><span style={{ width: `${pct}%` }} /></span> : null}</td>
                </tr>
              );
            })}
            {shown.length === 0 && <tr><td colSpan={6} className="text-[var(--z-muted)]">No categories match.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-[var(--z-muted)]">Used is the total of the approved expense requests of each category in {financialYear}; a rejected or withdrawn request never counts. Clear a budget and save to remove it.</p>
    </div>
  );
}
