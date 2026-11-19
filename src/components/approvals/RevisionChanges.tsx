"use client";

import { useState } from "react";
import { GitCompareArrows } from "lucide-react";
import { BALANCE_LABEL, compareVersions, comparisonPairs, type BudgetBalance, type BudgetLine, type LineChange } from "@/lib/approvals/budget";
import { formatINR } from "@/lib/approvals/format";
import type { AprRequestStatus } from "@/db/approvals-schema";

/** A version of the budget as the panel needs it (oldest first, the original at 0). */
export type ChangeVersion = {
  id: string;
  label: string;
  status: AprRequestStatus;
  reason: string | null;
  amountPaise: number | null;
  incomeLines: BudgetLine[];
  expenseLines: BudgetLine[];
  vendorLines: BudgetLine[];
};

const money = (p: number) => formatINR(p, { symbol: true });
const STATUS_TEXT: Record<string, string> = { pending: "Pending approval", returned: "Pending approval", approved: "Approved", rejected: "Rejected", withdrawn: "Withdrawn", draft: "Draft" };
const STATUS_TONE: Record<string, string> = { pending: "badge-amber", returned: "badge-amber", approved: "badge-green", rejected: "badge-red", withdrawn: "badge-neutral", draft: "badge-neutral" };

/** How each kind of change looks: its sign, its word and its colour (added green, removed red, changed amber, the same grey). */
const KIND = {
  added: { sign: "+", word: "Added", tone: "text-green-700" },
  removed: { sign: "−", word: "Removed", tone: "text-red-700" },
  changed: { sign: "~", word: "Changed", tone: "text-[var(--z-amber)]" },
  unchanged: { sign: "=", word: "Same", tone: "text-[var(--z-muted)]" },
} as const;

function Change({ c }: { c: LineChange }) {
  const k = KIND[c.kind];
  return (
    <li className={k.tone} data-testid={`change-${c.kind}`}>
      {c.kind === "changed" ? (
        <>
          <span className="font-semibold">{k.sign} {k.word}:</span> {c.name}
          <span className="block pl-4 text-[var(--z-muted)]">Was: {money(c.beforePaise ?? 0)}</span>
          <span className="block pl-4">Now: {money(c.afterPaise ?? 0)}</span>
        </>
      ) : (
        <span className="flex justify-between gap-3">
          <span><span className="font-semibold">{k.sign} {k.word}:</span> {c.name}</span>
          <span className="whitespace-nowrap">{money((c.kind === "removed" ? c.beforePaise : c.afterPaise) ?? 0)}</span>
        </span>
      )}
    </li>
  );
}

function Section({ title, changes }: { title: string; changes: LineChange[] }) {
  // What changed first, then what stayed the same.
  const order = { added: 0, changed: 1, removed: 2, unchanged: 3 } as const;
  const sorted = [...changes].sort((a, b) => order[a.kind] - order[b.kind]);
  return (
    <section className="space-y-1" data-testid={`changes-${title.toLowerCase()}`}>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--z-muted)]">{title}</h4>
      {sorted.length === 0 ? <p className="text-sm text-[var(--z-muted)]">None in either version</p> : <ul className="space-y-1 text-sm">{sorted.map((c, i) => <Change key={i} c={c} />)}</ul>}
    </section>
  );
}

const balanceText = (b: BudgetBalance) => `${BALANCE_LABEL[b.kind]} ${money(b.amountPaise)}`;

/**
 * "Revision Changes": what changed from one version of the budget to another (rows added, removed or changed, the Total Budget Requested,
 * the Surplus / Deficit), with the later version's reason and status. With more than one revision, any comparison can be picked; it
 * starts on the one that ends at the version of this page (or, on the original's page, at the latest revision).
 */
export function RevisionChanges({ versions, currentId }: { versions: ChangeVersion[]; currentId: string }) {
  const pairs = comparisonPairs(versions.length);
  const here = versions.findIndex((v) => v.id === currentId);
  const start = Math.max(0, pairs.findIndex(([from, to]) => to === (here > 0 ? here : versions.length - 1) && from === to - 1));
  const [picked, setPicked] = useState(start);
  if (pairs.length === 0) return null;
  const [fromIdx, toIdx] = pairs[picked] ?? pairs[0];
  const from = versions[fromIdx], to = versions[toIdx];
  const c = compareVersions(from, to);
  const up = c.total.changePaise > 0, down = c.total.changePaise < 0;
  const pending = to.status === "pending" || to.status === "returned";

  return (
    <aside className="apr-no-print rounded-md border border-[var(--z-line)] bg-[var(--c-card)] p-4 shadow-sm" aria-labelledby="revision-changes" data-testid="revision-changes">
      <div className="flex items-start justify-between gap-2">
        <h3 id="revision-changes" className="flex items-center gap-2 text-base font-bold"><GitCompareArrows size={18} aria-hidden /> Revision Changes</h3>
        {pending && <span className="badge badge-amber" data-testid="changes-pending">Pending approval</span>}
      </div>
      {pairs.length > 1 ? (
        <label className="mt-2 block text-sm">
          <span className="sr-only">Versions compared</span>
          <span className="text-[var(--z-muted)]">Comparing: </span>
          <select className="input mt-1 w-full" value={picked} onChange={(e) => setPicked(Number(e.target.value))} data-testid="changes-pick">
            {pairs.map(([f, t], i) => <option key={i} value={i}>{versions[f].label} → {versions[t].label}</option>)}
          </select>
        </label>
      ) : (
        <p className="mt-1 text-sm text-[var(--z-muted)]" data-testid="changes-pair">{from.label} → {to.label}</p>
      )}

      <div className="mt-4 space-y-4 border-t border-[var(--z-line)] pt-4">
        <Section title="Income" changes={c.income} />
        <Section title="Expenses" changes={c.expenses} />
        {/* Vendors are no longer asked for: shown only when a version compared still has some. */}
        {c.vendors.length > 0 && <Section title="Vendors" changes={c.vendors} />}

        <section className="space-y-2 text-sm" data-testid="changes-summary">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--z-muted)]">Budget Summary</h4>
          <div>
            <p className="font-semibold">Total Budget:</p>
            <p className="pl-4 text-[var(--z-muted)]">Was: {money(c.total.beforePaise)}</p>
            <p className="pl-4">Now: {money(c.total.afterPaise)}</p>
            <p className={`pl-4 font-semibold ${up ? "text-red-700" : down ? "text-green-700" : "text-[var(--z-muted)]"}`} data-testid="changes-total">
              Change: {up ? "+" : down ? "−" : ""}{money(Math.abs(c.total.changePaise))}
            </p>
          </div>
          <div>
            <p className="font-semibold">Surplus/Deficit:</p>
            <p className="pl-4 text-[var(--z-muted)]">Was: {balanceText(c.balance.before)}</p>
            <p className="pl-4" data-testid="changes-balance">Now: {balanceText(c.balance.after)}</p>
          </div>
        </section>

        {to.reason && (
          <section className="text-sm">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--z-muted)]">Reason for revision</h4>
            <p className="mt-1 whitespace-pre-wrap" data-testid="changes-reason">&ldquo;{to.reason}&rdquo;</p>
          </section>
        )}
        <p className="text-sm">Status: <span className={`badge ${STATUS_TONE[to.status] ?? "badge-neutral"}`} data-testid="changes-status">{STATUS_TEXT[to.status] ?? to.status}</span></p>
      </div>
    </aside>
  );
}
