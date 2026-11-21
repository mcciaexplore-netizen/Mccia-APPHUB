import { z } from "zod";
import { aprWatcherForm } from "@/db/approvals-schema";
import { ok, readJson, route } from "@/lib/approvals/guard";
import { rateLimit } from "@/lib/approvals/ratelimit";
import { idSchema } from "@/lib/approvals/validation";
import { addWatcher, removeWatcher } from "@/lib/approvals/watchers";

export const dynamic = "force-dynamic";

/**
 * Watchers of the HR, Expenditure and Budget forms, managed by the Support Admin from Administrator > Approval Forms (approvals_admin, with
 * Administrator unlocked, as for every change to the module). A watcher reads every request of the form and decides nothing.
 */
const form = z.enum(aprWatcherForm);

/** Adds a hub user as a watcher of a form. */
export const POST = route({ roles: ["approvals_admin"] }, async ({ req, user }) => {
  await rateLimit("admin", user.id, 120, 600);
  const input = await readJson(req, z.object({ form, userId: idSchema }));
  await addWatcher(input.form, input.userId, user);
  return ok({ ok: true }, 201);
});

/** Removes a watcher of a form. */
export const DELETE = route({ roles: ["approvals_admin"] }, async ({ req, user }) => {
  await rateLimit("admin", user.id, 120, 600);
  const input = await readJson(req, z.object({ form, id: idSchema }));
  await removeWatcher(input.form, input.id, user);
  return ok({ ok: true });
});
