import { z } from "zod";
import { aprWatcherForm } from "@/db/approvals-schema";
import { ok, readJson, route } from "@/lib/approvals/guard";
import { rateLimit } from "@/lib/approvals/ratelimit";
import { idSchema } from "@/lib/approvals/validation";
import { addRule, addUserRule, removeRule } from "@/lib/approvals/watchers";

export const dynamic = "force-dynamic";

/**
 * A person's watching rules, set by the Support Admin on their page in Administrator > Users (approvals_admin, with Administrator unlocked,
 * as for every change to the module). A watcher reads what their rules match and decides nothing.
 */

/** Adds a rule: an approval type, and for Expenditure an expense category (none: all of them); or a person, to watch all they submit. */
export const POST = route({ roles: ["approvals_admin"] }, async ({ req, user }) => {
  await rateLimit("admin", user.id, 120, 600);
  const input = await readJson(
    req,
    z.union([z.object({ userId: idSchema, watchedUserId: idSchema }), z.object({ userId: idSchema, form: z.enum(aprWatcherForm), categoryId: idSchema.nullish() })]),
  );
  if ("watchedUserId" in input) await addUserRule(input.userId, input.watchedUserId, user);
  else await addRule(input.userId, input.form, input.categoryId ?? null, user);
  return ok({ ok: true }, 201);
});

/** Removes one of a person's rules. */
export const DELETE = route({ roles: ["approvals_admin"] }, async ({ req, user }) => {
  await rateLimit("admin", user.id, 120, 600);
  const input = await readJson(req, z.object({ userId: idSchema, id: idSchema }));
  await removeRule(input.userId, input.id, user);
  return ok({ ok: true });
});
