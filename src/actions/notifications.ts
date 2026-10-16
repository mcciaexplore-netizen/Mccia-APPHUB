"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/permissions";
import { markHubRead } from "@/lib/notifications";
import { uuid } from "@/lib/validation";

/**
 * A person marking their own hub notifications as read. They check who is asking themselves (nobody else's rows can be touched: the
 * query is scoped to the signed-in person's id).
 */
export async function markNotificationRead(id: string) {
  const me = await getCurrentUser();
  if (!me) return { ok: false as const, error: "Please sign in again." };
  const parsed = uuid.safeParse(id);
  if (!parsed.success) return { ok: false as const, error: "Invalid notification." };
  await markHubRead(me.id, parsed.data);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function markAllNotificationsRead() {
  const me = await getCurrentUser();
  if (!me) return { ok: false as const, error: "Please sign in again." };
  await markHubRead(me.id);
  revalidatePath("/", "layout");
  return { ok: true as const };
}
