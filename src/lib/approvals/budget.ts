/**
 * The Budget Approval form's money and revision rules as plain functions: no database, no server-only imports, so the form (its live totals
 * and the Surplus/Deficit summary), the server, the request page and the unit tests run the same code. All amounts are integer paise.
 *
 * A budget is one request (type "budget") sent to one approver the requester picks. The person who raised it can ask
 * for a revision at any stage: a new request of its own, linked to the original (parent_request_id) and numbered Rev 1, Rev 2, ... Each
 * revision needs a fresh approval; only one can wait at a time (a new one replaces it); the budget in force is the latest approved version (a
 * rejected revision changes nothing). The Budget ID is given when the first version is approved, and every version shows that same ID.
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

/**
 * Why this person cannot revise the budget, or null when they can. Only the person who raised it may, at any stage: while the original
 * still waits, once it is approved or rejected, and while a revision waits (the new revision then replaces the waiting one).
 */
export function revisionBlocker(original: { status: AprRequestStatus; requesterUserId: string }, _versions: readonly BudgetVersion[], actorId: string): string | null {
  if (original.requesterUserId !== actorId) return "Only the person who raised this budget can ask for a revision.";
  if (original.status === "draft") return "This budget has not been submitted yet.";
  return null;
}

/** The revision a new one replaces: an earlier revision still waiting for its approver (at most one waits at a time). */
export const waitingRevision = <T extends BudgetVersion>(versions: readonly T[]): T | null =>
  versions.find((v) => v.revisionNo && (v.status === "pending" || v.status === "returned")) ?? null;

/**
 * The version a revision starts from: the latest one still standing (waiting or approved), or, when every version was rejected or
 * withdrawn, the latest of them.
 */
export function revisionBase<T extends BudgetVersion>(versions: readonly T[]): T | null {
  const byNo = [...versions].sort((a, b) => (b.revisionNo ?? 0) - (a.revisionNo ?? 0));
  return byNo.find((v) => v.status === "pending" || v.status === "approved" || v.status === "returned") ?? byNo[0] ?? null;
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
 * The Budget ID, the same for every version of a budget: BUD-2627-0001 for the original and each of its revisions. It is given once, when the
 * first version is approved, and never changes. (Request numbers must be unique, so a revision's own row keeps the ID with "-R<n>" after it;
 * that is only how it is stored, and is never shown.)
 */
export const budgetIdOf = (requestNo: string): string => requestNo.replace(/-R\d+$/, "");

/**
 * What a version's Budget ID says. Once the budget has its ID, every version shows it (the version itself is told apart in the Budget History:
 * Original, Revision 1, ...). Before that: "Pending approval" while it waits, "Not assigned" once rejected or withdrawn.
 */
export type BudgetIdView = { text: string; kind: "assigned" | "pending" | "none" };
export function budgetIdView(r: { requestNo: string | null; status: AprRequestStatus }): BudgetIdView {
  if (r.requestNo) return { text: budgetIdOf(r.requestNo), kind: "assigned" };
  if (r.status === "pending" || r.status === "returned" || r.status === "draft") return { text: "Pending approval", kind: "pending" };
  return { text: "Not assigned", kind: "none" };
}

/** A request's number as lists show it: a budget's ID as above, anything else its number. */
export const requestNoText = (r: { type: string; requestNo: string | null; status: AprRequestStatus }): string =>
  r.type === "budget" ? budgetIdView(r).text : (r.requestNo ?? "—");

/** How a revision's row stores the Budget ID (unique per row): the ID with "-R1", "-R2", ... after it. Shown as the ID alone (budgetIdOf). */
export const revisionRequestNo = (originalNo: string, revisionNo: number): string => `${originalNo}-R${revisionNo}`;

/* ---------------------------------------------------------------- comparing versions */

/** One row of income, expenses or vendors between two versions: added, removed, its amount changed, or the same. */
export type LineChange = { kind: "added" | "removed" | "changed" | "unchanged"; name: string; beforePaise: number | null; afterPaise: number | null };

const lineKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * What changed in a list of rows from one version to the next. Rows are matched by name (any capitals or spacing); a name used twice is
 * matched in order. The later version's rows come first, in its order, then the rows it no longer has.
 */
export function diffLines(before: readonly BudgetLine[], after: readonly BudgetLine[]): LineChange[] {
  const left = new Map<string, BudgetLine[]>();
  for (const l of before) left.set(lineKey(l.name), [...(left.get(lineKey(l.name)) ?? []), l]);
  const out: LineChange[] = after.map((l) => {
    const was = left.get(lineKey(l.name))?.shift();
    if (!was) return { kind: "added", name: l.name, beforePaise: null, afterPaise: l.amountPaise };
    return { kind: was.amountPaise === l.amountPaise ? "unchanged" : "changed", name: l.name, beforePaise: was.amountPaise, afterPaise: l.amountPaise };
  });
  for (const rest of left.values()) for (const l of rest) out.push({ kind: "removed", name: l.name, beforePaise: l.amountPaise, afterPaise: null });
  return out;
}

/** A version as compared: its rows and its Total Budget Requested. */
export type ComparableVersion = { incomeLines: BudgetLine[]; expenseLines: BudgetLine[]; vendorLines: BudgetLine[]; amountPaise: number | null };
export type VersionComparison = {
  income: LineChange[];
  expenses: LineChange[];
  vendors: LineChange[];
  /** Total Budget Requested before and after, and by how much it went up (negative: down). */
  total: { beforePaise: number; afterPaise: number; changePaise: number };
  /** The Surplus / Deficit before and after. */
  balance: { before: BudgetBalance; after: BudgetBalance };
};

/** Everything that changed from one version of a budget to another. */
export function compareVersions(from: ComparableVersion, to: ComparableVersion): VersionComparison {
  const balanceOf = (v: ComparableVersion) => budgetBalance(linesTotal(v.incomeLines), linesTotal(v.expenseLines) + linesTotal(v.vendorLines));
  const [b, a] = [from.amountPaise ?? 0, to.amountPaise ?? 0];
  return {
    income: diffLines(from.incomeLines, to.incomeLines),
    expenses: diffLines(from.expenseLines, to.expenseLines),
    vendors: diffLines(from.vendorLines, to.vendorLines),
    total: { beforePaise: b, afterPaise: a, changePaise: a - b },
    balance: { before: balanceOf(from), after: balanceOf(to) },
  };
}

/**
 * The comparisons offered between the versions of a budget (given oldest first, the original at 0): each revision against the version just
 * before it, and from Revision 2 on, the original against it too. As [from, to] positions.
 */
export function comparisonPairs(count: number): [number, number][] {
  const pairs: [number, number][] = [];
  for (let to = 1; to < count; to++) {
    pairs.push([to - 1, to]);
    if (to > 1) pairs.push([0, to]);
  }
  return pairs;
}
