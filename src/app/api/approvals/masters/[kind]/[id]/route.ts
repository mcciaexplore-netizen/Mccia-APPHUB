import { idParam, kindParam, ok, readJson, route } from "@/lib/approvals/guard";
import { updateMaster } from "@/lib/approvals/masters";
import { masterPatch } from "@/lib/approvals/validation";

export const dynamic = "force-dynamic";

export const PATCH = route<{ kind: string; id: string }>({ roles: ["approvals_admin"] }, async ({ req, user, params }) =>
  ok({ item: await updateMaster(kindParam(params.kind), idParam(params.id), await readJson(req, masterPatch), user) }));
