import { idParam, ok, readJson, route } from "@/lib/inventory/guard";
import { updateTicket } from "@/lib/inventory/maintenance";
import { ticketUpdate } from "@/lib/inventory/validation";

export const dynamic = "force-dynamic";

/** Store staff: change a ticket's status, resolution note and resolution photo. */
export const PATCH = route<{ id: string }>({ roles: ["inventory_staff", "inventory_admin"] }, async ({ req, user, params }) => {
  await updateTicket(idParam(params.id), await readJson(req, ticketUpdate), user);
  return ok();
});
