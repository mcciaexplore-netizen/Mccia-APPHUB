/**
 * The one place the client talks to the server. Returns the JSON, or throws an Error whose message is safe to show
 * (with `status` set to the HTTP status). Cookies carry the session, so nothing else is sent.
 */
export async function api(method, url, body) {
  const isForm = body instanceof FormData;
  let res;
  try {
    res = await fetch(url, { method, headers: body && !isForm ? { "Content-Type": "application/json" } : undefined, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
  } catch {
    throw new Error("Could not reach the server. Check your connection.");
  }
  const json = (res.headers.get("content-type") ?? "").includes("json") ? await res.json() : {};
  if (!res.ok) { const e = new Error(json.error ?? "Something went wrong."); e.status = res.status; throw e; }
  return json;
}
