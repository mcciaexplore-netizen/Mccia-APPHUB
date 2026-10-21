import { revalidateTag } from "next/cache";
import { hasRole } from "@/lib/approvals/host-adapter";
import { kindParam, ok, readJson, route } from "@/lib/approvals/guard";
import { createMaster, listMaster } from "@/lib/approvals/masters";
import { masterCreate } from "@/lib/approvals/validation";

export const dynamic = "force-dynamic";

/** Dropdown contents. Everyone gets the active items; only an Approvals admin can ask for inactive ones too (?all=1). */
export const GET = route<{ kind: string }>({}, async ({ req, user, params }) => {
  const all = req.nextUrl.searchParams.get("all") === "1" && hasRole(user, "approvals_admin");
  return ok({ items: await listMaster(kindParam(params.kind), all) });
});

export const POST = route<{ kind: string }>({ roles: ["approvals_admin"] }, async ({ req, user, params }) => {
  const item = await createMaster(kindParam(params.kind), await readJson(req, masterCreate), user);
  revalidateTag("masters", { expire: 0 }); // the list filters keep these lists for a few minutes: show the new one at once
  return ok({ item }, 201);
});
