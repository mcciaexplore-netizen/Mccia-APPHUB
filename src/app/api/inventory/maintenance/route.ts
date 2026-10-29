import { ok, readJson, route } from "@/lib/inventory/guard";
import { createTicket } from "@/lib/inventory/maintenance";
import { ticketInput } from "@/lib/inventory/validation";

export const dynamic = "force-dynamic";

/** Anyone who may open Inventory reports a maintenance problem, with an optional photo (JPEG or PNG, at most 2 MB). */
export const POST = route({}, async ({ req, user }) => ok({ ticket: await createTicket(await readJson(req, ticketInput), user) }, 201));
