"use client";

import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";
import { Plus, X } from "lucide-react";
import { api } from "@/components/approvals/api";
import { useToast } from "@/components/Toast";
import { FormActions, MoneyInput, Row, SearchSelect, TextArea, TextInput, type Option } from "@/components/approvals/FormFields";
import { CustomRow, checkExtra, extraAnswers, labeller } from "@/components/approvals/RequestForms";
import type { FormField } from "@/lib/approvals/form-fields";
import { BALANCE_LABEL, budgetBalance, cleanVendors, linesTotal, type BudgetLine } from "@/lib/approvals/budget";
import { formatINR, parseINR } from "@/lib/approvals/format";

type Errors = Record<string, string>;
/** A row as typed: the name and the amount as text. */
type LineText = { name: string; amount: string };

const EMPTY_ROW: LineText = { name: "", amount: "" };
const show = (p: number) => formatINR(p, { symbol: true });
const toText = (lines: BudgetLine[]): LineText[] => (lines.length ? lines.map((l) => ({ name: l.name, amount: formatINR(l.amountPaise) })) : [EMPTY_ROW]);
/** The rows worth sending: blank ones (no name, no amount) are left out. */
const filled = (rows: LineText[]) => rows.filter((r) => r.name.trim() || r.amount.trim());
/** What the rows add up to so far: a row whose amount is not (yet) a sum counts as nothing. */
const sumOf = (rows: LineText[]) => linesTotal(rows.map((r) => ({ amountPaise: (r.amount.trim() && parseINR(r.amount)) || 0 })));
const BALANCE_TONE = { surplus: "text-green-700", deficit: "text-red-700", balanced: "text-[var(--z-muted)]" } as const;

/**
 * Rows of a name and an amount (income sources, expenses), laid out like the vendors: each row with its own Remove, "Add …" under them,
 * and the total of the rows, read only, at the bottom.
 */
function LineRows({ kind, rows, setRows, errors, total }: {
  kind: "income" | "expense"; rows: LineText[]; setRows: (f: (rows: LineText[]) => LineText[]) => void; errors: Errors; total: number;
}) {
  const noun = kind === "income" ? "income" : "expense";
  const set = (i: number, patch: Partial<LineText>) => setRows((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <>
      <ul className="apr-line-rows space-y-2" data-testid={`budget-${kind}-rows`}>
        {rows.map((r, i) => (
          <li key={i}>
            <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-[minmax(12rem,1fr)_12rem_auto]">
              <TextInput id={`bud-${kind}-name-${i}`} value={r.name} onChange={(v) => set(i, { name: v })} invalid={!!errors[`${kind}-${i}`]} maxLength={200} placeholder={kind === "income" ? "Income source name" : "Expense name"} />
              <MoneyInput id={`bud-${kind}-amount-${i}`} value={r.amount} onChange={(v) => set(i, { amount: v })} invalid={!!errors[`${kind}-${i}`]} />
              <button type="button" className="btn btn-ghost btn-sm shrink-0" aria-label={`Remove ${noun} ${i + 1}`} onClick={() => setRows((list) => (list.length === 1 ? [EMPTY_ROW] : list.filter((_, j) => j !== i)))}>
                <X size={14} aria-hidden /> Remove
              </button>
            </div>
            {errors[`${kind}-${i}`] && <p className="zf-error">{errors[`${kind}-${i}`]}</p>}
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={() => setRows((list) => [...list, EMPTY_ROW])}><Plus size={14} aria-hidden /> Add {noun}</button>
      <p className="mt-3 flex items-center justify-between border-t border-[var(--z-line)] pt-2">
        <span className="font-bold">Total {kind === "income" ? "Income" : "Expense"}</span>
        <output className="font-bold" data-testid={`budget-total-${kind}`} aria-live="polite">{show(total)}</output>
      </p>
    </>
  );
}

/** Problems with income or expense rows: a row needs a name, and its amount must be a sum of zero or more. */
function checkRows(kind: "income" | "expense", rows: LineText[], err: Errors) {
  rows.forEach((r, i) => {
    if (!r.name.trim() && !r.amount.trim()) return;
    const p = parseINR(r.amount);
    if (!r.name.trim()) err[`${kind}-${i}`] = kind === "income" ? "Enter the income source name." : "Enter the expense name.";
    else if (!r.amount.trim() || p === null || p < 0) err[`${kind}-${i}`] = "Enter the amount: 0 or more, with at most 2 decimals.";
  });
}
const toLines = (rows: LineText[]): BudgetLine[] => filled(rows).map((r) => ({ name: r.name.trim(), amountPaise: parseINR(r.amount) ?? 0 }));

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
  incomeLines: BudgetLine[];
  expenseLines: BudgetLine[];
  vendors: string[];
  approverUserId: string | null;
  /** The answers the budget in force gave to the form's extra fields, by field key. */
  custom: Record<string, string>;
};

export type BudgetFormProps = {
  /** The form's fields as the Support Admin has set them (Administrator → Approval Forms → Budget): names, order, what is hidden, extra fields. */
  fields: FormField[];
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
 * The Budget Approval form, and the same form for a revision of an approved budget. In order: the event, its income (named rows), its
 * expenses (named rows), the vendors, the Budget Summary (Surplus, Deficit or Balanced: total income against total expense), the Total
 * Budget Requested, and the approver. The totals and the summary are worked out as the person types and cannot be edited. The approver is one
 * person, picked from everyone in the hub by typing their name.
 */
export function BudgetForm({ fields, people, departments = [], financialYears = [], defaultFinancialYear = "", revision }: BudgetFormProps) {
  const lab = labeller(fields);
  const shown = (key: string) => fields.some((f) => f.key === key && !f.hidden);
  const [custom, setCustom] = useState<Record<string, string>>(revision?.custom ?? {});
  const router = useRouter();
  const toast = useToast();
  const startApprover = revision?.approverUserId && people.some((p) => p.value === revision.approverUserId) ? revision.approverUserId : "";
  const startVendors = revision?.vendors.length ? revision.vendors : [""];

  const [eventName, setEventName] = useState("");
  const [description, setDescription] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [financialYear, setFinancialYear] = useState(defaultFinancialYear);
  const [income, setIncome] = useState<LineText[]>(revision ? toText(revision.incomeLines) : [EMPTY_ROW]);
  const [expenses, setExpenses] = useState<LineText[]>(revision ? toText(revision.expenseLines) : [EMPTY_ROW]);
  const [vendors, setVendors] = useState<string[]>(startVendors);
  const [budget, setBudget] = useState("");
  const [reason, setReason] = useState("");
  const [approverId, setApproverId] = useState(startApprover);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const budgetPaise = budget.trim() ? parseINR(budget) : null;
  const totalIncome = sumOf(income);
  const totalExpense = sumOf(expenses);
  const balance = budgetBalance(totalIncome, totalExpense);

  const reset = () => {
    if (revision) { router.push(`/approvals/requests/${revision.requestId}?app=hr`); return; }
    setEventName(""); setDescription(""); setDepartmentId(""); setFinancialYear(defaultFinancialYear); setIncome([EMPTY_ROW]); setExpenses([EMPTY_ROW]); setVendors([""]);
    setBudget(""); setApproverId(""); setCustom({}); setErrors({}); setFormError(null);
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
    if (shown("income")) checkRows("income", income, err);
    if (shown("expenses")) checkRows("expense", expenses, err);
    checkExtra(fields, custom, err);
    if (budgetPaise === null || budgetPaise <= 0) err.budget = "Enter the total budget requested, above 0, with at most 2 decimals.";
    if (!approverId) err.approver = "Choose the approver.";
    setErrors(err);
    if (Object.keys(err).length) return;

    setSubmitting(true);
    setFormError(null);
    // A section the Support Admin has hidden sends nothing.
    const common = {
      incomeLines: shown("income") ? toLines(income) : [], expenseLines: shown("expenses") ? toLines(expenses) : [], vendors: shown("vendors") ? cleanVendors(vendors) : [],
      budgetPaise, approverUserId: approverId, custom: extraAnswers(fields, custom),
    };
    const r = revision
      ? await api<{ id: string; requestNo: string }>("POST", `/api/approvals/requests/${revision.requestId}/revise`, { ...common, reason })
      : await api<{ id: string; requestNo: string | null }>("POST", "/api/approvals/requests", { kind: "budget", ...common, eventName, description, departmentId, financialYear });
    if (!r.ok) { setSubmitting(false); setFormError(r.error); toast.error(r.error); return; }
    toast.success(revision ? `Budget revision submitted: ${r.data.requestNo}` : "Budget submitted. Its Budget ID is given when it is approved.");
    router.push(`/approvals/requests/${r.data.id}?app=hr&submitted=1`);
    router.refresh();
  };

  // Each built-in field of the form, by key; they are shown in the order, with the names, the Support Admin set (hidden ones left out), with
  // the extra fields among them. On a revision the event is shown, not asked again.
  const rows: Record<string, React.ReactNode> = {
    eventName: revision
      ? <Row label={lab("eventName", "Event name")}><p className="py-2">{revision.eventName}</p></Row>
      : <Row label={lab("eventName", "Event name")} required htmlFor="bud-event" error={errors.eventName}><TextInput id="bud-event" value={eventName} onChange={setEventName} invalid={!!errors.eventName} maxLength={200} /></Row>,
    description: revision ? null : <Row label={lab("description", "Description")} required htmlFor="bud-desc" error={errors.description}><TextArea id="bud-desc" value={description} onChange={setDescription} /></Row>,
    department: revision
      ? <Row label={lab("department", "Department")}><p className="py-2">{revision.departmentName}</p></Row>
      : <Row label={lab("department", "Department")} required htmlFor="bud-dept" error={errors.department}><SearchSelect id="bud-dept" options={departments} value={departmentId} onChange={setDepartmentId} invalid={!!errors.department} /></Row>,
    financialYear: revision
      ? <Row label={lab("financialYear", "Financial year")}><p className="py-2">{revision.financialYear}</p></Row>
      : (
        <Row label={lab("financialYear", "Financial year")} required htmlFor="bud-fy" error={errors.financialYear}>
          <select id="bud-fy" className={`input ${errors.financialYear ? "zf-invalid" : ""}`} value={financialYear} onChange={(e) => setFinancialYear(e.target.value)}>
            <option value="">-Select-</option>
            {financialYears.map((fy) => <option key={fy} value={fy}>{fy}</option>)}
          </select>
        </Row>
      ),
    income: (
      <fieldset className="mb-4" aria-labelledby="bud-income-title">
        <h3 id="bud-income-title" className="mb-2 text-base font-bold">Income</h3>
        <Row label={lab("income", "Income sources")} htmlFor="bud-income-name-0"><LineRows kind="income" rows={income} setRows={setIncome} errors={errors} total={totalIncome} /></Row>
      </fieldset>
    ),
    expenses: (
      <fieldset className="mb-4" aria-labelledby="bud-expense-title">
        <h3 id="bud-expense-title" className="mb-2 text-base font-bold">Expenses</h3>
        <Row label={lab("expenses", "Expenses")} htmlFor="bud-expense-name-0"><LineRows kind="expense" rows={expenses} setRows={setExpenses} errors={errors} total={totalExpense} /></Row>
      </fieldset>
    ),
    vendors: (
      <Row label={lab("vendors", "Vendor name")} htmlFor="bud-vendor-0">
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
    ),
    summary: (
      <section className="mb-4" aria-labelledby="bud-summary-title" data-testid="budget-summary">
        <h3 id="bud-summary-title" className="mb-2 text-base font-bold">Budget Summary</h3>
        <Row label={lab("summary", "Summary")}>
          <dl className="grid max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1">
            <dt>Total Income</dt><dd className="text-right">{show(totalIncome)}</dd>
            <dt>Total Expense</dt><dd className="text-right">{show(totalExpense)}</dd>
            <dt className={`border-t border-[var(--z-line)] pt-1 font-bold ${BALANCE_TONE[balance.kind]}`}>{BALANCE_LABEL[balance.kind]}</dt>
            <dd className={`border-t border-[var(--z-line)] pt-1 text-right font-bold ${BALANCE_TONE[balance.kind]}`} data-testid="budget-balance" data-kind={balance.kind}>{show(balance.amountPaise)}</dd>
          </dl>
        </Row>
      </section>
    ),
    amount: (
      <>
        {revision && <Row label="Current budget"><p className="py-2">{show(revision.budgetPaise)}</p></Row>}
        <Row label={revision ? `New ${lab("amount", "Total Budget Requested").toLowerCase()}` : lab("amount", "Total Budget Requested")} required htmlFor="bud-amount" error={errors.budget}>
          <MoneyInput id="bud-amount" value={budget} onChange={setBudget} invalid={!!errors.budget} />
        </Row>
      </>
    ),
    approver: (
      <>
        {revision && <Row label="Reason for revision" required htmlFor="bud-reason" error={errors.reason}><TextArea id="bud-reason" value={reason} onChange={setReason} /></Row>}
        <Row label={lab("approver", "Approver")} required htmlFor="bud-approver" error={errors.approver}>
          <SearchSelect id="bud-approver" options={people} value={approverId} onChange={setApproverId} invalid={!!errors.approver} placeholder="Type a name to search" />
        </Row>
      </>
    ),
  };

  return (
    <form className="zf" onSubmit={onSubmit} noValidate data-testid="budget-form">
      {revision && (
        <div className="apr-notice mb-4 max-w-3xl" role="status">
          <p><b>Revising {revision.requestNo}: {revision.eventName}.</b> The budget in force is {show(revision.budgetPaise)}. The revision needs a fresh approval; until it is approved, {show(revision.budgetPaise)} stays in force.</p>
        </div>
      )}
      {fields.filter((f) => !f.hidden).map((f) => (f.builtin
        ? <Fragment key={f.key}>{rows[f.key]}</Fragment>
        : <CustomRow key={f.key} field={f} value={custom[f.key] ?? ""} onChange={(v) => setCustom((c) => ({ ...c, [f.key]: v }))} error={errors[`custom_${f.key}`]} />))}

      {formError && <p className="zf-error mb-3" role="alert">{formError}</p>}
      <FormActions submitting={submitting} onReset={reset} label={revision ? "Submit revision" : "Submit"} resetLabel={revision ? "Cancel" : "Reset"} />
    </form>
  );
}
