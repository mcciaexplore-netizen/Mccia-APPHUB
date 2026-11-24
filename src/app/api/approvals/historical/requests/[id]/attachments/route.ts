import { idParam, ok, readJson, route } from "@/lib/approvals/guard";
import { attachRecovered } from "@/lib/approvals/historical/attachments";
import { recoveredInput } from "../../../schemas";

export const dynamic = "force-dynamic";

/** Attaches a recovered copy of a file the source names to a historical ticket. Approvals admins only. */
export const POST = route<{ id: string }>({ roles: ["approvals_admin"] }, async ({ req, user, params }) =>
  ok(await attachRecovered(user, idParam(params.id), await readJson(req, recoveredInput)), 201));
