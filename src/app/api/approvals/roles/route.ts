import { ok, readJson, route } from "@/lib/approvals/guard";
import { listRoleAssignments, setRole } from "@/lib/approvals/roles";
import { roleGrant } from "@/lib/approvals/validation";

export const dynamic = "force-dynamic";

export const GET = route({ roles: ["approvals_admin"] }, async () => ok({ items: await listRoleAssignments() }));

/** Grants or removes viewer / Approvals admin for one person. Approver and DG come from the routing rules, not from here. */
export const PUT = route({ roles: ["approvals_admin"] }, async ({ req, user }) => {
  const { userId, role, granted } = await readJson(req, roleGrant);
  await setRole(userId, role, granted, user);
  return ok();
});
