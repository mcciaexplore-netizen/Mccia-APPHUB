import { idParam, ok, readJson, route } from "@/lib/approvals/guard";
import { rateLimit } from "@/lib/approvals/ratelimit";
import { resubmitRequest } from "@/lib/approvals/requests";
import { resubmitInput } from "@/lib/approvals/request-schemas";

export const dynamic = "force-dynamic";

/** Sends a request that was returned for corrections back to the approver who returned it, with the person's edits. Only the person who raised it, and only while it is returned (checked inside). */
export const PUT = route<{ id: string }>({}, async ({ req, user, params }) => {
  await rateLimit("submit", user.id, 30, 600);
  return ok(await resubmitRequest(idParam(params.id), await readJson(req, resubmitInput), user));
});
