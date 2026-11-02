import "server-only";

/**
 * Supabase Storage, through its REST API (no SDK): the private bucket design-files holds every file DesignDesk keeps. Nothing in the
 * bucket is public. Browsers upload straight to it with a signed upload link (so Vercel's 4.5 MB request limit does not apply), and get
 * files back through a signed download link that works for 60 seconds, handed out only after the server has checked who is asking.
 *
 *   SUPABASE_URL               https://<project>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY  the project's service_role key (server only; never sent to a browser)
 *   DESIGN_STORAGE_BUCKET      optional, default design-files
 */

export const DOWNLOAD_TTL_SECONDS = 60;

function config(): { base: string; key: string; bucket: string } | null {
  const base = (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!base || !key) return null;
  return { base: `${base}/storage/v1`, key, bucket: (process.env.DESIGN_STORAGE_BUCKET ?? "design-files").trim() || "design-files" };
}

export const storageConfigured = () => !!config();

export class StorageError extends Error {}

function need() {
  const c = config();
  if (!c) throw new StorageError("File storage is not set up yet (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY). Ask the Support Admin.");
  return c;
}

const headers = (key: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${key}`, apikey: key, ...extra });
const encodePath = (key: string) => key.split("/").map(encodeURIComponent).join("/");

async function call(url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(15000) });
  } catch {
    throw new StorageError("File storage could not be reached. Please try again.");
  }
  return res;
}

/** A link the browser PUTs the file's bytes to (with its Content-Type). It works once, for this one object. */
export async function signedUploadUrl(storageKey: string): Promise<string> {
  const c = need();
  const res = await call(`${c.base}/object/upload/sign/${c.bucket}/${encodePath(storageKey)}`, { method: "POST", headers: headers(c.key, { "content-type": "application/json" }), body: "{}" });
  if (!res.ok) throw new StorageError(`File storage refused the upload (${res.status}). Check that the private bucket "${c.bucket}" exists.`);
  const j = (await res.json()) as { url?: string };
  if (!j.url) throw new StorageError("File storage did not return an upload link.");
  return `${c.base}${j.url.startsWith("/") ? "" : "/"}${j.url}`;
}

/** A link that downloads (or, with `inline`, shows) the object for the next 60 seconds. */
export async function signedDownloadUrl(storageKey: string, fileName: string, inline = false): Promise<string> {
  const c = need();
  const res = await call(`${c.base}/object/sign/${c.bucket}/${encodePath(storageKey)}`, {
    method: "POST",
    headers: headers(c.key, { "content-type": "application/json" }),
    body: JSON.stringify({ expiresIn: DOWNLOAD_TTL_SECONDS }),
  });
  if (!res.ok) throw new StorageError(res.status === 404 || res.status === 400 ? "That file is no longer in storage." : `File storage refused the download (${res.status}).`);
  const j = (await res.json()) as { signedURL?: string; signedUrl?: string };
  const path = j.signedURL ?? j.signedUrl;
  if (!path) throw new StorageError("File storage did not return a download link.");
  const url = new URL(`${c.base}${path.startsWith("/") ? "" : "/"}${path}`);
  if (!inline) url.searchParams.set("download", fileName);
  return url.toString();
}

/** The stored object's size in bytes, or null when it is not there (yet). */
export async function objectSize(storageKey: string): Promise<number | null> {
  const c = need();
  const slash = storageKey.lastIndexOf("/");
  const prefix = slash >= 0 ? storageKey.slice(0, slash) : "";
  const name = storageKey.slice(slash + 1);
  const res = await call(`${c.base}/object/list/${c.bucket}`, {
    method: "POST",
    headers: headers(c.key, { "content-type": "application/json" }),
    body: JSON.stringify({ prefix, search: name, limit: 10, offset: 0 }),
  });
  if (!res.ok) throw new StorageError(`File storage could not be checked (${res.status}).`);
  const list = (await res.json()) as { name: string; metadata?: { size?: number } | null }[];
  const hit = list.find((o) => o.name === name);
  return hit ? Number(hit.metadata?.size ?? 0) : null;
}

/** Removes objects. Missing ones are fine. Never throws: a file left behind is only wasted space. */
export async function removeObjects(storageKeys: string[]): Promise<void> {
  const c = config();
  if (!c || !storageKeys.length) return;
  try {
    await call(`${c.base}/object/${c.bucket}`, { method: "DELETE", headers: headers(c.key, { "content-type": "application/json" }), body: JSON.stringify({ prefixes: storageKeys }) });
  } catch {
    // ignored: see above
  }
}

/** For Settings → Integrations: whether the bucket answers. */
export async function checkStorage(): Promise<{ ok: boolean; message: string }> {
  const c = config();
  if (!c) return { ok: false, message: "Not set up: add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel, then redeploy." };
  try {
    const res = await call(`${c.base}/bucket/${c.bucket}`, { method: "GET", headers: headers(c.key) });
    if (res.ok) {
      const b = (await res.json()) as { public?: boolean };
      return b.public ? { ok: false, message: `The bucket "${c.bucket}" is public. Make it private in Supabase → Storage.` } : { ok: true, message: `Connected: private bucket "${c.bucket}".` };
    }
    return { ok: false, message: `The bucket "${c.bucket}" was not found (${res.status}). Create it in Supabase → Storage, private.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "File storage could not be reached." };
  }
}
