"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useToast } from "@/components/Toast";
import type { ActionResult } from "@/lib/design/dal";

/** Runs a server action from the ticket page: shows its message or error, refreshes the page on success, and returns the result. */
export function useAct() {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const act = <T,>(fn: () => Promise<ActionResult<T>>, opts: { quiet?: boolean; onDone?: (data: T) => void } = {}) =>
    new Promise<ActionResult<T>>((resolve) =>
      start(async () => {
        const r = await fn();
        if (!r.ok) toast.error(r.error);
        else {
          if (!opts.quiet && r.message) toast.success(r.message);
          opts.onDone?.(r.data);
          router.refresh();
        }
        resolve(r);
      }),
    );
  return { act, pending };
}

/** An ISO moment as the value of a datetime-local input, in IST. */
export const toIstInput = (iso: string | null) => (iso ? new Date(+new Date(iso) + 330 * 60_000).toISOString().slice(0, 16) : "");
/** A datetime-local value (read as IST) as an ISO moment. */
export const fromIstInput = (v: string) => (v ? new Date(`${v}:00+05:30`).toISOString() : null);
