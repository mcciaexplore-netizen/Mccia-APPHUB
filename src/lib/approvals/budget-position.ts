import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { aprBranches, aprBudgets, aprCategories, aprExpenditureDetails, aprRequests } from "@/db/approvals-schema";
import { percentUsed, type BudgetPosition } from "./calc";

/**
 * How much of a budget is used. Spent is the sum of APPROVED expenditure (both forms) for the branch, category and financial year;
 * pending is shown for information only. Nothing is stored: it is always worked out from the requests, so it can never drift.
 */

type Spend = { branchId: string; categoryId: string; spentPaise: number; pendingPaise: number };

async function spendRows(financialYear: string, only?: { branchId: string; categoryId: string }): Promise<Spend[]> {
  const amount = aprRequests.amountPaise;
  return db
    .select({
      branchId: aprExpenditureDetails.branchId,
      categoryId: aprExpenditureDetails.categoryId,
      spentPaise: sql<number>`coalesce(sum(${amount}) filter (where ${aprRequests.status} = 'approved'), 0)::bigint`.mapWith(Number),
      pendingPaise: sql<number>`coalesce(sum(${amount}) filter (where ${aprRequests.status} = 'pending'), 0)::bigint`.mapWith(Number),
    })
    .from(aprRequests)
    .innerJoin(aprExpenditureDetails, eq(aprExpenditureDetails.requestId, aprRequests.id))
    .where(and(
      eq(aprRequests.financialYear, financialYear),
      inArray(aprRequests.status, ["approved", "pending"]),
      only ? eq(aprExpenditureDetails.branchId, only.branchId) : undefined,
      only ? eq(aprExpenditureDetails.categoryId, only.categoryId) : undefined,
    ))
    .groupBy(aprExpenditureDetails.branchId, aprExpenditureDetails.categoryId);
}

/** The position for one branch, category and financial year; allocated is null when no budget row exists. */
export async function budgetPosition(financialYear: string, branchId: string, categoryId: string): Promise<BudgetPosition> {
  const [budget, spend] = await Promise.all([
    db
      .select({ allocated: aprBudgets.allocatedPaise })
      .from(aprBudgets)
      .where(and(eq(aprBudgets.financialYear, financialYear), eq(aprBudgets.branchId, branchId), eq(aprBudgets.categoryId, categoryId)))
      .then((r) => r[0]),
    spendRows(financialYear, { branchId, categoryId }).then((r) => r[0]),
  ]);
  return { allocatedPaise: budget?.allocated ?? null, spentPaise: spend?.spentPaise ?? 0, pendingPaise: spend?.pendingPaise ?? 0 };
}

export type UtilisationRow = {
  branchId: string;
  branchName: string;
  categoryId: string;
  categoryName: string;
  allocatedPaise: number | null;
  spentPaise: number;
  pendingPaise: number;
  /** Allocated minus spent; null when there is no budget. Negative once overspent. */
  remainingPaise: number | null;
  percent: number | null;
};

/** Every branch and category that has a budget or any spend in the year, with the numbers side by side. */
export async function utilisation(financialYear: string): Promise<UtilisationRow[]> {
  const [budgets, spend, branches, categories] = await Promise.all([
    db.select().from(aprBudgets).where(eq(aprBudgets.financialYear, financialYear)),
    spendRows(financialYear),
    db.select({ id: aprBranches.id, name: aprBranches.name }).from(aprBranches).orderBy(asc(aprBranches.name)),
    db.select({ id: aprCategories.id, name: aprCategories.name }).from(aprCategories).orderBy(asc(aprCategories.name)),
  ]);
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const key = (b: string, c: string) => `${b}|${c}`;
  const merged = new Map<string, UtilisationRow>();
  const row = (branchId: string, categoryId: string): UtilisationRow => {
    const k = key(branchId, categoryId);
    let r = merged.get(k);
    if (!r) {
      r = {
        branchId, branchName: branchName.get(branchId) ?? "(removed)", categoryId, categoryName: categoryName.get(categoryId) ?? "(removed)",
        allocatedPaise: null, spentPaise: 0, pendingPaise: 0, remainingPaise: null, percent: null,
      };
      merged.set(k, r);
    }
    return r;
  };
  for (const b of budgets) row(b.branchId, b.categoryId).allocatedPaise = b.allocatedPaise;
  for (const s of spend) { const r = row(s.branchId, s.categoryId); r.spentPaise = s.spentPaise; r.pendingPaise = s.pendingPaise; }
  for (const r of merged.values()) {
    r.remainingPaise = r.allocatedPaise == null ? null : r.allocatedPaise - r.spentPaise;
    r.percent = percentUsed(r.allocatedPaise, r.spentPaise);
  }
  return [...merged.values()].sort((a, b) => a.branchName.localeCompare(b.branchName) || a.categoryName.localeCompare(b.categoryName));
}
