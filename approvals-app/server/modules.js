/**
 * The five forms and who approves them, as data. The server validates against this, and the client draws the forms from it
 * (GET /api/config), so a field is defined in exactly one place.
 *
 * Field types: text, textarea, email, money (rupees), number, date, datetime, select, file, computed (read-only, worked out by the form).
 * A "select" takes its options from `source`: employees, categories, hr_categories, branches, publication_types, publications.
 */

export const THRESHOLD = 10000; // rupees: this and above goes to the DG

const nameAndEmail = [
  { key: "name", label: "Name", type: "select", source: "employees", required: true },
  { key: "email", label: "Email", type: "email", auto: "employeeEmail", readOnly: true },
  { key: "date", label: "Date", type: "datetime", auto: "now", readOnly: true },
];

const expenseBody = [
  { key: "category", label: "Category", type: "select", source: "categories", required: true },
  { key: "nature", label: "Nature of Expenditure", type: "textarea" },
  { key: "branch", label: "Branch Name", type: "select", source: "branches", required: true },
];

const publication = [
  { key: "publication_type", label: "Type of Publication", type: "select", source: "publication_types" },
  { key: "publication", label: "Publication", type: "select", source: "publications", dependsOn: "publication_type" },
];

export const MODULES = {
  expenditure: {
    label: "Expenditure (below ₹10,000)",
    short: "Expenditure",
    prefix: "EXP",
    approvers: ["shrotri"],
    budget: true,
    fields: [
      ...nameAndEmail,
      ...expenseBody,
      { key: "available_budget", label: "Available Budget", type: "computed", compute: "available" },
      { key: "budget_remaining", label: "Budget Remaining", type: "computed", compute: "remaining" },
      { key: "file_upload", label: "File Upload", type: "file" },
      { key: "tax_invoice_date", label: "Date of Tax Invoice", type: "date" },
      { key: "vendor", label: "Vendor Name", type: "textarea", required: true },
      { key: "tax_invoice", label: "Tax Invoice", type: "file" },
      { key: "quotation", label: "Quotation", type: "file" },
      { key: "amount", label: "Amount", type: "money", required: true },
      ...publication,
    ],
  },
  dg_expenditure: {
    label: "DG Approval: Expenditure (₹10,000 and above)",
    short: "DG Expenditure",
    prefix: "DGE",
    approvers: ["shrotri", "dg"],
    budget: true,
    fields: [
      ...nameAndEmail,
      { key: "difference", label: "Difference", type: "computed", compute: "difference" },
      ...expenseBody,
      { key: "budget_allocated", label: "Budget Allocated", type: "computed", compute: "allocated" },
      { key: "available_budget", label: "Available Budget", type: "computed", compute: "available" },
      { key: "budget_remaining", label: "Budget Remaining", type: "computed", compute: "remaining" },
      { key: "file_upload", label: "File Upload", type: "file" },
      { key: "tax_invoice_date", label: "Date of Tax Invoice", type: "date" },
      { key: "vendor", label: "Vendor Name", type: "textarea", required: true },
      { key: "tax_invoice", label: "Tax Invoice", type: "file" },
      { key: "quotation", label: "Quotation", type: "file" },
      { key: "amount", label: "Amount", type: "money", required: true },
      ...publication,
    ],
  },
  hr: {
    label: "DG Approval: HR",
    short: "HR",
    prefix: "HR",
    approvers: ["satavisha", "dg"],
    fields: [
      { key: "first_name", label: "First Name", type: "text", required: true },
      { key: "last_name", label: "Last Name", type: "text", required: true },
      { key: "email", label: "Email", type: "email", required: true },
      { key: "category", label: "Category", type: "select", source: "hr_categories", required: true },
      { key: "date", label: "Date of Request", type: "datetime", auto: "now", readOnly: true },
      { key: "amount", label: "Amount", type: "money" },
      { key: "description", label: "Description", type: "textarea" },
      { key: "file_upload_1", label: "File Upload 1", type: "file" },
      { key: "file_upload_2", label: "File Upload 2", type: "file" },
    ],
  },
  reimbursement: {
    label: "Reimbursement",
    short: "Reimbursement",
    prefix: "REI",
    approvers: ["shrotri"],
    budget: true,
    fields: [
      ...nameAndEmail,
      ...expenseBody,
      { key: "available_budget", label: "Available Budget", type: "computed", compute: "available" },
      { key: "file_upload", label: "File Upload", type: "file" },
      { key: "budget_remaining", label: "Budget Remaining", type: "computed", compute: "remaining" },
      { key: "tax_invoice_date", label: "Date of Tax Invoice", type: "date" },
      ...publication,
      { key: "vendor", label: "Vendor Name", type: "textarea", required: true },
      { key: "tax_invoice", label: "Tax Invoice", type: "file" },
      { key: "quotation", label: "Quotation", type: "file" },
      { key: "amount", label: "Amount", type: "money", required: true },
    ],
  },
  event: {
    label: "Events",
    short: "Event",
    prefix: "EVT",
    approvers: ["shrotri", "dg"], // the DG step is skipped when the budget is within the threshold
    amountKey: "budget_required",
    fields: [
      { key: "event_name", label: "Event Name", type: "text", required: true },
      { key: "event_date", label: "Event Date", type: "date", required: true },
      { key: "venue", label: "Venue", type: "text", required: true },
      { key: "attendees", label: "Expected Attendees", type: "number" },
      { key: "budget_required", label: "Budget Required", type: "money", required: true },
      { key: "description", label: "Description", type: "textarea" },
      { key: "file_upload", label: "File Upload (event proposal)", type: "file" },
      { key: "branch", label: "Branch Name", type: "select", source: "branches", required: true },
    ],
  },
};

export const amountKeyOf = (module) => MODULES[module].amountKey ?? "amount";

/** Who approves, in order. Events only go to the DG when the budget is above the threshold; the DG is final for everything escalated. */
export function stagesFor(module, amountRupees) {
  const m = MODULES[module];
  if (module === "event") return amountRupees > THRESHOLD ? ["shrotri", "dg"] : ["shrotri"];
  return m.approvers;
}

/** The module whose approvers include this person (used for their Approved / Rejected lists). */
export const modulesFor = (username, role) =>
  role === "dg" ? Object.keys(MODULES) : Object.keys(MODULES).filter((k) => MODULES[k].approvers.includes(username));

export const ACTIONS = { approve: "Approved", reject: "Rejected", more_info: "More Info Required" };
export const STATUS = { PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected", INFO: "More Info Required" };
