"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useToast } from "@/components/Toast";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Calls one of the module's JSON routes and always returns, never throws. */
export async function api<T = Record<string, never>>(method: "POST" | "PATCH" | "PUT" | "DELETE", url: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // A signed-out request is redirected to the sign-in page, which is HTML, not JSON.
    if (res.redirected || !res.headers.get("content-type")?.includes("json")) return { ok: false, error: "Your session has ended. Please sign in again." };
    const json = await res.json();
    return res.ok ? { ok: true, data: json as T } : { ok: false, error: json.error ?? "Something went wrong." };
  } catch {
    return { ok: false, error: "Could not reach the server. Check your connection." };
  }
}

/** Runs a call with a pending flag, a success or error toast, and a refresh of the page's server data afterwards. */
export function useAction() {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ApiResult<unknown>>, okMessage: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) { toast.success(okMessage); after?.(); router.refresh(); } else toast.error(r.error);
    });
  return { run, pending };
}
