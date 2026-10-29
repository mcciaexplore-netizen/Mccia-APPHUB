import { idParam, ok, readJson, route } from "@/lib/inventory/guard";
import { approveRequest, fulfilRequest, rejectRequest } from "@/lib/inventory/requests";
import { requestDecision } from "@/lib/inventory/validation";

export const dynamic = "force-dynamic";

/** Store staff: approve, reject (with a reason) or fulfil a request. Fulfilling takes the stock out and is refused if there is not enough. */
export const PATCH = route<{ id: string }>({ roles: ["inventory_staff", "inventory_admin"] }, async ({ req, user, params }) => {
  const id = idParam(params.id);
  const d = await readJson(req, requestDecision);
  if (d.action === "approve") await approveRequest(id, user);
  else if (d.action === "reject") await rejectRequest(id, d.reason, user);
  else await fulfilRequest(id, user);
  return ok();
});
