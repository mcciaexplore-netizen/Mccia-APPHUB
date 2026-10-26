import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { aprCategories, aprCategoryBudgets, aprExpenditureDetails, aprRequests } from "@/db/approvals-schema";
import { recordAudit } from "./audit";
import { ApprovalsError } from "./errors";
import { formatINR } from "./format";
import type { ApprovalsUser } from "./host-adapter";

/**
 * Budgets per expense category and financial year. The Director General (or the Support Admin) sets what is allocated; what is used is
 * worked out every time as the sum of the approved expense requests of that category and year, and what waits for approval is shown beside
 * it. Nothing is ever subtracted from a stored figure, so the numbers cannot drift, and a rejected or withdrawn request simply never counts.
 */
export type CategoryBudget = { allocatedPaise: number | null; usedPaise: number; pendingPaise: number };

const sumWhere = (status: "approved" | "pending") => sql<number>`coalesce(sum(${aprRequests.amountPaise}) filter (where ${aprRequests.status} = ${status}), 0)::bigint`;

/** One category's budget for one financial year. `allocatedPaise` is null when none has been set. */
export async function categoryBudget(categoryId: string, financialYear: string): Promise<CategoryBudget> {
  const [[set], [spent]] = await Promise.all([
    db.select({ allocatedPaise: aprCategoryBudgets.allocatedPaise }).from(aprCategoryBudgets)
      .where(and(eq(aprCategoryBudgets.categoryId, categoryId), eq(aprCategoryBudgets.financialYear, financialYear))),
    db.select({ used: sumWhere("approved"), pending: sumWhere("pending") }).from(aprRequests)
      .innerJoin(aprExpenditureDetails, eq(aprExpenditureDetails.requestId, aprRequests.id))
      .where(and(eq(aprExpenditureDetails.categoryId, categoryId), eq(aprRequests.financialYear, financialYear))),
  ]);
  return { allocatedPaise: set?.allocatedPaise ?? null, usedPaise: Number(spent?.used ?? 0), pendingPaise: Number(spent?.pending ?? 0) };
}

export type BudgetRow = CategoryBudget & { categoryId: string; name: string; updatedByName: string | null; updatedAt: Date | null };

/** Every active expense category with its budget, what is used and what is waiting, for one financial year (the Budgets page). */
export async function budgetTable(financialYear: string): Promise<BudgetRow[]> {
  const [cats, set, spent] = await Promise.all([
    db.select({ id: aprCategories.id, name: aprCategories.name }).from(aprCategories).where(eq(aprCategories.active, true)).orderBy(asc(aprCategories.name)),
    db.select().from(aprCategoryBudgets).where(eq(aprCategoryBudgets.financialYear, financialYear)),
    db.select({ categoryId: aprExpenditureDetails.categoryId, used: sumWhere("approved"), pending: sumWhere("pending") }).from(aprRequests)
      .innerJoin(aprExpenditureDetails, eq(aprExpenditureDetails.requestId, aprRequests.id))
      .where(eq(aprRequests.financialYear, financialYear)).groupBy(aprExpenditureDetails.categoryId),
  ]);
  const budget = new Map(set.map((b) => [b.categoryId, b]));
  const totals = new Map(spent.map((s) => [s.categoryId, s]));
  return cats.map((c) => ({
    categoryId: c.id, name: c.name,
    allocatedPaise: budget.get(c.id)?.allocatedPaise ?? null, updatedByName: budget.get(c.id)?.updatedByName ?? null, updatedAt: budget.get(c.id)?.updatedAt ?? null,
    usedPaise: Number(totals.get(c.id)?.used ?? 0), pendingPaise: Number(totals.get(c.id)?.pending ?? 0),
  }));
}

/** Sets (or, with null, clears) a category's budget for a financial year. Recorded in the Approval System's audit log. */
export async function setCategoryBudget(financialYear: string, categoryId: string, allocatedPaise: number | null, actor: ApprovalsUser): Promise<void> {
  const [cat] = await db.select({ name: aprCategories.name }).from(aprCategories).where(eq(aprCategories.id, categoryId));
  if (!cat) throw new ApprovalsError("That category does not exist.", 404);
  const [before] = await db.select().from(aprCategoryBudgets).where(and(eq(aprCategoryBudgets.categoryId, categoryId), eq(aprCategoryBudgets.financialYear, financialYear)));
  if (allocatedPaise == null) {
    if (!before) return;
    await db.delete(aprCategoryBudgets).where(eq(aprCategoryBudgets.id, before.id));
    await recordAudit(actor, "budget", before.id, "delete", `Removed the ${financialYear} budget of ${cat.name}`, before, null);
    return;
  }
  const [row] = await db.insert(aprCategoryBudgets).values({ financialYear, categoryId, allocatedPaise, updatedByName: actor.name })
    .onConflictDoUpdate({ target: [aprCategoryBudgets.financialYear, aprCategoryBudgets.categoryId], set: { allocatedPaise, updatedByName: actor.name, updatedAt: new Date() } })
    .returning();
  await recordAudit(actor, "budget", row.id, before ? "update" : "create",
    `Set the ${financialYear} budget of ${cat.name} to ${formatINR(allocatedPaise, { symbol: true })}${before ? ` (was ${formatINR(before.allocatedPaise, { symbol: true })})` : ""}`, before ?? null, row);
}
