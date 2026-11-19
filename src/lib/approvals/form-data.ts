import "server-only";
import { z } from "zod";
import type { EditInfo, ExpenditureFormProps, HrFormProps } from "@/components/approvals/RequestForms";
import type { BudgetFormProps } from "@/components/approvals/BudgetForm";
import { hasRole, listUsers, type ApprovalsUser } from "./host-adapter";
import { departmentOptions } from "./departments";
import { getFormFields } from "./form-config";
import { listMaster, type MasterRow } from "./masters";
import { financialYearOf, formatINR, recentFinancialYears } from "./format";
import { versionLabel } from "./budget";
import type { EditValues, RequestDetail } from "./request-queries";
import { getSettings } from "./settings";

const byName = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);
const options = (rows: MasterRow[]) => rows.map((r) => ({ value: r.id, label: r.name })).sort(byName);

const uuid = z.string().uuid();
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const idOrEmpty = (v: string | string[] | undefined) => (uuid.safeParse(first(v)).success ? first(v) : "");
const moneyOrEmpty = (v: string | string[] | undefined) => (/^[\d.,\s]{0,20}$/.test(first(v)) ? first(v) : "");
/** A budget figure in paise as the money box shows it, or empty when there is none. */
const money = (paise: number | null | undefined) => (paise == null ? "" : formatINR(paise));

/** Everything an expenditure form needs, read once on the server so the form opens with its lists already filled. */
export async function expenditureFormProps(
  form: "large" | "small", user: ApprovalsUser, search: Record<string, string | string[] | undefined>,
): Promise<ExpenditureFormProps> {
  const [categories, branches, types, publications, people, settings, fields] = await Promise.all([
    listMaster("categories", false), listMaster("branches", false), listMaster("publication-types", false), listMaster("publications", false), listUsers(), getSettings(), getFormFields("small"),
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
    fields,
    canAdd: hasRole(user, "approvals_admin"),
    now: new Date().toISOString(),
    initial: {
      employeeId: idOrEmpty(search.employee), email: first(search.email).slice(0, 200), categoryId: idOrEmpty(search.category), branchId: idOrEmpty(search.branch),
      nature: first(search.nature).slice(0, 2000), vendor: first(search.vendor).slice(0, 500), amount: /^[\d.,\s]{0,20}$/.test(amount) ? amount : "",
      budgetAllocated: moneyOrEmpty(search.allocated), budgetUsed: moneyOrEmpty(search.used),
    },
  };
}

export async function hrFormProps(user: ApprovalsUser, edit?: { requestId: string; values: EditValues }): Promise<HrFormProps> {
  const [categories, fields] = await Promise.all([listMaster("hr-categories", false), getFormFields("hr")]);
  const hr = edit?.values.hr;
  return {
    me: { name: user.name, email: user.email },
    categories: options(categories),
    fields,
    canAdd: hasRole(user, "approvals_admin"),
    now: new Date().toISOString(),
    edit: edit && hr
      ? {
          ...editInfo(edit.requestId, edit.values),
          initial: {
            first: hr.firstName, last: hr.lastName, email: edit.values.requesterEmail, categoryId: hr.hrCategoryId, description: hr.description ?? "",
            amount: edit.values.amountPaise == null ? "" : formatINR(edit.values.amountPaise), budgetAllocated: money(hr.budget?.allocatedPaise), budgetUsed: money(hr.budget?.usedPaise),
          },
        }
      : undefined,
  };
}

/** What the correction form shows about the request: its own date, its files, and why it came back. */
const editInfo = (requestId: string, v: EditValues): EditInfo => ({
  requestId, requestedAt: v.requestedAt.toISOString(),
  attachments: v.attachments.map((a) => ({ id: a.id, slot: a.slot, fileName: a.fileName, size: a.size })),
  returnedBy: v.returnedBy, returnComment: v.returnComment, custom: v.custom,
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
      employeeId: person?.value ?? "", email: v.requesterEmail, categoryId: e.categoryId, branchId: e.branchId ?? "", nature: e.nature ?? "", vendor: e.vendorName ?? "",
      amount: v.amountPaise == null ? "" : formatINR(v.amountPaise), budgetAllocated: money(e.budget.allocatedPaise), budgetUsed: money(e.budget.usedPaise), expenseDate: e.expenseDate ?? "", taxInvoiceDate: e.taxInvoiceDate ?? "",
      pubTypeId: e.publicationTypeId ?? "", pubId: e.publicationId ?? "",
    },
  };
}

/* ---------------------------------------------------------------- budget */

/** Everyone in the hub but the person filling the form in, as approver choices: "Name (email)", so two people of the same name differ. */
async function approverOptions(user: ApprovalsUser) {
  return (await listUsers()).filter((u) => u.id !== user.id).map((u) => ({ value: u.id, label: `${u.name} (${u.email})` })).sort(byName);
}

/** The Budget Approval form: the hub's departments, the financial years (this one first, the next one too, and the last few), and the approvers. */
export async function budgetFormProps(user: ApprovalsUser): Promise<BudgetFormProps> {
  const [departments, people, fields] = await Promise.all([departmentOptions(), approverOptions(user), getFormFields("budget")]);
  return {
    fields,
    people,
    departments,
    financialYears: recentFinancialYears(4),
    defaultFinancialYear: financialYearOf(),
  };
}

/**
 * The revision form of a budget: it starts from `base`, the latest version still standing (waiting or approved), with every field
 * editable, and the approver that version went to. `asked` is the request the person opened (the original or a revision).
 */
export async function budgetRevisionProps(user: ApprovalsUser, asked: RequestDetail, base: RequestDetail): Promise<BudgetFormProps> {
  const b = base.budget!;
  const [departments, people, fields] = await Promise.all([departmentOptions(), approverOptions(user), getFormFields("budget")]);
  // A hub department is stored by its own id; on the list it is "hub:<id>". One no longer on the list is offered as it was.
  const d = b.details;
  const dept = departments.find((o) => o.value === d.departmentId) ?? departments.find((o) => o.value === `hub:${d.departmentId}`);
  const deptOptions = dept ? departments : [...departments, { value: d.departmentId, label: d.departmentName }];
  const years = recentFinancialYears(4);
  const history = asked.budget!.history;
  return {
    fields,
    people,
    departments: deptOptions,
    financialYears: years.includes(d.financialYear) ? years : [d.financialYear, ...years],
    defaultFinancialYear: d.financialYear,
    revision: {
      requestId: asked.id, requestNo: history[0]?.requestNo ?? null, baseLabel: versionLabel(b.revisionNo),
      eventName: d.eventName, description: d.description, departmentId: dept?.value ?? d.departmentId, departmentName: d.departmentName, financialYear: d.financialYear,
      budgetPaise: base.amountPaise ?? 0, incomeLines: b.incomeLines, expenseLines: b.expenseLines, vendorLines: b.vendorLines,
      approverUserId: b.approverUserId, custom: b.customByKey, replacesRevisionNo: b.waitingRevisionNo,
    },
  };
}
