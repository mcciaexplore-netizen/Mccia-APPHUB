import { idParam, ok, readJson, route } from "@/lib/approvals/guard";
import { withdrawRequest } from "@/lib/approvals/requests";
import { withdrawInput } from "@/lib/approvals/request-schemas";

export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>({}, async ({ req, user, params }) => {
  const { comment } = await readJson(req, withdrawInput);
  await withdrawRequest(idParam(params.id), comment, user);
  return ok();
});
