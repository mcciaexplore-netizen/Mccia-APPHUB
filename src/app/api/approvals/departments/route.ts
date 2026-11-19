import { z } from "zod";
import { revalidateTag } from "next/cache";
import { addDepartment, departmentOptions } from "@/lib/approvals/departments";
import { ok, readJson, route } from "@/lib/approvals/guard";
import { rateLimit } from "@/lib/approvals/ratelimit";

export const dynamic = "force-dynamic";

/** The Budget form's Department list (the Approval System's departments and the hub's). Anyone who can raise a budget may read it. */
export const GET = route({}, async () => ok({ items: await departmentOptions() }));

/**
 * "Add department: …" on the Budget form: anyone filling it in may add one, and it is there for everyone after. A name already on the list
 * (any capitals) is returned instead of being added twice.
 */
export const POST = route({}, async ({ req, user }) => {
  await rateLimit("department", user.id, 20, 600);
  const { name } = await readJson(req, z.object({ name: z.string().max(200) }));
  const item = await addDepartment(name, user);
  revalidateTag("masters", { expire: 0 });
  return ok({ item }, 201);
});
