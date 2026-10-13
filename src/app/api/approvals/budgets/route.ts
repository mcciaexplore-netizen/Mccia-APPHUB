import { z } from "zod";
import { ok, readJson, route } from "@/lib/approvals/guard";
import { listBudgets, upsertBudget } from "@/lib/approvals/budgets";
import { budgetUpsert, financialYearSchema, idSchema } from "@/lib/approvals/validation";

export const dynamic = "force-dynamic";

const filters = z.object({
  fy: financialYearSchema.optional(),
  branchId: idSchema.optional(),
  categoryId: idSchema.optional(),
});

/** The budget table. Read only for viewers; admins can also change it. */
export const GET = route({ roles: ["viewer"] }, async ({ req }) => {
  const q = req.nextUrl.searchParams;
  const f = filters.parse({ fy: q.get("fy") ?? undefined, branchId: q.get("branchId") ?? undefined, categoryId: q.get("categoryId") ?? undefined });
  return ok({ items: await listBudgets({ financialYear: f.fy, branchId: f.branchId, categoryId: f.categoryId }) });
});

export const POST = route({ roles: ["approvals_admin"] }, async ({ req, user }) => ok({ item: await upsertBudget(await readJson(req, budgetUpsert), user) }, 201));
