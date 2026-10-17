"use client";

import { api, useAction } from "@/components/approvals/api";
import { ActiveToggle } from "@/components/approvals/shared-ui";
import { formatINR } from "@/lib/approvals/format";
import type { RuleRow } from "@/lib/approvals/rules";

type Person = { id: string; name: string; email: string };

const TITLE: Record<RuleRow["requestType"], { title: string; note: string }> = {
  hr: { title: "HR requests", note: "Approved by the Director General. Leave Reviewer empty to send requests straight to the DG." },
  expenditure_large: { title: "Expenditure: above the limit", note: "Approved by the Director General. Leave Reviewer empty to send requests straight to the DG." },
  expenditure_small: { title: "Expenses: below the limit", note: "Approved by the person named here (the below-limit approver)." },
};

/** Who approves what. Each change saves at once and applies to requests submitted from then on; requests already in progress keep their approvers. */
export function RulesManager({ rules, people, thresholdPaise }: { rules: RuleRow[]; people: Person[]; thresholdPaise: number }) {
  const { run, pending } = useAction();
  const types = (["hr", "expenditure_large", "expenditure_small"] as const).filter((t) => rules.some((r) => r.requestType === t));
  const limit = formatINR(thresholdPaise, { symbol: true }).replace(/\.00$/, "");

  const setApprover = (r: RuleRow, userId: string) =>
    run(() => api("PATCH", `/api/approvals/rules/${r.id}`, { approverUserId: userId || null }), userId ? "Approver saved" : "Approver cleared");
  const setActive = (r: RuleRow) => run(() => api("PATCH", `/api/approvals/rules/${r.id}`, { active: !r.active }), r.active ? "Step turned off" : "Step turned on");

  return (
    <div className="space-y-8">
      <p className="apr-notice max-w-3xl">
        One person per step, in order. A step with nobody named is skipped. Nobody can approve their own request: if the requester is named on a step, that step goes to the next person, or the request cannot be submitted.
        The limit between the two expenditure forms is {limit} (see Settings).
      </p>
      {types.map((t) => (
        <section key={t} aria-labelledby={`rules-${t}`}>
          <h2 id={`rules-${t}`}>{TITLE[t].title}</h2>
          <p className="mb-3 text-sm text-[var(--z-muted)]">{TITLE[t].note}</p>
          <div className="table-wrap max-w-3xl">
            <table>
              <thead><tr><th>Step</th><th>Approver</th><th>Active</th></tr></thead>
              <tbody>
                {rules.filter((r) => r.requestType === t).map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap"><b>{r.stepNo}.</b> {r.stepLabel}</td>
                    <td>
                      <select
                        className="input w-full max-w-xs" aria-label={`Approver for ${TITLE[t].title}, step ${r.stepNo}`} disabled={pending}
                        value={r.approverUserId ?? ""} onChange={(e) => setApprover(r, e.target.value)}
                      >
                        <option value="">Nobody (skip this step)</option>
                        {r.approverUserId && !people.some((p) => p.id === r.approverUserId) && <option value={r.approverUserId}>{r.approverName}</option>}
                        {people.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.email})</option>)}
                      </select>
                    </td>
                    <td><ActiveToggle active={r.active} onToggle={() => setActive(r)} disabled={pending} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
