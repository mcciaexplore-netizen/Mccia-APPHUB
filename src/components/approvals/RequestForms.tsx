"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/components/approvals/api";
import { useToast } from "@/components/Toast";
import { DateInput, DateTimeInput, EmailInput, FileInput, FormActions, MoneyInput, ReadOnlyMoney, Row, SearchSelect, TextArea, TextInput, type Option, type UploadedFile } from "@/components/approvals/zf";
import { assessBudget, budgetWarning, wrongFormMessage, type BudgetPosition } from "@/lib/approvals/calc";
import { financialYearOf, parseINR, todayIST } from "@/lib/approvals/format";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ref = (f: UploadedFile | null) => (f ? { fileId: f.fileId } : null);
type Errors = Record<string, string>;

/** Shared by both forms: sends the request, then shows its number and opens it. */
function useSubmitRequest(app: "hr" | "exp") {
  const router = useRouter();
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const submit = async (body: object) => {
    setSubmitting(true);
    setFormError(null);
    const r = await api<{ id: string; requestNo: string }>("POST", "/api/approvals/requests", body);
    if (!r.ok) { setSubmitting(false); setFormError(r.error); toast.error(r.error); return; }
    toast.success(`Request submitted: ${r.data.requestNo}`);
    router.push(`/approvals/requests/${r.data.id}?app=${app}`);
  };
  return { submitting, formError, submit, setFormError };
}

/* ---------------------------------------------------------------- HR */

export type HrFormProps = {
  me: { name: string; email: string };
  categories: Option[];
  canAdd: boolean;
  /** The current moment, from the server, so the form and its page agree on "now". */
  now: string;
};

export function HrForm({ me, categories: initialCategories, canAdd, now }: HrFormProps) {
  const [first, ...rest] = me.name.trim().split(/\s+/);
  const defaults = { first: first ?? "", last: rest.join(" "), email: me.email };
  const [categories, setCategories] = useState(initialCategories);
  const [firstName, setFirstName] = useState(defaults.first);
  const [lastName, setLastName] = useState(defaults.last);
  const [email, setEmail] = useState(defaults.email);
  const [categoryId, setCategoryId] = useState("");
  const [requestedAt, setRequestedAt] = useState(now);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [file1, setFile1] = useState<UploadedFile | null>(null);
  const [file2, setFile2] = useState<UploadedFile | null>(null);
  const [uploads, setUploads] = useState(0);
  const [errors, setErrors] = useState<Errors>({});
  const { submitting, formError, submit, setFormError } = useSubmitRequest("hr");
  const busy = (b: boolean) => setUploads((n) => Math.max(0, n + (b ? 1 : -1)));

  const reset = () => {
    setFirstName(defaults.first); setLastName(defaults.last); setEmail(defaults.email); setCategoryId(""); setRequestedAt(new Date().toISOString());
    setAmount(""); setDescription(""); setFile1(null); setFile2(null); setErrors({}); setFormError(null);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const err: Errors = {};
    const paise = amount.trim() ? parseINR(amount) : null;
    if (!firstName.trim() || !lastName.trim()) err.name = "Enter the first and the last name.";
    if (email.trim() && !EMAIL.test(email.trim())) err.email = "Enter a valid email address.";
    if (!categoryId) err.category = "Choose a category.";
    if (amount.trim() && (paise === null || paise <= 0)) err.amount = "Enter an amount above 0, with at most 2 decimals.";
    setErrors(err);
    if (Object.keys(err).length) return;
    void submit({
      kind: "hr", firstName, lastName, email, hrCategoryId: categoryId, requestedAt, amountPaise: paise, description,
      fileUpload: ref(file1), fileUpload2: ref(file2),
    });
  };

  return (
    <form className="zf" onSubmit={onSubmit} noValidate>
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
      <Row label="Date of Request" htmlFor="hr-date"><DateTimeInput id="hr-date" value={requestedAt} onChange={setRequestedAt} /></Row>
      <Row label="Amount" htmlFor="hr-amount" error={errors.amount}><MoneyInput id="hr-amount" value={amount} onChange={setAmount} invalid={!!errors.amount} /></Row>
      <Row label="Description" htmlFor="hr-desc"><TextArea id="hr-desc" value={description} onChange={setDescription} /></Row>
      <Row label="File upload" htmlFor="hr-file1"><FileInput id="hr-file1" label="File upload" value={file1} onChange={setFile1} onBusy={busy} /></Row>
      <Row label="File upload" htmlFor="hr-file2"><FileInput id="hr-file2" label="File upload (second)" value={file2} onChange={setFile2} onBusy={busy} /></Row>
      {formError && <p className="zf-error mb-3" role="alert">{formError}</p>}
      <FormActions submitting={submitting} disabled={uploads > 0} onReset={reset} />
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
  /** Values carried over from the other expenditure form (see the link in the amount message). */
  initial?: { employeeId?: string; email?: string; categoryId?: string; branchId?: string; nature?: string; vendor?: string; amount?: string };
};

type Position = BudgetPosition & { key: string };

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
  const [requestedAt, setRequestedAt] = useState(p.now);
  const [categoryId, setCategoryId] = useState(defaults.categoryId);
  const [nature, setNature] = useState(defaults.nature);
  const [branchId, setBranchId] = useState(defaults.branchId);
  const [amount, setAmount] = useState(defaults.amount);
  const [vendor, setVendor] = useState(defaults.vendor);
  const [supporting, setSupporting] = useState<UploadedFile | null>(null);
  const [quotation, setQuotation] = useState<UploadedFile | null>(null);
  const [fileUpload, setFileUpload] = useState<UploadedFile | null>(null);
  const [taxInvoice, setTaxInvoice] = useState<UploadedFile | null>(null);
  const [expenseDate, setExpenseDate] = useState("");
  const [taxInvoiceDate, setTaxInvoiceDate] = useState("");
  const [pubTypeId, setPubTypeId] = useState("");
  const [pubId, setPubId] = useState("");
  const [uploads, setUploads] = useState(0);
  const [errors, setErrors] = useState<Errors>({});
  const { submitting, formError, submit, setFormError } = useSubmitRequest(large ? "hr" : "exp");
  const busy = (b: boolean) => setUploads((n) => Math.max(0, n + (b ? 1 : -1)));

  const reset = () => {
    setEmployeeId(defaults.employeeId); setEmail(defaults.email); setRequestedAt(new Date().toISOString()); setCategoryId(""); setNature(""); setBranchId("");
    setAmount(""); setVendor(""); setSupporting(null); setQuotation(null); setFileUpload(null); setTaxInvoice(null); setExpenseDate(""); setTaxInvoiceDate("");
    setPubTypeId(""); setPubId(""); setErrors({}); setFormError(null);
  };

  // The budget the person is spending from: it follows the branch, the category and the financial year of the Date of Request.
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

  const amountPaise = amount.trim() ? parseINR(amount) : null;
  const assessment = position && position.key === key ? assessBudget(position, amountPaise ?? 0) : null;
  const warning = assessment && amountPaise ? budgetWarning(assessment) : null;
  const wrong = wrongFormMessage(p.form, amountPaise, p.thresholdPaise);
  const noBudgetText = assessment?.noBudget ? "No budget allocated" : "";

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
    const common = { employeeUserId: employeeId, email, requestedAt, categoryId, natureOfExpenditure: nature, branchId, amountPaise, vendorName: vendor };
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
      {nameRow}
      {emailRow}
      <Row label={large ? "Date of Request" : "Date"} htmlFor="ex-requested"><DateTimeInput id="ex-requested" value={requestedAt} onChange={setRequestedAt} /></Row>

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

      {warning && <p className="apr-notice mb-2 max-w-xl" role="status">{warning}</p>}
      {formError && <p className="zf-error mb-3" role="alert">{formError}</p>}
      <FormActions submitting={submitting} disabled={uploads > 0 || !!wrong} onReset={reset} />
    </form>
  );
}
