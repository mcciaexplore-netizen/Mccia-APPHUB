import { z } from "zod";
import { deleteBudget } from "@/lib/approvals/budget-delete";
import { idParam, ok, readJson, route } from "@/lib/approvals/guard";
import { rateLimit } from "@/lib/approvals/ratelimit";

export const dynamic = "force-dynamic";

/**
 * Deletes a budget with all its versions, for the Support Admin and the Super Admin (checked inside). The body carries what the person typed
 * to confirm: the Budget ID exactly (or the event name of a budget that has no ID yet). The Budget ID is retired and never given again.
 */
export const POST = route<{ id: string }>({}, async ({ req, user, params }) => {
  await rateLimit("submit", user.id, 30, 600);
  const { confirm } = await readJson(req, z.object({ confirm: z.string().max(300) }));
  return ok(await deleteBudget(idParam(params.id), confirm, user));
});
