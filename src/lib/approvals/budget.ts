/**
 * The Budget Approval form's money and revision rules as plain functions: no database, no server-only imports, so the form (its live Total
 * income and Net budget boxes), the server and the unit tests run the same code. All amounts are integer paise.
 *
 * A budget is one request (type "budget") sent to one approver the requester picks. Once it is approved, the person who raised it can ask
 * for a revision: a new request of its own, linked to the original (parent_request_id) and numbered Rev 1, Rev 2, ... Each revision needs a
 * fresh approval, only one can be open at a time, and the budget in force is the latest approved version (a rejected revision changes
 * nothing).
 */
import type { AprRequestStatus } from "@/db/approvals-schema";

export type BudgetIncome = { sponsorshipPaise: number | null; stallPaise: number | null; participantsPaise: number | null; otherPaise: number | null };

/** The four income lines, in the order the form and the printed page show them. */
export const INCOME_LINES: { key: keyof BudgetIncome; label: string }[] = [
  { key: "sponsorshipPaise", label: "Sponsorship income" },
  { key: "stallPaise", label: "Stall income" },
  { key: "participantsPaise", label: "Participants income" },
  { key: "otherPaise", label: "Other income" },
];

/** Total income: the lines that were filled in, added up (an empty line counts as nothing). */
export const totalIncome = (i: BudgetIncome): number => INCOME_LINES.reduce((sum, l) => sum + (i[l.key] ?? 0), 0);

/** Net budget = budget amount − total income. Below zero when the income is more than the budget. */
export const netBudget = (budgetPaise: number, i: BudgetIncome): number => budgetPaise - totalIncome(i);

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

/** A revision's request number: the original's with "-R1", "-R2", ... after it. */
export const revisionRequestNo = (originalNo: string, revisionNo: number): string => `${originalNo}-R${revisionNo}`;
