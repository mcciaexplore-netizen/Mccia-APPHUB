import { idParam, ok, readJson, route } from "@/lib/approvals/guard";
import { decideRequest } from "@/lib/approvals/requests";
import { decisionInput } from "@/lib/approvals/request-schemas";

export const dynamic = "force-dynamic";

/** Approve or reject. Whether this person may decide it, and whether a comment is needed, is checked inside. */
export const POST = route<{ id: string }>({}, async ({ req, user, params }) =>
  ok(await decideRequest(idParam(params.id), await readJson(req, decisionInput), user)));
