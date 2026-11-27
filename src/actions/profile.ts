"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { AVATAR_TYPE_MESSAGE, avatarSizeProblem, sniffAvatar } from "@/lib/avatar-rules";
import { AvatarStorageError, deleteAvatarByUrl, saveAvatarObject } from "@/lib/avatar-storage";
import { logError } from "@/lib/log-error";
import { getCurrentUser } from "@/lib/permissions";

/**
 * A person's own profile photo. Both actions work on the SIGNED-IN person's row and on nobody else's: there is no user id to send, so a
 * person cannot change another's photo, and the picture is saved under their own id in the bucket. The picture is checked here, on the
 * server (size, then what it really is from its bytes), whatever the browser claimed.
 */

export type ProfileResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export async function uploadAvatar(formData: FormData): Promise<ProfileResult<{ url: string }>> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: "Please sign in again." };
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Choose a picture first." };
  const tooBig = avatarSizeProblem(file.size);
  if (tooBig) return { ok: false, error: tooBig };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffAvatar(bytes);
  if (!kind) return { ok: false, error: AVATAR_TYPE_MESSAGE };
  let url: string;
  try {
    url = await saveAvatarObject(me.id, bytes, kind);
  } catch (e) {
    if (e instanceof AvatarStorageError) return { ok: false, error: e.message };
    logError("[hub] profile photo upload failed", e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  try {
    await db.update(users).set({ avatarUrl: url }).where(eq(users.id, me.id));
  } catch (e) {
    logError("[hub] profile photo not saved", e);
    await deleteAvatarByUrl(url); // do not leave the new picture behind
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await deleteAvatarByUrl(me.avatarUrl); // the one it replaces
  revalidatePath("/", "layout");
  return { ok: true, data: { url } };
}

export async function removeAvatar(): Promise<ProfileResult> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: "Please sign in again." };
  try {
    await db.update(users).set({ avatarUrl: null }).where(eq(users.id, me.id));
  } catch (e) {
    logError("[hub] profile photo not removed", e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
  await deleteAvatarByUrl(me.avatarUrl);
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}
