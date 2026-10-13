import { idParam, ok, readJson, route } from "@/lib/approvals/guard";
import { deleteBudget, updateBudget } from "@/lib/approvals/budgets";
import { budgetPatch } from "@/lib/approvals/validation";

export const dynamic = "force-dynamic";

export const PATCH = route<{ id: string }>({ roles: ["approvals_admin"] }, async ({ req, user, params }) => {
  const { allocatedPaise } = await readJson(req, budgetPatch);
  return ok({ item: await updateBudget(idParam(params.id), allocatedPaise, user) });
});

export const DELETE = route<{ id: string }>({ roles: ["approvals_admin"] }, async ({ user, params }) => {
  await deleteBudget(idParam(params.id), user);
  return ok();
});
