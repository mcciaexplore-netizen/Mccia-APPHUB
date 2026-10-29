/** Calls an /api/inventory route and returns its JSON, or throws an Error carrying the message the route sent (safe to show). */
export async function inventoryApi<T = Record<string, unknown>>(url: string, method: "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(data?.error ?? (res.status === 404 ? "Not found. Reload and try again." : "Something went wrong. Please try again."));
  return data as T;
}
