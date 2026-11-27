import "server-only";
import { randomUUID } from "node:crypto";
import type { AvatarKind } from "./avatar-rules";

/**
 * Supabase Storage for profile photos, through its REST API (no SDK, like DesignDesk's files): the PUBLIC bucket "avatars", made by
 * scripts/create-avatars-bucket.sql. Only this server writes to it (with the service_role key); a photo is saved under its owner's own id
 * (<user id>/<random>.<ext>), so one person's upload can never replace another's, and the address changes with every upload, so a new photo
 * shows at once and never from a browser's old copy.
 *
 *   SUPABASE_URL               https://<project>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY  the project's service_role key (server only; never sent to a browser)
 *   AVATAR_STORAGE_BUCKET      optional, default avatars
 */

export class AvatarStorageError extends Error {}

function config(): { base: string; key: string; bucket: string } | null {
  const base = (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!base || !key) return null;
  return { base: `${base}/storage/v1`, key, bucket: (process.env.AVATAR_STORAGE_BUCKET ?? "avatars").trim() || "avatars" };
}

export const avatarStorageConfigured = () => !!config();

const headers = (key: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${key}`, apikey: key, ...extra });

async function call(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(15000) });
  } catch {
    throw new AvatarStorageError("Photo storage could not be reached. Please try again.");
  }
}

/** Saves a picture for this person and returns its public address. */
export async function saveAvatarObject(userId: string, bytes: Uint8Array<ArrayBuffer>, kind: AvatarKind): Promise<string> {
  const c = config();
  if (!c) throw new AvatarStorageError("Photo storage is not set up yet (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY). Ask the Support Admin.");
  const path = `${userId}/${randomUUID()}.${kind.ext}`;
  const res = await call(`${c.base}/object/${c.bucket}/${path}`, {
    method: "POST",
    headers: headers(c.key, { "content-type": kind.mime, "cache-control": "max-age=31536000", "x-upsert": "false" }),
    body: new Blob([bytes], { type: kind.mime }),
  });
  if (!res.ok) throw new AvatarStorageError(`Photo storage refused the picture (${res.status}). Check that the public bucket "${c.bucket}" exists (scripts/create-avatars-bucket.sql).`);
  return `${c.base}/object/public/${c.bucket}/${path}`;
}

/**
 * Removes the picture at a public address this server made (anything else is left alone). Best effort: a picture that stays behind
 * only costs a little space, so a failure is never reported to the person.
 */
export async function deleteAvatarByUrl(url: string | null | undefined): Promise<void> {
  const c = config();
  if (!c || !url) return;
  const prefix = `${c.base}/object/public/${c.bucket}/`;
  if (!url.startsWith(prefix)) return;
  const path = url.slice(prefix.length);
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(path)) return;
  try {
    await call(`${c.base}/object/${c.bucket}/${path}`, { method: "DELETE", headers: headers(c.key) });
  } catch {
    // see above
  }
}
