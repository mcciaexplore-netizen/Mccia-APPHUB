import { z } from "zod";
import { ok, readJson, route } from "@/lib/approvals/guard";
import { markRead, recentNotifications, unreadCount } from "@/lib/approvals/notify";
import { idSchema } from "@/lib/approvals/validation";

export const dynamic = "force-dynamic";

export const GET = route({}, async ({ user }) => {
  const [items, unread] = await Promise.all([recentNotifications(user.id), unreadCount(user.id)]);
  return ok({ items, unread });
});

/** Marks one notification read ({ id }), or all of them ({}). */
export const POST = route({}, async ({ req, user }) => {
  const { id } = await readJson(req, z.object({ id: idSchema.optional() }));
  await markRead(user.id, id);
  return ok();
});
