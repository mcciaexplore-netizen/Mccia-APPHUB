import { idParam, ok, readJson, route } from "@/lib/approvals/guard";
import { rateLimit } from "@/lib/approvals/ratelimit";
import { reviseBudget } from "@/lib/approvals/requests";
import { budgetRevisionInput } from "@/lib/approvals/request-schemas";

export const dynamic = "force-dynamic";

/**
 * Asks for a revision of an approved budget: a new request, linked to the original, that needs a fresh approval. Only the person who raised
 * the budget may, only once it is approved, and only while no other revision of it is waiting (all checked inside).
 */
export const POST = route<{ id: string }>({}, async ({ req, user, params }) => {
  await rateLimit("submit", user.id, 30, 600);
  return ok(await reviseBudget(idParam(params.id), await readJson(req, budgetRevisionInput), user), 201);
});
