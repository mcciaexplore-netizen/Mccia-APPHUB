import { z } from "zod";
import { setCategoryBudget } from "@/lib/approvals/budget";
import { isFinancialYear } from "@/lib/approvals/format";
import { ok, readJson, route } from "@/lib/approvals/guard";
import { idSchema } from "@/lib/approvals/validation";

export const dynamic = "force-dynamic";

const budgetInput = z.object({
  financialYear: z.string().refine(isFinancialYear, "Choose a financial year like 2026-27."),
  categoryId: idSchema,
  // Rupees as paise; null removes the budget.
  allocatedPaise: z.number().int("The budget can have at most 2 decimals.").min(0, "The budget cannot be negative.").max(1_000_000_000_000_00).nullable(),
});

/** Sets or clears one category's budget for a financial year. The Director General and the Support Admin only. */
export const PUT = route({ roles: ["dg", "approvals_admin"] }, async ({ req, user }) => {
  const input = await readJson(req, budgetInput);
  await setCategoryBudget(input.financialYear, input.categoryId, input.allocatedPaise, user);
  return ok();
});
