"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { api } from "@/components/approvals/api";
import { useToast } from "@/components/Toast";
import { FormActions, MoneyInput, Row, SearchSelect, TextArea, TextInput, type Option } from "@/components/approvals/FormFields";
import { INCOME_LINES, cleanVendors, netBudget, totalIncome, type BudgetIncome } from "@/lib/approvals/budget";
import { formatINR, parseINR } from "@/lib/approvals/format";

type Errors = Record<string, string>;
type IncomeText = Record<keyof BudgetIncome, string>;

const EMPTY_INCOME: IncomeText = { sponsorshipPaise: "", stallPaise: "", participantsPaise: "", otherPaise: "" };
const moneyText = (p: number | null | undefined) => (p == null ? "" : formatINR(p));
const show = (p: number) => formatINR(p, { symbol: true });

/** What a revision starts from: the budget in force, as it was approved. */
export type BudgetRevisionStart = {
  /** The request the revision is asked for from (the original budget, or any revision of it). */
  requestId: string;
  requestNo: string;
  eventName: string;
  departmentName: string;
  financialYear: string;
  /** The budget in force now. */
  budgetPaise: number;
  income: BudgetIncome;
  vendors: string[];
  approverUserId: string | null;
};

export type BudgetFormProps = {
  /** Everyone in the hub who can approve it (the person filling it in is left out: nobody approves their own budget). */
  people: Option[];
  /** New budgets: the hub's departments and the financial years to choose from. */
  departments?: Option[];
  financialYears?: string[];
  defaultFinancialYear?: string;
  /** Set to ask for a revision of an approved budget instead of raising a new one. */
  revision?: BudgetRevisionStart;
};

/**
 * The Budget Approval form, and the same form for a revision of an approved budget. Total income and Net budget (budget amount − total
 * income) are worked out as the person types and cannot be edited. Vendors: as many as needed, each with its own Remove. The approver is one
 * person, picked from everyone in the hub by typing their name.
 */
export function BudgetForm({ people, departments = [], financialYears = [], defaultFinancialYear = "", revision }: BudgetFormProps) {
  const router = useRouter();
  const toast = useToast();
  const startIncome: IncomeText = revision
    ? { sponsorshipPaise: moneyText(revision.income.sponsorshipPaise), stallPaise: moneyText(revision.income.stallPaise), participantsPaise: moneyText(revision.income.participantsPaise), otherPaise: moneyText(revision.income.otherPaise) }
    : EMPTY_INCOME;
  const startApprover = revision?.approverUserId && people.some((p) => p.value === revision.approverUserId) ? revision.approverUserId : "";
  const startVendors = revision?.vendors.length ? revision.vendors : [""];

  const [eventName, setEventName] = useState("");
  const [description, setDescription] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [financialYear, setFinancialYear] = useState(defaultFinancialYear);
  const [income, setIncome] = useState<IncomeText>(startIncome);
  const [vendors, setVendors] = useState<string[]>(startVendors);
  const [budget, setBudget] = useState("");
  const [reason, setReason] = useState("");
  const [approverId, setApproverId] = useState(startApprover);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // What the boxes hold, in paise: an empty income line is nothing; one that is not a sum is flagged on submit.
  const incomePaise: BudgetIncome = {
    sponsorshipPaise: income.sponsorshipPaise.trim() ? parseINR(income.sponsorshipPaise) : null,
    stallPaise: income.stallPaise.trim() ? parseINR(income.stallPaise) : null,
    participantsPaise: income.participantsPaise.trim() ? parseINR(income.participantsPaise) : null,
    otherPaise: income.otherPaise.trim() ? parseINR(income.otherPaise) : null,
  };
  const budgetPaise = budget.trim() ? parseINR(budget) : null;
  const total = totalIncome(incomePaise);
  const net = budgetPaise == null ? null : netBudget(budgetPaise, incomePaise);

  const reset = () => {
    if (revision) { router.push(`/approvals/requests/${revision.requestId}?app=hr`); return; }
    setEventName(""); setDescription(""); setDepartmentId(""); setFinancialYear(defaultFinancialYear); setIncome(EMPTY_INCOME); setVendors([""]);
    setBudget(""); setApproverId(""); setErrors({}); setFormError(null);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err: Errors = {};
    if (!revision) {
      if (!eventName.trim()) err.eventName = "Enter the event name.";
      if (!description.trim()) err.description = "Enter a description.";
      if (!departmentId) err.department = "Choose the department.";
      if (!financialYear) err.financialYear = "Choose the financial year.";
    } else if (!reason.trim()) err.reason = "Say why the budget has to be revised.";
    for (const l of INCOME_LINES) {
      const v = incomePaise[l.key];
      if (income[l.key].trim() && (v === null || v < 0)) err[l.key] = "Enter a sum of 0 or more, with at most 2 decimals.";
    }
    if (budgetPaise === null || budgetPaise <= 0) err.budget = "Enter the budget amount, above 0, with at most 2 decimals.";
    if (!approverId) err.approver = "Choose the approver.";
    setErrors(err);
    if (Object.keys(err).length) return;

    setSubmitting(true);
    setFormError(null);
    const common = { income: incomePaise, vendors: cleanVendors(vendors), budgetPaise, approverUserId: approverId };
    const r = revision
      ? await api<{ id: string; requestNo: string }>("POST", `/api/approvals/requests/${revision.requestId}/revise`, { ...common, reason })
      : await api<{ id: string; requestNo: string }>("POST", "/api/approvals/requests", { kind: "budget", ...common, eventName, description, departmentId, financialYear });
    if (!r.ok) { setSubmitting(false); setFormError(r.error); toast.error(r.error); return; }
    toast.success(revision ? `Budget revision submitted: ${r.data.requestNo}` : `Budget submitted: ${r.data.requestNo}`);
    router.push(`/approvals/requests/${r.data.id}?app=hr&submitted=1`);
    router.refresh();
  };

  const setLine = (k: keyof BudgetIncome, v: string) => setIncome((x) => ({ ...x, [k]: v }));

  return (
    <form className="zf" onSubmit={onSubmit} noValidate data-testid="budget-form">
      {revision ? (
        <>
          <div className="apr-notice mb-4 max-w-3xl" role="status">
            <p><b>Revising {revision.requestNo}: {revision.eventName}.</b> The budget in force is {show(revision.budgetPaise)}. The revision needs a fresh approval; until it is approved, {show(revision.budgetPaise)} stays in force.</p>
          </div>
          <Row label="Event name"><p className="py-2">{revision.eventName}</p></Row>
          <Row label="Department"><p className="py-2">{revision.departmentName}</p></Row>
          <Row label="Financial year"><p className="py-2">{revision.financialYear}</p></Row>
          <Row label="Current budget"><p className="py-2">{show(revision.budgetPaise)}</p></Row>
        </>
      ) : (
        <>
          <Row label="Event name" required htmlFor="bud-event" error={errors.eventName}><TextInput id="bud-event" value={eventName} onChange={setEventName} invalid={!!errors.eventName} maxLength={200} /></Row>
          <Row label="Description" required htmlFor="bud-desc" error={errors.description}><TextArea id="bud-desc" value={description} onChange={setDescription} /></Row>
          <Row label="Department" required htmlFor="bud-dept" error={errors.department}><SearchSelect id="bud-dept" options={departments} value={departmentId} onChange={setDepartmentId} invalid={!!errors.department} /></Row>
          <Row label="Financial year" required htmlFor="bud-fy" error={errors.financialYear}>
            <select id="bud-fy" className={`input ${errors.financialYear ? "zf-invalid" : ""}`} value={financialYear} onChange={(e) => setFinancialYear(e.target.value)}>
              <option value="">-Select-</option>
              {financialYears.map((fy) => <option key={fy} value={fy}>{fy}</option>)}
            </select>
          </Row>
        </>
      )}

      <fieldset className="mb-2 max-w-3xl" aria-label="Income">
        <legend className="zf-section mb-2 font-bold">Income</legend>
        {INCOME_LINES.map((l) => (
          <Row key={l.key} label={l.label} htmlFor={`bud-${l.key}`} error={errors[l.key]}>
            <MoneyInput id={`bud-${l.key}`} value={income[l.key]} onChange={(v) => setLine(l.key, v)} invalid={!!errors[l.key]} />
          </Row>
        ))}
        <Row label="Total income" htmlFor="bud-total">
          <input id="bud-total" className="input" value={show(total)} readOnly aria-readonly="true" tabIndex={-1} data-testid="budget-total-income" />
        </Row>
      </fieldset>

      <Row label="Vendor name" htmlFor="bud-vendor-0">
        <ul className="max-w-xl space-y-2" data-testid="budget-vendors">
          {vendors.map((v, i) => (
            <li key={i} className="flex items-center gap-2">
              <TextInput id={`bud-vendor-${i}`} value={v} onChange={(x) => setVendors((list) => list.map((y, j) => (j === i ? x : y)))} maxLength={300} placeholder={`Vendor ${i + 1}`} />
              <button type="button" className="btn btn-ghost btn-sm shrink-0" aria-label={`Remove vendor ${i + 1}`} onClick={() => setVendors((list) => (list.length === 1 ? [""] : list.filter((_, j) => j !== i)))}>
                <X size={14} aria-hidden /> Remove
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={() => setVendors((list) => [...list, ""])}><Plus size={14} aria-hidden /> Add vendor</button>
      </Row>

      <Row label={revision ? "New budget amount" : "Budget amount"} required htmlFor="bud-amount" error={errors.budget}>
        <MoneyInput id="bud-amount" value={budget} onChange={setBudget} invalid={!!errors.budget} />
      </Row>
      <Row label="Net budget" htmlFor="bud-net" hint="Budget amount − total income">
        <input id="bud-net" className="input" value={net == null ? "" : show(net)} readOnly aria-readonly="true" tabIndex={-1} data-testid="budget-net" />
      </Row>
      {revision && (
        <Row label="Reason for revision" required htmlFor="bud-reason" error={errors.reason}><TextArea id="bud-reason" value={reason} onChange={setReason} /></Row>
      )}
      <Row label="Approver" required htmlFor="bud-approver" error={errors.approver}>
        <SearchSelect id="bud-approver" options={people} value={approverId} onChange={setApproverId} invalid={!!errors.approver} placeholder="Type a name to search" />
      </Row>

      {formError && <p className="zf-error mb-3" role="alert">{formError}</p>}
      <FormActions submitting={submitting} onReset={reset} label={revision ? "Submit revision" : "Submit"} resetLabel={revision ? "Cancel" : "Reset"} />
    </form>
  );
}
