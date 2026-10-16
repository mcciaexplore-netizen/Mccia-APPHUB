"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/components/approvals/api";
import { useToast } from "@/components/Toast";
import { DateInput, DateTimeInput, EmailInput, FileInput, FormActions, MoneyInput, ReadOnlyMoney, Row, SearchSelect, TextArea, TextInput, type Option, type UploadedFile } from "@/components/approvals/zf";
import { assessBudget, budgetWarning, wrongFormMessage, type BudgetPosition } from "@/lib/approvals/calc";
import { financialYearOf, formatDateTime, parseINR, todayIST } from "@/lib/approvals/format";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ref = (f: UploadedFile | null) => (f ? { fileId: f.fileId } : null);
type Errors = Record<string, string>;

/** What the correction form needs to know about a request that was returned for corrections. */
export type EditInfo = {
  requestId: string;
  /** The original date of request: it is kept, and decides which budget year the request is checked against. */
  requestedAt: string;
  attachments: { id: string; slot: string; fileName: string; size: number }[];
  returnedBy: string | null;
  returnComment: string | null;
};

/** Shared by both forms: sends the request (or, for a returned one, the corrected request), then opens it. */
function useSubmitRequest(app: "hr" | "exp", edit?: EditInfo) {
  const router = useRouter();
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const submit = async (body: object) => {
    setSubmitting(true);
    setFormError(null);
    if (edit) {
      const r = await api<{ id: string; requestNo: string }>("PUT", `/api/approvals/requests/${edit.requestId}`, body);
      if (!r.ok) { setSubmitting(false); setFormError(r.error); toast.error(r.error); return; }
      toast.success(`Request ${r.data.requestNo} corrected and sent back for approval`);
      router.push(`/approvals/requests/${r.data.id}?app=${app}`);
      router.refresh();
      return;
    }
    const r = await api<{ id: string; requestNo: string }>("POST", "/api/approvals/requests", body);
    if (!r.ok) { setSubmitting(false); setFormError(r.error); toast.error(r.error); return; }
    toast.success(`Request submitted: ${r.data.requestNo}`);
    router.push(`/approvals/requests/${r.data.id}?app=${app}&submitted=1`);
  };
  return { submitting, formError, submit, setFormError };
}

const SLOT_LABEL: Record<string, string> = {
  file_upload: "File upload", file_upload_2: "File upload (second)", tax_invoice: "Tax Invoice", quotation: "Quotation", supporting: "Tax Invoice/Supporting Documents",
};

/** On a correction form: the reason it was returned, and the files already on the request, each of which can be taken off. */
function ReturnedNotice({ edit }: { edit: EditInfo }) {
  return (
    <div className="apr-notice mb-4 max-w-3xl space-y-1" role="status">
      <p><b>Returned for corrections{edit.returnedBy ? ` by ${edit.returnedBy}` : ""}.</b> Make the changes below and press Resubmit. It goes back to the same approver.</p>
      {edit.returnComment && <p className="whitespace-pre-wrap">&ldquo;{edit.returnComment}&rdquo;</p>}
    </div>
  );
}

function CurrentFiles({ edit, keep, setKeep }: { edit: EditInfo; keep: string[]; setKeep: (ids: string[]) => void }) {
  if (edit.attachments.length === 0) return null;
  return (
    <Row label="Current files">
      <ul className="max-w-xl space-y-1.5">
        {edit.attachments.map((a) => {
          const kept = keep.includes(a.id);
          return (
            <li key={a.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className={`min-w-0 flex-1 truncate ${kept ? "" : "text-[var(--z-muted)] line-through"}`} title={a.fileName}>{a.fileName} <span className="text-xs text-[var(--z-muted)]">({SLOT_LABEL[a.slot] ?? a.slot})</span></span>
              <button type="button" className="btn btn-ghost btn-sm" aria-label={`${kept ? "Remove" : "Keep"} ${a.fileName}`} onClick={() => setKeep(kept ? keep.filter((k) => k !== a.id) : [...keep, a.id])}>{kept ? "Remove" : "Keep"}</button>
            </li>
          );
        })}
      </ul>
      <p className="zf-sub mt-1">A new file attached in the same place replaces the current one.</p>
    </Row>
  );
}

type Position = BudgetPosition & { key: string };

/** The budget a person is spending from: it follows the branch, the category and the financial year of the Date of Request. */
function useBudget(branchId: string, categoryId: string, requestedAt: string, amountPaise: number | null) {
  const fy = useMemo(() => financialYearOf(new Date(requestedAt)), [requestedAt]);
  const key = branchId && categoryId ? `${branchId}|${categoryId}|${fy}` : "";
  const [position, setPosition] = useState<Position | null>(null);
  useEffect(() => {
    if (!key) return;
    const [b, c, y] = key.split("|");
    const ctl = new AbortController();
    fetch(`/api/approvals/budget?branchId=${b}&categoryId=${c}&fy=${y}`, { signal: ctl.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j) setPosition({ key, allocatedPaise: j.allocatedPaise, spentPaise: j.spentPaise, pendingPaise: j.pendingPaise }); })
      .catch(() => { /* the boxes stay empty; the server still checks the budget on submit */ });
    return () => ctl.abort();
  }, [key]);
  const assessment = position && position.key === key ? assessBudget(position, amountPaise ?? 0) : null;
  return { assessment, warning: assessment && amountPaise ? budgetWarning(assessment) : null, noBudgetText: assessment?.noBudget ? "No budget allocated" : "" };
}

/* ---------------------------------------------------------------- HR */

export type HrFormProps = {
  me: { name: string; email: string };
  categories: Option[];
  /** For an amount: the branch and the expense category its budget is kept under. */
  branches: Option[];
  expenseCategories: Option[];
  canAdd: boolean;
  /** The current moment, from the server, so the form and its page agree on "now". */
  now: string;
  /** Set when the form corrects a request that was returned: the values it opens with, and the request. */
  edit?: EditInfo & { initial: { first: string; last: string; email: string; categoryId: string; description: string; amount: string; branchId: string; budgetCategoryId: string } };
};

export function HrForm({ me, categories: initialCategories, branches: initialBranches, expenseCategories: initialExpense, canAdd, now, edit }: HrFormProps) {
  const [first, ...rest] = me.name.trim().split(/\s+/);
  const defaults = edit?.initial
    ? { first: edit.initial.first, last: edit.initial.last, email: edit.initial.email, categoryId: edit.initial.categoryId, amount: edit.initial.amount, description: edit.initial.description, branchId: edit.initial.branchId, budgetCategoryId: edit.initial.budgetCategoryId }
    : { first: first ?? "", last: rest.join(" "), email: me.email, categoryId: "", amount: "", description: "", branchId: "", budgetCategoryId: "" };
  const [categories, setCategories] = useState(initialCategories);
  const [branches, setBranches] = useState(initialBranches);
  const [expenseCategories, setExpenseCategories] = useState(initialExpense);
  const [firstName, setFirstName] = useState(defaults.first);
  const [lastName, setLastName] = useState(defaults.last);
  const [email, setEmail] = useState(defaults.email);
  const [categoryId, setCategoryId] = useState(defaults.categoryId);
  const [requestedAt, setRequestedAt] = useState(edit?.requestedAt ?? now);
  const [amount, setAmount] = useState(defaults.amount);
  const [branchId, setBranchId] = useState(defaults.branchId);
  const [budgetCategoryId, setBudgetCategoryId] = useState(defaults.budgetCategoryId);
  const [description, setDescription] = useState(defaults.description);
  const [file1, setFile1] = useState<UploadedFile | null>(null);
  const [file2, setFile2] = useState<UploadedFile | null>(null);
  const [keep, setKeep] = useState<string[]>(edit?.attachments.map((a) => a.id) ?? []);
  const [uploads, setUploads] = useState(0);
  const [errors, setErrors] = useState<Errors>({});
  const router = useRouter();
  const { submitting, formError, submit, setFormError } = useSubmitRequest("hr", edit);
  const busy = (b: boolean) => setUploads((n) => Math.max(0, n + (b ? 1 : -1)));

  const hasAmount = amount.trim() !== "";
  const amountPaise = hasAmount ? parseINR(amount) : null;
  const { assessment, warning, noBudgetText } = useBudget(hasAmount ? branchId : "", hasAmount ? budgetCategoryId : "", requestedAt, amountPaise);

  const reset = () => {
    if (edit) { router.push(`/approvals/requests/${edit.requestId}?app=hr`); return; }
    setFirstName(defaults.first); setLastName(defaults.last); setEmail(defaults.email); setCategoryId(""); setRequestedAt(new Date().toISOString());
    setAmount(""); setBranchId(""); setBudgetCategoryId(""); setDescription(""); setFile1(null); setFile2(null); setErrors({}); setFormError(null);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const err: Errors = {};
    if (!firstName.trim() || !lastName.trim()) err.name = "Enter the first and the last name.";
    if (email.trim() && !EMAIL.test(email.trim())) err.email = "Enter a valid email address.";
    if (!categoryId) err.category = "Choose a category.";
    if (hasAmount && (amountPaise === null || amountPaise <= 0)) err.amount = "Enter an amount above 0, with at most 2 decimals.";
    if (hasAmount && !branchId) err.branch = "Choose a branch.";
    if (hasAmount && !budgetCategoryId) err.budgetCategory = "Choose the category the budget is kept under.";
    setErrors(err);
    if (Object.keys(err).length) return;
    void submit({
      kind: "hr", firstName, lastName, email, hrCategoryId: categoryId, requestedAt, amountPaise, description,
      branchId: hasAmount ? branchId : null, budgetCategoryId: hasAmount ? budgetCategoryId : null,
      fileUpload: ref(file1), fileUpload2: ref(file2), ...(edit ? { keepAttachmentIds: keep } : {}),
    });
  };

  return (
    <form className="zf" onSubmit={onSubmit} noValidate>
      {edit && <ReturnedNotice edit={edit} />}
      <Row label="Name" required error={errors.name}>
        <div className="zf-names">
          <div><TextInput value={firstName} onChange={setFirstName} id="hr-first" invalid={!!errors.name} maxLength={60} /><span className="zf-sub">First Name</span></div>
          <div><TextInput value={lastName} onChange={setLastName} id="hr-last" invalid={!!errors.name} maxLength={60} /><span className="zf-sub">Last Name</span></div>
        </div>
      </Row>
      <Row label="Email" htmlFor="hr-email" error={errors.email}><EmailInput id="hr-email" value={email} onChange={setEmail} invalid={!!errors.email} /></Row>
      <Row label="Category" required htmlFor="hr-category" error={errors.category}>
        <SearchSelect
          id="hr-category" options={categories} value={categoryId} onChange={setCategoryId} invalid={!!errors.category}
          add={canAdd ? { kind: "hr-categories", noun: "HR category", onAdded: (o) => setCategories((c) => [...c, o].sort((a, b) => a.label.localeCompare(b.label))) } : undefined}
        />
      </Row>
      {edit ? (
        <Row label="Date of Request"><p className="py-2">{formatDateTime(edit.requestedAt)}</p></Row>
      ) : (
        <Row label="Date of Request" htmlFor="hr-date"><DateTimeInput id="hr-date" value={requestedAt} onChange={setRequestedAt} /></Row>
      )}
      <Row label="Amount" htmlFor="hr-amount" error={errors.amount}><MoneyInput id="hr-amount" value={amount} onChange={setAmount} invalid={!!errors.amount} /></Row>
      {hasAmount && (
        <>
          <Row label="Branch Name" required htmlFor="hr-branch" error={errors.branch}>
            <SearchSelect
              id="hr-branch" options={branches} value={branchId} onChange={setBranchId} invalid={!!errors.branch}
              add={canAdd ? { kind: "branches", noun: "branch", onAdded: (o) => setBranches((c) => [...c, o].sort((a, b) => a.label.localeCompare(b.label))) } : undefined}
            />
          </Row>
          <Row label="Budget category" required htmlFor="hr-budget-category" error={errors.budgetCategory}>
            <SearchSelect
              id="hr-budget-category" options={expenseCategories} value={budgetCategoryId} onChange={setBudgetCategoryId} invalid={!!errors.budgetCategory}
              add={canAdd ? { kind: "categories", noun: "category", onAdded: (o) => setExpenseCategories((c) => [...c, o].sort((a, b) => a.label.localeCompare(b.label))) } : undefined}
            />
          </Row>
          <Row label="Available budget" htmlFor="hr-available"><ReadOnlyMoney id="hr-available" paise={assessment?.availablePaise ?? null} empty={noBudgetText} /></Row>
          <Row label="Budget Remaining" htmlFor="hr-after"><ReadOnlyMoney id="hr-after" paise={assessment?.afterPaise ?? null} empty={noBudgetText} /></Row>
          {warning && <p className="apr-notice mb-2 max-w-xl" role="status">{warning}</p>}
        </>
      )}
      <Row label="Description" htmlFor="hr-desc"><TextArea id="hr-desc" value={description} onChange={setDescription} /></Row>
      {edit && <CurrentFiles edit={edit} keep={keep} setKeep={setKeep} />}
      <Row label="File upload" htmlFor="hr-file1"><FileInput id="hr-file1" label="File upload" value={file1} onChange={setFile1} onBusy={busy} /></Row>
      <Row label="File upload" htmlFor="hr-file2"><FileInput id="hr-file2" label="File upload (second)" value={file2} onChange={setFile2} onBusy={busy} /></Row>
      {formError && <p className="zf-error mb-3" role="alert">{formError}</p>}
      <FormActions submitting={submitting} disabled={uploads > 0} onReset={reset} label={edit ? "Resubmit" : "Submit"} resetLabel={edit ? "Cancel" : "Reset"} />
    </form>
  );
}

/* ---------------------------------------------------------------- expenditure */

type PersonOption = Option & { email: string };
export type ExpenditureFormProps = {
  form: "large" | "small";
  people: PersonOption[];
  meId: string;
  categories: Option[];
  branches: Option[];
  publicationTypes: Option[];
  publications: (Option & { typeId: string })[];
  thresholdPaise: number;
  canAdd: boolean;
  now: string;
  /** Values carried over from the other expenditure form (see the link in the amount message), or, when correcting, the request's own. */
  initial?: { employeeId?: string; email?: string; categoryId?: string; branchId?: string; nature?: string; vendor?: string; amount?: string; expenseDate?: string; taxInvoiceDate?: string; pubTypeId?: string; pubId?: string };
  /** Set when the form corrects a request that was returned. */
  edit?: EditInfo;
};

export function ExpenditureForm(p: ExpenditureFormProps) {
  const large = p.form === "large";
  const start = p.initial ?? {};
  const meListed = p.people.some((x) => x.value === p.meId);
  const defaultEmployee = start.employeeId && p.people.some((x) => x.value === start.employeeId) ? start.employeeId : meListed ? p.meId : "";
  const emailOf = (id: string) => p.people.find((x) => x.value === id)?.email ?? "";
  const defaults = {
    employeeId: defaultEmployee, email: start.email || emailOf(defaultEmployee), categoryId: start.categoryId ?? "", branchId: start.branchId ?? "",
    nature: start.nature ?? "", vendor: start.vendor ?? "", amount: start.amount ?? "",
  };

  const [categories, setCategories] = useState(p.categories);
  const [branches, setBranches] = useState(p.branches);
  const [pubTypes, setPubTypes] = useState(p.publicationTypes);
  const [pubs, setPubs] = useState(p.publications);

  const [employeeId, setEmployeeId] = useState(defaults.employeeId);
  const [email, setEmail] = useState(defaults.email);
  const [requestedAt, setRequestedAt] = useState(p.edit?.requestedAt ?? p.now);
  const [categoryId, setCategoryId] = useState(defaults.categoryId);
  const [nature, setNature] = useState(defaults.nature);
  const [branchId, setBranchId] = useState(defaults.branchId);
  const [amount, setAmount] = useState(defaults.amount);
  const [vendor, setVendor] = useState(defaults.vendor);
  const [supporting, setSupporting] = useState<UploadedFile | null>(null);
  const [quotation, setQuotation] = useState<UploadedFile | null>(null);
  const [fileUpload, setFileUpload] = useState<UploadedFile | null>(null);
  const [taxInvoice, setTaxInvoice] = useState<UploadedFile | null>(null);
  const [expenseDate, setExpenseDate] = useState(start.expenseDate ?? "");
  const [taxInvoiceDate, setTaxInvoiceDate] = useState(start.taxInvoiceDate ?? "");
  const [pubTypeId, setPubTypeId] = useState(start.pubTypeId ?? "");
  const [pubId, setPubId] = useState(start.pubId ?? "");
  const [keep, setKeep] = useState<string[]>(p.edit?.attachments.map((a) => a.id) ?? []);
  const [uploads, setUploads] = useState(0);
  const [errors, setErrors] = useState<Errors>({});
  const router = useRouter();
  const { submitting, formError, submit, setFormError } = useSubmitRequest(large ? "hr" : "exp", p.edit);
  const busy = (b: boolean) => setUploads((n) => Math.max(0, n + (b ? 1 : -1)));

  const reset = () => {
    if (p.edit) { router.push(`/approvals/requests/${p.edit.requestId}?app=${large ? "hr" : "exp"}`); return; }
    setEmployeeId(defaults.employeeId); setEmail(defaults.email); setRequestedAt(new Date().toISOString()); setCategoryId(""); setNature(""); setBranchId("");
    setAmount(""); setVendor(""); setSupporting(null); setQuotation(null); setFileUpload(null); setTaxInvoice(null); setExpenseDate(""); setTaxInvoiceDate("");
    setPubTypeId(""); setPubId(""); setErrors({}); setFormError(null);
  };

  const amountPaise = amount.trim() ? parseINR(amount) : null;
  const { assessment, warning, noBudgetText } = useBudget(branchId, categoryId, requestedAt, amountPaise);
  const wrong = wrongFormMessage(p.form, amountPaise, p.thresholdPaise);

  const otherHref = useMemo(() => {
    const q = new URLSearchParams();
    if (employeeId) q.set("employee", employeeId);
    if (email) q.set("email", email);
    if (categoryId) q.set("category", categoryId);
    if (branchId) q.set("branch", branchId);
    if (nature) q.set("nature", nature);
    if (vendor) q.set("vendor", vendor);
    if (amount) q.set("amount", amount);
    return `${large ? "/approvals/expenses/new" : "/approvals/expenditures/new"}${q.toString() ? `?${q}` : ""}`;
  }, [large, employeeId, email, categoryId, branchId, nature, vendor, amount]);

  const onEmployee = (id: string) => { setEmployeeId(id); setEmail(emailOf(id)); };
  const onType = (id: string) => { setPubTypeId(id); setPubId(""); };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const err: Errors = {};
    if (!employeeId) err.employee = "Choose a name.";
    if (!large && !email.trim()) err.email = "Enter the email address.";
    else if (email.trim() && !EMAIL.test(email.trim())) err.email = "Enter a valid email address.";
    if (!categoryId) err.category = "Choose a category.";
    if (!branchId) err.branch = "Choose a branch.";
    if (!large && !vendor.trim()) err.vendor = "Enter the vendor name.";
    if (amountPaise === null || amountPaise <= 0) err.amount = "Enter an amount above 0, with at most 2 decimals.";
    else if (wrong) err.amount = wrong;
    if (!large && taxInvoiceDate && taxInvoiceDate > todayIST()) err.taxInvoiceDate = "The date of the tax invoice cannot be in the future.";
    if (!large && pubId && !pubTypeId) err.pubType = "Choose the type of publication first.";
    setErrors(err);
    if (Object.keys(err).length) return;
    const common = { employeeUserId: employeeId, email, requestedAt, categoryId, natureOfExpenditure: nature, branchId, amountPaise, vendorName: vendor, ...(p.edit ? { keepAttachmentIds: keep } : {}) };
    void submit(large
      ? { kind: "large", ...common, supportingDocs: ref(supporting), quotation: ref(quotation) }
      : { kind: "small", ...common, fileUpload: ref(fileUpload), expenseDate, publicationTypeId: pubTypeId || null, publicationId: pubId || null, taxInvoice: ref(taxInvoice), quotation: ref(quotation), taxInvoiceDate });
  };

  const addCategory = p.canAdd ? { kind: "categories" as const, noun: "category", onAdded: (o: Option) => setCategories((c) => [...c, o].sort((a, b) => a.label.localeCompare(b.label))) } : undefined;
  const addBranch = p.canAdd ? { kind: "branches" as const, noun: "branch", onAdded: (o: Option) => setBranches((c) => [...c, o].sort((a, b) => a.label.localeCompare(b.label))) } : undefined;

  const nameRow = (
    <Row label="Name" required htmlFor="ex-name" error={errors.employee}>
      <SearchSelect id="ex-name" options={p.people} value={employeeId} onChange={onEmployee} invalid={!!errors.employee} />
    </Row>
  );
  const emailRow = <Row label="Email" required={!large} htmlFor="ex-email" error={errors.email}><EmailInput id="ex-email" value={email} onChange={setEmail} invalid={!!errors.email} /></Row>;
  const categoryRow = (
    <Row label="Category" required htmlFor="ex-category" error={errors.category}>
      <SearchSelect id="ex-category" options={categories} value={categoryId} onChange={setCategoryId} invalid={!!errors.category} add={addCategory} />
    </Row>
  );
  const natureRow = <Row label="Nature of Expenditure" htmlFor="ex-nature"><TextArea id="ex-nature" value={nature} onChange={setNature} /></Row>;
  const branchRow = (
    <Row label="Branch Name" required htmlFor="ex-branch" error={errors.branch}>
      <SearchSelect id="ex-branch" options={branches} value={branchId} onChange={setBranchId} invalid={!!errors.branch} add={addBranch} />
    </Row>
  );
  const vendorRow = <Row label="Vendor Name" required={!large} htmlFor="ex-vendor" error={errors.vendor}><TextArea id="ex-vendor" value={vendor} onChange={setVendor} rows={3} /></Row>;
  const amountRow = (
    <Row label="Amount" required htmlFor="ex-amount" error={errors.amount}>
      <MoneyInput id="ex-amount" value={amount} onChange={setAmount} invalid={!!errors.amount} />
      {wrong && (
        <p className="apr-notice apr-notice-red mt-2" role="alert">
          {wrong} <Link href={otherHref} className="apr-link">{large ? "Open the Expenses form" : "Open the DG Expenditure form"}</Link> with your details filled in.
        </p>
      )}
    </Row>
  );
  const typePubs = pubs.filter((x) => x.typeId === pubTypeId);

  return (
    <form className="zf" onSubmit={onSubmit} noValidate>
      {p.edit && <ReturnedNotice edit={p.edit} />}
      {nameRow}
      {emailRow}
      {p.edit ? (
        <Row label={large ? "Date of Request" : "Date"}><p className="py-2">{formatDateTime(p.edit.requestedAt)}</p></Row>
      ) : (
        <Row label={large ? "Date of Request" : "Date"} htmlFor="ex-requested"><DateTimeInput id="ex-requested" value={requestedAt} onChange={setRequestedAt} /></Row>
      )}

      {large && <Row label="Difference" htmlFor="ex-diff"><ReadOnlyMoney id="ex-diff" placeholder="#######" paise={assessment?.afterPaise ?? null} empty={noBudgetText} /></Row>}
      {categoryRow}
      {natureRow}
      {branchRow}

      {large ? (
        <>
          <Row label="Budget Allocated" htmlFor="ex-alloc"><ReadOnlyMoney id="ex-alloc" paise={assessment?.allocatedPaise ?? null} empty={noBudgetText} /></Row>
          <Row label="Budget Remaining" htmlFor="ex-remaining"><ReadOnlyMoney id="ex-remaining" paise={assessment?.availablePaise ?? null} empty={noBudgetText} /></Row>
          {amountRow}
          {vendorRow}
          <Row label="Tax Invoice/Supporting Documents" htmlFor="ex-supporting"><FileInput id="ex-supporting" label="Tax Invoice or supporting documents" value={supporting} onChange={setSupporting} onBusy={busy} /></Row>
          <Row label="Quotation" htmlFor="ex-quotation"><FileInput id="ex-quotation" label="Quotation" value={quotation} onChange={setQuotation} onBusy={busy} /></Row>
        </>
      ) : (
        <>
          <Row label="Available budget" htmlFor="ex-available"><ReadOnlyMoney id="ex-available" paise={assessment?.availablePaise ?? null} empty={noBudgetText} /></Row>
          <Row label="File upload" htmlFor="ex-file"><FileInput id="ex-file" label="File upload" value={fileUpload} onChange={setFileUpload} onBusy={busy} /></Row>
          <Row label="Budget Remaining" htmlFor="ex-after"><ReadOnlyMoney id="ex-after" paise={assessment?.afterPaise ?? null} empty={noBudgetText} /></Row>
          <Row label="Date" htmlFor="ex-expense-date"><DateInput id="ex-expense-date" value={expenseDate} onChange={setExpenseDate} /></Row>
          <Row label="Type of Publication" htmlFor="ex-pub-type" error={errors.pubType}>
            <SearchSelect
              id="ex-pub-type" options={pubTypes} value={pubTypeId} onChange={onType} invalid={!!errors.pubType}
              add={p.canAdd ? { kind: "publication-types", noun: "publication type", onAdded: (o) => setPubTypes((c) => [...c, o].sort((a, b) => a.label.localeCompare(b.label))) } : undefined}
            />
          </Row>
          <Row label="Publication" htmlFor="ex-pub">
            <SearchSelect
              id="ex-pub" options={typePubs} value={pubId} onChange={setPubId} disabled={!pubTypeId}
              add={p.canAdd && pubTypeId ? { kind: "publications", noun: "publication", extra: { publicationTypeId: pubTypeId }, onAdded: (o) => setPubs((c) => [...c, { ...o, typeId: pubTypeId }]) } : undefined}
            />
          </Row>
          {vendorRow}
          <Row label="Tax Invoice" htmlFor="ex-invoice"><FileInput id="ex-invoice" label="Tax Invoice" value={taxInvoice} onChange={setTaxInvoice} onBusy={busy} /></Row>
          <Row label="Quotation" htmlFor="ex-quotation"><FileInput id="ex-quotation" label="Quotation" value={quotation} onChange={setQuotation} onBusy={busy} /></Row>
          <Row label="Date of Tax Invoice" htmlFor="ex-invoice-date" error={errors.taxInvoiceDate}><DateInput id="ex-invoice-date" value={taxInvoiceDate} onChange={setTaxInvoiceDate} max={todayIST()} invalid={!!errors.taxInvoiceDate} /></Row>
          {amountRow}
        </>
      )}

      {p.edit && <CurrentFiles edit={p.edit} keep={keep} setKeep={setKeep} />}
      {warning && <p className="apr-notice mb-2 max-w-xl" role="status">{warning}</p>}
      {formError && <p className="zf-error mb-3" role="alert">{formError}</p>}
      <FormActions submitting={submitting} disabled={uploads > 0 || !!wrong} onReset={reset} label={p.edit ? "Resubmit" : "Submit"} resetLabel={p.edit ? "Cancel" : "Reset"} />
    </form>
  );
}
