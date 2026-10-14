import { z } from "zod";
import { budgetPosition } from "@/lib/approvals/budget-position";
import { ok, route } from "@/lib/approvals/guard";
import { financialYearSchema, idSchema } from "@/lib/approvals/validation";

export const dynamic = "force-dynamic";

const query = z.object({ branchId: idSchema, categoryId: idSchema, fy: financialYearSchema });

/**
 * The budget position the forms show live: allocated, spent (approved only) and pending for a branch, category and financial year
 * (the form works out the year from its Date of Request). The forms do the arithmetic themselves with the same functions the server
 * uses to flag a request.
 */
export const GET = route({}, async ({ req }) => {
  const q = req.nextUrl.searchParams;
  const p = query.parse({ branchId: q.get("branchId") ?? undefined, categoryId: q.get("categoryId") ?? undefined, fy: q.get("fy") ?? undefined });
  return ok({ financialYear: p.fy, ...(await budgetPosition(p.fy, p.branchId, p.categoryId)) });
});
