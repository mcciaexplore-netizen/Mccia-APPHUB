import { EXPENSE_MODULES, ROUTES } from "./routes.js";

/**
 * The sidebar for each person: [label, address, modules whose pending count is shown beside it].
 * Staff see their own submissions; Shrotri and Satavisha see what waits for them and what they decided; the DG sees what was escalated
 * and the full history. People who manage budgets and masters (can_manage) get those two links added by the layout.
 */
export const NAV = {
  employee: [
    ["My Expenses", ROUTES.list("mine", EXPENSE_MODULES)],
    ["My HR Requests", ROUTES.list("mine", "hr")],
    ["My Reimbursements", ROUTES.list("mine", "reimbursement")],
    ["My Events", ROUTES.list("mine", "event")],
  ],
  shrotri: [
    ["Pending Expenditures", ROUTES.list("pending", EXPENSE_MODULES), ["expenditure", "dg_expenditure"]],
    ["Pending Reimbursements", ROUTES.list("pending", "reimbursement"), ["reimbursement"]],
    ["Pending Events", ROUTES.list("pending", "event"), ["event"]],
    ["Approved", ROUTES.list("approved")],
    ["Rejected", ROUTES.list("rejected")],
  ],
  satavisha: [
    ["Pending HR Requests", ROUTES.list("pending", "hr"), ["hr"]],
    ["Approved HR", ROUTES.list("approved", "hr")],
    ["Rejected HR", ROUTES.list("rejected", "hr")],
  ],
  dg: [
    ["All Pending (escalated)", ROUTES.list("pending"), ["expenditure", "dg_expenditure", "hr", "reimbursement", "event"]],
    ["Full History", ROUTES.list("history")],
  ],
};

/** The menu for a signed-in person: their own list (by username, then by role), plus Budgets and Masters when they manage those. */
export function navFor(user) {
  const items = [...(NAV[user.username] ?? NAV[user.role] ?? [])];
  if (user.can_manage) items.push(["Budgets", ROUTES.budgets], ["Masters", ROUTES.masters]);
  return items;
}
