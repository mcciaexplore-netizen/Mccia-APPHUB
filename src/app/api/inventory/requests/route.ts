import { ok, readJson, route } from "@/lib/inventory/guard";
import { createRequest } from "@/lib/inventory/requests";
import { requestInput } from "@/lib/inventory/validation";

export const dynamic = "force-dynamic";

/** Anyone who may open Inventory asks the store for an item. */
export const POST = route({}, async ({ req, user }) => ok({ request: await createRequest(await readJson(req, requestInput), user) }, 201));
