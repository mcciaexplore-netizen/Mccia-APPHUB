import { ApprovalsError } from "@/lib/approvals/errors";
import { categoryBudget } from "@/lib/approvals/budget";
import { financialYearOf } from "@/lib/approvals/format";
import { ok, route } from "@/lib/approvals/guard";
import { idSchema } from "@/lib/approvals/validation";

export const dynamic = "force-dynamic";

/**
 * A category's budget for the year a request falls in, for the figures on the expense form: what is allocated, used by approved requests,
 * and waiting for approval. Anyone who can raise a request may read it; only the Director General and the Support Admin can set it.
 */
export const GET = route({}, async ({ req }) => {
  const id = idSchema.safeParse(req.nextUrl.searchParams.get("category"));
  if (!id.success) throw new ApprovalsError("Choose a category.", 400);
  const at = req.nextUrl.searchParams.get("date");
  const when = at && !Number.isNaN(Date.parse(at)) ? new Date(at) : new Date();
  const fy = financialYearOf(when);
  return ok({ financialYear: fy, ...(await categoryBudget(id.data, fy)) });
});
