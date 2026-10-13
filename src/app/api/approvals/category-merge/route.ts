import { ok, readJson, route } from "@/lib/approvals/guard";
import { mergeCategories } from "@/lib/approvals/masters";
import { categoryMerge } from "@/lib/approvals/validation";

export const dynamic = "force-dynamic";

/** Folds one expense category into another (see mergeCategories). */
export const POST = route({ roles: ["approvals_admin"] }, async ({ req, user }) => {
  const { sourceId, targetId } = await readJson(req, categoryMerge);
  return ok({ item: await mergeCategories(sourceId, targetId, user) });
});
