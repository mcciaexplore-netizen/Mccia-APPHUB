import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { aprBranches, aprBudgets, aprCategories } from "@/db/approvals-schema";
import { recordAudit } from "./audit";
import { ApprovalsError } from "./errors";
import { formatINR } from "./format";
import type { ApprovalsUser } from "./host-adapter";

export type BudgetRow = {
  id: string;
  financialYear: string;
  branchId: string;
  branchName: string;
  categoryId: string;
  categoryName: string;
  allocatedPaise: number;
};

export async function listBudgets(filter: { financialYear?: string; branchId?: string; categoryId?: string } = {}): Promise<BudgetRow[]> {
  return db
    .select({
      id: aprBudgets.id, financialYear: aprBudgets.financialYear, branchId: aprBudgets.branchId, branchName: aprBranches.name,
      categoryId: aprBudgets.categoryId, categoryName: aprCategories.name, allocatedPaise: aprBudgets.allocatedPaise,
    })
    .from(aprBudgets)
    .innerJoin(aprBranches, eq(aprBranches.id, aprBudgets.branchId))
    .innerJoin(aprCategories, eq(aprCategories.id, aprBudgets.categoryId))
    .where(and(
      filter.financialYear ? eq(aprBudgets.financialYear, filter.financialYear) : undefined,
      filter.branchId ? eq(aprBudgets.branchId, filter.branchId) : undefined,
      filter.categoryId ? eq(aprBudgets.categoryId, filter.categoryId) : undefined,
    ))
    .orderBy(desc(aprBudgets.financialYear), asc(aprBranches.name), asc(aprCategories.name));
}

const one = async (id: string) => {
  const [row] = (await listBudgets()).filter((b) => b.id === id);
  if (!row) throw new ApprovalsError("That budget no longer exists.", 404);
  return row;
};

/** Sets the budget for a year, branch and category: creates it, or replaces the amount if it already exists. */
export async function upsertBudget(
  input: { financialYear: string; branchId: string; categoryId: string; allocatedPaise: number },
  actor: ApprovalsUser,
): Promise<BudgetRow> {
  const [branch] = await db.select().from(aprBranches).where(eq(aprBranches.id, input.branchId));
  const [category] = await db.select().from(aprCategories).where(eq(aprCategories.id, input.categoryId));
  if (!branch?.active) throw new ApprovalsError("Pick an active branch.");
  if (!category?.active) throw new ApprovalsError("Pick an active category.");

  const [existing] = await db
    .select({ id: aprBudgets.id })
    .from(aprBudgets)
    .where(and(eq(aprBudgets.financialYear, input.financialYear), eq(aprBudgets.branchId, input.branchId), eq(aprBudgets.categoryId, input.categoryId)));
  const before = existing ? await one(existing.id) : null;

  const [saved] = await db
    .insert(aprBudgets)
    .values(input)
    .onConflictDoUpdate({ target: [aprBudgets.financialYear, aprBudgets.branchId, aprBudgets.categoryId], set: { allocatedPaise: input.allocatedPaise } })
    .returning({ id: aprBudgets.id });
  const after = await one(saved.id);
  await recordAudit(
    actor, "budget", after.id, before ? "update" : "create",
    `${before ? "Changed" : "Set"} budget ${after.financialYear} / ${after.branchName} / ${after.categoryName} to ${formatINR(after.allocatedPaise, { symbol: true })}`,
    before, after,
  );
  return after;
}

export async function updateBudget(id: string, allocatedPaise: number, actor: ApprovalsUser): Promise<BudgetRow> {
  const before = await one(id);
  await db.update(aprBudgets).set({ allocatedPaise }).where(eq(aprBudgets.id, id));
  const after = await one(id);
  await recordAudit(actor, "budget", id, "update", `Changed budget ${after.financialYear} / ${after.branchName} / ${after.categoryName} from ${formatINR(before.allocatedPaise, { symbol: true })} to ${formatINR(allocatedPaise, { symbol: true })}`, before, after);
  return after;
}

export async function deleteBudget(id: string, actor: ApprovalsUser): Promise<void> {
  const before = await one(id);
  await db.delete(aprBudgets).where(eq(aprBudgets.id, id));
  await recordAudit(actor, "budget", id, "delete", `Removed budget ${before.financialYear} / ${before.branchName} / ${before.categoryName}`, before, null);
}
