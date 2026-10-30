"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useState } from "react";
import { api } from "@/components/approvals/api";
import { useToast } from "@/components/Toast";
import { DateInput, DateTimeInput, EmailInput, FileInput, FormActions, MoneyInput, ReadOnlyMoney, Row, SearchSelect, TextArea, TextInput, type Option, type UploadedFile } from "@/components/approvals/FormFields";
import { wrongFormMessage } from "@/lib/approvals/calc";
import { formatDateTime, formatINR, parseINR, todayIST } from "@/lib/approvals/format";
import type { FormField } from "@/lib/approvals/form-fields";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ref = (f: UploadedFile | null) => (f ? { fileId: f.fileId } : null);
type Errors = Record<string, string>;

/** The name the Support Admin gave a built-in field of this form (or its default, where nothing was changed). */
const labeller = (fields: FormField[]) => (key: string, fallback: string) => fields.find((f) => f.key === key)?.label ?? fallback;

/** One extra field the Support Admin added to the form, as a row, in the place they put it. */
function CustomRow({ field, value, onChange, error }: { field: FormField; value: string; onChange: (v: string) => void; error?: string }) {
  const id = `cf-${field.key}`;
  return (
    <Row label={field.label} required={field.required} htmlFor={id} error={error}>
      {field.kind === "textarea" ? <TextArea id={id} value={value} onChange={onChange} />
        : field.kind === "date" ? <DateInput id={id} value={value} onChange={onChange} invalid={!!error} />
        : field.kind === "select" ? <SearchSelect id={id} options={field.options.map((o) => ({ value: o, label: o }))} value={value} onChange={onChange} invalid={!!error} />
        : <TextInput id={id} value={value} onChange={onChange} invalid={!!error} maxLength={field.kind === "number" ? 40 : 300} />}
    </Row>
  );
}

/** The form's rows in the order set for it: its own rows (by key) and the extra fields among them. Hidden fields are left out. */
function ordered(fields: FormField[], rows: Record<string, React.ReactNode>, custom: Record<string, string>, setOne: (key: string, v: string) => void, errors: Errors) {
  return fields.filter((f) => !f.hidden).map((f) => (f.builtin
    ? <Fragment key={f.key}>{rows[f.key]}</Fragment>
    : <CustomRow key={f.key} field={f} value={custom[f.key] ?? ""} onChange={(v) => setOne(f.key, v)} error={errors[`custom_${f.key}`]} />));
}

/** Problems with the extra fields (a required one left empty, a number that is not one), added to the form's own. */
function checkExtra(fields: FormField[], custom: Record<string, string>, err: Errors) {
  for (const f of fields) {
    if (f.builtin || f.hidden) continue;
    const v = (custom[f.key] ?? "").trim();
    if (!v && f.required) err[`custom_${f.key}`] = `Fill in "${f.label}".`;
    else if (v && f.kind === "number" && !/^-?\d+(\.\d+)?$/.test(v)) err[`custom_${f.key}`] = "Enter a number.";
  }
}

/** What is sent for the extra fields: only those that are shown, and only the ones answered. */
const extraAnswers = (fields: FormField[], custom: Record<string, string>) =>
  Object.fromEntries(fields.filter((f) => !f.builtin && !f.hidden).map((f) => [f.key, (custom[f.key] ?? "").trim()] as const).filter(([, v]) => v));

/** What the correction form needs to know about a request that was returned for corrections. */
export type EditInfo = {
  requestId: string;
  /** The original date of request: it is kept as it was. */
  requestedAt: string;
  attachments: { id: string; slot: string; fileName: string; size: number }[];
  returnedBy: string | null;
  returnComment: string | null;
  /** The answers already given to the extra fields, by field key. */
  custom: Record<string, string>;
};

/** Shared by both forms: sends the request, then opens the person's open requests (/approvals/my-requests); a returned request, once corrected, opens itself again. */
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
    router.push(`/approvals/my-requests?submitted=${r.data.id}`);
    router.refresh(); // the sidebar's count of their open requests
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

/* ---------------------------------------------------------------- HR */

export type HrFormProps = {
  me: { name: string; email: string };
  categories: Option[];
  /** The form's fields as the Support Admin has set them: names, order, what is hidden, and the extra fields. */
  fields: FormField[];
  canAdd: boolean;
  /** The current moment, from the server, so the form and its page agree on "now". */
  now: string;
  /** Set when the form corrects a request that was returned: the values it opens with, and the request. */
  edit?: EditInfo & { initial: { first: string; last: string; email: string; categoryId: string; description: string; amount: string; budgetAllocated: string; budgetUsed: string } };
};

export function HrForm({ me, categories: initialCategories, fields, canAdd, now, edit }: HrFormProps) {
  const lab = labeller(fields);
  const [custom, setCustom] = useState<Record<string, string>>(edit?.custom ?? {});
  const [first, ...rest] = me.name.trim().split(/\s+/);
  const defaults = edit?.initial
    ? { first: edit.initial.first, last: edit.initial.last, email: edit.initial.email, categoryId: edit.initial.categoryId, amount: edit.initial.amount, description: edit.initial.description }
    : { first: first ?? "", last: rest.join(" "), email: me.email, categoryId: "", amount: "", description: "" };
  const [categories, setCategories] = useState(initialCategories);
  const [firstName, setFirstName] = useState(defaults.first);
  const [lastName, setLastName] = useState(defaults.last);
  const [email, setEmail] = useState(defaults.email);
  const [categoryId, setCategoryId] = useState(defaults.categoryId);
  const [requestedAt, setRequestedAt] = useState(edit?.requestedAt ?? now);
  const [amount, setAmount] = useState(defaults.amount);
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

  const reset = () => {
    if (edit) { router.push(`/approvals/requests/${edit.requestId}?app=hr`); return; }
    setFirstName(defaults.first); setLastName(defaults.last); setEmail(defaults.email); setCategoryId(""); setRequestedAt(new Date().toISOString());
    setAmount(""); setDescription(""); setFile1(null); setFile2(null); setCustom({}); setErrors({}); setFormError(null);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const err: Errors = {};
    if (!firstName.trim() || !lastName.trim()) err.name = "Enter the first and the last name.";
    if (email.trim() && !EMAIL.test(email.trim())) err.email = "Enter a valid email address.";
    if (!categoryId) err.category = "Choose a category.";
    if (hasAmount && (amountPaise === null || amountPaise <= 0)) err.amount = "Enter an amount above 0, with at most 2 decimals.";
    checkExtra(fields, custom, err);
    setErrors(err);
    if (Object.keys(err).length) return;
    void submit({
      kind: "hr", firstName, lastName, email, hrCategoryId: categoryId, requestedAt, amountPaise, description,
      fileUpload: ref(file1), fileUpload2: ref(file2), custom: extraAnswers(fields, custom), ...(edit ? { keepAttachmentIds: keep } : {}),
    });
  };

  const rows: Record<string, React.ReactNode> = {
    name: (
      <Row label={lab("name", "Name")} required error={errors.name}>
        <div className="zf-names">
          <div><TextInput value={firstName} onChange={setFirstName} id="hr-first" invalid={!!errors.name} maxLength={60} /><span className="zf-sub">First Name</span></div>
          <div><TextInput value={lastName} onChange={setLastName} id="hr-last" invalid={!!errors.name} maxLength={60} /><span className="zf-sub">Last Name</span></div>
        </div>
      </Row>
    ),
    email: <Row label={lab("email", "Email")} htmlFor="hr-email" error={errors.email}><EmailInput id="hr-email" value={email} onChange={setEmail} invalid={!!errors.email} /></Row>,
    category: (
      <Row label={lab("category", "Category")} required htmlFor="hr-category" error={errors.category}>
        <SearchSelect
          id="hr-category" options={categories} value={categoryId} onChange={setCategoryId} invalid={!!errors.category}
          add={canAdd ? { kind: "hr-categories", noun: "HR category", onAdded: (o) => setCategories((c) => [...c, o].sort((a, b) => a.label.localeCompare(b.label))) } : undefined}
        />
      </Row>
    ),
    date: edit
      ? <Row label={lab("date", "Date of Request")}><p className="py-2">{formatDateTime(edit.requestedAt)}</p></Row>
      : <Row label={lab("date", "Date of Request")} htmlFor="hr-date"><DateTimeInput id="hr-date" value={requestedAt} onChange={setRequestedAt} /></Row>,
    amount: (
      <>
        <Row label={lab("amount", "Amount")} htmlFor="hr-amount" error={errors.amount}><MoneyInput id="hr-amount" value={amount} onChange={setAmount} invalid={!!errors.amount} /></Row>
      </>
    ),
    description: <Row label={lab("description", "Description")} htmlFor="hr-desc"><TextArea id="hr-desc" value={description} onChange={setDescription} /></Row>,
    file1: <Row label={lab("file1", "File upload")} htmlFor="hr-file1"><FileInput id="hr-file1" label="File upload" value={file1} onChange={setFile1} onBusy={busy} /></Row>,
    file2: <Row label={lab("file2", "File upload")} htmlFor="hr-file2"><FileInput id="hr-file2" label="File upload (second)" value={file2} onChange={setFile2} onBusy={busy} /></Row>,
  };

  return (
    <form className="zf" onSubmit={onSubmit} noValidate>
      {edit && <ReturnedNotice edit={edit} />}
      {ordered(fields, rows, custom, (k, v) => setCustom((c) => ({ ...c, [k]: v })), errors)}
      {edit && <CurrentFiles edit={edit} keep={keep} setKeep={setKeep} />}
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
  /** The form's fields as the Support Admin has set them: names, order, what is hidden, and the extra fields. */
  fields: FormField[];
  canAdd: boolean;
  now: string;
  /** Values carried over from the other expenditure form (see the link in the amount message), or, when correcting, the request's own. */
  initial?: { employeeId?: string; email?: string; categoryId?: string; branchId?: string; nature?: string; vendor?: string; amount?: string; budgetAllocated?: string; budgetUsed?: string; expenseDate?: string; taxInvoiceDate?: string; pubTypeId?: string; pubId?: string };
  /** Set when the form corrects a request that was returned. */
  edit?: EditInfo;
  /**
   * The one expense form for a new request: the same fields for every amount, sent as the kind its amount makes it (from the threshold up it
   * goes on to the Super Admin). Without it (correcting a returned request) the kind stays as it was raised.
   */
  byAmount?: boolean;
};

export function ExpenditureForm(p: ExpenditureFormProps) {
  const [custom, setCustom] = useState<Record<string, string>>(p.edit?.custom ?? {});
  const start = p.initial ?? {};
  const meListed = p.people.some((x) => x.value === p.meId);
  const defaultEmployee = start.employeeId && p.people.some((x) => x.value === start.employeeId) ? start.employeeId : meListed ? p.meId : "";
  const emailOf = (id: string) => p.people.find((x) => x.value === id)?.email ?? "";
  const defaults = {
    employeeId: defaultEmployee, email: start.email || emailOf(defaultEmployee), categoryId: start.categoryId ?? "", branchId: start.branchId ?? "",
    nature: start.nature ?? "", vendor: start.vendor ?? "", amount: start.amount ?? "",
  };

  const [categories, setCategories] = useState(p.categories);
  const [pubTypes, setPubTypes] = useState(p.publicationTypes);
  const [pubs, setPubs] = useState(p.publications);

  const [employeeId, setEmployeeId] = useState(defaults.employeeId);
  const [email, setEmail] = useState(defaults.email);
  const [requestedAt, setRequestedAt] = useState(p.edit?.requestedAt ?? p.now);
  const [categoryId, setCategoryId] = useState(defaults.categoryId);
  const [nature, setNature] = useState(defaults.nature);
  // No branch is asked any more; a returned request that had one keeps it when it is corrected.
  const [branchId, setBranchId] = useState(defaults.branchId);
  const [amount, setAmount] = useState(defaults.amount);
  // Which kind of request this is: fixed by the form, or, on the one expense form, by the amount typed.
  const typedPaise = amount.trim() ? parseINR(amount) : null;
  const large = p.byAmount ? typedPaise != null && typedPaise >= p.thresholdPaise : p.form === "large";
  const fields = p.fields;
  const lab = labeller(fields);
  const [vendor, setVendor] = useState(defaults.vendor);
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
    setAmount(""); setVendor(""); setQuotation(null); setFileUpload(null); setTaxInvoice(null); setExpenseDate(""); setTaxInvoiceDate("");
    setPubTypeId(""); setPubId(""); setCustom({}); setErrors({}); setFormError(null);
  };

  const amountPaise = amount.trim() ? parseINR(amount) : null;
  const wrong = p.byAmount ? null : wrongFormMessage(p.form, amountPaise, p.thresholdPaise);

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
    if (!email.trim()) err.email = "Enter the email address.";
    else if (email.trim() && !EMAIL.test(email.trim())) err.email = "Enter a valid email address.";
    if (!categoryId) err.category = "Choose a category.";
    if (!vendor.trim()) err.vendor = "Enter the vendor name.";
    if (amountPaise === null || amountPaise <= 0) err.amount = "Enter an amount above 0, with at most 2 decimals.";
    else if (wrong) err.amount = wrong;
    if (taxInvoiceDate && taxInvoiceDate > todayIST()) err.taxInvoiceDate = "The date of the tax invoice cannot be in the future.";
    if (pubId && !pubTypeId) err.pubType = "Choose the type of publication first.";
    checkExtra(fields, custom, err);
    setErrors(err);
    if (Object.keys(err).length) return;
    const common = { employeeUserId: employeeId, email, requestedAt, categoryId, natureOfExpenditure: nature, branchId: branchId || null, amountPaise, vendorName: vendor, custom: extraAnswers(fields, custom), ...(p.edit ? { keepAttachmentIds: keep } : {}) };
    // The same fields for every amount; the kind only decides who approves it.
    void submit({ kind: large ? "large" : "small", ...common, fileUpload: ref(fileUpload), expenseDate, publicationTypeId: pubTypeId || null, publicationId: pubId || null, taxInvoice: ref(taxInvoice), quotation: ref(quotation), taxInvoiceDate });
  };

  const addCategory = p.canAdd ? { kind: "categories" as const, noun: "category", onAdded: (o: Option) => setCategories((c) => [...c, o].sort((a, b) => a.label.localeCompare(b.label))) } : undefined;

  const amountRow = (
    <Row label={lab("amount", "Amount")} required htmlFor="ex-amount" error={errors.amount}>
      <MoneyInput id="ex-amount" value={amount} onChange={setAmount} invalid={!!errors.amount} />
      {p.byAmount && large && (
        <p className="apr-notice mt-2" role="status">{formatINR(p.thresholdPaise, { symbol: true })} or more: the first approver recommends it to the Director General, who gives the final decision.</p>
      )}
      {wrong && (
        <p className="apr-notice apr-notice-red mt-2" role="alert">
          {wrong}{amountPaise != null && amountPaise > 0 && <> <Link href={otherHref} className="apr-link">{large ? "Open the Expenses form" : "Open the DG Expenditure form"}</Link> with your details filled in.</>}
        </p>
      )}
    </Row>
  );
  const typePubs = pubs.filter((x) => x.typeId === pubTypeId);

  const shared: Record<string, React.ReactNode> = {
    name: (
      <Row label={lab("name", "Name")} required htmlFor="ex-name" error={errors.employee}>
        <SearchSelect id="ex-name" options={p.people} value={employeeId} onChange={onEmployee} invalid={!!errors.employee} />
      </Row>
    ),
    email: <Row label={lab("email", "Email")} required htmlFor="ex-email" error={errors.email}><EmailInput id="ex-email" value={email} onChange={setEmail} invalid={!!errors.email} /></Row>,
    date: p.edit
      ? <Row label={lab("date", "Date")}><p className="py-2">{formatDateTime(p.edit.requestedAt)}</p></Row>
      : <Row label={lab("date", "Date")} htmlFor="ex-requested"><DateTimeInput id="ex-requested" value={requestedAt} onChange={setRequestedAt} /></Row>,
    category: (
      <Row label={lab("category", "Category")} required htmlFor="ex-category" error={errors.category}>
        <SearchSelect id="ex-category" options={categories} value={categoryId} onChange={setCategoryId} invalid={!!errors.category} add={addCategory} />
      </Row>
    ),
    nature: <Row label={lab("nature", "Nature of Expenditure")} htmlFor="ex-nature"><TextArea id="ex-nature" value={nature} onChange={setNature} /></Row>,
    vendor: <Row label={lab("vendor", "Vendor Name")} required htmlFor="ex-vendor" error={errors.vendor}><TextArea id="ex-vendor" value={vendor} onChange={setVendor} rows={3} /></Row>,
    amount: amountRow,
    quotation: <Row label={lab("quotation", "Quotation")} htmlFor="ex-quotation"><FileInput id="ex-quotation" label="Quotation" value={quotation} onChange={setQuotation} onBusy={busy} /></Row>,
  };
  const rows: Record<string, React.ReactNode> = {
    ...shared,
    file: <Row label={lab("file", "File upload")} htmlFor="ex-file"><FileInput id="ex-file" label="File upload" value={fileUpload} onChange={setFileUpload} onBusy={busy} /></Row>,
    expenseDate: <Row label={lab("expenseDate", "Date")} htmlFor="ex-expense-date"><DateInput id="ex-expense-date" value={expenseDate} onChange={setExpenseDate} /></Row>,
    publication: (
      <>
        <Row label={lab("publication", "Type of Publication")} htmlFor="ex-pub-type" error={errors.pubType}>
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
      </>
    ),
    invoice: <Row label={lab("invoice", "Tax Invoice")} htmlFor="ex-invoice"><FileInput id="ex-invoice" label="Tax Invoice" value={taxInvoice} onChange={setTaxInvoice} onBusy={busy} /></Row>,
    invoiceDate: <Row label={lab("invoiceDate", "Date of Tax Invoice")} htmlFor="ex-invoice-date" error={errors.taxInvoiceDate}><DateInput id="ex-invoice-date" value={taxInvoiceDate} onChange={setTaxInvoiceDate} max={todayIST()} invalid={!!errors.taxInvoiceDate} /></Row>,
  };

  return (
    <form className="zf" onSubmit={onSubmit} noValidate>
      {p.edit && <ReturnedNotice edit={p.edit} />}
      {ordered(fields, rows, custom, (k, v) => setCustom((c) => ({ ...c, [k]: v })), errors)}
      {p.edit && <CurrentFiles edit={p.edit} keep={keep} setKeep={setKeep} />}
      {formError && <p className="zf-error mb-3" role="alert">{formError}</p>}
      <FormActions submitting={submitting} disabled={uploads > 0 || !!wrong} onReset={reset} label={p.edit ? "Resubmit" : "Submit"} resetLabel={p.edit ? "Cancel" : "Reset"} />
    </form>
  );
}
