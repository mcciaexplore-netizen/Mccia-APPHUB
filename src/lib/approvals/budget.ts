/**
 * The Budget Approval form's money and revision rules as plain functions: no database, no server-only imports, so the form (its live totals
 * and the Surplus/Deficit summary), the server, the request page and the unit tests run the same code. All amounts are integer paise.
 *
 * A budget is one request (type "budget") sent to one approver the requester picks. Once it is approved, the person who raised it can ask
 * for a revision: a new request of its own, linked to the original (parent_request_id) and numbered Rev 1, Rev 2, ... Each revision needs a
 * fresh approval, only one can be open at a time, and the budget in force is the latest approved version (a rejected revision changes
 * nothing).
 */
import type { AprRequestStatus } from "@/db/approvals-schema";

/** One line of a budget's income or of its expenses: what it is, and how much (paise, zero or more). */
export type BudgetLine = { name: string; amountPaise: number };

/**
 * The four fixed income lines the form had before income became a list of named rows. Budgets raised then keep them as they were stored
 * ({ sponsorshipPaise, ... }); they are read back as rows (see incomeLinesOf), so old and new budgets show and print the same way.
 */
export type LegacyIncome = { sponsorshipPaise: number | null; stallPaise: number | null; participantsPaise: number | null; otherPaise: number | null };
const LEGACY_INCOME: { key: keyof LegacyIncome; name: string }[] = [
  { key: "sponsorshipPaise", name: "Sponsorship income" },
  { key: "stallPaise", name: "Stall income" },
  { key: "participantsPaise", name: "Participants income" },
  { key: "otherPaise", name: "Other income" },
];

/** A budget's income rows: the named rows it was raised with, or an older budget's fixed lines turned into rows (empty ones left out). */
export function incomeLinesOf(d: { incomeLines?: BudgetLine[] | null; income?: LegacyIncome | null }): BudgetLine[] {
  if (d.incomeLines) return d.incomeLines;
  const old = d.income;
  return old ? LEGACY_INCOME.flatMap((l) => (old[l.key] == null ? [] : [{ name: l.name, amountPaise: old[l.key]! }])) : [];
}
/** A budget's expense rows (budgets raised before expenses were asked for have none). */
export const expenseLinesOf = (d: { expenseLines?: BudgetLine[] | null }): BudgetLine[] => d.expenseLines ?? [];

/** A budget's vendor rows: each vendor with its amount. Budgets raised when vendors were names only read back with ₹0 against each. */
export const vendorLinesOf = (d: { vendorLines?: BudgetLine[] | null; vendors?: string[] | null }): BudgetLine[] =>
  d.vendorLines ?? (d.vendors ?? []).map((name) => ({ name, amountPaise: 0 }));

/** The rows added up. */
export const linesTotal = (lines: readonly { amountPaise: number }[]): number => lines.reduce((sum, l) => sum + l.amountPaise, 0);

export type BudgetBalance = { kind: "surplus" | "deficit" | "balanced"; amountPaise: number };
/**
 * The budget summary: total income against what goes out (total expense plus total vendor amount, added up by the caller). More income is a surplus, more expense a deficit (the amount is how much, never
 * negative), the same is balanced (₹0).
 */
export function budgetBalance(incomePaise: number, expensePaise: number): BudgetBalance {
  const diff = incomePaise - expensePaise;
  return { kind: diff > 0 ? "surplus" : diff < 0 ? "deficit" : "balanced", amountPaise: Math.abs(diff) };
}
export const BALANCE_LABEL: Record<BudgetBalance["kind"], string> = { surplus: "Surplus", deficit: "Deficit", balanced: "Balanced" };

/** "Original" for the first budget, "Rev 1", "Rev 2", ... for its revisions. */
export const versionLabel = (revisionNo: number | null | undefined): string => (revisionNo ? `Rev ${revisionNo}` : "Original");

/** The vendor names worth keeping: trimmed, with empty ones left out. */
export const cleanVendors = (names: readonly string[]): string[] => names.map((n) => n.trim()).filter(Boolean);

export type BudgetVersion = { id: string; revisionNo: number | null; status: AprRequestStatus };

/**
 * The version in force: the latest approved one (the original counts as version 0). Null while nothing is approved yet. A rejected or
 * withdrawn revision is passed over, so the budget approved before it stays in force.
 */
export function activeVersion<T extends BudgetVersion>(versions: readonly T[]): T | null {
  let best: T | null = null;
  for (const v of versions) if (v.status === "approved" && (!best || (v.revisionNo ?? 0) > (best.revisionNo ?? 0))) best = v;
  return best;
}

/** Why a budget cannot be revised now, or null when it can. `versions`: the original and every revision of it. */
export function revisionBlocker(original: { status: AprRequestStatus; requesterUserId: string }, versions: readonly BudgetVersion[], actorId: string): string | null {
  if (original.requesterUserId !== actorId) return "Only the person who raised this budget can ask for a revision.";
  if (original.status !== "approved") return "Only an approved budget can be revised.";
  if (versions.some((v) => v.revisionNo && (v.status === "pending" || v.status === "draft"))) return "A revision of this budget is already waiting for approval. Wait for it to be decided before asking for another.";
  return null;
}

/** The number the next revision gets: one more than the highest so far (1 for the first). */
export const nextRevisionNo = (versions: readonly { revisionNo: number | null }[]): number => Math.max(0, ...versions.map((v) => v.revisionNo ?? 0)) + 1;

/**
 * A budget's own ID, given when it is approved: BUD-<year>-<number>, the year written short ("2026-27" → "2627") and the number counted in
 * the order budgets of that year are approved: BUD-2627-0001, BUD-2627-0002, ..., then BUD-2728-0001. HR and expenditure numbers spell the year out ("HR-2026-27-0001") and start
 * with other letters, so a budget ID can never be one of theirs.
 */
export const budgetRequestNo = (financialYear: string, n: number): string =>
  `BUD-${financialYear.slice(2, 4)}${financialYear.slice(5, 7)}-${String(n).padStart(4, "0")}`;

/**
 * What a budget's ID says, from its request number and status. The permanent ID of a budget is given when it is approved, so until then an
 * original budget has none: "Pending approval" while it waits, "Not assigned" once rejected or withdrawn. A revision's number (the
 * original's with -R1, -R2) is known from the start, as the original is already approved: shown with "(Pending)" until it is approved.
 */
export type BudgetIdView = { text: string; kind: "assigned" | "pending" | "none" };
export function budgetIdView(r: { requestNo: string | null; status: AprRequestStatus }): BudgetIdView {
  if (r.status === "approved" && r.requestNo) return { text: r.requestNo, kind: "assigned" };
  if (r.status === "pending" || r.status === "returned" || r.status === "draft") return r.requestNo ? { text: `${r.requestNo} (Pending)`, kind: "pending" } : { text: "Pending approval", kind: "pending" };
  return { text: "Not assigned", kind: "none" };
}

/** A request's number as lists show it: a budget's ID as above, anything else its number. */
export const requestNoText = (r: { type: string; requestNo: string | null; status: AprRequestStatus }): string =>
  r.type === "budget" ? budgetIdView(r).text : (r.requestNo ?? "—");

/** A revision's request number: the original's with "-R1", "-R2", ... after it. */
export const revisionRequestNo = (originalNo: string, revisionNo: number): string => `${originalNo}-R${revisionNo}`;
