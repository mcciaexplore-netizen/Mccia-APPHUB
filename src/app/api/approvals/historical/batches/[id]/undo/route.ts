import { idParam, ok, route } from "@/lib/approvals/guard";
import { undoImport } from "@/lib/approvals/historical/import";

export const dynamic = "force-dynamic";

/** Removes the tickets of one historical import (while nobody has acted on them). Approvals admins only. */
export const POST = route<{ id: string }>({ roles: ["approvals_admin"] }, async ({ user, params }) => ok(await undoImport(user, idParam(params.id))));
