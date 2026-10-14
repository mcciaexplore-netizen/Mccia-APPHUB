import { idParam, ok, readJson, route } from "@/lib/approvals/guard";
import { updateRule } from "@/lib/approvals/rules";
import { ruleUpdate } from "@/lib/approvals/validation";

export const dynamic = "force-dynamic";

/** Names the person for a routing step, clears it, or turns the rule on or off. Admin only; requests already submitted are not touched. */
export const PATCH = route<{ id: string }>({ roles: ["approvals_admin"] }, async ({ req, user, params }) =>
  ok({ item: await updateRule(idParam(params.id), await readJson(req, ruleUpdate), user) }));
