import "server-only";
import { z } from "zod";
import type { EditInfo, ExpenditureFormProps, HrFormProps } from "@/components/approvals/RequestForms";
import { hasRole, listUsers, type ApprovalsUser } from "./host-adapter";
import { listMaster, type MasterRow } from "./masters";
import { formatINR } from "./format";
import type { EditValues } from "./request-queries";
import { getSettings } from "./settings";

const byName = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);
const options = (rows: MasterRow[]) => rows.map((r) => ({ value: r.id, label: r.name })).sort(byName);

const uuid = z.string().uuid();
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const idOrEmpty = (v: string | string[] | undefined) => (uuid.safeParse(first(v)).success ? first(v) : "");

/** Everything an expenditure form needs, read once on the server so the form opens with its lists already filled. */
export async function expenditureFormProps(
  form: "large" | "small", user: ApprovalsUser, search: Record<string, string | string[] | undefined>,
): Promise<ExpenditureFormProps> {
  const [categories, branches, types, publications, people, settings] = await Promise.all([
    listMaster("categories", false), listMaster("branches", false), listMaster("publication-types", false), listMaster("publications", false), listUsers(), getSettings(),
  ]);
  const amount = first(search.amount);
  return {
    form,
    people: people.map((u) => ({ value: u.id, label: u.name, email: u.email })).sort(byName),
    meId: user.id,
    categories: options(categories),
    branches: options(branches),
    publicationTypes: options(types),
    publications: publications.filter((p) => p.publicationTypeId).map((p) => ({ value: p.id, label: p.name, typeId: p.publicationTypeId! })).sort(byName),
    thresholdPaise: settings.thresholdPaise,
    canAdd: hasRole(user, "approvals_admin"),
    now: new Date().toISOString(),
    initial: {
      employeeId: idOrEmpty(search.employee), email: first(search.email).slice(0, 200), categoryId: idOrEmpty(search.category), branchId: idOrEmpty(search.branch),
      nature: first(search.nature).slice(0, 2000), vendor: first(search.vendor).slice(0, 500), amount: /^[\d.,\s]{0,20}$/.test(amount) ? amount : "",
    },
  };
}

export async function hrFormProps(user: ApprovalsUser, edit?: { requestId: string; values: EditValues }): Promise<HrFormProps> {
  const [categories, branches, expenseCategories] = await Promise.all([listMaster("hr-categories", false), listMaster("branches", false), listMaster("categories", false)]);
  const hr = edit?.values.hr;
  return {
    me: { name: user.name, email: user.email },
    categories: options(categories),
    branches: options(branches),
    expenseCategories: options(expenseCategories),
    canAdd: hasRole(user, "approvals_admin"),
    now: new Date().toISOString(),
    edit: edit && hr
      ? {
          ...editInfo(edit.requestId, edit.values),
          initial: {
            first: hr.firstName, last: hr.lastName, email: edit.values.requesterEmail, categoryId: hr.hrCategoryId, description: hr.description ?? "",
            amount: edit.values.amountPaise == null ? "" : formatINR(edit.values.amountPaise), branchId: hr.branchId ?? "", budgetCategoryId: hr.budgetCategoryId ?? "",
          },
        }
      : undefined,
  };
}

/** What the correction form shows about the request: its own date, its files, and why it came back. */
const editInfo = (requestId: string, v: EditValues): EditInfo => ({
  requestId, requestedAt: v.requestedAt.toISOString(),
  attachments: v.attachments.map((a) => ({ id: a.id, slot: a.slot, fileName: a.fileName, size: a.size })),
  returnedBy: v.returnedBy, returnComment: v.returnComment,
});

/** The expenditure form opened on a returned request: the same lists as a new one, filled with the request's own values. */
export async function expenditureEditProps(user: ApprovalsUser, requestId: string, v: EditValues): Promise<ExpenditureFormProps> {
  const e = v.expenditure!;
  const base = await expenditureFormProps(v.type === "expenditure_large" ? "large" : "small", user, {});
  // The Name list holds people, and a request keeps the name it was raised for: find them again by name, then by email.
  const person = base.people.find((x) => x.label === v.requesterName) ?? base.people.find((x) => x.email.toLowerCase() === v.requesterEmail.toLowerCase());
  return {
    ...base,
    edit: editInfo(requestId, v),
    initial: {
      employeeId: person?.value ?? "", email: v.requesterEmail, categoryId: e.categoryId, branchId: e.branchId, nature: e.nature ?? "", vendor: e.vendorName ?? "",
      amount: v.amountPaise == null ? "" : formatINR(v.amountPaise), expenseDate: e.expenseDate ?? "", taxInvoiceDate: e.taxInvoiceDate ?? "",
      pubTypeId: e.publicationTypeId ?? "", pubId: e.publicationId ?? "",
    },
  };
}
