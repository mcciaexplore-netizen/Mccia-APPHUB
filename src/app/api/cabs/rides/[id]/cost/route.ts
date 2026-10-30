import { idParam, ok, readJson, route } from "@/lib/cabs/guard";
import { saveCost } from "@/lib/cabs/payments";
import { costInput } from "@/lib/cabs/validation";

export const dynamic = "force-dynamic";

/** Record or change a completed ride's cost (Cabs admins). Refused once its invoice has been sent. */
export const POST = route<{ id: string }>({ roles: ["cab_admin"] }, async ({ req, user, params }) => {
  const result = await saveCost(idParam(params.id), await readJson(req, costInput), user);
  return ok({ result });
});
