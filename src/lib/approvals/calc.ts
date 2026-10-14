/**
 * The module's money and routing rules as plain functions: no database, no server-only imports, so the forms (live budget boxes,
 * the "wrong form" message) and the server run exactly the same code. All amounts are integer paise.
 */
import { formatINR } from "./format";

export type ExpenditureForm = "large" | "small";

/** What the budget table says for one branch, category and financial year. `allocatedPaise` is null when no budget was ever set. */
export type BudgetPosition = { allocatedPaise: number | null; spentPaise: number; pendingPaise: number };

export type BudgetAssessment = {
  /** No budget row exists for this branch, category and year. */
  noBudget: boolean;
  allocatedPaise: number | null;
  /** Allocated minus approved spend, before this request. Null when there is no budget. */
  availablePaise: number | null;
  /** Available minus this amount: what would be left. Negative when the request goes over. Null when there is no budget. */
  afterPaise: number | null;
  /** How far over the available budget the request goes (0 when it fits). */
  excessPaise: number;
  /** True when the amount is more than what is left, or there is no budget at all. Such a request is flagged, never blocked. */
  overBudget: boolean;
};

/** Only approved requests use up budget; pending ones are shown for information (see BudgetPosition.pendingPaise). */
export function assessBudget(position: BudgetPosition, amountPaise: number): BudgetAssessment {
  if (position.allocatedPaise == null) {
    return { noBudget: true, allocatedPaise: null, availablePaise: null, afterPaise: null, excessPaise: 0, overBudget: true };
  }
  const available = position.allocatedPaise - position.spentPaise;
  const after = available - amountPaise;
  return {
    noBudget: false,
    allocatedPaise: position.allocatedPaise,
    availablePaise: available,
    afterPaise: after,
    excessPaise: after < 0 ? -after : 0,
    overBudget: after < 0,
  };
}

/** The warning shown under a form when a request is flagged. Null when there is nothing to warn about. */
export function budgetWarning(a: BudgetAssessment): string | null {
  if (a.noBudget) return "No budget allocated for this branch, category and year. The request can still be submitted and will be flagged.";
  if (a.overBudget) return `This request exceeds the remaining budget by ${formatINR(a.excessPaise, { symbol: true })}.`;
  return null;
}

/** An expenditure of exactly the threshold counts as "large": 10,000 and above goes to the DG, 9,999.99 and below does not. */
export const formFor = (amountPaise: number, thresholdPaise: number): ExpenditureForm => (amountPaise >= thresholdPaise ? "large" : "small");

/** The message for an amount typed into the wrong expenditure form, or null when it belongs. The page adds the link to the other form. */
export function wrongFormMessage(form: ExpenditureForm, amountPaise: number | null, thresholdPaise: number): string | null {
  if (amountPaise == null || amountPaise <= 0) return null;
  const limit = formatINR(thresholdPaise, { symbol: true }).replace(/\.00$/, "");
  if (form === "small" && amountPaise >= thresholdPaise) return `Amounts of ${limit} and above must be submitted through DG Expenditure Approval.`;
  if (form === "large" && amountPaise < thresholdPaise) return `Amounts below ${limit} must be submitted through the Expenses form.`;
  return null;
}

/* ---------------------------------------------------------------- approver steps */

export type RuleLike = {
  stepNo: number;
  stepLabel: string;
  minAmountPaise: number;
  maxAmountPaise: number | null;
  approverUserIds: readonly string[];
  active: boolean;
};
type PlannedStep = { stepNo: number; stepLabel: string; approverUserId: string };
export type StepPlan = { steps: PlannedStep[]; problem: null } | { steps: []; problem: "no-approver" | "only-self" };

/**
 * Turns a request type's routing rules into the steps this request will go through, in order.
 * - A rule applies when its amount band holds the amount (min inclusive, max exclusive, no max means no upper bound).
 * - A rule with nobody named is skipped, so leaving "Reviewer" empty makes the DG the only approver.
 * - A step goes to the first person named who is not the requester: nobody approves their own request, and a step that can
 *   only be done by the requester is dropped. If nothing is left the request cannot be routed, and the reason says why.
 */
export function planSteps(rules: readonly RuleLike[], requesterUserId: string, amountPaise: number): StepPlan {
  const applicable = rules
    .filter((r) => r.active && amountPaise >= r.minAmountPaise && (r.maxAmountPaise == null || amountPaise < r.maxAmountPaise))
    .sort((a, b) => a.stepNo - b.stepNo);
  const staffed = applicable.filter((r) => r.approverUserIds.length > 0);
  if (staffed.length === 0) return { steps: [], problem: "no-approver" };
  const steps: PlannedStep[] = [];
  for (const r of staffed) {
    const approver = r.approverUserIds.find((id) => id !== requesterUserId);
    if (approver) steps.push({ stepNo: steps.length + 1, stepLabel: r.stepLabel, approverUserId: approver });
  }
  return steps.length ? { steps, problem: null } : { steps: [], problem: "only-self" };
}

export const planProblemMessage = (p: "no-approver" | "only-self"): string =>
  p === "no-approver"
    ? "No approver has been set up for this kind of request yet. Ask an Approvals admin to name one under Approver Rules."
    : "You are the only approver set up for this kind of request, and nobody can approve their own request. Ask an Approvals admin to name someone else.";

/* ---------------------------------------------------------------- decisions */

/** Whether the approver must write a comment: always to reject, and also to approve a request that is over budget. */
export function commentRequired(action: "approve" | "reject", overBudget: boolean): boolean {
  return action === "reject" || overBudget;
}

/** Percent of a budget used, as a whole number; null when there is no budget to compare with. */
export function percentUsed(allocatedPaise: number | null, spentPaise: number): number | null {
  if (allocatedPaise == null) return null;
  if (allocatedPaise <= 0) return spentPaise > 0 ? 100 : 0;
  return Math.round((spentPaise / allocatedPaise) * 100);
}

/** Utilisation colouring: above 90% is amber, above 100% is red. */
export const utilisationLevel = (pct: number | null): "ok" | "warn" | "over" => (pct == null || pct <= 90 ? "ok" : pct <= 100 ? "warn" : "over");

/* ---------------------------------------------------------------- request numbers */

export const REQUEST_PREFIX = { hr: "HR", expenditure_large: "EXP", expenditure_small: "EXB" } as const;

/** "EXP", "2026-27", 1 -> "EXP-2026-27-0001". The counter restarts every financial year. */
export const formatRequestNo = (prefix: string, financialYear: string, n: number) => `${prefix}-${financialYear}-${String(n).padStart(4, "0")}`;

/* ---------------------------------------------------------------- labels */

export const TYPE_LABEL = { hr: "HR request", expenditure_large: "Expenditure request", expenditure_small: "Expense request" } as const;
export const STATUS_LABEL = { draft: "Draft", pending: "Pending", approved: "Approved", rejected: "Rejected", withdrawn: "Withdrawn" } as const;
